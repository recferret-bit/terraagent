# TerraAgent — Deployment Specification

> **Status:** v0.3 (2026-11-01). One host, HTTP on port 80, four compose stacks, SSH deploy. No Cloudflare, no certbot, no R2 (D-37). The 4 vCPU / 8 GB host size stays (D-23). One app (D-24). · **Parent:** [`ARCHITECTURE.md`](./ARCHITECTURE.md) §4 · **Decision:** [`DECISIONS.md`](./DECISIONS.md) D-37 · **Plan:** [`W26`](../plan/waves/W26-sites.md) builds this. [`W25`](../plan/waves/W25-launch-ops.md) adds hardening, backups, monitoring and the submission on top.

---

## 1. Topology

One Linux host (Ubuntu 22.04+ / Debian 12, Docker + the compose plugin) runs the public sites. The laptop runs the same compose files. The dev Postgres in `infra/docker-compose.yml` (host port **15434**, `npm run db:up`) stays the worktree database and is not part of this stack.

```mermaid
flowchart TB
  browser["browser or curl"] --> NGX
  subgraph host["one host, HTTP :80"]
    NGX["infra: nginx"]
    subgraph edge["network terra_edge"]
      FE["frontend: static dist"]
      APP["backend: app :3000"]
    end
    subgraph internal["network terra_internal, server profile only"]
      PG[("postgres:16")]
    end
  end
  NGX --> FE
  NGX --> APP
  APP --> PG
```

| Compose file | Project | What it runs | Published ports |
|---|---|---|---|
| `infra/compose/infra.yml` | `terra-infra` | nginx 1.27-alpine, networks `terra_edge` and `terra_internal`, Postgres **only** with profile `server` | `80` (nginx). Postgres has none |
| `infra/compose/frontend.yml` | `terra-frontend` | static image built from the Vite `dist/` | none |
| `infra/compose/backend.yml` | `terra-backend` | the NestJS app (D-24), `SIM_THREADS` = cores − 1 | none |
| `infra/compose/chain.yml` | `terra-chain` | nothing of its own beyond the `devchain` vhost mounted into nginx. The mock ledger stays in the app | none |

- Local `stack:local` does **not** enable profile `server`. The app uses the dev Postgres on `host.docker.internal:15434`. It still joins `terra_internal`. A holder container (`terra-internal-net`) keeps that network up while Postgres is off, because Compose creates a network only when a started service uses it.
- Remote `deploy:infra` enables profile `server`. That Postgres has no published port, answers on `terra_internal` as `postgres`, and is not reachable from the internet. The server file `/srv/terraagent/.env` sets `DATABASE_URL` to that host and `NODE_ENV=production`. The laptop default stays `development`.
- Containers restart `unless-stopped`. json-file logs rotate at 10 MB × 5.
- Only nginx publishes a port (`DEP-01`).

---

## 2. Hosts

Catalog: `infra/hosts/catalog.json` (W26-01). Each public name has one file `infra/nginx/hosts/<name>.conf`, included with `include /etc/nginx/hosts/*.conf`. A stack adds its own file and does not edit `nginx.conf`.

All six site vhosts and `devchain` use one document root, the Vite `dist/`, so absolute paths such as `/design/css/tokens.css` keep working. nginx only changes the index and, where needed, a proxy.

| Host | Index | Also |
|---|---|---|
| `terraagent.fun` | `/landing.html` | hashed assets long-cache; the HTML `no-cache`. The dev hub (`frontend/index.html`) is not this host |
| `pitchdeck.terraagent.fun` | `/pitchdeck/index.html` | static page, Faction Plate |
| `whitepaper.terraagent.fun` | `/whitepaper/index.html` | built from `docs/hackathon/public/whitepaper.md` |
| `design.terraagent.fun` | `/design/index.html` | `/foundations.html`, `/storybook.html`, `/motion.html` stay on the dist paths under `/design/` |
| `play.terraagent.fun` | `/play.html` | `try_files` falls back to `/play.html`. `/v1/` and `/ws` proxy to `app:3000` |
| `playground.terraagent.fun` | `/playground.html` | same fallback rule |
| `devchain.terraagent.fun` | `/dev/chain/index.html` | `/v1/dev/chain/` proxies to `app:3000`. The HTML returns 200 even when the app is down |
| `api.terraagent.fun` | — | `/v1/` and `/ws` proxy to `app:3000`. Anything else is 404 |

