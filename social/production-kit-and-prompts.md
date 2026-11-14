# TerraAgent — Production Runbook, Verified URLs, Text Cards & AI Prompts

Step-by-step capture guide so you can shoot the entire `2:18` Hybrid Demo Video cleanly in **~20 minutes** without hitting production dev-route gates or unauthenticated screens.

---

## 1. Important Architecture Split: Live Production vs. Local Dev Tabs

In TerraAgent, `DevOnlyGuard` (`BE-18`) intentionally returns **`HTTP 404` on `/v1/dev/*`** when `NODE_ENV=production`, and `VITE_APP_ENV=production` hides the `` ` `` dev console and `F8` Shader Lab on `play.terraagent.fun`. Use each environment for what it does best:

- **Use Live Production (`https://*.terraagent.fun` & `https://api.terraagent.fun`)** for real FastAuth/OAuth login, atmospheric drop-pod entry (`?deploy=1`), live `/trade.html` orderbook, `/me.html` BYOK vault & 3D badges, `/deed/deed%3Acol_0` SSR card, `playground.terraagent.fun`, and all live Testnet/1Click/403 `curl` proofs. _(Sign in once on Tab 2 so your session carries automatically to `/trade.html` and `/me.html`!)_
- **Use Local Stack (`npm run dev` on `http://127.0.0.1:5173`)** for instant seeded multi-colony scenarios (`?scenario=w05`, `w07`, `w15`, `w18`), `F8` storm/lightning triggers, `` ` `` `guild.summon kestrel`, instant `?as=alice` auth, and the newest uncommitted `/dev/economy-sim/` **25-agent `.swarm` & `.agentCommerce`** tables (until redeployed to `api.terraagent.fun`).

### Pre-Flight Browser Tabs (`1920 × 1080`, `100%` Zoom, `60 FPS`, Bookmarks Hidden)

| Tab    | Scene in Video                                           | Verified Capture URL (Use Exact Column Shown)                                                            | Backup / Alternative URL                                                       | Quick Action on Camera                                                                                                                                                                             |
| ------ | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1**  | Orbit Morph, Shoreline Colony, `#protocol` & `#chain`    | **Live:** `https://terraagent.fun/landing.html`                                                          | `http://127.0.0.1:5173/landing.html`                                           | Record `#hero-stage` planet morph (`4s`), `#colony` dusk diorama (`5s`), `#protocol` 3-inflow/2-outflow diagram & `#chain` board.                                                                  |
| **2**  | Atmospheric Drop-Pod Entry, Social Login & Deed          | **Live:** `https://play.terraagent.fun/play.html?planet=oceanForest&deploy=1`                            | `https://play.terraagent.fun/deed/deed%3Acol_0`                                | Sign in once (FastAuth/Google), record `DescentRunner` drop-pod landing & Hero deploy, and flash `/deed/deed%3Acol_0` NearBlocks card.                                                             |
| **3**  | Hex Terraforming Wave & 3D Chunk Debris (`w05`)          | **Live Offline Worker:** `https://play.terraagent.fun/play.html?host=local&scenario=w05`                 | **Local:** `http://127.0.0.1:5173/play.html?scenario=w05`                      | Press `T` → `V` (**Cultivate**) and sweep hexes `Grade → Irrigate → Seed → Living` while harvesters slice coastal rocks/trees.                                                                     |
| **4**  | Alien Chitin Swarm Siege + 3D Lightning Strike           | **Live:** `https://playground.terraagent.fun/playground.html?faunaScene=mixed&faunaMode=bugs&biome=dune` | **Local Storm (`F8`):** `http://127.0.0.1:5173/play.html?scenario=w07`         | Capture `2.5s` of turrets firing on ants/beetles/acid spitters on `playground`, plus `2.5s` of `F8` storm/lightning strike in local `w07`.                                                         |
| **5**  | Trade Hub `NEP-245` Export & Guild VWAP Tooltip (`w15`)  | **Local (`npm run dev`):** `http://127.0.0.1:5173/play.html?scenario=w15`                                | Live Colony Trade Hub after building S3 Trade Hub                              | Press `` ` `` → `guild.summon kestrel` if needed, export `metals.t1` at Trade Hub, and hover `Kestrel` 24h VWAP `reason` tooltip.                                                                  |
| **6**  | Live 90-Pair CLOB, 4-Way Intent Swap & `ta_bot` Kill     | **Live (Signed In):** `https://play.terraagent.fun/trade.html`                                           | **Local Instant Auth:** `http://127.0.0.1:5173/trade.html?as=alice`            | Submit swap showing **4-Way Settlement** + **`-50%` Day-1 Staker Badge**, then scroll to API Keys (`ta_bot_...` daily budget meter & `KILL SWITCH`).                                               |
| **7**  | Top-Right `DIRECTOR`, Recon Raids & War Bonds (`w18`)    | **Local (`npm run dev`):** `http://127.0.0.1:5173/play.html?scenario=w18`                                | Live `play.terraagent.fun` (**top-right** Colony Book → `DIRECTOR` & `COMBAT`) | Capture Recon rovers raiding depot; open **top-right Colony Book → `DIRECTOR`** → toggle **`AI AUTOPILOT: ON`** + **`Allow War & Diplomacy`** + Bonded War modal.                                  |
| **8**  | `AES-256-GCM` BYOK NEAR.AI Vault & 3D `BadgeNft` Cards   | **Live (Signed In):** `https://play.terraagent.fun/me.html`                                              | **Local Instant Auth:** `http://127.0.0.1:5173/me.html?as=alice`               | Flash **`AES-256-GCM` Encrypted BYOK NEAR.AI** model selector (`z-ai/glm-5.3-flash`) and hover 3D flip-sheen soulbound Achievement Badges.                                                         |
| **9**  | 7-Day 25-Agent Swarm, Contractor Receipts & TEE Proof    | **Local (`AI_LIVE=1` or redeployed prod):** `http://127.0.0.1:5173/dev/economy-sim/`                     | **Live:** `https://play.terraagent.fun/dev/economy-sim/`                       | Click **`FAST-FORWARD 7 DAYS`**; show `20×5` `*.swarm` sealed-bid rounds, 1-round `AgentTaskReceipt` table, and `NEAR.AI` TEE `ECDSA` verification (`+{planet}.dao` on local `w22` / `#protocol`). |
| **10** | Climax Shots: Robot Squad March, S10 Rocket & Guild Ship | **Live:** `https://playground.terraagent.fun/playground.html?march=together&biome=forestRock`            | `?inspect=building.rocket&turntable=1&biome=oceanForest&surface=1`             | Record `3s` robot squad march, `3s` `building.rocket` turntable, and `1.5s` `?inspect=ship.guildTrader&turntable=1` for Act I Shot 4.                                                              |

