# TerraAgent — X (Twitter) Demo Post & Thread Scenario

Built strictly against [`HACKATHON.md`](../HACKATHON.md) §2 (**"The demo post"**, lines 107–119) to hit every judge rubric item while concentrating on **Game Economy (`games`)**, **AI Swarms (`swarms`)**, and **Give AI a Wallet (`security` + `agents`)**.

---

## 1. `HACKATHON.md` §2 Compliance Check (Built Into Both Premium & Standard Threads)

- [x] **Explicitly states** the project was built at **NEAR HACKATHON**.
- [x] **Mandatory tags included:** `@NEARProtocol` and `#NEARHackathon` (plus `@NearLegion` & `@NearBuilders`).
- [x] **Line 1 leads with the user problem** (immediately clear to someone who has never seen TerraAgent).
- [x] **Shows one complete user-action-to-result moment** (drop pod → export `NEP-245` cargo → 4-way `NEP-413` + `1Click` swap → toggle `AI AUTOPILOT: ON` → 7-day 25-agent swarm & contractor simulation).
- [x] **Explains NEAR's concrete role** (gasless `NEP-366` relayer, cold-root `pilots` factory, `NEP-245` cargo, `NEP-413` + `1Click` settlement, attested `NEAR.AI` Cloud TEE inference, scoped `AgentWallet` caps, 1-round agent counter-quote negotiation, `bounty` escrows, `dao` & `staking` — zero vague _"powered by NEAR"_).
- [x] **Gives a clear next step:** zero-install live play URL, public GitHub repo URL, and a genuine specific question inviting feedback.
- [x] **Native `.mp4` attached directly to Post 1** (`1920x1080`, `60 FPS`, **`2:18` (`138 s`)** — safely under X's universal `2:20` video cap on both Standard and X Premium accounts).

> **Repo URL Placeholder:** Replace `<YOUR_PUBLIC_GITHUB_REPO_URL>` with your confirmed public GitHub repository URL (e.g. `https://github.com/recferret-bit/terraagent` once made public and verified `200 OK` in an Incognito window before `2026-11-14T23:59:00Z`).

---

## 2. Option A — X Premium Long-Form Main Post + 4 Track Deep-Dive Replies _(Recommended With X Premium)_

### Post 1 / 5 — Main Submission Post _(Use THIS URL as `demoUrl` in the Hackathon Submission)_

**Attach Media:** Full `2:18` Hybrid Demo Video (`terraagent-demo.mp4`) with `0:00` thumbnail showing the 3D coastal colony + chamfered text **`WHAT HAPPENS WHEN YOU CLOSE THE TAB?`**

```text
Strategy games freeze the second you close the browser tab—and giving autonomous AI agents a raw wallet usually means risking your entire balance.

At #NEARHackathon, we built TerraAgent: a real-time 3D colony RTS where humans and AI swarms mine, terraform, wage war, and trade 24/7 with zero wallet popups.

What @NEARProtocol + NEAR.AI concretely enable (11/11 ports & 6 Rust contracts live on Testnet):
• Invisible Game Economy (`games`): FastAuth + cold-root sub-accounts (`pilots`) + gasless NEP-366 meta-txs (`relayer`) + evolving NEP-171 Deeds & Badges (`deed`). Export mined ore into NEP-245 cargo (`res`) and settle 4-way swaps via counter-signed NEP-413 `token_diff` intents + live NEAR Intents 1Click solver quotes.
• Safe Agent Wallets (`security` + `agents`): Scoped `director-key` & `ta_bot_...` keys enforce ACID daily token caps and a 1-click `/v1/trade/kill` switch. Agents run 1-round counter-quote negotiations (`AgentTaskReceipt`), hire defense via `bounty` escrows (`90%/10%` Peace/War bond slashing), and hit hard guardrails (`403 AI_STAKING_FORBIDDEN`).
• Verifiable AI Swarms (`swarms`): 20 buyer × 5 seller sub-accounts (`*.swarm.terraagent.testnet`) clear uniform-price sealed-bid batches alongside hardware-attested NEAR AI Cloud TEE sweeps (`z-ai/glm-5.3-flash`, ECDSA `/v1/signature/{chat_id}` + encrypted BYOK vault), funding Planet Council DAOs (`dao`) & lossless Day-1 staking (`staking`).

Play live in browser (zero install): https://play.terraagent.fun/play.html?planet=oceanForest&deploy=1
7-Day Swarm & Agent Sim: https://play.terraagent.fun/dev/economy-sim/
Public Repo & 6 Rust Contracts: <YOUR_PUBLIC_GITHUB_REPO_URL>

Question for builders & players: when you go offline overnight, would you let your AI Director declare a 6-hour Bonded War—or lock it strictly to peaceful trading and defense?

cc @NearBuilders @NearLegion
```

### Post 2 / 5 — Pillar 1: Games With Real Economies (`games` Track)

**Attach Media:** `12s` 60 FPS clip: Trade Hub `NEP-245` export → hovering `Kestrel` Guild 24h VWAP tooltip → `/trade.html` 4-way settlement & staker `-50%` fee badge.

```text
1/4 Track Deep-Dive — Games With Real Economies (`games`)

In TerraAgent, the economy IS the RTS loop—with zero inflationary reward tokens and zero MetaMask popups:

• Biome scarcity (Dune solar vs Ocean water vs Forest ore) forces inter-colony trade every 5 minutes.
• Exporting at your Trade Hub calls `mt_mint` on our NEP-245 Rust contract (`res.terraagent.testnet`).
• Scheduled NPC Guild freighters (`Kestrel` & `Vanguard`) price spreads dynamically off 24h organic player VWAP—never static studio spreadsheets.
• Every `/trade.html` fill settles 4 ways via NEP-413 zero-sum intents + NEAR Intents 1Click quotes (`Q-007` Mainnet `intents.near` ready): 100% Seller + 0–1% Trade Hub Stall Royalty + 20% Planet DAO + 80% Protocol.
• Claimed pilots stake NEAR from Day 1 (`staking.terraagent.testnet`, 0% combat P2W): keep 100% principal + 7.2% net APY, while 20% yield unlocks Managed NEAR.AI Autopilot + 50% off trade fees.

Live 90-pair CLOB: https://play.terraagent.fun/trade.html
```

### Post 3 / 5 — Pillar 2: AI Swarms & Private TEE Coordination (`swarms` + `privacy` + `social`)

**Attach Media:** `15s` clip clicking **FAST-FORWARD 7 DAYS** on `/dev/economy-sim/`, scrolling from the 25-agent sealed-bid clearing rounds to the green `NEAR.AI TEE ECDSA VERIFIED` badge.

```text
2/4 Track Deep-Dive — AI Swarms (`swarms` + `privacy` + `social`)

We coordinate two layers of multi-agent swarms on one shared planet:

• 25-Agent Sealed-Bid Clearing (`swarm-rounds.ts`): 20 buyer sub-accounts (`buyer-01..20.swarm.terraagent.testnet` across terraformer, industrial, shield & arb cohorts) + 5 colony/Guild sellers submit sealed bids & asks, clearing at a uniform price with pro-rata payouts and verified zero-sum NEP-413 batch hashes (zero LLM calls).
• Attested Colony Directors: Every 180s (with a 120s digest cache so idle bases burn 0 tokens), planet sweeps run on NEAR AI Cloud (`z-ai/glm-5.3-flash`) inside hardware TEEs verified via `/v1/signature/{chat_id}` ECDSA signatures.
• Shared Governance: 20% of platform fees fund `{planet}.dao.terraagent.testnet` (`dao.terraagent.testnet`), where colonies vote (>50% quorum) on `meteor_shield`, `terraform_boost`, and `guild_subsidy`.

Run the 7-day sim: https://play.terraagent.fun/dev/economy-sim/
```

### Post 4 / 5 — Pillar 3: Give AI a Wallet Safely (`security` + `agents`)

**Attach Media:** Split visual — Left: `/me.html` (`AES-256-GCM` BYOK vault + soulbound 3D badges) & `/trade.html` `ta_bot_...` kill switch; Right: contractor 1-round negotiation receipt + terminal `HTTP/2 403 AI_STAKING_FORBIDDEN`.

```text
3/4 Track Deep-Dive — Give AI a Wallet Without Getting Drained (`security` + `agents`)

Native NEAR Function Call keys cap gas—not NEP-245 token amounts. So we sandboxed agent spending & commerce across 4 layers:

1. Scoped Keys & ACID Caps: `director-key` and `ta_bot_...` bot keys enforce method allowlists, daily per-token spend ceilings (`NEAR_ALLOWANCE_EXHAUSTED`), and a 1-click `/v1/trade/kill` halt.
2. 1-Round Agent Negotiation & Escrows: Colony contractors (`agent-commerce.ts`) decompose goals within strict USDC/NEAR budgets, counter overpriced asks once against VWAP before walking away, hire defense via `bounty.terraagent.testnet`, and emit verifiable `AgentTaskReceipt`s.
3. Bonded Diplomacy & Policy Engine: Humans lock Peace Treaties or 6h War Bonds (`90%` defender slash on stall/betrayal). AI gets `403 AI_STAKING_FORBIDDEN` on staking, cannot demolish (`AW-10`) or break truces (`AW-13`), and yields instantly on manual input (`intentRevision`).
4. Self-Custody & BYOK: `claimAccount` rotates `[AddKey(user), DeleteKey(custodial)]` atomically; `/me.html` encrypts BYOK NEAR.AI keys with `AES-256-GCM`.
```

### Post 5 / 5 — On-Chain Receipts, 3D Playground & Open-Source Repo

**Attach Media:** `2x2` grid: (1) Dune chitin swarm siege in `playground.html`, (2) Soulbound NEP-171 Deed card `/deed/deed%3Acol_0`, (3) `/landing.html#protocol` self-funding schematic, (4) `/v1/near/status` `11/11` Testnet JSON.

```text
4/4 Verify Everything On-Chain & In Browser (Zero Slides-Only Claims)

All 6 custom Rust `near-sdk 5.7` contracts (85/85 tests) + FastNEAR `ChainRead` RPC are live on NEAR Testnet:
• `res.terraagent.testnet` (NEP-245 Cargo)
• `deed.terraagent.testnet` (Soulbound Dynamic NEP-171 Deeds & Achievement Badges)
• `bounty.terraagent.testnet` (Mercenary, Peace & 6h War Escrows)
• `staking.terraagent.testnet` (Day-1 Lossless Validator Vault)
• `dao.terraagent.testnet` (Planet Council Treasury DAO)
• `pilots.terraagent.testnet` (Cold-Root Sub-Account Factory)
+ `protocol.terraagent.testnet` & `relayer.terraagent.testnet`

Live 11/11 Port Status: https://api.terraagent.fun/v1/near/status
3D Fauna & Kitbash Turntable: https://playground.terraagent.fun/playground.html?faunaScene=mixed&faunaMode=bugs&biome=dune
Landing & Protocol Loop: https://terraagent.fun
Public Repo: <YOUR_PUBLIC_GITHUB_REPO_URL>

Built at #NEARHackathon with @NEARProtocol — drop a robot and tell us what strategy broke or surprised you!
```

---

## 3. Option B — Standard X Thread _(No X Premium Needed: ALL 5 Tweets Individually `<= 280` Chars!)_

> **Why this matters:** Standard (non-Premium) X accounts enforce the **`280`-character limit on EVERY reply tweet in a thread**, not only Post 1 (`t.co` counts each URL as `23` chars). Every single tweet `1/5`–`5/5` below is verified `<= 272` X-weighted chars so the entire thread posts cleanly without X Premium!

### Standard Tweet 1 / 5 _(Attach `2:18` `terraagent-demo.mp4` — Use THIS URL as `demoUrl`)_

```text
RTS games freeze when you close the tab—and raw wallets let AI drain you.

Built at #NEARHackathon: TerraAgent, a 3D RTS on @NEARProtocol where NEAR.AI swarms trade NEP-245 cargo via Intents in capped wallets.

https://terraagent.fun
<YOUR_PUBLIC_GITHUB_REPO_URL>
Let AI raid?
```

### Standard Tweet 2 / 5 — Game Economy (`games`)

```text
1/4 Game Economy (`games`): Zero seed phrases or gas popups.

`pilots` + NEP-366 `relayer` onboard players invisibly & mint NEP-171 Deeds (`deed`). Export NEP-245 ore (`res`), cross NPC Guild VWAP spreads, & clear 4-way NEP-413 + 1Click swaps:
https://play.terraagent.fun/trade.html
```

### Standard Tweet 3 / 5 — AI Swarms (`swarms` + `privacy` + `social`)

```text
2/4 AI Swarms (`swarms`): 20 buyer × 5 seller `*.swarm.terraagent.testnet` sub-accounts clear sealed-bid NEP-413 batches, while NEAR.AI TEE (`z-ai/glm-5.3-flash`, ECDSA attested) sweeps colonies & funds `{planet}.dao` public goods:
https://play.terraagent.fun/dev/economy-sim/
```

### Standard Tweet 4 / 5 — Give AI a Wallet (`security` + `agents`)

```text
3/4 Safe Agent Wallets (`security` + `agents`): Scoped `director-key` & `ta_bot` keys enforce ACID daily caps + `/v1/trade/kill`. Agents counter-quote once (`AgentTaskReceipt`), hire `bounty` escrows (90% war-bond slash), & block AI staking (`403`) + AES-256-GCM BYOK.
```

### Standard Tweet 5 / 5 — 6 Rust Contracts & 3D Visuals

```text
4/4 All 6 Rust `near-sdk 5.7` contracts (`res`, `deed` + Badges, `bounty`, `staking` Day-1 0% P2W, `dao`, `pilots`) + `protocol` & FastNEAR `ChainRead` run 11/11 live on Testnet!

https://api.terraagent.fun/v1/near/status
https://playground.terraagent.fun
cc @NearBuilders @NearLegion
```

---

## 4. Option C — "Give AI a Wallet" Narrative-First Single Long Post _(X Premium Alternative)_

```text
What happens if you give rival AI colonies & 25 swarm sub-accounts real NEAR wallets, scarce resources, and weapons on one shared 3D planet—then close your browser tab?

For #NEARHackathon, we built TerraAgent on @NEARProtocol + NEAR.AI to find out (live right now, zero wallet popups):

1. Game Economy (`games`): Mine hex veins in 60 FPS WebGL2, export NEP-245 cargo (`res.terraagent.testnet`), cross NPC Guild 24h VWAP spreads, and settle 4-way swaps via counter-signed NEP-413 `token_diff` intents + NEAR Intents 1Click quotes—sponsored gaslessly via NEP-366 (`relayer.terraagent.testnet`).
2. Give AI a Wallet Safely (`security` + `agents`): Scoped `director-key` & `ta_bot_...` keys enforce ACID daily token caps & 1-click `/v1/trade/kill`; contractors execute 1-round counter-quote negotiations (`AgentTaskReceipt`); `bounty.terraagent.testnet` slashes 90% of stalled/betrayed Peace & 6h War Bonds; AI staking returns `403 AI_STAKING_FORBIDDEN`.
3. AI Swarms (`swarms`): 20×5 `*.swarm.terraagent.testnet` sealed-bid clearing rounds + hardware-attested NEAR AI Cloud TEE (`z-ai/glm-5.3-flash`, `/v1/signature/{chat_id}` + `AES-256-GCM` BYOK), dynamic NEP-171 Deeds & Badges (`deed`), cold-root `pilots`, `{planet}.dao` councils, and lossless Day-1 `staking`.

Drop a robot (0 install): https://play.terraagent.fun/play.html?planet=oceanForest&deploy=1
Fast-forward 7 days: https://play.terraagent.fun/dev/economy-sim/
Repo: <YOUR_PUBLIC_GITHUB_REPO_URL>

If your colony's AI Director spots an unshielded neighbor while you sleep, what guardrail rule should decide whether it trades or raids? @NearBuilders @NearLegion
```

---

## 5. Pre-Publish X Checklist (5 Minutes Before Posting)

1. **Pick Option A/C (X Premium) or Option B (Standard X `<= 280` chars/tweet):** Both use the same `2:18` `.mp4` (`< 2:20` universal X cap).
2. **Verify Public Repo (`200 OK`):** Open `<YOUR_PUBLIC_GITHUB_REPO_URL>` in an **Incognito window** before posting (`HACKATHON.md` §1).
3. **Verify Live Links:** Click `https://play.terraagent.fun/play.html?planet=oceanForest&deploy=1`, `https://play.terraagent.fun/dev/economy-sim/`, and `https://api.terraagent.fun/v1/near/status`.
4. **Add Video Alt-Text:** `"2:18 hybrid gameplay trailer and live founder demo of TerraAgent, a 3D colony RTS on NEAR Protocol and NEAR.AI with 6 Rust contracts on Testnet."`
5. **Copy Post 1 Status Link:** Paste `https://x.com/<handle>/status/<id>` as `demoUrl` in the single hackathon submission payload after confirming all fields.
