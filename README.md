# Backdrop

Outil interne d'administration multi-persona: Instagram, Telegram, Fanvue.
Un média uploadé une fois, envoyé sur plusieurs canaux, programmé et mesuré.

**[`spec.md`](spec.md) est la source de vérité.** Toute décision qui le
contredit doit être remontée avant d'être codée.

État: **phase 1**. Le worker tourne, la chaîne Instagram est complète et testée
contre un double du Graph API. Il manque un compte Instagram réel pour la
valider en production.

## Démarrer

```bash
cp .env.example .env      # puis remplir les secrets
docker compose up -d      # bases, Temporal, console, worker-node
pnpm install
pnpm db:migrate
pnpm db:seed              # crée l'organisation et le premier owner
pnpm worker:schedules     # enregistre le refresh des tokens Meta (45 jours)
pnpm dev
```

Pour itérer sur le worker sans reconstruire l'image:

```bash
docker compose stop worker-node && pnpm worker
```

| Service | Adresse |
|---|---|
| Application | http://localhost:3100 |
| Temporal UI | http://localhost:8233 |
| PostgreSQL applicatif | `localhost:5434` |
| Worker | conteneur `worker-node`, queue `backdrop-node` |

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
- le cycle de vie des invitations, seule voie de création de compte;
- l'orchestration de publication, sur un serveur Temporal à temps accéléré:
  attente de l'échéance, bascule en `MISSED` au-delà de la tolérance sans
  toucher à l'extérieur, carrousel dont un enfant échoue, quota épuisé,
  reprogrammation par signal, et refus du doublon de workflow;
- la classification des erreurs Graph en réessayables ou non;
- le chiffrement des credentials et les frontières de modules serveur.

## Structure

```
prisma/schema.prisma      modèle de données (spec section 8)
prisma/migrations/        dont le trigger SQL anti-NSFW
src/lib/session.ts        scope serveur: l'organizationId vient de la session
src/lib/channels.ts       projection sûre des ChannelAccount, sans credentials
src/lib/invitations.ts    invitations et création de compte
src/lib/channels/         contrat d'adapter et adapter Instagram
src/temporal/config.ts    constantes, importables depuis un workflow
src/temporal/env.ts       configuration, jamais importée depuis un workflow
worker/activities/        activités: elles seules résolvent les credentials
worker/workflows/         publishInstagram, ingestVariant, refreshMetaTokens
scripts/                  sondes isolées (test bloquant Telegram 4.2.6)
docs/findings/            décisions de phase 0, sourcées
```

## Ce qui n'est pas encore là

Telegram, Fanvue, le Composer multi-canal et les insights. Voir le plan en
section 12 du spec: phase 2 Telegram, phase 3 Composer et DM, phase 4 Fanvue.

Côté phase 1, trois points de la Definition of Done attendent un compte
Instagram réel: la publication effective d'une image, d'un carrousel et d'un
Reel. Tout ce qui les entoure est vérifié contre un double du Graph API.
R2 non configuré signifie des Variants sans URL publique, donc une publication
qui échoue avec un message explicite plutôt qu'un appel à Meta voué à l'échec.
