"""
Activités du login Telegram (4.2.1).

MTProto impose une contrainte que rien ne contourne: entre l'envoi du code et
sa validation, **le même client connecté** doit rester en vie. Le
`phone_code_hash` est lié à la clé d'authentification négociée à la connexion;
se déconnecter en négocie une nouvelle et invalide le code.

D'où ce registre en mémoire. Il n'est correct que parce que le worker Telegram
est un singleton (7.3) — la même contrainte qui interdit de répliquer ce worker
est ce qui rend le registre atteignable par les deux activités.

Un redémarrage du worker vide le registre. C'est assumé: le login échoue alors
avec un message clair et l'opérateur recommence. Faire survivre un client
MTProto à un redémarrage n'a pas de sens.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any

from hydrogram import Client
from hydrogram.errors import (
    FloodWait,
    PhoneCodeExpired,
    PhoneCodeInvalid,
    PhoneNumberInvalid,
    SessionPasswordNeeded,
)
from temporalio import activity
from temporalio.exceptions import ApplicationError

from backdrop_telegram import db, fingerprint


@dataclass
class Pending:
    client: Client
    phone: str
    phone_code_hash: str
    persona_id: str


_pending: dict[str, Pending] = {}
_lock = asyncio.Lock()


def _fail(message: str, *, retryable: bool = False) -> ApplicationError:
    """
    Une erreur de login est presque toujours définitive: un code faux ne
    devient pas juste en réessayant, et chaque tentative consomme un envoi
    Telegram. On le dit explicitement à Temporal.
    """
    return ApplicationError(message, non_retryable=not retryable)


async def _drop(login_id: str) -> None:
    async with _lock:
        pending = _pending.pop(login_id, None)
    if pending is not None:
        try:
            await pending.client.disconnect()
        except Exception:  # noqa: BLE001 — un client déjà tombé n'a rien à signaler
            pass


@activity.defn(name="requestLoginCode")
async def request_login_code(input: dict[str, Any]) -> dict[str, Any]:
    login_id = input["loginId"]
    persona_id = input["personaId"]
    phone = input["phone"]

    app_credentials = await db.load_telegram_app(persona_id)

    marks = fingerprint.current()
    client = Client(
        name=f"backdrop-login-{login_id}",
        api_id=int(app_credentials["apiId"]),
        api_hash=app_credentials["apiHash"],
        device_model=marks["deviceModel"],
        system_version=marks["systemVersion"],
        app_version=marks["appVersion"],
        in_memory=True,
    )

    await client.connect()
    try:
        sent = await client.send_code(phone)
    except PhoneNumberInvalid as error:
        await client.disconnect()
        raise _fail(f"Numéro refusé par Telegram: {error}") from error
    except FloodWait as error:
        await client.disconnect()
        raise _fail(
            f"Telegram impose une attente de {error.value} secondes avant un nouvel envoi."
        ) from error

    async with _lock:
        _pending[login_id] = Pending(
            client=client,
            phone=phone,
            phone_code_hash=sent.phone_code_hash,
            persona_id=persona_id,
        )

    activity.logger.info("code envoyé", extra={"loginId": login_id})
    return {"sentTo": sent.type.value if hasattr(sent.type, "value") else str(sent.type)}


@activity.defn(name="submitLoginCode")
async def submit_login_code(input: dict[str, Any]) -> dict[str, Any]:
    login_id = input["loginId"]
    code = input["code"]

    async with _lock:
        pending = _pending.get(login_id)
    if pending is None:
        raise _fail(
            "Session de login expirée: le worker a redémarré. Recommencer la connexion."
        )

    try:
        await pending.client.sign_in(pending.phone, pending.phone_code_hash, code)
    except SessionPasswordNeeded:
        # Vérification en deux étapes: le compte est protégé, on demande le
        # mot de passe. Le client reste connecté, donc le registre reste valide.
        return {"state": "password_needed"}
    except PhoneCodeInvalid as error:
        raise _fail("Code incorrect.") from error
    except PhoneCodeExpired as error:
        raise _fail("Code expiré. Recommencer la connexion.") from error

    return await _finish(login_id, pending)


@activity.defn(name="submitLoginPassword")
async def submit_login_password(input: dict[str, Any]) -> dict[str, Any]:
    login_id = input["loginId"]

    async with _lock:
        pending = _pending.get(login_id)
    if pending is None:
        raise _fail(
            "Session de login expirée: le worker a redémarré. Recommencer la connexion."
        )

    try:
        await pending.client.check_password(input["password"])
    except Exception as error:  # noqa: BLE001 — Hydrogram varie selon la cause
        raise _fail(f"Mot de passe refusé: {type(error).__name__}") from error

    return await _finish(login_id, pending)


async def _finish(login_id: str, pending: Pending) -> dict[str, Any]:
    """Exporte la session, l'enregistre chiffrée, et libère le client."""
    me = await pending.client.get_me()
    session = await pending.client.export_session_string()

    payload = {
        "session": session,
        "userId": me.id,
        "username": me.username,
        "phone": pending.phone,
        **fingerprint.current(),
    }
    channel_account_id = await db.save_session(
        persona_id=pending.persona_id, telegram_user_id=me.id, payload=payload
    )

    await _drop(login_id)

    # Rien de sensible ne remonte: le résultat d'une activité est conservé dans
    # l'historique Temporal (7.2). La session est déjà en base, chiffrée.
    return {
        "state": "connected",
        "channelAccountId": channel_account_id,
        "username": me.username,
        "firstName": me.first_name,
        "telegramUserId": me.id,
    }


@activity.defn(name="abandonLogin")
async def abandon_login(input: dict[str, Any]) -> None:
    """
    Libère un login inachevé. Appelé sur **toutes** les sorties du workflow,
    y compris l'abandon et l'expiration: un client MTProto laissé connecté
    garde une socket ouverte et un slot de session côté Telegram.
    """
    await _drop(input["loginId"])
