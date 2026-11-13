# TerraAgent — Whitepaper (draft v0.1, 2026-10-31)

> Outward-facing; last updated 2026-11-13. It agrees with `docs/spec/DECISIONS.md`, `docs/spec/ECONOMY.md`, the game specs, and the live NEAR Testnet port matrix in `README.md`. Numbers marked *(proposed)* are tunable defaults from [`../economy-balance-simulation.md`](../economy-balance-simulation.md). This document describes mechanics; it makes no promise about the value of any token.

## 1. The problem

Online strategy games stop when you close the tab, and their economies are spreadsheets the studio patches. Blockchain games have mostly inverted the problem: the token is the game and the loop is an afterthought. TerraAgent is a colony builder where **the economy is the gameplay**: the colony keeps mining, trading, defending, and terraforming while you are away, prices move because players and agents trade, and NEAR + NEAR.AI provide sandboxed agent accounts, verifiable inference, and atomic settlement invisibly.

## 2. The game in one screen

You drop one robot on a planet. It prepares the ground, builds a Command Hub, and the colony grows: extractors, power, storage, drones, turrets, a Trade Hub. Every building draws power, every tile must be terraformed before it can be built on, and Living ground unlocks higher-tier resources. Five colonies share a planet across Desert, Ocean, and Temperate worlds; they trade on the planet market, deal with Orbital Guild traders, sign peace treaties or declare wars, vote in the planet treasury, and seal their Colony Deed.

| Cadence | What the player does | What the economy does |
|---|---|---|
| Every 30 s | one order: a building, a drone, a terraform brush; accept or ignore a Guild offer | storage fills in minutes, so every decision is *spend, export, or lose it* |
| Every 5 min | a stage beat: the first night, a raid, a terraform threshold, a treaty or council vote; a Guild ship docks every 20–40 min | night sheds production unless the grid is sized for it; a docking re-prices every pair |
| Every session | the next tier or terraform gate; the away budget, staking perks, and auto-trade limits; "while you were away" | new tiers change what the colony mines and sells; the director trades overnight within its allowance |

## 3. Agents are citizens (and why NEAR is essential)

Every actor that holds value in TerraAgent is a first-class account on NEAR with cryptographic and server-enforced boundaries:

- **Players** get `{pilot}.pilots.terraagent.testnet` (or `{name}.terraagent.testnet`) via FastAuth / OAuth / NEP-413 wallet sign-in; `relayer.terraagent.testnet` sponsors NEP-366 gasless meta-transactions so players never hit seed phrases or gas popups during play, with atomic key rotation (`claimAccount`) to 100% self-custody at any time.
- **Colonies** are isolated sub-accounts that hold NEP-245 orbital cargo, sign market orders, post bounties, and own the soulbound NEP-171 Colony Deed.
- **The AI Director & External Bots** sign trades under scoped keys (`director-key` and `ta_bot_...`) with ACID per-token spend allowances and one-click revocation (`/v1/trade/kill`).
- **Orbital Guild traders** (`kestrel`, `vanguard`) are NPC agents with their own sub-accounts, inventories, and a published VWAP-anchored power-law pricing rule.
- **TerraAgent Protocol** (`protocol.terraagent.testnet` / `protocol.terraagent.near`, inspected at `GET /v1/near/protocol`) is the transparent protocol treasury account that receives protocol fee and staking/slash shares and funds gasless NEP-366 relays plus Managed `NEAR.AI` Autopilot.

What an AI agent **cannot** do without a human: spend beyond its allowance, break an active peace truce or cancel a declared war (`AW-13`), lock human `NEAR` in diplomacy/war bonds, demolish buildings (`AW-10`), claim the account, or stake/unstake validator NEAR (`403 AI_STAKING_FORBIDDEN`).

## 4. How players earn, Day-1 Staking, and TerraAgent Protocol

### 4.1 Four player & agent income lanes

1. **Commodity Production & Biome Arbitrage:** Mine biome-abundant T1–T3 metals, minerals, water, and bio-resources, export via the Trade Hub to mint NEP-245 tokens on `res.terraagent.testnet`, and sell on `/trade.html` for `USDC`, `NEAR`, or scarce cargo (`100%` of sale principal goes to the seller).
2. **Trade Hub Stall Royalties (`0–1.00%`):** Every built Trade Hub is a commercial stall; its owner sets a `0–100 bp` maker stall fee and earns quote-token royalties on every fill against their orders.
3. **Scoped Algorithmic Bots (`ta_bot_...`):** Players run automated market-making and arbitrage bots via `/v1/trade/*` under bounded daily spend caps.
4. **Mercenary Bounties & Peace/War Escrow Slashes (`90%` payout):** Players earn escrowed cargo/NEAR by completing raid-defense bounties, holding a Bonded Peace Treaty when an ally betrays it early, or defending against a failed/canceled `6h` War Bond.

