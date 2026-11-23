# W30 — Custom NFT Skins, NEAR.AI Livery Foundry & Commodity War-Smelting

> **Track:** Economy/NEAR (E) · **Flag:** `W30` (extends `W29` / `W28` / `W20` / `W23`) · **Scenario:** `tests/scenarios/w30-custom-skins.ts` · **Tag:** `wave-30`
> **Preset:** `claude:opus+fable` (`par=4`, subagents `sonnet (M) + flash (S)`)
> **Depends on:** W28, W29
> **Specs:** [`docs/NEAR_SKINS_AND_PLANETS_SPEC.md`](../../NEAR_SKINS_AND_PLANETS_SPEC.md) · [`docs/NEAR_SOVEREIGN_PLANETS_SPEC.md`](../../NEAR_SOVEREIGN_PLANETS_SPEC.md) · [`docs/NEAR_STAKING_SPEC.md`](../../NEAR_STAKING_SPEC.md) · D-18, D-31
> **Owned paths:**
> - `shared/contracts/**`
> - `shared/db/**`
> - `shared/sim/**`
> - `backend/near-contracts/{skins,planets}/**`
> - `backend/near-contracts/{Cargo.toml,Cargo.lock}`
> - `backend/app/src/near/**`
> - `backend/app/src/ai/**`
> - `backend/app/src/game/**`
> - `backend/app/src/market/**`
> - `backend/app/test/**`
> - `frontend/render/visuals/unified/{liveryPalette,registries}.ts`
> - `frontend/render/{kitbash,particles,descent}/**`
> - `frontend/render/lighting/archetypeLights.ts`
> - `frontend/playground/**`
> - `frontend/game/{app,ui,descent,pages,features,store,net}/**`
> - `frontend/trade/**`
> - `frontend/whitepaper/**`
> - `frontend/dev/api-atlas/**`
> - `infra/**`
> - `scripts/dev/{deploy-testnet-contracts,wasm-artifacts}.mjs`
> - `tests/scenarios/w30-custom-skins.ts`
> - `tests/e2e/w30.spec.ts`

## Goal

Ship TerraAgent's **`NEP-171` + `NEP-199` + `NEP-245`** Custom NFT Skins, `/playground.html` NEAR.AI Livery Foundry, and Zero-P2W Commodity War-Smelting layer—cleanly decoupled into `W30` after `W29` Paid Sovereign Planets:

1. **4-Layer Pillar-Safe Three.js Skin System:** `LIVERY_PALETTE` Unifier shader plugin (`uZoneColors[10]`, `uZonePbr[10]`, `aZoneInfo = vec2(zoneId, emissiveMult)` + procedural finishes), modular roof/shoulder kitbash greeble hardpoints, custom `ToolBeamSpec` cutter beams & sparks, and custom `archetypeLights` night spotlights—preserving biome dust/frost weathering, Fresnel rim light, and zero-CPU `aPartAnim` kinematics.
2. **`/playground.html` NEAR.AI Livery Foundry & Art-Director Gate:** Interactive AI prompt + zone studio gated on-chain/server by `checkAppearance()`, `validateParticlePreset()`, and CIE-Lab anti-clone distance checks (`$5 USDC` / `1.5 NEAR` Master Blueprint mint fee → `100%` Protocol; `1` free mint/season for Tier 3–4 Stakers; `8%` Creator / `2.5%` Protocol / `1.5%` Planet DAO `NEP-199` secondary royalties; plus **`5%` Sovereign Planet Owner / Syndicate Vault Share royalty** when an edition is forged on a `W29` Paid Sovereign Planet!).
3. **Zero-P2W `NEP-245` Commodity War-Smelting & Living Combat Trophies (`D-31`):** Lock refined `NEP-245` orbital cargo inside Commodity-Forged skins via `mt_transfer_call` and allow emergency **`Smelt Skin in Orbit`** (`nft_burn` → **`85%`** cargo returned to Orbital Cargo account / `10%` Protocol / `5%` Planet DAO; cash-bought Web2 Studio Packs strictly non-smeltable), plus **Living Battle Scars / Kill-Rings**, **Captured `.near` Rival War Standards** on `hub`, **Boss Acid-Spitter Hive 1-of-1 Skin Auctions** (`85%` DAO / `15%` Protocol), and invisible gasless `NEP-366` Web2 custody.

---

## Demo story (wave e2e)

