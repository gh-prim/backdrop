"""
Lecture du .env.

Un .env se relit rarement à la main et ses erreurs ne se voient qu'à
l'exécution, très loin de leur cause: une URL mal dépouillée de ses guillemets
n'échoue qu'au premier accès base.
"""

from __future__ import annotations

import pytest

from backdrop_telegram.config import env_or, load_dotenv, unquote


def test_retire_les_guillemets_doubles():
    assert unquote('"postgresql://u:p@h:5434/db?schema=public"') == (
        "postgresql://u:p@h:5434/db?schema=public"
    )


def test_retire_les_guillemets_simples():
    assert unquote("'valeur'") == "valeur"


def test_laisse_une_valeur_nue_intacte():
    assert unquote("postgresql://u:p@h/db") == "postgresql://u:p@h/db"


def test_ne_retire_pas_un_guillemet_isole():
    # Un mot de passe peut commencer par un guillemet sans en être entouré.
    assert unquote('"abc') == '"abc'
    assert unquote('abc"') == 'abc"'


def test_valeur_vide_vaut_absente(monkeypatch):
    # Compose transmet "" pour toute variable non renseignée; la traiter comme
    # une valeur a déjà coûté cher côté Node (src/lib/env.ts).
    monkeypatch.setenv("BACKDROP_TEST_VIDE", "   ")
    assert env_or("BACKDROP_TEST_VIDE", "repli") == "repli"


def test_dotenv_ne_remplace_pas_une_valeur_deja_posee(monkeypatch, tmp_path):
    # En conteneur, Compose remplit l'environnement et le .env n'existe pas.
    # Là où les deux coexistent, l'explicite doit gagner.
    monkeypatch.setenv("DATABASE_URL", "posee-par-compose")
    load_dotenv()
    assert env_or("DATABASE_URL", "") == "posee-par-compose"


def test_le_schema_prisma_devient_un_search_path():
    from backdrop_telegram.config import libpq_url

    # libpq refuse ?schema=, qui est une invention de Prisma. Le jeter ferait
    # lire le mauvais schéma en silence: il faut le traduire, pas l'ignorer.
    out = libpq_url("postgresql://u:p@h:5434/db?schema=public")
    assert "schema=public" not in out
    assert "search_path%3Dpublic" in out or "search_path=public" in out


def test_une_url_sans_schema_est_inchangee():
    from backdrop_telegram.config import libpq_url

    url = "postgresql://u:p@h:5434/db"
    assert libpq_url(url) == url


def test_les_autres_parametres_survivent():
    from backdrop_telegram.config import libpq_url

    out = libpq_url("postgresql://u:p@h/db?schema=public&connect_timeout=5")
    assert "connect_timeout=5" in out
