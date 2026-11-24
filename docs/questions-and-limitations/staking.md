# Staking — W28 questions & limitations

W28 (Staking Overhaul, 4-Tier Orbital Patronage & Wealth Dashboard). Spec: `docs/NEAR_STAKING_SPEC.md` (main checkout).
`docs/plan/PRODUCT_WAVES.md` and `docs/plan/OWNER_TASKS.md` do not exist in this repository; below are the finalized recommendations implemented for each question and limitation.

## Resolved owner decisions (W28)

| # | Question | Recommendation & resolution | Status |
|---|---|---|---|
| Q-W28-1 | Spec §5.3 says a flash-stake sniper "saves nothing" and could dust pre-stakes bypass the `24h` Tier 2–4 warmup? | **Keep `24h` Tier 2–4 warmup + `<7d` `25 bp` exit fee, and close the dust pre-stake exploit.** Tier 1 (`65 bp`) stays instant per spec (pinned by `backend/app/test/near/w28-15-adversarial-economics.spec.ts`), and crossing from `< 50 NEAR` into `>= 50 NEAR` now resets the effective `stakedSinceMs` warmup clock in Rust `positions.rs`, mock `staking-ledger.ts`, and `stake-clock.reader.ts` (including cross-pool top-ups). | Resolved & implemented |
| Q-W28-2 | Lead Patron share = "`12 %` of gross". | **Keep `15 %` of the Protocol's cut (`splitPlatformFee`).** Matches `12 %` of gross on standard `20 %` DAO carve-out fills and scales cleanly (`<= 15 %` of net protocol revenue) when no DAO carve-out exists. | Accepted by design |
| Q-W28-3 | Tier 3+ "`1.25 %` stall royalty cap (`+25 bp`)". | **Deliberately kept at `1.00 %` (`100 bp`).** Keeps `@terra/sim` completely decoupled from staking (`D-31`) and avoids negative-margin protocol wash arbitrage (`17 bp < 25 bp`). UI (`tierMatrix.ts`) and whitepaper match the `0–1.00 %` cap. | Accepted by design |
| Q-W28-4 | Wallet splitting (`ten 10 NEAR wallets` vs `one 100 NEAR wallet`). | **Keep wallet-level quotas bounded by `10 NEAR` minimum and verified identity (`!isGuest`).** Each wallet earns AI budget strictly on its own staked yield and non-self protocol trade fees (`>= 65 %` margin holds unconditionally). | Accepted by design |
| Q-W28-5 | `/v1/near/staking/performance` visibility & `/me.html` guest lock. | **Keep explorer-style public read by `accountId` and keep `#staking` inside `/me.html`'s signed-in gate (`MePage.ts`).** Public read exposes zero private keys, player ids, or settings; guests preview via `/landing.html#economics` and `GET /v1/near/staking/overview`. | Accepted by design |

## Resolved quick wins & remaining live-chain / architectural caveats

