"""
La clé de base TDLib doit survivre à la sérialisation d'aiotdlib.

Son type `Bytes` encode en base64 **url-safe**, là où l'interface JSON de
TDLib attend du base64 standard: une clé contenant `-` ou `_` une fois encodée
fait rejeter `setTdlibParameters` avec « Wrong character in the string », et la
connexion expire ensuite sans que rien ne nomme la cause.

Observé en production le 2026-09-10 sur une instance fraîche: environ trois
personas sur quatre étaient concernées, ce qui donnait l'illusion d'un problème
de machine.
"""

from __future__ import annotations

import base64
import os

import pytest

from backdrop_telegram.tdlib import sessions


@pytest.fixture(autouse=True)
def cle_maitre(monkeypatch):
    monkeypatch.setenv(
        "CREDENTIALS_MASTER_KEY",
        base64.b64encode(b"cle-de-test-de-32-octets-!!!!!!!").decode(),
    )
    yield


def test_la_cle_derivee_est_toujours_encodable_pour_tdlib():
    # Un échantillon large: le défaut ne se voyait qu'avec certaines clés, et
    # un seul identifiant ne prouverait rien.
    for i in range(200):
        cle = sessions.database_encryption_key(f"persona-{i}")
        encodee = base64.urlsafe_b64encode(cle).decode()
        assert "-" not in encodee and "_" not in encodee, f"persona-{i}: {encodee}"
        assert len(cle) == 32


def test_la_cle_est_stable_pour_une_persona():
    a = sessions.database_encryption_key("carolina")
    b = sessions.database_encryption_key("carolina")
    assert a == b, "une clé qui change rend la base illisible"


def test_deux_personas_ont_des_cles_differentes():
    assert sessions.database_encryption_key("a") != sessions.database_encryption_key("b")
