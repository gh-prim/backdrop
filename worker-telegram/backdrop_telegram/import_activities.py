"""
Import des conversations déjà existantes.

L'écoute ne rattrape rien: elle commence le jour où on l'allume. Un compte qui
discute depuis des mois arrive donc dans un outil vide, et l'opérateur n'a
aucune raison de faire confiance à une inbox qui ignore tout ce qui précède.

Trois bornes tiennent cet import, et elles sont toutes délibérées:

  * **Conversations privées seulement.** La liste de TDLib contient aussi les
    channels que la persona diffuse. Les importer noierait l'inbox sous ses
    propres publications, alors qu'elles ont déjà leur écran.

  * **Pas de téléchargement de médias.** Cinquante fils de cent messages
    tireraient plusieurs gigaoctets sans que personne ne l'ait demandé. Les
    pièces jointes sont enregistrées, leurs octets restent chez Telegram.

  * **Idempotent.** On réutilise les écritures de l'ingestion normale, donc la
    clé `(conversationId, externalId)`: relancer l'import ne duplique rien, et
    c'est ce qui permet de le relancer sans y réfléchir.
"""

from __future__ import annotations

import logging
from typing import Any

from temporalio import activity

from backdrop_telegram import inbox, inbox_store
from backdrop_telegram.db import connect
from backdrop_telegram.tdlib import pool

logger = logging.getLogger(__name__)

#: Au-delà, ce n'est plus une inbox mais un archivage — et l'import prendrait
#: des heures pour des fils que personne n'ouvrira.
DEFAULT_CHAT_LIMIT = 50
DEFAULT_MESSAGE_LIMIT = 100

#: TDLib rend l'historique par tranches; cent est son maximum par appel.
PAGE = 100


@activity.defn(name="importTelegramHistory")
async def import_telegram_history(input: dict[str, Any]) -> dict[str, Any]:
    persona_id = input["personaId"]
    chat_limit = int(input.get("chatLimit") or DEFAULT_CHAT_LIMIT)
    message_limit = int(input.get("messageLimit") or DEFAULT_MESSAGE_LIMIT)

    channel_account = await inbox_store.channel_account_id(persona_id)
    if channel_account is None:
        raise RuntimeError("Aucun compte Telegram enregistré pour cette persona.")

    client = pool.require(persona_id)
    api = client.raw.api

    # `load_chats` demande au serveur de peupler la liste locale; `get_chats`
    # ne rend que ce que TDLib connaît déjà. Sans le premier, un worker
    # fraîchement démarré rapporterait une liste vide.
    try:
        await api.load_chats(limit=chat_limit, chat_list=None)
    except Exception as error:  # noqa: BLE001 — liste déjà complète: TDLib lève
        logger.info("load_chats: %s", error)

    chats = await api.get_chats(limit=chat_limit, chat_list=None)
    chat_ids = list(getattr(chats, "chat_ids", []) or [])

    imported = 0
    messages = 0
    skipped = 0

    for chat_id in chat_ids:
        try:
            chat = await api.get_chat(chat_id=chat_id)
        except Exception as error:  # noqa: BLE001 — un fil illisible n'arrête rien
            logger.warning("chat %s illisible: %s", chat_id, error)
            continue

        if not _is_private(chat):
            skipped += 1
            continue

        count = await _import_chat(
            client=client,
            persona_id=persona_id,
            channel_account=channel_account,
            chat=chat,
            limit=message_limit,
        )
        imported += 1
        messages += count

    return {
        "chats": imported,
        "messages": messages,
        "skipped": skipped,
    }


def _is_private(chat: Any) -> bool:
    """
    Une conversation entre deux personnes, et rien d'autre.

    Le type porte `ID` = `chatTypePrivate`. Les groupes, supergroupes et
    channels sont écartés: l'inbox sert à répondre à quelqu'un, pas à relire
    ce que la persona a diffusé.
    """
    kind = getattr(getattr(chat, "type_", None), "ID", None) or getattr(
        getattr(chat, "type", None), "ID", None
    )
    return kind == "chatTypePrivate"


