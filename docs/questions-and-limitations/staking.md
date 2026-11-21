# Staking — W28 questions & limitations

W28 (Staking Overhaul, 4-Tier Orbital Patronage & Wealth Dashboard). Spec: `docs/NEAR_STAKING_SPEC.md` (main checkout).
`docs/plan/PRODUCT_WAVES.md` and `docs/plan/OWNER_TASKS.md` do not exist in this repository, so no owner question
could be looked up; where the spec left a number open, the spec's own numbers were used (see "Defaults chosen").

## Owner decisions needed

| # | Question | What ships now | Why it needs you |
|---|---|---|---|
| Q-W28-1 | Spec §5.3 says a flash-stake sniper "saves nothing". | `24h` warmup on T2–T4 + `25 bp` exit fee `< 7d`, exactly as specified. | Tier 1 (`65 bp`) is instant, so a `$50k` sniper who trades more than ≈ `71 %` of the stake inside the week saves `35 bp × volume − $125` (e.g. `+$50` at `1×` stake). Pinned by `backend/app/test/near/w28-15-adversarial-economics.spec.ts`. Options: warm up T1 too, raise the exit fee, or accept. |
| Q-W28-2 | Lead Patron share = "`12 %` of gross". | `15 %` of the Protocol's cut (`splitPlatformFee`). | That is `12 %` of gross only while the Planet DAO takes its `20 %`; on a fill without a DAO carve-out the patron gets `15 %` of gross. |
| Q-W28-3 | Tier 3+ "`1.25 %` stall royalty cap (`+25 bp`)". | **Deliberately kept at `1.00 %` (`100 bp`).** | The `100 bp` stall cap is a sim rule (`market.setHubFee` / `placeOrder`, `stallFeeMaxBp`); a per-wallet cap would make `@terra/sim` read staking (`D-31` forbidden), and a flat `+25 bp` server-side rebate out of Protocol's cut would exceed Protocol's `17 bp` net share on Tier 4 patron fills (`68 % × 25 bp = 17 bp < 25 bp`), creating wash-trade arbitrage. UI (`tierMatrix.ts`) and whitepaper match the `0–1.00 %` cap. |
| Q-W28-4 | Wallet splitting. | Quotas are per wallet by its own active stake. | Ten `10 NEAR` wallets get ten AI slots (one each) where one `100 NEAR` wallet gets three. Bounded by the `10 NEAR` minimum and the verified-identity gate on the trial. |
| Q-W28-5 | `/v1/near/staking/performance` visibility. | Public by `accountId`, like a block explorer (aggregated stake rows, public fills, payouts; no player id / keys / settings). | If you want it session-bound, it is one guard on the controller. |

## Deferred / known limitations

- **Live chain:** testnet is frozen. `verifier.<root>` deploy and the real-wallet stake / compound / withdraw were only
  dry-run and unit-tested with fake RPCs; they are owner steps in `docs/plan/checks/w28-check.md`.
- **Rust contract upgrade:** positions staked before the V2 upgrade have no deposit clock (grandfathered `0 bp` exit fee)
  and are listed by `get_account_positions` only after the operator calls `register_position`; LST pools need
  `bind_lst_pool`. Native and LST pools are strictly isolated (`natp:` marker blocks `ft_on_transfer` / `bind_pool` pool
  hijacking), both `deposit_and_stake_lst` and `ft_on_transfer` enforce a `1h` cached-price freshness ceiling
  (`STAKE_PRICE_STALE`) with a live `Promise::and` price read in `on_lst_deposit`, `<7d` `25 bp` native exit fees transfer
  real native backing (`ndep`) to Protocol, and third-party recipient withdrawals require `1 yoctoNEAR` confirmation.
- **Self-custody `unstake` & `withdraw`:** self-custody wallet owners (`caller == account_id`) can call `unstake`,
  `withdraw` (for native-backed `stake_payable` / `deposit_near` positions, including after unbacked simulated
  `compound_yield` where real principal pays out immediately and only the unbacked simulated slice awaits operator
  settlement), `withdraw_lst`, and `compound_yield` directly on-chain without the operator (`GET /v1/near/staking/wallet-tx`
  serves all 9 actions, routing LST deposits and withdrawals to the LST contract pool rather than the native validator
  pool); purely virtual `credit_near` test positions still require operator settlement.
