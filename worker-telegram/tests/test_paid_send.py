"""
Un envoi payant doit partir payant.

Régression du 2026-09-10, en production: le bloc de média payant s'était
retrouvé **imbriqué dans la branche de simulation**, après son `return`. Il
était donc inatteignable hors dry run, et tout envoi facturé retombait sur le
chemin gratuit — un lot à 100 étoiles offert à un channel entier, sans une
erreur nulle part.

Le test ne double pas TDLib: il vérifie la structure du code, là où la faute
s'était logée. Un `if star_price` placé après le `return` de la simulation ne
peut pas s'exécuter, quelle que soit la qualité du reste.
"""

from __future__ import annotations

import ast
import pathlib

SOURCE = pathlib.Path("backdrop_telegram/publish_activities.py").read_text()


def _fonction(nom: str) -> ast.FunctionDef:
    arbre = ast.parse(SOURCE)
    for noeud in ast.walk(arbre):
        if isinstance(noeud, (ast.FunctionDef, ast.AsyncFunctionDef)) and noeud.name == nom:
            return noeud
    raise AssertionError(f"fonction {nom} introuvable")


def test_le_chemin_payant_est_au_premier_niveau():
    fonction = _fonction("send_telegram_publication")

    # Les `if` de premier niveau: c'est là que doivent vivre la simulation et
    # l'envoi payant, l'un après l'autre.
    conditions = [n for n in fonction.body if isinstance(n, ast.If)]
    sources = [ast.unparse(n.test) for n in conditions]

    assert "star_price" in sources, (
        "l'envoi payant n'est plus une branche de premier niveau: "
        f"conditions trouvées = {sources}"
    )

    simulation = next(i for i, s in enumerate(sources) if "dryRun" in s)
    payant = [i for i, s in enumerate(sources) if s == "star_price"]
    assert payant[-1] > simulation, "le paiement doit venir après le point d'arrêt du dry run"


def test_la_simulation_ne_contient_pas_l_envoi_payant():
    fonction = _fonction("send_telegram_publication")
    simulation = next(
        n for n in fonction.body if isinstance(n, ast.If) and "dryRun" in ast.unparse(n.test)
    )
    corps = ast.unparse(ast.Module(body=simulation.body, type_ignores=[]))

    # C'est exactement la forme qu'avait la panne.
    assert "InputMessagePaidMedia" not in corps
    assert "send_message" not in corps or "get_chat" in corps


def test_le_paye_sort_bien_paid_true():
    fonction = _fonction("send_telegram_publication")
    payant = [
        n
        for n in fonction.body
        if isinstance(n, ast.If) and ast.unparse(n.test) == "star_price"
    ][-1]
    corps = ast.unparse(ast.Module(body=payant.body, type_ignores=[]))

    assert "InputMessagePaidMedia" in corps
    assert "'paid': True" in corps
