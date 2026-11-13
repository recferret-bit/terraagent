# Production Deployment Guide (`terraagent.fun`)

Live deployment guide for TerraAgent across all 4 Docker Compose stacks (`infra`, `frontend`, `backend`, `chain`) with **11/11 NEAR ports** bound to NEAR Testnet (`NEAR_MODE=testnet`) and autonomous colony intelligence powered by **NEAR AI Cloud (`z-ai/glm-5.3-flash` TEE inference)**.

---

## Step 1 — DNS & Server Prerequisites

1. **DNS A/AAAA Records:** Point these 8 hosts (`infra/hosts/catalog.json`) to your server's public IP (with Cloudflare proxy / TLS enabled at the edge or reverse proxy):
   - `terraagent.fun`, `play.terraagent.fun`, `api.terraagent.fun`, `playground.terraagent.fun`, `design.terraagent.fun`, `whitepaper.terraagent.fun`, `pitchdeck.terraagent.fun`, `devchain.terraagent.fun`
2. **Server Software & SSH:** Ensure Docker + Docker Compose v2 and `rsync` are installed on the server, and your SSH key is in `~/.ssh/authorized_keys` for your deploy user (`BatchMode=yes` SSH is enforced by `scripts/sites/deploy-plan.mjs`):
   ```bash
   ssh -o BatchMode=yes deploy@<YOUR_SERVER_IP> "docker compose version && rsync --version"
   ```

---

## Step 2 — Set Local Operator `.env` & Verify Dry-Run

Create a local `.env` (git-ignored) with your SSH target (`infra/hosts/.env.example`):

```bash
cat <<'EOF' > .env
TA_DOMAIN=terraagent.fun
DEPLOY_HOST=<YOUR_SERVER_IP_OR_HOSTNAME>
DEPLOY_USER=deploy
EOF

# Preview the exact SSH + rsync + docker compose plan without connecting:
npm run deploy -- --dry-run
```

---

## Step 3 — Push `/srv/terraagent/.env` to the Server

Extract your funded NEAR Testnet credentials from `~/.near-credentials/testnet/*.json`, generate production `JWT_ACCESS_SECRET` + `NEAR_KEK` (which also encrypts player `/me` NEAR.AI BYOK keys at rest with AES-256-GCM), and write `/srv/terraagent/.env` (`chmod 600`):

```bash
source .env
NEARAI_KEY="<YOUR_NEARAI_API_KEY>"

ROOT_SK=$(node -e "console.log(require(process.env.HOME+'/.near-credentials/testnet/terraagent.testnet.json').private_key)")
RELAYER_SK=$(node -e "console.log(require(process.env.HOME+'/.near-credentials/testnet/relayer.terraagent.testnet.json').private_key)")
MINTER_SK=$(node -e "console.log(require(process.env.HOME+'/.near-credentials/testnet/minter.terraagent.testnet.json').private_key)")
JWT_SEC=$(openssl rand -hex 32)
KEK_B64=$(openssl rand -base64 32)

ssh "${DEPLOY_USER}@${DEPLOY_HOST}" "sudo mkdir -p /srv/terraagent && sudo chown \$(whoami) /srv/terraagent && umask 077 && cat > /srv/terraagent/.env" <<EOF
NODE_ENV=production
DATABASE_URL=postgresql://terra:terra@postgres:5432/terraagent
JWT_ACCESS_SECRET=${JWT_SEC}
NEAR_KEK=${KEK_B64}

# Real NEAR Testnet (all 11 NEAR ports live on *.terraagent.testnet + intents.near)
NEAR_MODE=testnet
NEAR_ROOT_ACCOUNT=terraagent.testnet
NEAR_ROOT_SECRET_KEY=${ROOT_SK}
NEAR_RELAYER_SECRET_KEY=${RELAYER_SK}
NEAR_MINTER_SECRET_KEY=${MINTER_SK}
NOTIFY_ALLOW_MOCK_IN_PROD=true

# NEAR AI Cloud (TEE inference + SHA-256 attestation) & Seeded Stage-4 Rival AI Colonies
AI_PROVIDER=nearai
NEAR_AI_API_KEY=${NEARAI_KEY}
NEAR_AI_MODEL=z-ai/glm-5.3-flash
TA_SEED_RIVAL_AI=1
EOF
```

---

## Step 4 — Deploy All 4 Stacks (`infra`, `frontend`, `backend`, `chain`)

Run the automated deployment (`scripts/sites/deploy.mjs`):

```bash
npm run deploy
```

1. **infra stack (`infra/compose/infra.yml`)**: Starts `terra-postgres` (`--profile server`) and `terra-nginx` on port 80 with all 8 vhosts.
2. **frontend stack (`infra/compose/frontend.yml`)**: Builds the Vite bundle (`/play.html`, `/dev/economy-sim/`, `/trade.html`, `/me.html`, `/deed.html`, `/playground.html`, `/whitepaper/`, `/pitchdeck/`, `/design/`) and reloads Nginx.
3. **backend stack (`infra/compose/backend.yml`)**: Builds `terra-app` with `/srv/terraagent/.env`, waits for health, runs `npx prisma migrate deploy`, restarts `terra-app` so `GuildProvisionService` and `MercenaryAccountsService` provision against the migrated DB, and verifies `/v1/healthz`.
4. **chain stack (`infra/compose/chain.yml`)**: Mounts `devchain.terraagent.fun` explorer proxy and reloads Nginx.

*(You can redeploy a single stack anytime with `npm run deploy:backend` or `npm run deploy:frontend`.)*

---

## Step 5 — Live Post-Deploy Verification

```bash
# 1. API health & readiness
curl -fsS https://api.terraagent.fun/v1/healthz
curl -fsS https://api.terraagent.fun/v1/readyz

# 2. Verify NEAR_MODE=testnet & 11/11 testnet port bindings (secrets redacted)
curl -fsS https://api.terraagent.fun/v1/near/status | jq '{nearMode, rootAccount, health, ports}'

# 3. Verify 7-day multi-agent economy sim + NEAR AI Cloud TEE attestation
curl -fsS -X POST https://api.terraagent.fun/v1/economy-sim/run \
  -H 'content-type: application/json' \
  -d '{"days":7,"seed":"42"}' | jq '{days, seed, durationMs, guardrails, ai}'
```

Browser checks:
- `https://play.terraagent.fun/dev/economy-sim/` — 7-day 3-colony trading/war/peace/terraforming report
- `https://play.terraagent.fun/play.html?planet=oceanForest&deploy=1` — HUD `DIRECTOR` (`AI AUTOPILOT: ON` + `Allow War & Diplomacy`), `CULTIVATE [V]`, `Trade Hub -> GUILD OFFERS`
- `https://play.terraagent.fun/me.html` — Authenticated player `NEAR.AI` BYOK API key & model selection
