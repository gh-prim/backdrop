"""
Régression: la boucle de réception partagée ne doit pas mourir avec un client.

Le scénario est celui d'une instance fraîche, observé en production le
2026-09-10: la reprise de la persona échoue faute de base TDLib, son client se
ferme, et le login qui suit n'a jamais reçu le moindre événement — il a attendu
un état d'autorisation qui ne pouvait plus arriver, puis a échoué sur un délai
qui ne désignait pas sa cause.
"""

from __future__ import annotations

import asyncio

import pytest

from backdrop_telegram.tdlib import gateway


class _FakeTDJson:
    """Double minimal: seule la mécanique d'abonnement nous intéresse ici."""

    def __init__(self) -> None:
        self._subscribed_clients: dict[int, object] = {}
        self._listen_task: asyncio.Task | None = None
        self.loops_started = 0

    async def _listen_updates(self) -> None:
        self.loops_started += 1
        try:
            while True:
                await asyncio.sleep(3600)
        except asyncio.CancelledError:
            # Comportement d'aiotdlib, reproduit tel quel: c'est lui qui rend
            # la panne silencieuse.
            self._subscribed_clients.clear()
            self._listen_task = None
            raise


class _Shared(_FakeTDJson):
    """
    Le double, doté des **méthodes réelles** de la passerelle.

    Hériter de `_SharedTDJson` ferait remonter le `_listen_updates` d'aiotdlib
    par le MRO, qui appelle la vraie bibliothèque: on emprunte donc les trois
    méthodes en cause, et rien d'autre.
    """

    subscribe_updates = gateway._SharedTDJson.subscribe_updates
    unsubscribe_updates = gateway._SharedTDJson.unsubscribe_updates
    stop = gateway._SharedTDJson.stop


async def test_la_boucle_survit_au_retrait_du_dernier_client():
    shared = _Shared()

    shared.subscribe_updates(1, object())
    # `create_task` planifie; il faut rendre la main pour que la boucle démarre.
    await asyncio.sleep(0)
    assert shared.loops_started == 1

    # La reprise échoue: son client se ferme et se désabonne. En amont, c'est
    # ici que la boucle mourait.
    shared.unsubscribe_updates(1)
    await asyncio.sleep(0)

    assert shared._listen_task is not None
    assert not shared._listen_task.done()

    # Le login s'abonne juste après: il doit être servi par la même boucle.
    client = object()
    shared.subscribe_updates(2, client)
    await asyncio.sleep(0)

    assert shared.loops_started == 1, "aucune boucle ne doit être recréée"
    assert shared._subscribed_clients == {2: client}

    shared.stop()


async def test_stop_termine_la_boucle():
    shared = _Shared()
    shared.subscribe_updates(1, object())

    shared.stop()
    await asyncio.sleep(0)

    assert shared._listen_task is None
    assert shared._subscribed_clients == {}


async def test_une_boucle_morte_est_relancee_au_prochain_abonnement():
    shared = _Shared()
    shared.subscribe_updates(1, object())
    # Laisser la première boucle démarrer, sinon elle est annulée avant même
    # d'avoir tourné et le décompte ne prouve rien.
    await asyncio.sleep(0)
    shared.stop()
    await asyncio.sleep(0)

    shared.subscribe_updates(2, object())
    await asyncio.sleep(0)
    assert shared.loops_started == 2
    assert shared._listen_task is not None

    shared.stop()
