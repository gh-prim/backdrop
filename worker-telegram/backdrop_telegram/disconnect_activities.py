"""
Déconnexion d'une persona: fermeture du client et effacement de sa base.

Supprimer la ligne en base sans toucher au disque laisserait un répertoire
TDLib autorisé, que le worker rouvrirait au démarrage suivant — une persona
« supprimée » qui continue d'écouter. Et la reconnecter ensuite retomberait
sur cette base, donc sur l'ancien compte.
"""

from __future__ import annotations

import shutil
from typing import Any

from temporalio import activity

from backdrop_telegram.tdlib import pool, sessions


@activity.defn(name="disconnectTelegram")
async def disconnect_telegram(input: dict[str, Any]) -> dict[str, Any]:
    persona_id = input["personaId"]

    # Fermer d'abord: le répertoire est verrouillé tant que le client vit, et
    # l'effacer sous ses pieds laisserait TDLib écrire dans le vide.
    await pool.close(persona_id)

    directory = sessions.session_root() / persona_id
    removed = directory.exists()
    if removed:
        shutil.rmtree(directory, ignore_errors=True)

    activity.logger.info(
        "persona %s déconnectée (base effacée: %s)", persona_id, removed
    )
    return {"sessionRemoved": removed}
