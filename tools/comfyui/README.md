# Nœud ComfyUI — format de sortie

Un nœud, un choix: il rend la résolution du format de publication.

`width` et `height` sont la **taille finale**, celle que Backdrop recevra. Si
ton workflow génère directement à cette taille, ce sont les deux seules
sorties dont tu as besoin.

`base_width` et `base_height` ne servent qu'aux workflows en deux temps: une
passe à taille réduite, puis un hires fix qui agrandit jusqu'à la cible — un
modèle compose mal très au-dessus de sa résolution d'entraînement. Sans hires,
décoche l'interrupteur: la base vaut alors la cible, et les deux paires de
sorties sont identiques.

## Installer

```bash
cp -r tools/comfyui/backdrop_format ~/ComfyUI/custom_nodes/
```

Puis relancer ComfyUI. Le nœud apparaît sous **Backdrop · format de sortie**.

## Brancher

**Sans hires** — le cas simple:

```
Backdrop · format de sortie   (hires décoché)
   ├── width  ─┐
   └── height ─┴─→ Empty Latent Image  →  KSampler
```

**Avec hires** — deux passes:

```
Backdrop · format de sortie   (hires coché)
   ├── base_width  ─┐
   ├── base_height ─┴─→ Empty Latent Image  →  KSampler (passe 1)
   ├── width  ─┐
   ├── height ─┴─→ Upscale Image / Latent Upscale  →  KSampler (hires)
   └── info  →  (facultatif) Preview Text: rappelle le facteur appliqué
```

## Les formats

| Choix | Base | Cible | Pour quoi |
|---|---|---|---|
| **master 3:4** | 864 × 1152 | **1440 × 1920** | le seul qui donne 4:5, 3:4 **et** 9:16 sans agrandir |
| 9:16 | 720 × 1280 | 1080 × 1920 | Reels, Stories, Telegram, Fanvue |
| 3:4 | 864 × 1152 | 1080 × 1440 | fil Instagram, hauteur maximale |
| 4:5 | 896 × 1120 | 1080 × 1350 | fil Instagram, le classique |
| 1:1 | 1024 × 1024 | 1080 × 1080 | carré |

## Pourquoi le master 3:4

Backdrop recadre, il n'invente rien. Depuis un 1440 × 1920:

- **9:16** sort en 1080 × 1920, exact;
- **4:5** perd 6 % de hauteur;
- **3:4** ne perd rien.

Depuis un 720 × 1280 — le format généré jusqu'ici — le 4:5 perd **30 % de
hauteur** et tout est agrandi d'un facteur 1,5: des pixels interpolés, qu'
Instagram recompresse ensuite.

Si ×1,67 est trop pour ton modèle en une passe, deux options: enchaîner deux
hires plus doux, ou renoncer au master et générer deux fois — en 9:16 pour le
vertical, en 3:4 pour le fil.
