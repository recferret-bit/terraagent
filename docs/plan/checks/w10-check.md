# W10 — Cargo & Trade Hub: owner check

> The wave's demo story ([`waves/W10-cargo-trade-hub.md`](../waves/W10-cargo-trade-hub.md)) as a hands-on checklist. Format and rules: [`README.md`](./README.md). About 15 minutes. Shuttle launch/land VFX (`W10-17..18`), history feed rows (`W10-23`), and send-to-account (`W10-31`) are deferred (`FF-66`).

## Before you start

- **Where it runs:** branch `wave/w10-cargo-trade-hub`, worktree `../TerraAgent-wt/w10`. Your main checkout is untouched.
- **Ports:** this worktree's `infra/.env.worktree` sets `TA_PORT_BASE=4400` → app **4401**, client **5573** (`TA_DB_NAME=terra_wave_w10_cargo_trade_hub`). Below, `<client>` = `http://127.0.0.1:5573`, `<app>` = `http://127.0.0.1:4401`.
- **Start the stack** (if it isn't already up): `cd ../TerraAgent-wt/w10 && npm run dev` (Docker must be running for Postgres). Stop it with Ctrl-C, or `kill $(cat scripts/dev/.out/runner.pid)` if it was started in the background. Restart the app only with `npm run dev:restart` (Vite keeps running).
- **Dev console:** in the game page press **`` ` ``** (the key under Esc). A dark panel opens at the bottom; type commands there and press Enter. Press **Esc** while the console input has focus to close the dev console without closing the Trade Hub panel. It is **not** the browser's DevTools console. Click the game first if DevTools has focus.
- **3D model check (optional):** open `<client>/playground.html?inspect=building.tradeHub&validate=1` and cycle `ISO`, `FRONT`, `SIDE`, `TOP` (or click `4-VIEW SHEET`). The validator panel reports `0 errors, 0 warnings`, `3,428 tris` (< 3.5k budget), and `ground contact ✔ (minY -0.100 plinth skirt)`.
- **T1 throughput cap (`FF-66`):** a T1 Trade Hub has a rolling 60 s throughput cap of `250 units/min` (`W10-02` / `W10-06`), so the slider in Step 3 bounds a single T1 export to **250** `metals.t1` (900 → 650 stock, 0 → 250 in orbit), and Step 6 imports **150** `metals.t1` (650 → 800 stock, 250 → 100 in orbit).
- Every tool used below is described in [`docs/dev/DEV_TOOLS.md`](../../dev/DEV_TOOLS.md).

## Steps

1. **Colony with a powered Trade Hub T1.** Open `<client>/play.html?scenario=w10`. A temperate basin loads at morning daylight with colony **Orbital Port** at Stage 2:
   - Top resource bar shows **Metals: 900 / 2500** (`Iron (T1): 900`), **Minerals: 400 / 2500**, **Bio: 500 / 2500** (`Biomass 200 · Water 300`), and **HQ power cell: 200 / 200 E** (hovering shows `+28 E/s` supply, `−11 E/s` demand, `+17 E/s` net).
   - In the left `BUILD [B]` dock, **Inter-Colony Trade Hub** (`2×2`, `22s`, `−6 E/s`, `100 Metals · 80 Minerals · 30 Biomass · 10 Water`) is unlocked.
   - On the hex grid at tile `(2, 1)` (southeast of the Command Hub), an online **Trade Hub T1** stands with its landing pad, twin gantry cranes, cargo containers, and rotating beacon dish.
2. **Open the Trade Hub panel.** Click the **Trade Hub** building at tile `(2, 1)` (or click the **Inter-Colony Trade Hub** status card). The **INTER-COLONY TRADE HUB** panel opens on the right side with badges **TIER 1** and **ONLINE**, `THROUGHPUT 0 / 250 / min`, `DAILY EXPORT LIMIT 0 / 20,000 / day`, active tab **EXPORT TO ORBIT**, and the **IN ORBIT** table grouped by **METALS**, **MINERALS**, and **BIO** showing `Metals T1: 0`.
3. **Export 250 Metals T1 to orbit.** In the Export form, **METALS** and **METALS T1 (900)** are selected and the slider defaults to the T1 throughput cap (**250**; preview reads `Export 250 Metals T1 → Orbit (650 remaining in stock · Stock 900 → 650, Orbit 0 → 250 · Bounded by throughput cap (250 / min remaining))`). Click **CONFIRM EXPORT**:
   - Colony **Metals** stock drops immediately from **900** to **650**.
   - While the outbox relay settles (to make the chip linger, run `near.mock.latency cargo 300 500` in the dev console before clicking), a chip in the panel reads **Loading cargo… (250 Metals T1)**. *(Shuttle launch VFX `W10-17..18` is deferred.)*
4. **Settlement and `/dev/chain/` receipt.** Within ~1 second of export:
   - The **IN ORBIT** table updates to **Metals T1: 250**, `THROUGHPUT` reads **250 / 250 / min**, and `DAILY EXPORT LIMIT` reads **250 / 20,000 / day**.
   - Open `<client>/dev/chain/` in a second tab and click **RECEIPTS**. A row with call `CargoToken.mt_mint` and memo `cargo-export:…:1` appears with a `mock:` hash. Click that `mock:` hash: the receipt page shows **FINAL**, signer `minter.terraagent.mock`, receiver `res.terraagent.mock`, and `"token_id": "metals.t1"`, `"amount": "250000000000000000000"` (`250 × 10^18`).
5. **Throughput cap (`mint_cap`) and reset.** Back on the game tab, within the same 60 seconds:
   - The Export form shows **Throughput cap reached (250 / min)** and the slider max is `0`.
   - Type `50` into the amount number box and click **CONFIRM EXPORT**: a toast appears inside the panel (and at top-right) reading **Throughput limit reached (250 / min) — retry in …s** (`mint_cap`) with a live 1-second countdown.
   - Open the dev console (`` ` ``), run `cargo.cap.reset 0`, and press **Esc** to close the console: the console prints `Reset cargo mint caps for colony 0`, and `THROUGHPUT` resets to **0 / 250 / min**.
