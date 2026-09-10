"""
Envoi d'une publication Telegram.

Deux formes, décidées par le prix:

  * `starPrice` renseigné — message à média payant, réservé aux channels dont
    `has_paid_media_allowed` est vrai. TDLib refuse ailleurs.
  * sans prix — album ordinaire, valable partout, y compris en conversation
    privée.

Le paid media n'existe pas en DM (4.2.6). Le composeur l'interdit déjà, mais
la vérification est refaite ici: une publication programmée part des heures
après sa composition, et un channel peut avoir perdu l'autorisation entre-temps.
"""

from __future__ import annotations

from typing import Any

from temporalio import activity
from temporalio.exceptions import ApplicationError

from backdrop_telegram import db
from backdrop_telegram.tdlib import pool

OPERATOR_ERROR = "operator"


def _fail(message: str) -> ApplicationError:
    return ApplicationError(message, type=OPERATOR_ERROR, non_retryable=True)


@activity.defn(name="sendTelegramPublication")
async def send_telegram_publication(input: dict[str, Any]) -> dict[str, Any]:
    from aiotdlib.api import (
        FormattedText,
        InputFileLocal,
        InputMessagePaidMedia,
        InputMessagePhoto,
        InputMessageVideo,
        InputPaidMedia,
        InputPaidMediaTypePhoto,
        InputPaidMediaTypeVideo,
    )

    persona_id = input["personaId"]
    chat_id = int(input["chatId"])
    star_price = input.get("starPrice")
    caption_text = input.get("caption") or ""
    media = input["media"]  # [{path, isVideo, width, height}]

    client = pool.require(persona_id)
    api = client.raw.api

    if star_price:
        await _require_paid_media_allowed(api, chat_id)

    # Point d'arrêt de la simulation: la persona est connectée, la destination
    # existe et accepte le prix demandé. Ce qui suit téléverse des octets chez
    # Telegram, donc a des effets hors de chez nous.
    if input.get("dryRun"):
        await api.get_chat(chat_id=chat_id)
        return {"messageId": None, "paid": bool(star_price), "dryRun": True}

        paid = [
            InputPaidMedia(
                type=(
                    InputPaidMediaTypeVideo(duration=0, supports_streaming=True)
                    if item["isVideo"]
                    else InputPaidMediaTypePhoto()
                ),
                media=InputFileLocal(path=item["path"]),
                added_sticker_file_ids=[],
                width=item.get("width") or 0,
                height=item.get("height") or 0,
            )
            for item in media
        ]
        content = InputMessagePaidMedia(
            star_count=int(star_price),
            paid_media=paid,
            # « Bots only » (4.2.5): en session utilisateur il n'y a pas
            # d'attribution par achat, d'où la réconciliation par fenêtre
            # temporelle décrite au spec.
            payload="",
            caption=FormattedText(text=caption_text, entities=[]),
        )
        message = await api.send_message(chat_id=chat_id, input_message_content=content)
        return {"messageId": message.id, "paid": True}

    # Envoi gratuit. Un seul média part en message simple; plusieurs en album,
    # qui est ce que Telegram affiche comme une galerie.
    contents = [
        (
            InputMessageVideo(
                video=InputFileLocal(path=item["path"]),
                added_sticker_file_ids=[],
                duration=0,
                width=item.get("width") or 0,
                height=item.get("height") or 0,
                supports_streaming=True,
                caption=FormattedText(text=caption_text if index == 0 else "", entities=[]),
                has_spoiler=False,
            )
            if item["isVideo"]
            else InputMessagePhoto(
                photo=InputFileLocal(path=item["path"]),
                added_sticker_file_ids=[],
                width=item.get("width") or 0,
                height=item.get("height") or 0,
                caption=FormattedText(text=caption_text if index == 0 else "", entities=[]),
                has_spoiler=False,
            )
        )
        for index, item in enumerate(media)
    ]

    if len(contents) == 1:
        message = await api.send_message(
            chat_id=chat_id, input_message_content=contents[0]
        )
        return {"messageId": message.id, "paid": False}

    messages = await api.send_message_album(
        chat_id=chat_id, input_message_contents=contents
    )
    first = messages.messages[0]
    return {"messageId": first.id, "paid": False}


async def _require_paid_media_allowed(api, chat_id: int) -> None:
    """
    Refuse un envoi payant que Telegram rejetterait.

    Vérifier avant l'envoi évite de téléverser des médias pour rien, et rend
    l'échec lisible: « ce channel n'accepte pas le paid media » plutôt qu'une
    erreur de protocole.
    """
    chat = await api.get_chat(chat_id=chat_id)
    chat_type = chat.type_

    if getattr(chat_type, "ID", "") != "chatTypeSupergroup" or not getattr(
        chat_type, "is_channel", False
    ):
        raise _fail(
            "Le paid media n'existe que dans un channel: Telegram ne le permet "
            "ni en conversation privée ni en groupe."
        )

    info = await api.get_supergroup_full_info(supergroup_id=chat_type.supergroup_id)
    if not getattr(info, "has_paid_media_allowed", False):
        raise _fail(
            f"Le channel « {chat.title} » n'accepte pas le paid media. "
            "Il faut l'activer côté Telegram."
        )


@activity.defn(name="loadTelegramPublication")
async def load_telegram_publication(input: dict[str, Any]) -> dict[str, Any]:
    """Plan d'envoi lu en base. Aucun credential ne traverse le workflow (7.2)."""
    return await db.load_publication_plan(input["publicationId"])


@activity.defn(name="markTelegramPublished")
async def mark_telegram_published(input: dict[str, Any]) -> None:
    await db.mark_publication_published(input["publicationId"], str(input["messageId"]))


@activity.defn(name="markTelegramDryRun")
async def mark_telegram_dry_run(input: dict[str, Any]) -> None:
    await db.mark_publication_dry_run(input["publicationId"])


@activity.defn(name="markTelegramFailed")
async def mark_telegram_failed(input: dict[str, Any]) -> None:
    await db.mark_publication_failed(input["publicationId"], input["reason"])
