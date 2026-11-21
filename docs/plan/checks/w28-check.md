# W28 — Staking Overhaul, 4-Tier Orbital Patronage & Wealth Dashboard: owner check

> The wave's demo story (`docs/plan/waves/W28-staking-overhaul.md` in the main checkout) as a hands-on checklist.
> About 25 minutes. Everything runs on mock NEAR (`NEAR_MODE=mock`, no keys). Every URL, command and result below was
> played by the lead on this worktree's running stack on 2026-11-20 (numbers are from that run).
>
> Owner decisions still open (code ships the spec as written; details in
> [`docs/questions-and-limitations/staking.md`](../../questions-and-limitations/staking.md)): **Q-W28-1** a `$50k`
> flash-staker who trades more than ≈ 71 % of the stake inside the week does save money (Tier 1's 0.65 % is instant);
> **Q-W28-2** the Lead Patron gets 15 % of gross (not 12 %) on a fill with no DAO carve-out; **Q-W28-3** the Tier 3
> "+25 bp stall royalty cap" is not wired (it would make the sim read staking, D-31); **Q-W28-4** quotas are per
> wallet, so splitting stake across wallets buys more AI slots; **Q-W28-5** `/v1/near/staking/performance` is public
> by account id, like an explorer. No `PRODUCT_WAVES.md` / `OWNER_TASKS.md` exists in this repo, so the spec's own
> numbers were used (one managed AI call costs `$0.0000375`, giving ~18 calls/day at Tier 1 and `$4/NEAR`).

## Before you start

- **Where it runs:** branch `wave/w28-staking-overhaul`, worktree `../TerraAgent-wt/w28`. Your main checkout is
  untouched (`main` now carries the landed `feat/living-biosphere` commits ahead of the W28 branch base; `npm run wave:land -- 28` or `npm run wave:sync -- 28` reconciles them cleanly).
- **Ports:** `infra/.env.worktree` sets `TA_PORT_BASE=4500` → app **4501**, client **5673**
  (`TA_DB_NAME=terra_wave_w28_staking_overhaul`). Below, `<client>` = `http://127.0.0.1:5673`,
  `<app>` = `http://127.0.0.1:4501`. The Playwright stack uses **4502** / **5674**, so it can run beside `npm run dev`.
- **Start the stack:** `cd ../TerraAgent-wt/w28 && npm run dev` (Docker must be running for Postgres `terra-pg`).
  Stop it with Ctrl-C, or `kill $(cat scripts/dev/.out/runner.pid)` when it runs in the background.
- **Pick a fresh pilot name** for each full run, e.g. `owner1` (below: `<you>`). The `w28` scenario gives a pilot,
  once per app run, a linked NEAR wallet `w28-<hash>.terraagent.mock` with **1000 mock NEAR** and **50 USDC**, marks
  it verified (5-turn trial), and seeds a rival wallet that stakes **500 NEAR** as the planet's Lead Patron. Reloading
  `?scenario=w28` makes a new planet but keeps your wallet; use a new name (or restart) for a clean run.
- **Dev console:** on a `/play.html` page press **`` ` ``** (the key under Esc). A dark panel opens at the bottom;
  type a command and press Enter. It is **not** the browser DevTools console. Commands used here: `time.warp
  <seconds>` (moves the staking clock: 24h fee warmup, 7-day exit window, unbonding) and `stake.nominate [planetId]`
  (backs the current planet in the Lead Patron race with your linked wallet). `help` lists everything.
- **Keep two tabs:** tab A = the game `<client>/play.html?scenario=w28&skip=1&as=<you>` (for the console), tab B =
  your dashboard `<client>/me.html?as=<you>#staking`.
- Every new route, URL parameter and console command is listed in [`README.md`](../../../README.md) (staking section
  and "Pages, Controls & Developer Commands"); new env vars are in [`infra/.env.example`](../../../infra/.env.example).

## Steps

1. **Landing funnel.** Open `<client>/landing.html` (the 3D hero can take a few seconds). Top-right header: the
   pill **`⚡ 7.20% SIM APY`** (the `STAKE · LIVE APY` label shows at 641–1180 px widths; desktop shows the compact pill
   so all ten nav items fit). Scroll to **06 EARN** (`#economics`). Drag the slider: markers sit at 10 / 50 / 200 /
   500, the fee row walks **100 → 65 → 50 → 35 → 25 bp** (the 50/35/25 cut notes the 24h warmup). At **200** the
   orange button reads **`STAKE 200 NEAR · UNLOCK TIER 3 →`**; click it → you land on `/me.html#staking?amount=200`
   with **200** in the amount box. (Below 10 NEAR the button invites `STAKE 10 NEAR · UNLOCK TIER 1 →`.)
2. **Public preview, logged out.** Open a private window: `<client>/me.html#staking?amount=50`. No sign-in wall. See
   **`7.20% Sim APY`** and **`Est. $4.00`**, the 4-tier matrix with **Tier 2** highlighted, projections **Daily
   0.0099 NEAR / $0.04 · Monthly 0.3000 NEAR / $1.20 · Yearly 3.600 NEAR / $14.40**, the **NEAR Ecosystem TVL** strip
   (Meta Pool stNEAR / LiNEAR / Whitelisted validators; on a fresh DB the seeded 500 NEAR rival sits under validators),
   and **`Connect NEAR Wallet to Stake 50 NEAR`** (opens the sign-in dialog; NEAR wallet is its first option). Type
   500 in the amount box → the button follows and Tier 4 lights up. At phone width (375 px) nothing scrolls sideways.
3. **5-turn free TEE trial.** Tab A: `<client>/play.html?scenario=w28&skip=1&as=<you>`. Top-right HUD pill: **`⚡
   STAKE · 7.20% APY Sim`** (Tier 0). Colony Book (right rail) → **DIRECTOR**: the AI card shows **`FREE TEE TRIAL (5 / 5
   TURNS LEFT · GLM-5.3-Flash)`** with a **`TEE ✓`** proof link (allow ~15 s for the first poll). Both real planets and
   `?scenario=w28` planets resolve `(planetId, colonyIndex)` through `ManagedAiGate`, so colony-agent sweeps consume the
   5 → 0 trial turns and then switch to **`SCRIPT AI (FREE)`** with **`Trial Complete — Stake 10 NEAR → Keep NEAR.AI TEE Active`**.
4. **Stake 50 NEAR with no colony deed, warmup, compound.** Tab B: `<client>/me.html?as=<you>#staking`. The Wealth
   Dashboard appears under the preview. In the console set amount **50**, asset **Native NEAR**, click **STAKE**. See:
   - **Total staked 50.000 NEAR** ($200.00 Est.) with the chip **`<7d · 0.25% exit fee`**;
   - **Active tier `T2 Commander` · NEAR.AI colony slots 0 / 3 · `Fee warmup 1d 0h`** (the 0.65 % Tier 1 fee applies
     now, 0.50 % after 24h) and **Top Up to Tier 3**;
   - **Net / Gross APY `7.20% Net / 9.00% Sim APY`**, projected **0.0099 NEAR/day**, effective APY **7.20 %
     (self-fills excluded)**;
   - **⚡ AI Compute Budget `$0.00 / $0.0035`, calls `0 / 92`, mode `TEE · z-ai/glm-5.3-flash`**;
   - the ticking yield counter, the SVG chart (click **90d / 1y**: it redraws, dashed = projected), the **Orbital
     Patron Card** with **Share on X** / **Post to NEAR Social**.
   Tab A console: `time.warp 86460`. Reload tab B: the tier card says **`Full tier fee active`** and
   **`↻ Compound Yield`** is shown; click it → total **50.010 NEAR**, exit chip unchanged (compounding keeps the
   7-day clock).
5. **Early exit, instant downgrade, one-step withdraw.** Tab B: amount **45** → the notice reads **"Early exit:
   unstaking within 7 days of your last deposit pays 0.25 % to the Protocol (about 0.112500 NEAR on this amount)"**.
   Click **UNSTAKE** → tier drops at once to **`T0 Cadet`** (unbonding does not count) and **`Unbonding 44.888 NEAR`**
   counts down. Tab A console: `time.warp 172860`. Reload tab B, click **WITHDRAW TO WALLET** (one step, no claim).
   The tx table now lists **Withdraw 44.889 · Early-exit fee 0.1125 · Unstake 45.000 · Compound 0.0099 · Stake 50.000**.
   (Countdowns anchor to the server's `asOfMs`, so `time.warp` advances the warmup, early-exit, and unbonding timers cleanly.)
6. **Tier 4, King-of-the-Hill, prestige.** Tab B: amount **545**, **STAKE** → **`T4 Planetary Patron` · slots 0 / 12 ·
   Top tier reached**. Nominate the planet directly from the **Orbital Patron Card** (`★ Nominate Planet`), from the
   in-game **DEED → Staking** panel (`[★ Nominate Planet]`), or via Tab A console `stake.nominate` → **`w28-….terraagent.mock is Lead Patron of pl_… (ISS
   w28-….near)`** (you overtake the 500 NEAR rival). Reload tab B: the Patron Card names the planet. Reload tab A
   (a reload makes a new scenario planet; run `stake.nominate` again there): HUD pill **`⚡ TIER 4 · 7.20% APY Sim`**,
   and the Command Hub in the middle of the disc carries the **cyan Orbital Uplink Beam**, the rotating dish and the
   gold trim. `@terra/sim` never reads any of this (property-tested over 0..10^6 NEAR).
   - Every tier side by side: `<client>/playground.html?inspect=hub&stakeTier=0` … `4` (or `__pg.setStakeTier(n)` in
     DevTools), and the Lead Patron carrier `<client>/playground.html?inspect=ship.flagshipCarrier`.
   - The carrier parked in the orbit-menu skybox and the Tier 2 drop-pod plasma trail (`…&stakeTier=2` on a descent)
     were checked by the W28-12 visual run with a mocked patron, **not re-checked on this stack**.
7. **Stake Trade Profits & RampView.** Tab B console: **TRADE PROFIT (USDC)** `10.00` → **⚡ Stake Trade Profits (USDC
   → stNEAR)** → **`10.00 USDC → 2.5 stNEAR @ $4.00 (mock)`** and the total rises by 2.5. Then
   `<client>/trade.html?as=<you>`: header pills **`⚡ TIER 4 · 7.20% APY Sim`** and **`FEE 0.25%`** (`FEE 0.65% → 0.50%
   in …` while a warmup runs). In the **1Click ramp** panel pick **USDC** as origin, amount `10.00`, **Quote** → the
   request carries **`amount: "10000000"`, `dry: true`** and the result line shows `10000000 atomic in -> ~10.0 out`
   (no quintillion). The trade page's own **Stake Trade Profits** button spends free *market* USDC from selling cargo;
   the scenario's 50 USDC sits in the NEAR Intents wallet, so the trade button answers "Only 0.00 USDC is free" here —
   use the `/me` console as above.
8. **`verifier.terraagent.testnet` deploy & key sync (dry run only — testnet is frozen).** Terminal:
   `node scripts/dev/deploy-testnet-contracts.mjs --network testnet --dry-run --only verifier` → a plan for
   **`verifier.terraagent.testnet`** with init args `{ owner_id: terraagent.testnet, operator_id:
   minter.terraagent.testnet, strict_balances: true }`. Until you run `npm run near:build-contracts` the entry also
   carries a `wasmError` ("Contract wasm for \"verifier\" not found … Build it with npm run near:build-contracts");
   after the build it shows the wasm size and code hash instead. The `register_account_key` sync (`all_keys_onchain`), strict
   balance preflight and typed RPC errors are **(unit + integration only)**: `backend/app/test/near/verifier-key-sync.spec.ts`,
   `verifier-rpc-failures.spec.ts`, `intents-verifier-settlement.int.spec.ts`. A live deploy needs your go-ahead,
   `npm run near:build-contracts`, and `NEAR_MINTER_SECRET_KEY` (verifier operator).

**Owner-only, real wallet (not done by the lead: frozen testnet, no keys).** With your approval and a funded wallet:
`NEAR_MODE=testnet npm run dev`, open `/me.html#staking` or `/play.html` → **DEED** → staking panel, connect Meteor, Intear,
MyNearWallet, or an injected wallet (HOT / HERE / Nightly / Sender), then: the copy says **"Never game power"**; **Stake**
opens your wallet once for a single `stake_payable` (or `ft_transfer_call` to the LST pool for `stNEAR`/`LiNEAR`); **↻ Compound
Yield** signs `compound_yield`; **Unstake** within 7 days shows the 25 bp notice and signs `unstake` on `/me.html#staking`;
**Withdraw** is one step (`withdraw` on `/me.html#staking` or NEP-413 relayer withdraw in-game; LST withdraw is `withdraw_lst`).

**Flag off.** Restart with `TA_WAVES=..27 npm run dev`: every W28 route answers 404, `/me.html` drops the STAKING tab,
market fees are the W20 ladder again (50 bp at ≥ 10 NEAR), and the in-game panel shows the W20 claim-then-stake flow.
The landing pill and calculator have no wave flag and always show (limitation).

## Automated checks

Run on the merged branch by the lead (pre-existing failures that also fail on `main` are named):

- `npm run validate:wave -- 28` → **16/16 issues merged, 0 errors**; warnings are files near the size limit.
- `npm run e2e -- --waves 28` → **9 passed** (demo steps 1–8 + W28 fence); `--host local` → 3 passed, 6 skipped
  (server steps). Earlier suites with W28 on (`--waves 12,13,16,20,22,28`): W12 step 4 (W21 past-colony card count),
  W13 9d / 9f-3 (`wrong_planet`), W22 step 5 (bounty claim) fail the same way on `main`; W16 step 1 timed out once
  while the unit suite ran beside it and passed on a quiet rerun (`--waves 16,28` → 12 passed).
- `npm test` → only the 7 suites that fail on `main` (planet-region, reconFaction, reconcile-flow w03, w13-regions,
  construction-orders, pod-terraform, no-teleport). `npm run test:integration` → 761/762, the one failure
  (`exchange-real/rails.real`) is on `main` too. `npm run test:contract` → 66/66. `npm run near:test-contracts` →
  **172/172** Rust tests. `npm run validate:particles -- --all` → 25/25. `npm run validate:models -- --all` → 47/50
  (robot.hero / miner / recon fail on `main` too). `npm run test:parity` stops at the w13 scenario, as on `main`.
- `npm run check` → typecheck + structure + gen clean; the same 3 lint errors as `main`.

## When you're done

- **All good:** from the main checkout run **`npm run wave -- land 28`**. It re-runs the gates, merges W28 into
  `main`, tags `wave-28`, pushes, and removes this worktree and branch. (Plain `npm run wave` does the same, then
  opens the next ready wave.)
- **Something is wrong:** tell the wave lead which step and what you saw; it is fixed on the wave branch first.
