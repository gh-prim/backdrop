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

# Chaque mise à jour laisse les images précédentes de web et des workers sans
# tag, et elles ne disparaissent pas seules: c'est ce qui a rempli le disque.
# Une construction qui manque de place échoue au milieu de l'extraction d'une
# couche, avec un message qui ne dit pas quoi faire — autant refuser avant.
FREE_GB_MIN=6
docker_free_gb() {
  local root
  root="$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || echo /var/lib/docker)"
  df -BG --output=avail "$root" 2>/dev/null | tail -1 | tr -dc '0-9'
}

say "Place disponible"
FREE_GB="$(docker_free_gb)"
if [ -n "$FREE_GB" ]; then
  echo "${FREE_GB} Go libres pour Docker."
  if [ "$FREE_GB" -lt "$FREE_GB_MIN" ]; then
    cat >&2 <<MSG

Moins de ${FREE_GB_MIN} Go libres: la construction échouerait en cours
d'extraction. À récupérer, du plus sûr au plus radical:

  docker builder prune -f          # cache de construction
  docker image prune -f            # images sans tag, déjà remplacées
  docker system df                 # voir ce qui reste, et par quoi

MSG
    exit 1
  fi
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

say "État"
docker compose ps --format 'table {{.Service}}\t{{.Status}}\t{{.Ports}}'

printf '\nÀ jour. Ouvrir %s\n' "$(grep -E '^BETTER_AUTH_URL=' .env | cut -d= -f2- | tr -d '"')"
