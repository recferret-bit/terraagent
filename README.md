# TerraAgent

**Human-first 3D persistent colony builder with autonomous NEAR.AI agents, real-time NEAR Intents markets, war, and diplomacy — running live 11/11 ports on NEAR Testnet.**

Command your colony manually in real time on a persistent hex planet over binary WebSockets — or click **`AI AUTOPILOT: ON`** (or go offline) and let bounded **NEAR.AI (`z-ai/glm-5.3`, TEE-attested)** agents harvest, cultivate terrain to `Living`, trade orbital NEP-245 cargo via **NEAR Intents (`NEP-413`)**, open mercenary **war bounties**, declare raids, negotiate **bilateral truces**, and vote in **Planet Council DAOs**.

![TerraAgent Live Persistent Planet Loop & NEAR Chain Architecture](./docs/assets/hero-live-planet-loop.svg)

> **Stack:** Vite + TypeScript + Three.js (WebGL2, Faction Plate HUD) · Binary WebSockets (`/ws`, `@msgpack/msgpack`) · NestJS (`@terra/app`) + deterministic `@terra/sim` worker threads · **5 Rust `near-sdk 5.7` smart contracts** (`res`, `deed`, `bounty`, `staking`, `dao`) · **NEAR AI Cloud TEE (`z-ai/glm-5.3`)** + player BYOK keys on `/me.html` · PostgreSQL (Prisma).
>
> **Deep-dive specs:** [`docs/game/RULES.md`](./docs/game/RULES.md) (game loop, victory/loss, sinks & Track `07` AI guardrails) · [`docs/game/GUILD_PRICING.md`](./docs/game/GUILD_PRICING.md) (VWAP & NPC Guild AMM math) · [`docs/hackathon/DEPLOY_GUIDE.md`](./docs/hackathon/DEPLOY_GUIDE.md) (production deployment) · [`docs/dev/DEV_TOOLS.md`](./docs/dev/DEV_TOOLS.md) (dev console, routes & env vars).

---

## Quick Start: Local Zero-Key Mode & Live NEAR Testnet

### Option A — Local Zero-Key Mode (`NEAR_MODE=mock`, `AI_PROVIDER=mock`)

Needs Node 22+ (24 tested), npm 10+, Docker (for Postgres on port `15434`), and Chromium for E2E/parity suites. Zero API keys or testnet wallets required:

```bash
npm ci
npm run dev            # → Postgres (docker, :15434), NestJS API + WS (:4001), Vite client (:5173)
```

