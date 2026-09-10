"""
Activités du login Telegram (4.2.1), sur TDLib.

TDLib conduit tout l'échange depuis `start()`: elle demande le code quand elle
en a besoin, puis le mot de passe si le compte est protégé. Elle ne rend la
main qu'une fois autorisée. Or l'application, elle, a besoin de reprendre la
main entre chaque étape pour afficher un champ et attendre l'opérateur.

D'où ce découpage: `start()` tourne dans une tâche de fond, et ses demandes de
saisie sont branchées sur des `Future`. Chaque activité pousse une saisie puis
rend la main dès que TDLib réclame la suivante — ou que la connexion aboutit.
La structure du workflow est ainsi restée celle d'Hydrogram, alors que la
bibliothèque en dessous a entièrement changé.

Le registre en mémoire n'est correct que parce que ce worker est un singleton
(7.3) — la contrainte qui interdit de le répliquer est ce qui rend les logins
en attente atteignables d'une activité à l'autre. Un redémarrage les perd, et
c'est assumé: un login inachevé se recommence.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any, Optional

from temporalio import activity
from temporalio.exceptions import ApplicationError

from backdrop_telegram import db, fingerprint
from backdrop_telegram.tdlib import LoginAbandoned, PersonaTelegram, pool

# Marque les messages écrits pour être lus par l'opérateur. Tout ce qui n'en
# porte pas la marque reste dans les logs: Temporal convertit n'importe quelle
# exception en ApplicationError, et le texte d'une erreur d'infrastructure
# contient volontiers une chaîne de connexion avec son mot de passe.
OPERATOR_ERROR = "operator"

# Temps laissé à TDLib pour joindre Telegram et réclamer la saisie suivante.
STEP_TIMEOUT = 90


@dataclass
class Pending:
    client: PersonaTelegram
    persona_id: str
    phone: str
    task: Optional[asyncio.Task] = None
    code: asyncio.Future = field(default_factory=asyncio.Future)
    password: asyncio.Future = field(default_factory=asyncio.Future)
    code_wanted: asyncio.Future = field(default_factory=asyncio.Future)
    password_wanted: asyncio.Future = field(default_factory=asyncio.Future)
    code_type: str = "app"


_pending: dict[str, Pending] = {}
_lock = asyncio.Lock()


def _fail(message: str, *, retryable: bool = False) -> ApplicationError:
    """
    Une erreur de login est presque toujours définitive: un code faux ne
    devient pas juste en réessayant, et chaque tentative consomme un envoi
    Telegram.
    """
    return ApplicationError(message, type=OPERATOR_ERROR, non_retryable=not retryable)


def _resolve(future: asyncio.Future, value: Any = True) -> None:
    if not future.done():
        future.set_result(value)


async def _drop(login_id: str) -> None:
    async with _lock:
        pending = _pending.pop(login_id, None)
    if pending is None:
        return

    if pending.task is not None and not pending.task.done():
        pending.task.cancel()
    try:
        await pending.client.close()
    except Exception:  # noqa: BLE001 — un client déjà tombé n'a rien à signaler
        pass


async def _race(pending: Pending, wanted: asyncio.Future) -> str:
    """
    Attend soit la demande de saisie suivante, soit la fin de la connexion.

    Sans cette course, une connexion qui aboutit sans demander de mot de passe
    resterait bloquée à attendre une saisie qui ne viendra jamais.
    """
    assert pending.task is not None
    done, _ = await asyncio.wait(
        {wanted, pending.task},
        timeout=STEP_TIMEOUT,
        return_when=asyncio.FIRST_COMPLETED,
    )
    if not done:
        raise _fail("Telegram n'a pas répondu dans le temps imparti.")

    if pending.task in done:
        # La tâche porte l'erreur éventuelle: la relire la fait remonter ici.
        error = pending.task.exception()
        if error is not None:
            raise _translate(error)
        return "connected"
    return "wanted"


def _translate(error: BaseException) -> ApplicationError:
    """Traduit une erreur TDLib en message lisible, sans rien laisser fuir."""
    text = str(error)
    if isinstance(error, LoginAbandoned):
        return _fail(text)
    if "PHONE_CODE_INVALID" in text:
        return _fail("Code incorrect.")
    if "PHONE_CODE_EXPIRED" in text:
        return _fail("Code expiré. Recommencer la connexion.")
    if "PASSWORD_HASH_INVALID" in text:
        return _fail("Mot de passe refusé.")
    if "PHONE_NUMBER_INVALID" in text:
        return _fail("Numéro refusé par Telegram.")
    if "FLOOD_WAIT" in text:
        return _fail("Telegram impose une attente avant un nouvel envoi.")
    activity.logger.exception("échec de login non traduit")
    return _fail("Connexion refusée par Telegram. Voir les logs du worker.")


@activity.defn(name="requestLoginCode")
async def request_login_code(input: dict[str, Any]) -> dict[str, Any]:
    login_id = input["loginId"]
    persona_id = input["personaId"]
    phone = input["phone"]

    try:
        credentials = await db.load_telegram_app(persona_id)
    except RuntimeError as error:
        raise _fail(str(error)) from error
    except Exception as error:  # noqa: BLE001 — base injoignable, données illisibles
        activity.logger.exception("accès base impossible au démarrage du login")
        raise _fail("Cannot reach the database. Check the Telegram worker logs.") from error

    # Une persona déjà ouverte détient le verrou de son répertoire TDLib: la
    # reconnecter sans fermer d'abord échouerait sur la base elle-même.
    await pool.close(persona_id)
    await _drop(login_id)

    client = PersonaTelegram(
        persona_id=persona_id,
        api_id=int(credentials["apiId"]),
        api_hash=credentials["apiHash"],
        phone=phone,
    )
    pending = Pending(client=client, persona_id=persona_id, phone=phone)

    async def code_provider(code_type: str) -> str:
        pending.code_type = code_type
        _resolve(pending.code_wanted)
        return await pending.code

    async def password_provider() -> str:
        _resolve(pending.password_wanted)
        return await pending.password

    pending.task = asyncio.create_task(
        client.start(code_provider=code_provider, password_provider=password_provider)
    )
    async with _lock:
        _pending[login_id] = pending

    outcome = await _race(pending, pending.code_wanted)
    if outcome == "connected":
        # Base déjà autorisée: aucune saisie n'a été demandée.
        return await _finish(login_id, pending)

    activity.logger.info("code demandé", extra={"loginId": login_id})
    # Uniquement des primitives: Temporal sérialise le retour en JSON, et un
    # objet de bibliothèque y échoue **après** l'envoi du code — le pire
    # moment, puisque l'échec détruit la session en attente.
    return {"state": "awaiting_code", "sentTo": str(pending.code_type)}


@activity.defn(name="submitLoginCode")
async def submit_login_code(input: dict[str, Any]) -> dict[str, Any]:
    login_id = input["loginId"]

    async with _lock:
        pending = _pending.get(login_id)
    if pending is None:
        raise _fail(
            "Session de login expirée: le worker a redémarré. Recommencer la connexion."
        )

    _resolve(pending.code, input["code"])

    outcome = await _race(pending, pending.password_wanted)
    if outcome == "connected":
        return await _finish(login_id, pending)

    # Vérification en deux étapes: le client reste vivant, le registre valide.
    return {"state": "password_needed"}


@activity.defn(name="submitLoginPassword")
async def submit_login_password(input: dict[str, Any]) -> dict[str, Any]:
    login_id = input["loginId"]

    async with _lock:
        pending = _pending.get(login_id)
    if pending is None:
        raise _fail(
            "Session de login expirée: le worker a redémarré. Recommencer la connexion."
        )

    _resolve(pending.password, input["password"])

    assert pending.task is not None
    done, _ = await asyncio.wait({pending.task}, timeout=STEP_TIMEOUT)
    if not done:
        raise _fail("Telegram n'a pas répondu dans le temps imparti.")
    error = pending.task.exception()
    if error is not None:
        raise _translate(error)

    return await _finish(login_id, pending)


async def _finish(login_id: str, pending: Pending) -> dict[str, Any]:
    """Enregistre le compte, place le client dans le pool, libère le registre."""
    account = await pending.client.me()

    channel_account_id = await db.save_telegram_account(
        persona_id=pending.persona_id,
        telegram_user_id=account.user_id,
        payload={
            # Pas de session ici: avec TDLib le secret est le répertoire
            # chiffré sur disque. Ce qui est stocké sert à le rouvrir.
            "phone": pending.phone,
            "userId": account.user_id,
            "username": account.username,
            **fingerprint.current(),
        },
    )

    # Le client rejoint le pool plutôt que d'être fermé: il doit rester à
    # l'écoute des messages entrants dès la connexion terminée.
    await pool.adopt(pending.persona_id, pending.client)

    async with _lock:
        _pending.pop(login_id, None)

    return {
        "state": "connected",
        "channelAccountId": channel_account_id,
        "username": account.username,
        "firstName": account.first_name,
        "telegramUserId": account.user_id,
    }


@activity.defn(name="abandonLogin")
async def abandon_login(input: dict[str, Any]) -> None:
    """
    Libère un login inachevé. Appelé sur **toutes** les sorties du workflow,
    y compris l'abandon et l'expiration: un client TDLib laissé ouvert garde
    le verrou du répertoire de la persona, qui ne pourrait plus se reconnecter.
    """
    await _drop(input["loginId"])
