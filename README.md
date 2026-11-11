# TerraAgent

**Human-first 3D colony builder with autonomous AI takeover on NEAR Protocol & NEAR AI Cloud (TEE).**
Command your colony manually in real time on a persistent hex planet — or click **`AI AUTOPILOT: ON`** (or go offline) and let your bounded AI governor mine, build, cultivate wild terrain to `Living`, trade orbital NEP-245 cargo via NEAR Intents & the NPC Merchant Guild, launch raids (**war**), and negotiate bilateral **peace truces** against seeded Rival AI Colonies.

One deterministic TypeScript engine (`@terra/sim`) runs authoritatively on server worker threads, in the browser with client-side prediction, and standalone in a Web Worker (`?host=local`). Every on-chain capability and LLM call sits behind fail-closed ports supporting both **zero-key local mock mode** (`NEAR_MODE=mock`, `AI_PROVIDER=mock`) and **live NEAR Testnet + NEAR AI Cloud TEE mode** (`NEAR_MODE=testnet`, `AI_PROVIDER=nearai`).

**Stack:** Vite + TypeScript + Three.js (WebGL2) client with Faction Plate HUD · NestJS app with sim worker threads · Rust `near-sdk 5.7` smart contracts (`backend/near-contracts/`) · NEAR AI Cloud (`deepseek-ai/DeepSeek-V3.1` + TEE SHA-256 attestation) · PostgreSQL (Prisma) · npm workspaces.

> **Game rules & economy math:** [`docs/game/RULES.md`](./docs/game/RULES.md) (complete loop, victory/loss, resource sinks & 3 hard Track `07` AI safety guardrails) · [`docs/game/GUILD_PRICING.md`](./docs/game/GUILD_PRICING.md) (NPC Merchant Guild VWAP market-maker pricing & anti-wash protection).

## Quick start: do X → see Y (zero API keys required)

Needs Node 22+ (24 tested), npm 10+, Docker (for Postgres on port 15434), and Chrome for the e2e and parity suites. Out of the box (`NEAR_MODE=mock`, `AI_PROVIDER=mock`), zero external API keys or wallets are required:

```bash
npm ci
npm run dev            # → Postgres (docker, :15434), the app (:4001) and the client (:5173) start together
```

| Do | See |
|---|---|
| `curl 127.0.0.1:4001/v1/healthz` and `/v1/readyz` | `{"ok":true}` and `{"db":"ok","simThreads":N}` (N = cores − 1 unless `SIM_THREADS` is set) |
| Open http://127.0.0.1:5173/dev/economy-sim/ and click **RUN 7-DAY FAST-FORWARD** | 3 autonomous colonies (*Verdant Collective*, *Iron Guild Outpost*, *Crimson Vanguard*) simulate 7 days in `< 1 s`: SVG spot-price curves, NPC Guild VWAP quotes, Living hex cultivation, raids, peace truces, and all 3 Track `07` safety guardrail blocks (`AW-13`, `D-18`, allowance cap) |
| Open http://127.0.0.1:5173/play.html?scenario=w18 | Persistent multi-colony planet: colony stays **100% manual** while `AI AUTOPILOT: OFF`; open **Colony → DIRECTOR** and click **`AI AUTOPILOT: ON`** (plus **`Allow War & Diplomacy`**) to hand your colony to the autonomous governor |
| Open http://127.0.0.1:5173/play.html?scenario=w05 → **Terraform (`[T]`)** → **`CULTIVATE [V]`** | Click Prepared/Flat hexes to step `Grade → Irrigate → Seed → Living` (`Terraform %` rises and unlocks D-34 T2/T3 extractor tiers) |
| Open http://127.0.0.1:5173/play.html?scenario=w00 and type `warp 10` in the dev console (`` ` ``) | Flat hex planet; tick rate rises from 5/s to 50/s (`×10` badge); `npm run dev:restart` reconnects and resumes from the saved snapshot tick |
| Open http://127.0.0.1:5173/dev/chain/ in a second tab, then run `chain.ping` in the play console | A receipt appears in the chain explorer (`mock:` locally, or real NEAR Testnet tx hash under `NEAR_MODE=testnet`) |
| Stop the app; open `/play.html?host=local&scenario=w01` | The same `@terra/sim` engine runs in the browser alone; reload resumes from IndexedDB |
| `npm run ci:fast` / `npm run test:contract` | Typecheck + structure + lint + unit tests + Vite build / all NEAR port contract suites green |

