# Master plan review — fit, track rules and grand-prize odds

> **Status:** 2026-10-31, review of [`../terraagent-master-plan-final.md`](../terraagent-master-plan-final.md) (the "master economy, on-chain, AI orchestrator & monetization plan") against the repo's decisions (`spec/DECISIONS.md` D-16..D-36), the hackathon cut (`HACKATHON_CUT.md`), the wave files, the official track brief and the numbers in [`economy-balance-simulation.md`](./economy-balance-simulation.md).
> **Sources checked today:** nearhackathon.com (prizes, judging, timeline, submission), the organisers' prompt repo `nearai/near-hackathon-prompt-examples` (`tracks/09-games.md`, `07-agents.md`, `05-swarms.md`, `SUBMITTING.md`), auth.near.org, docs.near.ai/cloud/verification.
> **Pass 4 (2026-11-02):** rules, tracks and judges re-checked against nearhackathon.com and https://nearhackathon.com/HACKATHON.md (fetched 2026-11-02); unit numbers moved to the current cut (H = 395 issues, ≈ 299.5 units); repo/LICENSE status, the W26 `terraagent.fun` hosts, tracks 06/03 and the W16-21 dependency added. D-37 is now Accepted as hosting on `main`; **D-MP here is a provisional id** (the W01 wave branch already has Accepted D-37..D-41 with other meanings).

## 1. Verdict

**The plan fits the game and the track; it does not yet fit the repo's plan, and it misses three explicit track-09 requirements.** Its locked decisions are sound (burn treasury costs, no NEAR pairs in the demo, protocol fee), but it labels as "Must" four things the hackathon cut has as stretch or out of scope, it introduces a Fauna Den that duplicates the nests already specified, it names NEAR AI Cloud where D-09 names Z.ai, and its headline demo ("≈ 40 % terraform in 8–12 min") is impossible in real time. With the changes in §5 it becomes a coherent addendum to the cut.

**Odds, honestly.** Prizes: one $55 K grand prize across all 13 tracks, $10 K / 3 K / 2 K per track; Claude Code and Codex screen every project first ("runs and does what the README says"), then seven human judges decide (Illia Polosukhin; Eddy Lazzarin, a16z crypto; Mert Mumtaz, Helius; Avichal Garg, Electric Capital; Kain Warwick, Synthetix & Infinex; Haseeb Qureshi, Dragonfly; Stepan Gershuni, cyber•Fund). A low AI score alone cannot reject a project (HACKATHON.md Q-017). Past NEAR hackathons scored technical implementation, design, impact, originality, sustainability.

| Outcome | Estimate | What moves it |
|---|---|---|
| Passes the AI screen | high, **if** the D13 clean-clone README run is treated as a release gate | every wave's "do X → see Y" steps already exist; the README must match the build on the day |
| Track 09 top 3 | **conditional:** a real contender if F5 + F1 + F2 run on NEAR and the three track requirements in §3 are met; **unlikely** if the demo ships all-mock (a judgement, no competitor data exists yet) | real NEAR on login, cargo and markets; the fast-forward page; a video where prices visibly move because of what players did |
| Track 07 / 05 placement | possible as additional tracks on the same submission if the Guild agents, sub-accounts and a `RULES.md` are explicit | §3.2 |
| **Grand prize** | **low (well under one in ten)**, because the field is 13 tracks wide, the build is solo, and a crypto-investor panel will weigh real on-chain usage and sustainability; it rises only with real NEAR, a striking 3D demo that the judges can click themselves, and a credible revenue line | the hosted demo (`play.terraagent.fun`, W26 / D-37), the X video, real settlement on `intents.near` even for one tiny trade, a monetization table that is not "paid in cargo" (§4.3) |

What TerraAgent has that most entries will not: a real-time 3D world with an economy that is the game, NPC traders with wallets, a treasury vote with a visible planet effect, and a design corpus that already answers most judge questions. What it lacks today: anything running on NEAR, and the time to build it (the `H` set is 395 issues, ≈ 299.5 units in 13 build days, ≥ 2.3 units per agent per day with 12 agents; HACKATHON_CUT header after the D-37 amendment. W00 and W26 have landed on `main` by D2).

