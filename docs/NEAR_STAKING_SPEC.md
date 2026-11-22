# TerraAgent — NEAR Staking & Web3 Polish Specification (Locked V2)

> **Status:** Economics & Game-Theory Locked V2 (Feature Branch Scope — Live Hackathon Testnet Remains Frozen Until Explicit Deploy Approval)
> **Source Blueprint:** [`docs/NEAR_PROPOSALS.md`](./NEAR_PROPOSALS.md)
> **Wave Plan:** [`docs/plan/waves/W28-staking-overhaul.md`](./plan/waves/W28-staking-overhaul.md)

This specification defines the complete **3-way win** staking & Web3 overhaul—maximizing **player conversion & prestige** (Web2 `$0` F2P and Web3 whales), **NEAR ecosystem TVL & real validator yield**, and **TerraAgent Protocol treasury profitability (`≥ 65%` AI gross margin, flash-snipe immunity, and zero insolvency risk)**.

---

## 1. Locked Product, Economic & Anti-Exploit Architecture

| Dimension                           | Locked V2 Design                                                                                                                                                                                                                                                                                                                                                                                                                        |
| :---------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Staking Ownership Scope**         | **Wallet / Pilot-level staking.** Any connected NEAR wallet can stake immediately on `/me.html#staking` **with zero Colony Deed prerequisite** (`DEED_NOT_FOUND` removed for wallet staking). Perks apply wallet-wide across `/play.html`, `/trade.html`, and `NEAR.AI`, subject to per-tier **Concurrent `NEAR.AI` Colony Slot** caps.                                                                                                 |
| **Unauthenticated Funnel**          | **Public Staking Preview** on `/me.html#staking?amount=<X>` (replaces the blank login wall in [`frontend/game/pages/me/MePage.ts`](../frontend/game/pages/me/MePage.ts)). Renders live APY, the 4-Tier Patronage ladder, pre-filled `<X> NEAR` income projections, and a top **`Connect NEAR Wallet to Stake <X> NEAR`** CTA.                                                                                                           |
| **5-Turn Free `NEAR.AI` Trial**     | Every newly verified non-guest pilot (`!isGuest`: Google / Passkey / X / Linked NEAR Wallet; `1` grant per pilot identity, never anonymous guests) receives **5 free `z-ai/glm-5.3-flash` TEE trial turns** with real `TEE ✓` proofs before seeing `"Trial Complete — Stake 10 NEAR (100% Refundable + APY) to Keep NEAR.AI Active"`.                                                                                                   |
| **Market Fee Floor & Anti-Snipe**   | **Taker Fee Ladder:** `1.00%` (`T0`) → **`0.65%` (`T1`, unlocks at second `0`)** → **`0.50%` (`T2`)** → **`0.35%` (`T3`)** → **`0.25%` (`T4`)**. Deeper `T2–T4` fee cuts require a **`24h` continuous stake warmup**. Unstaking principal within **`< 7 days`** incurs a **`0.25%` (`25 bp`) early-unstake fee** routed `100%` to `protocol.terraagent.<root>` (`0%` after `≥ 7 days`; `0%` when compounding yield or switching pools). |
| **Wallet-Shared Quotas & Slots**    | Both the **`⚡ Daily AI Compute Budget`** and **`NEP-366` Gasless Relayer Quota** are **shared across the wallet** (never multiplied per colony), preventing multi-colony Sybil gas/AI drain. Concurrent active `NEAR.AI` TEE colonies scale by tier: **`0` (`T0`, after 5-turn trial) → `1` (`T1`) → `3` (`T2`) → `6` (`T3`) → `12` (`T4`)**.                                                                                          |
| **Dynamic USD AI Margin Guardrail** | All managed staking tiers run exclusively on **`z-ai/glm-5.3-flash`**. Daily calls compute dynamically from live USD value: $\text{Daily AI Cap (USD)} = 0.35 \times (\text{Daily 20\% Yield USD} + \text{Daily Protocol Fee USD})$, guaranteeing **`≥ 65%` gross margin at any `NEAR/USD` price**. Heavier models remain **BYOK-only on `/me.html`** (`$0` protocol cost).                                                             |
| **King-of-the-Hill Tier 4 Patron**  | **1 Lead Planetary Patron per public planet** — awarded to the highest active `≥ 500 NEAR` staker nominating that planet. Earns **`15%` of Protocol's trade-fee share** (`12%` of gross fee; Protocol keeps `68%`, Planet DAO keeps `20%`) + parks their named **`ISS <handle>.near`** Carrier in orbit. Competing `500+ NEAR` whales either out-stake them or claim another planet.                                                    |
| **Instant Unstake Downgrade**       | Only `activeStaked` counts toward tier thresholds (`unbonding` balance is excluded, matching [`backend/app/src/near/staking/staker-perks.ts`](../backend/app/src/near/staking/staker-perks.ts)). If a Lead Patron unstakes below the runner-up (or `< 500 NEAR`), planet patronage transfers immediately.                                                                                                                               |
| **100% Mainnet Solvency**           | On Mainnet (`Option A`), `80% / 20%` yield is computed strictly from **real `stNEAR` / `LiNEAR` share-price appreciation** (`exit_price - entry_price`)—never a hardcoded timestamp APY—eliminating vault insolvency risk, paired with Meta Pool / LiNEAR builder referral IDs.                                                                                                                                                         |
| **Wash-Trade Proof ROI & Share**    | **Self-fills** (`buyerOwner == sellerOwner` or `buyerOwner == stallOwner`) are excluded from `Market Fee Savings` and `Stall Royalties` inside `Effective Combined APY %` and the **Shareable Orbital Patron Card** (`X` / `NEAR Social`).                                                                                                                                                                                              |

