"""
Client Telegram d'une persona.

Surface volontairement étroite: se connecter, savoir qui on est, envoyer, et
réagir à ce qui arrive. Tout le reste d'aiotdlib reste accessible via
`.raw`, mais rien d'applicatif ne doit en dépendre — c'est ce qui nous
permettra de changer de socle une seconde fois sans tout réécrire, ce que la
matinée du 2026-09-10 a montré nécessaire.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Optional

from aiotdlib import Client as AioClient
from aiotdlib.api import API
from aiotdlib.client_settings import ClientSettings

from backdrop_telegram import fingerprint
from backdrop_telegram.tdlib import gateway, sessions

logger = logging.getLogger(__name__)

CodeProvider = Callable[[str], Awaitable[str]]
PasswordProvider = Callable[[], Awaitable[str]]
MessageHandler = Callable[["PersonaTelegram", Any], Awaitable[None]]

# Connexion interactive: au-delà, l'opérateur a abandonné et le code Telegram
# a de toute façon expiré.
LOGIN_TIMEOUT = 600

# Reprise d'une base déjà autorisée: aucune saisie n'est attendue, donc une
# lenteur n'est pas de la patience mais une panne. Le cas typique est une base
# illisible — clé de chiffrement changée — que TDLib ne signale pas: il
# redemande la clé et attend indéfiniment.
RESUME_TIMEOUT = 60


class LoginAbandoned(RuntimeError):
    """Aucune saisie n'est venue dans le temps imparti."""


@dataclass(frozen=True)
class Account:
    user_id: int
    first_name: str
    username: Optional[str]


class _AuthClient(AioClient):
    """
    Redirige les deux seules étapes qui réclamaient le clavier.

    aiotdlib appelle `input()` en dur; ces méthodes sont les points de reprise
    prévus par sa conception, et les surcharger est moins fragile que de
    détourner l'entrée standard.
    """

    code_provider: Optional[CodeProvider] = None
    password_provider: Optional[PasswordProvider] = None

    async def _auth_get_code(self, *, code_type: str = "SMS") -> str:
        if self.code_provider is None:
            raise LoginAbandoned("Aucune source de code fournie.")
        return await self.code_provider(code_type)

    async def _auth_get_password(self) -> str:
        if self.password_provider is None:
            raise LoginAbandoned("Aucune source de mot de passe fournie.")
        return await self.password_provider()


class PersonaTelegram:
    def __init__(
        self,
        *,
        persona_id: str,
        api_id: int,
        api_hash: str,
        phone: str,
    ) -> None:
        gateway.install_shared_receiver()

        # aiotdlib refuse un client sans numéro, y compris pour rouvrir une
        # base déjà autorisée: il est donc conservé à la connexion et relu ici.
        if not phone:
            raise ValueError(
                "Numéro requis: aiotdlib le réclame même pour une simple reprise."
            )

        directory = sessions.session_directory(persona_id)
        self.persona_id = persona_id
        self.raw = _AuthClient(
            ClientSettings(
                api_id=api_id,
                api_hash=api_hash,
                phone_number=phone,
                files_directory=directory,
                database_encryption_key=sessions.database_encryption_key(persona_id),
                # Empreinte figée (4.2.3): jamais les valeurs par défaut
                # d'aiotdlib, qui annoncent son propre nom et dérivent à chaque
                # version — ce que Telegram lit comme un changement d'appareil.
                device_model=fingerprint.DEVICE_MODEL,
                system_version=fingerprint.SYSTEM_VERSION,
                application_version=fingerprint.APP_VERSION,
                use_secret_chats=False,
            )
        )
        self._closed = False

    # --- cycle de vie ----------------------------------------------------

    async def start(
        self,
        *,
        code_provider: Optional[CodeProvider] = None,
        password_provider: Optional[PasswordProvider] = None,
        timeout: Optional[int] = None,
    ) -> Account:
        """
        Démarre le client. S'il faut se connecter, les fournisseurs sont
        appelés; s'il existe déjà une base autorisée, ils ne le sont jamais.
        """
        self.raw.code_provider = code_provider
        self.raw.password_provider = password_provider

        if timeout is None:
            interactive = code_provider is not None
            timeout = LOGIN_TIMEOUT if interactive else RESUME_TIMEOUT

        try:
            await asyncio.wait_for(self.raw.start(), timeout=timeout)
        except asyncio.TimeoutError as error:
            await self.close()
            raise LoginAbandoned(
                "Connexion non terminée dans le temps imparti."
                if code_provider is not None
                else "Base TDLib illisible ou compte non autorisé: reconnecter la persona."
            ) from error
        return await self.me()

    async def close(self) -> None:
        """
        Ferme proprement: TDLib doit recevoir `close` et écrire sa base avant
        que le processus ne disparaisse. Une sortie brutale renvoie SIGABRT et
        laisse la base dans un état douteux — donc, au pire, une persona à
        reconnecter à la main.
        """
        if self._closed:
            return
        self._closed = True

        closed = asyncio.get_running_loop().create_future()

        async def on_state(_client, update) -> None:
            state = getattr(update, "authorization_state", None)
            if state is not None and state.ID == API.Types.AUTHORIZATION_STATE_CLOSED:
                if not closed.done():
                    closed.set_result(True)

        self.raw.add_event_handler(on_state, API.Types.UPDATE_AUTHORIZATION_STATE)

        try:
            await self.raw.api.close()
            await asyncio.wait_for(closed, timeout=15)
        except Exception as error:  # noqa: BLE001 — la fermeture ne doit jamais lever
            logger.warning("fermeture TDLib imparfaite: %s", error)
        finally:
            await self.raw.stop()

    async def __aenter__(self) -> "PersonaTelegram":
        await self.start()
        return self

    async def __aexit__(self, *_exc) -> None:
        await self.close()

    # --- usage courant ---------------------------------------------------

    async def me(self) -> Account:
        user = await self.raw.api.get_me()
        usernames = getattr(user, "usernames", None)
        return Account(
            user_id=user.id,
            first_name=user.first_name,
            username=getattr(usernames, "editable_username", None) if usernames else None,
        )

    async def send_text(self, chat_id: int, text: str) -> Any:
        return await self.raw.send_text(chat_id=chat_id, text=text)

    def on_message(self, handler: MessageHandler):
        """
        Branche un handler sur les messages entrants.

        C'est la base de l'inbox centralisée: TDLib tient sa propre base locale
        et rattrape les trous d'updates, là où du MTProto brut obligerait à
        gérer soi-même les séquences `pts`/`qts` — du code qu'on croit juste
        pendant des mois avant de découvrir qu'il perd des messages.

        Le handler reçoit **cet objet**, pas le client aiotdlib sous-jacent:
        sans quoi il n'aurait aucun moyen de savoir de quelle persona vient le
        message, et devrait redescendre dans une API dont toute cette couche
        existe précisément pour l'isoler.
        """

        async def bridge(_raw, update) -> None:
            await handler(self, update)

        return self.raw.add_event_handler(bridge, API.Types.UPDATE_NEW_MESSAGE)
