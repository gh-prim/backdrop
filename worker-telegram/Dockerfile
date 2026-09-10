FROM python:3.12-slim

# tgcrypto se compile: sans compilateur, l'image se construit mais le
# chiffrement MTProto retombe sur une implémentation Python bien plus lente.
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyproject.toml ./
RUN pip install --no-cache-dir \
      "temporalio>=1.9" "hydrogram>=0.1.4" "tgcrypto>=1.2.5" \
      "cryptography>=44" "psycopg[binary]>=3.2"

COPY backdrop_telegram ./backdrop_telegram

CMD ["python", "-m", "backdrop_telegram.worker"]