---

## 2. Conversion & Growth Funnel (`/landing.html` ↔ `/me.html#staking` ↔ `/trade.html`)

### 2.1 `/landing.html` Entry Points

1. **Top Navigation Bar:** Chamfered Faction Plate CTA pill **`⚡ STAKE · LIVE APY`** linking to `/me.html#staking` (displays live RPC validator net APY on Mainnet, or `7.2% SIM APY` badge on Mock/Testnet).
2. **Section 06 `#economics` Calculator ([`frontend/landing/sections/economicsTemplates.ts`](../frontend/landing/sections/economicsTemplates.ts)):**
   - Extend slider (`0–500+ NEAR`) with visual tier markers (`10` / `50` / `200` / `500 NEAR`), updated `0.65% / 0.50% / 0.35% / 0.25%` fee savings math, and dynamic primary orange CTA:
     - **`STAKE <X> NEAR · UNLOCK TIER <N> →`** → navigates to `/me.html#staking?amount=<X>`, pre-filling `<X>` in the console.

### 2.2 `/me.html#staking` — "Effective APY" Wealth, AI Budget & Ecosystem Dashboard

Add a dedicated **`STAKING`** tab (`#staking`) in [`frontend/game/pages/me/MePage.ts`](../frontend/game/pages/me/MePage.ts):

1. **Public Preview Mode (Unauthenticated / Disconnected):**
   - Renders live validator APY, the 4-Tier Orbital Patronage matrix, pre-filled projected income for `?amount=<X>` (default `50 NEAR`), NEAR Ecosystem TVL strip, and a primary **`Connect NEAR Wallet to Stake <X> NEAR`** button.
2. **Top KPI Strip (6 Faction Plate Cards):**
   - **Total Staked:** Active `NEAR` (`+ stNEAR / LiNEAR` value), live `USD` spot (`Live` / `Est.`), and `<7d` warmup / free-exit status chip.
   - **Live Ticking Accrued Yield:** Real-time micro-`NEAR` counter + **`[↻ Compound Yield]`** 1-click restake button (`0%` fee).
   - **Net / Gross Validator APY:** Live RPC validator APY on Mainnet (`80%` Pilot / `20%` Protocol AI+Gas), or clearly badged `7.20% Net / 9.00% Sim APY` on Testnet/Mock.
   - **Projected Income:** `Daily` · `Monthly` · `Yearly` earnings in `NEAR` and `USD`.
   - **Effective Combined APY % _(Self-Fills Excluded)_:**
     $$\text{Effective APY} = \text{Base Net APY} + \frac{\text{Annualized Non-Self Market Fee Savings} + \text{Annualized Non-Self Stall Royalties} + \text{Patron Planet Share}}{\text{Staked Value (USD)}}$$
   - **Active Tier, Colony Slots & Progress Bar:** Current tier (`Tier 0..4`), active **`NEAR.AI` Colony Slots (`Used / Max`)**, warmup timer (`24h` for `T2–T4` fee cuts), and 1-click **"Top Up to Tier N"** button.
