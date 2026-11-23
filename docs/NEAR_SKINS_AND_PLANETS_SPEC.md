# TerraAgent — Custom NFT Skins (`W30`) & Sovereign NFT Planets (`W29`) Specification

> **Status:** Economics & Wave Split Locked (`W29` Dedicated to Paid Sovereign Planets · `W30` Dedicated to Custom NFT Skins)
> **Source Blueprint:** [`docs/NEAR_PROPOSALS.md`](./NEAR_PROPOSALS.md) · [`docs/NEAR_STAKING_SPEC.md`](./NEAR_STAKING_SPEC.md)
> **Authoritative Sovereign Planets Spec (`W29`):** [`docs/NEAR_SOVEREIGN_PLANETS_SPEC.md`](./NEAR_SOVEREIGN_PLANETS_SPEC.md)
> **Wave Plans:** [`docs/plan/waves/W29-sovereign-planets.md`](./plan/waves/W29-sovereign-planets.md) · [`docs/plan/waves/W30-custom-skins.md`](./plan/waves/W30-custom-skins.md)

This specification defines TerraAgent's two flagship **`NEP-171` + `NEP-199` + `NEP-245`** ownership layers, sequenced into two dedicated waves:

1. **Wave 29 (`W29`) — Paid Sovereign Planets, `/planets.html` Atlas & NEAR.AI MCP Studio:** Full specification in [`docs/NEAR_SOVEREIGN_PLANETS_SPEC.md`](./NEAR_SOVEREIGN_PLANETS_SPEC.md) (summarized in Part B below).
2. **Wave 30 (`W30`) — Custom NFT Skins, NEAR.AI Livery Foundry & Commodity War-Smelting:** Full specification in Part A below.

---

## Part A — Wave 30 (`W30`): Custom NFT Skins, NEAR.AI Livery Foundry & Commodity Smelting

### A.1 Locked Economic & Anti-Exploit Rules