### Switching to Live NEAR Testnet + NEAR AI Cloud (TEE)

```bash
# Run live against deployed *.terraagent.testnet contracts + NEAR AI Cloud TEE:
NEAR_MODE=testnet \
NEAR_ADAPTER_BADGE=mock NEAR_ADAPTER_STAKING=mock NEAR_ADAPTER_TREASURY=mock \
AI_PROVIDER=nearai NEARAI_API_KEY=<your_nearai_key> \
TA_SEED_RIVAL_AI=1 \
npm run dev

# Verify live NEAR Testnet contract suites directly against rpc.testnet.fastnear.com:
npm run contract:real
```

Full developer reference (every URL parameter, dev console command, REST route, env variable, and debug handle): [`docs/dev/DEV_TOOLS.md`](./docs/dev/DEV_TOOLS.md).

## Commands

```bash
npm run dev            # Postgres + app + Vite (ports from TA_PORT_BASE: app base+1, client base+1173)
npm run dev:restart    # restart only the app (SIGTERM → snapshot → start), Vite keeps running
npm run dev:client     # Vite only, no backend (prototype pages, playground, landing)
npm run check          # typecheck + lint + check:structure + gen:check
npm test               # unit tests (no Postgres)
npm run test:integration   # tests against a fresh, throwaway Postgres database
npm run test:contract  # NEAR port contract suites against the mocks
npm run contract:real  # Live NEAR Testnet contract suites against *.terraagent.testnet
npm run e2e -- --waves ..00 [--hack] [--host local]   # headless-Chrome wave suites
npm run test:parity    # same scenario + command log on the server host and the browser host
npm run ci:fast        # check + unit + build
npm run build          # typecheck + check:structure + vite build → frontend/dist/
npm run gen            # regenerate registries (command/event kinds, sim systems, data tables, Prisma schema)
npm run db:up | db:gen -- --name x | db:migrate | db:reset | db:seed
npm run scenario -- w00    # run a scenario headless
npm run wave           # work on the next wave of the build plan (see "Building the game: waves")
npm run wave:land -- <NN>              # Mode 1 ("merge wave into main"): 3-iteration audit/test/E2E loop, auto-heal conflicts, merge --no-ff to main, tag wave-NN, push, cleanup + future-wave propagation
npm run wave:sync -- <NN|--all> [--sync-issues]  # Mode 2 ("merge main into wave"): merge updated main into WIP wave worktree (and active issue/WNN-XX worktrees) with 3-iteration verification
npm run wave:audit -- <NN> [--sync]    # semantic collision scan (ECS codes, migrations, Q&L/Decision IDs, unlanded issues) + as-built scope delta
npm run wave:propagate -- <NN> [--add-issue WMM ...]  # post-merge self-review feature audit & safe issue injection into downstream future wave plans (`docs/plan/waves/W*.md`)
npm run validate:wave -- [NN] [--gates] [--strict]   # pre-landing wave validator (task parity, AST duplication, orchestrator/service split, client+server wiring)
npm run validate:models -- <id|--category robot|--all>   # kitbash geometry/colour/detail validator
```

Open http://127.0.0.1:5173/. That page is the **hub** and links to everything below.

## Repository layout

The repository root follows the clean root rule (D-41), keeping only agentic files (`.agents/`, `.claude/`, `AGENTS.md`, `CLAUDE.md`), `README.md`, git files (`.git`, `.github/`, `.gitignore`), `LICENSE`, `package.json` (`package-lock.json`), and the 7 domain directories:

