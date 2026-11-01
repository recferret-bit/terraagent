# W26 — Sites (terraagent.fun)

> **Track:** Ops (O) · **Flag:** `W26` (ops-only; no gameplay toggles) · **Tag:** `wave-26` · **Scenario:** none (the e2e drives nginx, not a planet) · **Depends on:** W00.
>
> **Specs:** [`DEPLOYMENT.md`](../../spec/DEPLOYMENT.md) v0.3 (`DEP-01`, `DEP-02`, `DEP-03`, `DEP-08`, `DEP-10`, `DEP-11`) · D-37 · D-24 (one app; the mock ledger stays there) · D-25 (no rate limits)
>
> **Owned paths:** `infra/compose/**`, `infra/nginx/**`, `infra/hosts/**`, `infra/docker/Dockerfile.app`, `scripts/sites/**`, `frontend/pitchdeck/**`, `frontend/whitepaper/**`. The dev Postgres file `infra/docker-compose.yml` stays as it is (`npm run db:up`). W25 owns `scripts/deploy/**` (the later rollback pipeline), `scripts/backup/**` and the monitoring paths. The only shared-file edit is the npm script block in the root `package.json`, and only W26-09 touches it. W26-03 is the only issue that edits `vite.config.ts` (two new HTML entries). W26-06 is the only issue that edits the app CORS allow-list.
>
> **Parallel tracks.** After W26-02, three tracks edit different files and can be built at the same time. Pitch and whitepaper then run at the same time on top of the frontend image. Local smoke and the deploy scripts wait for the tracks and run at the same time as each other.

| Track | Issues | Starts after | Writes |
|---|---|---|---|
| Infra | W26-02 | W26-01 | `infra/compose/infra.yml`, `infra/nginx/nginx.conf`, `infra/nginx/snippets/**` |
| Frontend | W26-03, then W26-04 and W26-05 together | W26-02 | `infra/compose/frontend.yml`, `infra/nginx/hosts/{apex,design,play,playground,pitchdeck,whitepaper}.conf`, `frontend/pitchdeck/**`, `frontend/whitepaper/**` |
| Backend | W26-06 | W26-02 | `infra/compose/backend.yml`, `infra/docker/Dockerfile.app`, `infra/nginx/hosts/api.conf`, the CORS allow-list |
| Chain | W26-07 | W26-02 | `infra/compose/chain.yml`, `infra/nginx/hosts/devchain.conf` |
| Bring-up | W26-08 and W26-09 together | the four tracks | `scripts/sites/**`, `infra/hosts/local.hosts`, the npm scripts |

## Goal

Serve every public page of the project on `terraagent.fun` from one nginx, on the laptop and on one remote host, from four compose files. Deploy with `npm run deploy` and `npm run deploy:<stack>` over SSH to the IP in `.env`. The owner copies the SSH key. No Cloudflare, no certbot, no R2.

## Demo story (`e2e/w26.spec.ts`, against `npm run stack:local`)

1. Run `npm run stack:local` → **see** nginx, the static image and the app up, and no second Postgres (the dev Postgres on 15434 is the one the app uses).
2. Open each host with curl `--resolve` to `127.0.0.1` → **see** 200 from `terraagent.fun` (landing), `pitchdeck.terraagent.fun`, `whitepaper.terraagent.fun`, `design.terraagent.fun`, `play.terraagent.fun`, `playground.terraagent.fun`, `devchain.terraagent.fun` and `api.terraagent.fun/v1/healthz`.
3. Open `http://design.terraagent.fun/design/` → **see** the design index that today is served at `/design/index.html`, and **see** `/design/css/tokens.css` return 200.
4. Open `http://play.terraagent.fun/v1/healthz` and upgrade `/ws` → **see** the app answer on the play host. Open `http://api.terraagent.fun/` → **see** 404.
5. Stop the app and open `http://devchain.terraagent.fun/dev/chain/` → **see** the explorer HTML still return 200. Start the app → **see** `/v1/dev/chain/receipts` return JSON.
6. Run `npm run deploy -- --dry-run` with `DEPLOY_HOST` set → **see** a plan that sshes to `DEPLOY_USER@DEPLOY_HOST` and brings up the four compose files. **See** no `ssh-copy-id`, no `-i` and no Cloudflare. Clear `DEPLOY_HOST` and run it again → **see** a non-zero exit that names `DEPLOY_HOST`.

