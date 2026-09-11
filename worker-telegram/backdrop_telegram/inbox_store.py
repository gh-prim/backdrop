"""
Écriture de l'inbox en base.

Le worker est le seul à voir passer les messages: l'application web lit ce
qu'il écrit, elle n'écrit jamais un message entrant elle-même. Tout ce module
est donc l'unique porte d'entrée des fils de discussion.

Deux exigences le structurent:

  * **Idempotence.** TDLib rejoue son historique au redémarrage, et une même
    update peut arriver deux fois. Chaque écriture porte donc une clé
    naturelle — `(conversationId, externalId)` — et une insertion en conflit
    ne fait rien plutôt que de dupliquer le fil.

  * **Un signal, pas un sondage.** Après chaque écriture, `pg_notify` réveille
    l'application. Sans lui, le navigateur interrogerait le serveur toutes les
    quelques secondes pour ne rien apprendre, 720 fois par heure et par onglet.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from backdrop_telegram.db import connect, new_id

logger = logging.getLogger(__name__)

#: Canal Postgres écouté par l'application. Un seul, filtré côté écoute: un
#: canal par persona multiplierait les `LISTEN` sans rien simplifier.
NOTIFY_CHANNEL = "backdrop_inbox"

#: Au-delà, on garde la vignette et l'on ne télécharge pas le média entier.
#: Le serveur a saturé ses 30 Go le 2026-09-11; une inbox qui télécharge sans
#: plafond le referait, en silence et en continu.
MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024

#: Un message sortant écrit par l'application attend sa confirmation. Au-delà
#: de ce délai, on considère que l'update reçue concerne un autre envoi.
ADOPT_WINDOW = timedelta(minutes=2)


async def channel_account_id(persona_id: str) -> Optional[str]:
    """Le compte Telegram de la persona. Un fil s'y rattache, pas à la persona."""
    async with await connect() as conn:
        row = await (
            await conn.execute(
                'select id from "ChannelAccount" '
                "where \"personaId\" = %s and platform = 'TELEGRAM' limit 1",
                (persona_id,),
            )
        ).fetchone()
    return row["id"] if row else None


async def upsert_contact(
    conn: Any,
    *,
    persona_id: str,
    external_id: str,
    display_name: Optional[str],
    username: Optional[str],
) -> str:
    """
    Le contact, créé ou rafraîchi.

    Le nom est mis à jour à chaque passage: quelqu'un qui change de pseudo ne
    doit pas rester affiché sous l'ancien pendant des mois. `coalesce` protège
    l'inverse — une update sans nom ne doit pas effacer celui qu'on avait.
    """
    row = await (
        await conn.execute(
            'insert into "Contact" '
            '(id, "personaId", platform, "externalId", "displayName", username, '
            '"createdAt", "updatedAt") '
            "values (%s, %s, 'TELEGRAM', %s, %s, %s, now(), now()) "
            'on conflict ("personaId", platform, "externalId") do update set '
            '"displayName" = coalesce(excluded."displayName", "Contact"."displayName"), '
            'username = coalesce(excluded.username, "Contact".username), '
            '"updatedAt" = now() '
            "returning id",
            (new_id(), persona_id, external_id, display_name, username),
        )
    ).fetchone()
    return row["id"]


async def upsert_conversation(
    conn: Any,
    *,
    channel_account: str,
    external_id: str,
    contact_id: Optional[str],
    title: Optional[str],
) -> str:
    row = await (
        await conn.execute(
            'insert into "Conversation" '
            '(id, "channelAccountId", "contactId", "externalId", title, '
            '"createdAt", "updatedAt") '
            "values (%s, %s, %s, %s, %s, now(), now()) "
            'on conflict ("channelAccountId", "externalId") do update set '
            'title = coalesce(excluded.title, "Conversation".title), '
            '"contactId" = coalesce("Conversation"."contactId", excluded."contactId"), '
            '"updatedAt" = now() '
            "returning id",
            (new_id(), channel_account, contact_id, external_id, title),
        )
    ).fetchone()
    return row["id"]


