# Epic TA-02 — Infra: Postgres, NATS, nginx, Deploy

> **Orchestrator:** [`EXECUTION_ORCHESTRATOR.md`](../EXECUTION_ORCHESTRATOR.md) · **Status Board:** [`STATUS.md`](../STATUS.md)
> **Spec:** [`ARCHITECTURE.md`](../../spec/ARCHITECTURE.md) §3, §4, §5, §6, §14 · [`DEPLOYMENT.md`](../../spec/DEPLOYMENT.md) · [`DECISIONS.md`](../../spec/DECISIONS.md) D-05, D-06, D-07 · Reference: `../freightchain/infra/deploy`

> **Owner decisions (2026-10-29, D-23):** single region; launch host **4 vCPU / 8 GB** (load test may raise it); **Cloudflare** proxy TLS (origin cert, Full strict); **R2** for off-site backups; **no HSTS preload** at launch. TA-02.5 implements Cloudflare + R2 only.

## Overview

This epic covers everything that runs the services, from a laptop to production. It includes:
- a dev compose with Postgres 16 and NATS JetStream shared by all lanes
- an idempotent JetStream/KV bootstrap generated from `@terra/contracts`
- images for 4 backend apps and 2 static frontends
- nginx with subdomain and per-worker WebSocket routing
- a production compose with TLS, backups, and a drain-aware deploy/rollback
- a local prod-like stack on `*.terraagent.localhost`

## Epic analytics

- **Goal / user value:** a player reaches `terraagent.com`, `game.terraagent.com`, `api.terraagent.com` and the right worker on `ws.terraagent.com/w/{id}`. Deploys don't lose a single planet command.
- **Success metrics:**
  - `npm run infra:up` → healthy in < 30 s.
  - Bootstrap is idempotent (2nd run = 0 changes).
  - Image build < 5 min (warm cache).
  - `nginx:test` 100 % of routing cases.
  - Rolling deploy with 2 workers → 0 lost commands, client reconnect < 30 s.
  - `stack:local:smoke` green.
- **In scope:** dev compose; lane DB init; NATS streams/KV bootstrap; Dockerfiles; nginx templates + worker map generator; prod compose; TLS modes; secrets layout; backup; deploy/rollback scripts; local prod-like stack + smoke.
- **Out of scope:** monitoring stack (TA-13.2, `infra/monitoring/**` in W5); app code; DNS/Cloudflare account actions (`OWNER_TASKS.md`).
- **Key risks:**
  - nginx variable `proxy_pass` needs a resolver → docker DNS `127.0.0.11`.
  - JetStream streams capturing request/reply subjects → exact subject lists + a test.
  - Lockfile conflicts from infra tooling → infra scripts use only workspace deps or plain Node.
  - Port 80/443 collisions → only L5 and barrier runs bind them (§1.5).

## Architecture overview

```mermaid
flowchart TB
  subgraph dev["Dev / CI (infra/docker-compose.yml)"]
    PGd[("postgres:16 :15434<br/>terraagent, terraagent_test,<br/>terraagent_lane1..5_test")]
    NATSd[("nats:2.10 -js :14222 / mon :18222")]
    BOX["nats-box (profile tools)"]
  end
  BOOT["infra/nats/bootstrap.mjs --ns ta|l1..l5<br/>reads @terra/contracts STREAMS + KV_BUCKETS"] --> NATSd
  subgraph prod["Prod (infra/deploy/docker-compose.prod.yml + workers.yml)"]
    NGX["nginx (static landing+game, api, ws map)"] --> CORE["core"] & PW["planet-worker-1..N"]
    CORE & PW & AI["ai-orchestrator"] & NEAR["near-gateway"] --> PG[("postgres")] & NATS[("nats")]
  end
  DEP["infra/deploy/scripts/deploy.sh<br/>backup → migrate → bootstrap → swap (drain workers) → smoke → rollback"] --> prod
```

Folder layout:
```text
infra/
├── docker-compose.yml              # TA-02.1
├── postgres/init/01-lane-dbs.sql   # TA-02.1
├── nats/
│   ├── nats-server.dev.conf        # TA-02.1
│   ├── nats-server.prod.conf       # TA-02.5 (users + permissions)
│   ├── bootstrap.mjs               # TA-02.2
│   └── test/bootstrap.test.mjs
└── deploy/
    ├── docker/Dockerfile.node (+ .dockerignore)   # TA-02.3 (ARG APP)
    ├── docker/Dockerfile.nginx (+ .dockerignore)  # TA-02.3 / TA-02.4
    ├── docker/Dockerfile.migrate                  # TA-02.3
    ├── nginx/templates/*.conf.template, nginx/snippets/*.conf, nginx/generated/   # TA-02.4
    ├── docker-compose.prod.yml, .env.example      # TA-02.5
    ├── scripts/{deploy.sh, lib.sh, gen-workers.mjs, validate-env.mjs, backup.sh, remote/*}  # TA-02.5
    ├── local/{docker-compose.local.yml, certs/}   # TA-02.6
    └── test/*.test.mjs
```

