# Grand-prize pivot — "a planet where agents are citizens"

> **Status:** 2026-10-31, strategy memo. Bold on purpose: the owner asked for the risky version. It builds on [`MASTER_PLAN_REVIEW.md`](./MASTER_PLAN_REVIEW.md) (conflicts, track rules) and [`economy-balance-simulation.md`](./economy-balance-simulation.md) (numbers). Nothing here is decided; it proposes D-MP/D-PIVOT for the owner. Pass 4 (2026-11-02): unit numbers moved to the current cut (H = 395 issues, ≈ 299.5 units after the D-37 amendment), W07 trim corrected, Nov 1 checklist marked from evidence, tracks 06/03 and the partner tools (Agent Connect, OutLayer, Agent Market) added as options, hosted demo named on the W26 hosts. **The ids D-MP/D-PIVOT are provisional:** the W01 wave branch (`wave/w01-landfall`) already has Accepted D-37..D-41 with other meanings (placement, world generation, landing planner, hosting, root layout), so take the next free id when recording.

## 1. Thesis

The grand prize is one award across 13 tracks, decided by Illia Polosukhin and six judges from crypto funds and infrastructure companies (a16z crypto, Helius, Electric Capital, Synthetix & Infinex, Dragonfly, cyber•Fund; nearhackathon.com, fetched 2026-11-02) after Claude Code and Codex have checked that the README runs. Investors pick **protocol theses**, not product features. A colony builder with a mocked token is a feature. **A live planet where AI agents hold wallets, trade on NEAR Intents, vote in a treasury and are provably fair, and where the judges' own agents can land and play, is a thesis**: NEAR as the chain where agents transact. TerraAgent already has every primitive on paper (colony sub-accounts, restricted keys with allowances, Guild agents, the director key, autoTrade limits, a command protocol). The pivot wires them into one claim and puts it on a planet that is **running during judging**.

One sentence for the description field: *"TerraAgent is a 3D colony game where every player, NPC and director is an agent with a NEAR wallet; AI agents founded the first colonies, trade on NEAR Intents, vote in a planet DAO, and the merchants' reasoning is verified in a TEE. Humans never see the chain."*

Tension to state openly: track 09 is "judged on the game loop, not the token", so the game must stay a game. The pivot adds agents and real value to the loop; it does not replace the loop with a token.

## 2. The three bets

### Bet A — Agents are first-class players (tracks 09, 07, 05)

