"""
Sérialisabilité des retours d'activité.

Temporal encode le retour d'une activité en JSON. Un objet Hydrogram y échoue —
et il y échoue **après** l'appel réseau, donc après que Telegram a envoyé le
code. Le workflow voit alors un échec, libère le client MTProto en attente, et
l'opérateur se retrouve avec un code valide et plus rien pour le saisir.

Le coût d'un tel bug est donc bien supérieur à ce qu'un `TypeError` laisse
croire: il consomme un envoi Telegram, qui est compté et limité.
"""

from __future__ import annotations

import json

import pytest


class _SentCodeType:
    """Ce que renvoie Hydrogram: une classe, pas une valeur."""

    APP = "app"


class _SentCode:
    phone_code_hash = "hash"
    type = _SentCodeType


def test_le_type_brut_d_hydrogram_n_est_pas_serialisable():
    # Reproduit la panne exacte: sans str(), json.dumps refuse.
    with pytest.raises(TypeError):
        json.dumps({"sentTo": _SentCode.type})


def test_le_retour_de_l_activite_est_serialisable():
    sent = _SentCode()
    payload = {"sentTo": str(sent.type)}
    assert json.loads(json.dumps(payload))["sentTo"] == str(_SentCodeType)


def test_le_retour_de_connexion_ne_porte_que_des_primitives():
    # Contrat de _finish: rien qui ne survive à un aller-retour JSON, et
    # surtout pas la session, qui n'a rien à faire dans l'historique Temporal.
    payload = {
        "state": "connected",
        "channelAccountId": "c123",
        "username": "carolina",
        "firstName": "Carolina",
        "telegramUserId": 123456789,
    }
    assert json.loads(json.dumps(payload)) == payload
    assert "session" not in payload