async def _adopt_pending(
    conn: Any, *, conversation_id: str, text: str
) -> Optional[str]:
    """
    Retrouve la ligne écrite par l'application avant l'envoi.

    L'écran affiche le message dès le clic, bien avant que Telegram confirme.
    L'update d'arrivée décrit **ce même message**: l'insérer à nouveau le
    ferait apparaître deux fois. On adopte donc la ligne en attente plutôt que
    d'en créer une — fenêtre courte et texte identique, faute de quoi on
    adopterait le mauvais envoi.
    """
    since = datetime.now(timezone.utc) - ADOPT_WINDOW
    # Le passage à SENT vaut prise de possession: la condition `status =
    # 'PENDING'` interdit qu'une seconde update adopte la même ligne.
    row = await (
        await conn.execute(
            "update \"Message\" set status = 'SENT' "
            "where id = ("
            '  select id from "Message" '
            '  where "conversationId" = %s and "externalId" is null '
            "    and status = 'PENDING' and direction = 'OUT' "
            '    and text = %s and "sentAt" >= %s '
            '  order by "sentAt" asc limit 1'
            ") returning id",
            (conversation_id, text, since),
        )
    ).fetchone()
    return row["id"] if row else None


async def record_message(
    conn: Any,
    *,
    conversation_id: str,
    external_id: str,
    direction: str,
    text: str,
    sent_at: datetime,
    author_id: Optional[str],
    reply_to_external_id: Optional[str],
) -> Optional[str]:
    """
    Écrit un message, une fois.

    Rend `None` si le message était déjà connu: l'appelant sait alors qu'il n'a
    ni pièces jointes à rattacher ni notification à émettre. C'est ce qui rend
    un redémarrage du worker inoffensif.
    """
    reply_to_id = None
    if reply_to_external_id:
        row = await (
            await conn.execute(
                'select id from "Message" '
                'where "conversationId" = %s and "externalId" = %s',
                (conversation_id, reply_to_external_id),
            )
        ).fetchone()
        reply_to_id = row["id"] if row else None

    if direction == "OUT":
        adopted = await _adopt_pending(conn, conversation_id=conversation_id, text=text)
        if adopted:
            await conn.execute(
                'update "Message" set "externalId" = %s, status = \'SENT\' where id = %s',
                (external_id, adopted),
            )
            return adopted

    row = await (
        await conn.execute(
            'insert into "Message" '
            '(id, "conversationId", "externalId", direction, status, "authorId", '
            'text, "replyToId", "sentAt") '
            "values (%s, %s, %s, %s, 'SENT', %s, %s, %s, %s) "
            'on conflict ("conversationId", "externalId") do nothing '
            "returning id",
            (
                new_id(),
                conversation_id,
                external_id,
                direction,
                author_id,
                text,
                reply_to_id,
                sent_at,
            ),
        )
    ).fetchone()
    return row["id"] if row else None


async def attach(
    conn: Any,
    *,
    message_id: str,
    kind: str,
    remote_file_id: Optional[str],
    mime_type: Optional[str] = None,
    size_bytes: Optional[int] = None,
    width: Optional[int] = None,
    height: Optional[int] = None,
    duration_seconds: Optional[int] = None,
    position: int = 0,
) -> str:
    row = await (
        await conn.execute(
            'insert into "MessageAttachment" '
            '(id, "messageId", kind, "remoteFileId", "mimeType", "sizeBytes", '
            'width, height, "durationSeconds", position, "createdAt") '
            "values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now()) "
            "returning id",
            (
                new_id(),
                message_id,
                kind,
                remote_file_id,
                mime_type,
                size_bytes,
                width,
                height,
                duration_seconds,
                position,
            ),
        )
    ).fetchone()
    return row["id"]


async def set_attachment_file(
    conn: Any, *, attachment_id: str, local_path: Optional[str], thumb_path: Optional[str]
) -> None:
    await conn.execute(
        'update "MessageAttachment" set "localPath" = coalesce(%s, "localPath"), '
        '"thumbPath" = coalesce(%s, "thumbPath") where id = %s',
        (local_path, thumb_path, attachment_id),
    )


