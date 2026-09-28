#!/usr/bin/env bash
# Exporta os workflows do n8n para workflows/ e normaliza (remove id,
# versionId e datas) para o diff do Git mostrar só o que mudou de verdade.
# Uso: scripts/export.sh <id-do-workflow> <arquivo-destino.json>
set -euo pipefail
ID="${1:?informe o id do workflow no n8n}"
DEST="$(cd "$(dirname "$0")/.." && pwd)/workflows/${2:?informe o arquivo, ex.: agente-whatsapp.consulta.v1.json}"
TMP="$(mktemp)"
n8n export:workflow --id="$ID" --output="$TMP" --pretty
node -e '
  const fs = require("fs");
  let wf = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (Array.isArray(wf)) wf = wf[0];
  for (const k of ["id", "versionId", "createdAt", "updatedAt", "triggerCount", "shared", "isArchived"]) delete wf[k];
  for (const n of wf.nodes || []) delete n.id;
  wf.active = false;
  fs.writeFileSync(process.argv[2], JSON.stringify(wf, null, 2) + "\n");
' "$TMP" "$DEST"
rm -f "$TMP"
node "$(dirname "$0")/check-secrets.mjs"
echo "Exportado para $DEST"
