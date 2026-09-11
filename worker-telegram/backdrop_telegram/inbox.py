"""
Réception des messages entrants (inbox unifiée, partie Telegram).

Le handler est branché sur le pool, donc sur toute persona déjà connectée
comme sur celles qui le seront ensuite. Il tourne dans le worker, qui reste
allumé en permanence: un handler n'a de sens que s'il ne s'arrête jamais.

Trois choses le rendent plus long qu'on ne l'imaginerait:

  * **Les sortants comptent aussi.** Une persona qui répond depuis son
    téléphone produit exactement la même update. L'ignorer ferait mentir le
    fil, et l'on répondrait une seconde fois à ce qui a déjà une réponse.

  * **Un message est écrit deux fois par Telegram.** D'abord sous un
    identifiant local, puis sous le définitif une fois le serveur ayant
    accusé réception. Sans `updateMessageSendSucceeded`, chaque envoi
    apparaîtrait en double.

  * **Les médias sont des pointeurs.** TDLib donne un `file_id`, pas des
    octets. Le téléchargement est une opération à part, plafonnée: une inbox
    qui aspire tout remplit un disque en silence.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Optional

from backdrop_telegram import inbox_store
from backdrop_telegram.db import connect

logger = logging.getLogger(__name__)


async def on_message(client: Any, update: Any) -> None:
    """`updateNewMessage` — l'arrivée d'un message, dans un sens ou dans l'autre."""
    message = getattr(update, "message", None)
    if message is None:
        return

    try:
        await _ingest(client, message)
    except Exception:  # noqa: BLE001 — un fil illisible ne doit pas tuer le handler
        logger.exception(
            "ingestion impossible persona=%s chat=%s",
            getattr(client, "persona_id", None),
            getattr(message, "chat_id", None),
        )


async def _ingest(client: Any, message: Any) -> None:
    persona_id = client.persona_id
    channel_account = await inbox_store.channel_account_id(persona_id)
    if channel_account is None:
        # Une session ouverte sans compte en base: la persona s'est connectée
        # puis le compte a été supprimé. Rien à rattacher, rien à écrire.
        logger.warning("aucun ChannelAccount Telegram pour persona=%s", persona_id)
        return

    chat_id = str(getattr(message, "chat_id", ""))
    if not chat_id:
        return

    outgoing = bool(getattr(message, "is_outgoing", False))
    sender_id = _sender_user_id(message)
    text = _text_of(message)
    sent_at = _sent_at(message)

    async with await connect() as conn:
        contact_id = None
        # Sur un sortant, l'expéditeur est la persona: le contact du fil reste
        # celui d'en face, déjà enregistré à la première réception.
        if not outgoing and sender_id is not None:
            contact_id = await inbox_store.upsert_contact(
                conn,
                persona_id=persona_id,
                external_id=str(sender_id),
                display_name=None,
                username=None,
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
            text=text,
            sent_at=sent_at,
            author_id=contact_id,
            reply_to_external_id=_reply_to(message),
        )
        if message_id is None:
            # Déjà connu: TDLib rejoue son historique au redémarrage, et c'est
            # exactement ce qu'on veut qu'il fasse sans conséquence.
            return

        for position, item in enumerate(_attachments_of(message)):
            await inbox_store.attach(
                conn, message_id=message_id, position=position, **item
            )

        await inbox_store.touch_conversation(
            conn,
            conversation_id=conversation_id,
            sent_at=sent_at,
            incoming=not outgoing,
        )

        if not outgoing:
            await inbox_store.notify(
                conn, persona_id=persona_id, conversation_id=conversation_id
            )

    logger.info(
        "message %s persona=%s chat=%s: %s",
        "sortant" if outgoing else "entrant",
        persona_id,
        chat_id,
        (text or "<sans texte>")[:120],
    )