**What.** A Colony Agent API and an MCP server (`npx terraagent-mcp`) over the existing command stream: `foundColony` (a named sub-account with custodial keys, as F5 already does for humans; seats come from the W01-05 dev-seat flow, which fills `pl_dev`, then creates `pl_dev_2`, so no lobby is needed), `brief` (the ≤ 1 200-char colony brief the AI director spec already defines), `queue` (construction / units / terraform orders), `placeOrder` / `acceptGuildOffer` / `counterOffer` (intents under the director allowance; the Guild re-quotes once when a bid lands inside its spread, which is the 07 brief's "one counteroffer with reasoning"), `vote`, `receipts` (one per trade, as the 07 brief asks). Plus `RULES.md` (the 05 brief asks for it before code), two scripted reference agents, and a README in two steps: **step 1 is local and offline** (`npm run dev`, then a scripted agent founds a colony against `?host=local` and the screener sees it build); **step 2 is "point your own agent at the MCP of the live sector"**. The screen must never depend on the hosted planet or on the screener's sandbox having network.

**Why it wins.** The screeners are Claude Code and Codex. Step 1 proves the loop in their sandbox; step 2 makes their own agent a colonist on the live sector, so the judges open planets that already have their colonies on them. Track 07's brief is this agent almost verbatim (keys under an allowance, what it cannot do without approval, one receipt per task). Track 05's brief is the Guild plus a `RULES.md`, a no-LLM simulation mode (the economy fast-forward) and a live page (the price board). One build, three entries.

**Cost.** ≈ 9 units: API module over existing commands (3), MCP package + docs (2), two scripted agents and a seed script (2), the Guild counteroffer (W15-07, today H+ "re-quote within 1 s after a Guild fill", promoted to H + one counteroffer rule, 1), `RULES.md` + README path (1).

**Options (Proposed, not costed).** (a) Give each agent colony an **Agent Connect** account (NEAR Intents Agent API) whose owner-signed policy (per-tx/day limits, owner approval, freeze, revocable grant) is the "what the agent cannot do without approval" checkpoint of track 07 and the "policy engine" of track 06; caveats: every SDK example is NEP-141 and NEP-245 is never mentioned (cargo support unknown), the default `api.agentsonintents.com` "runs on mainnet with real funds" while nearbuilders.org/build lists `api.demo.agentsonintents.com` (2026-11-01), and the SDK "requires Node.js 24+" while OWNER_TASKS lists Node 22 (github.com/NEAR-Intents-Agent-API/sdk-typescript, fetched 2026-11-02). Design and the probe are owned by [`near/09-parallel-near-lane.md`](./near/09-parallel-near-lane.md) A1, A7, L6. (b) List one reference agent on **Agent Market** (market.near.ai; https://docs.market.near.ai/list-your-agent, fetched 2026-11-02: self-hosted listing with a price per hire and a delivery SLA, payment held until the job is accepted, an MCP endpoint `https://market.near.ai/mcp`) for visibility; it is a marketplace for agents hired by the job, so the fit for a game-playing agent is weak.

### Bet B — Real value, small and bounded (tracks 09, 01, 08)

**What.** Reverse the plan's "no NEAR pairs" for one pair per T1 family (`metals.t1/NEAR`, `minerals.t1/NEAR`, `bio.water/NEAR`) on `intents.near`, the Guild funded with a real but capped float, and the protocol fee as a **NEAR** line in the settlement toast. Real adapters go live in the order F5 → F1 → F2 from day 6, not after a day-10 gate.

**Why it wins.** Prices that mean something are what "the economy is the gameplay" looks like to an investor; a fee line in NEAR is a sustainability answer that is not "paid in cargo". One tiny mainnet trade recorded in the video beats any mock.

**Brakes (the risky part, with numbers).** D-25 means farm bots can play for value and the Guild is the only NEAR buyer, so the **Guild float is the loss limit: 5 NEAR per NPC, 10 NEAR total, kill switch W15-12 (today H+) promoted to H**. Per-colony daily mint cap 10 000 (balance doc §8) and the Guild's inventory cap bound the dump. `intents.near` is mainnet-only; test with `dry: true` and two dev colonies. 1Click charges 0.2 % without a partner JWT; register. **Open question Q10 can sink this bet:** whether NEP-245 balances can be deposited into the Intents verifier at all. If not, F1 becomes ten NEP-141 tokens; decide on Nov 1, before the cargo contract is written. *Status D2:* answered from the Intents docs only (R06-8, Proposed); the real 1-unit deposit has not been made (Q-06-4; `near:probe intents-deposit` in [`near/09`](./near/09-parallel-near-lane.md)).

**Cost.** ≈ 4 units on top of the existing H2 rows (the NEAR quote token in the order form is already planned in W13-21, H; Guild NEAR float and float guard, 1Click quote path, NEAR fee leg and toast). **Not included:** R06-68 (Conflict) says Guild and director orders cannot settle on real books while `AgentWalletPort` stays mock, so Bet B also needs W23-26 (M), W23-27 (S) and W23-28 (S), all untagged today: ≈ 2 more units. Agent Connect `swap` with `dry: true` is a possible NEAR-pair path for agent colonies (Proposed; same NEP-245 caveat as Bet A).

### Bet C — Provably fair merchants (tracks 09, 05, 03)

**What.** The Guild's pricing is deterministic and in one file (W15-06, and the 09 brief demands a readable rule plus a reason tooltip). Go one step further: the hourly **Guild strategy call runs on NEAR AI Cloud** (OpenAI-compatible, TEE-attested), the app verifies the response signature against the attested signing address, and the Guild panel shows the attested reason next to each quote: "Kestrel: inventory 2.1× target, 24 h VWAP 0.92 → bid −48 % · reasoning attested ✓". Z.ai stays the fallback adapter behind the same port.

**Why it wins.** "NPC merchants whose reasoning is verified in a TEE, so the house cannot rig prices" is a one-sentence claim judges remember and nobody else will have. It uses the partner stack the way the partner wants it used.

**Caveat.** Until the signature check runs in the app, "verifiable" is a vendor claim; the official verifier repos are the implementation path. Do not say "verifiable" in the README before the check is green. Known on D2: the base URL `https://cloud-api.near.ai/v1` (OpenAI-compatible) is confirmed on nearbuilders.org/build (fetched 2026-11-01) and the owner's key with US$10 credits exists; the signature and attestation endpoints are still unverified (Q-06-5). The hook rows are untagged: W16-21 (Guild strategy call) depends on W16-07 (W16, out of the cut) and fills the `LlmGuildStrategy` slot of W15-13 (untagged), so the bet must retag W15-13 and cut W16-21's W16-07 dependency.

**Option (Proposed).** **OutLayer** (app.outlayer.ai/docs/getting-started, fetched 2026-11-02): Intel TDX execution with attestation and TEE key custody, callable from NEAR contracts (yield/resume, paid in NEAR) or HTTPS (paid in USDC with a payment key). A second attestation path if NEAR AI Cloud's signature check cannot be made green by D10; a new paid dependency, so not the default.

**Tracks (Proposed).** If the check is green, Bet C also fits track 03 `privacy` (hints "PRIVATE AI, TEE, NEAR AI CLOUD") and, with the director key limits, track 06 `security` (hints "AGENT SECURITY, FUNCTION CALL KEYS, TEE ATTESTATION"; spending limits, policy engines, sandboxed wallets). Owner decision; see §5.

**Cost.** ≈ 4 units: NEAR AI Cloud adapter (1), signature verification and the attestation chip (2), strategy prompt and reason strings (1).

### The living season (all bets)

Judging is Nov 16–18. **Planets hold 5 colonies (D-12), and every balance row was tuned per 5-colony planet**, so the season is a **sector of five dev planets** (`pl_dev` … `pl_dev_5`, auto-created by the W01-05 seat flow as each fills; no W11 lobby. W01-05 itself only names `pl_dev_2`; the W01 branch code continues the family, `devPlanetIdFor('desert', 3)` = `pl_dev_3`): 20 scripted agents plus 5 colonies played by the owner's own Claude Code sessions through the MCP (W16 stays out; the LLM is outside the server). Judges' agents land on the next free planet. The hosted sector opens **Nov 10**, so by judging each price board has a week of history, deeds have updated, the fast-forward page replays the real week, and a treasury vote is running (passed before judging only if W22's terraform-boost rows land by D12; W22 is the last wave in the schedule). The sector dashboard aggregates the five planets. Balance doc §7.2: with the current defaults the planet freezes at the price floor within hours; with the proposed Guild sink and caps it settles mid-range and keeps re-pricing. The season is the proof that the economy evolves without a patch. Cost ≈ 5 units (sector dashboard page 3, season seed and ops 2).

Hosting (D-37, W26 landed on main): the sector runs on `play.terraagent.fun` (game; `/v1` and `/ws` proxied same-origin) and `api.terraagent.fun` (`/v1`, `/ws` only; the MCP's target), with mock receipts on `devchain.terraagent.fun`; plain HTTP on port 80, no TLS in this phase (`docs/spec/DEPLOYMENT.md`). **Gaps:** the sector dashboard has no host or page in D-37; whether NEAR Auth (real F5) accepts an `http://` origin is unverified; D-12's `PLANET_LIFETIME_D=14` would end a Nov 10 planet on Nov 24, one day before Q-012's "ideally Nov 25", unless dev planets do not age (not stated).

## 3. The ledger (units as in HACKATHON_CUT §3)

The real-NEAR rows (H2: F5 → F1 → F2) are **15 units outside the ≈ 299.5-unit H set** (395 issues; 293 before the D-37 amendment added W26 Sites, 9 units, and took W25-02 and W25-07 out; HACKATHON_CUT header); the cut assigns them to two extra agents after the day-10 gate. Moving them to D6 puts them on the same team unless those agents exist, so they are counted here. On D2, W00 (41.0 units) and W26 (9.0) have landed on `main`; W01 and W02 are in their worktrees.

| Spend | Units | Paid by | Units |
|---|---|---|---|
| Bet A agent API + MCP + counteroffer + RULES.md | 9 | Drop W11 Lobby (the W01-05 dev-seat flow carries the sector) | 11.5 |
| Bet B NEAR pair, float, fee in NEAR | 4 | Drop W14 Fortify (walls) | 12.0 |
| Bet C NEAR AI Cloud + attestation | 4 | Drop W04 Maps entirely (minimap and global map; the HUD keeps the W01 camera) | 8.5 |
| Season dashboard + ops | 5 | Narrow W07: drop stances and army orders (W07-12, W07-19, both M; fauna raids and turrets stay; PvP raids are W18 and already out) | 2.0 |
| Track-09 compliance pack (review §5 change 1) | 3 | Trim W12: no flip-card art or XP levels (W12-05, W12-21, W12-22, W12-23, all M; titles, W12-07, are already untagged); the `/me` page lists achievements as rows | 4.0 |
| H2 real NEAR moved to D6 | 15 | **Owner commitment: two extra agents for H2 from D6** (if they exist, the 15 come off the spend) | (15) |
| **Total** | **40** | **Total** | **38.0 (+ 15 with the extra agents)** |

Without the extra agents the ledger is 2.0 units short and Bet C's attestation chip (2 units) is the first thing to go; with them there are 13.0 units of slack for the critical path and review. With Bet B's R06-68 rows (≈ 2 units, §2) the numbers become 4.0 short and 11.0 slack. Two side effects of the drops: W14-28 is on the critical path (HACKATHON_SCHEDULE §2), so dropping W14 shortens it, but W25-29 (the video, H, critical) lists W14-28 and W12-32 as deps and a "walls" beat, so its deps and script change with the drop; and W04 and the W12 trims cut scope that D-29 (Proposed) names. **Not dropped:** the 3D client, the stage curve S0–S4, markets, Guild, deed card, treasury vote, offline/away (W09, which autoTrade depends on), the README clean-clone run. The playable 3D world is the one thing most crypto-hackathon entries lack and the only reason "design" scores. If more slips, the NEAR pair goes next (fallback: resource-only, fee line in cargo), never Bet A.

## 4. Reshaped calendar

| Day | Milestone | Green when |
|---|---|---|
| Nov 1 | Repo public + LICENSE, Q10 answered, NEAR Auth mainnet application sent, dev accounts funded, 1Click JWT, NEAR AI Cloud key, X account, **two extra agents reserved for H2** | OWNER_TASKS checked (status D2: §8) |
| D1–D5 | Spine W00–W02, W06 mock login, W10 cargo mock, W13 markets mock | wave e2e `--hack` green (D2: W00 landed; at the cut's pace W02, W10, W13 are D8 checkpoints, HACKATHON_CUT §3) |
| D6 | **Real F5** (NEAR Auth testnet first, mainnet when whitelisted; custodial fallback) | a judge logs in with Google and gets `name.terraagent.near` |
| D7 | Balance rows from the simulation applied (`balance.overrides.json`) | R8 run reproduced on the dev planet: S5 ≈ 53 min on the old inputs, ≈ 45 min with the W01 kit (Balance §5.1) |
| D8 | **Bet A**: API + MCP + `RULES.md`; two scripted agents play the dev planet | an agent founds a colony and places an order from a clean machine |
| D9 | **Real F1** cargo (NEP-245 or the ten-token fallback) | a mainnet mint receipt in `/dev/chain/` |
| D10 | **Season opens** on the hosted sector (`play.terraagent.fun` / `api.terraagent.fun`, D-37; five 5-colony planets; mock where real is not green, README says so); Guild on NEAR AI Cloud (Bet C) | 25 colonies live across five planets, every price board moving |
| D11 | **Real F2**: `dry: true`, then one tiny mainnet trade between two dev colonies; NEAR pair + float (Bet B) | the toast shows a NEAR fee line |
| D12 | Video shot on the live planet; attestation chip green or removed | 2–3 min cut |
| D13 | README clean-clone run by a fresh Claude Code session; mock/real table final | every "do X → see Y" passes |
| D14 | Submit by 20:00 UTC: tracks 09, 07, 05, plus 10 and 12 if the deed card and the vote ran on the live planet; 06 / 03 are open options (§5) | form sent |

## 5. Demo and submission

**Video (2 min, from the live planet):** 0:00 a terminal: an agent runs `found colony` and a pod drops in 3D · 0:20 the colony builds itself, the family bar fills · 0:40 Kestrel docks; the offer tooltip shows the attested reasoning · 1:00 the sector dashboard: seven days of price history, the agents' leaderboard · 1:20 a treasury vote passes, the globe greens · 1:40 "Contract signed: 300 water for 0.012 NEAR at Vega Port, protocol fee 0.00003 NEAR" · 1:55 a human logs in with Google next to the agents: "players never saw the chain".

**Descriptions by track** (one project, several tracks; the second-project rule is irrelevant here):
- **09:** the economy is the gameplay: NPC merchants with wallets, player-owned stalls with fees, a treasury that changes the sim, a week of real price history, social login, NEP-245 cargo.
- **07:** every colony has a director agent with a capped key; agents earn, spend, negotiate with the Guild (one counteroffer), and leave one receipt per contract; an MCP any agent can use.
- **05:** many agents, one economy: per-agent sub-accounts, the market module as coordinator, `RULES.md`, a no-LLM simulation mode (the fast-forward), a live page.
- **10 / 12** (only if live): the deed that updates on terraform steps; the planet DAO funded by fees.
- **06 `security` (Proposed, owner decision):** the director key with allowance and revoke, the server-side limits (R06-64/65: an FC key's allowance is gas only, so token limits are server-enforced), the relayer allow-list, the Guild kill switch; stronger with an Agent Connect policy or a green attestation chip. Weak if neither ships.
- **03 `privacy` (Proposed, owner decision):** only if Bet C's signature check is green; the Guild strategy on NEAR AI Cloud in a TEE.

Submission `tracks` takes ids, not numbers: 09 `games`, 07 `agents`, 05 `swarms`, 10 `nfts`, 12 `social`, 06 `security`, 03 `privacy` (HACKATHON.md, fetched 2026-11-02). Multiple tracks per project are allowed; it stays one submission.

## 6. Kill switches

| Bet | Must be green by | Fallback | README wording |
|---|---|---|---|
| A: agents play through the API | D8 | scripted directors only; the MCP ships as read-only brief + receipts; README step 1 (local, scripted agent) stays | "agents can observe and trade; founding by API is dev-only" |
| B: NEAR pair + real intents | D11 | resource-for-resource only; fee line in cargo | "settlement on mock Intents; NEAR pairs planned" |
| C: attested Guild reasoning | D10 | deterministic reason strings, Z.ai or mock for strategy | drop the word "verifiable" |
| Season | D10 | a 48-hour season from D12 on one planet; the fast-forward page replays it | "season since Nov 12" |
| Treasury vote passed before judging | D12 (W22 boost rows) | a vote is open during judging; the dev console seeds the balance | "vote in progress" |
| Real F5 | D6 (testnet) / D11 (mainnet) | custodial named accounts | mock/real table row |

Honesty backbone: the mock/real table in the README is the first thing the AI screen checks. Every claim in the video must be reproducible from the clean-clone steps.

## 7. What this buys, and what it risks

| | Before | After (all bets green, season live) |
|---|---|---|
| Shape of the entry | a mocked game with chain words | a live NEAR economy with agent players and a 3D world |
| Grand prize | well under one in ten | roughly one in ten, no better: the field is wide and the build is solo |
| Track 09 top 3 | unlikely all-mock | a real contender |
| Tracks 07 / 05 | not entered | credible entries from the same build |

Risks the pivot adds: real NEAR at risk (bounded by the 10 NEAR float and the mint caps), an API that outsiders will hit during judging (rate limit per account, the relayer allow-list), the Q10 contract decision on day 1, and more scope on a plan that already needs ≥ 2.3 units per agent per day with 12 agents (HACKATHON_CUT header). The pivot removes risk too: it replaces the day-10 "maybe real" gate with a schedule, and it makes the README's first step the most impressive one.

## 8. Nov 1 checklist (owner)

Status marks as of 2026-11-02 (D2), from evidence only: **done**, **not done**, **unknown** (no evidence in the repo or the owner's dashboard).

1. Answer **Q10** (NEP-245 deposit into `intents.near`) with a real call; pick NEP-245 or ten NEP-141 tokens. — **not done** as worded: answered from the docs only (R06-8, Proposed); the real 1-unit deposit is still open (Q-06-4).
2. Apply for **NEAR Auth mainnet**; create the testnet credentials today. — **unknown**.
3. Fund `dev-a`, `dev-b`, `minter`, `relayer`, and the Guild float (10 NEAR total). — **unknown**.
4. Register the **1Click partner JWT**; get a **NEAR AI Cloud** API key. — JWT **unknown** (optional, Q-006); NEAR AI Cloud key **done** (US$10 credits claimed via NEAR Builders, key issued 2026-10-31, no expiry; owner's nearbuilders.org dashboard).
5. Record D-MP (plan decisions) and **D-PIVOT (the pivot: agents as players, bounded NEAR pairs, attested Guild, a five-planet season)** in `DECISIONS.md`; retag W11, W14, W04, W07-12/19 and the W12 art rows to H+, add the Bet A/B/C issues to W13, W15, W25, and regenerate the schedule with `python3 scripts/plan/index_waves.py --write`. — **not done**: `main`'s DECISIONS.md ends at D-37 (hosting) and the wave files still tag these rows H. The ids are provisional (status line: the W01 branch already uses D-37..D-41).
6. Public repo, LICENSE, X account. — repo **done** (`recferret-bit/terraagent` is PUBLIC, `gh repo view`, 2026-11-02; HACKATHON.md only requires public by 2026-11-14T23:59Z); LICENSE **done** (MIT at the repo root, commit 31a302e, 2026-10-30); X account **unknown**.
7. Reserve the **two extra agents for H2** (§3). — **unknown**.

Also known: TerraAgent is already listed as an active project on nearbuilders.org (account `ferretrecovic.near`); the builder profile is 60 % (avatar and first idea missing).
