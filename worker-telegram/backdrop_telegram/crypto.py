"""
Déchiffrement des credentials plateforme, côté Python.

Contrepartie exacte de `src/lib/crypto.ts`. Le format est imposé par Node et
n'est pas négociable ici:

    iv (12 octets) | tag GCM (16 octets) | chiffré (n octets)

La clé maître est la même variable d'environnement, encodée en base64.

Une divergence entre les deux implémentations serait silencieuse à l'écriture
et ne se manifesterait qu'à la lecture, sur une session Telegram devenue
illisible — donc perdue, puisqu'une session ne se régénère qu'en refaisant le
login. D'où le test croisé `tests/test_crypto.py`, qui déchiffre en Python ce
que Node a réellement chiffré.
"""

from __future__ import annotations

import base64
import json
import os
from typing import Any

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

IV_BYTES = 12
TAG_BYTES = 16
KEY_BYTES = 32

_cached_key: bytes | None = None


def master_key() -> bytes:
    global _cached_key
    if _cached_key is not None:
        return _cached_key

    raw = os.environ.get("CREDENTIALS_MASTER_KEY")
    if not raw:
        raise RuntimeError(
            "CREDENTIALS_MASTER_KEY manquante. Générer avec: openssl rand -base64 32"
        )

    key = base64.b64decode(raw)
    if len(key) != KEY_BYTES:
        raise RuntimeError(
            f"CREDENTIALS_MASTER_KEY invalide: {len(key)} octets décodés, {KEY_BYTES} attendus."
        )

    _cached_key = key
    return key


def reset_master_key_cache() -> None:
    """Réinitialise la clé mémorisée. Réservé aux tests."""
    global _cached_key
    _cached_key = None


def decrypt_credentials(blob: bytes | memoryview) -> Any:
    buffer = bytes(blob)
    if len(buffer) <= IV_BYTES + TAG_BYTES:
        raise ValueError("Credentials illisibles: contenu trop court.")

    iv = buffer[:IV_BYTES]
    tag = buffer[IV_BYTES : IV_BYTES + TAG_BYTES]
    encrypted = buffer[IV_BYTES + TAG_BYTES :]

    # AESGCM attend le tag collé au chiffré, là où Node le range en tête.
    plaintext = AESGCM(master_key()).decrypt(iv, encrypted + tag, None)
    return json.loads(plaintext.decode("utf-8"))


def encrypt_credentials(payload: Any) -> bytes:
    """
    Chiffre au format Node. Utilisé par le login, qui écrit la session depuis
    Python; le reste de l'application la relira depuis TypeScript.
    """
    iv = os.urandom(IV_BYTES)
    plaintext = json.dumps(payload).encode("utf-8")
    sealed = AESGCM(master_key()).encrypt(iv, plaintext, None)
    # Découper le tag de la queue pour le remettre en tête, comme Node l'attend.
    encrypted, tag = sealed[:-TAG_BYTES], sealed[-TAG_BYTES:]
    return iv + tag + encrypted
