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

from backdrop_telegram import inbox_media, inbox_store
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
            identity = await _identity_of(client, sender_id)
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
            title=await _chat_title(client, message.chat_id),
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

        # L'objet fichier de TDLib ne va pas en base — il n'y survivrait pas à
        # la session — mais il est nécessaire au téléchargement, qui a lieu
        # après, une fois le message affiché.
        to_fetch = []
        for position, item in enumerate(_attachments_of(message)):
            file = item.pop("file", None)
            attachment_id = await inbox_store.attach(
                conn, message_id=message_id, position=position, **item
            )
            to_fetch.append({"id": attachment_id, "kind": item["kind"], "file": file})

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

    # Hors de la transaction, et sans attendre: le fil doit apparaître à
    # l'instant où le message arrive, pas à la fin d'un téléchargement.
    await inbox_media.fetch_later(client, persona_id, conversation_id, to_fetch)

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


async def enrich_names(client: Any) -> None:
    """
    Donne un nom aux fils qui n'en ont pas.

    Appelé au démarrage du worker, une fois par persona. Sans lui, une
    conversation créée avant qu'on sache résoudre un interlocuteur resterait
    « Unnamed chat » jusqu'à ce que quelqu'un y écrive — et sur un fil qui
    dort, cela veut dire jamais.

    Tolérant par ligne: un interlocuteur qu'on ne sait plus résoudre — compte
    supprimé, par exemple — ne doit pas empêcher de nommer les autres.
    """
    persona_id = client.persona_id
    channel_account = await inbox_store.channel_account_id(persona_id)
    if channel_account is None:
        return

    async with await connect() as conn:
        rows = await inbox_store.nameless(conn, channel_account)
        for row in rows:
            if not row["title"]:
                title = await _chat_title(client, row["chat"])
                if title:
                    await inbox_store.set_conversation_title(
                        conn, conversation_id=row["id"], title=title
                    )

            if row["contact_id"] and not row["displayName"]:
                identity = await _identity_of(client, int(row["user_id"]))
                if identity["displayName"] or identity["username"]:
                    await inbox_store.set_contact_identity(
                        conn,
                        contact_id=row["contact_id"],
                        display_name=identity["displayName"],
                        username=identity["username"],
                    )

    if rows:
        logger.info("%d fil(s) nommé(s) pour persona=%s", len(rows), persona_id)


async def _identity_of(client: Any, user_id: int) -> dict[str, Optional[str]]:
    """
    Le nom et le pseudo de quelqu'un.

    L'update d'un message ne les porte pas: elle ne donne qu'un identifiant
    numérique. Sans cet appel, l'inbox afficherait une liste de « Unnamed
    chat », c'est-à-dire rien d'utilisable.

    TDLib répond depuis sa base locale la plupart du temps — l'appel est
    rarement un aller-retour réseau. Et un échec ne doit pas faire perdre le
    message: on écrit alors sans nom, quitte à le compléter au suivant.
    """
    try:
        user = await client.raw.api.get_user(user_id=int(user_id))
    except Exception as error:  # noqa: BLE001 — un nom manquant n'est pas une panne
        logger.warning("identité inconnue pour user_id=%s: %s", user_id, error)
        return {"displayName": None, "username": None}

    parts = [getattr(user, "first_name", "") or "", getattr(user, "last_name", "") or ""]
    display = " ".join(part for part in parts if part).strip() or None

    usernames = getattr(user, "usernames", None)
    username = getattr(usernames, "editable_username", None) if usernames else None
    if not username and usernames:
        actives = getattr(usernames, "active_usernames", None) or []
        username = actives[0] if actives else None

    return {"displayName": display, "username": username}


async def _chat_title(client: Any, chat_id: Any) -> Optional[str]:
    """
    Le titre du fil.

    Pour un groupe c'est son nom; pour une conversation privée, TDLib rend le
    nom de la personne, ce qui est exactement ce qu'on veut afficher.
    """
    try:
        chat = await client.raw.api.get_chat(chat_id=int(chat_id))
    except Exception as error:  # noqa: BLE001
        logger.warning("titre inconnu pour chat_id=%s: %s", chat_id, error)
        return None
    return getattr(chat, "title", None) or None


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
        if isinstance(value, str) and value:
            return value

    # Un emoji envoyé seul n'est pas un message texte: Telegram en fait un
    # `messageAnimatedEmoji`, dont le caractère vit dans `.emoji`. Sans cette
    # ligne, un « 👍 » s'affichait comme un message vide — ce qui est
    # exactement ce qu'on voyait sur le premier message reçu. Un sticker porte
    # le même champ, et c'est le meilleur résumé qu'on puisse en donner avant
    # de l'avoir téléchargé.
    emoji = getattr(content, "emoji", None) or getattr(
        getattr(content, "sticker", None), "emoji", None
    )
    return emoji if isinstance(emoji, str) else ""


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
            "file": file,
            "remote_file_id": _remote_id(file),
            "mime_type": getattr(holder, "mime_type", None),
            "size_bytes": getattr(getattr(file, "size", None), "real_value", None)
            or getattr(file, "size", None),
            "width": getattr(holder, "width", None),
            "height": getattr(holder, "height", None),
            "duration_seconds": getattr(holder, "duration", None),
        }
    ]


#: Les formats de sticker qu'un navigateur sait afficher. Le `.tgs` est du
#: Lottie compressé: le télécharger donnerait une image cassée à l'écran, et
#: l'emoji que porte le sticker dit déjà ce qu'il faut en comprendre.
DISPLAYABLE_STICKERS = {"stickerFormatWebp", "stickerFormatWebm"}


def _media_of(content: Any) -> tuple[Optional[str], Any]:
    # Un emoji animé n'a pas de pièce jointe: son caractère est le message.
    # Le traiter comme un sticker rapatrierait un fichier Lottie pour afficher
    # ce qu'une police rend déjà.
    if getattr(content, "animated_emoji", None) is not None:
        return None, None

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
        if holder is None:
            continue
        if kind == "STICKER" and not _sticker_is_displayable(holder):
            return None, None
        return kind, holder
    return None, None


def _sticker_is_displayable(sticker: Any) -> bool:
    fmt = getattr(getattr(sticker, "format", None), "ID", None)
    # Format inconnu: on tente, quitte à ce que l'écran affiche l'emoji à la
    # place. Refuser par défaut ferait disparaître des stickers parfaitement
    # affichables au prochain format que TDLib ajoute.
    return fmt is None or fmt in DISPLAYABLE_STICKERS


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