## 2. Fit with the repo (conflicts to resolve, in priority order)

| # | Master plan says | Repo says | Resolution (proposed) |
|---|---|---|---|
| C1 | AI Orchestrator (planet control + wild directives) is **Must #5** and calls **NEAR AI Cloud** every 5–15 min with attestation | W16 AI Director is **not in the cut** ("the W08 rule engine and autopilot carry the autonomy"); provider is **Z.ai glm-5.3** (D-09) behind `LlmProviderPort` | Keep W16 out. Planet control (fauna pressure, storms, yield modifier) is three deterministic rules on data rows (§5, change 5). One LLM call type only, the **Guild strategy** (W16-21 hook, hourly; untagged, it depends on W16-07 and fills W15-13's `LlmGuildStrategy` slot, also untagged, so both need retagging and the W16-07 dependency cut), on NEAR AI Cloud (base URL `https://cloud-api.near.ai/v1`, nearbuilders.org/build, fetched 2026-11-01) with the attestation shown in the Guild panel, as **H+** (≈ 3 units) after the D10 gate. NEAR AI Cloud is the hackathon partner and its API is OpenAI-compatible, so it plugs into the existing port; record it as D-MP and keep Z.ai as the fallback adapter |
| C2 | Fauna **Dens**: a new building, waves of 4–12 units at 80–140 HP / 12–22 damage, destroy cost 400 M + 250 Min, max 3 | SIMULATION §7.6 **nests** (1 per ≈ 400 tiles, 1 500 HP, max 6 alive), raids of `2 + threatStage` Skitters at 120 HP / 8 DPS (units spec §6.3, B11), battle v1 | No new building or unit stats. "Habitat pressure" becomes three rows on nests (`angerPerLivingTile`, `spawnModifier`, `maxOnPlanet`); numbers in the balance doc §6. Saves ≈ 2–3 units and one model |
| C3 | Fee control 0–3 % is **Must #3**; one treasury project is **Must #6** | W13-22 fee slider is **H+**; W22 Treasury is **4th in the drop order** | Promote W13-22 to H (½ unit). Keep W22's terraform boost as the one project, with the balance doc's costs (300) and a treasury leg on Guild fills, otherwise the vote never has funds in a demo |
| C4 | Protocol fee 0.25 % to the project account, shown in the settlement toast | No issue exists; W13-12's `registerFeeLeg` extension point takes it | One S issue in W13 (`protocol` leg + toast line + README row). Paid in cargo tokens; see §4.3 |
| C5 | Demo A ends at "≈ 40 % terraform" in 8–12 min | A Living tile costs 28 s of drone time; 40 % of a Hub's 331 tiles is ≈ 65 min from landing (balance doc §3.1, §9.1); W05 already seeds 31 % for this reason | Seed Scenario A at S4 with 20 % and 3 drones, `warp 3` on the terraform beat, 40 % at +30 sim-minutes. Never claim it from a cold landing |
| C6 | "Social login → NEAR Auth (auth.near.org)" is locked | OWNER_TASKS: provider still open, HOT is the listed partner | NEAR Auth checks out (Google / Apple / email / passkeys via Auth0, real named accounts, NEP-366 relayer, React and JS SDKs, docs.auth.near.org). **Mainnet is whitelisted on application and testnet is free; X login is not offered.** Apply for mainnet now (sent or not is unknown on D2); keep the custodial fallback (OWNER_TASKS) |
| C7 | Guild trades "resource-for-resource only, minimal NEAR float unused" | Q1 in the economy summary; W15-02 has a 5 NEAR float cap | Agreed; also means the "open cargo" story (D-26) is not demonstrable in the hackathon. Say so |
| C8 | Daily mint cap 20 000 | W10-06 default 20 000 | Keep the row, change the default to **10 000** and add the Guild off-planet sink (balance doc §7) |
| C9 | "This document is the single source of truth" | DECISIONS.md is the source of truth; the file sits loose in `docs/` | Move to `docs/plan/MASTER_PLAN.md`, add a D-MP entry with the locked decisions, index it in `docs/README.md`. Do not keep two sources of truth |
| C10 | Hackathon window "2026-11-01 → 2026-11-14" | same (development ends 2026-11-14T23:59Z); judging starts 2026-11-16T00:00Z, results by 2026-11-18T23:59Z (HACKATHON.md) | Add judging dates and the Nov 14 20:00 UTC internal submit time (HACKATHON_CUT) |

