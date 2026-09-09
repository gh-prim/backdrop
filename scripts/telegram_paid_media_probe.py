"""
Test bloquant 4.2.6 — le paid media MTProto passe-t-il en conversation privée ?

Toute la documentation MTProto décrit `inputMediaPaidMedia` comme une
fonctionnalité de channel. L'ouverture « to any chat » est documentée côté Bot
API et suppose un solde de bot, qui n'a pas d'équivalent pour un compte
utilisateur. Ce script tranche la question sur des comptes réels, et consigne
l'erreur exacte.

Il est volontairement isolé du reste du dépôt: pas de Prisma, pas de Temporal,
pas d'import applicatif. On veut une réponse, pas une intégration.

Prérequis
---------
    pip install hydrogram tgcrypto
    export TELEGRAM_API_ID=...          # le couple unique de l'application (4.2.1)
    export TELEGRAM_API_HASH=...
    export TELEGRAM_SESSION=...         # string session de la persona de test
    export TG_TEST_CHANNEL=@mon_channel_de_test
    export TG_TEST_USER=@mon_compte_de_test
    export TG_TEST_FILE=./tests/fixtures/teaser.jpg

    python scripts/telegram_paid_media_probe.py

Consigner la sortie intégrale dans docs/findings/telegram-paid-media-dm.md.
"""

from __future__ import annotations

import asyncio
import os
import sys
import traceback

from hydrogram import Client
from hydrogram import raw

# Fingerprint figé (4.2.3). Ces valeurs ne doivent jamais changer sur la durée
# de vie d'une session: on ne laisse pas Hydrogram prendre ses défauts.
DEVICE_MODEL = "Backdrop Probe"
SYSTEM_VERSION = "1.0"
APP_VERSION = "backdrop 0.1.0"

STARS_AMOUNT = 50


def env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        sys.exit(f"variable d'environnement manquante: {name}")
    return value


async def upload_reusable(app: Client, path: str):
    """Upload en deux temps (4.2.7): les octets partent du worker, une fois."""
    uploaded_file = await app.save_file(path)
    uploaded = raw.types.InputMediaUploadedPhoto(file=uploaded_file)
    result = await app.invoke(
        raw.functions.messages.UploadMedia(
            peer=raw.types.InputPeerSelf(),
            media=uploaded,
        )
    )
    photo = result.photo
    return raw.types.InputMediaPhoto(
        id=raw.types.InputPhoto(
            id=photo.id,
            access_hash=photo.access_hash,
            file_reference=photo.file_reference,
        )
    )


async def send_paid(app: Client, target: str, reusable, label: str) -> None:
    print(f"\n=== {label}: {target}")
    try:
        peer = await app.resolve_peer(target)
        print(f"peer résolu: {type(peer).__name__}")
        result = await app.invoke(
            raw.functions.messages.SendMedia(
                peer=peer,
                media=raw.types.InputMediaPaidMedia(
                    stars_amount=STARS_AMOUNT,
                    extended_media=[reusable],
                ),
                message=f"[probe] paid media {STARS_AMOUNT} stars",
                random_id=app.rnd_id(),
            )
        )
        print(f"RÉSULTAT: SUCCÈS — {type(result).__name__}")
    except Exception as error:  # noqa: BLE001 — on veut l'erreur exacte, quelle qu'elle soit
        print(f"RÉSULTAT: ÉCHEC — {type(error).__name__}: {error}")
        traceback.print_exc()


async def main() -> None:
    api_id = int(env("TELEGRAM_API_ID"))
    api_hash = env("TELEGRAM_API_HASH")
    session = env("TELEGRAM_SESSION")
    channel = env("TG_TEST_CHANNEL")
    user = env("TG_TEST_USER")
    path = env("TG_TEST_FILE")

    app = Client(
        name="backdrop-probe",
        api_id=api_id,
        api_hash=api_hash,
        session_string=session,
        device_model=DEVICE_MODEL,
        system_version=SYSTEM_VERSION,
        app_version=APP_VERSION,
        in_memory=True,
    )

    async with app:
        me = await app.get_me()
        print(f"connecté: {me.first_name} (@{me.username}) id={me.id}")

        reusable = await upload_reusable(app, path)
        print(f"média uploadé et réutilisable: {type(reusable).__name__}")

        # A) Le cas documenté et attendu comme fonctionnel.
        await send_paid(app, channel, reusable, "A. channel")

        # B) Le cas qui décide de l'architecture du DM (4.2.6).
        await send_paid(app, user, reusable, "B. conversation privée")

    print(
        "\nSi B échoue: le DM devient relationnel et l'upsell passe par un lien "
        "Fanvue. Un seul rail de paiement Telegram, le channel. C'est le repli "
        "attendu et il est acceptable."
    )


if __name__ == "__main__":
    asyncio.run(main())
