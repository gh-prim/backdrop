"""
Lecture de la session produite par le login.

Fichier de développement, en attendant que la session vive sur le
`ChannelAccount` en base. Il porte le même chiffrement que la base — donc la
même clé maître — pour qu'aucun secret ne traîne en clair sur le disque.
"""

from __future__ import annotations

import base64
from pathlib import Path
from typing import Any

SESSION_FILE = Path(__file__).resolve().parents[1] / ".session.enc"


def load(path: Path | None = None) -> dict[str, Any]:
    from backdrop_telegram.crypto import decrypt_credentials

    target = path or SESSION_FILE
    if not target.exists():
        raise FileNotFoundError(
            f"{target} absent. Lancer d'abord: uv run --no-project python -m backdrop_telegram.login"
        )
    return decrypt_credentials(base64.b64decode(target.read_bytes()))
