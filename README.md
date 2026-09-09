# Backdrop

Outil interne d'administration multi-persona: Instagram, Telegram, Fanvue.
Un média uploadé une fois, envoyé sur plusieurs canaux, programmé et mesuré.

**[`spec.md`](spec.md) est la source de vérité.** Toute décision qui le
contredit doit être remontée avant d'être codée.

État: **phase 0** (fondations). Aucun worker, aucune publication réelle.

## Démarrer

```bash
cp .env.example .env      # puis remplir les secrets
docker compose up -d      # postgres, postgres-temporal, temporal, temporal-ui
pnpm install
pnpm db:migrate
pnpm db:seed              # crée l'organisation et le premier owner
pnpm dev
```

| Service | Adresse |
|---|---|
| Application | http://localhost:3100 |
| Temporal UI | http://localhost:8233 |
| PostgreSQL applicatif | `localhost:5434` |

Les ports 3100 et 5434 ne sont pas les ports par défaut: 3000 et 5432 sont
fréquemment occupés sur une machine de développement, et le binding Docker perd
silencieusement l'arbitrage sur 5432. Tout est paramétrable dans `.env`.

Identifiants du seed: `owner@backdrop.local` / `backdrop-owner-2026`, ou les
valeurs de `SEED_OWNER_EMAIL` et `SEED_OWNER_PASSWORD`. **Les changer avant
tout usage réel.**

## Tests

```bash
pnpm test
```

La suite tourne sur une base dédiée (`backdrop_test`), migrée automatiquement.
Elle couvre les garanties que le spec exige de prouver:

- le garde-fou de rating en base, y compris le carrousel dont un seul élément
  sur dix est NSFW, et le contournement par déplacement d'une publication vers
  un autre canal;
- l'isolation par organisation, y compris la résolution d'un identifiant
  étranger forgé;
- l'opacité des credentials plateforme, avec un garde structurel qui échoue si
  un composant se met à lire la colonne;
- le cycle de vie des invitations, seule voie de création de compte.

## Structure

```
prisma/schema.prisma      modèle de données (spec section 8)
prisma/migrations/        dont le trigger SQL anti-NSFW
src/lib/session.ts        scope serveur: l'organizationId vient de la session
src/lib/channels.ts       projection sûre des ChannelAccount, sans credentials
src/lib/invitations.ts    invitations et création de compte
scripts/                  sondes isolées (test bloquant Telegram 4.2.6)
docs/findings/            décisions de phase 0, sourcées
```

## Ce qui n'est pas encore là

Les workers, ffmpeg, R2, les adapters de plateforme et la publication réelle.
Voir le plan en section 12 du spec: phase 1 Instagram, phase 2 Telegram,
phase 3 Composer et DM, phase 4 Fanvue et insights.
