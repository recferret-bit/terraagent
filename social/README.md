# TerraAgent — Social Launch & Hackathon Demo Strategy (`social/`)

Reference guide and production package for TerraAgent's **NEAR Hackathon** public X post and demo video, grounded in [`HACKATHON.md`](../HACKATHON.md) and [`README.md`](../README.md).

## Contents of This Folder

| File                                                               | Purpose                                                                                                                                                                     |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`README.md`](./README.md)                                         | Creative format proposal (Live Head vs. Generated vs. Hybrid Trailer), track mapping (`games`, `swarms`, `security` + `agents`), and 100% NEAR & 3D visual coverage matrix. |
| [`x-post-scenario.md`](./x-post-scenario.md)                       | Copy-ready X post scenarios for **both** X Premium (long-form + 4-reply thread) and Standard X (`5/5` tweets strictly `<= 280` chars), built around `HACKATHON.md` §2.      |
| [`demo-video-scenario.md`](./demo-video-scenario.md)               | Complete `2:18` **Hybrid Trailer + Live Founder** storyboard with realistic `~150 WPM` spoken narration, chamfered text-block transitions, webcam cues & `0:58` backup cut. |
| [`production-kit-and-prompts.md`](./production-kit-and-prompts.md) | Verified Production vs. Local tab runbook, live Testnet `curl` proofs, exact `tokens.css` Faction Plate card specs, and screenshot-anchored AI match-cut prompts.           |

---

## 1. Track Strategy (`HACKATHON.md` Alignment)

Per [`HACKATHON.md`](../HACKATHON.md) (§ "Tracks", lines 175–195), there is **one submission per project**, and `tracks` accepts every official ID the project fits while our **narrative concentrates on your three requested pillars**:

| Your Focus Pillar         | Official `HACKATHON.md` Track ID(s)                                   | Official Track Hook in `HACKATHON.md`                                                                                                                                              | Concrete Proof Shown in Video & X Thread                                                                                                                                                                                                                                                                                                                                         |
| ------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Game Economy**       | `games` (_Games With Real Economies_)                                 | _"Build NPCs with wallets, player-owned markets and economies that evolve without a dev patch. Judged on the game loop, not the token — bonus if players never notice the chain."_ | Zero-popup login (`FastAuth` + `pilots.terraagent.testnet` + `NEP-366` gasless `relayer`), `NEP-245` cargo mint/burn (`res.terraagent.testnet`), NPC Guild freighters (`Kestrel`/`Vanguard`) quoting live 24h VWAP power-law spreads, 90-pair `/trade.html` CLOB with **4-way `NEP-413` + `1Click` settlement**, and Day-1 lossless `staking.terraagent.testnet` (`0%` P2W).     |
| **2. AI Swarms**          | `swarms` (_AI Swarms_)                                                | _"Build coordination markets, bidding, collective purchasing, intent-based settlement and emergent economies between agents."_                                                     | **Dual swarm proof on `/dev/economy-sim/`:** (a) **25-agent (`20` buyer `buyer-01..20.swarm.terraagent.testnet` × `5` seller) Zero-LLM uniform-price sealed-bid clearing rounds** with pro-rata allocations & verified zero-sum `NEP-413` batch hashes, plus (b) 3-colony batched `NEAR.AI` (`z-ai/glm-5.3-flash`) TEE sweeps & `{planet}.dao.terraagent.testnet` council votes. |
| **3. "Give AI a Wallet"** | `security` (_AI Security & Defense_) **+** `agents` (_Agent Economy_) | `security`: _"Give AI money without giving it the keys to everything."_<br>`agents`: _"Build agents that earn, spend, negotiate, hire other agents..."_                            | Scoped `AgentWallet` keys (`director-key`, `ta_bot_...`) with ACID daily token caps & 1-click `/v1/trade/kill` switch; contractor **1-round `negotiateAgentQuote` counter-quote negotiation & `AgentTaskReceipt`s**; `bounty.terraagent.testnet` mercenary & `90%/10%` Peace/War bond slashes; `AES-256-GCM` BYOK vault; and live **`HTTP 403 AI_STAKING_FORBIDDEN`** guardrail. |

