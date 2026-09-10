"""
Empreinte du client MTProto (spec 4.2.3).

`device_model`, `system_version` et `app_version` sont passés explicitement et
ne doivent **jamais** changer sur la durée de vie d'une session. Laisser
Hydrogram prendre ses défauts les ferait dériver au fil de ses versions et de
celles de Python, ce que Telegram lit comme un changement d'appareil.

Ces valeurs sont donc figées ici, et recopiées à côté de la session au moment
du login: c'est la copie stockée en base qui fait foi ensuite, pas ce fichier.
Modifier les constantes n'affecte que les sessions créées après coup.
"""

from __future__ import annotations

from typing import TypedDict

DEVICE_MODEL = "Backdrop"
SYSTEM_VERSION = "1.0"
APP_VERSION = "backdrop 0.1.0"


class Fingerprint(TypedDict):
    deviceModel: str
    systemVersion: str
    appVersion: str


def current() -> Fingerprint:
    return {
        "deviceModel": DEVICE_MODEL,
        "systemVersion": SYSTEM_VERSION,
        "appVersion": APP_VERSION,
    }