| Action | What You See Immediately |
|---|---|
| `curl 127.0.0.1:4001/v1/healthz` & `/v1/readyz` | `{"ok":true}` and `{"db":"ok","simThreads":N}` |
| Open `http://127.0.0.1:5173/dev/economy-sim/` → **FAST-FORWARD 7 DAYS** | 3 autonomous AI colonies (*Verdant Collective*, *Iron Guild Outpost*, *Crimson Vanguard*) simulate 7 days in `< 1 s` with SVG spot-price curves, Guild VWAP reasons, raids, peace truces, and Track `07` blocks |
| Open `http://127.0.0.1:5173/play.html?scenario=w18` | Live multiplayer planet over WebSockets; open HUD **DIRECTOR** → toggle **`AI AUTOPILOT: ON`** + **`Allow War & Diplomacy`** |
| Open `http://127.0.0.1:5173/trade.html` | Real-time planet orderbook, depth ladder, order ticket, and scoped `ta_bot_...` API keys |
| Open `http://127.0.0.1:5173/me.html` | Authenticated player's personal **NEAR.AI BYOK API Key & Model** vault (AES-256-GCM encrypted), achievements, and colony history |
| Open `http://127.0.0.1:5173/play.html?scenario=w05` → `T` → `CULTIVATE [V]` | Cultivate terrain `Grade → Irrigate → Seed → Living` (`Terraform %` unlocks D-34 T2/T3 tiers) |
| Open `http://127.0.0.1:5173/dev/chain/` + run `chain.ping` in play console (`` ` ``) | Live transaction receipt (`mock:` locally, or real NEAR Testnet explorer link in `testnet` mode) |
| Stop the backend; open `/play.html?host=local&scenario=w01` | The exact same `@terra/sim` engine runs locally in a browser Web Worker backed by IndexedDB |

### Option B — Live NEAR Testnet (11/11 Ports) + NEAR.AI TEE Cloud

```bash
NEAR_MODE=testnet \
NEAR_ROOT_ACCOUNT=terraagent.testnet \
AI_PROVIDER=nearai AI_LIVE=1 NEAR_AI_API_KEY=<your_nearai_key> NEAR_AI_MODEL=z-ai/glm-5.3 \
TA_SEED_RIVAL_AI=1 \
npm run dev

# Verify live smart contracts directly against https://test.rpc.fastnear.com:
CONTRACT_CHAIN_READ_TX=BKC581CwFy3uQweLfZr7jLHRxXQRbrerMgcmHHbC6NJH npm run contract:real -- --port ChainRead
npm run contract:real -- --port BadgeNft
npm run contract:real -- --port Staking
npm run contract:real -- --port TreasuryDao
```

---

## Core Gameplay Loop ↔ NEAR Protocol Loop

TerraAgent runs a **two-speed hybrid architecture** so real-time WebSocket RTS gameplay stays responsive (`5 Hz` deterministic worker tick, up to `50 Hz` under `warp`, `60 FPS` client-side prediction + rollback reconciliation) while every durable ownership, trade, DAO, bounty, and staking state transition settles verifiably on NEAR Testnet via the **Transactional Chain Outbox (`chain.chain_outbox`)**:

| Stage | Real-Time In-Game / WebSocket Loop (`@terra/sim` + `/ws`) | Asynchronous On-Chain NEAR Loop (`OutboxRelay` → NEAR Testnet) |
|---|---|---|
| **1. Identity & Session Delegation** | Pilot signs in (`OAuth` or guest upgrade) and joins a sector on `/ws`. | `IdentityPort` creates `{pilot}.terraagent.testnet`; `AgentWalletPort` registers a scoped **Ed25519 Limited Function-Call Key** with daily token caps (`AW-11`/`AW-13`). |
| **2. Colony Founding & Living World** | Drop pod descends (`?deploy=1`). Drones harvest `metals.t1`, `minerals.t1`, `bio.water`, `bio.biomass`, build power grids, survive day/night capacitor brownouts, and `CULTIVATE [V]` hexes to `Living`. | `DeedNftPort` mints a soulbound **NEP-171 Colony Deed** on `deed.terraagent.testnet` and debounces milestone metadata updates (`stage`, `terraformBp`, `walls`, `truces`). |
| **3. Orbital Cargo & Real-Time Market** | Surplus resources export out of orbital pads; players/bots place bids & asks on the live `/trade.html` orderbook priced dynamically by organic VWAP & scarcity. | Export **mints** `NEP-245` tokens on `res.terraagent.testnet` (import **burns** them); matched trades clear via counter-signed **`NEP-413` zero-sum `token_diff`** batches on `intents.near`. |
| **4. Offline Continuity, War & Bounties** | Player closes the tab (`away`) or arms **`AI AUTOPILOT: ON`**. Server sweeps colonies every `180 s` (`COLONY_DECISION_COOLDOWN_MS = 120 s` digest cache): bots batch into 1 NEAR.AI call; players use their `/me` BYOK key. | Autopilot/rivals open cargo escrows on `bounty.terraagent.testnet` (`open_escrow`, `claim`, `refund_expired`) to fund raid defense or mercenary squads — all gas sponsored by `relayer.terraagent.testnet` (`NEP-366`). |
| **5. Planet Council Governance & Settlement** | Colonies vote on planet-wide hazards (`meteor_shield`, `terraform_boost`, `guild_subsidy`) or launch the rocket (`Settled` victory). | `TreasuryDaoPort` commits council votes & cost settlement to `dao.terraagent.testnet`. Humans seal deeds (`settled: true`) and stake own NEAR on `staking.terraagent.testnet` (**strictly human-only**, `403 AI_STAKING_FORBIDDEN`). |

---

## Living World, Closed-Loop Economy & Real-Time Market

The planet is not static scenery — every action physically and economically reshapes the map:
- **Depletion & Subsurface Discovery:** Finite `T1 / T2 / T3` surface deposits visually degrade (`full → half → depleted` rubble). Terraforming barren hexes rolls a `1%` discovery chance (`terraformFinds.deposit`) to unearth hidden subsurface veins.
- **Ecological Transformation & D-34 Progression:** `CULTIVATE [V]` converts barren `flat` tiles through `Grade → Irrigate → Seed → Living`, raising Colony `Terraform %` and unlocking T2 (`metals.t2`) and T3 advanced extraction tiers.
- **Authoritative Solar Clock & Power Grid:** A shared sim solar clock sweeps day/night across every connected client. Solar Collector Arrays drop at night, draining the HQ cell (`30 E/s`) and Capacitor Banks before load-shedding priority groups; sagging power cables render live load/brownout pulses in 3D.

![Real-Time Planet Guild Market and NEAR Intents NEP-413 Settlement](./docs/assets/realtime-market-intents.svg)

### Real-Time Planet Orderbook (`/trade.html`) & Guild AMM Pricing Math

Markets operate **24/7 over REST + SSE + WebSocket diffs** (`/v1/trade/*`). Every Colony & Bot trades orbital NEP-245 cargo against native quotes or USDC/NEAR pairs, while **NPC Guild Haulers** (`kestrel` / `vanguard`) prevent liquidity lockups without distorting organic price discovery:

- **Guild Mid Price Formula** (`shared/sim/src/systems/trade/guild/quote.ts`):
  $$\text{mid} = \text{referenceVWAP} \times \left(\frac{\text{targetInventory}}{\max(1, \text{inventory})}\right)^k$$
  anchored strictly to organic 24-hour VWAP (`isOrganicFill`, `LED-32` excludes NPC/fixture fills from moving reference price).
- **Dynamic Thin-Side Spread Widening:** Balanced books quote `200 bp` half-spread; thin inventory below target widens that side up to `thinHalfSpreadBp = 1500 bp` (`15%`) and explains why in UI hover tooltips (`"inventory 2.1× target → bid −48%"`).
- **Zero-Sum NEAR Intents (`NEP-413`) + 1Click Cross-Chain Quotes:** Matched trades settle via counter-signed `token_diff` intents verified on-chain so per-token deltas sum to exact zero, while `TestnetIntentsAdapter` queries live `https://1click.chaindefuser.com/v0/quote` dry-run quotes for external NEAR/USDC liquidity.

---

## Autonomous Scenario: Offline Players, Batched NEAR.AI, Trade, War & Diplomacy

![24-Hour Autonomous Scenario: Offline Player, NEAR.AI Bots, Trade, War & Diplomacy](./docs/assets/autonomous-scenario-24h.svg)

### How `NEAR.AI` (`z-ai/glm-5.3` TEE) Is Integrated & Cost-Optimized

TerraAgent splits autonomous intelligence cleanly between **NPC Rival Bots** and **Human Players**:

1. **Batched Bot Decision Manager (`ColonyAgentLoopService`, `backend/app/src/ai/colony-agent/`)**:
   - Background sweep runs every **`180 s`** (`COLONY_AGENT_LOOP_MS = 180_000`) with a **`120 s` state-digest cooldown** (`observationDigest` + `decisionCache`, `COLONY_DECISION_COOLDOWN_MS = 120_000`) so unchanged colonies cost **zero LLM tokens**.
   - All active non-player AI bots (`obs.isBot === true`) on a planet are serialized into **one batched prompt** to NEAR AI Cloud (`https://cloud-api.near.ai/v1/chat/completions`, default model **`z-ai/glm-5.3`**) and return a single typed `directives[]` array (`queue_goal`, `trade`, `accept_guild_offer`, `declare_war`, `raid`, `propose_truce`, `respond_truce`, `hold`).
   - Every response is verified against NEAR AI Cloud's TEE endpoint (`/v1/signature/{chat_id}`) returning hardware-attested `signature` + `signature_kind` (`provider_tee` / `gateway`).
2. **Player BYOK NEAR.AI Vault on `/me.html` (`/v1/me/ai-settings`)**:
   - Authenticated players can connect their **own NEAR.AI API key** and pick their preferred model (`z-ai/glm-5.3`, `z-ai/glm-5.3-flash`, `deepseek/deepseek-v3.2`, `deepseek-ai/DeepSeek-V4.1-Flash-1017`, `Qwen/Qwen3.8-27B`, `openai/gpt-5-mini`, `anthropic/claude-sonnet-4-6`).
   - Keys are **encrypted at rest with `AES-256-GCM`** via `NEAR_KEK` in PostgreSQL (`0032_player_nearai_settings`) and never returned in plaintext (`apiKeyPreview` only).
   - **Isolation guarantee:** Player autopilot colonies **never** spend the server's bot quota — if a player has connected a BYOK key on `/me.html`, their colonies batch under their own key & model; otherwise, they fall back cleanly to TerraAgent's deterministic policy evaluator (`deterministicDirective`).

### 3 Hard Track `07` AI Safety Guardrails (Code-Enforced)

- **1. Scoped Ed25519 Session Keys + Daily Allowance Caps (`AgentWalletPort`):** Bot & autopilot keys allow only bounded method calls and enforce per-token daily spend limits (`NEAR_ALLOWANCE_EXHAUSTED`), revocable in one click (`revoke()`).
- **2. Non-Transferable Keys & Explicit War Opt-In (`AW-11`, `AW-13`):** AI keys are non-transferable (`AW-13`). Both destructive truce-breaking (`Oathbreaker`) and offensive `declare_war` / `raid` orders are stripped by `validateAgentGuardrails` unless the human explicitly toggled **`Allow War & Diplomacy`** in HUD `DIRECTOR`.
- **3. Human-Only Staking Gate (`D-18`):** AI callers attempting validator staking receive `403 AI_STAKING_FORBIDDEN`. Only human pilots can stake/unstake NEAR against Settled Colony Deeds.

---

## Cryptographic & NEAR.AI Payload Examples

### 1. Zero-Sum `NEP-413` `token_diff` Trade Intent (`intents.near`)

Generated by `backend/app/src/near/intents/nep413-token-diff.ts` (`Borsh` NEP-413 tag + SHA-256 + Ed25519 verify):

```json
{
  "standard": "nep413",
  "payload": {
    "message": "{\"signer_id\":\"iron-guild.terraagent.testnet\",\"deadline\":\"2026-11-13T12:00:00.000Z\",\"intents\":[{\"intent\":\"token_diff\",\"diff\":{\"nep245:res.terraagent.testnet:metals.t1\":\"-400\",\"nep245:res.terraagent.testnet:bio.water\":\"250\"}}]}",
    "nonce": "mQ9x3kKp8Z6N1Y2v4tR7wL0cB5dF8hJ1sP3qA9uE4vY=",
    "recipient": "intents.near"
  },
  "public_key": "ed25519:7fH3k9qR...",
  "signature": "ed25519:3vK8pM2n..."
}
```
*Invariant checked on-chain/verifier:* For every token key in the matched batch, $\sum_i \text{diff}_i[\text{token}] = 0$ and `nonce` cannot replay (`NEAR_INTENT_NONCE_REUSED`).

### 2. Gasless `NEP-366` Meta-Transaction (`relayer.terraagent.testnet`)

Players and colony bots sign an off-chain `SignedDelegate` action; `TestnetRelayerAdapter` verifies allowlisted receivers (`res`, `deed`, `bounty`, `staking`, `dao`, `intents`), checks `NEAR_RELAYER_DAILY_CAP`, and broadcasts it gaslessly so pilots play without holding liquid gas NEAR.

### 3. Batched `NEAR.AI` (`z-ai/glm-5.3`) Directive & TEE Attestation Output

```json
{
  "model": "z-ai/glm-5.3",
  "directives": [
    {
      "colonyIndex": 1,
      "action": "trade",
      "tradeSide": "sell",
      "tradePair": "metals.t1/minerals.t1",
      "tradeAmount": 250,
      "rationale": "metals surplus 2.1x; Guild ask wide at +14% VWAP"
    },
    {
      "colonyIndex": 2,
      "action": "declare_war",
      "targetColonyIndex": 1,
      "rationale": "target shield expired; 4 Recon Rovers ready"
    }
  ],
  "attestation": {
    "chatId": "chatcmpl-9f3a...",
    "verified": true,
    "signatureKind": "provider_tee",
    "signature": "0x84c1d9e2..."
  }
}
```

---

## Live Deployed NEAR Testnet Contracts & Accounts (`terraagent.testnet`)

**All 11/11 NEAR ports** resolve to real Testnet accounts & **5 custom Rust `near-sdk 5.7` smart contracts** ([`backend/near-contracts/`](./backend/near-contracts/)) when `NEAR_MODE=testnet`:

### 5 Live Rust Smart Contracts (`near-sdk 5.7`)

| Contract Account | Source Crate | Standard / Key Methods | Live WASM `code_hash` | Deploy / Init Tx (`testnet.nearblocks.io`) |
|---|---|---|---|---|
| [`res.terraagent.testnet`](https://testnet.nearblocks.io/address/res.terraagent.testnet) | [`backend/near-contracts/res`](./backend/near-contracts/res/src/lib.rs) | **NEP-245 Multi-Token** (`10` cargo tokens, `18` dec) · `mt_mint`, `mt_burn`, `operator_transfer`, `mt_transfer`, `mt_balance_of`, `mt_metadata` | `9KrGRQKkAMUP8qCEGk5CC6pgK9E79V1js46EipXTsvym` | [`7r2V4bttfkSjKBuFc2y4hKHjmd8FDQuDexnfLNSNUTFh`](https://testnet.nearblocks.io/txns/7r2V4bttfkSjKBuFc2y4hKHjmd8FDQuDexnfLNSNUTFh) |
| [`deed.terraagent.testnet`](https://testnet.nearblocks.io/address/deed.terraagent.testnet) | [`backend/near-contracts/deed`](./backend/near-contracts/deed/src/lib.rs) | **NEP-171 Soulbound Deeds & Badges NFT** · `mint_deed`, `update_metadata`, `get_deed`, `owner_of`, `nft_token`, `nft_tokens_for_owner` | `GFB5WgL1hMiCSFZSNjiXdYhui68ptf2AyDvFHZGUR6pB` | [`72R9C6pU6HKw25HBpX4XSFHXQhGxFhoCE1SQzTgkiUUW`](https://testnet.nearblocks.io/txns/72R9C6pU6HKw25HBpX4XSFHXQhGxFhoCE1SQzTgkiUUW) |
| [`bounty.terraagent.testnet`](https://testnet.nearblocks.io/address/bounty.terraagent.testnet) | [`backend/near-contracts/bounty`](./backend/near-contracts/bounty/src/lib.rs) | **Mercenary & Raid-Defense Escrow** · `open_escrow`, `claim_escrow`, `refund_escrow`, `get_escrow` (idempotent by `op_id`) | `6VGAZh8udooNjj85LyzBZT4jY1959FWFBJ3KBugGVtuH` | [`GDDYUk826TgGxDWiTq9y6PdNKW7HpfGoe8hQrMXccNFG`](https://testnet.nearblocks.io/txns/GDDYUk826TgGxDWiTq9y6PdNKW7HpfGoe8hQrMXccNFG) |
| [`staking.terraagent.testnet`](https://testnet.nearblocks.io/address/staking.terraagent.testnet) | [`backend/near-contracts/staking`](./backend/near-contracts/staking/src/lib.rs) | **Validator Yield Vault (`D-18` human-only)** · `credit_near`, `stake`, `unstake` (`2` game-day unbonding), `withdraw`, `get_position` | `9K2xHY4QZh7wfXAdf8pxogviBortXP4mM722W3k97NeC` | [`CJAeXB8YVZqrXPQQRRMMY2s6sBY7Ma17gE1thZ9CHAyX`](https://testnet.nearblocks.io/txns/CJAeXB8YVZqrXPQQRRMMY2s6sBY7Ma17gE1thZ9CHAyX) (init [`BKC581Cw...`](https://testnet.nearblocks.io/txns/BKC581CwFy3uQweLfZr7jLHRxXQRbrerMgcmHHbC6NJH)) |
| [`dao.terraagent.testnet`](https://testnet.nearblocks.io/address/dao.terraagent.testnet) | [`backend/near-contracts/dao`](./backend/near-contracts/dao/src/lib.rs) | **Planet Council Treasury DAO** · `create_dao`, `deposit`, `add_member`, `propose`, `vote`, `finalize`, `get_dao` (`> 50%` or `>= 2` unanimous) | `ByT7esMkAqrtAi7SceUhDM5aauA1XfoUPt88fVvz5L8r` | [`4DVcXY5cV4uGRA5rtcoy6HhqPAhi2QwuKgwtjTvJedHn`](https://testnet.nearblocks.io/txns/4DVcXY5cV4uGRA5rtcoy6HhqPAhi2QwuKgwtjTvJedHn) (init [`DDtgCqpt...`](https://testnet.nearblocks.io/txns/DDtgCqptLeziTjEDE8Pfz47N5amZ7wTAWDqfQRsjx42x)) |

### 3 Core Protocol Accounts & External NEAR Infrastructure

| Account / Protocol Target | Role in TerraAgent | Live Testnet Ref (`testnet.nearblocks.io`) |
|---|---|---|
| [`terraagent.testnet`](https://testnet.nearblocks.io/address/terraagent.testnet) | Root namespace, sub-account parent (`{pilot}.terraagent.testnet`) & contract owner | [`3qmHWbgsfNoykfDeuLsyGVw36kaUmGN5uUiJqrHBgRLH`](https://testnet.nearblocks.io/txns/3qmHWbgsfNoykfDeuLsyGVw36kaUmGN5uUiJqrHBgRLH) |
| [`relayer.terraagent.testnet`](https://testnet.nearblocks.io/address/relayer.terraagent.testnet) | **NEP-366 Gasless Meta-Tx Relayer** (`SignedDelegate` receiver allowlist & daily cap) | [`BftLVcAcvG5ik42WAzypjQ81Vo2xBVULcHtMjsUdKPbW`](https://testnet.nearblocks.io/txns/BftLVcAcvG5ik42WAzypjQ81Vo2xBVULcHtMjsUdKPbW) |
| [`minter.terraagent.testnet`](https://testnet.nearblocks.io/address/minter.terraagent.testnet) | Custodial signer & authorized contract operator across `res`, `deed`, `bounty`, `staking`, `dao` | [`7FHCx4UMq8E3hVj1tQxAWGN7CmZ4hTupGpEte4Fopzu`](https://testnet.nearblocks.io/txns/7FHCx4UMq8E3hVj1tQxAWGN7CmZ4hTupGpEte4Fopzu) |
| `intents.near` + `1click.chaindefuser.com` | Zero-sum `NEP-413` `token_diff` intent batch settlement & cross-chain dry-run quotes | Bound in [`TestnetIntentsAdapter`](./backend/app/src/near/infrastructure/adapters/real/testnet-intents.adapter.ts) |

### Verify All 5 Contracts via Live RPC (`curl`)

```bash
# 1. Check live code_hash across all 5 contract accounts on NEAR Testnet:
for c in res deed bounty staking dao; do
  echo -n "$c.terraagent.testnet -> "
  curl -fsS -X POST https://test.rpc.fastnear.com -H 'content-type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"view_account\",\"finality\":\"final\",\"account_id\":\"$c.terraagent.testnet\"}}" | jq -r '.result.code_hash'
done

# 2. Query deployed NEP-245 cargo tokens on res.terraagent.testnet:
curl -fsS -X POST https://test.rpc.fastnear.com -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"call_function","finality":"final","account_id":"res.terraagent.testnet","method_name":"mt_metadata","args_base64":"e30="}}' | jq '.result.result | implode | fromjson'

# 3. Inspect Staking Vault & Treasury DAO owners and Deed NFT metadata:
for c in staking.terraagent.testnet dao.terraagent.testnet; do
  curl -fsS -X POST https://test.rpc.fastnear.com -H 'content-type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"query\",\"params\":{\"request_type\":\"call_function\",\"finality\":\"final\",\"account_id\":\"$c\",\"method_name\":\"get_owner\",\"args_base64\":\"e30=\"}}"
done
```

### Full 11/11 Port + AI + Notifier Binding Matrix (`GET /v1/near/status`)

| Port / Service | Role in Game | `NEAR_MODE=mock` | `NEAR_MODE=testnet` |
|---|---|---|---|
| `ChainRead` | RPC health, finality & tx receipt lookups | Postgres Mock | **Live Testnet** (`test.rpc.fastnear.com` + failover) |
| `Identity` | OAuth sign-in, `{pilot}.terraagent.testnet` claim | Postgres Mock | **Live Testnet** (`TestnetIdentityAdapter` / FastAuth) |
| `Relayer` | NEP-366 gasless `SignedDelegate` sponsorship | Postgres Mock | **Live Testnet** (`relayer.terraagent.testnet`) |
| `CargoToken` | F1 NEP-245 orbital resource mint / burn / transfer | Postgres Mock | **Live Testnet** (`res.terraagent.testnet`) |
| `Intents` | F2 `NEP-413` `token_diff` & 1Click quotes | Postgres Mock | **Live Testnet** (`intents.near` + `1click.chaindefuser.com`) |
| `AgentWallet` | F3/F4 scoped function-call access keys & caps | Postgres Mock | **Live Testnet** (`TestnetAgentWalletAdapter`) |
| `DeedNft` | F6 NEP-171 Settled Colony Deed NFTs | Postgres Mock | **Live Testnet** (`deed.terraagent.testnet`) |
| `BadgeNft` | Achievement badge NFTs (`collection: 'badge'`) | Postgres Mock | **Live Testnet** (`deed.terraagent.testnet`) |
| `Escrow` | F8 mercenary & raid-defense cargo bounties | Postgres Mock | **Live Testnet** (`bounty.terraagent.testnet`) |
| `Staking` | Validator yield staking & 4-epoch unbonding (`D-18`) | Postgres Mock | **Live Testnet** (`staking.terraagent.testnet`) |
| `TreasuryDao` | Planet council deposits, proposals & quorum votes | Postgres Mock | **Live Testnet** (`dao.terraagent.testnet`) |
| `LlmProvider` | Bot batched decision engine & BYOK autopilot | Deterministic Mock | **NEAR AI Cloud TEE** (`z-ai/glm-5.3` + SHA-256 sig) |
| `Notifier` | Offline raid, truce & critical alerts | Postgres `core.mock_notify` | Live WebPush / Telegram (`NOTIFY_ADAPTER=live`) |

---

## Pages, Controls & Developer Commands

### Web Pages (`frontend/vite.config.ts`)

| URL | Purpose | Key Params / Notes |
|---|---|---|
| `/` | Hub landing & quick navigation links | Links all pages |
| `/landing.html` | Public landing showcase (`terraagent.fun`) | Interactive orbital globe |
| `/play.html` | Live 3D colony game over `/ws` | `?planet=dune\|oceanForest\|forestRock`, `?scenario=w00..w22`, `?host=local`, `?skip=1` |
| `/trade.html` | Real-time planet orderbook, swaps & bot API keys | `?planet=<id>&pair=<base>/<quote>&as=<name>` |
| `/me.html` | Player profile, badges, colony history & **BYOK NEAR.AI settings** | `?as=<name>` in dev; authenticated session in prod |
| `/deed/:tokenId` | Public Settled Colony Deed OpenGraph card & history | SSR metadata preview + share card |
| `/dev/economy-sim/` | 7-day deterministic 3-colony economy & AI simulator | Interactive curves + Track `07` counters |
| `/playground.html` | 3D procedural kitbash & shader inspector | `?inspect=<id>&validate=1&biome=<kind>` |
| `/dev/chain/` · `/dev/parity/` | On-chain receipt explorer & client/server sim parity checker | Dev-only diagnostics |
| `/pitchdeck/` · `/whitepaper/` · `/design/` | Investor deck, technical whitepaper & Faction Plate design system | `--ta-*` design tokens |

### Key Controls (`/play.html`)

- **Console:** `` ` `` toggles the dev console (`help`, `warp`, `time`, `spawn`, `grant`, `stage`, `away`, `back`, `offerTruce`, `near.ports`, `near.quote`).
- **Command Dock (right):** `B` Build · `U` Production · `T` Terraform (`G` Terraform · `V` **Cultivate** `Grade → Irrigate → Seed → Living` · `R` Repair/rotate · `Z` Dismantle) · `Q` Queue · `M` Global Map.
- **Colony Book (left):** `DIRECTOR` (**`AI AUTOPILOT: OFF / ON`** + **`Allow War & Diplomacy`**), `AWAY`, `DEED`, `GOALS`, `HQ AI`, `COMBAT`, `TRADE`.

### Developer & CI Commands

```bash
npm run dev            # Postgres + NestJS app (:4001) + Vite (:5173)
npm run check          # typecheck + lint + check:structure + gen:check
npm test               # full unit test suite (no DB)
npm run test:integration   # Postgres integration suite
npm run test:contract  # all 11 NEAR port + AI/Notifier contract suites
npm run contract:real -- --port <Port>   # live NEAR Testnet contract verification
npm run e2e -- --waves ..22 [--host local]   # Playwright headless-Chrome E2E
npm run test:parity    # client worker vs server thread determinism check
npm run build          # typecheck + check:structure + Vite production build
npm run validate:models -- --all   # 3D kitbash geometry/colour/detail gate
cargo test --manifest-path backend/near-contracts/Cargo.toml   # Rust unit tests for all 5 contracts
```

---

## Repository Layout (`D-41` Clean Root)

```
shared/        @terra/{contracts, config, db, ledger, sim} — single source of truth shared across client, server & workers
backend/
  app/         @terra/app — NestJS modules (ws, game, near, ai, market, profile, notify, analytics, dev)
  near-contracts/  5 Rust near-sdk 5.7 smart contracts: res, deed, bounty, staking, dao
frontend/      One Vite multi-page app (game, render, landing, trade, playground, design, pitchdeck, whitepaper)
tests/         Playwright E2E, deterministic scenarios & Vitest configs
infra/         Docker Compose stacks, nginx vhosts & env templates
scripts/       Dev orchestration, Testnet deployment, codegen, structure & wave gates
docs/          Game rules, NEAR specs, deployment guide, visual pillars & assets
```

---

## Hackathon Window, AI Authorship & License

100% of this repository — including the deterministic `@terra/sim` engine, `@terra/contracts` & ledger, NestJS backend, 5 Rust smart contracts (`backend/near-contracts/{res,deed,bounty,staking,dao}`), procedural Three.js kitbash renderer & UI, and test/E2E suites — was authored from scratch during the official NEAR Hackathon window (after `2026-10-19`). Built with AI coding agents (Antigravity & Claude Code) under strict automated structure (`<= 500` lines/file, `<= 100` lines/fn), geometry, and parity gates, with human architectural direction, verification, and playtesting across every wave.

Core libraries: Three.js · Vite · TypeScript · NestJS · `ws` · `near-api-js` · Rust `near-sdk 5.7` · Prisma + PostgreSQL · zod · `@msgpack/msgpack` · pino · prom-client · Vitest · Playwright · ESLint · Prettier. Licensed under [MIT](./LICENSE).
