#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="/workspace/JavaScriptSolidServer"

if [ ! -d "$REPO_DIR/.git" ]; then
  git clone "${JSS_REPO_URL}" "$REPO_DIR"
fi

cd "$REPO_DIR"
npm ci

CMD=(node bin/jss.js start --host 0.0.0.0 --port "${JSS_INTERNAL_PORT}" --root "${JSS_DATA_ROOT}")

if [ "${JSS_SSL:-false}" = "true" ]; then
  SSL_KEY_PATH="${JSS_SSL_KEY_PATH:-/certs/privkey.pem}"
  SSL_CERT_PATH="${JSS_SSL_CERT_PATH:-/certs/fullchain.pem}"

  if [ ! -f "$SSL_KEY_PATH" ]; then
    echo "SSL key not found: $SSL_KEY_PATH" >&2
    exit 1
  fi
  if [ ! -f "$SSL_CERT_PATH" ]; then
    echo "SSL cert not found: $SSL_CERT_PATH" >&2
    exit 1
  fi

  CMD+=(--ssl-key "$SSL_KEY_PATH" --ssl-cert "$SSL_CERT_PATH")
fi

exec "${CMD[@]}"
