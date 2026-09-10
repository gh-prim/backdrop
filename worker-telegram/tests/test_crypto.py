"""
Interopérabilité du chiffrement entre Node et Python.

Ce test ne vérifie pas une implémentation contre elle-même: il fait tourner le
vrai `src/lib/crypto.ts` et croise les résultats. Un test Python pur passerait
même si les deux langages s'étaient mis d'accord sur un format erroné.
"""

from __future__ import annotations

import base64
import json
import os
import subprocess
from pathlib import Path

import pytest

from backdrop_telegram.crypto import (
    decrypt_credentials,
    encrypt_credentials,
    reset_master_key_cache,
)

REPO = Path(__file__).resolve().parents[2]
KEY = base64.b64encode(b"\x2a" * 32).decode()

# Une string session Telegram: long, non-ASCII possible, et sa perte est
# irréversible. C'est exactement la charge utile qui compte ici.
PAYLOAD = {
    "session": "1BQANOTEuMTA4LjU2LjE" + "x" * 300,
    "deviceModel": "Backdrop — Persona №1",
    "systemVersion": "1.0",
    "appVersion": "backdrop 0.1.0",
}


@pytest.fixture(autouse=True)
def _master_key(monkeypatch):
    monkeypatch.setenv("CREDENTIALS_MASTER_KEY", KEY)
    reset_master_key_cache()
    yield
    reset_master_key_cache()


def _run_node(script: str) -> str:
    result = subprocess.run(
        ["pnpm", "exec", "tsx", "-e", script],
        cwd=REPO,
        capture_output=True,
        text=True,
        env={**os.environ, "CREDENTIALS_MASTER_KEY": KEY},
        timeout=180,
    )
    if result.returncode != 0:
        pytest.fail(f"Node a échoué:\n{result.stdout}\n{result.stderr}")
    return result.stdout.strip().splitlines()[-1]


def test_python_dechiffre_ce_que_node_chiffre():
    encoded = _run_node(
        "import {encryptCredentials} from './src/lib/crypto';"
        f"process.stdout.write(Buffer.from(encryptCredentials({json.dumps(PAYLOAD)})).toString('base64'))"
    )
    assert decrypt_credentials(base64.b64decode(encoded)) == PAYLOAD


def test_node_dechiffre_ce_que_python_chiffre():
    # Le login écrit la session depuis Python; l'application la relit depuis
    # TypeScript. Le sens inverse compte donc autant.
    blob = base64.b64encode(encrypt_credentials(PAYLOAD)).decode()
    decoded = _run_node(
        "import {decryptCredentials} from './src/lib/crypto';"
        f"process.stdout.write(JSON.stringify(decryptCredentials(Buffer.from('{blob}','base64'))))"
    )
    assert json.loads(decoded) == PAYLOAD


def test_un_chiffre_altere_est_rejete():
    # Le tag GCM est la raison d'être du choix d'AES-GCM (spec 9.2): une
    # session silencieusement corrompue vaudrait moins qu'une erreur franche.
    blob = bytearray(encrypt_credentials(PAYLOAD))
    blob[-1] ^= 0x01
    with pytest.raises(Exception):
        decrypt_credentials(bytes(blob))


def test_contenu_trop_court_rejete():
    with pytest.raises(ValueError):
        decrypt_credentials(b"\x00" * 20)