3. **All-In Performance, `⚡ AI Compute Budget` & Ecosystem Strip:**
   - **Income Breakdown:** Realized + accrued Staking Yield, verified `/trade.html` Fee Savings (`$USDC`), Trade Hub Stall Royalties, and Tier 4 Planet Patronage payouts.
   - **Live `⚡ AI Compute Budget` Meter:** Wallet-wide `z-ai/glm-5.3-flash` daily USD/call allowance (`Used / Dynamic Daily Cap`), remaining 5-turn Free Trial counter (for `T0`), and trade-volume bonus calls unlocked today.
   - **NEAR Validator & LST Ecosystem Scoreboard:** Live TerraAgent TVL delegated across **Meta Pool (`stNEAR`)**, **LiNEAR (`LiNEAR`)**, and whitelisted validators + **Shareable Orbital Patron Badge** (`Share on X` / `Post to NEAR Social` via `v1.social08.testnet` / `social.near`).
4. **Hybrid Performance Chart (`30d` / `90d` / `1y` Toggle):**
   - Pure SVG Faction Plate chart: **solid line** for realized cumulative yield + non-self fee savings transitioning into a **dashed line** for projected compounding trajectory.
5. **Action Console, "Stake Trade Profits" & Audit Trail:**
   - **Asset Picker:** `Native NEAR` | `stNEAR` | `LiNEAR` + **`[⚡ Stake Trade Profits (USDC → stNEAR)]`** 1-click flow (also surfaced on `/trade.html` after profitable cargo sales).
   - **1-Tx Controls:** `Stake` (`stake_payable` / `ft_transfer_call` with builder referral tag), **`Compound Yield`**, `Unstake` (displaying `<7d` `0.25%` early-exit notice if applicable, `0%` after `7d`), and single-step **`Withdraw to Wallet`**.
   - **Live Unbonding Countdown** + **Verified NearBlocks Tx History Table**.

---

## 3. Four-Tier Orbital Patronage Ladder (`staker-perks.ts`)

| Tier                          | Min Active Stake | Wallet `NEAR.AI` (`z-ai/glm-5.3-flash`) & Colony Slots                                                                     | Market Fee, Relayer & Governance Perks                                                                                                                                           | 3D Diorama & Skybox Prestige                                                                                                  |
| :---------------------------- | :--------------- | :------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------- |
| **Tier 0 — Cadet**            | `0 NEAR`         | **5 Free Trial TEE Turns** (verified `!isGuest` once) → then `Script AI` (`180 s`, `0` TEE slots)                          | `1.00%` taker fee · `1x` wallet `NEP-366` gas cap · `1` bot key (`$50/d`)                                                                                                        | Standard Colony Hull                                                                                                          |
| **Tier 1 — Scout**            | `10 NEAR`        | **`1` Active TEE Colony Slot** · `120 s` sweep · Dynamic USD cap (`~18+` calls/d @ `$4N` + trade bonus)                    | **`0.65%` taker fee (instant at `t=0`!)** · `2x` wallet `NEP-366` gas cap                                                                                                        | **3D Cyan Orbital Uplink Beam** on stake + Rotating Quantum Dish on HQ                                                        |
| **Tier 2 — Commander**        | `50 NEAR`        | **`3` Active TEE Colony Slots** · `60 s` sweep · Dynamic USD cap (`~90+` calls/d + trade bonus) + HUD Tactical Chat        | **`0.50%` taker fee** (`24h` warmup) · **`5 min` Early NPC Guild Ship Radar** · `4x` gas cap · `3` bot keys                                                                      | **Plasma Drop-Pod Re-Entry Trail** + Seasonal Faction Livery + Cyan Cutter Beams                                              |
| **Tier 3 — Archon**           | `200 NEAR`       | **`6` Active TEE Colony Slots** · `30 s` sweep · Dynamic USD cap (`~350+` calls/d + trade bonus) + War-Room & TG Alerts    | **`0.35%` taker fee** (`24h` warmup) · **`1.25%` Stall Royalty cap** (`+25 bp`) · **`1.5x` DAO vote weight** · `8x` gas cap                                                      | **Gold-Anodized Command Hub** + Custom S10 Rocket Plume + Blueprint Minting Rights                                            |
| **Tier 4 — Planetary Patron** | `500+ NEAR`      | **`12` Active TEE Colony Slots** · `30 s` sweep · Dynamic USD cap (`~900+` calls/d + trade bonus) + 3-Role Parallel Passes | **`0.25%` taker fee** (`24h` warmup) · **King-of-the-Hill Planet Patron** (highest `≥500N` staker on planet gets **`15%` of Protocol fee share** + names season) · `15x` gas cap | **Named Flagship Orbital Carrier (`ISS <you>.near`)** parked in 3D Orbit Menu & Descent skybox for all players on that planet |