```
shared/        code used by frontend and backend (D-32)
  contracts/   @terra/contracts — zod schemas: WS envelope + messages, command/event kinds (one file each), REST DTOs
  config/      @terra/config    — zod env loader merged per module, fail-closed flags, shared eslint/prettier configs
  db/          @terra/db        — Prisma schema per module (merged), numbered migrations, client, test-DB harness
  ledger/      @terra/ledger    — double-entry resource accounting types and math
  sim/         @terra/sim       — the one engine (D-31): kernel, systems registry, rival-ai governor, data tables, codec, SimHost
backend/
  app/         @terra/app       — the one NestJS app (D-24): core · db · flags · bus · game · ws · dev · near · ai · market · notify · analytics
  near-contracts/               — 3 Rust NEAR smart contracts (`res`, `deed`, `bounty`) deployed on NEAR Testnet
frontend/      one Vite app (root of frontend/vite.config.ts); URLs mirror the file layout
  game/        @terra/game      — net/ · store/ · core/ · features/ · dev/ (incl. economy-sim) · app/
  render/      @terra/render    — 3D render engine (viewport, kitbash, terrain, planets incl. hex/, orbit, descent, lighting)
  landing/  playground/  trade/  pitchdeck/  whitepaper/  design/
tests/         Playwright e2e (`tests/e2e/`), deterministic scenarios (`tests/scenarios/`), Vitest configs
infra/         docker-compose (dev Postgres), environment templates (`infra/.env.example`, `infra/.env.worktree`), nginx hosts
scripts/       dev runner, codegen, structure check, wave pipeline
docs/          game rules (`RULES.md`, `GUILD_PRICING.md`), specs (`DECISIONS.md`), build plan, 3D rules
```

## Integrations: mock or real (`NEAR_MODE=mock|testnet`)

Every NEAR feature, the LLM director, and notifications sit behind typed ports (`backend/app/src/near/application/ports/`, [`backend/app/src/near/README.md`](./backend/app/src/near/README.md)) with fail-closed selection (`NEAR_MODE=mock|testnet`, per-port `NEAR_ADAPTER_<PORT>`, `AI_PROVIDER=mock|nearai|zai`, `NOTIFY_ADAPTER`). Inspect live status at `GET /v1/near/status` or in-game via **Settings → Chain status**.

### Deployed NEAR Testnet Accounts & Rust Contracts (`backend/near-contracts/`)

| Account / Contract | Role | Deployment Transaction (`testnet.nearblocks.io`) |
|---|---|---|
| `terraagent.testnet` | Root namespace account | `3qmHWbgsfNoykfDeuLsyGVw36kaUmGN5uUiJqrHBgRLH` |
| `relayer.terraagent.testnet` | NEP-366 gasless meta-tx relayer | `BftLVcAcvG5ik42WAzypjQ81Vo2xBVULcHtMjsUdKPbW` |
| `minter.terraagent.testnet` | Custodial sub-account & NFT minter | `7FHCx4UMq8E3hVj1tQxAWGN7CmZ4hTupGpEte4Fopzu` |
| `res.terraagent.testnet` | NEP-245 multi-token orbital cargo (`near-contracts/res`) | `7r2V4bttfkSjKBuFc2y4hKHjmd8FDQuDexnfLNSNUTFh` |
| `deed.terraagent.testnet` | NEP-171 Colony Deed NFT (`near-contracts/deed`) | `72R9C6pU6HKw25HBpX4XSFHXQhGxFhoCE1SQzTgkiUUW` |
| `bounty.terraagent.testnet` | Mercenary & bounty cargo escrow (`near-contracts/bounty`) | `GDDYUk826TgGxDWiTq9y6PdNKW7HpfGoe8hQrMXccNFG` |

### Port Adapter Matrix