Smaller inconsistencies: Scenario A says "Guild fees earned" (stall fees go to players, the Guild earns spread); the orchestrator prompt's `global_yield_modifier` and `disaster` have no sim consumer in the cut (storms and meteors are W05 deferred rows); "Terraform %" of the planet is undefined (balance doc §4.3 proposes Σ Living ÷ Σ owned).

## 3. Fit with the track rules

### 3.1 Track 09 "Games With Real Economies" (the official brief)

| Requirement (verbatim intent) | Plan / repo today | Gap |
|---|---|---|
| NEP-245 multi token, one contract for every item | F1, `res.terraagent.near`, 10 token ids | none (mock in phase 1, real after D10) |
| Social or email sign-in only; no seed phrases, wallet popups or gas prompts | F5, NEAR Auth, relayer | none if F5 goes real; a mock login is fine for the screen but weak for judges |
| NPC merchants with their own wallets and inventories, prices from stock and demand | F3 Guild, `mid = ref × (target/inventory)^k` | none; add the reason string |
| **Merchant pricing rules in one readable file, and each merchant's reasoning in a tooltip** | pricing core W15-06 (code) + data W15-02 (file) + a README paragraph (W15-32, untagged) | **missing:** one `GUILD_PRICING.md` / `data/guild.ts` with the rule, and `reason` on every offer ("inventory 2.1× target, 24 h VWAP 0.92 → bid −48 %") in the Guild tab tooltip. ≈ 1 unit |
| **Fast-forward: simulate a week of trading in about a minute** | `warp 100` (100 min for a week) | **missing:** the aggregate economy fast-forward page (balance doc §9.3). ≈ 1.5 units; it is also the AI-Swarms "simulation mode" |
| Economy changes over time without a developer patch | Guild pricing, treasury votes | needs the Guild sink and T2 restock rows or the economy freezes on day 1 (balance doc §7) |
| **Before any code: the game loop on paper at 30 s / 5 min / session** | not in the plan | **missing:** written now in the balance doc §2; copy it into the README |
| Judged on the game loop, bonus if players never notice the chain | the whole design | none |

### 3.2 Tracks 07 and 05 (additional tracks, same submission)

Track 07 asks for agents that negotiate (one counteroffer with reasoning), pay through NEAR Intents, keep **one receipt per task**, and a checkpoint that explains key custody and what the agent cannot do without approval. The director key with allowance (F4) plus the contract toasts cover most of it; a "counteroffer" is one more Guild interaction (the Guild re-quotes once when a player bids inside the spread). Track 05 asks for per-agent sub-accounts (specified: `guild-N.npc.*`, W15 on mocks; real only with W23-26, untagged), a coordinator (the market module), **`RULES.md` before code**, a **scripted simulation mode with no LLM calls** (the fast-forward), and a live page (the price board). Writing `RULES.md` and the fast-forward page serves three tracks for ≈ 2 units. Note that the director key's allowance is gas-only NEAR (R06-64/65): the "what the agent cannot do" limits are server-enforced, so say so in the custody checkpoint.

### 3.2a Tracks 06 and 03 (not yet considered; Proposed)

The review did not cover two tracks that touch what the plan already has. **06 `security` (AI Security & Defense)**: "spending limits, policy engines, sandboxed wallets, reputation and scam detection"; hints AGENT SECURITY, FUNCTION CALL KEYS, TEE ATTESTATION. The director key with allowance and revoke, the relayer allow-list and the Guild kill switch are the material; an owner-signed Agent Connect policy (see [`near/09-parallel-near-lane.md`](./near/09-parallel-near-lane.md) A7) would make it a policy engine. **03 `privacy` (Privacy & Private AI)**: hints PRIVATE AI, TEE, NEAR AI CLOUD; fits only if the attested Guild call (change 7) is green. Both cost nothing extra to tick if the features ship; whether to enter them is the owner's call (multiple tracks per project are allowed, HACKATHON.md).

