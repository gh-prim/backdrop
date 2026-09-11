"""
Worker Telegram — allumé en permanence (spec 7.3).

Il fait deux choses simultanément, et c'est voulu:

  * il sert la task queue Temporal, pour le login et les publications;
  * il tient un client TDLib ouvert **par persona connectée**, en écoute
    continue des messages entrants.

Le second point impose le premier: un handler d'inbox n'a de sens que s'il ne
s'arrête jamais. Ouvrir un client le temps d'une opération puis le refermer
ferait manquer tout ce qui arrive entre-temps, et obligerait TDLib à rattraper
l'historique à chaque réouverture.

Ne jamais répliquer ce worker: deux processus sur le même répertoire TDLib se
disputeraient le verrou de sa base.

    uv run --no-project python -m backdrop_telegram.worker
"""

from __future__ import annotations

import asyncio
import logging

from aiotdlib.api import API
from temporalio.client import Client
from temporalio.worker import Worker

from backdrop_telegram import (
    config,
    db,
    disconnect_activities,
    dm_activities,
    inbox,
    login_activities,
    publish_activities,
    targets_activities,
)
from backdrop_telegram.tdlib import gateway, pool
from backdrop_telegram.workflows import (
    PublishTelegram,
    SendTelegramMessage,
    TelegramDisconnect,
    TelegramLogin,
    TelegramTargets,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


async def open_connected_personas() -> None:
    """
    Remet à l'écoute toutes les personas déjà connectées.

    Tolérant par persona: une base illisible ou un compte déconnecté côté
    Telegram ne doit pas empêcher les autres de démarrer. L'échec est
    journalisé, et l'opérateur reconnecte depuis l'application.
    """
    try:
        personas = await db.list_telegram_personas()
    except Exception as error:  # noqa: BLE001 — base injoignable au démarrage
        logger.error("impossible de lister les personas Telegram: %s", error)
        return

    for entry in personas:
        persona_id = entry["personaId"]
        if not entry.get("phone"):
            logger.warning(
                "persona %s sans numéro enregistré: à reconnecter", persona_id
            )
            continue
        try:
            client = await pool.open(
                persona_id=persona_id,
                api_id=entry["apiId"],
                api_hash=entry["apiHash"],
                phone=entry["phone"],
            )
        except Exception as error:  # noqa: BLE001
            logger.error("persona %s non rouverte: %s", persona_id, error)
            continue

        # Les fils créés avant qu'on sache résoudre un interlocuteur restent
        # anonymes jusqu'à ce que quelqu'un y écrive. Sur un fil qui dort,
        # cela veut dire jamais: on les nomme au démarrage.
        try:
            await inbox.enrich_names(client)
        except Exception as error:  # noqa: BLE001 — un nom n'est pas une panne
            logger.warning("noms non complétés pour %s: %s", persona_id, error)


async def main() -> None:
    config.load_dotenv()
    gateway.configure()
    # Cinq updates, pas une. L'arrivée d'un message ne suffit pas à tenir un
    # fil juste: il faut aussi le passage de l'identifiant temporaire au
    # définitif, les corrections, les effacements et les réactions.
    for update_type, handler in (
        (API.Types.UPDATE_NEW_MESSAGE, inbox.on_message),
        (API.Types.UPDATE_MESSAGE_SEND_SUCCEEDED, inbox.on_send_succeeded),
        (API.Types.UPDATE_MESSAGE_CONTENT, inbox.on_message_edited),
        (API.Types.UPDATE_DELETE_MESSAGES, inbox.on_messages_deleted),
        (API.Types.UPDATE_MESSAGE_REACTIONS, inbox.on_reactions),
    ):
        pool.on_update(update_type, handler)

    client = await Client.connect(
        config.temporal_address(), namespace=config.temporal_namespace()
    )

    worker = Worker(
        client,
        task_queue=config.TASK_QUEUE,
        workflows=[
            TelegramLogin,
            TelegramDisconnect,
            TelegramTargets,
            PublishTelegram,
            SendTelegramMessage,
        ],
        activities=[
            login_activities.request_login_code,
            login_activities.submit_login_code,
            login_activities.submit_login_password,
            login_activities.abandon_login,
            disconnect_activities.disconnect_telegram,
            targets_activities.list_telegram_targets,
            publish_activities.send_telegram_publication,
            publish_activities.load_telegram_publication,
            publish_activities.mark_telegram_published,
            publish_activities.mark_telegram_dry_run,
            publish_activities.mark_telegram_failed,
            dm_activities.send_telegram_message,
        ],
        max_concurrent_activities=8,
    )

    await open_connected_personas()
    logger.info("worker Telegram démarré sur la queue %s", config.TASK_QUEUE)

    try:
        await worker.run()
    finally:
        # TDLib doit écrire sa base avant que le processus ne disparaisse.
        logger.info("fermeture des clients Telegram")
        await pool.close_all()
        # La boucle de réception appartient au processus, pas aux clients:
        # c'est ici, et seulement ici, qu'elle s'arrête.
        gateway.stop_shared()


if __name__ == "__main__":
    asyncio.run(main())
