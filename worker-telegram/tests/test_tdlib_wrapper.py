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