### 3.3 Submission mechanics

Repo public by 2026-11-14T23:59Z (it may stay private while building; HACKATHON.md "Start here" 2) with a LICENSE file (Q-014); **status D2:** the repo is already public (`gh repo view`, 2026-11-02) and an MIT LICENSE is at the root (commit 31a302e, 2026-10-30). No secrets in the history, an X post that says "built at NEAR HACKATHON", tags `@NEARProtocol` and `#NEARHackathon` and has the video, a mainnet payout account, one submission per project (a second independent project is allowed only if each README names the other; at most two per person, Q-015). Baseline: code written since the **2026-10-19 announcement** counts (Q-001) and earlier commits are baseline; a reused project separates new work by a branch or tags `pre-hackathon` / `hackathon-submission` plus a README section linking the diff (Q-003). The repo's first commit is 2026-10-29 and no such tag exists yet (tags: `wave-00`, `wave-26`), so which code is "pre-window baseline" is an owner question. The README is read by an AI first: every claim must be a runnable step.

## 4. Economy and monetization (what the numbers say)

The full tables are in the balance doc; the parts that change the plan:

### 4.1 Progression

| Milestone | Spec target | Simulated (solo) | Simulated (trader) | Proposed fix |
|---|---|---|---|---|
| S4 | 15 min | 25 min | 26 min | accept |
| S5 (Hub T2) | 25 min | **62–78 min** | **53–60 min** (old inputs) · ≈ 45–48 min with the W01 kit and terrain mix (Balance §5.1) | T2 gate as a count (100 Living tiles) and Hub T2 at 25 % T2 → **≈ 53 min solo on the 2026-10-31 inputs, ≈ 45 min on the current ones (Balance §5.1)** |
| Terraform 30 % | — | 43 min (no beacons) to 70 min (two beacons) | | the gate must not punish expansion |
| 70 % | — | 103–125 min; 65 min with the Processor at 0.5 | | Processor 0.3 tiles/s → 70 % at ≈ 103 min, 50 min after S5 (2026-10-31 inputs only; with the current inputs 0.3 misses 70 % within 150 min, Balance §4.4, §5.1) |

### 4.2 The three traps a new player hits (fix before the demo, all data rows)

1. **Minerals:** the R11 kit (400 / 250 / 150 / 150) leaves 10 minerals after Hub + Solar + Extractor + Quarry + Worker Drone T1; one wrong order stalls the colony. Kit 400 / 300 / 200 / 150. *Pass 4:* the W01 code and W01-09 already start the player at 600 / 350 / 200 / 200 (units spec §6.4), which removes this dead-end; which kit ships is Q-02-19 (Balance §10 Q7).
2. **Biomass:** no income until a Worker Drone T1 clears forest (5 per tile); the Factory, turrets and DCA each need 10–30. Clear yield 25, Worker Drone T1 on Living ground +0.5/s.
3. **Shared family caps:** biomass fills the Bio cap and stops water; a full Metals cap discards the T2 iron the player just unlocked. Caps per sub-resource.

### 4.3 Monetization

The protocol fee is **paid in cargo tokens**. Until a NEAR/USDC pair exists (Later; the plan itself keeps NEAR pairs out of the demo) the project account accumulates iron, not NEAR. Per planet-week at the proposed caps: ≈ 2 500 units of protocol fee, ≈ 2 400 of stall fees to players, ≈ 600 to the treasury (balance doc §7.3). Show the line in the toast, state in the README that it has no NEAR value yet, and keep "premium order slots / priority Guild visits / skins" as the post-hackathon revenue story. A judge who asks "how does this make money" should hear the fee *mechanism* and the *future* NEAR pair, not a number.

### 4.4 Treasury

At 1 % × 20 % a planet funds one 1 000-unit project a week. For a demo vote that passes and visibly changes the sim: project cost 300, a 0.2 % treasury leg on Guild fills, and a seeded balance in the scenario.

## 5. Changes, ranked (unit costs from HACKATHON_CUT §3; each is funded by a named drop)