---

## 4. Exact Codebase & Contract Changes Required

### 4.1 Smart Contracts (Rust `near-sdk 5.7`)

- **[`backend/near-contracts/staking/src/lib.rs`](../backend/near-contracts/staking/src/lib.rs):**
  1. **Direct 1-Step Wallet Payout on `withdraw()` & `withdraw_lst()`:** Execute `Promise::new(recipient).transfer(...)` + rollback callback directly inside `withdraw()` (eliminating stranded `self.balances` / hidden `claim_native_near`), and add `withdraw_lst(pool_id, lst_contract, amount)` via `ext_ft::ft_transfer` + rollback callback.
  2. **1-Click `compound_yield(pool_id)`:** Roll accrued `80%` staker yield directly into `staked` principal (crediting `20%` protocol cut to `protocol.<owner_id>`) with `0%` fee and without resetting the `7-day` maturity timestamp.
  3. **`< 7-Day` Early-Unstake Fee (`25 bp`):** Track `last_staked_at_ms` (weighted or latest deposit timestamp); if `unstake` is called within `< 7 days`, route `25 bp` (`0.25%`) of the unstaked principal to `protocol.<owner_id>` (`0 bp` after `≥ 7 days`).
  4. **Wallet-Scoped Positions & Mainnet Share-Price Accounting (`Option A`):** Expose `get_account_positions(account_id)` independent of Colony Deeds, and implement `entry_lst_price_yocto` share-appreciation accounting + Meta Pool / LiNEAR cross-contract `deposit_and_stake(referral_id)` forwarding for Mainnet solvency.
- **[`scripts/dev/deploy-testnet-contracts.mjs`](../scripts/dev/deploy-testnet-contracts.mjs):**
  - Deploy and initialize `verifier.terraagent.testnet` alongside the existing 6 contracts.

### 4.2 Backend Services & APIs