`/ws` uses HTTP/1.1, the upgrade headers, `proxy_read_timeout 75s` and `proxy_buffering off`. The client pings every 20 s.

- No `limit_req` and no `limit_conn` (D-25).
- Security headers on every vhost: `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`. No HSTS while TLS is off.
- CSP on `play`: `connect-src 'self'`. The game is same-origin on `play`. `CSP_CONNECT_EXTRA` is added when a later wave names extra origins (NEAR RPC, social login).
- CORS is the app's allow-list, built from the host catalog, credentials on.
- An unknown `Host` or an unknown path on `api` returns 404.

---

## 3. TLS

Off. nginx listens on port 80 only. `TLS_MODE` is not a setting in this phase.

Cloudflare, Origin CA and certbot are not installed and not configured. A later wave can terminate TLS on this same nginx without renaming a host.

---

## 4. Env and SSH

Operator machine, in `.env` (never committed; the example is `infra/hosts/.env.example`):

| Var | Value |
|---|---|
| `TA_DOMAIN` | `terraagent.fun` |
| `DEPLOY_HOST` | the server's public IP |
| `DEPLOY_USER` | the SSH user on that host. Default `deploy` |

`npm run deploy` and every `deploy:*` read these on the operator machine. An empty `DEPLOY_HOST` or `DEPLOY_USER` exits non-zero and names the variable. The server has its own `/srv/terraagent/.env` (chmod 600) for the app (database URL, JWT, mock flags). It does not need `DEPLOY_HOST`.

SSH:

- The owner copies a key to `DEPLOY_USER@$DEPLOY_HOST` once (`OWNER_TASKS.md`). The scripts do not do this.
- Commands are `ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new` and `rsync -e ssh`. No `-i`, no `ssh-copy-id`, no key material in the repo, the image or the logs.
- A missing key fails the ssh step immediately with ssh's own error.

`validate-env` for this phase checks the three variables above and refuses a `CHANGE_ME` placeholder. The mainnet and mock-in-prod guards stay in W25-06.

---

## 5. Local stack

| Command | What comes up |
|---|---|
| `npm run stack:local:infra` | nginx on `127.0.0.1:80`, both networks, no Postgres. `terra-internal-net` holds `terra_internal` |
| `npm run stack:local:frontend` | the static image, vhosts for the six sites |
| `npm run stack:local:backend` | the app, on `terra_edge` and `terra_internal`, database = dev Postgres on 15434. `NODE_ENV` stays `development` |
| `npm run stack:local:chain` | the `devchain` vhost |
| `npm run stack:local` | all four, in that order |
| `npm run stack:local:down` | all four down. Does not stop the dev Postgres |
| `npm run stack:local:smoke` | the checks below |

Smoke uses `curl --resolve <host>:80:127.0.0.1`, so it does not need `/etc/hosts`.

Checks:

- each of the eight hosts returns 200 on its index (api: `/v1/healthz`);
- `design.terraagent.fun/design/css/tokens.css` returns 200;
- `play.terraagent.fun/v1/healthz` returns 200 and `/ws` accepts the upgrade;
- `api.terraagent.fun/` returns 404 and `/v1/healthz` returns 200;
- `devchain.terraagent.fun/dev/chain/` returns 200 while the app is stopped, and `/v1/dev/chain/receipts` returns JSON while it is up;
- `http://not-a-host/` against the same port returns 404;
- the whitepaper page's `h1` equals the `h1` of `docs/hackathon/public/whitepaper.md`;
- the pitch deck page contains the landing brief's hero line, "Drop one robot. Get a colony that never sleeps."

