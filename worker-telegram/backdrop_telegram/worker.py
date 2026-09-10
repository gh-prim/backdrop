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

from temporalio.client import Client
from temporalio.worker import Worker

from backdrop_telegram import config, db, inbox, login_activities
from backdrop_telegram.tdlib import gateway, pool
from backdrop_telegram.workflows import TelegramLogin

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
            await pool.open(
                persona_id=persona_id,
                api_id=entry["apiId"],
                api_hash=entry["apiHash"],
                phone=entry["phone"],
            )
        except Exception as error:  # noqa: BLE001
            logger.error("persona %s non rouverte: %s", persona_id, error)


async def main() -> None:
    config.load_dotenv()
    gateway.configure()
    pool.on_message(inbox.on_message)

    client = await Client.connect(
        config.temporal_address(), namespace=config.temporal_namespace()
    )

    worker = Worker(
        client,
        task_queue=config.TASK_QUEUE,
        workflows=[TelegramLogin],
        activities=[
            login_activities.request_login_code,
            login_activities.submit_login_code,
            login_activities.submit_login_password,
            login_activities.abandon_login,
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


if __name__ == "__main__":
    asyncio.run(main())
