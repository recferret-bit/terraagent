# TerraAgent — Master Economy, On-Chain, AI Orchestrator & Monetization Plan

> **D-44 supersedes the fee rules below (2026-11-04).** The buyer pays the platform fee (100 bp) and the maker stall's fee (0-100 bp, default 100) in the pair's **quote token**, independent of maker/taker role; the fee is never taken from the received token and there is no 50-300 bp or 0-3 % range. W22's treasury share is carved out of the platform fee. See [ECONOMY](spec/ECONOMY.md) §3 and [NEAR](spec/NEAR.md) `NEAR-61`. Older fee statements in this file are historical.

> **Status:** 2026-10-31. Consolidated final document for NEAR Hackathon (Games With Real Economies + Agent Economy).  
> All numbers marked *(proposed)* are tunable defaults. Decisions from grooming sessions are applied.

## 0. Locked Decisions (from interactive grooming)

- Treasury project costs → **burn** (clean sink).
- Social Login → **NEAR Auth** (auth.near.org).
- NEAR.AI → simple verifiable layer via NEAR AI Cloud (Guild/Director asks LLM + shows attestation).
- Fee control (0–3 %) → **Must**.
- One treasury project (terraform boost) with visible simulation effect → Must / high Stretch.
- Guild NEAR float → **safest**: no NEAR/USDC pairs in demo, resource-for-resource only, minimal float unused for trading (can add later).
- Protocol fee exists and goes to project owner.

## 1. Context & Track Fit

**Game:** autonomous colony builder. Player drops a robot; colony mines, builds, defends, terraforms and trades mostly on its own.  
**Track target:** Games With Real Economies (“the economy is the gameplay”) + secondary Agent Economy / AI Swarms.  
**Hackathon window:** 2026-11-01 → 2026-11-14.

| Track asks for              | Our answer                                      |
|-----------------------------|-------------------------------------------------|
| NPCs with wallets           | Orbital Guild traders + Colony Directors        |
| Player-owned markets        | Trade Hub stalls (owner sets 0–3 % fee)         |
| Economies evolve w/o patch  | AI Orchestrator + Treasury voting + Guild AI    |
| Players never notice chain  | NEAR Auth + gasless + named accounts            |
| NEP-245                     | One multi-token contract for all resources      |

**Trust boundary:** Server simulation = mint authority. Chain only for ownership, settlement, deeds, treasury. Gameplay never waits for chain except trade settlement.

## 2. Resource Model (unchanged core)

Three families, 10 sub-resources (token ids):
- Metals: t1 Iron, t2 Light alloys, t3 Titanium
- Minerals: t1 Silica, t2 Rare earths, t3 Exotic crystal
- Bio: water, biomass, t2 Petroleum, t3 Gene-stock

Energy is grid power (not a token). Storage caps per family. Tier unlocks gated by terraform %.  
Daily mint cap: 20 000 units per sub-resource per colony *(proposed)*.  
Trade Hub throughput: 250 / 900 / 3 500 units/min by tier.

## 3. Features & Build Order (final)

**Must (never drop):**
1. Invisible chain (NEAR Auth + gasless + named accounts)
2. Cargo tokens (NEP-245)
3. Player-owned markets on NEAR Intents + fee control 0–3 %
4. Guild traders (resource-for-resource) + verifiable NEAR AI Cloud layer
5. AI Orchestrator (planet + wild directives) — basic version
6. One treasury project (terraform boost) with visible effect

**High Stretch (if day-10 green):** deeper attestation UI, extra treasury projects, dens visual polish.  
**Later / mock:** Colony Deed full staking, full bounties/mercenaries, cross-planet carry, NEAR pairs.

## 4. AI Orchestrator — Detailed Prompts

Orchestrator calls NEAR AI Cloud every 5–15 min or on events. All responses include attestation (shown in Planetary Log or Guild panel).

### 4.1 Planet Control (fauna + disasters)
```
You are the planetary AI orchestrator.

State:
- Terraform %: {terraform_pct}
- Active colonies: {colony_count}
- Habitat pressure: {habitat_pressure} (0-100)
- Active dens: {den_count}
- Recent terraforming tiles (2h): {tiles_terraformed}

Return JSON only:
{
  "fauna_spawn_modifier": 0.5-2.5,
  "new_den_chance": 0.0-0.35,
  "disaster": null | "meteor_shower" | "dust_storm" | "bio_surge",
  "disaster_intensity": 0.4-1.6,
  "global_yield_modifier": 0.75-1.25,
  "reason": "one short sentence"
}
If habitat_pressure > 55 and terraform rising, increase fauna pressure.
```

### 4.2 Wild Directives for Colony Directors
```
Colony: resources {resources}, storage fill {storage_pct}%, terraform contrib {terraform_contrib}, away budget {away_budget}.

Suggest 0-1 wild directive (player can accept/override):
{
  "directive": null | "mass_export" | "terra_focus_sector" | "defensive_buildup" | "trade_push",
  "intensity": 0.4-1.0,
  "duration_minutes": 25-100,
  "reason": "short"
}
Make it emergent, occasionally surprising, never suicidal.
```

