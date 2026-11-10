# W20 — Colony Deed & Staking (F6, mock): owner check

> The wave's demo story ([`waves/W20-colony-deed.md`](../waves/W20-colony-deed.md)) as a hands-on checklist. Format and rules: [`README.md`](./README.md). About 8–10 minutes end-to-end.

## Before you start

- **Where it runs:** branch `wave/w20-colony-deed`, worktree `/Users/ferretrec/work/TerraAgent-wt/w20`. The main checkout is untouched.
- **Ports:** `TA_PORT_BASE=4200` → app **4201**, client **5373**. Database `terra_wave_w20_colony_deed`. Below, `<client>` = `http://127.0.0.1:5373`, `<app>` = `http://127.0.0.1:4201`.
- **Start:** from `/Users/ferretrec/work/TerraAgent-wt/w20`, run:

  ```bash
  npm run dev
  ```

  Wait until `ready → http://127.0.0.1:5373  (app http://127.0.0.1:4201)` is printed.
- **Stop:** Ctrl-C in that terminal, or `kill $(cat scripts/dev/.out/runner.pid)` if started in the background. Postgres keeps running.
- **How to reach the tools used below:**
  - **In-game dev console:** on `/play.html`, press **`` ` ``** (the backquote key under `Esc`) — *not* the browser DevTools console. Type a command in the dark bar at the bottom and press `Enter`. Press **`` ` ``** again to close the console bar so it does not cover buttons at the bottom of modals.
  - **Scenario URL:** `<client>/play.html?scenario=w20&skip=1&as=w20` seeds a Stage 4 (`S4`) temperate colony (`Aegis Spire`, `col_0`) at `40 %` Terraform progress (`terraformBp: 4000`) with a minted `v1` Colony Deed (`deed:col_0`) and a `100 NEAR` mock wallet balance.
  - **Deed card art storybook:** `<client>/playground.html?deedcard=1` renders the three Faction Plate Deed card variants (**Active**, **Settled** gold, **Eliminated** grey) side by side.
  - **Dev chain explorer:** `<client>/dev/chain/?tab=deeds&tokenId=deed%3Acol_0` and `<client>/dev/chain/?tab=staking`.
  - Full reference: [`docs/dev/DEV_TOOLS.md`](../../dev/DEV_TOOLS.md).

## Steps

1. **Open the Colony Deed card (`v1`, Active).**
   - **Where:** `<client>/play.html?scenario=w20&skip=1&as=w20`
   - **How:** press **`` ` ``**, run `tick` twice a second apart and check it advances (~5 ticks/s), close the console. In the left-hand Colony book (top left, under the minimap), open the **DEED** spine tab (`[data-testid="colony-tab-deed"]`) and click **COLONY · DEED** (`[data-testid="colony-deed-btn"]`) — or open the Colony menu and select **Deed**.
   - **See:** the **COLONY DEED** modal opens (`[data-testid="deed-panel"]`) showing version badge `v1`, status chip `Active`, chain status `Confirmed`, the live Faction Plate card preview (`Aegis Spire`, `STAGE S4`, `HEX TERRITORY (7)`, `TERRAFORM PROGRESS 40%`), the stats grid (`Aegis Spire`, `Stage 4`, `40 %`, `deed:col_0`), the receipt link **Recorded on NEAR (mock)** (`/dev/chain/?tab=deeds&tokenId=deed%3Acol_0`), and the `METADATA HISTORY` entry `v1 · Colony founded — Deed minted`.

2. **Milestone update + 10-minute debounce flush (`v2`).**
   - **Where:** same page (`<client>/play.html?scenario=w20&skip=1&as=w20`), with the **COLONY DEED** modal open.
   - **How:** press **`` ` ``** to open the dev console and run:

     ```text
     deed.bump terraform 10
     warp 20
     ```

   - **See:** `deed.bump terraform 10` prints `deed.bump terraform 10: Terraform 50 % (pending)`. Within ~1 second of `warp 20` advancing past the 10-minute debounce window, a bottom-right toast (`[data-testid="deed-toast"]`) appears with `Your Deed was updated: Terraform 50 %`, the modal version badge updates to `v2`, the Terraform stat and progress bar update to `50 %`, and `METADATA HISTORY` gains a second row (`v2 · Terraform 50 %`) with its `mock:` transaction hash.

3. **Share on X & public `/deed/<tokenId>` page (no auth).**
   - **Where:** same modal, then `<client>/deed/deed%3Acol_0` (or `<app>/deed/deed%3Acol_0`).
   - **How:** in the **COLONY DEED** modal, inspect the **Share on X** button (`[data-testid="deed-share-x-btn"]`) and click the `/deed/deed%3Acol_0` link (`[data-testid="deed-share-link"]`) or open `<client>/deed/deed%3Acol_0` in a new tab. Also check the rendered PNG card directly at `<app>/v1/near/deed/deed%3Acol_0/image.png?v=2` (and public JSON at `<app>/v1/deeds/deed%3Acol_0`).
   - **See:** `/deed/deed%3Acol_0` renders the standalone public share card (`[data-testid="deed-share-card"]`) with the `1200 × 630` PNG image (`[data-testid="deed-share-image"]`), colony stats, version history, and **Share on X** / **Launch TerraAgent** actions without requiring authentication.

4. **Staking locked on a non-settled deed.**
   - **Where:** back on `<client>/play.html?scenario=w20&skip=1&as=w20` inside the **COLONY DEED** modal (`SETTLED DEED · NEAR STAKING` section at the bottom).
   - **How:** look at the staking section while the deed is still `Active` (`settled = false`).
   - **See:** the staking controls are hidden and the locked banner (`[data-testid="staking-locked-banner"]`) reads `Available after your colony is Settled`.