async def on_send_succeeded(client: Any, update: Any) -> None:
    """
    `updateMessageSendSucceeded` — l'identifiant local devient le définitif.

    Sans ce renommage, le message déjà écrit sous l'identifiant temporaire
    serait réinséré sous le définitif: le même message, deux fois.
    """
    message = getattr(update, "message", None)
    old_id = getattr(update, "old_message_id", None)
    if message is None or old_id is None:
        return

    channel_account = await inbox_store.channel_account_id(client.persona_id)
    if channel_account is None:
        return

    async with await connect() as conn:
        conversation_id = await inbox_store.upsert_conversation(
            conn,
            channel_account=channel_account,
            external_id=str(message.chat_id),
            contact_id=None,
            title=None,
        )
        await inbox_store.rename_message(
            conn,
            conversation_id=conversation_id,
            old_external_id=str(old_id),
            new_external_id=str(message.id),
        )


async def on_message_edited(client: Any, update: Any) -> None:
    """`updateMessageContent` — le texte a changé chez Telegram."""
    chat_id = getattr(update, "chat_id", None)
    message_id = getattr(update, "message_id", None)
    if chat_id is None or message_id is None:
        return

    channel_account = await inbox_store.channel_account_id(client.persona_id)
    if channel_account is None:
        return

    text = _text_of_content(getattr(update, "new_content", None))

    async with await connect() as conn:
        conversation_id = await inbox_store.upsert_conversation(
            conn,
            channel_account=channel_account,
            external_id=str(chat_id),
            contact_id=None,
            title=None,
        )
        await inbox_store.edit_message(
            conn,
            conversation_id=conversation_id,
            external_id=str(message_id),
            text=text,
        )


async def on_messages_deleted(client: Any, update: Any) -> None:
    """
    `updateDeleteMessages` — effacement côté Telegram.

    `is_permanent` faux signifie que TDLib retire les messages de son cache
    local sans qu'ils aient disparu pour autant: les marquer supprimés
    viderait le fil au moindre nettoyage de cache.
    """
    if not getattr(update, "is_permanent", False):
        return

    chat_id = getattr(update, "chat_id", None)
    ids = [str(value) for value in getattr(update, "message_ids", []) or []]
    if chat_id is None or not ids:
        return

    channel_account = await inbox_store.channel_account_id(client.persona_id)
    if channel_account is None:
        return

    async with await connect() as conn:
        conversation_id = await inbox_store.upsert_conversation(
            conn,
            channel_account=channel_account,
            external_id=str(chat_id),
            contact_id=None,
            title=None,
        )
        await inbox_store.mark_deleted(
            conn, conversation_id=conversation_id, external_ids=ids
        )


async def on_reactions(client: Any, update: Any) -> None:
    """
    `updateMessageReactions` — l'état complet des réactions d'un message.

    Telegram envoie l'ensemble, pas un delta: on remplace. Rapprocher deux
    listes laisserait traîner une réaction retirée.
    """
    chat_id = getattr(update, "chat_id", None)
    message_id = getattr(update, "message_id", None)
    if chat_id is None or message_id is None:
        return

    channel_account = await inbox_store.channel_account_id(client.persona_id)
    if channel_account is None:
        return

    reactions = []
    for reaction in getattr(update, "reactions", []) or []:
        emoji = getattr(getattr(reaction, "type_", None), "emoji", None) or getattr(
            getattr(reaction, "type", None), "emoji", None
        )
        if emoji:
            reactions.append(
                {"emoji": emoji, "byUs": bool(getattr(reaction, "is_chosen", False))}
            )

    async with await connect() as conn:
        conversation_id = await inbox_store.upsert_conversation(
            conn,
            channel_account=channel_account,
            external_id=str(chat_id),
            contact_id=None,
            title=None,
        )
        await inbox_store.replace_reactions(
            conn,
            conversation_id=conversation_id,
            external_id=str(message_id),
            reactions=reactions,
        )


