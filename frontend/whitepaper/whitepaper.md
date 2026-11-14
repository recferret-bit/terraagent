# TerraAgent — Whitepaper (draft v0.1, 2026-10-31)

> Outward-facing specification updated 2026-11-14. Matches [`README.md`](https://github.com/recferret-bit/terraagent/blob/main/README.md), `@terra/sim` deterministic rules, and the live NEAR Testnet deployments. Fee rates, staking splits, and guild parameters are configurable protocol defaults calibrated in the 7-day economy simulator (`/dev/economy-sim/`). *Note: this document describes game and protocol mechanics and makes no promise regarding any token value.*

## 1. Thesis: the economy is the gameplay

Traditional strategy games stop when you close the browser tab and patch balance on spreadsheets. Early blockchain games inverted the problem: tokens came first and gameplay came second. TerraAgent builds a real-time colony RTS where supply, terrain scarcity, trade routes, diplomacy, and autonomous AI directors form one continuous economy across NEAR Protocol and hardware-attested NEAR.AI.

## 2. Web3 ownership & first-class NEAR accounts

- **Human Pilots:** Drop in immediately via FastAuth, OAuth, or NEAR wallet sign-in (`{pilot}.pilots.terraagent.testnet`). Gasless `NEP-366` meta-transactions eliminate seed-phrase popups during play, with atomic key rotation (`claimAccount`) to 100% self-custody at any time.
- **Colony Sub-Accounts:** Isolated sub-accounts hold `NEP-245` orbital cargo, post bounties, settle peer trades, and own the soulbound `NEP-171` Colony Deed.
- **AI Directors & Trading Bots:** Operate solely under scoped session keys (`director-key`, `ta_bot_...`) with strict daily spend allowances and instant revocation (`/v1/trade/kill`).
- **Guild Traders & Protocol Treasury:** NPC freighters (`kestrel`, `vanguard`) quote VWAP-anchored spreads, while `protocol.terraagent.testnet` collects organic protocol shares to fund gasless onboarding and Managed NEAR.AI.

What autonomous agents **cannot** do without a human: exceed spend caps, break an active peace truce or cancel a war, lock human NEAR in bonds, dismantle buildings, claim ownership keys, or stake validator NEAR (`403 AI_STAKING_FORBIDDEN`).

## 3. Player income, lossless staking, 4-way settlement & TerraAgent Protocol

- **Cargo Exports (`100%` to Seller):** Mine surface commodities and wrap them 1-to-1 into `18`-decimal `NEP-245` cargo tokens on `res.terraagent.testnet` across all `10` T1–T3 resources — **Iron** (`metals.t1`), **Light Alloys** (`metals.t2`), **Titanium** (`metals.t3`), **Silica** (`minerals.t1`), **Rare Earths** (`minerals.t2`), **Exotic Crystal** (`minerals.t3`), **Water** (`bio.water`), **Biomass** (`bio.biomass`), **Petroleum** (`bio.t2`), and **Gene-stock** (`bio.t3`) — then sell for USDC, NEAR, or barter cargo on `/trade.html`.
- **Trade Hub Stall Royalties (`0–1.00%`):** Every built Trade Hub acts as a commercial storefront earning `0–100 bp` maker royalties on filled orders.
- **Scoped Trading Bots & Bounties:** Automated `ta_bot_...` bots arbitrage orbital spreads within ACID daily limits, while mercenary defense bounties and breached peace/war bonds pay `90%` directly to victims or defenders.
- **4-Way Atomic Settlement:** Every trade clears atomically via counter-signed `NEP-413` `token_diff` intents across four recipients on top of notional: Seller Principal (`100%`), Stall Owner (`0–1.00%`), Planet Council DAO (`20%` of platform fee = `0.20%` standard / `0.10%` staker), and `protocol.terraagent.testnet` (`80%` of platform fee = `0.80%` standard / `0.40%` staker). On a `$100.00 USDC` fill with a `0.50%` stall fee, a standard buyer pays `$101.50` (`$101.00` for stakers): `$100.00` to Seller, `$0.50` to Stall Owner, `$0.20` (`$0.10`) to Planet DAO, and `$0.80` (`$0.40`) to Protocol.
- **Day-1 Lossless Staking:** Stake NEAR from Day 1 on `staking.terraagent.testnet` (`9.0%` gross pool APY, `2` game-day unbonding). Pilots keep `100%` principal plus `80%` of yield (`7.20%` net APY); `20%` (`1.80%` APY) funds `TerraAgent Protocol`. A `50 NEAR` Day-1 stake earns `+3.60 NEAR/yr` for the pilot and routes `+0.90 NEAR/yr` to Protocol — unlocking Managed NEAR.AI Autopilot and a `50%` platform fee cut (`1.00%` down to `0.50%`) at `>= 10 NEAR` with **zero** combat or harvesting buffs.
- **Bonded Diplomacy & 6-Hour War Escrows:** Bonded truces (`2h–72h`) and `6h` War Bonds (granting `2x` Raider carry capacity `40 -> 80`) lock collateral on `bounty.terraagent.testnet`. Peaceful truce completion or meeting war objectives (`>= 1` razed structure or `>= 200` siphoned resources) refunds `100%`; early betrayal or failed sieges slash `90%` (`18.0 NEAR` on a `20 NEAR` bond) to the counterparty and `10%` (`2.0 NEAR`) to Protocol.
- **Why `TerraAgent Protocol` Scales Net-Positive (Zero Token Printing):** Three organic inflows (`0.80%/0.40%` trade fee share, `1.80%` validator yield slice, and `10%` bond slashes) fund the two real Web3/AI operating costs: `relayer.terraagent.testnet` gasless `NEP-366` meta-transactions (`~0.0003 NEAR/tx` within a `5 NEAR/day` cap and `<= 0.05 NEAR` attached deposit limit, plus `0.02 NEAR` cold-root pilot provisioning — at an illustrative `~$4/NEAR`, one `$100 USDC` fill's `+$0.80 ≈ 0.20 NEAR` funds `~650` player meta-txs) and batched `NEAR AI Cloud` TEE turns (`1` `z-ai/glm-5.3-flash` RPC every `180 s` packing up to `5` colonies into one request with a `120 s` state-digest burst cooldown ≈ `$0.03–$0.05/planet/day`). Just `~$7/day` of planet trade volume (`$7 × 0.80% = $0.056/day`) or `200 NEAR` of planet staked TVL (`4 × 50 NEAR` pilots generating `+3.60 NEAR/yr ≈ $14.40/yr` or `~$0.04/day` at `~$4/NEAR`) covers an entire persistent 24/7 planet; all rates are live-inspectable at [`GET /v1/near/protocol`](/v1/near/protocol).

## 4. Verifiable NEAR.AI commanders, Agent Commerce, 25-Agent Swarms & Guild pricing

- **Orbital Guild VWAP Pricing:** Scheduled NPC freighters (`kestrel`, `vanguard`) quote every T1 pair from trailing `24h` organic VWAP (min `3` eligible fills) via `mid = ref * clamp((T + 10) / (I + 10), 0.50, 2.00)^0.5`, widening half-spreads from `2%` (`4%` full spread) to `15%` on the thin inventory side while exporting `10%` of surplus off-planet on departure.
- **Batched TEE Commanders & Encrypted BYOK:** Rival AI colonies and Managed Staker Autopilot run batched `z-ai/glm-5.3-flash` turns on **NEAR AI Cloud** (`cloud-api.near.ai/v1`) inside hardware TEEs verified via NEAR AI Cloud `/v1/signature/{chat_id}` (`SHA-256` `model:request:response` ECDSA attestation persisted in TerraAgent's `ai` TEE signature log), alongside `AES-256-GCM` encrypted BYOK support (`GLM-5.3`, `GLM-5.3 Flash`, `DeepSeek V3.2`, `DeepSeek V4.1 Flash`, `Qwen 3.8 27B`, `GPT-5 Mini`, `Claude Sonnet 4.6`, or custom model IDs) on `/me.html`.
- **Agent Commerce & 1-Round Negotiation:** Scoped colony contractors (`verdant-collective.terraagent.testnet`) decompose multi-step goals under strict `USDC`/`NEAR` budgets, execute 1-round benchmark counter-quote negotiation (`negotiateAgentQuote`: counter once when ask > planned, settle `<= walkAwayUnitPrice` via `NEP-413` or `bounty.terraagent.testnet`, or walk away to local smelting), and emit verifiable `AgentTaskReceipt` proofs.
- **25-Sub-Account Zero-LLM Swarms:** Twenty cohort-typed buyer sub-accounts (`buyer-01..20.swarm.terraagent.testnet` across `terraformer`, `industrial`, `shield_builder`, and `arb_bot`) and five NPC/rival sellers (`seller-01..03.swarm` + `kestrel.npc`, `vanguard.npc`) clear multi-day scarcity rounds via a deterministic uniform-price auction (`zeroLlmCalls: true` in `/dev/economy-sim/`), filling bids in price-priority order (`maxPriceUsdc` descending) with verified multi-party `NEP-413` `sum(token_diff) == 0` conservation.

## 5. Core loop, cadence & trust architecture

You land one Hero bot, build a Command Hub, expand across Desert, Ocean, and Temperate worlds, terraform hexes into Living ground to unlock T2 (30%) and T3 (70%) resources, and race neighbors to the S10 Ascension Rocket.

| Cadence | Player Decision | Economic Consequence |
|---|---|---|
| Every 30 s | Place extractors, power grids, or terraform brushes | Storage fills fast: spend, export cargo, or stall production |
| Every 5 min | Survive night drops, raids, or Guild freighter docks | Unbuffered dusk sheds power; docking re-prices markets |
| Every session | Climb stages S0–S10 and tune away budgets | Higher tiers shift supply chains and overnight AI trades |

| Trust Layer | Authoritative State | Responsibility |
|---|---|---|
| NEAR Protocol + NEAR.AI | Pilot/colony accounts, `NEP-245` cargo, `NEP-171` deeds, bonds, staking, DAO & TEE proofs | Custody, finality, and verifiable AI |
| Simulation Server (`@terra/sim`) | Deterministic 5 Hz hex state, power grids, combat, and agent spend caps | Game physics and rate protection |
| WebGL2 Client (`Three.js`) | 60 FPS diorama rendering, prediction, and input dispatch | Responsive UI (zero authority) |

## 6. Live NEAR Testnet deployments & sandbox parity

| Account | Standard & Role | Testnet Proof |
|---|---|---|
| `res.terraagent.testnet` | `NEP-245` Orbital Cargo Multi-Token (10 commodities) | [5reiQL5X…](https://testnet.nearblocks.io/txns/5reiQL5XddxLS9hDDmKrh1Nn4N8f5Ui9KjtqySvGejok) |
| `deed.terraagent.testnet` | `NEP-171` Soulbound Colony Deeds & Milestone Badges | [E1AGHyMm…](https://testnet.nearblocks.io/txns/E1AGHyMmzCGdsRqvoMVjqWqVQGGkuRu3djQzuRj3wRGK) |
| `bounty.terraagent.testnet` | Mercenary Bounties, Peace Treaties & 6h War Escrows | [21F1c5Td…](https://testnet.nearblocks.io/txns/21F1c5TdGtgcAhoTMPRMkHCYvQ15USqo4fpxBrXU8UAB) |
| `staking.terraagent.testnet` | Day-1 Lossless Validator Vault (80/20 yield split) | [5UvHFrKU…](https://testnet.nearblocks.io/txns/5UvHFrKUocqf5JewptneZqGeXgXkJQZaeVMPfHTrusX2) |
| `dao.terraagent.testnet` | Planet Council Treasury Voting (> 50% quorum) | [DmsGYQ7V…](https://testnet.nearblocks.io/txns/DmsGYQ7VBajz1rRC5FKxNarnnddhs5CzeVgfJc6mqx5U) |
| `pilots.terraagent.testnet` | Cold-Root Pilot Sub-Account Factory (`create_pilot_account`) | [cSTqNFu5…](https://testnet.nearblocks.io/txns/cSTqNFu5aQKb9MiJwantuhxj4Hwn3T2D4WbhCHJAr2h) |

| Capability | Live NEAR Testnet | Offline Local Sandbox |
|---|---|---|
| Accounts & Relayer | `pilots` factory + gasless `NEP-366` `relayer.terraagent.testnet` | Ephemeral local keypair & instant mock receipts |
| Cargo & 4-Way Swaps | `res` `NEP-245` mint/burn + `NEP-413` `token_diff` & 1Click quotes | Local Postgres ledger & deterministic matcher |
| Deeds & Bond Slashes | `deed` & `bounty` contracts with automatic 90/10 settlement | Mock chain tables with identical state transitions |
| Staking & Planet DAO | `staking` (80/20 split, human-only) & `dao` proposal execution | Simulated validator epochs & local council tally |
| Verifiable AI Commander | Hardware TEE `z-ai/glm-5.3-flash` + ECDSA attestation | Deterministic mock planner for offline testing |

## 7. Known risks & design trade-offs

- Automation is first-class in beta under explicit spend and rate caps rather than identity gates; resource caps pace emission without promising price floors.
- Daily agent spend allowances, staker fee tiers, and war objectives are enforced by `@terra/sim` + PostgreSQL ACID locks; custody, deeds, staking principal, and escrow settlements live on NEAR.
- Repository history starts 2026-10-29 within the hackathon window, with starter terrain/visual scaffolding disclosed in `README.md`.
