"""
Nœud ComfyUI: choisir un format de publication, obtenir sa résolution.

`width` et `height` sont la **taille finale**, celle que Backdrop recevra:
c'est la seule qui compte pour publier. Branchées sur un Empty Latent, elles
génèrent directement à cette taille.

`base_width` et `base_height` ne servent qu'aux workflows en deux temps — une
passe à taille réduite, puis un hires fix qui agrandit jusqu'à la cible. Un
modèle de diffusion compose mal très au-dessus de sa résolution
d'entraînement, d'où l'usage. Si ton workflow n'a pas de hires, ignore ces
deux sorties: elles ne dérangent rien.

Les bases sont des multiples de 32 au rapport exact — ce que SDXL et Flux
avalent sans déformer.
"""

from __future__ import annotations

# (base_w, base_h, cible_w, cible_h, à quoi ça sert)
PRESETS: dict[str, tuple[int, int, int, int, str]] = {
    # Le format à privilégier: il contient les deux autres sans agrandir.
    # 4:5 n'y perd que 6 % de hauteur, le 9:16 en sort exact.
    "master 3:4 — tout dériver sans perte": (864, 1152, 1440, 1920, "master"),
    # Reels, Stories, Telegram, Fanvue.
    "9:16 — vertical plein écran": (720, 1280, 1080, 1920, "reel"),
    # Le plus haut que le fil Instagram accepte.
    "3:4 — fil Instagram, hauteur maximale": (864, 1152, 1080, 1440, "feed"),
    # Le classique du fil.
    "4:5 — fil Instagram": (896, 1120, 1080, 1350, "feed"),
    "1:1 — carré": (1024, 1024, 1080, 1080, "feed"),
}

DEFAUT = "master 3:4 — tout dériver sans perte"


class BackdropFormat:
    """Un choix de format, deux résolutions cohérentes."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "format": (list(PRESETS.keys()), {"default": DEFAUT}),
                # Décoché: la passe de base sert directement de sortie, sans
                # hires. Utile pour un test rapide, pas pour publier.
                # Coché: la génération démarre à `base_*` puis monte à la
                # taille finale. Décoché: elle se fait directement à la taille
                # finale, et les sorties `base_*` valent la cible.
                "hires": ("BOOLEAN", {"default": True}),
            }
        }

    # La taille finale d'abord: c'est ce qu'on branche dans neuf cas sur dix.
    RETURN_TYPES = ("INT", "INT", "INT", "INT", "STRING")
    RETURN_NAMES = (
        "width",
        "height",
        "base_width",
        "base_height",
        "info",
    )
    FUNCTION = "resolve"
    CATEGORY = "Backdrop"
    DESCRIPTION = (
        "Résolutions de génération et de hires pour un format de publication. "
        "Le master 3:4 se dérive en 4:5, 3:4 et 9:16 sans jamais agrandir."
    )

    def resolve(self, format: str, hires: bool):
        base_w, base_h, cible_w, cible_h, usage = PRESETS[format]

        # Sans passe de hires, la génération se fait d'emblée à la taille
        # finale: la base vaut alors la cible, et brancher l'une ou l'autre
        # revient au même.
        if not hires:
            base_w, base_h = cible_w, cible_h

        facteur = cible_w / base_w
        info = (
            f"{usage} · {cible_w}x{cible_h}"
            + (f" depuis {base_w}x{base_h} (x{facteur:.2f})" if facteur > 1 else "")
        )
        return (cible_w, cible_h, base_w, base_h, info)


NODE_CLASS_MAPPINGS = {"BackdropFormat": BackdropFormat}
NODE_DISPLAY_NAME_MAPPINGS = {"BackdropFormat": "Backdrop · format de sortie"}
