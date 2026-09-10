#!/usr/bin/env bash
#
# Mise à jour de l'instance: code, images, schéma, redémarrage.
#
#   sudo ./scripts/update.sh
#
# Un seul geste, dans le bon ordre — et surtout, `docker compose up -d` relance
# le service `migrate` avant tout le reste: le schéma est à jour avant qu'une
# seule requête ne l'atteigne.
set -euo pipefail

cd "$(dirname "$0")/.."
REPO="$PWD"

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

if [ ! -f .env ]; then
  echo "Pas de .env dans $REPO. Le créer à partir de .env.example avant de continuer." >&2
  exit 1
fi

# Docker demande les droits root; git, lui, ne doit surtout pas les avoir: un
# `git pull` en root laisse des objets appartenant à root, et les commandes
# suivantes de l'utilisateur échouent sur des permissions.
if [ -n "${SUDO_USER:-}" ] && [ "${SUDO_USER}" != "root" ]; then
  # `${AS_USER[@]}` sur un tableau vide fait échouer `set -u` sous bash 3:
  # on garde donc deux chemins explicites plutôt qu'un préfixe conditionnel.
  pull() { sudo -u "$SUDO_USER" -H git -C "$REPO" pull --ff-only; }
else
  pull() { git -C "$REPO" pull --ff-only; }
fi

say "Récupération du code"
pull

say "Construction des images"
docker compose build

# `up -d` recrée ce qui a changé et laisse le reste en place. Les migrations
# passent d'abord: web et workers attendent que le conteneur `migrate` soit
# sorti avec succès.
say "Redémarrage de la stack"
docker compose up -d

say "Migrations appliquées"
docker compose logs migrate --tail 5

say "État"
docker compose ps --format 'table {{.Service}}\t{{.Status}}\t{{.Ports}}'

printf '\nÀ jour. Ouvrir %s\n' "$(grep -E '^BETTER_AUTH_URL=' .env | cut -d= -f2- | tr -d '"')"
