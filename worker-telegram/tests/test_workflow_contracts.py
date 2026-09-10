"""
Contrats du workflow de login, vérifiés sur le texte du module.

Ces règles ne se voient pas à l'exécution en test unitaire — il faudrait un
environnement Temporal complet — mais leur violation coûte cher: celle de
`wait_condition` a fait qu'aucun code saisi n'était jamais soumis, et que
chaque connexion se terminait en « aucun code saisi dans le temps imparti »
au moment précis où l'opérateur venait de le saisir.
"""

from __future__ import annotations

import inspect

from backdrop_telegram import workflows

SOURCE = inspect.getsource(workflows)


def test_wait_condition_n_est_jamais_teste_sur_sa_valeur_de_retour():
    # Sa signature est `-> None`: elle lève asyncio.TimeoutError à
    # l'expiration. Affecter son retour puis le tester rend toute attente
    # réussie indiscernable d'un dépassement de délai.
    assert "= await workflow.wait_condition" not in SOURCE
    assert "await workflow.wait_condition" in SOURCE


def test_l_expiration_est_bien_traitee_comme_une_exception():
    assert "except asyncio.TimeoutError" in SOURCE


def test_le_client_est_libere_sur_toutes_les_sorties():
    # Un client TDLib abandonné garde le verrou du répertoire de la persona,
    # qui ne peut alors plus se reconnecter.
    assert "finally:" in SOURCE
    assert '"abandonLogin"' in SOURCE


def test_seuls_les_messages_destines_a_l_operateur_sortent():
    # Temporal convertit toute exception en ApplicationError; laisser passer
    # leur texte a déjà affiché une chaîne de connexion dans le navigateur.
    assert "cause.type == OPERATOR_ERROR" in SOURCE
    assert "return GENERIC_FAILURE" in SOURCE