Installing `infra/hosts/local.hosts` and opening the names in a browser is the owner check. The e2e uses `--resolve` and does not need that file.

## Hackathon slice

> Column `H`: **H** must for Nov 1–14 · **H+** stretch · **H2** real NEAR after the D10 gate · blank = after the hackathon.

- **Every row is `H`.** The four tracks start as soon as W00 is in `main`. Hosting does not wait for W25.
- **The hackathon e2e covers demo steps 1–6.** `W26-10` tags them `@hack`.
- **Deferred to W25:** TLS, Cloudflare, R2, the read-only image, pre-deploy backups, auto-rollback, monitoring, analytics, the load test and the submission form.
- **Still true:** with `TA_WAVES` below this wave the game behaves exactly as the previous wave's tag. This wave adds no gameplay.

## Features covered

| # | Feature | Issues |
|---|---|---|
| 1 | Host catalog and deploy env (`TA_DOMAIN`, `DEPLOY_HOST`, `DEPLOY_USER`) | W26-01 |
| 2 | Infra compose: nginx, networks, server-only Postgres, default 404 | W26-02 |
| 3 | Frontend compose and the four existing sites (landing, design, play, playground) | W26-03 |
| 4 | Pitch deck site | W26-04 |
| 5 | Whitepaper site, rendered from the markdown | W26-05 |
| 6 | Backend compose, `api.` vhost, CORS from the catalog | W26-06 |
| 7 | Chain compose and the `devchain.` vhost | W26-07 |
| 8 | `stack:local` per stack and the smoke | W26-08 |
| 9 | `deploy` and `deploy:<stack>` over SSH | W26-09 |
| 10 | Wave e2e | W26-10 |