> **Submission API Track Enum Note:** `HACKATHON.md` line 155 defines exact lowercase track IDs (there is no literal `"give_ai_a_wallet"` string — `"security"` + `"agents"` are the official IDs for that track). Recommended `tracks` array for the single project submission: `["games", "swarms", "security", "agents", "nfts", "privacy", "social", "defi"]`.

---

## 2. Content & Video Format Proposal: Live Head vs. Generated vs. Hybrid Trailer

You asked whether to go **fully generated**, **live with your head on camera**, or **part live + part generated like a trailer showing different in-game situations with text blocks and transitions**.

### Recommendation: **Format A — Hybrid "Gameplay Trailer + Live Founder" (`2:18` / `138 s`)**

| Format Option                                                                             | Judge Trust                                                                                           | Visual Hook (Muted X Autoplay)                                                                                | Rule Compliance (`HACKATHON.md` §2)                                                        | Verdict                                                       |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| **A. Hybrid: Kinetic Trailer Cuts + Live Founder Webcam** _(~30% trailer / ~70% live)_    | **10 / 10** — Real face + uncut browser/terminal clicks prove everything runs live.                   | **10 / 10** — 5 rapid 60 FPS game situations + chamfered Faction Plate text blocks hook scrollers in `< 3 s`. | **10 / 10** — Shows real user action → visible on-chain result while keeping trailer pace. | **WINNER (Recommended)**                                      |
| **B. 100% AI-Generated Trailer** _(pre-rendered video + synth voiceover, zero live UI)_   | **3 / 10** — Judges & builders assume pure AI trailers hide vaporware; wastes our real WebGL2 engine. | **8 / 10** — Flashy for 10s, then feels generic.                                                              | **4 / 10** — Fails _"go from a real user action to a visible result"_.                     | **Avoid for main post** (optional 15s teaser reply only)      |
| **C. 100% Raw Loom Screen-Share** _(2.5 mins of unedited tab-switching with corner head)_ | **9 / 10** — Honest builder feel.                                                                     | **5 / 10** — Loses muted X timeline scrollers before the 3D action even starts.                               | **8 / 10** — Compliant, but packs far fewer gameplay situations into 2 minutes.            | **Too slow on X** (upgrade with trailer intro & text bumpers) |

### Why the `2:18` Hybrid Structure Works