### 4.2 Four-way trade settlement (`D-44` + `TerraAgent Protocol`)

Buyers pay the platform fee (`100 bp` = `1.00%` standard, or **`50 bp` = `0.50%` for active stakers**) plus the maker's stall fee (`0–100 bp`) in the pair's quote token (`USDC`, `NEAR`, or cargo). Every matched trade settles atomically as a zero-sum `NEP-413` `token_diff` batch across four legs: **Seller Principal (`100%`)**, **Stall Owner (`0–1.00%`)**, **Planet Council DAO (`20%` of platform fee)**, and **TerraAgent Protocol (`80%` of platform fee)**.

### 4.3 Lossless Day-1 Staking (`Zero Pay-to-Win`)

Any claimed human account can stake `NEAR` from **Day 1** (no `Settled` colony wait required) on `staking.terraagent.testnet` (`9.0%` gross validator pool APY, `2` game-day unbonding):

- **80% / 20% Validator Yield Split:** The player keeps `100%` of staked principal plus **`80%` of validator yield (`7.20%` net APY)**; **`20%` of validator yield (`1.80%` APY)** routes to `TerraAgent Protocol` as a lossless infrastructure subscription.
- **Two Utility Perks at `>= 10 NEAR` Staked:** Unlocks **Managed Server `NEAR.AI` Autopilot** (`z-ai/glm-5.3-flash` batched TEE inference without needing a personal API key) and a **50% Platform Trade Fee Discount** (`1.00% -> 0.50%`). Players who want custom models without staking can still attach an encrypted BYOK `NEAR.AI` key on `/me.html`. Staking grants **zero** combat or mining buffs (`@terra/sim` is completely isolated from staking).

### 4.4 Skin-in-the-game Diplomacy: Bonded Peace Treaties & 6-Hour War Escrows

Locked on `bounty.terraagent.testnet` (`slash_escrow`):

- **Two-Tier Peace Treaties (`2h–72h`):** Colony pairs can sign a **Free Unbonded Truce** (`0` deposit; early cancel stamps a `24h` public `Oathbreaker` badge) or a **Bonded Peace Treaty** where both sides lock matching `NEAR` or `NEP-245` cargo. Peaceful expiry refunds `100%` to both sides; early `cancelTruce` slashes the breaker's bond **`90%` to the betrayed partner + `10%` to `TerraAgent Protocol`** (partner's bond refunds `100%`).
- **6-Hour Bonded War Escrows (`108 000` ticks):** An attacker may lock a War Bond (`NEAR` or `NEP-245` cargo) when declaring war to unlock **`2x` Raider Loot Siphon** (`siphonCarryCap` `40 -> 80`). Destroying `>= 1` enemy structure or siphoning `>= 200` resources within `6h` refunds `100%` of the bond; canceling war early (`cancelWar`), being eliminated during the war, or letting the `6h` timer expire without meeting the objective slashes **`90%` to the Defender + `10%` to `TerraAgent Protocol`**.

## 5. What is on-chain, and why

| Layer | Holds | Truth |
|---|---|---|
| NEAR (`6` Rust contracts + `intents.near`) | pilot & colony sub-accounts (`pilots`), NEP-245 cargo (`res`), zero-sum trade batches (`NEP-413` + `1Click`), soulbound Deeds & Badges (`deed`), mercenary & peace/war escrows (`bounty`), Day-1 staking (`staking`), Planet Council DAOs (`dao`), and `protocol.terraagent.*` | the chain |
| Server simulation (`@terra/sim`) | 5 Hz deterministic production, power grids, terraforming, combat, and export/import authorizations | the game server |
| Client (`Three.js` WebGL2) | 60 FPS prediction, diorama rendering, and HUD input | nothing |

## 6. Fair merchants & verifiable TEE AI

The Guild's price for every pair follows one readable rule: `mid = reference * (target inventory / inventory)^k`, anchored to the planet's 24-hour organic VWAP, with thin-side spreads widening from `4%` up to `15%` and plain-English reason tooltips on every quote. Autonomous Rival AI colonies and Managed Staker Autopilot run batched `z-ai/glm-5.3-flash` directives on **NEAR AI Cloud** inside hardware TEEs verified via `/v1/signature/{chat_id}` ECDSA signatures.

## 7. What runs on real NEAR Testnet

All **11 NEAR ports** run on deterministic Postgres mocks locally (`NEAR_MODE=mock`) and bind to **live NEAR Testnet** (`NEAR_MODE=testnet`) across 6 deployed `near-sdk 5.7` contracts (`res`, `deed`, `bounty`, `staking`, `dao`, `pilots`) plus `protocol.terraagent.testnet` (`txHash` `567guLDVMfBG9t9n1dNGtL5ziQcuwArj1Ff8wcsHgdq4`), `relayer.terraagent.testnet`, and `minter.terraagent.testnet` (with 1-env promotion to `NEAR_MODE=mainnet` + `NEAR_ALLOW_MAINNET=1`):

