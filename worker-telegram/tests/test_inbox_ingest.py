"""
Lecture des objets TDLib, et idempotence de l'ingestion.

Un fil de discussion faux est pire qu'un fil absent: on y répond une seconde
fois à ce qui a déjà une réponse, et l'on croit avoir dit ce qu'on n'a pas dit.
Ces tests tiennent les deux endroits où cela arrive — l'interprétation d'un
message, et le fait qu'une même update reçue deux fois n'écrive qu'une ligne.

TDLib n'est pas doublée: on lui substitue des objets de même forme, ce qui est
exactement ce que le code lit (il n'accède à rien autrement que par `getattr`).
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from backdrop_telegram import inbox, inbox_store


def message(**kwargs):
    base = {
        "id": 1001,
        "chat_id": -100123,
        "date": 1_760_000_000,
        "is_outgoing": False,
        "sender_id": SimpleNamespace(user_id=777),
        "content": SimpleNamespace(text=SimpleNamespace(text="bonjour")),
        "reply_to": None,
    }
    base.update(kwargs)
    return SimpleNamespace(**base)


# --- lecture d'un message -----------------------------------------------------


def test_le_texte_est_lu_sur_un_message_simple():
    assert inbox._text_of(message()) == "bonjour"


def test_la_legende_d_une_photo_compte_comme_texte():
    photo = message(
        content=SimpleNamespace(
            photo=SimpleNamespace(sizes=[]),
            caption=SimpleNamespace(text="regarde ça"),
        )
    )
    assert inbox._text_of(photo) == "regarde ça"


def test_un_contenu_inconnu_ne_fait_pas_tomber_l_ecoute():
    # Un type de message qu'on ne sait pas lire doit donner un texte vide, pas
    # une exception: le handler est partagé par toutes les personas.
    assert inbox._text_of(message(content=SimpleNamespace(poll=object()))) == ""
    assert inbox._attachments_of(message(content=SimpleNamespace(poll=object()))) == []


def test_la_date_vient_de_telegram_pas_de_l_horloge_locale():
    sent = inbox._sent_at(message(date=1_760_000_000))
    assert sent == datetime.fromtimestamp(1_760_000_000, tz=timezone.utc)


def test_sans_date_on_retombe_sur_maintenant():
    sent = inbox._sent_at(message(date=None))
    assert abs((datetime.now(timezone.utc) - sent).total_seconds()) < 5


def test_une_reponse_hors_du_fil_est_ignoree():
    # Telegram permet de répondre à un message d'un autre chat. Le rattacher
    # ici collerait deux fils l'un à l'autre.
    ailleurs = message(
        reply_to=SimpleNamespace(chat_id=-100999, message_id=42),
    )
    assert inbox._reply_to(ailleurs) is None

    ici = message(reply_to=SimpleNamespace(chat_id=-100123, message_id=42))
    assert inbox._reply_to(ici) == "42"


def test_la_photo_retenue_est_la_plus_grande():
    # Une photo Telegram est un jeu de tailles; la plus petite est une vignette.
    petite = SimpleNamespace(width=90, photo=SimpleNamespace(remote=SimpleNamespace(id="mini")))
    grande = SimpleNamespace(width=1280, photo=SimpleNamespace(remote=SimpleNamespace(id="maxi")))
    photo = message(
        content=SimpleNamespace(
            photo=SimpleNamespace(sizes=[petite, grande], width=1280, height=1600),
            caption=SimpleNamespace(text=""),
        )
    )
    pieces = inbox._attachments_of(photo)
    assert len(pieces) == 1
    assert pieces[0]["kind"] == "PHOTO"
    assert pieces[0]["remote_file_id"] == "maxi"


def test_chaque_type_de_media_est_classe():
    cas = {
        "video": "VIDEO",
        "voice_note": "VOICE",
        "sticker": "STICKER",
        "document": "DOCUMENT",
    }
    for attribut, attendu in cas.items():
        contenu = SimpleNamespace(**{attribut: SimpleNamespace(mime_type="x")})
        pieces = inbox._attachments_of(message(content=contenu))
        assert pieces and pieces[0]["kind"] == attendu, attribut


# --- idempotence --------------------------------------------------------------


class FakeCursor:
    def __init__(self, row):
        self._row = row

    async def fetchone(self):
        return self._row


class FakeConn:
    """
    Une base réduite à ce que l'ingestion lui demande.

    On ne simule pas Postgres: on rejoue la seule règle qui compte ici, à
    savoir que `(conversationId, externalId)` est unique et qu'une insertion en
    conflit ne rend rien.
    """

    def __init__(self):
        self.messages: dict[tuple[str, str], str] = {}
        self.statements: list[str] = []

    async def execute(self, sql, params=()):
        self.statements.append(" ".join(sql.split()))
        if sql.lstrip().startswith('insert into "Message"'):
            key = (params[1], params[2])
            if key in self.messages:
                return FakeCursor(None)
            self.messages[key] = params[0]
            return FakeCursor({"id": params[0]})
        if sql.lstrip().startswith('update "Message" set status'):
            return FakeCursor(None)  # aucune ligne en attente à adopter
        if sql.lstrip().startswith('select id from "Message"'):
            return FakeCursor(None)
        return FakeCursor(None)


def test_le_meme_message_recu_deux_fois_n_ecrit_qu_une_ligne():
    conn = FakeConn()

    async def scenario():
        commun = dict(
            conversation_id="conv1",
            external_id="555",
            direction="IN",
            text="salut",
            sent_at=datetime.now(timezone.utc),
            author_id=None,
            reply_to_external_id=None,
        )
        premier = await inbox_store.record_message(conn, **commun)
        second = await inbox_store.record_message(conn, **commun)
        return premier, second

    premier, second = asyncio.run(scenario())

    assert premier is not None, "le premier passage doit écrire"
    # TDLib rejoue son historique au redémarrage du worker: ce second passage
    # est le cas nominal, pas une anomalie.
    assert second is None, "le second passage ne doit rien écrire"


def test_un_sortant_cherche_d_abord_la_ligne_ecrite_avant_l_envoi():
    conn = FakeConn()

    async def scenario():
        return await inbox_store.record_message(
            conn,
            conversation_id="conv1",
            external_id="900",
            direction="OUT",
            text="déjà affiché",
            sent_at=datetime.now(timezone.utc),
            author_id=None,
            reply_to_external_id=None,
        )

    asyncio.run(scenario())

    # L'écran affiche le message dès le clic; l'update qui suit décrit ce
    # même message. Sans cette tentative d'adoption, il apparaîtrait deux fois.
    adoption = [s for s in conn.statements if "status = 'PENDING'" in s]
    assert adoption, "aucune tentative d'adoption d'une ligne en attente"


def test_un_entrant_ne_cherche_pas_a_adopter():
    conn = FakeConn()

    async def scenario():
        return await inbox_store.record_message(
            conn,
            conversation_id="conv1",
            external_id="901",
            direction="IN",
            text="salut",
            sent_at=datetime.now(timezone.utc),
            author_id=None,
            reply_to_external_id=None,
        )

    asyncio.run(scenario())
    assert not [s for s in conn.statements if "status = 'PENDING'" in s]


def test_la_fenetre_d_adoption_reste_courte():
    # Adopter au-delà de quelques minutes rattacherait la confirmation d'un
    # envoi à un message tapé bien plus tôt et jamais parti.
    assert inbox_store.ADOPT_WINDOW <= timedelta(minutes=5)


def test_le_plafond_de_telechargement_existe_et_reste_raisonnable():
    # Le serveur a saturé ses 30 Go le 2026-09-11. Une inbox sans plafond
    # recommencerait, en silence.
    assert 0 < inbox_store.MAX_DOWNLOAD_BYTES <= 50 * 1024 * 1024


# --- identité d'un interlocuteur ----------------------------------------------


class FakeApi:
    def __init__(self, user=None, chat=None, fail=False):
        self._user = user
        self._chat = chat
        self._fail = fail

    async def get_user(self, user_id):
        if self._fail:
            raise RuntimeError("réseau")
        return self._user

    async def get_chat(self, chat_id):
        if self._fail:
            raise RuntimeError("réseau")
        return self._chat


def fake_client(**kwargs):
    return SimpleNamespace(persona_id="p1", raw=SimpleNamespace(api=FakeApi(**kwargs)))


def test_le_nom_affiche_assemble_prenom_et_nom():
    user = SimpleNamespace(
        first_name="Jean",
        last_name="Dupont",
        usernames=SimpleNamespace(editable_username="jdupont", active_usernames=[]),
    )
    identity = asyncio.run(inbox._identity_of(fake_client(user=user), 777))
    assert identity == {"displayName": "Jean Dupont", "username": "jdupont"}


def test_un_nom_de_famille_absent_ne_laisse_pas_d_espace():
    user = SimpleNamespace(first_name="Carolina", last_name="", usernames=None)
    identity = asyncio.run(inbox._identity_of(fake_client(user=user), 777))
    assert identity["displayName"] == "Carolina"


def test_a_defaut_de_pseudo_modifiable_on_prend_le_premier_actif():
    user = SimpleNamespace(
        first_name="X",
        last_name="",
        usernames=SimpleNamespace(editable_username=None, active_usernames=["public"]),
    )
    assert asyncio.run(inbox._identity_of(fake_client(user=user), 7))["username"] == "public"


def test_une_identite_introuvable_ne_fait_pas_perdre_le_message():
    # Le nom est un confort; le message, non. Un échec ici doit laisser passer
    # l'ingestion, quitte à compléter au message suivant.
    identity = asyncio.run(inbox._identity_of(fake_client(fail=True), 777))
    assert identity == {"displayName": None, "username": None}
    assert asyncio.run(inbox._chat_title(fake_client(fail=True), 42)) is None


def test_le_titre_du_fil_vient_de_telegram():
    chat = SimpleNamespace(title="Carolina ❤")
    assert asyncio.run(inbox._chat_title(fake_client(chat=chat), 42)) == "Carolina ❤"


# --- emojis et stickers -------------------------------------------------------


def test_un_emoji_envoye_seul_n_est_pas_un_message_vide():
    # Telegram en fait un `messageAnimatedEmoji`: le caractère vit dans
    # `.emoji`, pas dans `.text.text`. Sans cela, « 👍 » s'affichait comme un
    # message sans contenu — ce qu'on a vu sur le premier message reçu.
    contenu = SimpleNamespace(animated_emoji=SimpleNamespace(sticker=None), emoji="👍")
    assert inbox._text_of(message(content=contenu)) == "👍"


def test_un_emoji_anime_ne_rapatrie_aucun_fichier():
    # Son caractère est le message: télécharger un Lottie pour afficher ce
    # qu'une police rend déjà n'a aucun sens.
    contenu = SimpleNamespace(animated_emoji=SimpleNamespace(sticker=None), emoji="🔥")
    assert inbox._attachments_of(message(content=contenu)) == []


def test_un_sticker_webp_est_rapatrie():
    sticker = SimpleNamespace(
        emoji="😎",
        format=SimpleNamespace(ID="stickerFormatWebp"),
        sticker=SimpleNamespace(remote=SimpleNamespace(id="stk")),
    )
    pieces = inbox._attachments_of(message(content=SimpleNamespace(sticker=sticker)))
    assert len(pieces) == 1
    assert pieces[0]["kind"] == "STICKER"


def test_un_sticker_lottie_laisse_parler_son_emoji():
    # `.tgs` est du Lottie compressé: le télécharger donnerait une image
    # cassée à l'écran.
    sticker = SimpleNamespace(
        emoji="🎉",
        format=SimpleNamespace(ID="stickerFormatTgs"),
        sticker=SimpleNamespace(remote=SimpleNamespace(id="stk")),
    )
    contenu = SimpleNamespace(sticker=sticker)
    assert inbox._attachments_of(message(content=contenu)) == []
    assert inbox._text_of(message(content=contenu)) == "🎉"


def test_un_format_de_sticker_inconnu_est_tente():
    # Refuser par défaut ferait disparaître les stickers du prochain format
    # que TDLib ajoutera.
    sticker = SimpleNamespace(
        emoji="🆕",
        format=None,
        sticker=SimpleNamespace(remote=SimpleNamespace(id="stk")),
    )
    assert len(inbox._attachments_of(message(content=SimpleNamespace(sticker=sticker)))) == 1


def test_un_emoji_dans_un_texte_reste_du_texte():
    assert inbox._text_of(message(content=SimpleNamespace(
        text=SimpleNamespace(text="salut 👋 ça va ?")
    ))) == "salut 👋 ça va ?"


def test_une_legende_de_photo_prime_sur_l_emoji_du_contenu():
    # Une photo légendée ne doit pas afficher un emoji à la place de sa
    # légende: l'ordre de lecture compte.
    contenu = SimpleNamespace(
        photo=SimpleNamespace(sizes=[]),
        caption=SimpleNamespace(text="regarde"),
        emoji="👍",
    )
    assert inbox._text_of(message(content=contenu)) == "regarde"


def test_un_gif_est_traite_comme_une_video():
    animation = SimpleNamespace(
        mime_type="video/mp4",
        animation=SimpleNamespace(remote=SimpleNamespace(id="gif")),
        duration=3,
    )
    pieces = inbox._attachments_of(message(content=SimpleNamespace(animation=animation)))
    assert pieces and pieces[0]["kind"] == "VIDEO"
