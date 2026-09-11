"""
Nœud ComfyUI: un format de publication, un latent prêt à échantillonner.

Remplace « Empty Latent Image »: au lieu de retaper une largeur et une hauteur
— et de se tromper d'un cadrage qu'on ne découvre qu'une fois la photo
publiée — on choisit le format de destination, et la résolution qui va avec
est appliquée.

Les tailles sont celles que Backdrop attend en entrée: multiples de 8 exigés
par l'espace latent, au rapport exact du canal visé.
"""

from __future__ import annotations

# Libellé affiché -> (largeur, hauteur)
FORMATS: dict[str, tuple[int, int]] = {
    # Le format à privilégier: Backdrop en tire le 9:16 exact, le 4:5 à 6 %
    # près et le 3:4 sans rien perdre. Aucun agrandissement nulle part.
    "master 3:4 · 1440x1920 — tout dériver sans perte": (1440, 1920),
    # Reels, Stories, Telegram, Fanvue.
    "9:16 · 1080x1920 — vertical plein écran": (1080, 1920),
    # Le plus haut que le fil Instagram accepte depuis 2026.
    "3:4 · 1080x1440 — fil Instagram, hauteur maximale": (1080, 1440),
    # 1088x1360 et non 1080x1350: la hauteur doit être un multiple de 8, or
    # 1350 ne l'est pas — le latent l'arrondirait à 1344 et le rapport ne
    # serait plus exactement 4:5. Backdrop redescend ensuite à 1080x1350.
    "4:5 · 1088x1360 — fil Instagram": (1088, 1360),
    "1:1 · 1080x1080 — carré": (1080, 1080),
    # Tailles de première passe, pour un workflow qui fait ensuite un hires.
    "base 3:4 · 864x1152 — avant hires vers 1440x1920": (864, 1152),
    "base 9:16 · 720x1280 — avant hires vers 1080x1920": (720, 1280),
}

DEFAUT = "master 3:4 · 1440x1920 — tout dériver sans perte"

# L'espace latent travaille au huitième de la résolution, et sur quatre canaux
# pour SD 1.5 et SDXL. Flux et SD3 en attendent seize: pour eux, garder le
# nœud « EmptySD3LatentImage » et brancher les dimensions à la main.
FACTEUR_LATENT = 8
CANAUX = 4


class BackdropFormat:
    """Un choix de format, un latent à la bonne taille."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "format": (list(FORMATS.keys()), {"default": DEFAUT}),
                "batch_size": (
                    "INT",
                    {"default": 1, "min": 1, "max": 64, "step": 1},
                ),
            }
        }

    RETURN_TYPES = ("LATENT",)
    RETURN_NAMES = ("LATENT",)
    FUNCTION = "generate"
    CATEGORY = "Backdrop"
    DESCRIPTION = (
        "Latent vide à la taille d'un format de publication. "
        "Le master 3:4 se dérive en 4:5, 3:4 et 9:16 sans agrandissement."
    )

    def generate(self, format: str, batch_size: int):
        import torch

        width, height = FORMATS[format]

        try:
            # Même appareil que le nœud d'origine: sans ça, le latent naît sur
            # le mauvais périphérique et l'échantillonneur recopie à chaque pas.
            import comfy.model_management

            device = comfy.model_management.intermediate_device()
        except Exception:  # noqa: BLE001 — hors de ComfyUI, le CPU suffit
            device = None

        latent = torch.zeros(
            [batch_size, CANAUX, height // FACTEUR_LATENT, width // FACTEUR_LATENT],
            device=device,
        )
        return ({"samples": latent},)


NODE_CLASS_MAPPINGS = {"BackdropFormat": BackdropFormat}
NODE_DISPLAY_NAME_MAPPINGS = {"BackdropFormat": "Backdrop · format de sortie"}
