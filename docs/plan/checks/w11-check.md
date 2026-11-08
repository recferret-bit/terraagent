# W11 — Lobby, Matchmaking, Planets & Sector Foundations: Owner Check Guide

Worktree: `../TerraAgent-wt/w11` (branch `wave/w11-lobby-planets`)  
Ports: client `http://127.0.0.1:5273`, app `http://127.0.0.1:4101`, Postgres DB `terra_wave_w11_lobby_planets` (`TA_PORT_BASE=4100` in `infra/.env.worktree`).  
W27 Readiness Manifest: [`docs/plan/w27-readiness-manifest.md`](../w27-readiness-manifest.md) (`w27Ready: false`, `w27ScaleClaimed: false` — 28 `H` foundation issues complete; 19 untagged/`H+` issues deferred before W27).

If the stack is not already running:

```bash
cd ../TerraAgent-wt/w11
npm run dev:stack
```

---

## What to try (Demo Story 1–9)

### 1. Three persistent world cards & land-sector chooser (`W11-08`, `W11-20`)

1. Open <http://127.0.0.1:5273/play.html?planet=forestRock>.
2. **Expect:**
   - The **Choose World** orbital menu displays all three canonical persistent worlds:
     - **Dune Expanse** (`dune` / `desert`, canonical ID `pl_01JKHAR0NDVNEST00000000000`)
     - **Archipelago** (`oceanForest` / `ocean`, canonical ID `pl_01JTHA1ASSAVERDE0000000001`)
     - **Highland Basin** (`forestRock` / `temperate`, canonical ID `pl_01JGRAN1TEH0110W0000000002`)
   - Each card shows its availability badge (`OPEN`) and free founding seats (`28/28 FREE`). There is **no** `newPlanet` card or "create new planet" button.
   - Inside `[data-testid="sector-picker"]` (`LANDING SECTOR · 7 LAND · 12 OCEAN`), you see:
     - `[data-testid="sector-opt-auto"]` (`AUTO · AUTOMATIC SECTOR`) selected by default (`aria-pressed="true"`).
     - Seven clickable land sector buttons (`[data-testid="sector-opt-sec_0_0"]` through `[data-testid="sector-opt-sec_0_1"]`), each showing `4/4` free founding seats, `OPEN` badge, and its regional resource specialization (`metals.t1`, `minerals.t1`, `bio.biomass`, etc.).
3. Click `[data-testid="sector-opt-sec_0_0"]` (`sec_0_0`), then click `[data-testid="sector-opt-auto"]`.
   - **Expect:** `aria-pressed="true"` toggles cleanly between explicit land sector choice (`data-sector-mode="chosen"`) and automatic sector selection (`data-sector-mode="auto"`).

---

### 2. Seed scenario `?scenario=w11` — Colony founded in `sec_0_0` (`W11-02..04`, `W11-32`)

1. Open <http://127.0.0.1:5273/play.html?scenario=w11&as=w11>.
2. **Expect:**
   - Boots into **W11 Planet Foundations & Sector Admission** (`seed: 'w11-lobby-planets'`).
   - Colony 0 (`col_0`, **Aegis Prime**) is founded in sector `sec_0_0` (`landingSlotId: 'slot_sec_0_0_0'`) at `(20, -10)` with a landed HQ (`(20, -10)`), `Command Hub` (`(18, -9)`), `Solar Collector` (`(22, -11)`), cross-sector `Pylon` link (`(24, -12)` in `sec_0_0` ↔ `(26, -13)` in `sec_1_0`), and a boundary `Worker` at `(24, -12)`.
   - Open DevTools console and run:
     ```js
     window.__online.store.view.colonies[0]
     ```
   - **Expect:** `id: 'col_0'`, `name: 'Aegis Prime'`, `foundingSectorId: 'sec_0_0'`, `landingSlotId: 'slot_sec_0_0_0'`.

---