| Port | Feature | Default (`NEAR_MODE=mock`) | Live (`NEAR_MODE=testnet`) |
|---|---|---|---|
| `ChainRead` | RPC health, tx receipts | Mock (Postgres) | **Real Testnet** (`rpc.testnet.fastnear.com`) |
| `Identity` | FastAuth (`login.testnet.fast-auth.com`) + `{pilot}.terraagent.testnet` sub-accounts + NEP-413 claim | Mock (Postgres) | **Real Testnet** (`TestnetIdentityAdapter`) |
| `Relayer` | NEP-366 gasless `SignedDelegate` meta-transactions & daily spend cap | Mock (Postgres) | **Real Testnet** (`relayer.terraagent.testnet`) |
| `CargoToken` | F1 NEP-245 orbital resource mint / burn / transfer (`metals`, `minerals`, `water`, `biomass`) | Mock (Postgres, W10) | **Real Testnet** (`res.terraagent.testnet`) |
| `Intents` | F2 regional market settlement + live `1click.chaindefuser.com` dry quotes | Mock (Postgres verifier, W13) | **Real Testnet** (`TestnetIntentsAdapter` + 1Click API) |
| `DeedNft` | F6 NEP-171 Colony Deed mint, milestone metadata & one-way `settle` | Mock (Postgres, W20) | **Real Testnet** (`deed.terraagent.testnet`) |
| `Escrow` | F8 bounty & mercenary contract lock / release / refund | Mock (Postgres, W22) | **Real Testnet** (`bounty.terraagent.testnet`) |
| `AgentWallet` | F3/F4 scoped function-call access keys & instant key revocation | Mock (`AgentWalletPort`, Postgres, W15) | **Real Testnet** (`TestnetAgentWalletAdapter`) |
| `BadgeNft` | Achievement NFTs | Mock (Postgres, NEP-171) | Labeled mock (`NEAR_ADAPTER_BADGE=mock`) |
| `Staking` | Settled Colony Deed validator staking (`D-18` human-only, `403 AI_STAKING_FORBIDDEN`) | Mock (Postgres, W20) | Labeled mock (`NEAR_ADAPTER_STAKING=mock`) |
| `TreasuryDao` | Planet council policy votes & hazard shields | Mock (Postgres, W22) | Labeled mock (`NEAR_ADAPTER_TREASURY=mock`) |
| `LlmProvider` | Colony AI Director & 7-day economy analyst | Deterministic `mock` | **Real NEAR AI Cloud TEE** (`AI_PROVIDER=nearai`, `/v1/signature/{chat_id}` SHA-256 verified) or Z.ai (`glm-5.3`) |
| `Notifier` | Offline colony alerts (`under_attack`, `truce_offered`, `colony_critical`) | Mock (`core.mock_notify`, W09) | Labeled mock (`NOTIFY_ADAPTER=mock`) |

### How the Guild prices

Guild quotes call `quoteColony` (`shared/sim/src/systems/trade/agent/`). `guildAgentParams` supplies that library's params from the `guild` table; `quoteGuild` (`shared/sim/src/systems/trade/guild/quote.ts`) passes them after the thin-side widen.
Spreads, `thinHalfSpreadBp` and the cash pause live in `shared/sim/src/data/guild.ts` and that `quote.ts`.
Inventory below the NPC target widens the ask half-spread to `max(askHalfSpreadBp, thinHalfSpreadBp)` (1500 bp). Inventory above the target widens the bid the same way. At the target both sides stay at 200 bp.
Cash bids are off while `cashEnabled` is 0: a USDC or NEAR quote is given a zero balance, so the library pauses that bid (`no_cash`, unless the reference is already `stale_reference` or `thin_reference`). Barter keeps its quote-resource balance.
While an NPC is docked, the maker (`backend/app/src/market/guild/maker/`) calls the trade overview once and rests whatever `quoteGuild` returns on the four Tier-1 barter books (`metals.t1/minerals.t1`, `minerals.t1/bio.water`, `bio.water/bio.biomass`, `bio.biomass/metals.t1`). The book row's actor kind is `npc` (the guild badge is the same non-organic kind). A paused side is left off the book. Departure and the guild kill switch cancel those orders. Two guild orders do not match. A guild fill updates that NPC's cargo, consumes the funding hold for the filled size, and rests a new quote from `quoteGuild` in the same turn. Details: LED-38, LED-41.
Guild, fixture, subsidy and npc fills are not organic (`isOrganicFill`), so they stay out of VWAP. Details: LED-32, LED-33.

## Pages

