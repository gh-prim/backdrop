"""
Emplacement et chiffrement des bases TDLib.

TDLib ne produit pas de *session string*: elle possède un répertoire par
compte, qu'elle chiffre elle-même avec une clé qu'on lui fournit. Une persona
connectée est donc un dossier sur disque, pas une chaîne en base — ce qui
change le modèle décrit au 4.2.1 et impose un volume au worker.

La clé de chiffrement est **dérivée** de la clé maître, et non stockée. Deux
conséquences, assumées:

  * rien de nouveau à protéger en base, et un répertoire TDLib copié sans la
    clé maître ne vaut rien;
  * changer `CREDENTIALS_MASTER_KEY` rend les bases existantes illisibles. Une
    rotation impose donc de reconnecter les personas. C'est acceptable pour un
    secret qu'on ne fait pas tourner à la légère, et ce serait de toute façon
    vrai des credentials chiffrés avec.
"""

from __future__ import annotations

import hashlib
import hmac
import os
from pathlib import Path

from backdrop_telegram.crypto import master_key

DEFAULT_ROOT = Path(__file__).resolve().parents[2] / ".tdlib-sessions"


def session_root() -> Path:
    raw = os.environ.get("TELEGRAM_SESSION_ROOT", "").strip()
    return Path(raw) if raw else DEFAULT_ROOT


def session_directory(persona_id: str) -> Path:
    """
    Répertoire de la persona. Créé au besoin, en 0700: il contient de quoi
    agir sur le compte, même chiffré.
    """
    path = session_root() / persona_id
    path.mkdir(parents=True, exist_ok=True)
    path.chmod(0o700)
    return path


def database_encryption_key(persona_id: str) -> bytes:
    """
    Clé propre à la persona, dérivée de la clé maître.

    Le HMAC lie la clé à l'identifiant de la persona: deux répertoires ne
    partagent jamais la même, si bien qu'une base volée ne dit rien des autres.
    """
    return hmac.new(
        master_key(), f"tdlib:{persona_id}".encode("utf-8"), hashlib.sha256
    ).digest()
