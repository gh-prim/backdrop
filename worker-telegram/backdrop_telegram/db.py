"""
Accès base du worker Telegram.

SQL brut via psycopg, sans ORM: le worker ne touche qu'à trois tables et un
second générateur de schéma à tenir synchronisé avec Prisma coûterait plus
qu'il ne rapporte. Les noms de colonnes sont ceux de Prisma, en camelCase
cité, ce qui explique les guillemets.
"""

from __future__ import annotations

import secrets
from datetime import datetime, timezone
from typing import Any

import psycopg
from psycopg.rows import dict_row

from backdrop_telegram import config
from backdrop_telegram.crypto import decrypt_credentials, encrypt_credentials


def new_id() -> str:
    """
    Identifiant applicatif. Prisma génère les cuid côté client, pas en base:
    une insertion en SQL brut doit donc fournir le sien.
    """
    return "c" + secrets.token_hex(12)


async def connect() -> psycopg.AsyncConnection:
    return await psycopg.AsyncConnection.connect(
        config.database_url(), row_factory=dict_row, autocommit=True
    )


async def load_telegram_app(persona_id: str) -> dict[str, Any]:
    """api_id / api_hash de la persona, déchiffrés (4.2.1)."""
    async with await connect() as conn:
        row = await (
            await conn.execute(
                'select credentials from "TelegramApp" where "personaId" = %s',
                (persona_id,),
            )
        ).fetchone()

    if row is None:
        raise RuntimeError(
            "Aucun api_id / api_hash Telegram enregistré pour cette persona."
        )
    return decrypt_credentials(row["credentials"])




async def save_telegram_account(
    *,
    persona_id: str,
    telegram_user_id: int,
    payload: dict[str, Any],
    max_rating: str = "NSFW",
) -> str:
    """
    Enregistre le compte Telegram d'une persona.

    Ne contient **pas** la session: avec TDLib, le secret est le répertoire
    chiffré sur disque. Ce qui est stocké ici est ce qu'il faut pour rouvrir ce
    répertoire — au premier chef le numéro, qu'aiotdlib réclame même pour une
    simple reprise — et de quoi afficher le compte dans l'application.

    C'est le worker qui écrit, et non le workflow: le résultat d'une activité
    est conservé dans l'historique Temporal (7.2).
    """
    blob = encrypt_credentials(payload)
    external_id = str(telegram_user_id)
    now = datetime.now(timezone.utc)

    async with await connect() as conn:
        await conn.execute(
            """
            insert into "ChannelAccount"
                (id, "personaId", platform, "externalId", credentials, "maxRating",
                 "createdAt", "updatedAt")
            values (%s, %s, 'TELEGRAM', %s, %s, %s, %s, %s)
            on conflict ("personaId", platform, "externalId")
            do update set credentials = excluded.credentials,
                          "updatedAt" = excluded."updatedAt"
            """,
            (new_id(), persona_id, external_id, blob, max_rating, now, now),
        )
        row = await (
            await conn.execute(
                'select id from "ChannelAccount" where "personaId" = %s '
                "and platform = 'TELEGRAM' and \"externalId\" = %s",
                (persona_id, external_id),
            )
        ).fetchone()

    return row["id"]


async def load_telegram_account(persona_id: str) -> dict[str, Any]:
    """Métadonnées du compte Telegram d'une persona, déchiffrées."""
    async with await connect() as conn:
        row = await (
            await conn.execute(
                'select credentials from "ChannelAccount" where "personaId" = %s '
                "and platform = 'TELEGRAM' order by \"updatedAt\" desc limit 1",
                (persona_id,),
            )
        ).fetchone()
    if row is None:
        raise RuntimeError(
            "Aucun compte Telegram connecté pour cette persona. "
            "Le connecter depuis Settings → Channels."
        )
    return decrypt_credentials(row["credentials"])


async def list_telegram_personas() -> list[dict[str, Any]]:
    """
    Personas ayant un compte Telegram connecté, avec de quoi rouvrir leur
    client. Lu au démarrage du worker: chacune doit être remise à l'écoute
    sans intervention.
    """
    async with await connect() as conn:
        rows = await (
            await conn.execute(
                'select c."personaId", c.credentials, t.credentials as app '
                'from "ChannelAccount" c '
                'join "TelegramApp" t on t."personaId" = c."personaId" '
                "where c.platform = 'TELEGRAM'"
            )
        ).fetchall()

    personas = []
    for row in rows:
        account = decrypt_credentials(row["credentials"])
        app = decrypt_credentials(row["app"])
        personas.append(
            {
                "personaId": row["personaId"],
                "phone": account.get("phone"),
                "apiId": int(app["apiId"]),
                "apiHash": app["apiHash"],
            }
        )
    return personas


