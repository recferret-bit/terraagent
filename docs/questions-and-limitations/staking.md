# Staking — W28 questions & limitations

W28 (Staking Overhaul, 4-Tier Orbital Patronage & Wealth Dashboard). Spec: `docs/NEAR_STAKING_SPEC.md` (main checkout).
`docs/plan/PRODUCT_WAVES.md` and `docs/plan/OWNER_TASKS.md` do not exist in this repository, so no owner question
could be looked up; where the spec left a number open, the spec's own numbers were used (see "Defaults chosen").

## Owner decisions needed

| # | Question | What ships now | Why it needs you |
|---|---|---|---|
| Q-W28-1 | Spec §5.3 says a flash-stake sniper "saves nothing". | `24h` warmup on T2–T4 + `25 bp` exit fee `< 7d`, exactly as specified. | Tier 1 (`65 bp`) is instant, so a `$50k` sniper who trades more than ≈ `71 %` of the stake inside the week saves `35 bp × volume − $125` (e.g. `+$50` at `1×` stake). Pinned by `backend/app/test/near/w28-15-adversarial-economics.spec.ts`. Options: warm up T1 too, raise the exit fee, or accept. |
| Q-W28-2 | Lead Patron share = "`12 %` of gross". | `15 %` of the Protocol's cut (`splitPlatformFee`). | That is `12 %` of gross only while the Planet DAO takes its `20 %`; on a fill without a DAO carve-out the patron gets `15 %` of gross. |
| Q-W28-3 | Tier 3+ "`1.25 %` stall royalty cap (`+25 bp`)". | **Not wired.** | The `100 bp` stall cap is a sim rule (`market.setHubFee` / `placeOrder`, `stallFeeMaxBp`); a per-wallet cap would make `@terra/sim` read staking, which D-31 forbids. Needs a design that keeps the sim stake-blind (e.g. a server-side royalty rebate). |
| Q-W28-4 | Wallet splitting. | Quotas are per wallet by its own active stake. | Ten `10 NEAR` wallets get ten AI slots (one each) where one `100 NEAR` wallet gets three. Bounded by the `10 NEAR` minimum and the verified-identity gate on the trial. |
| Q-W28-5 | `/v1/near/staking/performance` visibility. | Public by `accountId`, like a block explorer (aggregated stake rows, public fills, payouts; no player id / keys / settings). | If you want it session-bound, it is one guard on the controller. |

## Deferred / known limitations

- **Live chain:** testnet is frozen. `verifier.<root>` deploy and the real-wallet stake / compound / withdraw were only
  dry-run and unit-tested with fake RPCs; they are owner steps in `docs/plan/checks/w28-check.md`.
- **Rust contract upgrade:** positions staked before the V2 upgrade have no deposit clock (grandfathered `0 bp` exit fee)
  and are listed by `get_account_positions` only after the operator calls `register_position`; LST pools need
  `bind_lst_pool`. The Meta Pool / LiNEAR `deposit_and_stake` argument shape and price-method names are unverified
  on-chain, and LST deposits use the cached price with no staleness check.
- **Native `withdraw` is operator-only** on the contract, so a native-NEAR withdraw goes through the server relayer;
  `withdraw_lst` and `compound_yield` are wallet-signed.
- **Validator APY & live wallet balances:** `StakingPerformanceService` now wires `StakingPort.validatorApy()` on
  `NEAR_MODE=mainnet` (falling back to `9.00 %` gross / `7.20 %` net `Sim APY` on mock/testnet) and reads live RPC
  `StakingPort.nearBalanceOf()` for `walletNear` off mock; LST holdings are valued `1:1` with NEAR as a conservative floor.
- **AI colony slots** are a process-local, first-come ledger per wallet and UTC day (the daily call budget itself is in
  `ai.ai_wallet_usage`); after a restart the first colonies to ask retake the slots.
- **Patron payout** is an accounting row (`chain.staking_patron_payout`), USDC-quoted fills only; no USDC moves yet.
- **DAO vote weight (`1.5x`)** works on the mock DAO; the testnet / mainnet DAO adapters ignore `weightBp`.
- **Guild radar** is a REST read (`GET /v1/market/guild/radar`); there is no WS push yet.
- **Wave fencing:** the landing page has no wave-flag mechanism, so its pill and calculator always show. `/me.html`
  hides the STAKING tab when the overview endpoint answers `404` (server `TA_WAVES=..27`) and on `?waves=..27` in dev.
- **HOT wallet** is not in the wallet selector (`@near-wallet-selector/hot-wallet` is not installed); Meteor, Intear,
  MyNearWallet, OKX and NEAR Mobile are.
- **First-descent plasma trail:** Tier 2+ pilots with a linked session wallet (`ta_active_pilot`) now resolve their
  wallet perks tier before colony creation so their first drop-pod landing carries the Plasma Trail too (dev override:
  `/play.html?…&stakeTier=0..4`).
- **Old W20 e2e** steps 5–6 keep their deed checks with W28 on and skip only the W20 colony-claim staking clicks;
  `--waves ..20` runs them in full.
- **Mock stNEAR pool:** on mock, `stNEAR` / `LiNEAR` deposits go into the first whitelisted pool and the last deposit
  sets the position's asset, so after a Stake-Trade-Profits deposit the dashboard counts the whole position as LST
  value (the total is right; the native / LST split is not).
- **`/trade.html` Stake Trade Profits** is offered when the trade wallet has free market USDC (from selling cargo).
  The `w28` scenario seeds its 50 USDC in the pilot's NEAR Intents wallet instead, which the `/me.html#staking`
  console's **Stake Trade Profits** spends (same `POST /v1/near/stake/profits`).
- **`w28` scenario seed** runs once per pilot per app process (reloading `?scenario=w28` creates a new planet and
  must not wipe the demo wallet). For a fresh demo use a new `as=` name or restart the app.

## Defaults chosen

- One managed `glm-5.3-flash` TEE turn costs `$0.0000375` (`STAKING_RULES.aiCostPerCallUsd`), which reproduces the
  spec's "~18 calls/day at Tier 1, `$4/NEAR`" (and ~92 / ~368 / ~920 for Tiers 2–4).
- "Public planet" = a `core.planet` row whose admission is not `ARCHIVED` (no visibility flag exists).
- Verified pilot (`!isGuest`) = a player with a `core.social_identity` row (Google / Passkey / X / linked NEAR wallet).
- Landing calculator below `10 NEAR` invites `STAKE 10 NEAR · UNLOCK TIER 1 →` instead of promising a tier the amount
  does not buy.
- Gold HQ trim uses the hub's secondary zone (~`21 %` of the hull instead of the usual ~`10 %` accent); the model
  validator passes with 0 warnings.