1. **`/playground.html` NEAR.AI Livery Foundry & Art-Director Gate:** Sign in as a verified `!isGuest` pilot on `/playground.html`, open the **Foundry Drawer**, and prompt NEAR.AI (`z-ai/glm-5.3-flash`) for a Colony Livery → preview Layers 1–4 across `iso`, `front`, `side`, `top` and Day/Night lighting. Verify a muddy low-contrast palette is blocked by `checkAppearance()`, a near-duplicate fails the CIE-Lab anti-clone check, and a passing design mints a capped **Master Blueprint NFT** (`$5 USDC` / `1.5 NEAR` → `100%` Protocol; free seasonal slot for Tier 3–4 Stakers).
2. **Sovereign Planet Skin-Forge Royalty Integration (`W29` ↔ `W30`):** Have a colonist homed on a `W29` Paid Sovereign Planet purchase/fabricate an edition from that Master Blueprint → verify **`85%`** pays the Creator, **`5%`** pays the Planet Council DAO, **`5%`** pays TerraAgent Protocol, and **`5%`** streams pro-rata into the **Sovereign Planet Owner / Guild Syndicate `10,000 bps` Revenue Vault**!
3. **Zero-P2W Commodity-Forged Skin & Emergency War Smelt:** Lock `NEP-245` orbital cargo (`metals` + `minerals`) via `mt_transfer_call` to forge a Commodity-Backed Hero Skin → equip Colony Livery + Hero Slot overrides (Drop Pod, `hub`, `tradePad`, `robot.combat`, `aiCore`) and verify live 3D hulls, cutter beams & night spotlights in `/play.html`. Click **`Smelt Skin in Orbit`** (`nft_burn`) → `85%` of locked cargo returns to the player's **Orbital Cargo account** (`10%` Protocol / `5%` DAO) for normal `tradePad` import; verify cash-bought Studio Packs reject smelting (`SKIN_NOT_SMELTABLE`).
4. **Living Battle Scars, Captured War Standards & Boss Hive 1-of-1 Auction:** Win a `6h` Bonded War → equipped livery increments its on-chain battle-scar patina/kill-stripes and mounts the defeated `.near` rival's cracked **War Standard** on the Command Hub (`hub`). Clear a Boss Acid-Spitter Hive → 1-of-1 Bioluminescent Hive-Queen Blueprint auctions on `/trade.html` (`85%` Planet DAO / `15%` Protocol).
5. **Web2 Invisible Custody Checkout:** Purchase an official Studio Pack as a Google/Passkey pilot (`!isGuest`, no wallet popup) → backend gaslessly mints the real `NEP-171` NFT (`NEP-366`) to `{pilot}.pilots.<root>` and equips it immediately across online WS and `?host=local`.

---

## Features covered

| # | Feature (spec) | Issues |
|---|---|---|
| 1 | Shared Zod contracts (`SkinBlueprintSpec`, `LiveryPaletteSpec`, `HeroSlotKind`, `SkinEditionView`, `BossSkinAuctionView`) & Prisma `0036_w30_custom_skins` | W30-01 |
| 2 | Rust `skins` contract (`NEP-171` + `NEP-199` `8% / 2.5% / 1.5%`, `mt_on_transfer` cargo lock, `smelt_skin` `85/10/5%`, `record_battle_scar`, `mint_war_standard` & `5%` `planets.<root>` forge share) | W30-02 |
| 3 | Backend Skins service (`/v1/near/skins/*`, NEAR.AI palette gen, CIE-Lab anti-clone, 3-lane + Sovereign Planet splits, Web2 gasless mint, Boss Hive 1-of-1 auction, war scars) | W30-03 |
| 4 | Three.js `LIVERY_PALETTE` Unifier shader plugin (`uZoneColors[10]`, `uZonePbr[10]`, `aZoneInfo`, procedural finishes & dynamic Battle Scars/Kill-Rings) | W30-04 |
| 5 | Visual layers 2–4 & War Standard trophy (modular roof/shoulder greeble hardpoints, custom `ToolBeamSpec` beams/sparks, custom `archetypeLights` night spotlights & rival `.near` War Standard on `hub`) | W30-05 |
| 6 | `/playground.html` NEAR.AI Livery Foundry Drawer (`checkAppearance()` + `validateParticlePreset()` + CIE-Lab anti-clone + Master Blueprint mint & commodity forge) | W30-06 |
| 7 | Colony Wardrobe (`/me.html` & `/play.html` Colony Livery + 5 Hero Slots), `Smelt Skin in Orbit` modal, `/trade.html` Boss Hive auctions & Web2 Studio Pack checkout | W30-07 |
| 8 | Deploy script wiring (`skins` crate) & Full Test Pyramid (`D-31` zero-P2W smelt, CIE-Lab anti-clone, Sovereign Planet `5%` forge split & visual validator gates) | W30-08 |
| 9 | Wave E2E scenario & Playwright verification (`W30-09`) | W30-09 |