- **[`backend/app/src/near/staking/staker-perks.ts`](../backend/app/src/near/staking/staker-perks.ts) & [`protocol-fee.config.ts`](../backend/app/src/near/infrastructure/network/protocol-fee.config.ts):**
  - Implement Tiers `0..4`, the `100 → 65 → 50 → 35 → 25 bp` taker fee schedule, `24h` warmup check (`stakedDurationMs >= 86_400_000` required before `50/35/25 bp` apply; `65 bp` active immediately at `≥ 10 NEAR`), wallet-shared `NEP-366` gas multiplier, `maxAiColonySlots` (`0/1/3/6/12`), and King-of-the-Hill Tier 4 Planet Patron resolution (`15%` of Protocol's `80%` fee cut = `12%` of gross platform fee).
- **[`backend/app/src/near/staking/staking.service.ts`](../backend/app/src/near/staking/staking.service.ts) & [`staking.controller.ts`](../backend/app/src/near/staking/staking.controller.ts):**
  - Support wallet-level `stake`, `unstake`, `withdraw`, `compound`, and `stake-profits` (`USDC → stNEAR` quote/swap helper) without requiring a `colonyId`.
  - Add **`GET /v1/near/staking/performance?accountId=...`** returning live RPC wallet/LST balances, live validator APY vs Sim APY flag, `NEAR/USD` spot (`Live`/`Est.`), warmup/early-exit timers, non-self `Market Fee Savings` & `Stall Royalties`, Patron earnings, `Effective Combined APY %`, wallet-wide `⚡ AI Compute Budget` + 5-turn Free Trial status, Ecosystem TVL breakdown, and `30d`/`90d`/`1y` chart series.
- **[`backend/app/src/ai/colony-agent/colony-agent-loop.service.ts`](../backend/app/src/ai/colony-agent/colony-agent-loop.service.ts):**
  - Enforce wallet-wide dynamic USD `z-ai/glm-5.3-flash` budget (`Cost ≤ 35%` of daily `20%` yield USD + daily protocol trade fee USD), enforce `maxAiColonySlots` per wallet, grant **5 one-time free `glm-5.3-flash` TEE trial turns** to verified `!isGuest` pilots, and gracefully downshift to `deterministic-policy` when trial/daily budget is exhausted (BYOK keys bypass protocol budget at `$0` cost).
- **[`backend/app/src/near/infrastructure/adapters/real/testnet-staking.adapter.ts`](../backend/app/src/near/infrastructure/adapters/real/testnet-staking.adapter.ts) & [`testnet-intents.adapter.ts`](../backend/app/src/near/infrastructure/adapters/real/testnet-intents.adapter.ts):**
  - Read real wallet `NEAR` + LST balances via RPC (`view_account` / `ft_balance_of`), sync `verifier::register_account_key` (`strict_balances: true`), and remove silent `catch` swallows.

### 4.3 Frontend Surfaces

- **Landing (`/landing.html`):** Top-nav `⚡ STAKE` pill + `#economics` `0–500 NEAR` calculator deep-linking to `/me.html#staking?amount=<X>`.
- **Profile Wealth Dashboard (`/me.html#staking`):** Public unauthenticated preview, 6-card KPI strip, `Compound Yield`, `Stake Trade Profits`, dynamic `⚡ AI Compute Budget` & Colony Slot bar, NEAR Ecosystem TVL strip, Shareable Orbital Patron Card (`X` / `NEAR Social`), SVG hybrid chart, Native/LST console, and NearBlocks tx table.
- **In-Game & Trade (`/play.html` & `/trade.html`):**
  - Delete `"no in-game bonus"` `REAL_NEAR_COPY` and fix hardcoded `selector.wallet('meteor-wallet')` → `selector.wallet()` in [`stakingPanelParts.ts`](../frontend/game/features/deed/parts/stakingPanelParts.ts).
  - Show 5-turn Free TEE Trial badge → `SCRIPT AI (FREE) · Stake 10 NEAR` vs `NEAR.AI TEE · TIER N` + wallet budget meter in [`DirectorPanel.ts`](../frontend/game/features/director/DirectorPanel.ts).
  - Add `[⚡ Stake Trade Profits]` CTA + active fee-tier pill + `RampView` token-decimal scaling (`6`-dec `USDC` vs `24`-dec `NEAR`, `dry: true` on Testnet) on `/trade.html`.
  - Render 3D HQ Orbital Uplink Beam, Quantum Dish, Plasma Drop-Pod trail, Gold HQ trim, and Lead Patron `ISS <pilot>.near` Orbit Carrier.

---

## 5. Mainnet Solvency & Protocol Margin Proofs

1. **Zero Token Printing & 100% Mainnet Vault Solvency (`Option A` Share-Price Vault):**
   - Native `NEAR` deposits forward via `deposit_and_stake(referral_id)` into **`meta-pool.near` (`stNEAR`)** or **`linear-protocol.near` (`LiNEAR`)**.
   - Yield equals `(current_lst_near_price - entry_lst_near_price) * shares`. Because payouts strictly divide actual realized validator share appreciation (`80%` user / `20%` protocol), **vault liabilities can never exceed vault assets** even if network APY drops from `7.5%` to `3.0%`.
2. **Guaranteed `≥ 65%` AI Margin Under Any Market Crash:**
   - Because `dailyAiBudgetUsd` is computed from **real-time USD value** (`0.35 × (dailyProtocolYieldUsd + dailyProtocolTradeFeeUsd)`), a `70%` drop in `NEAR/USD` automatically scales down free daily `glm-5.3-flash` calls proportionally—**TerraAgent Protocol can never lose money on AI inference.**
3. **Anti-Arbitrage & Anti-Sybil Completeness:**
   - **Flash-stake fee sniping** is blocked by the `24h` `T2–T4` fee warmup + `0.25%` `<7d` early-unstake fee (a `$50,000` sniper unstaking `<7d` pays `0.65%` trade fee + `0.25%` stake exit fee, saving nothing vs waiting legitimately).
   - **Multi-colony gas/AI farming** is blocked by wallet-shared `NEP-366` & AI budgets + `1/3/6/12` colony slot caps.
   - **Trial bot farming & wash-traded APY flexes** are blocked by `!isGuest` verified identity gating on the 5 trial turns and strict self-fill exclusion on `Effective Combined APY %`.
