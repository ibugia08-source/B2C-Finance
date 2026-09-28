#!/usr/bin/env bash
# Importa os workflows versionados numa instância n8n (CLI do n8n no PATH,
# ou rode dentro do container: docker exec -it n8n sh).
# Os workflows chegam DESATIVADOS e sem credencial ligada — ver README §1.
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)/workflows"
n8n import:workflow --separate --input="$DIR"
echo "Importados de $DIR. Ligue as credenciais em cada nó antes de ativar."