---

## Issues

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W30-01 | Contracts, wave flag, Zod schemas & DB migration: bump `LAST_WAVE = 30` in `shared/contracts/src/flags/index.ts`, add `SkinBlueprintSpec`, `LiveryPaletteSpec`, `HeroSlotKind` (`dropPod`, `hub`, `tradePad`, `combatUnit`, `aiCore`), `SkinEditionView`, `WarStandardView`, and `BossSkinAuctionView` in `shared/contracts/` + Prisma `0036_w30_custom_skins`, then run `npm run gen` | contract | M | H | W29-01 | Run `npm run contracts:check` and `npm run db:gen` → `parseWaves('..30')` & all Skin, Livery & Boss Auction schemas compile with zero drift | [`NEAR_SKINS_AND_PLANETS_SPEC.md`](../../NEAR_SKINS_AND_PLANETS_SPEC.md) Part A | — |
| W30-02 | Rust `skins` contract: build `backend/near-contracts/skins/` (`NEP-171` + `NEP-199` `8%` Creator / `2.5%` Protocol / `1.5%` DAO), `mt_on_transfer` cargo lock for Commodity-Forged skins, `smelt_skin` (`85%` player orbital cargo / `10%` Protocol / `5%` DAO; rejects non-backed Studio Packs), `record_battle_scar`, `mint_war_standard`, and `5%` Sovereign Planet forge royalty forwarding to `planets.<root>` | contract | M | H | W30-01, W29-02 | Run `npm run near:test-contracts` → blueprint/edition mints, `5%` Sovereign Planet forge payout, `85/10/5%` cargo smelt rollback, and `SKIN_NOT_SMELTABLE` rejection tests pass | [`NEAR_SKINS_AND_PLANETS_SPEC.md`](../../NEAR_SKINS_AND_PLANETS_SPEC.md) §A.1–§A.3 | — |
| W30-03 | Hexagonal `SkinNftPort`, Backend Skins service & routes: add `SkinNftPort` (`NEAR_PORT_NAMES` + `NEAR_ADAPTER_SKIN_NFT=mock\|testnet\|devnet\|mainnet` + `skins.contract.ts`) and `/v1/near/skins/*` with NEAR.AI `z-ai/glm-5.3-flash` structured palette generation (`!isGuest` quota: `3/d` free, `15/40/100/d` Tiers `1–4`, `∞` BYOK), CIE-Lab anti-clone distance check, 3-lane + `5%` Sovereign Planet splits, Web2 gasless `NEP-366` minting to `{pilot}.pilots.<root>`, Boss Hive 1-of-1 `/trade.html` auction (`85%` DAO / `15%` Protocol), and war-scar hooks | server | M | H | W30-02, W29-05 | Run `npm run test:contract -- --port skin-nft`, mint blueprint, forge edition on Sovereign Planet, buy Web2 pack & test clone rejection → `85/5/5/5%` splits and CIE-Lab anti-clone rejections match spec | [`NEAR_SKINS_AND_PLANETS_SPEC.md`](../../NEAR_SKINS_AND_PLANETS_SPEC.md) §A.1–§A.3 | — |
| W30-04 | Three.js `LIVERY_PALETTE` Unifier shader plugin: stamp `aZoneInfo = vec2(zoneId, emissiveMult)` in [`KitbashRegistry.ts`](../../../frontend/render/kitbash/KitbashRegistry.ts) and register `LIVERY_PALETTE` in [`registries.ts`](../../../frontend/render/visuals/unified/registries.ts) supporting `uZoneColors[10]`, `uZonePbr[10]`, procedural finishes (`carbonWeave`, `brushedTitanium`, `hexHoloGrid`, `oxidizedCopper`), and dynamic Battle Scar / Kill-Ring wear | visual | M | H | W30-01 | Render skinned Tier-1 archetypes across all 3 biomes & night/ruin modes → biome dust/frost weathering, Fresnel rim, and shadow passes remain intact | [`NEAR_SKINS_AND_PLANETS_SPEC.md`](../../NEAR_SKINS_AND_PLANETS_SPEC.md) §A.1, §A.3 | — |
| W30-05 | Visual layers 2–4 & War Standard trophy: add modular roof/shoulder kitbash greeble hardpoints, per-skin `ToolBeamSpec` cutter beam & spark color overrides, custom `archetypeLights` night spotlight colors, Drop-Pod descent livery hooks, and cracked `.near` rival emblem War Standard prop mounted on `hub` | visual | M | H | W30-04 | Run `npm run validate:models -- --all` & `npm run validate:particles -- --all` on skinned buildings/units → 0 errors, 0 warnings, bloom `>= 3.0` | [`NEAR_SKINS_AND_PLANETS_SPEC.md`](../../NEAR_SKINS_AND_PLANETS_SPEC.md) §A.1 | — |
| W30-06 | `/playground.html` NEAR.AI Livery Foundry Drawer: extend [`PlaygroundApp.ts`](../../../frontend/playground/PlaygroundApp.ts) with interactive AI prompt + zone color/finish/greeble/beam/light controls gated live by `checkAppearance()`, `validateParticlePreset()`, and CIE-Lab anti-clone check, plus 1-click Master Blueprint mint & `NEP-245` commodity forge | client | M | H | W30-03, W30-05 | Open `/playground.html`, prompt NEAR.AI, fix a failing dark palette, and mint Blueprint → live 4-view turntable updates and mint succeeds | [`NEAR_SKINS_AND_PLANETS_SPEC.md`](../../NEAR_SKINS_AND_PLANETS_SPEC.md) §A.1, §A.3 | — |
| W30-07 | Colony Wardrobe, War Smelt UI & Web2 Storefront: add Colony Livery + 5 Hero Slot (`dropPod`, `hub`, `tradePad`, `combatUnit`, `aiCore`) equipper in `/me.html` & `/play.html` (synced across online WS & `?host=local`), **`Smelt Skin in Orbit`** confirmation modal (disabled on cash Studio Packs), Boss Hive 1-of-1 auction bidding on `/trade.html`, and gasless Web2 Studio Pack checkout | client | M | H | W30-03, W30-05 | Equip Colony Livery + Drop Pod Hero override and smelt a commodity skin → 3D descent/colony updates live and `85%` cargo lands in orbital account | [`NEAR_SKINS_AND_PLANETS_SPEC.md`](../../NEAR_SKINS_AND_PLANETS_SPEC.md) §A.1–§A.2 | — |
| W30-08 | Deploy scripts, canonical docs/API Atlas & Full Test Pyramid (`D-31` Zero-P2W Smelt): wire `skins` crate into [`deploy-testnet-contracts.mjs`](../../../scripts/dev/deploy-testnet-contracts.mjs) & `scripts/dev/wasm-artifacts.mjs`, sync [`infra/.env.example`](../../../infra/.env.example), [`README.md`](../../../README.md), [`whitepaper.md`](../../../frontend/whitepaper/whitepaper.md) & `npm run api:atlas`, and add Rust, unit, integration, `SkinNftPort` contract, and property tests verifying zero-P2W orbital smelting, Studio Pack non-smeltability, CIE-Lab anti-clone threshold, `5%` Sovereign Planet Syndicate split, and `@terra/sim` parity | test | M | H | W30-02..W30-07 | Run `npm run near:test-contracts`, `npm test`, `npm run test:integration`, `npm run test:contract`, `npm run test:parity`, and `npm run api:atlas` → 100% green | [`NEAR_SKINS_AND_PLANETS_SPEC.md`](../../NEAR_SKINS_AND_PLANETS_SPEC.md) Part A | — |
| W30-09 | Wave e2e: author `tests/scenarios/w30-custom-skins.ts` and `tests/e2e/w30.spec.ts` verifying all 5 Demo Story steps across `/playground.html`, `/play.html` (online WS + `?host=local`), `/me.html`, and `/trade.html` | test | M | H | W30-01..W30-08 | Run `npm run check && npm run build && npx playwright test tests/e2e/w30.spec.ts` → all 5 W30 demo steps pass end-to-end | [`NEAR_SKINS_AND_PLANETS_SPEC.md`](../../NEAR_SKINS_AND_PLANETS_SPEC.md) Part A | — |

---

## Worktree Setup & Execution Runbook

1. **Ensure `W28` and `W29` have landed in `main`, then verify dry-run and launch `W30`:**

   ```bash
   npm run wave -- 30 --dry-run
   npm run wave -- 30
   ```

2. **Key verification gates before landing `W30`:**
   - `npm run gen && npm run contracts:check && npm run db:gen`
   - `npm run near:test-contracts` (`skins` + `planets` Rust crates)
   - `npm run validate:models -- --all` + `npm run validate:particles -- --all`
   - `npm run check && npm test && npm run build && npm run validate:wave -- 30 --gates`