### Implemented quick wins
- **DB-backed AI trade-fee bonus (`tradeFeeProvider`):** `backend/app/src/near/staking/perks/trade-fee.reader.ts` replaces the `() => 0` default in `perks-deps.ts` / `perks.resolver.ts`, summing today's genuine `FINAL` buyer `IntentTrade` protocol cuts (`platformFee - treasuryAllocation - patronPayout`, self-fills excluded) into the 35% daily Managed AI budget.
- **Dust pre-stake warmup reset:** Rust `positions.rs`, mock `staking-ledger.ts`, and `stake-clock.reader.ts` reset `stakedSinceMs` when a wallet crosses `< 50 NEAR` into `>= 50 NEAR`, closing single-pool and cross-pool 24h warmup bypasses while leaving `>= 50 NEAR` top-ups intact.
- **Rust native-backing solvency guard & `op_id` idempotency:** `storage.rs` + `payout.rs` track `TOTAL_NATIVE_BACKING_KEY` (`pndep:` + `ndep:` + `ynative:pool`) so operator virtual withdrawals can never encroach on real `stake_payable` / `deposit_near` principal or `yield_reserve`. `compound_yield` (`payout.rs`) and `withdraw_lst` (`lst.rs`) now accept optional `op_id: Option<String>` scoped by `account_id:op_id` with rollback-safe replay.
- **Price-mode LST yield payout in `TestnetStakingAdapter`:** `testnet-staking.adapter.ts` inspects `entry_lst_price_yocto` from `get_account_positions` (falling back safely on V1 `MethodNotFound`) so `withdraw_lst` withdraws `withdrawable + rewards` on price-mode LST pools and passes `op_id` on both `compound_yield` and `withdraw_lst`.
- **Landing `#economics` live APY hydration:** `stakeCalculator.ts` + `stakeCalculatorMath.ts` fetch `/v1/near/staking/overview` on mount, switching `#econ-apy-badge` and yield calculations to live validator APY when available and cleanly falling back to `7.20% SIM APY` offline.
- **`/me.html#staking` realized USD income strip:** `kpiStrip.ts` + `kpiStrip.css` surface `stakingYieldUsd`, `marketFeeSavingsUsd`, `stallRoyaltiesUsd`, and `patronRevenueUsd` below the 4 uniform KPI cards.
- **Colony account re-claim protection:** `AccountClaimService` (`account-claim.service.ts`) rejects attempts by a different wallet to overwrite an already-claimed colony account (`NEAR_NOT_OWNER`, HTTP 403), while remaining idempotent for the claiming wallet.

### Remaining live-chain & intentional architectural caveats
- **Live chain deployment & Patron payout:** Testnet V1 WASM is frozen; upgrading the contract on Testnet/Mainnet and deploying `verifier.<root>` live for non-mock USDC Patron settlements remain owner deployment steps in `docs/plan/checks/w28-check.md` (with automatic `MethodNotFound` fallbacks intact). Pre-upgrade positions have no deposit clock until registered (`register_position` / `bind_lst_pool`).
- **Guild radar delivery & AI slot ledger:** `GET /v1/market/guild/radar` polls every `15 s` while open (no WS push yet), and `AiSlotLedger` remains process-local per UTC day (after a process restart the first colonies to request retake slots; daily USD/call usage persists in `ai.ai_wallet_usage`).
- **Mock multi-asset ledger & Trade Key cap:** Mock mode maps `stNEAR` / `LiNEAR` deposits onto the first whitelisted pool row with exact per-asset accounting via `asset-split.ts`. Tier 0–1 accounts remain capped at `1` trade API key (`botKeys = 1` with Trade Keys' `$50/d` F2P cap).
- **Direct Patron planet nomination:** Patronage auto-nominates on `/me.html#staking` (canonical 3-planet tabs without a manual dropdown/nominate button per `StakingDashboard.spec.ts`); API `POST /v1/near/staking/patron/nominate` enforces multi-account sibling seat vacation.
- **`/me.html` guest lock & `w28` scenario:** `MePage.ts` keeps guest `inert` lock intentionally (`w28-staking-tab.spec.ts`), hiding `#staking` whenever `TA_WAVES=..27` or `?waves=..27`. The `w28` dev scenario seeds once per pilot per app process (`Trade` Stake Trade Profits uses free market USDC, while `/me.html#staking` Stake Trade Profits uses NEAR Intents USDC).

## Defaults chosen

- One managed `glm-5.3-flash` TEE turn costs `$0.0000375` (`STAKING_RULES.aiCostPerCallUsd`), which reproduces the spec's "~18 calls/day at Tier 1, `$4/NEAR`" (and ~92 / ~368 / ~920 for Tiers 2–4).
- "Public planet" = a `core.planet` row whose admission is not `ARCHIVED` (no visibility flag exists).
- Verified pilot (`!isGuest`) = a player with a `core.social_identity` row (Google / Passkey / X / linked NEAR wallet).
- Landing calculator below `10 NEAR` invites `STAKE 10 NEAR · UNLOCK TIER 1 →` instead of promising a tier the amount does not buy.
- Gold HQ trim uses the hub's secondary zone (~`21 %` of the hull instead of the usual ~`10 %` accent); the model validator passes with 0 warnings.