| # | Change | Units | Funded by | Why |
|---|---|---|---|---|
| 1 | **Track-09 compliance pack:** `GUILD_PRICING.md` + reason tooltip (W15), economy fast-forward dev page (W15 / W13), paper loop in the README, `RULES.md` | ≈ 3 | W11 Lobby (11.5, already drop #2) | three explicit requirements, three tracks |
| 2 | **Start the real-NEAR swap on D6, not after the D10 gate,** for F5 (NEAR Auth) → F1 → F2 (`dry: true` first, one tiny mainnet trade) | 0 extra (the H2 rows exist) | the two "extra agents" of the gate, earlier | all-mock is the single biggest risk for a crypto panel |
| 3 | Fee slider to H; protocol-fee leg + toast line | 1 | W04 click-to-fly rows (H+) | the plan's Must #3 and #7 |
| 4 | **Balance rows from the simulation** (kit, Clear yield, per-sub caps, capacitor size, T2 gate as a Living-tile count, Hub T2 at 25 % T2, Processor 0.3, Well at S4, mint cap 10 k, Guild cap 10 k / target 3 k, 10 % off-planet sink per visit, T2 restock, `k` = 1, offset schedule, treasury costs) | 0 (W00-59 overrides) | — | fixes the three traps and the day-1 price freeze; simulated together as R7 / R8 |
| 5 | **Habitat pressure as nest rows**, no Den building; orchestrator "planet control" as rules | −2 (saves) | — | C2 |
| 6 | **Demo scenarios seeded at S4** with explicit `warp` factors (balance doc §9) | 0 | — | C5 |
| 7 | Guild strategy on **NEAR AI Cloud with attestation** shown in the Guild panel, H+ after D10; Z.ai stays the fallback | ≈ 3 | H+ budget | partner tech, differentiator for 07/05; not on the critical path |
| 8 | Treasury: one project (boost) with the §4.4 numbers; treasury leg on Guild fills; seeded balance | 0.5 | inside W22 | the plan's Must #6 |
| 9 | Move the plan to `docs/plan/MASTER_PLAN.md`, record D-MP, index it | 0 | — | C9 |
| 10 | README monetization honesty (§4.3) and the mock/real table | 0 | inside W25 | the AI screen checks claims |

Not recommended: Badge NFTs, extra treasury projects, den polish, NEAR pairs, cross-planet carry. They are listed as stretch in the plan and the units are better spent on changes 1–3.

## 6. What to keep from the plan as written

Trust boundary (server mints, chain settles); burn as the treasury sink; resource-for-resource Guild; `{colony}.{name}.terraagent.near` accounts with restricted Guild keys and a relayer allow-list; the three demo scenarios as *beats* (with seeds and warps); the achievement list (it matches the profile spec's 20 families); the Deed as a mock card; the day-10 gate as a *reporting* checkpoint (not as the start of real NEAR).

## 7. Risks the plan does not name

| Risk | Impact | Mitigation |
|---|---|---|
| Real NEAR arrives late or not at all | judges see a mock game with chain words in the README | change 2; the README mock/real table; one real mainnet trade recorded in the video |
| The economy freezes on day 1 of the hosted demo (Guild full, prices at the full-Guild price 0.5; Balance §7) | "evolves without a patch" is visibly false | the Guild sink and restock rows; the fast-forward page shows the week |
| New judges land in the minerals or biomass trap in the first 5 minutes | the AI screen fails or the human judge quits | change 4; a Hub suggestion card for the first four builds |
| The 3D prototype may predate the window | eligibility questions | the window counts from the 2026-10-19 announcement (Q-001) and the repo starts 2026-10-29; disclose what predates it as baseline and tag it (`pre-hackathon`, Q-003); the owner confirms what that is |
| The hosted demo is plain HTTP (D-37: port 80, no TLS in this phase) | unverified whether NEAR Auth / social login accepts an `http://` origin; the demo URL is `http://` | Gap: check with NEAR Auth before D6; TLS is a deferred W25/W26 row |
| NEAR Auth mainnet whitelist not granted in time | real F5 falls back to custodial accounts | apply now (on D2 whether the application was sent is unknown, Pivot §8); the fallback is designed |
| NEAR AI Cloud attestation claims | "verifiable AI" is a vendor claim until the signature is checked in-app | show the signature check result in the Guild panel, or do not call it verifiable |
