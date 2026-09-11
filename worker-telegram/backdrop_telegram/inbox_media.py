"""
Rapatriement des médias reçus.

TDLib ne donne pas d'octets mais un pointeur: un fichier reçu doit être
téléchargé, puis **copié** sur le volume média que sert l'application. On copie
plutôt qu'on ne déplace — le répertoire de TDLib est sa base de travail, et lui
retirer un fichier sous les pieds est le genre de chose qui se paie plus tard.

Deux règles tiennent ce module:

  * **Un plafond.** Le serveur a saturé ses 30 Go le 2026-09-11; une inbox qui
    aspire tout recommencerait, en silence et en continu. Au-delà du plafond on
    garde le pointeur: le fichier reste récupérable à la demande.

  * **Après le message, jamais avant.** Le fil doit apparaître à l'instant où
    le message arrive. Télécharger d'abord ferait attendre l'affichage le temps
    d'une vidéo.
"""

from __future__ import annotations

import asyncio
import logging
import shutil
from pathlib import Path
from typing import Any, Optional

from backdrop_telegram import inbox_store
from backdrop_telegram.db import connect, media_root

logger = logging.getLogger(__name__)

#: Sous-répertoire du volume média. Séparé des Variants: ces fichiers ne sont
#: pas à nous, ils ne sont pas classés, et ils ne partent jamais sur R2.
INBOX_DIR = "inbox"

#: TDLib prend son temps sur un fichier volumineux ou un réseau lent. Au-delà,
#: on abandonne ce média-là — le message, lui, est déjà affiché.
DOWNLOAD_TIMEOUT = 120

EXTENSIONS = {
    "PHOTO": ".jpg",
    "VIDEO": ".mp4",
    "VOICE": ".ogg",
    # Vide volontairement: un sticker est webp ou webm selon le cas, et
    # imposer une extension mentirait sur le contenu du fichier.
    "STICKER": "",
    "DOCUMENT": "",
}


async def fetch_later(
    client: Any, persona_id: str, conversation_id: str, items: list[dict[str, Any]]
) -> None:
    """
    Lance les téléchargements sans faire attendre l'ingestion.

    Détaché volontairement: le handler d'updates doit rendre la main tout de
    suite, sinon une vidéo reçue bloquerait la réception des messages suivants
    — pour toutes les personas, puisque le handler est partagé.
    """
    if not items:
        return
    asyncio.create_task(_fetch_all(client, persona_id, conversation_id, items))


async def _fetch_all(
    client: Any, persona_id: str, conversation_id: str, items: list[dict[str, Any]]
) -> None:
    changed = False
    for item in items:
        try:
            if await _fetch_one(client, persona_id, item):
                changed = True
        except Exception:  # noqa: BLE001 — un média manquant n'est pas une panne
            logger.exception("média non rapatrié (attachment=%s)", item.get("id"))

    # Une seconde notification: le message était déjà à l'écran sans son image,
    # et rien ne la ferait apparaître sans réveiller le navigateur.
    if changed:
        async with await connect() as conn:
            await inbox_store.notify(
                conn, persona_id=persona_id, conversation_id=conversation_id
            )


async def _fetch_one(client: Any, persona_id: str, item: dict[str, Any]) -> bool:
    file = item.get("file")
    if file is None:
        return False

    size = getattr(file, "size", None) or getattr(file, "expected_size", None) or 0
    if size and size > inbox_store.MAX_DOWNLOAD_BYTES:
        logger.info(
            "média de %.1f Mo laissé chez Telegram (plafond %.0f Mo)",
            size / 1_048_576,
            inbox_store.MAX_DOWNLOAD_BYTES / 1_048_576,
        )
        return False

    source = await _download(client, getattr(file, "id", None))
    if source is None:
        return False

    destination = _destination(persona_id, item["id"], item["kind"], source)
    destination.parent.mkdir(parents=True, exist_ok=True)
    # `copy2` et non `move`: le répertoire de TDLib est sa base de travail.
    shutil.copy2(source, destination)

    relative = destination.relative_to(media_root()).as_posix()
    async with await connect() as conn:
        await inbox_store.set_attachment_file(
            conn, attachment_id=item["id"], local_path=relative, thumb_path=None
        )
    return True


async def _download(client: Any, file_id: Optional[int]) -> Optional[Path]:
    if file_id is None:
        return None

    downloaded = await asyncio.wait_for(
        client.raw.api.download_file(
            file_id=int(file_id),
            priority=1,
            offset=0,
            limit=0,
            # Synchrone: on veut le chemin final, pas une progression à
            # suivre. L'attente est bornée juste au-dessus.
            synchronous=True,
        ),
        timeout=DOWNLOAD_TIMEOUT,
    )

    local = getattr(downloaded, "local", None)
    path = getattr(local, "path", None)
    if not path:
        return None

    candidate = Path(path)
    return candidate if candidate.exists() else None


def _destination(persona_id: str, attachment_id: str, kind: str, source: Path) -> Path:
    """
    Le chemin sur le volume, nommé par l'identifiant de la pièce jointe.

    Ni le nom d'origine ni rien de choisi par l'expéditeur: un nom de fichier
    venu d'ailleurs est une chaîne hostile, et `../` y a sa place aussi bien
    qu'autre chose.
    """
    suffix = EXTENSIONS.get(kind) or source.suffix or ".bin"
    return media_root() / INBOX_DIR / persona_id / f"{attachment_id}{suffix}"