| Dimension | Locked Decision |
| :--- | :--- |
| **Hybrid 3-Lane Economy** | **(1) NEAR.AI Creator Blueprints** in `/playground.html` (`$5 USDC` / `1.5 NEAR` anti-spam mint fee → `100%` Protocol; Tier 3–4 Stakers get `1` free mint/season; capped editions `10` / `50` / `250`), **(2) Commodity-Forged & War-Smeltable Skins** (lock refined `NEP-245` orbital cargo inside `skins.<root>` via `mt_transfer_call` / `mt_on_transfer`), and **(3) Direct Web2 Studio Packs** (Card / Apple Pay / `USDC`, zero crypto required). |
| **Equip Scope (Tier-1 Roster)** | **Colony Livery + 5 Hero Slot Overrides:** Equipping one Colony Livery NFT cohesively transforms all Tier-1 buildings, units, tool-cutter beams, and night spotlights across your colony. Dedicated **Hero Slots** override individual hero silhouettes: **Orbital Drop Pod (`dropPod`)**, **Command Hub (`hub`)**, **Trade Pad (`tradePad`)**, **Combat Robot (`combatUnit`)**, and **AI Core (`aiCore`)** (with forward-compatible rocket slot hook if `W21` lands later). |
| **3D Visual Layers (v1)** | **Layers 1–4** across every kitbash archetype (`LIVERY_PALETTE` Unifier shader plugin with `uZoneColors[10]` + `uZonePbr[10]` + `aZoneInfo = vec2(zoneId, emissiveMult)` + procedural surface finishes, modular roof/shoulder kitbash greebles, custom `ToolBeamSpec` cutter beams & sparks, and custom `archetypeLights` night spotlights). **Layer 5** (`< 3.5k`-tri sanitized `.glb` Hero Monuments) ships as curated Studio Packs / v2. |
| **Zero-P2W War Smelting (`D-31`)** | Only **Commodity-Forged** skins (`backedCargo` recorded on-chain) can be smelted (`nft_burn`), returning **`85%`** of locked `NEP-245` cargo to the player's **Orbital Cargo account** (`10%` Protocol / `5%` Planet DAO) for normal `tradePad` import or instant `/trade.html` `USDC` liquidation. Cash-bought Studio Packs cannot be smelted for game resources (`SKIN_NOT_SMELTABLE`). |
| **Anti-Spam & Art-Director Gate** | AI Foundry prompts in `/playground.html` require verified `!isGuest` sign-in (`3/day` free; `15 / 40 / 100/day` for Staking Tiers `1–4`; unlimited via `/me` BYOK). Minting a Master Blueprint enforces **`checkAppearance()`** (`insetContrast >= 12`, biome-dust `groupContrast >= 14`, `dominantZone <= 0.70`, `meanL >= 30`), **`validateParticlePreset()`** (`ΔE76 >= 15`, bloom `>= 3.0`), and a **CIE-Lab anti-clone distance check** against existing Blueprints. |
| **Web2 Invisible Custody** | Google/Passkey gamers purchase skins via Card or earned `USDC` with zero wallet popups; backend mints the real `NEP-171` NFT gaslessly (`NEP-366`) to `{pilot}.pilots.<root>` and equips it immediately (auto-transferred when they later claim self-custody). |
| **Signature Web3 Twists (v1)** | **Living On-Chain Battle Scars & Kill-Rings** (dynamic shader wear, barrel kill-stripes, Drop-Pod re-entry scorch marks), **Captured War Standards** (defeated `.near` rival's cracked emblem mounted on `hub` after a `6h` Bonded War), and **Planet-DAO 1-of-1 Xeno-Hive Boss Skin Auctions**. |

### A.2 Skin Revenue & `NEP-199` Royalty Splits (Wired to `W29` Sovereign Planet Vaults)

| Event | Creator | TerraAgent Protocol | Planet Council DAO | Sovereign Planet Owner / Syndicate _(if forged on `W29` Sovereign Planet)_ |
| :--- | :--- | :--- | :--- | :--- |
| **Master Blueprint Mint (`$5 USDC` / `1.5 NEAR`)** | — | **`100%`** | `0%` | `0%` |
| **Blueprint Edition Sale (`USDC` / `NEAR`)** | **`85%`** | **`10%`** _(or `5%` on Sovereign Planet)_ | **`5%`** | **`5%`** _(carved from Protocol's `10%`, routed pro-rata across `10,000 bps` Vault Shares)_ |
| **Secondary Resale (`NEP-199` `nft_payout`)** | **`8.0%`** | **`2.5%`** | **`1.5%`** | — |
| **Commodity Skin War-Smelt (`nft_burn`)** | — _(Player gets `85%` cargo back)_ | **`10%`** of locked cargo | **`5%`** of locked cargo | — |
| **Direct Studio Official Pack (Card / `USDC`)** | — | **`95%`** | **`5%`** | — |
| **Boss Acid-Spitter Hive 1-of-1 Auction** | — | **`15%`** | **`85%`** _(funds planetary defense)_ | — |

### A.3 Key Codebase Seams (`W30` Skins)

- **Shader Plugin:** Register `LIVERY_PALETTE` via [`frontend/render/visuals/unified/registries.ts`](../frontend/render/visuals/unified/registries.ts) (alongside [`ruinVariant.ts`](../frontend/render/visuals/unified/ruinVariant.ts)), stamping `aZoneInfo = vec2(zoneId, emissiveMult)` inside [`frontend/render/kitbash/KitbashRegistry.ts`](../frontend/render/kitbash/KitbashRegistry.ts).
- **NEAR.AI Skin Studio:** Extend [`frontend/playground/PlaygroundApp.ts`](../frontend/playground/PlaygroundApp.ts) with a **Foundry Drawer** wired to `validateArchetype()`, `validateParticlePreset()`, `LightsPanel`, and `z-ai/glm-5.3-flash` structured palette JSON output.
- **Rust Contract (`backend/near-contracts/skins/`) & Hexagonal `SkinNftPort`:** `NEP-171` + `NEP-199` (`nft_payout`) + `mt_on_transfer` receiver (mirroring [`backend/near-contracts/res/src/lib.rs`](../backend/near-contracts/res/src/lib.rs) and [`backend/near-contracts/bounty/src/lib.rs`](../backend/near-contracts/bounty/src/lib.rs)) with `smelt_skin`, `record_battle_scar`, `mint_war_standard`, and `5%` cross-contract royalty forwarding to `planets.<root>`, paired with hexagonal `SkinNftPort` (`NEAR_PORT_NAMES` + `NEAR_ADAPTER_SKIN_NFT=mock|testnet|devnet|mainnet`, `mock`/`testnet`/`mainnet` adapters, and `skins.contract.ts`).

---

## Part B — Wave 29 (`W29`): Paid Sovereign Planets Summary

> **Complete Specification:** See [`docs/NEAR_SOVEREIGN_PLANETS_SPEC.md`](./NEAR_SOVEREIGN_PLANETS_SPEC.md) and [`docs/plan/waves/W29-sovereign-planets.md`](./plan/waves/W29-sovereign-planets.md) for full economic proofs, Celestial schemas, Season Sharding, and the MCP `Agent → Graph → Loop` studio architecture.

| Dimension | Locked `W29` Decision |
| :--- | :--- |
| **Galactic Roster (`10` Worlds)** | **`3` Free Canonical Worlds** (`Kharon Dunes`, `Thalassa Verde`, `Granite Hollow`) + **`7` Paid Sovereign Worlds Cap** (`MAX_SOVEREIGN_PLANETS = 7` in `PLANET_FORGE_MODE=charter`; free open test minting in `PLANET_FORGE_MODE=open` on dev/testnet). |
| **Whale & Guild Syndicate Pricing (`2,000 NEAR`)** | **Solo Whale OR `2–10` Co-Owner Guild Syndicate:** **`500 NEAR` Charter Fee** (`400 NEAR` Protocol / `100 NEAR` Planet DAO Day-1 orderbook seed) + **`1,500 NEAR` Locked Anchor Stake** inside the `NEP-171` NFT. Syndicate co-owners receive tradeable **`10,000 bps` Vault Shares**; Lead Governor tunes live sliders, while `>= 67%` share vote governs NFT resale (`5%` Protocol royalty, `1,500 NEAR` Anchor transfers intact) or **`90-day` Sunset Cooldown** (unlocking Anchor Stake & freeing the slot). |
| **5 Active-Colonist Perks** | **(1)** Boosted **`7.20% → up to 8.10%` Net Staking APY** (`7-day` decrease timelock, single-home anti-double-count), **(2)** **`1:1` Whale Anchor Co-Stake Match** (`5 NEAR` pilot + `5 NEAR` Whale Anchor → unlocks `10-NEAR` Tier-1 `NEAR.AI TEE` + `0.65%` fee at half cost), **(3)** **`0–15 bp` Local Trade Fee Rebate** + `100 NEAR` DAO Day-1 Orderbook + **`30m` NPC Guild Freighters**, **(4)** **`100-Point` Planet Specialization** (`0.5x–2.0x` resources & threat), and **(5)** **Live Whale Bounties** on `bounty.<root>` (`Stage-4 Dominance`, `Boss-Hive Purge`, `Top Market Maker`). |
| **Seasons & Fair Newcomer Sharding** | **Rolling `14-Day` Seasons + Auto-Sharded `24h` Landing Instances:** Macro-planet identity, staking, DAO & `/trade.html` orderbook persist forever while fresh `<24h` landing shards spin up automatically as seats fill. |
| **Pages, Procedural Worlds, NFT Config & MCP Studio** | Concise `/landing.html#planets` teaser → **`/planets.html`** (live Sovereign Atlas, **6 diverse generated planet examples**, Syndicate Desk) → **`/planet-forge.html`** (unlimited manual controls for **craters, volcanic lava, airless lunar regolith, Earth-like multi-continents [sand, forest, red sand, rock, ocean], 3D planetary rings, North & South poles, pure iced & mixed-iced worlds**, plus **Nebula, Sun, Moons `0..4`, Asteroids, Satellites `0..6`** with **Full 3-Phase Continuity [`Orbit` → `Landing/Descent` → `Playable 3D Hex Surface`]**, stored canonically on-chain inside the `NEP-171` NFT as `PlanetGenerationConfigV1 <= 8 KiB`, plus **Hybrid Fast NEAR.AI MCP `Agent → Graph → Loop`** `<= 3` loops metered at `3/d` guest, `10/d` pilot, `30–150/d` Tiers `1–4`, `∞` BYOK/MCP). |
