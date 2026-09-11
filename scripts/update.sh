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

# Les images viennent du registre, construites par GitHub Actions. Le serveur
# a 3 Go de mémoire: un `next build` et deux installations pnpm y prenaient
# une vingtaine de minutes à faire s'échanger de la mémoire. `--build` reste
# disponible pour un dépannage hors ligne.
if [ "${1:-}" = "--build" ]; then
  say "Construction locale des images"
  docker compose build
else
  say "Récupération des images"
  if ! docker compose pull --quiet; then
    echo "Images indisponibles. Le workflow GitHub est-il terminé ?" >&2
    echo "  https://github.com/gh-prim/backdrop/actions" >&2
    echo "Sinon, construire sur place: ./scripts/update.sh --build" >&2
    exit 1
  fi
fi

# `up -d` recrée ce qui a changé et laisse le reste en place. Les migrations
# passent d'abord: web et workers attendent que le conteneur `migrate` soit
# sorti avec succès.
say "Redémarrage de la stack"
docker compose up -d

# Seulement maintenant: tant que `up -d` n'a pas réussi, les images
# précédentes sont le seul retour en arrière disponible.
say "Nettoyage des images remplacées"
docker image prune -f

# Le cache de construction est le vrai glouton — plusieurs Go après quelques
# déploiements. On le borne au lieu de le vider: à sec, chaque mise à jour
# reconstruirait tout depuis zéro. Le nom de l'option a changé selon les
# versions de buildkit, d'où les deux essais.
docker builder prune -f --max-used-space 5GB >/dev/null 2>&1 \
  || docker builder prune -f --keep-storage 5GB >/dev/null 2>&1 \
  || true

say "Migrations appliquées"
docker compose logs migrate --tail 5

# Le 2026-09-11, une construction a échoué par manque de place **après** que
# `git pull` eut avancé le dépôt: le fichier était à jour sur le serveur,
# l'image non, et le script annonçait « À jour ». On ne se fie donc plus au
# dépôt mais à ce que l'application sert elle-même.
say "Version servie"
ATTENDUE="$(grep -m1 '"version"' package.json | cut -d'"' -f4)"
# Interrogé depuis l'hôte, sur le port publié: l'image web est minimale et
# n'embarque ni curl ni wget. Une vérification qui suppose des outils dans le
# conteneur échouerait toujours, et bloquerait tous les déploiements au lieu
# d'en signaler un seul.
PORT_WEB="$(docker compose port web 3000 2>/dev/null | cut -d: -f2)"
PORT_WEB="${PORT_WEB:-3110}"
SERVIE=""
for _ in $(seq 1 30); do
  SERVIE="$(curl -fsS --max-time 3 "http://127.0.0.1:${PORT_WEB}/api/version" 2>/dev/null \
    | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')"
  [ -n "$SERVIE" ] && break
  sleep 2
done

if [ "$SERVIE" != "$ATTENDUE" ]; then
  printf '\n\033[1;31mDéploiement incomplet: le dépôt est en %s, l'"'"'application sert %s.\033[0m\n' \
    "$ATTENDUE" "${SERVIE:-rien}" >&2
  echo "Relancer, et lire les erreurs de construction plutôt que cette ligne." >&2
  exit 1
fi
echo "v${SERVIE} — conforme au dépôt."

say "État"
docker compose ps --format 'table {{.Service}}\t{{.Status}}\t{{.Ports}}'

printf '\nÀ jour. Ouvrir %s\n' "$(grep -E '^BETTER_AUTH_URL=' .env | cut -d= -f2- | tr -d '"')"