6. **Import 150 Metals T1 from orbit.** Click the **IMPORT TO COLONY** tab at the top of the Trade Hub panel:
   - Select **METALS T1 (250)**, enter `150` in the amount input (preview reads `Import 150 Metals T1 → Colony (free storage: 1850 · Stock 650 → 800, Orbit 250 → 100)`), and click **CONFIRM IMPORT**.
   - An **Unloading…** chip flashes while the burn settles, then colony **Metals** stock rises from **650** to **800** and **IN ORBIT → Metals T1** drops from **250** to **100**.
   - In `<client>/dev/chain/` under **RECEIPTS**, a `CargoToken.mt_burn` receipt appears (`cargo-import:…:1`). *(Shuttle landing VFX `W10-17..18` is deferred.)*
7. **Failed export refunds stock.** Switch back to the **EXPORT TO ORBIT** tab. Open the dev console (`` ` ``) and run:
   ```text
   cargo.cap.reset 0
   near.mock.fail cargo 1
   ```
   Press **Esc** to close the console. Enter `50` in the amount input and click **CONFIRM EXPORT**:
   - Colony **Metals** stock drops from **800** to **750** while the outbox retries (~2 seconds), then the export fails: the **50 Metals T1** are refunded to storage (**Metals** returns to **800**, **IN ORBIT → Metals T1** stays **100**), and the toast reads **Orbit transfer failed — 50 Metals T1 returned to stock**.
   - Open the dev console (`` ` ``), run `near.mock.fail cargo 0`, and press **Esc** to restore normal operation.
8. **Brownout sheds the Trade Hub (`hub_offline`).** Open the dev console (`` ` ``), run `time night`, and press **Esc**:
   - Solar output drops to `0`, the top-bar **BROWNOUT** banner appears, and the Trade Hub (shed group 2) is shed.
   - The Trade Hub panel status badge turns red **OFFLINE**, a red banner reads **Trade Hub is unpowered.**, the limit line reads **Trade Hub offline**, and the slider, number input, and **CONFIRM EXPORT** button are disabled (`data-disabled-reason="hub_offline"`).
   - Open the dev console (`` ` ``), run `skipnight`, and press **Esc**: daylight returns, the status badge returns to green **ONLINE**, and the Export controls re-enable.
9. **Wave flag off (`..09`).** Open `<client>/play.html?scenario=w10&waves=..09` (or `<client>/play.html?host=local&scenario=w10&waves=..09`, or restart with `TA_WAVES=..09 npm run dev:restart`):
   - **Inter-Colony Trade Hub** disappears from the `BUILD [B]` menu, the Trade Hub panel is absent, the existing Trade Hub at `(2, 1)` is hidden and inert (`ENTITY_STATE.inert`), and any `cargo.export` / `cargo.import` command is rejected with `wave_disabled`.

## Automated checks (already green on the branch)

After merging `main` (through W04):
- `npm run check` (`typecheck`, `lint`, `check:structure` ≤ 500 lines/file & ≤ 100 lines/fn, `gen:check`)
- `npm run build`
- `npm run contracts:check` (33 passed)
- `npm run validate:models -- building.tradeHub` (`52 parts · 3,428 tris · minY -0.100 · 0 errors, 0 warnings`)
- `npm run test:contract -- --port cargo` (4/4 cargo contract tests on the mock adapter)
- W10 unit & integration suites (`shared/sim`, `frontend/game`, `tests/scenarios`, `backend/app/test/near/cargo-*.int.spec.ts`)
- `npm run e2e -- --waves ..10 --hack` (W00, W01, W02, W04, W06, and W10 `@hack` steps on server host) and `npm run e2e -- --waves 10 --hack --host local` (8/8 passed on local host)

## When you're done

- **All good:** from the main checkout run `npm run wave -- land 10`. It re-runs the gates, merges W10 into `main`, tags `wave-10`, pushes, and removes this worktree and branch.
- **Something is wrong:** tell the wave lead which step and what you saw. It is fixed on this branch before anything lands.