## Issues

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W26-01 | Host catalog `infra/hosts/catalog.json` and `infra/hosts/.env.example`: the eight hosts in D-37, `TA_DOMAIN=terraagent.fun`, empty `DEPLOY_HOST`, `DEPLOY_USER=deploy`. A loader the other issues import. Do not edit the app env schema (W25-01) | contract | S | H | W00-05 | Load the catalog → see the eight host names, each tagged infra, frontend, backend or chain as in D-37 | D-37, DEPLOYMENT §2, §4 | — |
| W26-02 | Infra compose and nginx skeleton: `infra/compose/infra.yml` (nginx on port 80, networks `terra_edge` and `terra_internal`, Postgres only under profile `server` with no published port), `nginx.conf` that includes `hosts/*.conf`, security headers, unknown-host 404, no rate limits, no Cloudflare real-ip | ops | M | H | W26-01 | Run `npm run stack:local:infra` once the script exists, or `docker compose -f infra/compose/infra.yml up` → see nginx answer on port 80 and an unknown Host return 404. Compose config shows no Postgres port | DEP-01, DEP-02, DEP-03, DEPLOYMENT §1 | TA-02.4, TA-02.5 |
| W26-03 | Frontend compose: one static image of the Vite `dist/`, vhosts `apex`, `design`, `play`, `playground`. Apex serves `/landing.html`. Design serves `/design/index.html` and the existing `/design/` pages. Play serves `/play.html` and proxies `/v1` and `/ws` at the app. Playground serves `/playground.html`. Add stub `frontend/pitchdeck/index.html` and `frontend/whitepaper/index.html` to the Vite input | ops | M | H | W26-02 | Curl the four hosts with `--resolve` → see landing HTML, the design index, play HTML and playground HTML. Curl `design` `/design/css/tokens.css` → see 200 | DEPLOYMENT §2, DEP-10 | TA-02.3 |
| W26-04 | Pitch deck page `frontend/pitchdeck/index.html` (Faction Plate, no new visual system) and vhost `pitchdeck.conf`. First screen uses the landing-brief hero. Links point at `play.terraagent.fun` and `whitepaper.terraagent.fun` | client | M | H | W26-03 | Open `pitchdeck.terraagent.fun` → see the line "Drop one robot. Get a colony that never sleeps." and both links | D-37, landing-brief hero | — |
| W26-05 | Whitepaper page: render `docs/hackathon/public/whitepaper.md` into `frontend/whitepaper/index.html` at build time (the page is not a second copy of the prose) and vhost `whitepaper.conf` | client | M | H | W26-03 | Open `whitepaper.terraagent.fun` → see the same `h1` as the markdown file | D-37, whitepaper §1 | — |
| W26-06 | Backend compose: `Dockerfile.app`, `infra/compose/backend.yml`, the app on `terra_edge` with no published port, `/readyz` healthcheck. Local database URL points at the dev Postgres on 15434. Vhost `api.conf` proxies `/v1/` and `/ws` only. CORS allow-list is built from the host catalog | ops | M | H | W26-02, W00-09 | Curl `api.terraagent.fun/v1/healthz` → see 200. Curl `api.terraagent.fun/` → see 404. Compose config shows no `ports` on the app | DEP-01, DEP-03, D-24 | TA-02.3 |
| W26-07 | Chain compose: `infra/compose/chain.yml` mounts vhost `devchain.conf` into the infra nginx and does not start a second process. The vhost serves `/dev/chain/` from the same `dist/` and proxies `/v1/dev/chain/` to the app | ops | M | H | W26-02, W00-39 | With the app stopped, open `devchain.terraagent.fun/dev/chain/` → see the explorer HTML 200. With the app up, open `/v1/dev/chain/receipts` → see JSON | D-37, D-24, DEPLOYMENT §2 | — |
| W26-08 | Local commands and smoke: `scripts/sites/stack.mjs` implements `stack:local`, `stack:local:{infra,frontend,backend,chain}` and `stack:local:down` (down does not stop the dev Postgres). `stack:local:smoke` runs the DEPLOYMENT §5 checks. `infra/hosts/local.hosts` lists `127.0.0.1` for all eight names. A test fails if a catalog host has no vhost file | test | M | H | W26-03, W26-04, W26-05, W26-06, W26-07 | Run `npm run stack:local:smoke` → see every check pass, including the stopped-app explorer check | DEPLOYMENT §5, DEP-10 | TA-02.6 |
| W26-09 | Deploy commands: `scripts/sites/deploy.mjs` implements `deploy`, `deploy:{infra,frontend,backend,chain}` and `--dry-run`. Reads `DEPLOY_HOST` and `DEPLOY_USER` from `.env`. Uses `ssh -o BatchMode=yes` and `rsync`. Refuses an empty `DEPLOY_HOST`. Never runs `ssh-copy-id` and never passes `-i`. Infra enables profile `server`. Backend runs `prisma migrate deploy` after the container is healthy. Root `package.json` scripts are added only here | ops | M | H | W26-03, W26-04, W26-05, W26-06, W26-07 | Run `npm run deploy -- --dry-run` with `DEPLOY_HOST=203.0.113.10` and `DEPLOY_USER=deploy` → see the four compose files and that ssh target. Run it with `DEPLOY_HOST` empty → see a non-zero exit naming `DEPLOY_HOST`. The dry-run text contains no `ssh-copy-id` | DEP-08, DEP-11, DEPLOYMENT §6 | TA-02.5 |
| W26-10 | Wave e2e `e2e/w26.spec.ts` (demo steps 1–6, all tagged `@hack`) + tag `wave-26` | test | S | H | all above | Run `npm run e2e -- --waves ..26` → see the W26 smoke pass on top of the earlier wave suites; then tag `wave-26` | PRODUCT_WAVES §3 | — |

## Wave DoD

- `npm run stack:local:smoke` passes against the four compose files.
- `npm run deploy -- --dry-run` names `DEPLOY_USER@DEPLOY_HOST` and refuses an empty `DEPLOY_HOST`.
- The eight hosts in D-37 answer as the demo story says. Design on `design.terraagent.fun` is the current `/design/` pages.
- Only nginx publishes a port. The laptop still uses the dev Postgres on 15434, and `stack:local:down` leaves it running.
- Tag `wave-26` is created.
