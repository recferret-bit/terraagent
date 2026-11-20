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
- **Validator APY:** no live validator APY reader exists, so `apy.source` is `sim` everywhere (`9.00 %` gross /
  `7.20 %` net); `validatorApy()` on the testnet adapter is not yet wired into pool APYs or `/performance`.
- **Balances off mock:** `/performance` `walletNear` is read from the mock ledger only; LST holdings are valued `1:1`
  with NEAR (a conservative floor).
- **AI colony slots** are a process-local, first-come ledger per wallet and UTC day (the daily call budget itself is in
  `ai.ai_wallet_usage`); after a restart the first colonies to ask retake the slots.
- **Patron payout** is an accounting row (`chain.staking_patron_payout`), USDC-quoted fills only; no USDC moves yet.
- **DAO vote weight (`1.5x`)** works on the mock DAO; the testnet / mainnet DAO adapters ignore `weightBp`.
- **Guild radar** is a REST read (`GET /v1/market/guild/radar`); there is no WS push yet.
- **Wave fencing:** the landing page has no wave-flag mechanism, so its pill and calculator always show. `/me.html`
  hides the STAKING tab when the overview endpoint answers `404` (server `TA_WAVES=..27`) and on `?waves=..27` in dev.
- **Dev scenarios:** scenario planets seat `co_…` colony rows for sim colony `col_N`. Prestige and `ai-access` match
  by slot (`colonyIndex`), but the colony-agent loop itself looks colonies up by id, so on `?scenario=` planets the
  managed-AI trial is shown but not consumed by the loop (real planets use one id for both).
- **HOT wallet** is not in the wallet selector (`@near-wallet-selector/hot-wallet` is not installed); Meteor, Intear,
  MyNearWallet, OKX and NEAR Mobile are.
- **Descent trail** (Tier 2) shows only for a pilot returning to an existing colony: the first descent is built before
  the colony exists. Dev override: `/play.html?…&stakeTier=0..4`.
- **Old W20 e2e** steps 5–6 (colony-claim staking) skip when the app runs W28; they still run with `--waves ..20`.

## Defaults chosen

- One managed `glm-5.3-flash` TEE turn costs `$0.0000375` (`STAKING_RULES.aiCostPerCallUsd`), which reproduces the
  spec's "~18 calls/day at Tier 1, `$4/NEAR`" (and ~92 / ~368 / ~920 for Tiers 2–4).
- "Public planet" = a `core.planet` row whose admission is not `ARCHIVED` (no visibility flag exists).
- Verified pilot (`!isGuest`) = a player with a `core.social_identity` row (Google / Passkey / X / linked NEAR wallet).
- Landing calculator below `10 NEAR` invites `STAKE 10 NEAR · UNLOCK TIER 1 →` instead of promising a tier the amount
  does not buy.
- Gold HQ trim uses the hub's secondary zone (~`21 %` of the hull instead of the usual ~`10 %` accent); the model
  validator passes with 0 warnings.
