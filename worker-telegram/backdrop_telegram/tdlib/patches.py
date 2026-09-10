"""
Correctifs appliqués à aiotdlib avant toute utilisation.

Deux défauts empêchent de s'en servir tel quel. Ils sont corrigés ici, en un
seul endroit, plutôt que contournés au cas par cas dans le code applicatif —
c'est la raison d'être de cette couche.

`install()` est idempotent et doit être appelé avant la création du premier
client. Le module `gateway` s'en charge.
"""

from __future__ import annotations

import ctypes
import logging

from aiotdlib import tdjson as _tdjson

logger = logging.getLogger(__name__)

_installed = False

# Gardé au niveau module: TDLib conserve le pointeur brut. Si Python libérait
# l'objet, TDLib sauterait dans de la mémoire libérée à sa ligne de log
# suivante. C'est la moitié du bug corrigé ici.
_LOG_CALLBACK = _tdjson.LogMessageCallback(lambda level, message: None)


class _PatchedCDLL(ctypes.CDLL):
    """
    Neutralise l'enregistrement fautif du callback de log.

    aiotdlib 0.27.6 déclare:

        td_set_log_message_callback.argtypes = [LogMessageCallback]
        td_set_log_message_callback(LogMessageCallback(...))

    alors que l'en-tête officiel de TDLib est:

        void td_set_log_message_callback(int max_verbosity_level,
                                         td_log_message_callback_ptr callback)

    Il manque donc un paramètre. Sur arm64 le pointeur de callback atterrit
    dans le registre lu comme `max_verbosity_level`, et TDLib enregistre comme
    callback ce qui traînait dans le registre suivant. Il saute dedans dès sa
    première ligne de log: SIGSEGV pendant la construction du client, avant
    qu'aucun correctif applicatif ne puisse s'exécuter.

    D'où l'interception au chargement de la bibliothèque: on enregistre
    nous-mêmes, correctement, puis on rend inerte l'appel d'aiotdlib.
    """

    def __getattr__(self, name):
        fn = super().__getattr__(name)
        if name != "td_set_log_message_callback":
            return fn

        fn.restype = None
        fn.argtypes = [ctypes.c_int, _tdjson.LogMessageCallback]
        # Verbosité 1: seules les erreurs fatales, qu'on ignore de toute façon.
        # TDLib écrit par ailleurs sur stderr, ce qui suffit au diagnostic.
        fn(1, _LOG_CALLBACK)
        logger.debug("callback de log TDLib enregistré avec la bonne signature")

        def inerte(*_args):
            return None

        return inerte


def install() -> None:
    global _installed
    if _installed:
        return

    _tdjson.CDLL = _PatchedCDLL
    _installed = True
    logger.debug("correctifs aiotdlib installés")
