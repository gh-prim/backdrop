"""
Réception des messages entrants (inbox centralisée).

Le handler est branché sur le pool, donc sur toute persona déjà connectée
comme sur celles qui le seront ensuite. Il tourne dans le worker, qui reste
allumé en permanence: un handler n'a de sens que s'il ne s'arrête jamais.

Pour l'instant il journalise. La réponse automatique et la persistance en base
viendront avec la fonctionnalité d'inbox proprement dite.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


async def on_message(client: Any, update: Any) -> None:
    message = getattr(update, "message", None)
    if message is None:
        return

    # Ne pas réagir à ses propres envois: le worker les reçoit aussi, et une
    # réponse automatique qui se déclenche sur sa propre sortie boucle.
    if getattr(message, "is_outgoing", False):
        return

    content = getattr(message, "content", None)
    text = getattr(getattr(content, "text", None), "text", None)
    sender = getattr(getattr(message, "sender_id", None), "user_id", None)

    logger.info(
        "message entrant persona=%s chat=%s de=%s: %s",
        client.persona_id,
        getattr(message, "chat_id", None),
        sender,
        (text or "<sans texte>")[:120],
    )