All pages are entries of one Vite app (see `rollupOptions.input` in [`frontend/vite.config.ts`](./frontend/vite.config.ts)) and share the **Faction Plate** design system.

| URL | File | What it is | Code |
|---|---|---|---|
| `/` | [`frontend/index.html`](./frontend/index.html) | **Hub.** Cards linking to Landing, Play, 7-Day Economy Sim, Trade, Playground, Player Profile, and Design System. | — |
| `/landing.html` | [`frontend/landing.html`](./frontend/landing.html) | **Landing** (`terraagent.fun`): 3D orbital hero stage, Canvas 2D hex colony, resource sheets, AI Director, roadmap. | [`frontend/landing/`](./frontend/landing/) |
| `/play.html` | [`frontend/play.html`](./frontend/play.html) | **Game**: orbital world & sector picker → drop-pod descent → 3D colony diorama with RTS camera, Faction Plate HUD, and `DIRECTOR` AI Autopilot. | [`frontend/game/`](./frontend/game/) |
| `/dev/economy-sim/` | [`frontend/dev/economy-sim/index.html`](./frontend/dev/economy-sim/index.html) | **7-Day Multi-Agent Economy & Swarm Simulator**: `< 1 s` deterministic 7-day fast-forward of 3 AI colonies (*Eco-Terraformer*, *Trader*, *Warlord*) with SVG price curves, Guild VWAP reasons, raids, truces, Track `07` guardrail counters, and NEAR AI TEE badge. | [`frontend/game/dev/economy-sim/`](./frontend/game/dev/economy-sim/) |
| `/trade.html` | [`frontend/trade.html`](./frontend/trade.html) | **Trading terminal (W13):** depth ladder, price board, order ticket with fee preview, resting orders, fills, orbital cargo balances, and scoped bot API keys (`/v1/trade/*`). | [`frontend/trade/`](./frontend/trade/) |
| `/me.html` | [`frontend/me.html`](./frontend/me.html) | **Player Profile & Achievements (W12):** 11-segment stage track, 16 stats tiles, colony history, and 60 achievement tiers as 3D flip cards. | [`frontend/game/me/`](./frontend/game/me/) |
| `/deed/:tokenId` | [`frontend/deed.html`](./frontend/deed.html) | **Colony Deed share page (W20):** OpenGraph + Twitter Card SSR preview, `1200×630` PNG card, and milestone history. | [`frontend/game/deed/`](./frontend/game/deed/) |
| `/playground.html` | [`frontend/playground.html`](./frontend/playground.html) | **3D playground**: every kitbash archetype on a calibrated pedestal, 4 diagnostic views, biome weathering, bug/hive scenes, and geometry/particle validators. | [`frontend/playground/`](./frontend/playground/) |
| `/pitchdeck/` · `/whitepaper/` · `/design/` | `frontend/{pitchdeck,whitepaper,design}/index.html` | **Pitch deck**, **technical whitepaper**, and **Faction Plate design system** storybook. | `frontend/{pitchdeck,whitepaper,design}/` |

### Key URL parameters

| Page | Parameter | Effect |
|---|---|---|
| Play | `?planet=dune\|oceanForest\|forestRock` | Open orbital world & sector picker (`&deploy=1` launches descent; `&skip=1` lands straight in gameplay). |
| Play (online) | `?scenario=<id>` | Create/join a seeded scenario (`w00`, `w01`, `w05`, `w07`, `w08`, `w10`, `w11`, `w13`, `w16`, `w18`, `w20`, `w22`). Add `&fresh=1` for a new instance, `&as=<name>` for a named dev pilot, `&waves=..NN` to narrow waves, `&lag=<ms>` to test prediction. |
| Play (local) | `?host=local&scenario=w01` | Run `@terra/sim` in a browser Web Worker (no backend or Postgres); snapshots persist in IndexedDB. |
| Playground | `?inspect=<id>&biome=<kind>&view=iso\|front\|side\|top` | Inspect a 3D archetype (`robot.hero`, `building.commandHub`, etc.); add `&validate=1`, `&hexterrain=1`, `&faunaScene=mixed`, or `&march=together`. |
| All 3D pages | `?pixel=1\|0`, `?shadow=1\|0`, `?crt=1\|0`, `?daynight=1\|0` | Toggle pixel-art shader, dynamic sun/moon shadows, CRT overlay, or orbital day/night cycle (`F8` opens the 8-tab Visual Shader Lab). |

