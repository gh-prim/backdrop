"""
Workflow de connexion Telegram (4.2.1).

L'application ne peut pas faire ce login elle-même: entre l'envoi du code et sa
validation, un client MTProto doit rester connecté dans un processus qui
survit à l'aller-retour. Un workflow Temporal est exactement cet objet — il
attend, il porte un état interrogeable, et il expire proprement.

L'interface avec le web reprend celle du workflow de publication: des signaux
pour transmettre le code puis le mot de passe, une requête pour que l'écran
suive l'avancement sans que rien de sensible ne traverse.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from temporalio import workflow
from temporalio.common import RetryPolicy
from temporalio.exceptions import ActivityError, ApplicationError

# Au-delà, le code Telegram est de toute façon périmé.
CODE_TIMEOUT = timedelta(minutes=10)

# Marque des messages écrits pour l'opérateur (voir login_activities).
OPERATOR_ERROR = "operator"
GENERIC_FAILURE = "Connection failed. Check the Telegram worker logs."

NO_RETRY = RetryPolicy(maximum_attempts=1)


@workflow.defn(name="telegramLogin")
class TelegramLogin:
    def __init__(self) -> None:
        self._state = "starting"
        self._detail: str | None = None
        self._result: dict[str, Any] | None = None
        self._code: str | None = None
        self._password: str | None = None

    @workflow.signal(name="submitCode")
    def submit_code(self, code: str) -> None:
        self._code = code

    @workflow.signal(name="submitPassword")
    def submit_password(self, password: str) -> None:
        self._password = password

    @workflow.query(name="loginState")
    def login_state(self) -> dict[str, Any]:
        # Ni code, ni mot de passe, ni session: une requête Temporal est lisible
        # par quiconque atteint le namespace.
        return {
            "state": self._state,
            "detail": self._detail,
            "account": self._result,
        }

    @workflow.run
    async def run(self, input: dict[str, Any]) -> dict[str, Any]:
        login_id = input["loginId"]

        try:
            return await self._login(input, login_id)
        finally:
            # Sur toutes les sorties, y compris l'expiration et l'annulation:
            # un client MTProto abandonné garde une socket et un slot de
            # session côté Telegram.
            await workflow.execute_activity(
                "abandonLogin",
                {"loginId": login_id},
                start_to_close_timeout=timedelta(seconds=30),
                retry_policy=NO_RETRY,
            )

    async def _login(self, input: dict[str, Any], login_id: str) -> dict[str, Any]:
        try:
            await workflow.execute_activity(
                "requestLoginCode",
                {
                    "loginId": login_id,
                    "personaId": input["personaId"],
                    "phone": input["phone"],
                },
                start_to_close_timeout=timedelta(seconds=90),
                retry_policy=NO_RETRY,
            )
        except ActivityError as error:
            return self._failed(error)

        self._state = "awaiting_code"

        outcome = await self._step(
            lambda: self._code is not None,
            "submitLoginCode",
            lambda: {"loginId": login_id, "code": self._code},
            "Aucun code saisi dans le temps imparti.",
        )
        if outcome is None or outcome["state"] != "password_needed":
            return outcome if outcome is not None else self._timed_out()

        # Vérification en deux étapes.
        self._state = "awaiting_password"
        outcome = await self._step(
            lambda: self._password is not None,
            "submitLoginPassword",
            lambda: {"loginId": login_id, "password": self._password},
            "Aucun mot de passe saisi dans le temps imparti.",
        )
        return outcome if outcome is not None else self._timed_out()

    async def _step(
        self,
        ready,
        activity_name: str,
        payload,
        timeout_message: str,
    ) -> dict[str, Any] | None:
        """Attend une saisie de l'opérateur, puis la soumet à Telegram."""
        while True:
            got_input = await workflow.wait_condition(ready, timeout=CODE_TIMEOUT)
            if not got_input:
                self._detail = timeout_message
                return None

            try:
                result = await workflow.execute_activity(
                    activity_name,
                    payload(),
                    start_to_close_timeout=timedelta(seconds=90),
                    retry_policy=NO_RETRY,
                )
            except ActivityError as error:
                message = _message(error)
                # Un code faux n'est pas la fin du login: on laisse l'opérateur
                # ressaisir plutôt que de le renvoyer au début, où Telegram lui
                # imposerait une nouvelle attente.
                if "Code incorrect" in message:
                    self._detail = message
                    self._code = None
                    continue
                return self._failed(error)

            if result["state"] == "connected":
                self._state = "connected"
                self._detail = None
                self._result = result
            return result

    def _failed(self, error: BaseException) -> dict[str, Any]:
        self._state = "failed"
        self._detail = _message(error)
        return {"state": "failed", "detail": self._detail}

    def _timed_out(self) -> dict[str, Any]:
        self._state = "failed"
        return {"state": "failed", "detail": self._detail}


def _message(error: BaseException) -> str:
    """
    Message destiné à l'écran de l'opérateur.

    Ne laisse passer que ce qui a été écrit pour lui. Temporal convertit toute
    exception en ApplicationError, si bien qu'un `str(error)` renverrait
    volontiers le texte d'une erreur d'infrastructure — chaîne de connexion et
    mot de passe compris — jusque dans le navigateur.
    """
    cause = getattr(error, "cause", None)
    if isinstance(cause, ApplicationError) and cause.type == OPERATOR_ERROR:
        return cause.message or GENERIC_FAILURE
    return GENERIC_FAILURE