async def touch_conversation(
    conn: Any, *, conversation_id: str, sent_at: datetime, incoming: bool
) -> None:
    """
    Remonte le fil dans la liste, et compte le non-lu.

    Le compteur ne s'incrémente que sur un entrant: un message envoyé depuis
    le téléphone de la persona ne se signale pas à elle-même.
    """
    await conn.execute(
        'update "Conversation" set '
        '"lastMessageAt" = greatest(coalesce("lastMessageAt", %s), %s), '
        '"unreadCount" = "unreadCount" + %s, "updatedAt" = now() '
        "where id = %s",
        (sent_at, sent_at, 1 if incoming else 0, conversation_id),
    )


async def rename_message(
    conn: Any, *, conversation_id: str, old_external_id: str, new_external_id: str
) -> None:
    """
    Remplace l'identifiant temporaire par le définitif.

    TDLib attribue d'abord un identifiant local, puis le remplace une fois le
    serveur ayant accusé réception. Sans ce renommage, le message inséré sous
    l'identifiant temporaire serait réinséré sous le définitif: le même
    message, deux fois, à quelques millisecondes d'intervalle.
    """
    await conn.execute(
        'update "Message" set "externalId" = %s, status = \'SENT\' '
        'where "conversationId" = %s and "externalId" = %s',
        (new_external_id, conversation_id, old_external_id),
    )


async def edit_message(
    conn: Any, *, conversation_id: str, external_id: str, text: str
) -> None:
    await conn.execute(
        'update "Message" set text = %s, "editedAt" = now() '
        'where "conversationId" = %s and "externalId" = %s',
        (text, conversation_id, external_id),
    )


async def mark_deleted(
    conn: Any, *, conversation_id: str, external_ids: list[str]
) -> None:
    """
    Marque, ne supprime pas.

    Un message effacé chez Telegram l'a été par quelqu'un, à un moment: garder
    la ligne permet de savoir qu'il a existé. L'écran, lui, ne l'affiche plus.
    """
    if not external_ids:
        return
    await conn.execute(
        'update "Message" set "deletedAt" = now() '
        'where "conversationId" = %s and "externalId" = any(%s)',
        (conversation_id, external_ids),
    )


async def replace_reactions(
    conn: Any,
    *,
    conversation_id: str,
    external_id: str,
    reactions: list[dict[str, Any]],
) -> None:
    """
    Réécrit les réactions d'un message.

    Telegram envoie l'état complet, pas un delta: remplacer est donc plus juste
    que rapprocher, et évite de laisser traîner une réaction retirée.
    """
    row = await (
        await conn.execute(
            'select id from "Message" where "conversationId" = %s and "externalId" = %s',
            (conversation_id, external_id),
        )
    ).fetchone()
    if row is None:
        return

    message_id = row["id"]
    await conn.execute('delete from "MessageReaction" where "messageId" = %s', (message_id,))
    for reaction in reactions:
        await conn.execute(
            'insert into "MessageReaction" (id, "messageId", emoji, "byUs", "createdAt") '
            "values (%s, %s, %s, %s, now()) "
            'on conflict ("messageId", emoji, "contactId") do nothing',
            (new_id(), message_id, reaction["emoji"], bool(reaction.get("byUs"))),
        )


async def notify(conn: Any, *, persona_id: str, conversation_id: str) -> None:
    """
    Réveille l'application.

    `pg_notify` plutôt qu'un sondage: c'est la base qui sait qu'une ligne vient
    d'être écrite, et elle le dit à qui écoute. La charge d'un onglet ouvert
    toute la journée retombe à zéro requête quand rien n'arrive.
    """
    payload = json.dumps({"personaId": persona_id, "conversationId": conversation_id})
    await conn.execute("select pg_notify(%s, %s)", (NOTIFY_CHANNEL, payload))
