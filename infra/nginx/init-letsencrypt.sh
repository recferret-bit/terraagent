#!/usr/bin/env bash
set -euo pipefail

# Issues the initial Let's Encrypt certificate for terraagent.fun and all subdomains,
# then reloads terra-nginx so HTTPS (443) and HTTP->HTTPS redirect activate immediately.
# Usage: CERTBOT_EMAIL=admin@terraagent.fun ./infra/nginx/init-letsencrypt.sh

EMAIL="${CERTBOT_EMAIL:-}"
if [ -z "${EMAIL}" ]; then
  echo "Set CERTBOT_EMAIL (e.g. CERTBOT_EMAIL=ops@terraagent.fun $0)" >&2
  exit 1
fi

STAGING_ARG=""
if [ "${CERTBOT_STAGING:-0}" = "1" ]; then
  STAGING_ARG="--staging"
fi

DOMAINS=(
  terraagent.fun
  www.terraagent.fun
  play.terraagent.fun
  api.terraagent.fun
  playground.terraagent.fun
  design.terraagent.fun
  whitepaper.terraagent.fun
  pitchdeck.terraagent.fun
  devchain.terraagent.fun
)

DOMAIN_ARGS=()
for d in "${DOMAINS[@]}"; do
  DOMAIN_ARGS+=(-d "$d")
done

docker compose --profile server -f infra/compose/infra.yml up -d nginx

docker compose --profile server -f infra/compose/infra.yml run --rm --entrypoint certbot certbot \
  certonly --webroot -w /var/www/certbot \
  --email "${EMAIL}" --agree-tos --no-eff-email \
  --cert-name terraagent.fun --expand \
  ${STAGING_ARG} \
  "${DOMAIN_ARGS[@]}"

# Sync tls-server/ssl.conf and reload nginx immediately.
docker exec terra-nginx sh -c '
  if [ -f /etc/letsencrypt/live/terraagent.fun/fullchain.pem ]; then
    mkdir -p /etc/nginx/tls-server
    cp /etc/nginx/tls-available/ssl.conf /etc/nginx/tls-server/ssl.conf
    nginx -t && nginx -s reload
  fi
'

docker compose --profile server -f infra/compose/infra.yml up -d certbot
echo "HTTPS enabled and certbot auto-renewal container running."
