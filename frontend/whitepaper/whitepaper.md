# TerraAgent — Whitepaper (draft v0.1, 2026-10-31)

> Outward-facing specification updated 2026-11-14. Matches [`README.md`](../../README.md), `@terra/sim` deterministic rules, and the live NEAR Testnet deployments. Values marked *(proposed)* are tunable defaults calibrated in the 7-day economy simulator (`/dev/economy-sim/`). This document describes game and protocol mechanics and makes no promise regarding any token value.

## 1. Thesis: the economy is the gameplay

Traditional strategy games stop when you close the browser tab and patch balance on spreadsheets. Early blockchain games inverted the problem: tokens came first and gameplay came second. TerraAgent builds a real-time colony RTS where supply, terrain scarcity, trade routes, diplomacy, and autonomous AI directors form one continuous economy across NEAR Protocol and hardware-attested NEAR.AI.

## 2. Web3 ownership & first-class NEAR accounts

- **Human Pilots:** Drop in immediately via FastAuth, OAuth, or NEAR wallet sign-in (`{pilot}.pilots.terraagent.testnet`). Gasless `NEP-366` meta-transactions eliminate seed-phrase popups during play, with atomic key rotation (`claimAccount`) to 100% self-custody at any time.
- **Colony Sub-Accounts:** Isolated sub-accounts hold `NEP-245` orbital cargo, post bounties, settle peer trades, and own the soulbound `NEP-171` Colony Deed.
- **AI Directors & Trading Bots:** Operate solely under scoped session keys (`director-key`, `ta_bot_...`) with strict daily spend allowances and instant revocation (`/v1/trade/kill`).
- **Guild Traders & Protocol Treasury:** NPC freighters (`kestrel`, `vanguard`) quote VWAP-anchored spreads, while `protocol.terraagent.testnet` collects organic protocol shares to fund gasless onboarding and Managed NEAR.AI.

What autonomous agents **cannot** do without a human: exceed spend caps, break an active peace truce or cancel a war (`AW-13`), lock human NEAR in bonds, dismantle buildings (`AW-10`), claim ownership keys, or stake validator NEAR (`403 AI_STAKING_FORBIDDEN`).

## 3. Player income, lossless staking & 4-way settlement

- **Cargo Exports (`100%` to Seller):** Mine scarce Metals, Crystals, Water, and Bio-Fuel, wrap them into `NEP-245` tokens on `res.terraagent.testnet`, and sell for USDC, NEAR, or barter cargo on `/trade.html`.
- **Trade Hub Stall Royalties (`0–1.00%`):** Every built Trade Hub acts as a commercial storefront earning maker royalties on filled orders.
- **Scoped Trading Bots & Bounties:** Automated bots arbitrage orbital spreads within daily limits, while mercenary defense bounties and breached peace/war bonds pay 90% directly to victims or defenders.
- **4-Way Settlement (`D-44`):** Every trade clears atomically via counter-signed `NEP-413` `token_diff` intents across four recipients: Seller Principal (100%), Stall Owner (0–1.00%), Planet Council DAO (20% of platform fee), and TerraAgent Protocol (80% of platform fee).
- **Day-1 Lossless Staking:** Stake NEAR from Day 1 on `staking.terraagent.testnet` (9.0% gross pool APY, 2 game-day unbonding). Pilots keep 100% principal plus 80% of yield (7.20% net APY); 20% (1.80% APY) funds TerraAgent Protocol. Staking >= 10 NEAR unlocks Managed NEAR.AI Autopilot and a 50% platform trade fee cut (1.00% down to 0.50%) with **zero** combat or harvesting buffs.
- **Bonded Diplomacy & 6-Hour War Escrows:** Bonded truces (2h–72h) and 6-hour War Bonds (granting 2x Raider carry capacity) lock collateral on `bounty.terraagent.testnet`. Peaceful truce completion or meeting war objectives refunds 100%; early betrayal or failed sieges slash 90% to the counterparty and 10% to Protocol.

## 4. Verifiable NEAR.AI commanders & Guild pricing

Orbital Guild merchants price every pair from live 24h organic VWAP using `mid = reference * (target / inventory)^k` with 4%–15% spreads. Rival AI colonies and Managed Staker Autopilot run batched `z-ai/glm-5.3-flash` turns on NEAR AI Cloud inside hardware TEEs attested via `/v1/signature/{chat_id}`, alongside encrypted BYOK key support on `/me.html`.

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
| `pilots.terraagent.testnet` | Cold-Root Sub-Account Factory & `claimAccount` Flow | [cSTqNFu5…](https://testnet.nearblocks.io/txns/cSTqNFu5aQKb9MiJwantuhxj4Hwn3T2D4WbhCHJAr2h) |

| Capability | Live NEAR Testnet | Offline Local Sandbox |
|---|---|---|
| Accounts & Relayer | `pilots` factory + gasless `NEP-366` `relayer.terraagent.testnet` | Ephemeral local keypair & instant mock receipts |
| Cargo & 4-Way Swaps | `res` `NEP-245` mint/burn + `NEP-413` `token_diff` & 1Click quotes | Local Postgres ledger & deterministic matcher |
| Deeds & Bond Slashes | `deed` & `bounty` contracts with automatic 90/10 settlement | Mock chain tables with identical state transitions |
| Staking & Planet DAO | `staking` (80/20 split, human-only) & `dao` proposal execution | Simulated validator epochs & local council tally |
| Verifiable AI Commander | Hardware TEE `z-ai/glm-5.3-flash` + ECDSA attestation | Deterministic mock planner for offline testing |

## 7. Known risks & design trade-offs

- Automation is first-class in beta under explicit spend and rate caps rather than identity gates (`D-25`, `D-45`); resource caps pace emission without promising price floors.
- Daily agent spend allowances, staker fee tiers, and war objectives are enforced by `@terra/sim` + PostgreSQL ACID locks; custody, deeds, staking principal, and escrow settlements live on NEAR.
- Numbers marked *(proposed)* are tunable defaults validated across 7-day deterministic economy simulations.
- Repository history starts 2026-10-29 within the hackathon window, with starter terrain/visual scaffolding disclosed in `README.md`.
