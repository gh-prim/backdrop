"""
Diagnostic de connexion Telegram, hors application.

Sert à voir ce que Telegram répond réellement, sans l'intermédiaire du worker
ni de Temporal: quel canal de livraison il choisit, vers quel DC il redirige,
et ce qu'il dit exactement quand ça échoue.

Le client reste connecté pendant l'attente du code, parce que MTProto lie le
`phone_code_hash` à la clé négociée à la connexion. Le code est lu dans un
fichier plutôt qu'au clavier: le script tourne en tâche de fond, et rien ne
peut taper dedans.

    uv run --no-project python -m backdrop_telegram.diagnose_login

Puis, quand le code arrive:

    echo 12345 > /tmp/tg-code.txt
"""

from __future__ import annotations

import asyncio
import os
from pathlib import Path

from hydrogram import Client
from hydrogram.errors import FloodWait, SessionPasswordNeeded

from backdrop_telegram import config, db, fingerprint

PHONE = os.environ.get("TG_DIAG_PHONE", "+33651153065")
PERSONA = os.environ.get("TG_DIAG_PERSONA", "cmtu81k4200019k7ei1roo6tf")
CODE_FILE = Path("/tmp/tg-code.txt")
PASSWORD_FILE = Path("/tmp/tg-password.txt")
WAIT_SECONDS = 900


def show(label: str, value: object) -> None:
    print(f"  {label:<18} {value}", flush=True)


async def wait_for(path: Path, what: str) -> str:
    print(f"\n>>> En attente de {what} dans {path}", flush=True)
    for elapsed in range(WAIT_SECONDS // 2):
        if path.exists():
            value = path.read_text().strip()
            if value:
                path.unlink(missing_ok=True)
                print(f">>> {what} reçu après {elapsed * 2} s", flush=True)
                return value
        await asyncio.sleep(2)
    raise TimeoutError(f"aucun {what} fourni en {WAIT_SECONDS} s")


async def main() -> None:
    config.load_dotenv()
    CODE_FILE.unlink(missing_ok=True)
    PASSWORD_FILE.unlink(missing_ok=True)

    credentials = await db.load_telegram_app(PERSONA)
    marks = fingerprint.current()

    print("=== paramètres ===", flush=True)
    show("api_id", credentials["apiId"])
    show("api_hash", credentials["apiHash"][:6] + "…(masqué)")
    show("numéro", PHONE)
    show("empreinte", f"{marks['deviceModel']} / {marks['systemVersion']} / {marks['appVersion']}")

    app = Client(
        name="backdrop-diagnose",
        api_id=int(credentials["apiId"]),
        api_hash=credentials["apiHash"],
        device_model=marks["deviceModel"],
        system_version=marks["systemVersion"],
        app_version=marks["appVersion"],
        in_memory=True,
    )

    await app.connect()
    print("\n=== send_code ===", flush=True)
    try:
        sent = await app.send_code(PHONE)
    except FloodWait as error:
        print(f"FLOOD_WAIT: attendre {error.value} s avant un nouvel envoi", flush=True)
        await app.disconnect()
        return

    # Tout ce que Telegram accepte de dire sur la livraison.
    show("type", sent.type)
    show("next_type", getattr(sent, "next_type", None))
    show("timeout", getattr(sent, "timeout", None))
    show("phone_code_hash", (sent.phone_code_hash or "")[:8] + "…")
    show("attributs", [a for a in dir(sent) if not a.startswith("_")])

    try:
        code = await wait_for(CODE_FILE, "le code")
    except TimeoutError as error:
        print(f"\n{error}", flush=True)
        await app.disconnect()
        return

    print("\n=== sign_in ===", flush=True)
    try:
        await app.sign_in(PHONE, sent.phone_code_hash, code)
    except SessionPasswordNeeded:
        print("vérification en deux étapes demandée", flush=True)
        password = await wait_for(PASSWORD_FILE, "le mot de passe")
        await app.check_password(password)
    except Exception as error:  # noqa: BLE001 — on veut l'erreur exacte
        print(f"ÉCHEC: {type(error).__name__}: {error}", flush=True)
        await app.disconnect()
        return

    me = await app.get_me()
    session = await app.export_session_string()
    await app.disconnect()

    # La session n'est pas affichée: elle ouvre le compte sans mot de passe ni
    # second facteur. Elle part chiffrée là où l'application ira la lire.
    channel_account_id = await db.save_session(
        persona_id=PERSONA,
        telegram_user_id=me.id,
        payload={
            "session": session,
            "userId": me.id,
            "username": me.username,
            "phone": PHONE,
            **marks,
        },
    )

    print("\n=== connecté ===", flush=True)
    show("compte", f"{me.first_name} (@{me.username})")
    show("user_id", me.id)
    show("ChannelAccount", channel_account_id)
    print("\nSession chiffrée enregistrée en base. Rien à recopier.", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