## Task index

| Task | Title | Wave / Lane | Depends On |
|---|---|---|---|
| `TA-02.1` | Dev compose: Postgres 16 + NATS JetStream + nats-box, lane test DB init | W0 / Lead | TA-01.1 |
| `TA-02.2` | JetStream streams & KV bootstrap generated from contracts | W1 / L5 | TA-01.3, TA-02.1 |
| `TA-02.3` | Multi-stage Dockerfiles for 4 backend apps + 2 static frontends | W1 / L5 | TA-01.1, TA-03.2 |
| `TA-02.4` | nginx: apex/www/game/api/ws server blocks, WS upgrade, worker map, rate limits, security headers | W2 / L5 | TA-02.3 |
| `TA-02.5` | Prod compose + TLS + deploy/rollback script with worker drain | W3 / L5 | TA-02.2, TA-02.3, TA-02.4, TA-07.5 |
| `TA-02.6` | Local prod-like stack on `*.terraagent.localhost` + smoke script | W4 / L5 | TA-02.5, TA-05.5 |

---

## Tasks

### `TA-02.1` — Dev compose: Postgres 16 + NATS JetStream + nats-box, lane test DB init

- **Status:** `[ ] Todo`
- **Wave / Lane:** `W0 / Lead`
- **Depends On:** `TA-01.1`
- **Spec:** [`ARCHITECTURE.md`](../../spec/ARCHITECTURE.md) §5.1, §5.2 · [`EXECUTION_ORCHESTRATOR.md`](../EXECUTION_ORCHESTRATOR.md) §1.5 (lane isolation)
- **Target Files:**
  - `infra/docker-compose.yml`
  - `infra/postgres/init/01-lane-dbs.sql`
  - `infra/nats/nats-server.dev.conf`
  - root `package.json` scripts: `infra:up`, `infra:down`, `infra:reset`, `infra:logs`
  - `infra/README.md`
- **Verify:** `npm run infra:up && docker compose -f infra/docker-compose.yml ps --format json | node -e "…all healthy…" && npm run infra:down`

#### Analytics
- **Problem & goal:** every lane and CI needs the same Postgres and NATS without per-agent setup. Isolation comes from database names and `TA_NS`, not from separate containers.
- **Constraints:**
  - Postgres **16**, host port **15434**, role `terra`/`terra_dev_password`, DBs `terraagent`, `terraagent_test`, `terraagent_lane{1..5}_test`.
  - NATS **2.10+** with JetStream, client **14222**, monitor **18222**.
  - Persistent named volumes in dev; `infra:reset` wipes them.
  - Must not collide with freightchain's 15433.
- **Risks → mitigations:**
  - Init scripts only run on an empty volume → `infra:reset` documented, and the harness (TA-13.1) also runs `CREATE DATABASE IF NOT EXISTS` equivalents.
  - JetStream disk fills → dev limits `max_file_store 2GB`.
  - Apple Silicon images → multi-arch official images only.
- **Alternatives rejected:** one container per lane (5× RAM, port juggling); Testcontainers per test file (slow; the shared stack + namespacing is enough).
- **Telemetry (proves it works):** container healthchecks (`pg_isready`, `wget -qO- :8222/healthz?js-enabled-only=true`); `infra:up` prints a readiness summary.

#### Architecture
```yaml
name: terraagent-dev
services:
  postgres:
    image: postgres:16-alpine
    environment: { POSTGRES_USER: terra, POSTGRES_PASSWORD: terra_dev_password, POSTGRES_DB: terraagent }
    ports: ["127.0.0.1:15434:5432"]
    volumes: [pgdata:/var/lib/postgresql/data, ./postgres/init:/docker-entrypoint-initdb.d:ro]
    healthcheck: { test: ["CMD-SHELL","pg_isready -U terra -d terraagent"], interval: 3s, retries: 30 }
  nats:
    image: nats:2.10-alpine
    command: ["-c","/etc/nats/nats-server.conf"]   # jetstream { store_dir: /data, max_file_store: 2GB }, http: 8222
    ports: ["127.0.0.1:14222:4222","127.0.0.1:18222:8222"]
    volumes: [natsdata:/data, ./nats/nats-server.dev.conf:/etc/nats/nats-server.conf:ro]
    healthcheck: { test: ["CMD","wget","-qO-","http://localhost:8222/healthz?js-enabled-only=true"], interval: 3s, retries: 30 }
  nats-box:
    image: natsio/nats-box:latest
    profiles: [tools]
    environment: { NATS_URL: nats://nats:4222 }
volumes: { pgdata: {}, natsdata: {} }
```
Ports bind to `127.0.0.1` only. `01-lane-dbs.sql` creates `terraagent_test` and `terraagent_lane1_test` … `terraagent_lane5_test` owned by `terra`.