| Deployed Account | Standard / Role | Live Testnet `code_hash` | Deployment `txHash` |
|---|---|---|---|
| `res.terraagent.testnet` | NEP-245 Cargo Multi-Token (`10` resources) | `6G6Ew8mygiAud4NoA772PzkCwnbfUA6ZacWxEnrpqJwC` | `HcukrSstSJwmzNkrYekqbt6Kt9V8AZAjTYhebb7B3Sso` |
| `deed.terraagent.testnet` | NEP-171 Soulbound Colony Deeds & Badges | `GFB5WgL1hMiCSFZSNjiXdYhui68ptf2AyDvFHZGUR6pB` | `3csscTYvcVK5Sz8JUvvtjULj5tHyb6J1XC3U8tddZyV9` |
| `bounty.terraagent.testnet` | Mercenary & Peace/War Bond Escrow (`90/10` slash) | `79UNK5jUfEWWQYtBjSqD69UyKEw6vVGmUSrtBGy1ow2e` | `2Uw4SkRkKedPtTtjzyewAFy2N5jnAcgB9HnKpPS7aSua` |
| `staking.terraagent.testnet` | Day-1 Lossless Staking Vault (`80/20` yield split) | `Hjw4T6c4hAN3A81xqytUmD5heR7aahtGbwMkpqAX8Yze` | `DD7gHYoZji5prVQZsnpaQSkQVqMrR9gqJaHJd1RNyTmP` |
| `dao.terraagent.testnet` | Planet Council Treasury DAO (`> 50%` quorum) | `Aa2cch25oaHQohk5FxTDAxBSRw5L5pHkxWxxjJbr992G` | `G8YgUSGW1XaTSY2ZpG8nncB5ZuEU9ibjTSYMNHD3HcuJ` |
| `pilots.terraagent.testnet` | Cold-Root Pilot Sub-Account Factory | `6nKVXYo46jG61ZUB1VUogGwC1ennpDzEWzqAGKQguU4z` | `9KT6vYxpJG28nB8gc4VJUPmN9QxXoTZb865ZUaSPxuX5` |

| Feature | Live (`NEAR_MODE=testnet` / `AI_PROVIDER=nearai`) | Local Dev (`NEAR_MODE=mock` / `AI_PROVIDER=mock`) |
|---|---|---|
| Identity, Cold-Root Sub-Accounts & NEP-366 Relayer | Live `pilots.terraagent.testnet` + `relayer.terraagent.testnet` (`SignedDelegate` meta-txs & atomic `claimAccount` key rotation) | Postgres mock identity & relayer with realistic receipts |
| Cargo Multi-Tokens (NEP-245) | Live `mt_mint`, `mt_burn`, `operator_transfer` on `res.terraagent.testnet` | Postgres mock ledger with deterministic `opId` receipts |
| 4-Way Markets & NEAR Intents | Counter-signed `NEP-413` `token_diff` (Seller, Stall, 20% DAO, 80% Protocol; 50% Staker fee cut) + live `1click.chaindefuser.com` dry quotes (`intents.near` on mainnet) | Postgres mock verifier & Guild order matching |
| Deeds, Bounties & Peace/War Slashing | Live `deed.terraagent.testnet` (NEP-171) & `bounty.terraagent.testnet` (`open_escrow`, `claim_escrow`, `refund_escrow`, `slash_escrow` 90/10) | Postgres mock tables (`chain.mock_chain_*`) |
| Day-1 Staking Vault & Planet Council DAO | Live `staking.terraagent.testnet` (80/20 yield split, `>= 10 NEAR` perks, `403` for AI) & `dao.terraagent.testnet` (`> 50%` quorum) | Postgres mock staking & DAO policy tables |
| Verifiable TEE AI (`NEAR.AI`) | Live NEAR AI Cloud TEE (`z-ai/glm-5.3-flash`) + ECDSA `/v1/signature/{chat_id}` verification + Managed Staker & `/me` AES-256-GCM BYOK | Deterministic mock LLM adapter |

The `README.md` live Testnet contract & port matrix is authoritative.

## 8. Risks we accept and state

- No anti-cheat and no anti-bot identity gate in beta (`D-25`, `D-45`); automation is first-class under explicit rate and spend caps, and mint/throughput caps pace supply rather than guarantee price floors.
- Per-token agent spend caps, staker fee tiers, and war-objective counters are enforced by the authoritative game server (`@terra/sim` + Postgres ACID locks), while asset custody, sub-accounts, deeds, staking principal, and escrow settlements live on NEAR.
- Balance numbers and regional scarcity weights *(proposed)* are tunable defaults calibrated through the deterministic simulator (`scripts/economy/`).
- Repository history starts `2026-10-29` inside the hackathon window; early visual/terrain scaffolding is disclosed in `README.md`.