### 3. Global Planet Map (`M`) `'sectors'` layer & cross-sector gameplay (`W11-15`, `W11-22`, `W11-47`)

1. Still on <http://127.0.0.1:5273/play.html?scenario=w11&as=w11>, press **`M`** to open the W04 Global Planet Map overlay.
2. **Expect:**
   - The layer bar at `[data-testid="global-map-layers"]` includes the W11 **`SECTORS`** chip (`[data-testid="map-layer-chip-sectors"]`) alongside `TERRITORY`, `TERRAIN`, `RESOURCES`, and `UNITS`, and `SECTORS` is active by default (`aria-pressed="true"`).
   - The canvas draws the `19`-sector macro hex grid (`7` land sectors + `12` ocean ring sectors) with sector IDs, seat occupancy badges, and resource tags.
3. Click **`SECTORS`** (`[data-testid="map-layer-chip-sectors"]`) to toggle it off (`aria-pressed="false"`), then click it again to turn it back on (`aria-pressed="true"`).
4. Press **`M`** (or `Escape`) to close the Global Map, then open the in-game dev console with **`` ` ``** (backtick) or DevTools and walk the boundary worker (`unitId: 6`) across the `sec_0_0` → `sec_1_0` seam (`(24, -12)` → `(25, -12)`):
   ```js
   window.__online.send('moveUnit', { unitId: 6, q: 25, r: -12 })
   ```
5. **Expect:**
   - The worker smoothly walks from `sec_0_0` (`(24, -12)`) into `sec_1_0` (`(25, -12)`) with the **same** `entityId` (`6`), **same** `colonyIndex` (`0`), and **same** `foundingSectorId` (`'sec_0_0'`). No extra founding seat is consumed in `sec_1_0`.

---

### 4. Active colony continuity on reload (`W11-40`)

1. Reload <http://127.0.0.1:5273/play.html?scenario=w11&as=w11>.
2. **Expect:**
   - Reconnects immediately to the same planet and colony (`col_0`, `Aegis Prime`, `foundingSectorId: 'sec_0_0'`) while ticks continue advancing and zero page errors occur.

---

### 5. Party admission & cross-sector beacon removal *(Deferred — Untagged `H+` Slice)*

- Multi-player party lobby endpoints (`W11-17`), multi-seat party sector solver (`W11-18`), friend-beacon removal migration (`W11-19`), party drawer UI (`W11-21`), partial-party prompt (`W11-24`), and party integration suite (`W11-44`) are untagged rows deferred from the `H` slice and documented as required gates in [`docs/plan/w27-readiness-manifest.md`](../w27-readiness-manifest.md) (`w27Ready: false`).

---

### 6. Persistent canonical worlds & public stats (`W11-07`, `W11-08`, `W11-34`, `W11-35`)

1. Query `GET /v1/planets` and `GET /v1/planets/stats`:
   ```bash
   curl -s http://127.0.0.1:4101/v1/planets | jq '{queuePaused, count: (.planets | length), worlds: [.planets[] | {id, name, type, look, lifecycle, health, admission, availability, landSectors, oceanSectors, validatedCapacity, freeSeats}]}'
   curl -s http://127.0.0.1:4101/v1/planets/stats | jq .
   ```
2. **Expect:**
   - `GET /v1/planets` returns `count: 3` canonical worlds (`Kharon Dunes`, `Thalassa Verde`, `Granite Hollow`), each with `lifecycle: "ACTIVE"`, `health: "OK"`, `admission: "OPEN"`, `availability: "open"`, `landSectors: 7`, `oceanSectors: 12`, `validatedCapacity: 28`, and **no** `newPlanet`, `admissionClosesAt`, or `endsAt` fields.
   - `GET /v1/planets/stats` returns `{ planetsActive: 3, coloniesAlive, playersOnline, updatedAt }`.

---

### 7. Matchmaking ticket enqueue, idempotency, `NEW_PLANET` rejection & cancellation (`W11-10`, `W11-33`, `W11-36`)

1. Mint a guest token, enqueue a sector-targeted ticket twice with the same `Idempotency-Key`, verify `NEW_PLANET` is rejected, and cancel the ticket:
   ```bash
   TOKEN=$(curl -s -X POST http://127.0.0.1:4101/v1/auth/guest -H 'content-type: application/json' -d '{}' | jq -r .accessToken)

   # 1) Reject legacy NEW_PLANET mode (400 unsupported_mode)
   curl -s -i -X POST http://127.0.0.1:4101/v1/match/tickets \
     -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
     -d '{"mode":"NEW_PLANET","planetType":"temperate"}'

   # 2) Idempotent JOIN_PLANET ticket for sec_0_0
   T1=$(curl -s -X POST http://127.0.0.1:4101/v1/match/tickets \
     -H "authorization: Bearer $TOKEN" -H 'Idempotency-Key: chk-w11-1' -H 'content-type: application/json' \
     -d '{"mode":"JOIN_PLANET","planetType":"temperate","sectorId":"sec_0_0"}')
   T2=$(curl -s -X POST http://127.0.0.1:4101/v1/match/tickets \
     -H "authorization: Bearer $TOKEN" -H 'Idempotency-Key: chk-w11-1' -H 'content-type: application/json' \
     -d '{"mode":"JOIN_PLANET","planetType":"temperate","sectorId":"sec_0_0"}')
   echo "$T1" | jq '{id, state, planetType, sectorIntent}'
   echo "$T2" | jq '{id, state, planetType, sectorIntent}'

   # 3) Cancel the ticket cleanly
   TID=$(echo "$T1" | jq -r .id)
   curl -s -X DELETE "http://127.0.0.1:4101/v1/match/tickets/$TID" \
     -H "authorization: Bearer $TOKEN" | jq '{id, state}'
   ```
2. **Expect:**
   - `mode: "NEW_PLANET"` returns `HTTP/1.1 400 Bad Request` with `code: "unsupported_mode"`.
   - Both `T1` and `T2` return the **exact same** ticket `id` with `sectorIntent: { "kind": "chosen", "sectorId": "sec_0_0" }`.
   - `DELETE /v1/match/tickets/$TID` returns `state: "CANCELLED"`.

---

### 8. Wave-flag fencing (`&waves=..10`) (`W11-22`, `W11-47`)

1. Open <http://127.0.0.1:5273/play.html?scenario=w11&waves=..10>.
2. Press **`M`** to open the Global Planet Map.
3. **Expect:**
   - `[data-testid="map-layer-chip-sectors"]` is **not** rendered (count `0`).
   - Earlier W04 map layer chips (`TERRITORY`, `TERRAIN`, `RESOURCES`, `UNITS`) remain visible and toggle cleanly (`docs/plan/MAP_EXTENSION_HANDOFF.md` regression gate).

---

### 9. Local-host mode (`?host=local&scenario=w11`) (`W11-32`)

1. Open <http://127.0.0.1:5273/play.html?host=local&scenario=w11> (works even with the backend stopped).
2. **Expect:**
   - The browser WebWorker boots `w11` locally (`mode: "local"`), ticks advance, Colony 0 (`col_0`, `Aegis Prime`, `foundingSectorId: 'sec_0_0'`) is active, and pressing **`M`** displays the active **`SECTORS`** layer chip (`[data-testid="map-layer-chip-sectors"]`).

---

## Automated Verification Commands

```bash
cd ../TerraAgent-wt/w11
npm run check
npx vitest run --config tests/vitest.config.ts shared/contracts/src/lobby/w11-contracts.spec.ts shared/sim/src/atlas/ backend/app/src/lobby/ frontend/game/ui/w11-orbital-picker.spec.ts frontend/game/maps/ tests/scenarios/test/w11-lobby.spec.ts
npx playwright test --config tests/e2e/playwright.config.ts tests/e2e/w11.spec.ts
```

When you're done: `npm run wave -- land 11`
