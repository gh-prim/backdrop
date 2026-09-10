"""
Cloisonnement des messages d'erreur remontés à l'écran.

Une erreur d'infrastructure porte volontiers sa cause dans son texte: psycopg
recopie la chaîne de connexion entière, mot de passe compris. Temporal
convertissant toute exception en ApplicationError, laisser passer le message
tel quel l'affichait dans le navigateur — ce qui est arrivé.
"""

from __future__ import annotations

from temporalio.exceptions import ActivityError, ApplicationError

from backdrop_telegram.workflows import GENERIC_FAILURE, OPERATOR_ERROR, _message

FUITE = (
    'invalid connection option ""postgresql://backdrop:motdepasse'
    '@localhost:5434/backdrop?schema"'
)


def _activity_error(cause: ApplicationError) -> ActivityError:
    error = ActivityError(
        "Activity task failed",
        scheduled_event_id=1,
        started_event_id=2,
        identity="test",
        activity_type="requestLoginCode",
        activity_id="1",
        retry_state=None,
    )
    error.__cause__ = cause
    return error


def test_un_message_ecrit_pour_l_operateur_passe():
    error = _activity_error(ApplicationError("Code incorrect.", type=OPERATOR_ERROR))
    assert _message(error) == "Code incorrect."


def test_une_erreur_d_infrastructure_ne_passe_pas():
    # Le cas réellement survenu: psycopg remonte la chaîne de connexion.
    error = _activity_error(ApplicationError(FUITE, type="OperationalError"))

    rendu = _message(error)
    assert rendu == GENERIC_FAILURE
    assert "motdepasse" not in rendu
    assert "postgresql://" not in rendu


def test_une_erreur_sans_type_ne_passe_pas():
    # Une ApplicationError levée sans type est une conversion faite par
    # Temporal, pas un message rédigé: elle ne doit pas atteindre l'écran.
    error = _activity_error(ApplicationError(FUITE))
    assert _message(error) == GENERIC_FAILURE


def test_un_message_operateur_vide_retombe_sur_le_generique():
    error = _activity_error(ApplicationError("", type=OPERATOR_ERROR))
    assert _message(error) == GENERIC_FAILURE
