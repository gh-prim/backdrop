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
docker compose up -d      # toute la stack, migrations comprises
pnpm db:seed              # crée l'organisation et le premier owner
pnpm worker:schedules     # enregistre le refresh des tokens Meta (45 jours)
```

`up` lève les bases, Temporal, l'application et les deux workers. Le service
`migrate` applique le schéma une fois et sort; web et workers l'attendent,
plutôt que de migrer chacun à leur démarrage — deux répliques qui migrent en
même temps se marcheraient dessus.

| Service | Adresse |
|---|---|
| Application | http://localhost:3100 |
| Temporal UI | http://localhost:8233 |
| PostgreSQL applicatif | `localhost:5434` |
| Worker Node | conteneur `worker-node`, queue `backdrop-node` |
| Worker Telegram | conteneur `worker-telegram`, queue `backdrop-telegram` |

### Développer

Le service web occupe le port 3100. Pour coder avec le rechargement à chaud,
lui rendre la place:

```bash
docker compose stop web && pnpm install && pnpm dev
```

Même chose pour les workers, sans reconstruire leur image:

```bash
docker compose stop worker-node && pnpm worker
docker compose stop worker-telegram && cd worker-telegram && uv run python -m backdrop_telegram.worker
```

### Le worker Telegram et ses sessions

Une persona connectée est un **répertoire TDLib chiffré**, pas une chaîne en
base: il vit dans le volume `telegram-sessions`, et le perdre impose de
reconnecter chaque persona depuis l'application. Le worker hôte écrit lui dans
`worker-telegram/.tdlib-sessions/`; passer de l'un à l'autre demande donc de
recopier le répertoire, process arrêté des deux côtés:

```bash
docker compose stop worker-telegram
docker run --rm -v backdrop_telegram-sessions:/sessions \
  -v "$PWD/worker-telegram/.tdlib-sessions":/src:ro alpine \
  sh -c 'cp -a /src/. /sessions/'
docker compose start worker-telegram
```

Un seul des deux à la fois: deux processus sur la même session déclenchent
`AUTH_KEY_DUPLICATED` et la détruisent (spec 4.2.2).

Les ports 3100 et 5434 ne sont pas les ports par défaut: 3000 et 5432 sont
fréquemment occupés sur une machine de développement, et le binding Docker perd
silencieusement l'arbitrage sur 5432. Tout est paramétrable dans `.env`.

Identifiants du seed: `owner@backdrop.local`, ou `SEED_OWNER_EMAIL`. Le mot de
passe vient de `SEED_OWNER_PASSWORD`; sans lui, le script en tire un au hasard
et l'affiche **une seule fois** — le noter à ce moment-là.

Il n'y a délibérément pas de mot de passe par défaut: écrit dans le dépôt, il
serait connu de quiconque le lit, et il ouvre le compte qui administre l'outil.

## Déployer sur un serveur

### Où vit la configuration

**Dans `.env`, à côté du `docker-compose.yml`. Jamais dans le YAML.**

Compose lit ce fichier tout seul et remplace les `${VARIABLE}` du
`docker-compose.yml` au moment du `up`. Le YAML est versionné et ne contient
donc aucun secret: il ne fait que **désigner** les variables.

Deux couches à ne pas confondre:

| | Où | Rôle |
|---|---|---|
| Interpolation Compose | `${SITE_ADDRESS:-localhost}` dans le YAML | façonne le fichier lui-même: ports publiés, chemins montés |
| Environnement du conteneur | bloc `environment:` du service | ce que le processus voit à l'intérieur |

La conséquence pratique: **une variable ajoutée à `.env` n'atteint pas un
conteneur tant qu'elle n'est pas listée dans son bloc `environment:`.** Le
fichier `.env` sert aussi à l'outillage sur l'hôte (`pnpm dev`, la CLI Prisma,
les scripts), qui le lit directement — d'où la confusion possible: ce qui
marche en développement sur l'hôte peut manquer dans le conteneur.

`.env` n'est pas versionné. Sur le serveur, il se crée à partir de
`.env.example`, qui liste tout ce qui compte avec des valeurs de départ.

Les deux secrets sans valeur par défaut — `CREDENTIALS_MASTER_KEY` et
`BETTER_AUTH_SECRET` — font échouer `docker compose up` avec leur nom et la
commande qui les génère. Un démarrage qui réussit sans eux ne serait qu'un
échec repoussé au premier envoi.

### Construire et lancer

Tout se construit sur place, aucune image à publier:

```bash
git clone … && cd backdrop
cp .env.example .env      # puis remplir les secrets
docker compose up -d --build
```

### Sur un réseau local

Le cas courant: une machine du réseau, joignable par son IP.

```
SITE_ADDRESS=192.168.1.50
TLS_OPTIONS=internal
WEB_HTTPS_PORT=443
BETTER_AUTH_URL=https://192.168.1.50
AUTH_TRUSTED_ORIGINS=https://192.168.1.50
```

Let's Encrypt ne certifie pas une adresse privée: Caddy émet donc lui-même le
certificat, avec son autorité locale. Le navigateur avertit tant que cette
autorité n'est pas approuvée. Pour ne plus le voir, installer la racine sur les
postes qui utilisent l'outil:

```bash
docker compose cp proxy:/data/caddy/pki/authorities/local/root.crt caddy-root.crt
# macOS
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain caddy-root.crt
# Ubuntu
sudo cp caddy-root.crt /usr/local/share/ca-certificates/caddy-root.crt && sudo update-ca-certificates
```

Rien n'a besoin d'être exposé sur Internet, **y compris pour Fanvue**: la
plateforme n'appelle jamais le `redirect_uri`, elle y renvoie le navigateur de
l'opérateur. Une adresse privée suffit donc, du moment que ce navigateur est
sur le même réseau — c'est l'URL à déclarer telle quelle dans l'app Fanvue.

### Sur un domaine public

```
SITE_ADDRESS=backdrop.example.com
TLS_OPTIONS=ops@example.com
WEB_HTTPS_PORT=443
ACME_PORT=80
BETTER_AUTH_URL=https://backdrop.example.com
AUTH_TRUSTED_ORIGINS=https://backdrop.example.com
```

Le DNS doit déjà pointer sur la machine et le port 80 être publié: c'est là que
Let's Encrypt valide le domaine.

### Mettre à jour

```bash
git pull && docker compose up -d --build
```

Le service `migrate` s'exécute **à chaque démarrage**, avant tout le reste:
il applique `prisma migrate deploy`, puis sort. L'application et les workers
attendent qu'il ait terminé (`service_completed_successfully`), et ne démarrent
donc jamais sur un schéma en retard. Quand il n'y a rien à appliquer, il le dit
et rend la main en une seconde.

Ce n'est pas le service web qui migre, délibérément: deux répliques qui
migreraient à leur démarrage se marcheraient dessus.

### La clé de chiffrement

`CREDENTIALS_MASTER_KEY` déchiffre les credentials plateforme et les bases
TDLib. La changer, ou en générer une nouvelle sur le serveur, rend illisible
tout ce qui a été chiffré avec l'ancienne: **chaque canal serait à reconnecter**.
Pour transporter une installation, passer par Réglages → Backup, qui scelle les
identifiants sous une phrase de passe (voir `src/lib/config-backup.ts`).

Deux choses ne voyagent jamais avec la configuration: les **médias**, qui
vivent sur le volume, et les **sessions Telegram**, qui sont des répertoires
TDLib liés à la machine. Sur un nouveau serveur, chaque persona Telegram
redemande un code de connexion.

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
