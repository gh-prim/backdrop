"""
Test bloquant 4.2.6 — le paid media MTProto passe-t-il en conversation privée ?

Toute la documentation MTProto décrit `inputMediaPaidMedia` comme une
fonctionnalité de channel. L'ouverture « to any chat » est documentée côté Bot
API et suppose un solde de bot, qui n'a pas d'équivalent pour un compte
utilisateur. Ce script tranche la question sur des comptes réels, et consigne
l'erreur exacte.

Il reste isolé de l'application: pas de Prisma, pas de Temporal, pas de
workflow. On veut une réponse, pas une intégration. Seuls le chiffrement et
l'empreinte sont partagés, parce que les dupliquer créerait deux vérités.

Prérequis
---------
    Connecter la persona depuis l'application (Settings → Channels → Telegram).

    export TG_PERSONA_ID=...
    export TG_TEST_CHANNEL=@mon_channel_de_test
    export TG_TEST_USER=@mon_compte_de_test
    export TG_TEST_FILE=../tests/fixtures/teaser.jpg

    uv run --no-project python -m backdrop_telegram.probe_paid_media

La session est relue chiffrée depuis le ChannelAccount de la persona et ne
transite jamais par une variable d'environnement, où elle serait lisible par
tout process du système et par n'importe quel `ps`.

Consigner la sortie intégrale dans docs/findings/telegram-paid-media-dm.md.
"""

from __future__ import annotations

import asyncio
import os
import sys
import traceback

from hydrogram import Client
from hydrogram import raw

from backdrop_telegram import config, db

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
    config.load_dotenv()
    persona_id = env("TG_PERSONA_ID")
    channel = env("TG_TEST_CHANNEL")
    user = env("TG_TEST_USER")
    path = env("TG_TEST_FILE")

    organization_id = await db.persona_organization(persona_id)
    app_credentials = await db.load_telegram_app(organization_id)
    # L'empreinte vient de la session, pas des constantes: rejouer une session
    # sous une autre empreinte que celle de sa création la grille (4.2.3).
    stored = await db.load_session(persona_id)

    app = Client(
        name="backdrop-probe",
        api_id=int(app_credentials["apiId"]),
        api_hash=app_credentials["apiHash"],
        session_string=stored["session"],
        device_model=stored["deviceModel"],
        system_version=stored["systemVersion"],
        app_version=stored["appVersion"],
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