`infra/hosts/local.hosts` maps `127.0.0.1` to all eight names. Installing it is an owner step so a browser can open them. Smoke does not require it.

---

## 6. Deploy

`npm run deploy` and `npm run deploy:{infra,frontend,backend,chain}` do the same steps for one stack or for all four:

1. Read `DEPLOY_HOST` and `DEPLOY_USER`. Refuse if either is empty.
2. `ssh` `echo ok` with `BatchMode`. Refuse if that fails.
3. `rsync` that stack's compose file, its nginx vhost files and its build context to `/srv/terraagent/`.
4. Ensure `/srv/terraagent/.env` exists and is mode `600`. If `DATABASE_URL` is absent, set `postgresql://terra:terra@postgres:5432/terraagent`. If `NODE_ENV` is absent, set `production`. Do not overwrite a key that is already set, and do not upload the operator `.env`.
5. On the server, `docker compose --env-file /srv/terraagent/.env up -d --build` for that file. Infra enables profile `server`.
6. `docker exec terra-nginx nginx -s reload`, so vhosts copied after nginx first started are loaded.
7. Backend only: `prisma migrate deploy` after the new container is healthy.
8. From the server, curl each host of that stack through `http://127.0.0.1` with the right `Host` header.

`npm run deploy -- --dry-run` prints those steps and the ssh target, and does not connect.

There is no confirm prompt, no image swap, no pre-deploy backup and no auto-rollback in this phase. Those are W25-07 and W25-09, and they wrap these commands rather than replacing them. A stack can be deployed while the other three keep running.

Server layout: `/srv/terraagent/{.env, compose/, nginx/hosts/, www/}`.

---

## 7. Rules

| ID | Rule | Phase |
|---|---|---|
| `DEP-01` | Only nginx publishes a port. Postgres, the app and the static image publish none. | W26 |
| `DEP-02` | Every public host sends the security headers in §2. No HSTS while TLS is off. | W26, CSP details W25-03 |
| `DEP-03` | An unknown host, and any path on `api` other than `/v1/` and `/ws`, returns 404. | W26 |
| `DEP-04` | Secrets stay in the server `.env` (600) or in files under `/srv/terraagent/secrets` (600). Never in images, git or logs. | W25-06 |
| `DEP-05` | A Postgres backup is taken before a migration. | W25-09, not this phase's `deploy` |
| `DEP-08` | `validate-env` passes before a deploy uploads anything. | W26 for `DEPLOY_*` and `TA_DOMAIN`; W25-06 for the rest |
| `DEP-10` | Local and remote use the same nginx config and the same four compose files. | W26 |
| `DEP-11` | Deploy uses the operator's existing SSH key. It never creates, copies or selects a key file. | W26 |

`DEP-06`, `DEP-07` and `DEP-09` (expand-only migrations, SIGTERM snapshot budget, build from `git archive`) stay in W25-07. This phase's deploy rsyncs the working tree and restarts the one stack.

## 8. Test matrix

| Rule | Test |
|---|---|
| DEP-01 | `infra/compose/test/ports.test.mjs`: across the four files, only nginx has `ports` |
| DEP-02, DEP-03, DEP-10 | `npm run stack:local:smoke` |
| DEP-08, DEP-11 | `deploy -- --dry-run` with an empty `DEPLOY_HOST` fails and names it; the dry-run plan contains no `ssh-copy-id` and no `-i` |
| DEP-05, DEP-06, DEP-07, DEP-09 | W25, when those rows land |

## 9. What is later

| Item | Where | Not now, because |
|---|---|---|
| Cloudflare proxy, Origin CA, R2 | was D-23 | D-37 |
| certbot / any TLS | a later ops row | HTTP is enough for this phase |
| non-root read-only app image | W25-02 | the simple image only has to serve `/readyz` |
| pre-deploy backup, SIGTERM snapshot, auto-rollback | W25-07, W25-08, W25-09 | `deploy:*` restarts one stack |
| monitoring, analytics, load, submission | W25 | separate from bringing the hosts up |
