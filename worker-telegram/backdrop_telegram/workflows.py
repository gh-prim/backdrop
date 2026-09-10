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

import asyncio
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
            started = await workflow.execute_activity(
                "requestLoginCode",
                {
                    "loginId": login_id,
                    "personaId": input["personaId"],
                    "phone": input["phone"],
                },
                start_to_close_timeout=timedelta(seconds=120),
                retry_policy=NO_RETRY,
            )
        except ActivityError as error:
            return self._failed(error)

        # Cas propre à TDLib, qui n'existait pas avec Hydrogram: quand la base
        # de la persona est déjà autorisée, la connexion aboutit sans qu'aucun
        # code ne soit demandé. Attendre une saisie ici laisserait l'opérateur
        # devant un champ vide, à guetter un code que Telegram n'enverra pas.
        if started.get("state") == "connected":
            self._state = "connected"
            self._result = started
            return started

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
            try:
                # `wait_condition` renvoie None quand la condition devient
                # vraie et **lève** TimeoutError à l'expiration. Tester sa
                # valeur de retour reviendrait à voir un dépassement de délai
                # dans tous les cas, y compris ceux qui réussissent — le code
                # saisi ne serait jamais soumis.
                await workflow.wait_condition(ready, timeout=CODE_TIMEOUT)
            except asyncio.TimeoutError:
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


@workflow.defn(name="telegramDisconnect")
class TelegramDisconnect:
    """
    Déconnexion d'une persona, déclenchée par la suppression du canal.

    Passe par un workflow parce que seule une activité peut toucher au worker
    Telegram, et qu'une activité ne s'appelle que depuis un workflow. Court et
    sans état: il n'a rien à attendre.
    """

    @workflow.run
    async def run(self, input: dict[str, Any]) -> dict[str, Any]:
        return await workflow.execute_activity(
            "disconnectTelegram",
            {"personaId": input["personaId"]},
            start_to_close_timeout=timedelta(seconds=60),
            retry_policy=RetryPolicy(maximum_attempts=3),
        )


DEFAULT_TOLERANCE_MINUTES = 45


@workflow.defn(name="telegramTargets")
class TelegramTargets:
    """Destinations disponibles pour une persona. Court, sans état."""

    @workflow.run
    async def run(self, input: dict[str, Any]) -> dict[str, Any]:
        return await workflow.execute_activity(
            "listTelegramTargets",
            {"personaId": input["personaId"]},
            start_to_close_timeout=timedelta(seconds=120),
            retry_policy=RetryPolicy(maximum_attempts=2),
        )


@workflow.defn(name="publishTelegram")
class PublishTelegram:
    """
    Publication Telegram, programmée ou immédiate (7.6).

    Même grammaire que le workflow Instagram: le workflow démarre à la
    programmation et attend l'échéance, plutôt que d'être réveillé à l'heure
    dite. L'application tient l'horloge, pas la plateforme.
    """

    def __init__(self) -> None:
        self._percent = 0
        self._state = "waiting"
        self._detail: str | None = None

    @workflow.query(name="publishProgress")
    def progress(self) -> dict[str, Any]:
        return {"percent": self._percent, "state": self._state, "detail": self._detail}

    @workflow.run
    async def run(self, input: dict[str, Any]) -> dict[str, Any]:
        publication_id = input["publicationId"]

        plan = await workflow.execute_activity(
            "loadTelegramPublication",
            {"publicationId": publication_id},
            start_to_close_timeout=timedelta(seconds=30),
            retry_policy=RetryPolicy(maximum_attempts=5),
        )

        scheduled = _parse_iso(plan["scheduledAt"])
        delay = (scheduled - workflow.now()).total_seconds()
        if delay > 0:
            self._detail = "En attente de l'échéance."
            await asyncio.sleep(delay)

        # Rejouer une publication très en retard peut être pire que de ne rien
        # faire: une promotion périmée, un contenu hors contexte. Au-delà de la
        # tolérance, on s'arrête et on laisse l'opérateur décider (7.6).
        tolerance = plan.get("toleranceMinutes") or DEFAULT_TOLERANCE_MINUTES
        lateness = (workflow.now() - scheduled).total_seconds() / 60
        if lateness > tolerance:
            self._state = "missed"
            self._detail = f"Retard de {int(lateness)} min, tolérance {tolerance} min."
            return {"outcome": "missed"}

        if plan["status"] not in ("SCHEDULED", "PUBLISHING"):
            self._state = "skipped"
            self._detail = f"Statut {plan['status']}: rien n'a été envoyé."
            return {"outcome": "skipped"}

        self._state = "running"
        self._percent = 30
        self._detail = f"Envoi vers {plan.get('targetLabel') or plan['chatId']}."

        try:
            sent = await workflow.execute_activity(
                "sendTelegramPublication",
                {
                    "personaId": plan["personaId"],
                    "chatId": plan["chatId"],
                    "starPrice": plan["starPrice"],
                    "caption": plan["caption"],
                    "media": plan["media"],
                    "dryRun": plan.get("dryRun", False),
                },
                # Les octets partent d'ici: une vidéo prend le temps qu'elle
                # prend, et l'interrompre ne ferait que la recommencer.
                start_to_close_timeout=timedelta(minutes=30),
                retry_policy=RetryPolicy(maximum_attempts=2),
            )
        except ActivityError as error:
            reason = _message(error)
            self._state = "failed"
            self._detail = reason
            await workflow.execute_activity(
                "markTelegramFailed",
                {"publicationId": publication_id, "reason": reason},
                start_to_close_timeout=timedelta(seconds=30),
                retry_policy=RetryPolicy(maximum_attempts=5),
            )
            return {"outcome": "failed", "reason": reason}

        if sent.get("dryRun"):
            await workflow.execute_activity(
                "markTelegramDryRun",
                {"publicationId": publication_id},
                start_to_close_timeout=timedelta(seconds=30),
                retry_policy=RetryPolicy(maximum_attempts=5),
            )
            self._percent = 100
            self._state = "published"
            self._detail = "Dry run: everything checked, nothing sent."
            return {"outcome": "dry-run"}

        await workflow.execute_activity(
            "markTelegramPublished",
            {"publicationId": publication_id, "messageId": sent["messageId"]},
            start_to_close_timeout=timedelta(seconds=30),
            retry_policy=RetryPolicy(maximum_attempts=5),
        )

        self._percent = 100
        self._state = "published"
        self._detail = None
        return {"outcome": "published", "messageId": sent["messageId"]}


def _parse_iso(value: str):
    from datetime import datetime, timezone

    parsed = datetime.fromisoformat(value)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