### Controls

- **Game (online):** `` ` `` opens the dev console (`help`, `warp`, `time`, `spawn`, `grant`, `stage`, `away`, `back`, `offerTruce`, `near.ports`, `near.quote`, …). Command dock: `B` Build · `U` Production · `T` Terraform (`G` **TERRAFORM** · `V` **CULTIVATE** `Grade → Irrigate → Seed → Living` · `R` **REPAIR** / rotate ghost · `Z` **DISMANTLE**) · `Q` Queue · `M` Global Map. Colony book (left): `DIRECTOR` (**`AI AUTOPILOT: OFF / ON`** + **`Allow War & Diplomacy`**), `AWAY`, `DEED`, `GOALS`, `HQ AI`, `COMBAT` (`F6` Combat Lab), `TRADE`.
- **Playground:** `[` `]` cycle models · `1`–`4` views · `T` turntable · `V` geometry validator overlay · `/` search · `F8` Visual Shader Lab (`F7` shadows, `F9` CRT, `F10` pixel art).

## Design system: Faction Plate

Defined in [`frontend/design/css/tokens.css`](./frontend/design/css/tokens.css) (`--ta-*` variables) and [`base.css`](./frontend/design/css/base.css). Colour ratio **60 / 25 / 10 / 5**: void black `#07080A` · hull white `#F2F4F7` · ignition orange `#FF6A13` (void text on orange, never white) · signal blue `#1E5BFF`. Chamfered `.plate*` / `.btn*` corners (never `border-radius`). Fonts: Chakra Petch, IBM Plex Sans, IBM Plex Mono. 3D visuals follow the 4 pillars in [`AGENTS.md`](./AGENTS.md).

## Building the game: waves

The game is structured across **27 product waves** (`W00`–`W26`) ([`docs/plan/PRODUCT_WAVES.md`](./docs/plan/PRODUCT_WAVES.md), [`docs/plan/HACKATHON_CUT.md`](./docs/plan/HACKATHON_CUT.md)):

```bash
npm run wave                     # land ready waves, then open/resume the next wave
npm run wave -- status           # wave board: state, issue progress, preset & track
npm run validate:wave -- [NN]    # 2-iteration pre-landing review & fix harness
npm run wave:land -- <NN>        # 3-iteration audit/test/E2E loop, merge --no-ff to main, tag wave-NN
npm run wave:sync -- <NN|--all>  # merge updated main into WIP wave worktree with 3-iteration check
```

## Hackathon window & authoring disclosure

100% of this repository — including the deterministic `@terra/sim` engine (`shared/sim/`), contracts & ledger (`shared/contracts/`, `shared/ledger/`, `shared/db/`), NestJS backend & NEAR/AI adapters (`backend/app/`), Rust NEAR smart contracts (`backend/near-contracts/{res,deed,bounty}`), procedural Three.js kitbash renderer & UI (`frontend/`), and test/E2E suites (`tests/`) — was authored from scratch during the official NEAR Hackathon window (after `2026-10-19`). `git log` carries the complete commit and wave history (`wave-NN` tags).

## AI-generated code

Built with AI coding agents (Antigravity & Claude Code) working from the specifications in [`docs/`](./docs) under strict structural (`npm run check:structure`: ≤ 500 lines/file, ≤ 100 lines/function), geometry (`npm run validate:models`), and parity (`npm run test:parity`) gates, with human architectural direction, review, and play-testing on every wave.

## Libraries & License

Three.js · Vite · TypeScript · NestJS · `ws` · `near-api-js` · Rust `near-sdk 5.7` · Prisma + PostgreSQL · zod · `@msgpack/msgpack` · pino · prom-client · ulid · Vitest · Playwright · ESLint · Prettier · SWC. Licensed under [MIT](./LICENSE).