async def _import_chat(
    *, client: Any, persona_id: str, channel_account: str, chat: Any, limit: int
) -> int:
    """
    Remonte l'historique d'un fil, du plus récent vers le plus ancien.

    C'est le sens que TDLib impose, et c'est aussi le bon: si l'import est
    interrompu, ce qu'on a gardé est ce qui compte le plus.
    """
    api = client.raw.api
    chat_id = chat.id
    written = 0
    from_message_id = 0

    async with await connect() as conn:
        conversation_id = await inbox_store.upsert_conversation(
            conn,
            channel_account=channel_account,
            external_id=str(chat_id),
            contact_id=None,
            title=getattr(chat, "title", None) or None,
        )

    while written < limit:
        try:
            history = await api.get_chat_history(
                chat_id=chat_id,
                from_message_id=from_message_id,
                offset=0,
                limit=min(PAGE, limit - written),
                only_local=False,
            )
        except Exception as error:  # noqa: BLE001
            logger.warning("historique %s interrompu: %s", chat_id, error)
            break

        batch = list(getattr(history, "messages", []) or [])
        if not batch:
            break

        for message in batch:
            if await _write(client, persona_id, channel_account, message):
                written += 1

        # L'identifiant du plus ancien de la tranche sert de curseur: le
        # réutiliser tel quel reboucle indéfiniment sur la même page.
        oldest = batch[-1].id
        if oldest == from_message_id:
            break
        from_message_id = oldest

    # Une notification par fil, pas par message: l'écran voit les
    # conversations apparaître au fur et à mesure sans être réveillé mille
    # fois pour le même import.
    async with await connect() as conn:
        await inbox_store.notify(
            conn, persona_id=persona_id, conversation_id=conversation_id
        )

    return written


async def _write(
    client: Any, persona_id: str, channel_account: str, message: Any
) -> bool:
    """
    Écrit un message d'historique par le **même** chemin que l'ingestion.

    Dupliquer la logique de lecture ici garantirait qu'elle diverge: un jour
    l'un saurait lire les emojis animés et l'autre non, et l'écart ne se
    verrait que sur les vieux fils.
    """
    chat_id = str(getattr(message, "chat_id", ""))
    if not chat_id:
        return False

    outgoing = bool(getattr(message, "is_outgoing", False))
    sender_id = inbox._sender_user_id(message)

    async with await connect() as conn:
        contact_id = None
        if not outgoing and sender_id is not None:
            identity = await inbox._identity_of(client, sender_id)
            contact_id = await inbox_store.upsert_contact(
                conn,
                persona_id=persona_id,
                external_id=str(sender_id),
                display_name=identity["displayName"],
                username=identity["username"],
            )

        conversation_id = await inbox_store.upsert_conversation(
            conn,
            channel_account=channel_account,
            external_id=chat_id,
            contact_id=contact_id,
            title=None,
        )

        message_id = await inbox_store.record_message(
            conn,
            conversation_id=conversation_id,
            external_id=str(message.id),
            direction="OUT" if outgoing else "IN",
            text=inbox._text_of(message),
            sent_at=inbox._sent_at(message),
            author_id=contact_id,
            reply_to_external_id=inbox._reply_to(message),
        )
        if message_id is None:
            return False

        for position, item in enumerate(inbox._attachments_of(message)):
            item.pop("file", None)
            await inbox_store.attach(
                conn, message_id=message_id, position=position, **item
            )

        # Le fil remonte à la date de son dernier message, mais l'import ne
        # crée aucun non-lu: ce sont des messages déjà vus sur le téléphone,
        # et faire apparaître une pastille à cinquante serait une fausse
        # alerte au premier démarrage.
        await inbox_store.touch_conversation(
            conn,
            conversation_id=conversation_id,
            sent_at=inbox._sent_at(message),
            incoming=False,
        )

    return True
