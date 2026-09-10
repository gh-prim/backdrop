# worker-telegram: activités MTProto, via TDLib.
#
# Singleton par nécessité (spec 7.3): deux processus partageant une session
# déclenchent AUTH_KEY_DUPLICATED et la détruisent. L'image ne change rien à
# cette contrainte, qui se règle côté Compose (`replicas: 1`).
FROM python:3.12-slim

# TDLib est une bibliothèque C++ compilée: la roue aiotdlib embarque le binaire
# de la plateforme (libtdjson_linux_{amd64,arm64}.so), mais pas la runtime
# LLVM contre laquelle il est lié. Sans libc++, le worker démarre et échoue au
# premier dlopen, très loin de sa cause.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libc++1 libc++abi1 ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Les versions sont épinglées dans pyproject: on l'installe lui, plutôt que de
# répéter la liste ici et de la voir diverger.
COPY pyproject.toml README.md* ./
COPY backdrop_telegram ./backdrop_telegram
RUN pip install --no-cache-dir .

# Répertoires TDLib: une persona connectée est un dossier chiffré sur disque,
# pas une chaîne en base (4.2.1). Le perdre, c'est refaire tous les logins.
ENV TELEGRAM_SESSION_ROOT=/sessions
VOLUME ["/sessions"]

CMD ["python", "-m", "backdrop_telegram.worker"]
