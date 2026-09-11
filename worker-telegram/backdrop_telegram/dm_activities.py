"""
Envoi d'un message dans un fil (inbox Telegram).

L'application a déjà écrit la ligne en `PENDING` avant d'appeler: l'écran
affiche le message dès le clic. Le travail ici est donc de le faire partir,
puis de dire ce qu'il est devenu — `SENT` avec son identifiant distant, ou
`FAILED` avec une raison lisible par un opérateur.

Rien n'est relu du navigateur: l'activité repart de la ligne en base, et donc
du fil auquel elle appartient. Un identifiant de conversation qui viendrait du
client pourrait désigner le fil de quelqu'un d'autre.
"""

from __future__ import annotations

import logging
from typing import Any

from temporalio import activity

from backdrop_telegram.db import connect, media_root
from backdrop_telegram.tdlib import pool

logger = logging.getLogger(__name__)


@activity.defn(name="sendTelegramMessage")
async def send_telegram_message(input: dict[str, Any]) -> dict[str, Any]:
    message_id = input["messageId"]

    async with await connect() as conn:
        row = await (
            await conn.execute(
                'select m.id, m.text, m.status, m."conversationId", '
                '       r."externalId" as reply_to, '
                '       c."externalId" as chat, a."personaId" '
                'from "Message" m '
                'join "Conversation" c on c.id = m."conversationId" '
                'join "ChannelAccount" a on a.id = c."channelAccountId" '
                'left join "Message" r on r.id = m."replyToId" '
                "where m.id = %s",
                (message_id,),
            )
        ).fetchone()

    if row is None:
        # La ligne a disparu entre l'appel et l'activité. Rien à envoyer, et
        # surtout rien à réessayer.
        return {"sent": False, "reason": "message introuvable"}

    if row["status"] == "SENT":
        # Une reprise de workflow après incident: le message est déjà parti.
        return {"sent": True, "alreadySent": True}

    media = await _media_of(message_id)

    try:
        if media:
            remote_id = await _send_media(
                persona_id=row["personaId"],
                chat_id=int(row["chat"]),
                caption=row["text"] or "",
                media=media,
                reply_to=int(row["reply_to"]) if row["reply_to"] else None,
            )
        else:
            remote_id = await _send(
                persona_id=row["personaId"],
                chat_id=int(row["chat"]),
                text=row["text"],
                reply_to=int(row["reply_to"]) if row["reply_to"] else None,
            )
    except Exception as error:  # noqa: BLE001 — la cause doit atteindre l'écran
        await _fail(message_id, _reason(error))
        raise

    async with await connect() as conn:
        await conn.execute(
            'update "Message" set "externalId" = %s, status = \'SENT\' where id = %s',
            (str(remote_id), message_id),
        )
        await conn.execute(
            'update "Conversation" set "lastMessageAt" = now(), "updatedAt" = now() '
            "where id = %s",
            (row["conversationId"],),
        )

    return {"sent": True, "remoteId": str(remote_id)}


async def _media_of(message_id: str) -> list[dict[str, Any]]:
    """
    Les fichiers à envoyer, résolus sur le volume.

    Les chemins sont lus **ici**, côté worker, et jamais transportés depuis le
    navigateur: un chemin qui viendrait du client désignerait ce qu'il veut.
    """
    async with await connect() as conn:
        rows = await (
            await conn.execute(
                'select a.kind, v."localPath" '
                'from "MessageAttachment" a '
                'join "Variant" v on v.id = a."variantId" '
                'where a."messageId" = %s and a."variantId" is not null '
                "order by a.position",
                (message_id,),
            )
        ).fetchall()

    return [
        {"kind": row["kind"], "path": str(media_root() / row["localPath"])}
        for row in rows
    ]


async def _send_media(
    *,
    persona_id: str,
    chat_id: int,
    caption: str,
    media: list[dict[str, Any]],
    reply_to: int | None,
):
    """
    Un média part en message simple, plusieurs en album.

    `send_message_album` et non N appels: Telegram afficherait sinon une pile
    de messages séparés là où l'opérateur a choisi une galerie — et le
    destinataire recevrait autant de notifications qu'il y a de photos.

    La légende ne se porte que sur le premier élément, ce qui est la
    convention de Telegram: la répéter l'afficherait sous chaque image.
    """
    from aiotdlib.api import (
        FormattedText,
        InputFileLocal,
        InputMessagePhoto,
        InputMessageReplyToMessage,
        InputMessageVideo,
    )

    client = pool.require(persona_id)

    def content(item: dict[str, Any], index: int):
        legend = FormattedText(text=caption if index == 0 else "", entities=[])
        if item["kind"] == "VIDEO":
            return InputMessageVideo(
                video=InputFileLocal(path=item["path"]),
                added_sticker_file_ids=[],
                duration=0,
                width=0,
                height=0,
                supports_streaming=True,
                caption=legend,
                has_spoiler=False,
            )
        return InputMessagePhoto(
            photo=InputFileLocal(path=item["path"]),
            added_sticker_file_ids=[],
            width=0,
            height=0,
            caption=legend,
            has_spoiler=False,
        )

    reply = InputMessageReplyToMessage(message_id=reply_to) if reply_to else None

    if len(media) == 1:
        message = await client.raw.api.send_message(
            chat_id=chat_id,
            input_message_content=content(media[0], 0),
            reply_to=reply,
        )
        return message.id

    sent = await client.raw.api.send_message_album(
        chat_id=chat_id,
        input_message_contents=[content(item, i) for i, item in enumerate(media)],
        reply_to=reply,
    )
    # L'album rend plusieurs messages; on retient le premier, qui est celui
    # que l'on montrerait pour retrouver l'envoi.
    messages = getattr(sent, "messages", None) or []
    return messages[0].id if messages else None


async def _send(*, persona_id: str, chat_id: int, text: str, reply_to: int | None):
    from aiotdlib.api import (
        FormattedText,
        InputMessageReplyToMessage,
        InputMessageText,
    )

    client = pool.require(persona_id)
    content = InputMessageText(
        text=FormattedText(text=text, entities=[]),
        # Pas d'aperçu de lien: une conversation commerciale n'a pas à se
        # remplir de cartes d'aperçu qu'on n'a pas choisies.
        link_preview_options=None,
        clear_draft=True,
    )

    message = await client.raw.api.send_message(
        chat_id=chat_id,
        input_message_content=content,
        reply_to=(
            InputMessageReplyToMessage(message_id=reply_to) if reply_to else None
        ),
    )
    return message.id


async def _fail(message_id: str, reason: str) -> None:
    async with await connect() as conn:
        await conn.execute(
            'update "Message" set status = \'FAILED\', "failReason" = %s where id = %s',
            (reason[:200], message_id),
        )


def _reason(error: BaseException) -> str:
    """
    Une cause lisible par un opérateur, pas une trace.

    Les deux échecs qu'on rencontre vraiment sont la persona déconnectée et le
    destinataire qui a bloqué la conversation: les nommer évite de chercher
    dans les journaux ce que l'écran pouvait dire.
    """
    text = str(error)
    if "non connectée" in text or "not connected" in text.lower():
        return "Persona not connected to Telegram. Reconnect it in Settings."
    if "USER_IS_BLOCKED" in text or "have no write access" in text.lower():
        return "This person blocked the conversation."
    return text[:200] or "Telegram refused the message."