> **Tip for Live NEAR.AI TEE Badge in Tab 9 Locally:** Start `npm run dev` with `NEAR_MODE=testnet AI_PROVIDER=nearai AI_LIVE=1 NEAR_AI_API_KEY=<key> NEAR_AI_MODEL=z-ai/glm-5.3-flash` (or redeploy the latest worktree commit to `api.terraagent.fun` before filming so `https://play.terraagent.fun/dev/economy-sim/` renders both live TEE attestation and the new `20×5` swarm + contractor receipt tables).

---

## 2. Pre-Staged Live Terminal Proofs (`18pt` Font)

All three commands below are verified `200` / `403` against live `https://api.terraagent.fun` right now:

```bash
# Proof A (Act III — 1:24): Hard AI Policy Guardrail -> Instant HTTP/2 403 AI_STAKING_FORBIDDEN
curl -i -sS -X POST https://api.terraagent.fun/v1/near/stake \
  -H 'content-type: application/json' -H 'x-actor: ai' \
  -d '{"amount":"1.0","poolId":"astro-stakers.pool.testnet"}'

# Proof B (Optional Act II Split): Live NEAR Intents 1Click Solver Quote (dry: true, ed25519 signature)
curl -fsS -X POST https://api.terraagent.fun/v1/near/intents/quote \
  -H 'content-type: application/json' -d '{"amount":"1000000000000000000000000"}' | jq .

# Proof C (Act V — 2:08): All 11/11 NEAR Testnet Ports Green + FastNEAR ChainRead Health
curl -fsS https://api.terraagent.fun/v1/near/status | jq '{nearMode, rootAccount, health, ports}'
```

---

## 3. Exact Faction Plate Text-Block & Transition Card Specs (`tokens.css`)

Use the exact tokens from [`frontend/design/css/tokens.css`](../frontend/design/css/tokens.css) in CapCut, DaVinci Resolve, Premiere, Final Cut, or Screen Studio:

- **Exact Surface & Text Hex Tokens:**
  - Void (`--ta-void`): `#07080A` · Plate (`--ta-plate`): `#111318` · Seam (`--ta-seam` / `--ta-seam-2`): `#222631` / `#2A2F3A`
  - Hull / Primary Text (`--ta-hull` / `--ta-text`): `#F2F4F7` · Muted Steel (`--ta-steel`): `#8A93A6` · Dark Ink (`--ta-ink`): `#0A0B0D`
  - Ignition Orange (`--ta-orange`, ≈10% action accent): `#FF6A13` (**Always put dark `#07080A` / `#0A0B0D` text on `#FF6A13` orange tags — never white text on orange!**)
  - Signal Blue (`--ta-blue`, ≈5% systems accent): `#1E5BFF` · High-Contrast Blue (`--ta-blue-hi`): `#5B8CFF` · Energy Cyan (`--ta-energy`): `#39D0FF` · Terra Green (`--ta-terra`): `#3DDC84`
