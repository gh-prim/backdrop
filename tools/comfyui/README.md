# Nœud ComfyUI — format de sortie

Remplace **Empty Latent Image**: on choisit un format de publication, il rend
le latent à la bonne taille.

- **format** — la destination (fil Instagram, Reel, master…)
- **batch_size** — le nombre d'images du lot
- **sortie: LATENT** — à brancher directement sur le KSampler

## Installer

Créer le dossier:

```
...\ComfyUI\custom_nodes\backdrop_format\
```

et y déposer les deux fichiers:

- <https://raw.githubusercontent.com/gh-prim/backdrop/main/tools/comfyui/backdrop_format/backdrop_format.py>
- <https://raw.githubusercontent.com/gh-prim/backdrop/main/tools/comfyui/backdrop_format/__init__.py>

Redémarrer ComfyUI **entièrement**: `custom_nodes` n'est lu qu'au lancement du
serveur. Le nœud apparaît sous **Backdrop · format de sortie**.

## Les formats

| Choix | Taille | Pour quoi |
|---|---|---|
| **master 3:4** | 1440 × 1920 | le seul qui donne 4:5, 3:4 **et** 9:16 sans agrandir |
| 9:16 | 1080 × 1920 | Reels, Stories, Telegram, Fanvue |
| 3:4 | 1080 × 1440 | fil Instagram, hauteur maximale |
| 4:5 | 1088 × 1360 | fil Instagram, le classique |
| 1:1 | 1080 × 1080 | carré |
| base 3:4 | 864 × 1152 | première passe, avant un hires vers 1440 × 1920 |
| base 9:16 | 720 × 1280 | première passe, avant un hires vers 1080 × 1920 |

Les deux dernières entrées servent aux workflows en deux temps: générer à la
taille réduite, puis agrandir jusqu'à la cible avec un nœud d'upscale. Un
modèle compose mal très au-dessus de sa résolution d'entraînement.

## Pourquoi le master 3:4

Backdrop recadre, il n'invente rien. Depuis un 1440 × 1920:

- **9:16** sort en 1080 × 1920, exact;
- **4:5** perd 6 % de hauteur;
- **3:4** ne perd rien.

Depuis un 720 × 1280, le 4:5 perd **30 % de hauteur** et tout est agrandi de
moitié: des pixels interpolés, qu'Instagram recompresse ensuite.

## Deux détails qui comptent

**4:5 fait 1088 × 1360, pas 1080 × 1350.** L'espace latent travaille au
huitième de la résolution: 1350 n'est pas un multiple de 8 et serait arrondi à
1344, ce qui ne donne plus exactement 4:5. Backdrop redescend ensuite à
1080 × 1350.

**Le latent produit a quatre canaux**, comme celui d'Empty Latent Image: SD 1.5
et SDXL. Pour Flux ou SD3, qui en attendent seize, garder `EmptySD3LatentImage`.