def media_root():
    """
    Racine des médias, partagée avec le worker Node (section 5).

    Un chemin relatif est résolu **depuis la racine du dépôt**, pas depuis le
    répertoire courant: le worker Telegram démarre depuis `worker-telegram/`,
    et le `MEDIA_ROOT=./media` du .env — écrit pour le worker Node — y
    désignerait un dossier inexistant. TDLib ne dit alors qu'un laconique
    « Can't find real file path ».
    """
    import os
    from pathlib import Path

    from backdrop_telegram.config import REPO

    raw = os.environ.get("MEDIA_ROOT", "").strip() or "./media"
    path = Path(raw)
    return path.resolve() if path.is_absolute() else (REPO / path).resolve()


async def load_publication_plan(publication_id: str) -> dict[str, Any]:
    """
    Plan d'envoi d'une publication Telegram.

    Les chemins sont résolus ici, côté worker: le workflow ne transporte que
    des identifiants, et un chemin absolu dans son historique n'aurait aucun
    sens sur une autre machine.
    """
    async with await connect() as conn:
        row = await (
            await conn.execute(
                'select p.id, p.status, p.kind, p.copy, p."starPrice", '
                'p."dryRun", p."targetChatId", p."targetLabel", p."scheduledAt", '
                'c."personaId", c."scheduleToleranceMinutes" '
                'from "Publication" p '
                'join "ChannelAccount" c on c.id = p."channelAccountId" '
                "where p.id = %s and c.platform = 'TELEGRAM'",
                (publication_id,),
            )
        ).fetchone()

        if row is None:
            raise RuntimeError(f"Publication Telegram introuvable: {publication_id}")

        items = await (
            await conn.execute(
                'select v."localPath", a."mimeType", a.width, a.height '
                'from "PublicationItem" i '
                'join "Variant" v on v.id = i."variantId" '
                'join "Asset" a on a.id = v."assetId" '
                'where i."publicationId" = %s order by i.position',
                (publication_id,),
            )
        ).fetchall()

    root = media_root()
    return {
        "publicationId": row["id"],
        "status": row["status"],
        "caption": row["copy"],
        "starPrice": row["starPrice"],
        "dryRun": bool(row["dryRun"]),
        "chatId": row["targetChatId"],
        "targetLabel": row["targetLabel"],
        "personaId": row["personaId"],
        "scheduledAt": row["scheduledAt"].isoformat(),
        "toleranceMinutes": row["scheduleToleranceMinutes"],
        "media": [
            {
                "path": str(root / item["localPath"]),
                # Le type MIME fait foi: l'Asset ne porte pas de drapeau vidéo,
                # et se fier à l'extension du fichier serait fragile.
                "isVideo": (item["mimeType"] or "").startswith("video/"),
                "width": item["width"],
                "height": item["height"],
            }
            for item in items
        ],
    }


async def mark_publication_published(publication_id: str, remote_id: str) -> None:
    async with await connect() as conn:
        await conn.execute(
            'update "Publication" set status = \'PUBLISHED\', "remoteId" = %s, '
            '"publishedAt" = %s, "updatedAt" = %s where id = %s',
            (remote_id, datetime.now(timezone.utc), datetime.now(timezone.utc), publication_id),
        )


async def mark_publication_failed(publication_id: str, reason: str) -> None:
    async with await connect() as conn:
        await conn.execute(
            'update "Publication" set status = \'FAILED\', "failureReason" = %s, '
            '"updatedAt" = %s where id = %s',
            (reason[:500], datetime.now(timezone.utc), publication_id),
        )


async def mark_publication_dry_run(publication_id: str) -> None:
    """
    Clôt une simulation.

    État distinct de PUBLISHED, `remoteId` laissé nul: confondre une simulation
    avec un envoi réel dans la liste des publications serait la pire ambiguïté
    que cet écran puisse produire.
    """
    async with await connect() as conn:
        await conn.execute(
            'update "Publication" set status = \'DRY_RUN\', "remoteId" = null, '
            '"publishedAt" = null, "updatedAt" = %s where id = %s',
            (datetime.now(timezone.utc), publication_id),
        )