### 4.3 Guild Strategy
```
Inventory: {inventory}
24h VWAP: {vwap}
Recent fills: {fills}
Habitat pressure: {habitat_pressure}

Return JSON:
{
  "offers": [{"resource": "metals.t1", "side": "sell"|"buy", "amount": 150-400, "spread_pct": 4.5-12}],
  "priority": "rebalance" | "accumulate" | "widen_spread",
  "reason": "one sentence"
}
```

## 5. Fauna Dens — Balance Numbers

**Fauna Den building**
- Spawns on planet (Orchestrator decides location/timing).
- Periodically releases animal waves that path toward nearest player bases.

| Parameter                    | Value *(proposed)*          | Notes |
|-----------------------------|-----------------------------|-------|
| Base spawn interval         | 8–14 min                    |     |
| Spawn interval modifier     | ×0.6 to ×1.8                | From Orchestrator fauna_spawn_modifier |
| Wave size                   | 4–12 units                  | Scales with den “anger” |
| Unit HP / Damage            | 80–140 HP, 12–22 dmg        | Stronger when habitat pressure high |
| Habitat radius              | 10 tiles                    | Living/Irrigated tiles inside raise anger |
| Anger gain per Living tile  | +1.5 pressure               | Capped contribution |
| Destroy cost                | 400 metals + 250 minerals + army time | High |
| Destroy effect              | Removes den, +25 habitat pressure globally, possible surge |     |
| Max dens on demo planet     | 3                           | Orchestrator rarely exceeds |

Dens create natural conflict: terraform → more attacks → need defense, trade, or treasury vote.

## 6. Demo Scenarios

### Scenario A — Main (8–12 min): Two Pilots Terraform
1. Two players land, build, open Trade Hubs.
2. Guild docks; AI offers visible with attestation.
3. They trade; one focuses extractors, one terraforms.
4. Habitat pressure rises → den wave.
5. Joint defense + market trade for military resources.
6. Vote terraform boost → visible cost reduction, planet greens.
7. End state: ~40 % terraform, live order book, Guild fees earned.

### Scenario B — Wild AI
- Orchestrator pushes “mass_export” to one Director.
- Player sees prompt and can accept.
- Market moves, second player capitalizes, dust storm hits.

### Scenario C — Conflict & Diplomacy
- Fast terraforming triggers heavy den pressure on both.
- Market + temporary truce proposal.
- Treasury meteor/fauna shield vote.

## 7. Owner Monetization — Exact Variants

Core principle: project earns from activity, never pays out real NEAR from treasury.

### Variant 1 — Conservative (recommended for hackathon)
| Source              | Rate          | Recipient      |
|---------------------|---------------|----------------|
| Protocol fee        | **0.25 %**    | Project account |
| Stall fee           | 0–3 %         | Stall owner    |
| Treasury share      | 20 % of stall fee | Treasury → burn on projects |

Example trade 1 000 units @ 1 % stall fee:  
Stall owner +10, Treasury +2, **Project +2.5**.

### Variant 2 — Moderate
- Protocol fee **0.40 %**
- Same treasury share.

### Variant 3 — With optional project cut
- Protocol fee 0.25 %
- Plus 15 % of any treasury project cost can optionally route to project (instead of 100 % burn). Toggleable.

**Additional later sources:**
- Premium: extra order slots, priority Guild visits, robot skins (pay in NEAR or cargo).
- Sponsored gas / relayer tips.
- Badge / Deed cosmetic upgrades.

In demo show at least the 0.25 % protocol fee line in market settlement toast.

## 8. Achievements & NFTs

**Achievements** (cosmetic XP + badge eligibility):
- Merchant (5 / 50 / 500 trades)
- Port Authority (stall fees earned 100 / 1k / 10k)
- Guild Contact (5 / 50 / 250 Guild trades)
- Terraformer (personal terraform contribution milestones)
- Den Hunter (dens destroyed 1 / 3 / 5)
- Councilor (treasury votes participated)

**NFTs:**
- **Colony Deed** (NEP-171, dynamic) — minted on founding, metadata updates on terraform steps, trade volume, dens destroyed, rank. Demo: mock + shareable card.
- **Badge NFTs** — non-transferable for achievement tiers (Stretch).
- Deed can later become staking vehicle (own NEAR to validator) — Later, no in-game power.

## 9. Accounts & Keys (summary)

- `{name}.terraagent.near` — player (NEAR Auth)
- `{colony}.{name}.terraagent.near` — colony (holds cargo, signs orders, owns deed)
- `guild-N.npc.terraagent.near` — Guild (restricted keys)
- Relayer pays gas (allow-list only)
- App-held keys encrypted; player can claim for self-custody later

## 10. Mock-First & Day-10 Gate

All NEAR features start on realistic mocks.  
Day-10 gate: if core + login/cargo/markets/Guild green → start real swap for those.  
README must clearly state what is real vs mock.

---

**This document is the single source of truth for economy, AI, fauna, demos, monetization and NFT scope going into the hackathon.**
