"""
Pool des clients Telegram: un par persona, ouvert en permanence.

Un client n'est **pas** ouvert puis refermé autour de chaque publication. Il
est ouvert au démarrage du worker et le reste, pour deux raisons qui vont dans
le même sens:

  * l'inbox suppose une écoute continue — un client fermé ne reçoit rien, et
    TDLib devrait rattraper tout l'historique manqué à chaque réouverture;
  * ouvrir et fermer une session MTProto a un coût réel côté Telegram, et une
    réouverture répétée ressemble de près à ce que ses garde-fous surveillent.

Il ne faut **pas** non plus séparer un client d'écriture d'un client d'écoute.
Sur le même répertoire, ils se disputeraient le verrou de la base; sur deux
répertoires, ce seraient deux sessions distinctes du même compte, avec deux
logins à faire et deux fois tout à maintenir. TDLib n'en a pas besoin: elle
tient son propre pool de threads et n'expose qu'une file d'événements, si bien
qu'émettre et recevoir sur un même client est l'usage nominal.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Optional

from backdrop_telegram.tdlib.client import MessageHandler, PersonaTelegram

logger = logging.getLogger(__name__)


class PersonaPool:
    def __init__(self) -> None:
        self._clients: dict[str, PersonaTelegram] = {}
        self._lock = asyncio.Lock()
        self._on_message: Optional[MessageHandler] = None

    def on_message(self, handler: MessageHandler) -> None:
        """
        Handler appliqué à toute persona du pool, présente ou future.

        Enregistré ici plutôt que sur chaque client: une persona connectée
        après le démarrage doit être écoutée sans que personne n'y pense.
        """
        self._on_message = handler
        for client in self._clients.values():
            client.on_message(handler)

    async def open(
        self,
        *,
        persona_id: str,
        api_id: int,
        api_hash: str,
        phone: str,
        **start_kwargs,
    ) -> PersonaTelegram:
        """Ouvre le client d'une persona, ou rend celui déjà ouvert."""
        async with self._lock:
            existing = self._clients.get(persona_id)
            if existing is not None:
                return existing

            client = PersonaTelegram(
                persona_id=persona_id, api_id=api_id, api_hash=api_hash, phone=phone
            )
            account = await client.start(**start_kwargs)
            if self._on_message is not None:
                client.on_message(self._on_message)

            self._clients[persona_id] = client
            logger.info(
                "persona %s connectée: %s (id %s)",
                persona_id,
                account.first_name,
                account.user_id,
            )
            return client

    def get(self, persona_id: str) -> Optional[PersonaTelegram]:
        return self._clients.get(persona_id)

    def require(self, persona_id: str) -> PersonaTelegram:
        client = self._clients.get(persona_id)
        if client is None:
            raise RuntimeError(
                f"Persona {persona_id} non connectée à Telegram sur ce worker."
            )
        return client

    async def close(self, persona_id: str) -> None:
        async with self._lock:
            client = self._clients.pop(persona_id, None)
        if client is not None:
            await client.close()

    async def close_all(self) -> None:
        """
        Arrêt du worker. Séquentiel et tolérant: une persona qui se ferme mal
        ne doit pas empêcher les suivantes d'écrire leur base sur disque.
        """
        async with self._lock:
            clients = list(self._clients.items())
            self._clients.clear()

        for persona_id, client in clients:
            try:
                await client.close()
            except Exception as error:  # noqa: BLE001
                logger.warning("fermeture de %s imparfaite: %s", persona_id, error)


pool = PersonaPool()