# --- lecture des objets TDLib -------------------------------------------------
#
# Tout passe par `getattr`: la forme exacte d'un contenu varie d'une version de
# TDLib à l'autre, et une inbox qui lève une AttributeError sur un type de
# message inconnu cesse d'écouter pour tout le monde.


def _sender_user_id(message: Any) -> Optional[int]:
    sender = getattr(message, "sender_id", None)
    return getattr(sender, "user_id", None)


def _text_of(message: Any) -> str:
    return _text_of_content(getattr(message, "content", None))


def _text_of_content(content: Any) -> str:
    if content is None:
        return ""
    # Un message texte porte `.text.text`; une photo ou une vidéo portent la
    # même structure sous `.caption`.
    for attribute in ("text", "caption"):
        holder = getattr(content, attribute, None)
        value = getattr(holder, "text", None)
        if isinstance(value, str):
            return value
    return ""


def _sent_at(message: Any) -> datetime:
    date = getattr(message, "date", None)
    if isinstance(date, (int, float)):
        return datetime.fromtimestamp(date, tz=timezone.utc)
    return datetime.now(timezone.utc)


def _reply_to(message: Any) -> Optional[str]:
    """
    Le message auquel celui-ci répond, s'il est dans le même fil.

    Une réponse à un message d'un **autre** chat existe chez Telegram; on
    l'ignore plutôt que de rattacher un fil à un autre.
    """
    reply = getattr(message, "reply_to", None)
    if reply is None:
        return None
    chat_id = getattr(reply, "chat_id", None)
    if chat_id not in (None, getattr(message, "chat_id", None)):
        return None
    message_id = getattr(reply, "message_id", None)
    return str(message_id) if message_id else None


def _attachments_of(message: Any) -> list[dict[str, Any]]:
    """
    Les pièces jointes, en métadonnées seulement.

    Le fichier n'est pas téléchargé ici: `remote_file_id` suffit à le
    retrouver, et décider quoi rapatrier est une question de place disque,
    pas d'ingestion.
    """
    content = getattr(message, "content", None)
    if content is None:
        return []

    kind, holder = _media_of(content)
    if kind is None:
        return [] if holder is None else []

    file = _largest_file(holder)
    return [
        {
            "kind": kind,
            "remote_file_id": _remote_id(file),
            "mime_type": getattr(holder, "mime_type", None),
            "size_bytes": getattr(getattr(file, "size", None), "real_value", None)
            or getattr(file, "size", None),
            "width": getattr(holder, "width", None),
            "height": getattr(holder, "height", None),
            "duration_seconds": getattr(holder, "duration", None),
        }
    ]


def _media_of(content: Any) -> tuple[Optional[str], Any]:
    for attribute, kind in (
        ("photo", "PHOTO"),
        ("video", "VIDEO"),
        ("voice_note", "VOICE"),
        ("video_note", "VIDEO"),
        ("animation", "VIDEO"),
        ("sticker", "STICKER"),
        ("document", "DOCUMENT"),
        ("audio", "DOCUMENT"),
    ):
        holder = getattr(content, attribute, None)
        if holder is not None:
            return kind, holder
    return None, None


def _largest_file(holder: Any) -> Any:
    """
    Le fichier à retenir.

    Une photo Telegram est un jeu de tailles; on garde la plus grande, qui est
    la seule dont on soit sûr qu'elle n'est pas une vignette.
    """
    sizes = getattr(holder, "sizes", None)
    if sizes:
        largest = max(sizes, key=lambda size: getattr(size, "width", 0) or 0)
        return getattr(largest, "photo", None)
    for attribute in ("video", "voice", "document", "sticker", "audio", "animation"):
        file = getattr(holder, attribute, None)
        if file is not None:
            return file
    return None


def _remote_id(file: Any) -> Optional[str]:
    remote = getattr(file, "remote", None)
    return getattr(remote, "id", None) if remote else None
