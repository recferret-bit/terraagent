# W26 — Sites: owner check

> The wave's demo story ([`waves/W26-sites.md`](../waves/W26-sites.md)) as a hands-on checklist. Format and rules: [`README.md`](./README.md). About 15 minutes once Docker images are built. The site stack is already up on this machine from the lead's check (nginx on port 80). If it is not, start it as below.

## Before you start

- **Where it runs:** branch `wave/w26-sites`, worktree `../TerraAgent-wt/w26`. Your main checkout is untouched. `main` had nothing new to merge: this branch already contains local `main` (`68d095e`) and `origin/main` (`d2970e8`).
- **Ports:** `.env.worktree` sets `TA_PORT_BASE=4300` → game app **4301**, Vite client **5473** (`<app>` = `http://127.0.0.1:4301`, `<client>` = `http://127.0.0.1:5473`). Database `terra_wave_w26_sites` on the shared dev Postgres, host port **15434**. The public sites are a different stack: nginx on **port 80**.
- **Start the sites** (if port 80 is closed): `cd ../TerraAgent-wt/w26 && npm run stack:local`. Stop them with `npm run stack:local:down`. That stops nginx, the static container and the app container. It does **not** stop the dev Postgres container `terra-pg`.
- **Game stack** (only if you also want `/play.html?scenario=w00` on the Vite port): `npm run dev`. Stop with Ctrl-C, or `kill $(cat .dev/runner.pid)` if it was started in the background. This wave adds no scenario and no gameplay toggle. `?scenario=w26` does not exist. With `TA_WAVES` below W26 the game behaves as it did at W25.
- **Names:** the checks below use `curl --resolve`, so they work without editing `/etc/hosts`. To open the names in a browser, from the worktree run `grep -q pitchdeck.terraagent.fun /etc/hosts || sudo sh -c 'cat infra/hosts/local.hosts >> /etc/hosts'` (the lines are in [`infra/hosts/local.hosts`](../../../infra/hosts/local.hosts)). That file is the owner step. Do not install it twice.
- **Dev console:** in a game page press **`` ` ``** (the key under Esc). A dark panel opens at the bottom; type there and press Enter. It is **not** the browser's DevTools console. None of the steps below use it. Tools: [`docs/dev/DEV_TOOLS.md`](../../dev/DEV_TOOLS.md).

There is no second Postgres. `terra-sites-pg` stays off on the laptop. `terra-internal-net` is only there so the `terra_internal` network exists; it publishes no port. The app container uses `terra-pg` on port 15434. It runs with `NODE_ENV=development` so the mock-chain receipts route returns JSON (owner default, recorded on W26-06). A production process would 404 that route. Remote deploy does not use this laptop default: `/srv/terraagent/.env` sets `NODE_ENV=production` when that key is missing, and points `DATABASE_URL` at the profile-`server` Postgres (`postgres:5432`). It does not overwrite keys already in that file.

## Steps

1. **Site stack is up, and the dev Postgres is the only database.** In the worktree: `docker ps --filter name=terra-`. **See** `terra-nginx` with `0.0.0.0:80->80`, `terra-static`, `terra-app` (healthy), `terra-internal-net` (no published port), and `terra-pg` (healthy, port 15434). **See** no `terra-sites-pg`.
2. **Each public name answers.** Still in the worktree, one curl per host (`--resolve` sends it to 127.0.0.1:80):
   ```
   curl -sS -D - --resolve terraagent.fun:80:127.0.0.1 http://terraagent.fun/ -o /dev/null
   curl -sS --resolve pitchdeck.terraagent.fun:80:127.0.0.1 http://pitchdeck.terraagent.fun/ | head
   curl -sS --resolve whitepaper.terraagent.fun:80:127.0.0.1 http://whitepaper.terraagent.fun/ | head
   curl -sS -D - --resolve design.terraagent.fun:80:127.0.0.1 http://design.terraagent.fun/ -o /dev/null
   curl -sS -D - --resolve play.terraagent.fun:80:127.0.0.1 http://play.terraagent.fun/ -o /dev/null
   curl -sS -D - --resolve playground.terraagent.fun:80:127.0.0.1 http://playground.terraagent.fun/ -o /dev/null
   curl -sS -D - --resolve devchain.terraagent.fun:80:127.0.0.1 http://devchain.terraagent.fun/dev/chain/ -o /dev/null
   curl -sS --resolve api.terraagent.fun:80:127.0.0.1 http://api.terraagent.fun/v1/healthz
   ```
   **See** HTTP 200 for each. The apex body is the landing page (`TerraAgent — Drop one robot. Leave. It keeps building.`). Pitch contains `Drop one robot. Get a colony that never sleeps.` Play is `TerraAgent — Play`. Playground is `TerraAgent — Playground`. Devchain is `TerraAgent — Mock Chain Explorer`. Api prints `{"ok":true}`. With the hosts file installed, the same URLs open in the browser.
3. **Design index and tokens.** Open `http://design.terraagent.fun/design/` (or curl it the same way). **See** the heading **FACTION PLATE**. Then `http://design.terraagent.fun/design/css/tokens.css` → **see** 200 and the text `--ta-void`.
4. **Play proxies the app. Api serves only the API.**
   - `curl -sS --resolve play.terraagent.fun:80:127.0.0.1 http://play.terraagent.fun/v1/healthz` → `{"ok":true}`.
   - Upgrade the socket (it stays open, so give curl 3 seconds):
     ```
     curl -sS -D - --http1.1 --max-time 3 --resolve play.terraagent.fun:80:127.0.0.1 \
       -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
       -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
       http://play.terraagent.fun/ws -o /dev/null
     ```
     **See** `HTTP/1.1 101 Switching Protocols`. Curl then exits on the time limit. That is the upgrade succeeding.
   - `curl -sS -D - --resolve api.terraagent.fun:80:127.0.0.1 http://api.terraagent.fun/ -o /dev/null` → **see** `404` and the body `not found`.
