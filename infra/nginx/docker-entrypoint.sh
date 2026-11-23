#!/bin/sh
set -eu

CERT_FILE="/etc/letsencrypt/live/terraagent.fun/fullchain.pem"
KEY_FILE="/etc/letsencrypt/live/terraagent.fun/privkey.pem"
SRC_CONF="/etc/nginx/tls-available/ssl.conf"
DST_DIR="/etc/nginx/tls-server"
DST_CONF="${DST_DIR}/ssl.conf"

sync_tls_conf() {
  mkdir -p "${DST_DIR}"
  if [ -f "${CERT_FILE}" ] && [ -f "${KEY_FILE}" ] && [ -f "${SRC_CONF}" ]; then
    cp "${SRC_CONF}" "${DST_CONF}"
  else
    rm -f "${DST_CONF}"
  fi
}

sync_tls_conf

# Reload nginx every 6 hours so renewed Let's Encrypt certificates are picked up automatically.
(
  while :; do
    sleep 6h
    sync_tls_conf
    nginx -s reload >/dev/null 2>&1 || true
  done
) &

exec /docker-entrypoint.sh nginx -g "daemon off;"