- **Validator APY, live sync & wallet balances:** `StakingPerformanceService` syncs on-chain `accountPositions` (including
  LST pools, with a V1 `get_position` LST probe fallback when `get_account_positions` returns `MethodNotFound`, transient
  RPC error protection so outages never prune LST rows, and automatic `PatronSeatService` refresh) via
  `StakingPositionSyncService` before reading `chain.staking_position`, wires `StakingPort.validatorApy()` on
  `NEAR_MODE=mainnet` (falling back to `9.00 %` gross / `7.20 %` net `Sim APY` on mock/testnet), and reads live RPC
  `StakingPort.nearBalanceOf()` for `walletNear` off mock; LST holdings are valued `1:1` with NEAR as a conservative floor.
- **AI colony slots, model guardrail & tier sweep cadence:** `ColonyAgentLoopService` pins W28 managed turns to
  `access.model` (`z-ai/glm-5.3-flash`) regardless of `NEAR_AI_MODEL` env overrides (protecting the `≥ 65 %` margin),
  respects per-tier `sweepSeconds` (`180 s / 120 s / 60 s / 30 s / 30 s`), and enforces tier `botKeys` (`1` at T0–T1, `3`
  at T2–T4) in `TradeKeysService`. AI colony slots remain a process-local, first-come ledger per wallet and UTC day (the
  daily call budget itself is in `ai.ai_wallet_usage`); after a restart the first colonies to ask retake the slots.
- **Patron payout:** records `chain.staking_patron_payout` (USDC-quoted fills only, idempotent per `sourceTradeId`) and
  settles the Lead Patron's `15 %` share (`12 %` of gross) from `protocol.terraagent.mock` to the Patron's verifier
  balance on mock NEAR; live Testnet/Mainnet off-mock USDC distribution from `protocol.terraagent.*` remains accounting-led
  until the `verifier` contract is deployed live.
- **DAO vote weight (`1.5x`):** works end-to-end on both mock DAO and `dao` Rust contract (`vote_weighted` +
  `get_dao_weights` keyed by `${proposalId}:${voter}`, wired through `TestnetTreasuryDaoAdapter` when `weightBp != 10_000`
  with automatic `MethodNotFound` fallback to unweighted `vote` on frozen V1 Testnet WASM).
- **Guild radar** is wired to the in-game Trade Hub `GUILD` tab (`GET /v1/market/guild/radar` -> `⚡ TIER 2+ EARLY RADAR`
  countdown); there is no WS push yet (the panel polls every `15 s` while open).
- **Wave fencing:** the landing page has no wave-flag mechanism, so its pill and calculator always show. `/me.html`
  hides the STAKING tab when the overview endpoint answers `404` (server `TA_WAVES=..27`) and on `?waves=..27` in dev.
- **Wallet selector & injected wallets:** `createRealSignerWalletSelector('mainnet')` shares the full `WalletSelector`
  singleton (including `MyNearWallet` on Mainnet), and both `sendStakingWalletTx` and NEAR Social Patron Card shares
  dispatch `signAndSendTransaction` through injected `HOT`, `HERE`, `Nightly`, and `Sender` browser wallets alongside
  selector modules (`Meteor`, `Intear`, `MyNearWallet`, `OKX`, `NEAR Mobile`).
- **First-descent plasma trail:** Tier 2+ pilots with a linked session wallet (`ta_active_pilot`) now resolve their
  wallet perks tier before colony creation so their first drop-pod landing carries the Plasma Trail too (dev override:
  `/play.html?…&stakeTier=0..4`).
- **Old W20 e2e** steps 5–6 keep their deed checks with W28 on and skip only the W20 colony-claim staking clicks;
  `--waves ..20` runs them in full.
- **Mock multi-asset Native + LST split:** on mock, `stNEAR` / `LiNEAR` deposits share the first whitelisted pool row, and
  `asset-split.ts` (`readPoolTxAssetNets` + `splitStakedByAsset`) reconstructs exact per-asset staked balances from
  `chain.staking_tx` for both the Wealth Dashboard (`activeStakedNear` vs `balances.lst`) and Ecosystem TVL.
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
