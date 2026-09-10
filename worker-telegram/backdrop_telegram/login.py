"""
Connexion d'une persona à Telegram, en session utilisateur (spec 4.2.1).

    uv run python -m backdrop_telegram.login

Interactif par nature: Telegram envoie un code, et le compte peut exiger un
mot de passe de vérification en deux étapes. Aucun de ces échanges ne peut être
automatisé, et c'est voulu.

La sortie est une string session, chiffrée au format Node (voir crypto.py) et
accompagnée de son empreinte. Les deux voyagent ensemble: une session relue
avec une autre empreinte que celle de sa création est une session grillée.

Le résultat est écrit chiffré dans `.session.enc`, jamais affiché: une session
donne un accès complet au compte, sans mot de passe ni second facteur, et ce
qui passe à l'écran finit dans un historique de terminal.
"""

from __future__ import annotations

import asyncio
import base64
import os
import sys
from pathlib import Path

from hydrogram import Client

from backdrop_telegram import fingerprint
from backdrop_telegram.crypto import encrypt_credentials


REPO = Path(__file__).resolve().parents[2]
SESSION_FILE = Path(__file__).resolve().parents[1] / ".session.enc"


def load_dotenv() -> None:
    """
    Charge le .env du dépôt. Le login est un outil de développement lancé à la
    main: exiger un `export` préalable ne protégerait rien et ferait échouer la
    commande une fois sur deux.
    """
    path = REPO / ".env"
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())


def env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        sys.exit(f"variable d'environnement manquante: {name}")
    return value


async def main() -> None:
    load_dotenv()
    api_id = int(env("TELEGRAM_API_ID"))
    api_hash = env("TELEGRAM_API_HASH")
    marks = fingerprint.current()

    app = Client(
        name="backdrop-login",
        api_id=api_id,
        api_hash=api_hash,
        device_model=marks["deviceModel"],
        system_version=marks["systemVersion"],
        app_version=marks["appVersion"],
        in_memory=True,
    )

    async with app:
        me = await app.get_me()
        session = await app.export_session_string()

    payload = {"session": session, "userId": me.id, "username": me.username, **marks}
    SESSION_FILE.write_bytes(base64.b64encode(encrypt_credentials(payload)))
    SESSION_FILE.chmod(0o600)

    print()
    print(f"connecté: {me.first_name} (@{me.username}) id={me.id}")
    print(f"empreinte: {marks['deviceModel']} / {marks['systemVersion']} / {marks['appVersion']}")
    print(f"session chiffrée écrite dans {SESSION_FILE.relative_to(REPO)}")
    print()
    print("Rien d'autre à recopier: la suite relira ce fichier.")


if __name__ == "__main__":
    asyncio.run(main())
