# W10 — Cargo & Trade Hub: owner check

[W10 wave](../waves/W10-cargo-trade-hub.md) · About 10–15 minutes · Updated 2026-11-04 for the W10 fixes.

Known follow-up: **FF-68 — Fix trading-spot shuttle animation** remains open. The owner authorized landing W10 with this animation fix deferred.

## Before you start

- Worktree: `/Users/ferretrec/work/TerraAgent-wt/w10`, branch `wave/w10-cargo-trade-hub`.
- Client: **http://127.0.0.1:5573**. Backend: **http://127.0.0.1:4401**. Database: `terra_wave_w10_cargo_trade_hub`.
- Full stack: `npm run dev` from this worktree. Backend-only restart: `npm run dev:restart`. Stop the foreground runner with **Ctrl+C**.
- Open the [server-backed W10 scenario](http://127.0.0.1:5573/play.html?scenario=w10&waves=..10&as=w10-owner). Use this URL for the checks below, including mock failures and receipts. The temporary client-only port 4400 is not used here.
- Dev commands below go in the **in-game console**: click the game, press **`** (under Esc), type a command, press **Enter**, then press **Esc** to close the console. Enter multiple commands one at a time. Reference: [DEV_TOOLS.md](../../dev/DEV_TOOLS.md).
- Keep the simulation running at **1×** when checking the 60-second allowance. Reloading the scenario starts a fresh test; do not reload midway through the numbered checks.

## Steps

1. **Confirm the starting colony.**

   Open the scenario link above. The colony should have **900 Metals**, **400 Minerals**, **500 Bio**, and a powered Trade Hub at tile **(2, 1)**, southeast of the Command Hub. Its status should be **ONLINE**.

2. **Check the expandable bar and controls.**

   Click the Trade Hub. The **bottom selection bar expands** to contain the trade controls. Check that the buttons are compact, both meter labels and values fit, and no separate dialog overlaps the bar.

   Click **HIDE DETAILS**, wait several ticks, then **SHOW DETAILS**. It must remain collapsed until you expand it. Select the Command Hub: trade controls should disappear. Select the Trade Hub again.

   In Export, click **25%**, **50%**, and **MAX**, and drag the slider. The orange fill must follow the selected amount rather than remaining half orange. Finish with **MAX**, amount **250**.

3. **Export 250 Metals T1 and watch the launch.**

   Select **METALS → METALS T1**, enter **250**, and click **CONFIRM EXPORT**. Watch the cargo pad; a pod should rise with retro-engine flames. You can immediately click **HIDE DETAILS** to see more of the scene, then reopen it.

   Stock should fall **900 → 650**. A **Loading cargo…** chip may appear briefly while settlement is pending.

4. **Check settlement.**

   After settlement, **In Orbit → Metals T1** should show **250**. The meters should show **250 / 250 / min** and **250 / 20,000 / day**.

   Optional receipt check after finishing the timed checks: open [Chain Explorer](http://127.0.0.1:5573/dev/chain/) in another tab, select **RECEIPTS**, and find `CargoToken.mt_mint` with a `cargo-export:` memo. Imports produce `CargoToken.mt_burn` receipts.

5. **Check the limit and its natural recovery.**

   Within 60 simulation seconds of exporting, enter **50** in Export. **CONFIRM EXPORT** must be disabled and the limit line should explain that throughput is exhausted.

   Keep the panel open and wait until **60 simulation seconds after the export**. Without reloading, reopening, or resetting caps, throughput should return to **0 / 250 / min** and exporting should become available. The daily meter should remain **250 / 20,000 / day**.

6. **Import 150 Metals T1 and watch the landing.**

   Click **IMPORT TO COLONY**, select **METALS T1**, enter **150**, and click **CONFIRM IMPORT**. Watch for the descending pod and retro flames.

   After settlement, stock should rise **650 → 800**, and orbit should fall **250 → 100**. Throughput should remain **0 / 250 / min**: imports do not consume the export allowance.

7. **Check a failed transfer and the warning lifetime.**

   In the in-game console, run each command separately:

   ```text
   cargo.cap.reset 0
   near.mock.fail cargo 1
   ```

   Close the console. Switch to Export, enter **50**, and confirm. Stock falls **800 → 750** while pending, then returns to **800** when the failure refunds it. Orbit stays **100**.

   Expect **one** warning: inside expanded details, or floating outside when collapsed. It must disappear after about **8 seconds**, or when clicked. The normal limit hint is separate and updates when availability changes.

   Restore normal operation in the console:

   ```text
   near.mock.fail cargo 0
   cargo.cap.reset 0
   ```

8. **Check power loss and recovery.**

   Run `time night` in the console, then close it. The Trade Hub should become **OFFLINE**, show the unpowered message, and disable transfer controls.

   Run `skipnight`, then close the console. It should return to **ONLINE**, with valid transfers enabled.

9. **Check W10-off behavior last.**

   Open [the local W09-only scenario](http://127.0.0.1:5573/play.html?host=local&scenario=w10&waves=..09) in another tab. The Trade Hub should be hidden/inert, absent from the build menu, and have no trade panel. Return to the original W10 tab afterward.

## Verification and scope

- Restart verification: backend `/v1/healthz` and `/v1/readyz`, and the client-proxied health endpoint return HTTP 200; PostgreSQL is healthy and migrations are current.
- Fix validation: `npm run check`, `npm run build`, 81 focused UI/simulation/scenario tests, and browser checks of exports, imports, persistent collapse and natural throughput recovery.
- Reused pod validation: 37 parts, 2,348 triangles, minY 0.000, zero errors/warnings.
- Flights reuse the existing pod and retro-engine effect; settlement is independent of the cosmetic animation. See [FF-67](../../questions-and-limitations/frontend-features.md). History and send-to-account remain deferred under FF-66.

## When you're done

Report the step number and what you saw for any failure. Once the wave is approved, the owner lands it from the main checkout with `npm run wave -- land 10`.