1. **`0:00–0:22` — Trailer Cold Open (5 In-Game Situations + Text Blocks, Muted-Autoplay Ready):**
   - Opens with fast 60 FPS WebGL2 cuts across **5 distinct gameplay situations** (orbital planet morph → atmospheric drop-pod entry → hex terraforming wave & 3D bouncing chunk debris → alien insect swarm siege & 3D lightning strike → Recon raids & Guild freighter) separated by **45°-chamfered Faction Plate text blocks** (`Chakra Petch` uppercase on `#07080A` Void with `#FF6A13` Ignition Orange tags).
   - **How "Part Generated" Blends In Honestly:** Use at most **two `1.5 s` screenshot-anchored AI image-to-video match-cuts** (setting a real TerraAgent screenshot as the AI clip's final keyframe so storm clouds or desert dunes resolve seamlessly into live 60 FPS Three.js gameplay), stamped **`● LIVE BROWSER WEBGL2 · 60 FPS`**.
2. **`0:22–2:02` — Your Live Head (`6 s` Fullscreen → Bottom-Left Chamfered PiP) Driving 3 Track Acts:**
   - **Act II (`games`):** Social login + `NEP-171` Deed → Trade Hub `NEP-245` export → Guild 24h VWAP tooltip → `/trade.html` 4-way `NEP-413` + `1Click` swap & lossless Day-1 staking.
   - **Act III (`security` + `agents`):** Top-right `Colony Book → DIRECTOR` (`AI AUTOPILOT: ON`) → `/me.html` `AES-256-GCM` BYOK vault & soulbound badges → `/trade.html` scoped `ta_bot_...` caps & kill switch → 1-round agent negotiation + `bounty` `90%/10%` slash → live terminal `HTTP/2 403 AI_STAKING_FORBIDDEN`.
   - **Act IV (`swarms`):** Live **FAST-FORWARD 7 DAYS** on `/dev/economy-sim/` showing both **20×5 swarm sealed-bid clearing rounds** and **3-colony `NEAR.AI` Cloud TEE (`z-ai/glm-5.3-flash`) ECDSA-verified directives**, plus `{planet}.dao.terraagent.testnet` & `protocol.terraagent.testnet`.
   - Spoken lines are paced at a natural **`~144 WPM`** (`208` raw words / `~245` spoken-word equivalents across `102 s`) by letting on-screen HUD pills carry full `.terraagent.testnet` contract addresses.
3. **`2:02–2:18` — Trailer Climax + Fullscreen Founder Sign-Off:**
   - Marching robot squad → S10 Ascension Rocket → `11/11` Testnet ports green → fullscreen invite to `terraagent.fun`.

---

## 3. Complete NEAR Tooling Coverage Matrix (All 11 Ports + 6 Contracts + AI/Swarms)

| #   | NEAR Port / Contract / Tool                                                                             | Live Account / Endpoint                                              | Video Slot                                | X Thread |
| --- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------- | -------- |
| 1   | **`Identity` + Cold-Root Factory** (`FastAuth` PKCE, OAuth, `NEP-413` auth, atomic `claimAccount` keys) | `pilots.terraagent.testnet`                                          | Act II (`0:28–0:37`)                      | Post 1/2 |
| 2   | **`Relayer` — Gasless `NEP-366` Meta-Transactions** (`SignedDelegate`, allowlist & deposit cap)         | `relayer.terraagent.testnet`                                         | Act II (`0:28–0:37`)                      | Post 1/2 |
| 3   | **`CargoToken` — `NEP-245` Multi-Token Cargo** (`mt_mint` / `mt_burn`, 10 commodities)                  | `res.terraagent.testnet`                                             | Act II (`0:37–0:46`)                      | Post 1/2 |
| 4   | **`Intents` — `NEP-413` Zero-Sum `token_diff` + Live `1Click` Solver Quotes** (`intents.near` Mainnet)  | `1click.chaindefuser.com/v0/quote` · `/v1/near/intents/quote`        | Act II (`0:46–0:58`)                      | Post 1/2 |
| 5   | **`Staking` — Day-1 Lossless Validator Vault** (`80%/20%` yield split, `0%` P2W, `-50%` trade fees)     | `staking.terraagent.testnet`                                         | Act II (`0:50–0:58`) & Act III (`1:24`)   | Post 2/4 |
| 6   | **`AgentWallet` — Scoped Session/Bot Keys, ACID Token Caps & Kill Switch**                              | `/v1/near/director-key` · `/v1/trade/keys` · `/v1/trade/kill`        | Act III (`1:00–1:14`)                     | Post 1/4 |
| 7   | **Agent Commerce — 1-Round `negotiateAgentQuote` Counter-Quote & `AgentTaskReceipt`s**                  | `agent-commerce.ts` · `/dev/economy-sim/`                            | Act III (`1:14–1:24`) & Act IV (`1:44`)   | Post 4   |
| 8   | **`Escrow` — Mercenary Bounties, Bonded Peace Treaties & `6h` War Bonds** (`90%/10%` slash)             | `bounty.terraagent.testnet`                                          | Act III (`1:14–1:24`)                     | Post 1/4 |
| 9   | **AI Policy Guardrails** (`403 AI_STAKING_FORBIDDEN`, `AW-10` no demolish, `AW-13` human-only bonds)    | `POST /v1/near/stake -H 'x-actor: ai'`                               | Act III (`1:24–1:32`)                     | Post 1/4 |
| 10  | **`LlmProvider` — `NEAR.AI` Cloud TEE (`z-ai/glm-5.3-flash`) + ECDSA Signature + `AES-256-GCM` BYOK**   | `cloud-api.near.ai/v1` · `/v1/signature/{chat_id}` · `/me.html`      | Act III (`1:05`) & Act IV (`1:34–1:50`)   | Post 1/3 |
| 11  | **25-Agent Swarm Coordinator** (`20` buyer × `5` seller `*.swarm.terraagent.testnet` sealed-bid rounds) | `swarm-rounds.ts` · `POST /v1/economy-sim/run`                       | Act IV (`1:34–1:50`)                      | Post 1/3 |
| 12  | **`TreasuryDao` + Self-Funding Protocol** (`>50%` quorum council boosts + 3-inflow/2-outflow loop)      | `dao.terraagent.testnet` · `protocol.terraagent.testnet`             | Act IV (`1:50–2:02`)                      | Post 3/5 |
| 13  | **`DeedNft`, `BadgeNft` & `ChainRead`** (Dynamic `NEP-171` Deeds, soulbound Badges & FastNEAR RPC)      | `deed.terraagent.testnet` · `/deed/deed%3Acol_0` · `/v1/near/status` | Act II (`0:32`), III (`1:05`), V (`2:08`) | Post 2/5 |

---

## 4. Visual Showcase Coverage Matrix

| Visual Highlight                                                                                                       | Capture Surface (See [`production-kit-and-prompts.md`](./production-kit-and-prompts.md) for Live vs. Local) | Video Slot                |
| ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------- |
| **3D Orbital Planet Morphing** (Dune / Ocean / Forest + rings & moons)                                                 | `https://terraagent.fun/landing.html` (`#hero-stage`)                                                       | `0:00–0:01.5`             |
| **Atmospheric Drop-Pod Entry & Hero Deployment** (`DescentRunner`)                                                     | `https://play.terraagent.fun/play.html?planet=oceanForest&deploy=1`                                         | `0:01.5–0:04`             |
| **Hex Terraforming Wave & 3D Ballistic Chunk Particles** (`Grade → Irrigate → Seed → Living`)                          | `?host=local&scenario=w05` (or local `npm run dev` `?scenario=w05`)                                         | `0:04–0:08`               |
| **Alien Chitin Swarm Siege (Ants, Beetles, Acid Spitters) + Recoil/Laser Turrets + 3D Lightning**                      | `playground.terraagent.fun/playground.html?faunaScene=mixed&faunaMode=bugs&biome=dune` + local `w07` (`F8`) | `0:08–0:13`               |
| **Multi-Colony Recon Raids, Orbital Guild Freighter (`ship.guildTrader`) & S10 Ascension Rocket**                      | Local `play.html?scenario=w18` + `playground.terraagent.fun/playground.html?inspect=building.rocket`        | `0:13–0:17` & `2:05–2:08` |
| **Autonomous Shoreline Diorama & Marching Robot Squad** (`28°` telephoto, HDR bloom, GPU step-suspension)              | `terraagent.fun/landing.html#colony` + `playground.html?march=together&biome=forestRock`                    | `0:17–0:22` & `2:02–2:05` |
| **Faction Plate Chamfered Terminals** (`/trade.html`, `/dev/economy-sim/`, `/me.html` 3D badges, `/deed`, `#protocol`) | Live `*.terraagent.fun` + local `:5173`                                                                     | `0:30–2:02` & `2:08–2:10` |

---

## 5. Non-Negotiable `HACKATHON.md` Safety Reminders

1. **Deadline:** Repository **public**, X post **published**, and single API/form application **submitted before `2026-11-14T23:59:00Z`**.
2. **Human Publishes & Confirms:** Per `HACKATHON.md` ("Never without the human's explicit confirmation"), never post on X, make the repo public, sign mainnet transactions, or POST to `https://nearhackathon.com/api/applications` without explicit human confirmation.
3. **Mandatory X Tags:** Must state built at NEAR HACKATHON, tag **`@NEARProtocol`** + **`#NEARHackathon`** (optional `@NearLegion` `@NearBuilders`), and attach the `.mp4` natively on Post 1.
