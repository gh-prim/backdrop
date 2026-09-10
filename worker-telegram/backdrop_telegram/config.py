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
        value = unquote(value.strip())
        if value:
            os.environ.setdefault(key.strip(), value)


def unquote(value: str) -> str:
    """
    Retire les guillemets encadrants d'une valeur de .env.

    Sans ça, psycopg reçoit une URL commençant par un guillemet, ne la
    reconnaît plus comme URI, et la lit comme une liste d'options clé=valeur —
    une erreur qui ne se manifeste qu'au premier accès base, très loin de sa
    cause.
    """
    if len(value) >= 2 and value[0] == value[-1] and value[0] in ("\"", "'"):
        return value[1:-1]
    return value


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
    return libpq_url(require("DATABASE_URL"))


def libpq_url(url: str) -> str:
    """
    Traduit l'URL Prisma en URL acceptable par libpq.

    Prisma ajoute `?schema=`, que libpq refuse — il n'a pas de notion de schéma
    dans son URI et rejette tout paramètre inconnu. Le schéma est donc reporté
    dans `options=-c search_path=`, son équivalent côté serveur.

    Le jeter purement et simplement serait pire que l'erreur: le worker se
    connecterait au `search_path` par défaut et lirait des tables absentes,
    ou pire, celles d'un autre schéma.
    """
    from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

    parts = urlsplit(url)
    query = parse_qsl(parts.query, keep_blank_values=True)

    schema = None
    kept = []
    for key, value in query:
        if key == "schema":
            schema = value
        else:
            kept.append((key, value))

    if schema:
        existing = dict(kept).get("options", "")
        merged = f"{existing}-csearch_path={schema}" if not existing else (
            f"{existing} -csearch_path={schema}"
        )
        kept = [(k, v) for k, v in kept if k != "options"] + [("options", merged)]

    return urlunsplit(
        (parts.scheme, parts.netloc, parts.path, urlencode(kept), parts.fragment)
    )


def temporal_address() -> str:
    return env_or("TEMPORAL_ADDRESS", "127.0.0.1:7233")


def temporal_namespace() -> str:
    return env_or("TEMPORAL_NAMESPACE", "default")


# Doit rester aligné sur TASK_QUEUE.telegram dans src/temporal/config.ts.
TASK_QUEUE = "backdrop-telegram"
