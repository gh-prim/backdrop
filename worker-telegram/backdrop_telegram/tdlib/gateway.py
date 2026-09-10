"""
Passerelle TDLib: un processus, plusieurs personas.

TDLib est prévue pour héberger plusieurs comptes dans un même processus —
`td_create_client_id()` en crée autant qu'on veut, chacun avec son répertoire.
Mais `td_receive` est **global à la bibliothèque**: il renvoie les événements
de tous les clients, étiquetés par `@client_id`.

aiotdlib fabrique un objet `TDJson` — donc une boucle de réception — **par
client**. Deux personas dans un processus se disputeraient alors la même file,
et le tri de leur boucle est sans pitié:

    if client_id in self._subscribed_clients:
        await self._subscribed_clients[client_id].enqueue_update(update)

Pas de `else`: un événement qui n'appartient pas à cette boucle est jeté en
silence. Chaque persona perdrait une part de ses messages, au hasard, sans
erreur ni trace. Pour une inbox qui répond automatiquement, c'est la panne la
plus coûteuse qui soit — on croit le système sain.

Cette passerelle impose donc **un seul `TDJson` pour tout le processus**, ce
qui rétablit le comportement prévu par TDLib.
"""

from __future__ import annotations

import logging
import threading
from typing import Optional

from aiotdlib import tdjson as _tdjson

from backdrop_telegram.tdlib import patches

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_shared: Optional["_tdjson.TDJson"] = None
_library_path: Optional[str] = None


def configure(library_path: Optional[str] = None) -> None:
    """À appeler une fois au démarrage du worker, avant tout client."""
    global _library_path
    patches.install()
    _library_path = library_path


def shared_tdjson() -> "_tdjson.TDJson":
    global _shared
    with _lock:
        if _shared is None:
            patches.install()
            path = _library_path or _tdjson._get_bundled_tdjson_lib_path()
            _shared = _tdjson.TDJson(library_path=path)
            logger.info("TDJson partagé créé (%s)", path)
        return _shared


def install_shared_receiver() -> None:
    """
    Fait pointer tous les clients aiotdlib sur le `TDJson` partagé.

    On remplace la fabrique plutôt que de bricoler chaque client après coup:
    ainsi aucun chemin de code ne peut créer une seconde boucle de réception,
    y compris à l'intérieur d'aiotdlib.
    """
    patches.install()

    def create(cls, library_path: Optional[str] = None):
        # `library_path` est ignoré: il n'y a qu'une bibliothèque chargée, et
        # en accepter deux rouvrirait exactement le défaut qu'on corrige.
        return cls(shared_tdjson())

    _tdjson.TDJsonClient.create = classmethod(create)
    logger.debug("fabrique TDJsonClient redirigée vers le TDJson partagé")


def reset_for_tests() -> None:
    global _shared
    with _lock:
        _shared = None