#### Definition of Ready (DoR)
- [ ] TA-01.1 workspace root exists (root `package.json` for the scripts).
- [ ] Ports 15434/14222/18222 are confirmed free next to freightchain's dev stack.

#### Definition of Done (DoD)
- [ ] `npm run infra:up` → both services healthy in < 30 s on a clean machine; `infra:down` stops them; `infra:reset` removes the volumes.
- [ ] `psql postgresql://terra:terra_dev_password@127.0.0.1:15434/terraagent_lane3_test -c 'select 1'` works for all 5 lane DBs + `terraagent_test`.
- [ ] `curl 127.0.0.1:18222/jsz` shows JetStream enabled.
- [ ] `infra/README.md` documents ports, DBs, lane isolation and reset.
- [ ] Status synced in orchestrator, issue file and STATUS.md (§1.6).

---

### `TA-02.2` — JetStream streams & KV bootstrap generated from contracts

- **Status:** `[ ] Todo`
- **Wave / Lane:** `W1 / L5`
- **Depends On:** `TA-01.3`, `TA-02.1`
- **Spec:** [`ARCHITECTURE.md`](../../spec/ARCHITECTURE.md) §6.1, §6.2 · [D-07](../../spec/DECISIONS.md#d-07--ta_ns-namespace) · [`NEAR.md`](../../spec/NEAR.md) §9 (exact subjects caution) · [`AI_ORCHESTRATOR.md`](../../spec/AI_ORCHESTRATOR.md) §4
- **Target Files:**
  - `infra/nats/bootstrap.mjs`
  - `infra/nats/test/bootstrap.test.mjs`
  - `infra/nats/README.md`
- **Verify:** `npm run nats:bootstrap -- --ns l5 && npm run nats:bootstrap -- --ns l5 --check && node --test infra/nats/test/`

#### Analytics
- **Problem & goal:** streams and buckets must exist with exactly the contract's configuration in every namespace (dev, CI, lanes, prod). Services verify them but never create them, so drift is impossible.
- **Constraints:**
  - The source of truth is `@terra/contracts` exports `STREAMS` and `KV_BUCKETS` (TA-01.3).
  - Namespace substitution: `{ns}` → `TA_NS`, `{NS}` → upper-case.
  - Idempotent.
  - Refuse destructive changes (retention/storage/subjects removal) unless `--force`.
  - Plain Node + `nats` package from `@terra/contracts`' dependency tree, so no new root dependency.
- **Risks → mitigations:**
  - A stream subject overlaps request/reply subjects (`near.verify`, `*.ctl`) and JetStream would PubAck requests → a test asserts that no stream subject matches any request/reply subject from contracts.
  - Prod drift → `--check` mode exits 1 on any diff (used in deploy and readiness docs).
  - KV TTL semantics → bucket `ttl` = 15 s for `workers` and `planet_leases`, none for `presence`.
- **Alternatives rejected:** each service creating its streams on boot (racy, config drift between versions); NACK/JetStream controller CRDs (Kubernetes-only).
- **Telemetry (proves it works):** script output `created|updated|unchanged` per resource; `--check` exit code; JSON summary `--json` for CI.

#### Architecture
| Resource | Subjects / key | Config (from ARCHITECTURE §6, specs) |
|---|---|---|
| `{NS}_PLANET_CMDS` | `{ns}.planet.*.cmd`, `{ns}.planet.*.tick` (tick markers, PROTOCOL NT-11) | limits retention, file, `max_age 48h`, `duplicate_window 2m`, discard old, replicas 1 |
| `{NS}_PLANET_EVENTS` | `{ns}.planet.*.evt.>` | limits, file, `max_age 7d`, `duplicate_window 2m` |
| `{NS}_AI_REQUESTS` | `{ns}.ai.request` | **workqueue**, `max_age 10m`, `duplicate_window 2m` |
| `{NS}_NEAR_JOBS` | `{ns}.near.account.provision`, `{ns}.near.registry.>` | **workqueue**, `max_age 7d` |
| `{NS}_NEAR_EVENTS` | `{ns}.near.evt.>`, `{ns}.trade.evt.>` | limits, file, `max_age 7d`, `duplicate_window 2m` |
| KV `{ns}_workers` | `workerId` | `ttl 15s`, history 1 |
| KV `{ns}_planet_leases` | `planetId` | `ttl 15s`, history 1 |
| KV `{ns}_presence` | `colonyId` | no TTL, history 1 |

CLI: `node infra/nats/bootstrap.mjs --ns <ns> [--url nats://127.0.0.1:14222] [--check] [--force] [--json] [--creds file]`. Root script `nats:bootstrap` delegates to it.

#### Definition of Ready (DoR)
- [ ] `@terra/contracts` exports `STREAMS`, `KV_BUCKETS` and the list of request/reply subjects (TA-01.3). If the shape differs, a **contract change request (W1 pre-step)** asks for a machine-readable export.
- [ ] **Root script change request (lead):** `"nats:bootstrap": "node infra/nats/bootstrap.mjs"`.

#### Definition of Done (DoD)
- [ ] First run on a fresh `l5` → all 5 streams + 3 buckets created; second run → all `unchanged`; `--check` exit 0.
- [ ] A manually altered `max_age` → `--check` exit 1, normal run updates it; a subject removal without `--force` → refused with exit 2.
- [ ] `bootstrap.test.mjs`: the namespace substitution is correct for `ta` and `l1..l5`; no stream subject matches a request/reply subject (`*.ctl`, `near.verify`, `near.account.status`, `trade.offer.list`, `ai.ctl`); no two streams overlap; KV TTLs equal ARCHITECTURE §6.2 (15 s).
- [ ] Two namespaces bootstrapped side by side do not interfere (`l1` and `l5`).
- [ ] TA-13.1 harness calls the bootstrap for the lane namespace (documented in `infra/nats/README.md`).
- [ ] Status synced in orchestrator, issue file and STATUS.md (§1.6).

---

### `TA-02.3` — Multi-stage Dockerfiles for 4 backend apps + 2 static frontends

- **Status:** `[ ] Todo`
- **Wave / Lane:** `W1 / L5`
- **Depends On:** `TA-01.1`, `TA-03.2`
- **Spec:** [`DEPLOYMENT.md`](../../spec/DEPLOYMENT.md) §1, §4 · [`ARCHITECTURE.md`](../../spec/ARCHITECTURE.md) §3 (ports)
- **Target Files:**
  - `infra/deploy/docker/Dockerfile.node`, `Dockerfile.node.dockerignore`
  - `infra/deploy/docker/Dockerfile.nginx`, `Dockerfile.nginx.dockerignore`
  - `infra/deploy/docker/Dockerfile.migrate`, `Dockerfile.migrate.dockerignore`
  - `infra/deploy/scripts/build-images.sh`
  - `infra/deploy/test/images.test.mjs`
- **Verify:** `npm run images:build && node --test infra/deploy/test/images.test.mjs`

#### Analytics
- **Problem & goal:** reproducible, small, non-root images for `core`, `planet-worker`, `ai-orchestrator`, `near-gateway`; one nginx image carrying both static builds; a migrate image with the Prisma CLI so runtime images stay without dev dependencies (freightchain keeps dev deps in runtime; we fix that).
- **Constraints:**
  - Build context = repo root (workspaces).
  - Node 24 bookworm-slim (freightchain baseline).
  - `npm ci` with the root lockfile.
  - `npm run build -w @terra/<app>` + `npm prune --omit=dev`.
  - Shared packages compiled first.
  - Per-Dockerfile `.dockerignore` (BuildKit) so no root `.dockerignore` is needed.
  - Image names `terraagent-<app>:<RELEASE>`.
- **Risks → mitigations:**
  - Workspace hoisting copies the whole monorepo `node_modules` → `npm prune --omit=dev --workspace @terra/<app> --include-workspace-root=false` + a size budget test.
  - Prisma engines mismatch → `binaryTargets` from TA-03.1 includes `debian-openssl-3.0.x`.
  - The nginx image bakes the wrong env → the static build reads runtime config from `/config.json` served by nginx, rendered from env at container start.
- **Alternatives rejected:** one image for all backends with different `CMD` (bigger attack surface, all deps in every container); distroless (no shell for healthcheck `wget`; can revisit).
- **Telemetry (proves it works):** `images.test.mjs` prints image sizes (budget: backend ≤ 350 MB, nginx ≤ 80 MB, migrate ≤ 450 MB), `USER` = non-root, `HEALTHCHECK` present.

#### Architecture
```dockerfile
# Dockerfile.node — ARG APP=core|planet-worker|ai-orchestrator|near-gateway
FROM node:24-bookworm-slim AS deps
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/*/package.json  ... (each workspace manifest)
RUN npm ci --ignore-scripts
FROM deps AS build
COPY shared/ shared/ ; COPY backend/ backend/
RUN npx prisma generate --schema shared/db/prisma/schema.prisma \
 && npm run build -w @terra/contracts -w @terra/config -w @terra/db -w @terra/sim -w @terra/${APP} \
 && npm prune --omit=dev
FROM node:24-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates wget && rm -rf /var/lib/apt/lists/*
USER node
WORKDIR /app
COPY --from=build --chown=node:node /repo /app      # pruned
ENV NODE_ENV=production
HEALTHCHECK CMD wget -qO- http://127.0.0.1:${PORT}/readyz || exit 1
CMD ["node","backend/${APP}/dist/main.js"]
```
- `Dockerfile.nginx`: two build stages (`npm run build -w @terra/landing`, `-w @terra/game`) → `nginx:1.27-alpine` with `/srv/www/landing`, `/srv/www/game` and `/etc/nginx/templates` (templates filled in TA-02.4; this task ships a minimal default template).
- `Dockerfile.migrate`: the build stage + Prisma CLI. `CMD npx prisma migrate deploy --schema shared/db/prisma/schema.prisma`. The same image runs `infra/nats/bootstrap.mjs`.

#### Definition of Ready (DoR)
- [ ] All 4 backend apps and both frontends have `build` scripts (W1 skeleton tasks in L1/L3/L4/L5). Missing ones are stubbed with a hello-world `main.ts` from the lead's W0 skeleton.
- [ ] **Root script change request (lead):** `"images:build": "bash infra/deploy/scripts/build-images.sh"`.
- [ ] Prisma `binaryTargets` include the runtime target (TA-03.1).

#### Definition of Done (DoD)
- [ ] `npm run images:build` builds 6 images (`core`, `planet-worker`, `ai-orchestrator`, `near-gateway`, `nginx`, `migrate`) tagged `:dev` and `:<git-sha>`.
- [ ] `images.test.mjs`: each backend image runs as non-root, has a HEALTHCHECK, contains no `devDependencies` (`typescript`, `vitest` absent), and is within its size budget; the nginx image serves `/` and `/index.html` for both sites with a stub config.
- [ ] `docker run terraagent-migrate:dev` against the lane DB applies migrations (exit 0).
- [ ] A build-cache rebuild after a one-line app change < 90 s (recorded).
- [ ] Status synced in orchestrator, issue file and STATUS.md (§1.6).

---

### `TA-02.4` — nginx: apex/www/game/api/ws server blocks, WS upgrade, worker map, rate limits, security headers

- **Status:** `[ ] Todo`
- **Wave / Lane:** `W2 / L5`
- **Depends On:** `TA-02.3`
- **Spec:** [`DEPLOYMENT.md`](../../spec/DEPLOYMENT.md) §2 (DEP-02, DEP-03) · [`ARCHITECTURE.md`](../../spec/ARCHITECTURE.md) §4, §13 (close codes, ping 20 s) · [D-06](../../spec/DECISIONS.md#d-06--path-based-worker-routing)
- **Target Files:**
  - `infra/deploy/nginx/templates/00-maps.conf.template`, `10-landing.conf.template`, `20-game.conf.template`, `30-api.conf.template`, `40-ws.conf.template`, `50-www.conf.template`
  - `infra/deploy/nginx/snippets/{tls.conf, ws.conf, proxy.conf, security-headers.conf, csp-game.conf, csp-landing.conf, static-cache.conf}`
  - `infra/deploy/nginx/generated/.gitkeep`
  - `infra/deploy/scripts/gen-workers.mjs` (writes `nginx/generated/workers.map`; compose part in TA-02.5)
  - `infra/deploy/nginx/test/docker-compose.nginx-test.yml` (stub upstreams), `infra/deploy/nginx/test/routing.test.mjs`
- **Verify:** `npm run test -w @terra/game && npm run build -w @terra/game && npm run nginx:test`

#### Analytics
- **Problem & goal:** one edge that serves both static apps, proxies the API and the lobby WS to core, and routes each planet WebSocket to the exact worker that owns it, safely, with no open proxying.
- **Constraints:**
  - Hosts from `TA_DOMAIN` (`terraagent.com` / `terraagent.localhost`).
  - Worker ids `^pw-[0-9]{1,3}$`; unknown → 404.
  - WS idle timeout 75 s (client pings every 20 s).
  - Rate limits per DEPLOYMENT §2.1.
  - CSP must allow `'wasm-unsafe-eval'` for decoders.
  - CORS stays in core.
- **Risks → mitigations:**
  - Variable `proxy_pass` without a resolver → 502 → docker DNS resolver `127.0.0.11 valid=10s`.
  - The map lags behind the compose workers → both are generated by `gen-workers.mjs` from `PLANET_WORKERS`.
  - The CSP breaks the wallet selector → `CSP_CONNECT_EXTRA`/`CSP_FRAME_EXTRA` hooks agreed with TA-11.
  - Cloudflare real IP → `real_ip_header CF-Connecting-IP` only when `TLS_MODE=cloudflare`.
- **Alternatives rejected:** a subdomain per worker (needs wildcard DNS/cert; kept as the D-06 alternative); sticky hashing across a worker pool (the planet→worker mapping is lease-based, not hash-based).
- **Telemetry (proves it works):** JSON access log format with `host`, `uri`, `status`, `upstream_addr`, `request_time`, `upgrade` (`$http_upgrade`), `worker_id`; `limit_req` rejections at 429 logged with zone; the routing test report.

#### Architecture
Config as sketched in [`DEPLOYMENT.md`](../../spec/DEPLOYMENT.md) §2.1. The official nginx image's `/etc/nginx/templates/*.template` envsubst renders `${TA_DOMAIN}`, `${CSP_CONNECT_EXTRA}`, `${CSP_FRAME_EXTRA}` (`NGINX_ENVSUBST_FILTER=^(TA_|CSP_|TLS_)`). `TLS_MODE=off|selfsigned|cloudflare|certbot` selects the `tls.conf` variant (port 80 only when `off`).

`routing.test.mjs` runs the nginx image + 3 stub upstreams (`core` echo, `planet-worker-1` and `planet-worker-2` WS echo that report their `WORKER_ID`) and asserts:

| Case | Expect |
|---|---|
| `GET https://terraagent.<d>/` | 200 landing, CSP-landing, HSTS |
| `GET https://www.terraagent.<d>/x?y=1` | 301 → apex, path and query kept |
| `GET https://game.<d>/play/deep/link` | 200 `index.html` (SPA fallback) |
| `GET https://game.<d>/assets/app.123.js` | `Cache-Control: … immutable` |
| `GET https://api.<d>/v1/healthz` | 200 from core stub |
| `GET https://api.<d>/other` | 404 |
| WS `wss://api.<d>/ws` | upgrade reaches core stub |
| WS `wss://ws.<d>/w/pw-2` | upgrade reaches worker-2 (echoes `pw-2`), path `/w/pw-2` preserved |
| WS `wss://ws.<d>/w/pw-99` · `/w/../core` · `/w/pw-1/x` | 404 |
| 30 rapid `/v1/auth/guest` | some 429 (`ta_auth`) |
| idle WS with pings every 20 s for 90 s | stays open; without pings → closed ~75 s |

#### Definition of Ready (DoR)
- [ ] Nginx image from TA-02.3 exists.
- [ ] Wallet-selector origins for the CSP agreed with TA-11 (or left empty with a hook).
- [ ] **Root script change request (lead):** `"nginx:test": "node --test infra/deploy/nginx/test/"`.

#### Definition of Done (DoD)
- [ ] All routing cases in the table above pass in `npm run nginx:test`, which includes `nginx -t` on the rendered config.
- [ ] `gen-workers.mjs --workers 3` writes a map with `pw-1..pw-3`; the test proves `pw-3` routes and `pw-4` 404s.
- [ ] Security headers present on every static and api response (HSTS, nosniff, Referrer-Policy, Permissions-Policy, CSP on html); `frame-ancestors 'none'` verified.
- [ ] Access logs are JSON and include `worker_id` for ws hosts.
- [ ] Status synced in orchestrator, issue file and STATUS.md (§1.6).

---

### `TA-02.5` — Prod compose + TLS + deploy/rollback script with worker drain

- **Status:** `[ ] Todo`
- **Wave / Lane:** `W3 / L5`
- **Depends On:** `TA-02.2`, `TA-02.3`, `TA-02.4`, `TA-07.5` (worker drain), `TA-05.5` (reassignment — same wave, contract-only: the deploy script calls the drain via the admin subject and waits on KV)
- **Spec:** [`DEPLOYMENT.md`](../../spec/DEPLOYMENT.md) §1, §3, §4, §5, §6 (DEP-01, 04..09) · [`ARCHITECTURE.md`](../../spec/ARCHITECTURE.md) §14 · freightchain `infra/deploy/README.md` (flow reference)
- **Target Files:**
  - `infra/deploy/docker-compose.prod.yml`, `infra/deploy/.env.example`
  - `infra/deploy/scripts/{deploy.sh, lib.sh, gen-workers.mjs (compose output), validate-env.mjs, init-env.mjs, backup.sh, rollback.sh, status.sh}`
  - `infra/deploy/scripts/remote/{setup.sh, release.sh, drain-workers.sh, restore.sh}`
  - `infra/deploy/systemd/{terraagent-backup.service, terraagent-backup.timer}`
  - `infra/nats/nats-server.prod.conf`
  - `infra/deploy/README.md`
  - `infra/deploy/test/{compose-config.test.mjs, validate-env.test.mjs, deploy-plan.test.mjs}`
- **Verify:** `npm run test -w @terra/game && npm run build -w @terra/game && npm run deploy:dry-run`

#### Analytics
- **Problem & goal:** one command ships a release to the server with a backup, forward-only migrations, stream bootstrap, and a rolling swap that drains workers so no planet loses commands. Failure rolls back automatically, as freightchain's flow does, extended for workers, NATS and containerised nginx.
- **Constraints:**
  - Only nginx publishes ports (DEP-01); Postgres and NATS on `internal: true`; AI and NEAR on `egress`.
  - File secrets under `/srv/terraagent/secrets`.
  - Expand-only migrations (DEP-06).
  - Workers drained one by one (DEP-07).
  - `TLS_MODE=cloudflare|certbot`.
  - Builds from `git archive HEAD` (DEP-09).
- **Risks → mitigations:**
  - The drain hangs → 120 s timeout + warn + continue; planets are reassigned by the TA-05.5 scheduler.
  - Single-worker deploy causes a gap → documented (≤ 30 s), and the default is `PLANET_WORKERS=2`.
  - Rollback across a migration → the expand-only rule is checked by `deploy-plan.test.mjs` heuristics (no `DROP`/`RENAME` in new migrations without the `-- contract:` marker).
  - certbot renewal fails silently → `deploy:status` shows the cert expiry; alert in TA-13.2.
- **Alternatives rejected:** Kubernetes (overkill for one host at MVP); host nginx like freightchain (two config sources; documented as option C).
- **Telemetry (proves it works):**
  - Deploy log `state/releases.log` (release, duration, result).
  - `deploy:status` output (containers, release, cert expiry, worker planets).
  - Backup files with sizes.
  - Drain timings per worker logged.

#### Architecture
Services, networks, secrets, backup and the deploy sequence exactly as [`DEPLOYMENT.md`](../../spec/DEPLOYMENT.md) §1–§6.
- `gen-workers.mjs` (extended from TA-02.4): one source `PLANET_WORKERS=N` → `docker-compose.workers.yml` (`planet-worker-1..N`, `WORKER_ID=pw-n`, same anchor) + `nginx/generated/workers.map`.
- Drain step: the script uses `nats` CLI in the `nats-box` sidecar (bootstrap creds) to send `{ns}.worker.pw-n.ctl {op:"drain"}`. It polls KV `{ns}_workers.pw-n.planets` until 0 or 120 s, then recreates the container and waits for the KV registration.
- `validate-env.mjs` rules from DEPLOYMENT §4; `init-env.mjs` generates the secrets (never overwrites).
- `nats-server.prod.conf`: users `core|worker|ai|near|bootstrap` with publish/subscribe permissions scoped by role.

#### Definition of Ready (DoR)
- [ ] TA-07.5 defines the drain semantics on `{ns}.worker.{id}.ctl` and the `planets` field in `{ns}_workers` (W1, done).
- [ ] Owner decisions: TLS option (A/B), server host + SSH access, DNS records for `@`, `www`, `game`, `api`, `ws` (`OWNER_TASKS.md`). Without them, the DoD is limited to `--dry-run` + local, and the real deploy item is `[!] Blocked`.
- [ ] **Root script change request (lead):** `deploy`, `deploy:dry-run`, `deploy:init`, `deploy:setup`, `deploy:status`, `deploy:logs`, `deploy:backup`, `deploy:rollback`, `deploy:restore` → `infra/deploy/scripts/*`.

#### Definition of Done (DoD)
- [ ] `compose-config.test.mjs` (DEP-01): the rendered compose has `ports` only on nginx; postgres/nats only on the internal network; ai/near on egress; every app container non-root, read-only, with a healthcheck.
- [ ] `validate-env.test.mjs` (DEP-04/08): refuses `CHANGE_ME`, `AI_PROVIDER=mock` in prod, `NEAR_NETWORK=mainnet` without `NEAR_ALLOW_MAINNET=1`, a mismatched ticket keypair.
- [ ] `deploy-plan.test.mjs`: `--dry-run` prints the ordered plan (backup → migrate → bootstrap → ai/near → core → pw-1 drain/swap → pw-2 drain/swap → nginx → smoke); refuses a dirty tree without `--allow-dirty`; flags a migration containing `DROP COLUMN` without the `-- contract:` marker.
- [ ] Local rehearsal (`TLS_MODE=selfsigned`, 2 workers, mock AI, sandbox NEAR): a release swap with a client connected → the client gets `4012`, resumes via `/me/home` < 30 s, the command count in `{NS}_PLANET_CMDS` before/after matches with no gaps (asserted by a script in `infra/deploy/test/`).
- [ ] `deploy:rollback` returns to the previous images with the same drain loop (rehearsed locally).
- [ ] Backup timer files and `backup.sh` produce a pg dump + stream backups; `restore.sh` documented and rehearsed once locally.
- [ ] `infra/deploy/README.md` covers commands, server layout, env and secrets, TLS modes and the restore procedure.
- [ ] Status synced in orchestrator, issue file and STATUS.md (§1.6).

---

### `TA-02.6` — Local prod-like stack on `*.terraagent.localhost` + smoke script

- **Status:** `[ ] Todo`
- **Wave / Lane:** `W4 / L5`
- **Depends On:** `TA-02.5`, `TA-05.5`
- **Spec:** [`DEPLOYMENT.md`](../../spec/DEPLOYMENT.md) §7 · [`ARCHITECTURE.md`](../../spec/ARCHITECTURE.md) §4 (local hosts), §7 (home/ticket path), §14 (failover)
- **Target Files:**
  - `infra/deploy/local/docker-compose.local.yml` (sandbox NEAR, mock AI, `TLS_MODE=selfsigned|off`)
  - `infra/deploy/local/gen-certs.sh` (mkcert if present, else openssl self-signed for `terraagent.localhost` + `*.terraagent.localhost`)
  - `infra/deploy/scripts/local-stack.sh`, `infra/deploy/scripts/local-smoke.mjs`
  - `infra/deploy/test/local-smoke.selftest.mjs`
- **Verify:** `npm run test -w @terra/game && npm run stack:local:smoke`

#### Analytics
- **Problem & goal:** before any real deploy, run the exact production topology (nginx + subdomains + 2 workers + all services) on a laptop and prove routing, auth, the resume path and drain/failover in one command. It is part of the W4 barrier.
- **Constraints:**
  - Binds 80/443 → L5 or barrier only.
  - Node's resolver may not resolve `*.localhost` → the smoke pins DNS to 127.0.0.1 (custom `lookup` for `undici`/`ws`).
  - Self-signed TLS → the smoke trusts the generated CA.
  - Mock AI, sandbox NEAR.
- **Risks → mitigations:**
  - Flaky timing on slow machines → each check has a bounded retry (≤ 30 s), and the drain check uses the KV state, not sleeps.
  - Leftover containers → unique compose project `terraagent-local` + `down -v` on exit (unless `--keep`).
- **Alternatives rejected:** testing routing only with stub upstreams (TA-02.4 does that; this task needs the real apps); `/etc/hosts` edits (`*.localhost` already resolves in browsers).
- **Telemetry (proves it works):** smoke JSON report (`infra/deploy/local/out/smoke.json`): per-check pass/fail + duration; a drain → reassign duration measurement.

#### Architecture
`npm run stack:local` = `gen-certs` → `images:build` (cached) → `docker compose -p terraagent-local -f docker-compose.prod.yml -f docker-compose.workers.yml -f local/docker-compose.local.yml up -d` → migrate → nats-bootstrap.

`local-smoke.mjs` checks, in order:
1. `https://terraagent.localhost/` 200 + CSP; `https://www.terraagent.localhost/` 301.
2. `https://game.terraagent.localhost/play` 200 (SPA).
3. `https://api.terraagent.localhost/v1/healthz` 200; `/nope` 404.
4. Guest login → `GET /v1/me/home` = `NEW`; planets list has ≥ 1 `RECRUITING` (warm pool).
5. Join → `ACTIVE` with `ws` = `wss://ws.terraagent.localhost/w/pw-N` + ticket → WS `hello` → `welcome` + ≥ 3 `delta`.
6. Bad hello → close `4000`; `/w/pw-99` → 404.
7. Burst on `/v1/auth/guest` → 429.
8. Drain `pw-N` (admin API from TA-04.7, or the ctl subject) → the client gets `4012`; `/me/home` resolves the other worker within 30 s; reconnect → `welcome` with tick ≥ the previous tick.
9. `--restore-drill` (optional): backup → wipe → restore → planet resumes.

#### Definition of Ready (DoR)
- [ ] TA-02.5 prod compose + scripts done (W3).
- [ ] TA-05.5 reassignment and TA-04.7 admin drain endpoint exist (W3/W4 L1; same wave as TA-04.7: the smoke falls back to the ctl subject if the admin API is not merged yet).
- [ ] **Root script change request (lead):** `"stack:local": "bash infra/deploy/scripts/local-stack.sh up"`, `"stack:local:smoke": "bash infra/deploy/scripts/local-stack.sh smoke"`, `"stack:local:down"`.

#### Definition of Done (DoD)
- [ ] `npm run stack:local:smoke` passes checks 1–8 on a clean machine in < 5 min (cold images excluded) and exits non-zero on any failure, with the JSON report written.
- [ ] `local-smoke.selftest.mjs`: the DNS pinning resolves `*.terraagent.localhost` to 127.0.0.1 in Node; the report schema is validated.
- [ ] The drain/reassign duration is recorded in the report and ≤ 30 s (ARCHITECTURE §14 RTO).
- [ ] The stack tears down cleanly (`docker ps` shows no `terraagent-local` containers) unless `--keep`.
- [ ] Status synced in orchestrator, issue file and STATUS.md (§1.6).