5. **Settle the Deed → Claim Account → Signer Reject & Approve → Stake 10 NEAR → Accrue Rewards.**
   - **Where:** same page and modal.
   - **How:**
     1. Press **`` ` ``**, run `deed.settle`, then press **`` ` ``** again to close the console bar (or click **Seal Settled Deed** in the modal).
     2. In the newly unlocked staking section, click **Stake** before claiming the account.
     3. Click **Claim your colony account to stake** (`[data-testid="staking-claim-btn"]`), then click **Approve** in the **NEAR WALLET SIGNER (MOCK)** modal (`[data-testid="mock-wallet-signer-modal"]`).
     4. Select a whitelisted pool (`astro-stakers.pool.mock (9% APY)`), enter `10` in **Amount (NEAR)**, click **Stake**, and click **Reject** in the signer modal.
     5. Click **Stake** again and click **Approve** in the signer modal.
     6. Press **`` ` ``**, run `time.warp 86400` (1 game-day), and press **`` ` ``** to close the console bar.
   - **See:**
     - On `deed.settle`, the Deed card switches to the gold **SETTLED DEED** frame (`data-settled="true"`), the **Settler** achievement toast (`[data-testid="achievement-toast"]`) fires, and the staking controls appear with the mandatory copy: `Real NEAR from your wallet — not game currency, no in-game bonus`.
     - Clicking **Stake** before claiming shows `Claim your colony account to stake`.
     - Approving the claim updates the status to `Claimed (pilot.mock)`.
     - Clicking **Reject** in the signer modal aborts with `Cancelled in wallet` and keeps staked balance at `0 NEAR staked`.
     - Clicking **Approve** stakes `10 NEAR` (`Wallet: 90 NEAR`, `Staked: 10 NEAR staked (mock:...)`), and `time.warp 86400` accrues validator rewards (`~0.002465 NEAR` at 9 % APY).

6. **Unstake → 4-epoch unbonding → Warp 100 → Withdraw, plus Outbox Resilience & Dev Chain Explorer.**
   - **Where:** same modal, then `<client>/dev/chain/?tab=deeds&tokenId=deed%3Acol_0`.
   - **How:**
     1. Click **Unstake** (`[data-testid="staking-unstake-btn"]`).
     2. Press **`` ` ``**, run `warp 100`, and press **`` ` ``** to close the console bar.
     3. Wait ~1 second for **Withdraw** (`[data-testid="staking-withdraw-btn"]`) to enable, then click **Withdraw**.
     4. Press **`` ` ``** and test outbox failure + recovery:

        ```text
        near.mock.fail deed 1
        deed.bump terraform 10
        near.mock.fail deed 0
        time.warp 600
        ```

     5. Open `<client>/dev/chain/?tab=deeds&tokenId=deed%3Acol_0`, then click the **STAKING** tab.
   - **See:**
     - **Unstake** moves the position to `Unbonding (4 epochs)` with **Withdraw** disabled.
     - After `warp 100`, unbonding completes (`Withdrawable: 10.002465 NEAR`), **Withdraw** enables, and clicking **Withdraw** returns the principal + rewards to the wallet (`Wallet: 100.002465 NEAR`).
     - Under `near.mock.fail deed 1`, `deed.bump terraform 10` flips the header badge (`[data-testid="deed-pending-badge"]`) to `Pending / retrying (retries: 1)`; clearing with `near.mock.fail deed 0` and `time.warp 600` recovers the outbox row back to `Confirmed`.
     - In `/dev/chain/`, the **DEEDS** tab lists `deed:col_0` (`Settled`, version history, `mock:` tx hash) and the **STAKING** tab lists the whitelisted pools (`9%` APY) and positions.

7. **Flag-off check (`waves=..19`).**
   - **Where:** `<client>/play.html?scenario=w20&skip=1&as=w20&waves=..19` (or restart the stack with `TA_WAVES=..19 npm run dev:restart`).
   - **How:** load the page and wait until the console command `tick` prints a number; query `curl <app>/v1/deeds/deed%3Acol_0`.
   - **See:** the **COLONY · DEED** HUD button and Colony menu **Deed** entry are absent (`[data-testid="colony-deed-btn"]` count is `0`), no new deed mints or `deed.*` pushes occur, and existing `chain.deed` rows in Postgres remain untouched.

## Automated checks

Green on `wave/w20-colony-deed`:

- `npm run check` (`typecheck`, `lint`, `check:structure`, `gen:check`) → **0 errors, 0 warnings**
- `npm run test:contract -- --port deed,staking` → **11/11 passed**
- `npx vitest run -c tests/vitest.config.ts backend/app/test/near/ frontend/game/features/deed/ frontend/game/dev/explorer/chain-explorer-deed-staking.spec.ts` → **49/49 files (210 unit tests) passed**
- `npx vitest run -c tests/vitest.integration.config.ts backend/app/test/near/` → **39/39 files (99 integration tests) passed**
- `npm run test:parity` → **5/5 passed on both hosts**
- `npx playwright test -c tests/e2e/playwright.config.ts tests/e2e/w20.spec.ts` → **7/7 passed** (including `@hack` steps 1, 2, 7)

## When you're done

- **All good:** from the main checkout run `npm run wave -- land 20`. It re-runs the gates, merges `wave/w20-colony-deed` into `main`, tags `wave-20`, pushes, and removes the worktree and branch.
- **Something is wrong:** say which step and what you saw. Nothing lands until that is fixed on this branch.