- **Geometry & Official Fonts:** **45° chamfered corners** (`10px` / `16px` / `28px` cuts — zero rounded `border-radius`), **`Chakra Petch`** (`600/700` uppercase display), **`IBM Plex Sans`** (body), and **`IBM Plex Mono`** (contract IDs & technical pills).

### Copy-Paste Overlay Text Blocks

1. **Cold Open (`0:01`):** Tag (`#FF6A13` bg, `#07080A` text): `● LIVE BROWSER WEBGL2 · 60 FPS` · Headline: `WHAT HAPPENS TO YOUR COLONY WHEN YOU CLOSE THE TAB?`
2. **Situation Bars (`0:04–0:17`):** `01 // MINE FINITE VEINS · TERRAFORM BARREN HEXES` → `02 // SURVIVE STORMS & ALIEN CHITIN SWARMS` → `03 // RAID RIVALS · CROSS ORBITAL MARKETS`
3. **Act I Bumper (`0:18`):** `ZERO WALLET POPUPS. · 6 RUST CONTRACTS · 11/11 LIVE ON NEAR TESTNET.`
4. **Act II HUD Pills (`0:28–0:58` — `games`):**
   - `pilots.terraagent.testnet · NEP-366 GASLESS RELAYER · NEP-171 SOULBOUND DEED`
   - `res.terraagent.testnet (NEP-245) → NEP-413 ZERO-SUM INTENTS + LIVE 1CLICK QUOTES`
   - `staking.terraagent.testnet · DAY-1 LOSSLESS STAKING · 0% P2W · -50% TRADE FEES`
5. **Act III Bumper & Pills (`0:58–1:32` — `security` + `agents`):**
   - `TRACK 02 // GIVE AI A WALLET` — `Scoped Keys · 1-Round Agent Negotiation · Bonded Wars · Hard Guardrails`
   - `AgentWallet (director-key / ta_bot_...) · ACID DAILY CAPS · /v1/trade/kill · AES-256-GCM BYOK + BadgeNft`
   - `agent-commerce.ts (1-Round Counter-Quote + AgentTaskReceipt) · bounty.terraagent.testnet (90% SLASH) · 403 AI_STAKING_FORBIDDEN`
6. **Act IV Bumper & Pills (`1:32–2:02` — `swarms`):**
   - `TRACK 03 // AUTONOMOUS AI SWARMS` — `20×5 Sealed-Bid Swarm · NEAR.AI Cloud TEE · Planet Council DAO`
   - `buyer-01..20.swarm.terraagent.testnet (Uniform Clearing) · NEAR.AI TEE (z-ai/glm-5.3-flash · ECDSA Verified)`
   - `{planet}.dao.terraagent.testnet (>50% QUORUM) · protocol.terraagent.testnet (SELF-FUNDING)`
7. **End Card (`2:16–2:18`):** `TERRAAGENT — DROP ONE ROBOT. LEAVE. IT KEEPS BUILDING. · https://terraagent.fun · @NEARProtocol #NEARHackathon`

---

## 4. Optional "Part Generated" AI Match-Cut & Audio Prompts (`<= 3s` Total)

To add cinematic polish in Act I **without faking gameplay**, capture a real screenshot from **Tab 2** and **Tab 4** and pass each screenshot as the **End Keyframe (Last Frame)** in **Runway Gen-4 / Veo 3 / Kling** so the `1.5 s` shot resolves pixel-accurately into live 60 FPS WebGL2:

- **Prompt 1 — Drop-Pod Storm Entry (`0:01.5–0:03.0` → End Keyframe = Tab 2 Screenshot):**
  `Hard-surface industrial sci-fi drop pod in gunmetal (#111318) and ignition orange (#FF6A13) streaking down through storm clouds toward an emerald hex-grid shoreline planet, cyan plasma wake (#39D0FF), 28-degree telephoto isometric lens, ACES filmic contrast, camera locking smoothly onto the landing zone.`
- **Prompt 2 — Dune Chitin Swarm Rush (`0:08.0–0:09.5` → End Keyframe = Tab 4 Screenshot):**
  `Telephoto tabletop-diorama push-in across orange desert dunes at dusk as black-chitin alien ants, armored blue beetles, and glowing green acid spitters surge toward gunmetal twin-barrel colony turrets and cyan HDR capacitors charging up to fire.`
- **Prompt 3 — Underscore (`Suno` / `Udio`, `-10 dB` in Acts I & V, ducked to `-22 dB` under voice in Acts II–IV):**
  `Instrumental dark industrial sci-fi RTS trailer pulse, 118 BPM, tight sub-bass, crisp mechanical servo percussion, subtle analog synth arpeggio, zero vocals, clean midrange headroom for voiceover.`