5. **The explorer is static. Receipts need the app.**
   1. `docker stop terra-app`
   2. `curl -sS --resolve devchain.terraagent.fun:80:127.0.0.1 http://devchain.terraagent.fun/dev/chain/` → **see** 200 and `Mock Chain Explorer` (the page is files from nginx, so the app being down does not blank it).
   3. `docker start terra-app` and wait until `docker inspect -f '{{.State.Health.Status}}' terra-app` prints `healthy` (a few seconds).
   4. `curl -sS --resolve devchain.terraagent.fun:80:127.0.0.1 http://devchain.terraagent.fun/v1/dev/chain/receipts` → **see** `200` and a JSON array (`[]` on a fresh database).
6. **Deploy dry-run.** A live SSH deploy needs the VPS and the SSH key from [`OWNER_TASKS.md`](../OWNER_TASKS.md). This step does not connect.
   ```
   TA_DOMAIN=terraagent.fun DEPLOY_HOST=203.0.113.10 DEPLOY_USER=deploy npm run deploy -- --dry-run
   ```
   **See** exit 0, the target `deploy@203.0.113.10`, and the four files `/srv/terraagent/compose/infra.yml` (with `--profile server`), `frontend.yml`, `backend.yml` and `chain.yml`. **See** no `ssh-copy-id` and no `ssh -i`. Then:
   ```
   TA_DOMAIN=terraagent.fun DEPLOY_HOST= DEPLOY_USER=deploy npm run deploy -- --dry-run
   ```
   **See** exit 1 and `validate-env: DEPLOY_HOST is empty`.

An unknown name on the same port is 404: `curl -sS -D - --resolve not-a-host:80:127.0.0.1 http://not-a-host/ -o /dev/null`.

## Automated checks (already green on the branch)

`npm run build` (typecheck, structure, vite) · `npm test` (66 files, 375 tests) · `node --test` for the host catalog, compose port checks, vhost files, deploy dry-run and the whitepaper renderer (27 passed) · `npm run e2e -- --waves ..26` → **14 passed, 1 skipped** (W00 step 4 is still the later state inspector). W00's flag panel still shows 26 chips (W00–W25). W26 adds no flag chip.

## When you're done

- **All good:** from the main checkout run `npm run wave -- land 26`. It re-runs the gates, merges W26 into `main`, tags `wave-26`, pushes, and removes this worktree and branch. (Plain `npm run wave` does the same and then opens the next ready wave.)
- **Something is wrong:** tell the wave lead which step and what you saw. It is fixed on the wave branch before anything lands.
