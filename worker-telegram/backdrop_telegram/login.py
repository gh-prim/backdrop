"""
Connexion d'une persona à Telegram, en session utilisateur (spec 4.2.1).

    uv run python -m backdrop_telegram.login

Interactif par nature: Telegram envoie un code, et le compte peut exiger un
mot de passe de vérification en deux étapes. Aucun de ces échanges ne peut être
automatisé, et c'est voulu.

La sortie est une string session, chiffrée au format Node (voir crypto.py) et
accompagnée de son empreinte. Les deux voyagent ensemble: une session relue
avec une autre empreinte que celle de sa création est une session grillée.

La session n'est jamais affichée en clair: elle donne un accès complet au
compte, sans mot de passe et sans second facteur.
"""

from __future__ import annotations

import asyncio
import base64
import os
import sys

from hydrogram import Client

from backdrop_telegram import fingerprint
from backdrop_telegram.crypto import encrypt_credentials


def env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        sys.exit(f"variable d'environnement manquante: {name}")
    return value


async def main() -> None:
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

    payload = {"session": session, **marks}
    blob = base64.b64encode(encrypt_credentials(payload)).decode()

    print()
    print(f"connecté: {me.first_name} (@{me.username}) id={me.id}")
    print(f"empreinte: {marks['deviceModel']} / {marks['systemVersion']} / {marks['appVersion']}")
    print()
    print("Credentials chiffrés (base64), à enregistrer sur le ChannelAccount:")
    print(blob)
    print()
    print(
        "La session en clair n'est pas affichée: elle ouvre le compte sans mot "
        "de passe ni second facteur. Pour le sondage 4.2.6, exporter la variable "
        "avec --reveal-session."
    )

    if "--reveal-session" in sys.argv:
        print()
        print("TELEGRAM_SESSION=" + session)


if __name__ == "__main__":
    asyncio.run(main())
