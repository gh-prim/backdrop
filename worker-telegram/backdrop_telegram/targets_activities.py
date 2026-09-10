"""
Découverte des destinations d'envoi d'une persona.

Le composeur doit proposer des channels et des conversations, et savoir
lesquels acceptent le paid media. TDLib est formelle:

    inputMessagePaidMedia — can be used only in channel chats with
    supergroupFullInfo.has_paid_media_allowed

Les étoiles ne concernent donc que les channels, et pas tous. Le dire à
l'écran vaut mieux que de laisser Telegram refuser après coup, une fois les
médias téléversés.
"""

from __future__ import annotations

from typing import Any

from temporalio import activity

from backdrop_telegram.tdlib import pool

# Au-delà, la liste devient inutilisable dans un menu déroulant. Le composeur
# offre une recherche pour ce qui n'y figure pas.
MAX_CHATS = 200


@activity.defn(name="listTelegramTargets")
async def list_telegram_targets(input: dict[str, Any]) -> dict[str, Any]:
    persona_id = input["personaId"]
    client = pool.require(persona_id)
    api = client.raw.api

    # `loadChats` remplit la liste locale depuis le serveur; `getChats` ne lit
    # que ce que TDLib a déjà en base, et renverrait presque rien au premier
    # appel après une connexion.
    try:
        await api.load_chats(limit=MAX_CHATS)
    except Exception:  # noqa: BLE001 — « tout est déjà chargé » remonte en erreur
        pass

    chats = await api.get_chats(limit=MAX_CHATS)

    targets: list[dict[str, Any]] = []
    for chat_id in chats.chat_ids:
        try:
            chat = await api.get_chat(chat_id=chat_id)
        except Exception:  # noqa: BLE001 — un chat illisible ne doit pas tout arrêter
            continue

        kind, paid_allowed = await _describe(api, chat)
        if kind is None:
            continue

        targets.append(
            {
                "chatId": str(chat_id),
                "title": chat.title or str(chat_id),
                "kind": kind,
                "paidMediaAllowed": paid_allowed,
            }
        )

    # Les channels d'abord: ce sont eux qui portent la monétisation.
    targets.sort(key=lambda t: (t["kind"] != "channel", t["title"].lower()))
    return {"targets": targets}


async def _describe(api, chat) -> tuple[str | None, bool]:
    """Type de destination, et capacité à recevoir du paid media."""
    chat_type = chat.type_
    kind = getattr(chat_type, "ID", "")

    if kind == "chatTypePrivate":
        return "user", False

    if kind == "chatTypeSupergroup":
        if not getattr(chat_type, "is_channel", False):
            return "group", False
        try:
            info = await api.get_supergroup_full_info(
                supergroup_id=chat_type.supergroup_id
            )
            return "channel", bool(getattr(info, "has_paid_media_allowed", False))
        except Exception:  # noqa: BLE001
            # Sans l'information, ne pas promettre ce qu'on ne peut pas tenir.
            return "channel", False

    if kind == "chatTypeBasicGroup":
        return "group", False

    return None, False
