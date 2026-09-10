"""
Configuration du worker Telegram, lue dans l'environnement.

Ne contient aucun secret de plateforme: `api_id` et `api_hash` vivent en base,
chiffrés, saisis depuis l'application (4.2.1). Seuls transitent ici l'adresse
de la base, celle de Temporal, et la clé maître qui permet de déchiffrer.
"""

from __future__ import annotations

import os
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]


def load_dotenv() -> None:
    """
    Charge le .env du dépôt quand il existe. En conteneur il n'y en a pas et
    l'environnement est déjà rempli par Compose: d'où le `setdefault`, qui ne
    remplace jamais une valeur explicitement fournie.
    """
    path = REPO / ".env"
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        value = value.strip()
        if value:
            os.environ.setdefault(key.strip(), value)


def env_or(name: str, fallback: str) -> str:
    # Une variable vide vaut absente: Compose transmet "" pour toute variable
    # non renseignée, et la traiter comme une valeur a déjà coûté cher côté
    # Node (voir src/lib/env.ts).
    value = os.environ.get(name, "").strip()
    return value or fallback


def require(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"variable d'environnement manquante: {name}")
    return value


def database_url() -> str:
    return require("DATABASE_URL")


def temporal_address() -> str:
    return env_or("TEMPORAL_ADDRESS", "127.0.0.1:7233")


def temporal_namespace() -> str:
    return env_or("TEMPORAL_NAMESPACE", "default")


# Doit rester aligné sur TASK_QUEUE.telegram dans src/temporal/config.ts.
TASK_QUEUE = "backdrop-telegram"
