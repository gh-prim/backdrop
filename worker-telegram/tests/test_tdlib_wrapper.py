"""
Garde-fous de la couche TDLib.

Les trois défauts corrigés ici sont invisibles à la lecture et coûteux en
production: un segfault au démarrage, des messages perdus au hasard, une base
laissée dans un état douteux. Ils méritent chacun leur test.
"""

from __future__ import annotations

import base64
import ctypes

import pytest

KEY = base64.b64encode(b"\x2a" * 32).decode()


@pytest.fixture(autouse=True)
def _master_key(monkeypatch, tmp_path):
    monkeypatch.setenv("CREDENTIALS_MASTER_KEY", KEY)
    monkeypatch.setenv("TELEGRAM_SESSION_ROOT", str(tmp_path))
    from backdrop_telegram.crypto import reset_master_key_cache

    reset_master_key_cache()
    yield
    reset_master_key_cache()


def test_le_callback_de_log_est_declare_avec_deux_parametres():
    # aiotdlib 0.27.6 n'en déclare qu'un, alors que l'en-tête TDLib impose
    # `(int max_verbosity_level, callback)`. L'appel écrasait donc un registre
    # et TDLib sautait dans un pointeur pris au hasard: SIGSEGV au démarrage.
    from aiotdlib import tdjson

    from backdrop_telegram.tdlib import patches

    patches.install()
    assert tdjson.CDLL is patches._PatchedCDLL
    assert patches._PatchedCDLL.__mro__[1] is ctypes.CDLL


def test_le_callback_est_retenu_au_niveau_module():
    # S'il était créé à la volée, Python le libérerait alors que TDLib en garde
    # le pointeur brut.
    from backdrop_telegram.tdlib import patches

    assert patches._LOG_CALLBACK is not None


def test_un_seul_tdjson_pour_tout_le_processus():
    # `td_receive` est global. Deux boucles de réception se voleraient leurs
    # événements, et celle qui ne reconnaît pas le client_id **jette
    # l'événement sans rien dire**: des messages perdus au hasard, sans trace.
    from aiotdlib import tdjson

    from backdrop_telegram.tdlib import gateway

    gateway.reset_for_tests()
    gateway.install_shared_receiver()

    first = tdjson.TDJsonClient.create()
    second = tdjson.TDJsonClient.create()

    assert first.td_json is second.td_json
    assert first.client_id != second.client_id


def test_chaque_persona_a_sa_propre_cle():
    from backdrop_telegram.tdlib import sessions

    a = sessions.database_encryption_key("persona-a")
    b = sessions.database_encryption_key("persona-b")

    assert len(a) == 32
    assert a != b
    # Déterministe: sinon la base serait illisible au redémarrage suivant.
    assert a == sessions.database_encryption_key("persona-a")


def test_le_repertoire_de_session_est_prive():
    from backdrop_telegram.tdlib import sessions

    path = sessions.session_directory("persona-a")
    assert path.is_dir()
    # Il contient de quoi agir sur le compte, même chiffré.
    assert (path.stat().st_mode & 0o077) == 0


def test_reprise_et_connexion_n_ont_pas_la_meme_patience():
    # Sans fournisseur de code, aucune saisie n'est attendue: une lenteur est
    # une panne, typiquement une base illisible que TDLib ne signale pas.
    from backdrop_telegram.tdlib import client

    assert client.RESUME_TIMEOUT < client.LOGIN_TIMEOUT


@pytest.mark.asyncio
async def test_la_fermeture_n_annule_pas_l_appelant():
    """
    aiotdlib annule sa boucle d'updates puis l'attend, ce qui propage un
    CancelledError dans l'appelant. Il tuait l'activité de login au moment
    exact où elle fermait le client qu'elle venait remplacer.

    `except Exception` ne suffit pas: depuis Python 3.8, CancelledError dérive
    de BaseException.
    """
    import asyncio
    from types import SimpleNamespace

    from aiotdlib.api import API

    from backdrop_telegram.tdlib.client import PersonaTelegram

    class _Raw:
        def __init__(self):
            self._handler = None

        def add_event_handler(self, handler, _update_type):
            self._handler = handler

        @property
        def api(self):
            raw = self

            class _Api:
                @staticmethod
                async def close():
                    # TDLib confirme la fermeture par un événement, que le
                    # client attend avant de rendre la main.
                    state = SimpleNamespace(ID=API.Types.AUTHORIZATION_STATE_CLOSED)
                    await raw._handler(
                        raw, SimpleNamespace(authorization_state=state)
                    )

            return _Api

        async def stop(self):
            raise asyncio.CancelledError

    client = PersonaTelegram.__new__(PersonaTelegram)
    client.raw = _Raw()
    client._closed = False

    # Ne doit ni lever, ni traîner: l'appelant survit et repart aussitôt.
    await asyncio.wait_for(client.close(), timeout=5)
    assert client._closed is True


@pytest.mark.asyncio
async def test_une_reprise_n_engage_jamais_de_connexion():
    """
    Rouvrir une session révoquée ne doit pas envoyer de code.

    Sans garde-fou, chaque redémarrage du worker en enverrait un que personne
    n'attend, et le quota Telegram — qui se compte — finirait par bloquer les
    connexions légitimes.
    """
    from backdrop_telegram.tdlib.client import LoginAbandoned, _AuthClient

    client = _AuthClient.__new__(_AuthClient)
    client.code_provider = None

    with pytest.raises(LoginAbandoned):
        await client._set_authentication_phone_number()


@pytest.mark.asyncio
async def test_un_demarrage_echoue_referme_le_client():
    """
    Un client laissé vivant après un démarrage raté retient le verrou de son
    répertoire TDLib, et la persona devient impossible à reconnecter jusqu'au
    redémarrage du worker. C'est exactement ce qui bloquait le login après une
    réouverture échouée.
    """
    import asyncio

    from backdrop_telegram.tdlib.client import PersonaTelegram

    closed = asyncio.Event()

    class _Raw:
        async def start(self):
            raise RuntimeError("échec quelconque")

    client = PersonaTelegram.__new__(PersonaTelegram)
    client.raw = _Raw()
    client._closed = False

    async def _close():
        closed.set()
        client._closed = True

    client.close = _close

    with pytest.raises(RuntimeError):
        await client.start()

    assert closed.is_set()
