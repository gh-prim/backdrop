"""
Worker Telegram — singleton par nécessité (spec 7.3).

Deux processus partageant une même session MTProto déclenchent
`AUTH_KEY_DUPLICATED` et **détruisent la session** (4.2.2). Ce worker ne doit
donc jamais être répliqué: `replicas: 1` est une contrainte de correction, pas
un réglage de performance.

    uv run --no-project python -m backdrop_telegram.worker
"""

from __future__ import annotations

import asyncio
import logging

from temporalio.client import Client
from temporalio.worker import Worker

from backdrop_telegram import config, login_activities
from backdrop_telegram.workflows import TelegramLogin

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


async def main() -> None:
    config.load_dotenv()

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
        # Le registre des logins en attente vit dans ce process. Rien ici ne
        # doit tourner ailleurs.
        max_concurrent_activities=8,
    )

    logging.info("worker Telegram démarré sur la queue %s", config.TASK_QUEUE)
    await worker.run()


if __name__ == "__main__":
    asyncio.run(main())
