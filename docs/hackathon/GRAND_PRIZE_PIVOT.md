# Grand-prize pivot — "a planet where agents are citizens"

> **Status:** 2026-10-31, strategy memo. Bold on purpose: the owner asked for the risky version. It builds on [`MASTER_PLAN_REVIEW.md`](./MASTER_PLAN_REVIEW.md) (conflicts, track rules) and [`economy-balance-simulation.md`](./economy-balance-simulation.md) (numbers). Nothing here is decided; it proposes D-37/D-38 for the owner.

## 1. Thesis

The grand prize is one award across 13 tracks, decided by Illia and six crypto investors after Claude Code and Codex have checked that the README runs. Investors pick **protocol theses**, not product features. A colony builder with a mocked token is a feature. **A live planet where AI agents hold wallets, trade on NEAR Intents, vote in a treasury and are provably fair, and where the judges' own agents can land and play, is a thesis**: NEAR as the chain where agents transact. TerraAgent already has every primitive on paper (colony sub-accounts, restricted keys with allowances, Guild agents, the director key, autoTrade limits, a command protocol). The pivot wires them into one claim and puts it on a planet that is **running during judging**.

One sentence for the description field: *"TerraAgent is a 3D colony game where every player, NPC and director is an agent with a NEAR wallet; AI agents founded the first colonies, trade on NEAR Intents, vote in a planet DAO, and the merchants' reasoning is verified in a TEE. Humans never see the chain."*

Tension to state openly: track 09 is "judged on the game loop, not the token", so the game must stay a game. The pivot adds agents and real value to the loop; it does not replace the loop with a token.

## 2. The three bets

### Bet A — Agents are first-class players (tracks 09, 07, 05)

**What.** A Colony Agent API and an MCP server (`npx terraagent-mcp`) over the existing command stream: `foundColony` (a named sub-account with custodial keys, as F5 already does for humans; seats come from the W01-05 dev-seat flow, which fills `pl_dev`, then creates `pl_dev_2`, so no lobby is needed), `brief` (the ≤ 1 200-char colony brief the AI director spec already defines), `queue` (construction / units / terraform orders), `placeOrder` / `acceptGuildOffer` / `counterOffer` (intents under the director allowance; the Guild re-quotes once when a bid lands inside its spread, which is the 07 brief's "one counteroffer with reasoning"), `vote`, `receipts` (one per trade, as the 07 brief asks). Plus `RULES.md` (the 05 brief asks for it before code), two scripted reference agents, and a README in two steps: **step 1 is local and offline** (`npm run dev`, then a scripted agent founds a colony against `?host=local` and the screener sees it build); **step 2 is "point your own agent at the MCP of the live sector"**. The screen must never depend on the hosted planet or on the screener's sandbox having network.

**Why it wins.** The screeners are Claude Code and Codex. Step 1 proves the loop in their sandbox; step 2 makes their own agent a colonist on the live sector, so the judges open planets that already have their colonies on them. Track 07's brief is this agent almost verbatim (keys under an allowance, what it cannot do without approval, one receipt per task). Track 05's brief is the Guild plus a `RULES.md`, a no-LLM simulation mode (the economy fast-forward) and a live page (the price board). One build, three entries.

**Cost.** ≈ 9 units: API module over existing commands (3), MCP package + docs (2), two scripted agents and a seed script (2), the Guild counteroffer (W15-07 promoted + one rule, 1), `RULES.md` + README path (1).

### Bet B — Real value, small and bounded (tracks 09, 01, 08)

**What.** Reverse the plan's "no NEAR pairs" for one pair per T1 family (`metals.t1/NEAR`, `minerals.t1/NEAR`, `bio.water/NEAR`) on `intents.near`, the Guild funded with a real but capped float, and the protocol fee as a **NEAR** line in the settlement toast. Real adapters go live in the order F5 → F1 → F2 from day 6, not after a day-10 gate.

**Why it wins.** Prices that mean something are what "the economy is the gameplay" looks like to an investor; a fee line in NEAR is a sustainability answer that is not "paid in cargo". One tiny mainnet trade recorded in the video beats any mock.

**Brakes (the risky part, with numbers).** D-25 means farm bots can play for value and the Guild is the only NEAR buyer, so the **Guild float is the loss limit: 5 NEAR per NPC, 10 NEAR total, kill switch W15-12 promoted to H**. Per-colony daily mint cap 10 000 (balance doc §8) and the Guild's inventory cap bound the dump. `intents.near` is mainnet-only; test with `dry: true` and two dev colonies. 1Click charges 0.2 % without a partner JWT; register. **Open question Q10 can sink this bet:** whether NEP-245 balances can be deposited into the Intents verifier at all. If not, F1 becomes ten NEP-141 tokens; decide on Nov 1, before the cargo contract is written.

**Cost.** ≈ 4 units on top of the existing H2 rows (quote token NEAR in the order form already exists in W13-21; Guild NEAR float and float guard, 1Click quote path, NEAR fee leg and toast).

### Bet C — Provably fair merchants (tracks 09, 05, 03)

**What.** The Guild's pricing is deterministic and in one file (W15-06, and the 09 brief demands a readable rule plus a reason tooltip). Go one step further: the hourly **Guild strategy call runs on NEAR AI Cloud** (OpenAI-compatible, TEE-attested), the app verifies the response signature against the attested signing address, and the Guild panel shows the attested reason next to each quote: "Kestrel: inventory 2.1× target, 24 h VWAP 0.92 → bid −48 % · reasoning attested ✓". Z.ai stays the fallback adapter behind the same port.

**Why it wins.** "NPC merchants whose reasoning is verified in a TEE, so the house cannot rig prices" is a one-sentence claim judges remember and nobody else will have. It uses the partner stack the way the partner wants it used.

**Caveat.** Until the signature check runs in the app, "verifiable" is a vendor claim; the official verifier repos are the implementation path. Do not say "verifiable" in the README before the check is green.

**Cost.** ≈ 4 units: NEAR AI Cloud adapter (1), signature verification and the attestation chip (2), strategy prompt and reason strings (1).

### The living season (all bets)

Judging is Nov 16–18. **Planets hold 5 colonies (D-12), and every balance row was tuned per 5-colony planet**, so the season is a **sector of five dev planets** (`pl_dev` … `pl_dev_5`, auto-created by the W01-05 seat flow as each fills; no W11 lobby): 20 scripted agents plus 5 colonies played by the owner's own Claude Code sessions through the MCP (W16 stays out; the LLM is outside the server). Judges' agents land on the next free planet. The hosted sector opens **Nov 10**, so by judging each price board has a week of history, deeds have updated, the fast-forward page replays the real week, and a treasury vote is running (passed before judging only if W22's terraform-boost rows land by D12; W22 is the last wave in the schedule). The sector dashboard aggregates the five planets. Balance doc §7.2: with the current defaults the planet freezes at the price floor within hours; with the proposed Guild sink and caps it settles mid-range and keeps re-pricing. The season is the proof that the economy evolves without a patch. Cost ≈ 5 units (sector dashboard page 3, season seed and ops 2).

## 3. The ledger (units as in HACKATHON_CUT §3)

The real-NEAR rows (H2: F5 → F1 → F2) are **15 units outside the 293-unit H set**; the cut assigns them to two extra agents after the day-10 gate. Moving them to D6 puts them on the same team unless those agents exist, so they are counted here.

| Spend | Units | Paid by | Units |
|---|---|---|---|
| Bet A agent API + MCP + counteroffer + RULES.md | 9 | Drop W11 Lobby (the W01-05 dev-seat flow carries the sector) | 11.5 |
| Bet B NEAR pair, float, fee in NEAR | 4 | Drop W14 Fortify (walls) | 12.0 |
| Bet C NEAR AI Cloud + attestation | 4 | Drop W04 Maps entirely (minimap and global map; the HUD keeps the W01 camera) | 8.5 |
| Season dashboard + ops | 5 | Narrow W07: drop stances and army orders (W07-12, W07-19; fauna raids and turrets stay; PvP raids are W18 and already out) | 2.5 |
| Track-09 compliance pack (review §5 change 1) | 3 | Trim W12: no flip-card art, titles or XP levels; the `/me` page lists achievements as rows | 4.0 |
| H2 real NEAR moved to D6 | 15 | **Owner commitment: two extra agents for H2 from D6** (if they exist, the 15 come off the spend) | (15) |
| **Total** | **40** | **Total** | **38.5 (+ 15 with the extra agents)** |

Without the extra agents the ledger is 1.5 units short and Bet C's attestation chip (2 units) is the first thing to go; with them there are 13.5 units of slack for the critical path and review. **Not dropped:** the 3D client, the stage curve S0–S4, markets, Guild, deed card, treasury vote, offline/away (W09, which autoTrade depends on), the README clean-clone run. The playable 3D world is the one thing most crypto-hackathon entries lack and the only reason "design" scores. If more slips, the NEAR pair goes next (fallback: resource-only, fee line in cargo), never Bet A.

## 4. Reshaped calendar

| Day | Milestone | Green when |
|---|---|---|
| Nov 1 | Repo public + LICENSE, Q10 answered, NEAR Auth mainnet application sent, dev accounts funded, 1Click JWT, NEAR AI Cloud key, X account, **two extra agents reserved for H2** | OWNER_TASKS checked |
| D1–D5 | Spine W00–W02, W06 mock login, W10 cargo mock, W13 markets mock | wave e2e `--hack` green |
| D6 | **Real F5** (NEAR Auth testnet first, mainnet when whitelisted; custodial fallback) | a judge logs in with Google and gets `name.terraagent.near` |
| D7 | Balance rows from the simulation applied (`balance.overrides.json`) | R8 run reproduced on the dev planet: S5 ≈ 51 min |
| D8 | **Bet A**: API + MCP + `RULES.md`; two scripted agents play the dev planet | an agent founds a colony and places an order from a clean machine |
| D9 | **Real F1** cargo (NEP-245 or the ten-token fallback) | a mainnet mint receipt in `/dev/chain/` |
| D10 | **Season opens** on the hosted sector (five 5-colony planets; mock where real is not green, README says so); Guild on NEAR AI Cloud (Bet C) | 25 colonies live across five planets, every price board moving |
| D11 | **Real F2**: `dry: true`, then one tiny mainnet trade between two dev colonies; NEAR pair + float (Bet B) | the toast shows a NEAR fee line |
| D12 | Video shot on the live planet; attestation chip green or removed | 2–3 min cut |
| D13 | README clean-clone run by a fresh Claude Code session; mock/real table final | every "do X → see Y" passes |
| D14 | Submit by 20:00 UTC: tracks 09, 07, 05, plus 10 and 12 if the deed card and the vote ran on the live planet | form sent |

## 5. Demo and submission

**Video (2 min, from the live planet):** 0:00 a terminal: an agent runs `found colony` and a pod drops in 3D · 0:20 the colony builds itself, the family bar fills · 0:40 Kestrel docks; the offer tooltip shows the attested reasoning · 1:00 the sector dashboard: seven days of price history, the agents' leaderboard · 1:20 a treasury vote passes, the globe greens · 1:40 "Contract signed: 300 water for 0.012 NEAR at Vega Port, protocol fee 0.00003 NEAR" · 1:55 a human logs in with Google next to the agents: "players never saw the chain".

**Descriptions by track** (one project, several tracks; the second-project rule is irrelevant here):
- **09:** the economy is the gameplay: NPC merchants with wallets, player-owned stalls with fees, a treasury that changes the sim, a week of real price history, social login, NEP-245 cargo.
- **07:** every colony has a director agent with a capped key; agents earn, spend, negotiate with the Guild (one counteroffer), and leave one receipt per contract; an MCP any agent can use.
- **05:** many agents, one economy: per-agent sub-accounts, the market module as coordinator, `RULES.md`, a no-LLM simulation mode (the fast-forward), a live page.
- **10 / 12** (only if live): the deed that updates on terraform steps; the planet DAO funded by fees.

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

Risks the pivot adds: real NEAR at risk (bounded by the 10 NEAR float and the mint caps), an API that outsiders will hit during judging (rate limit per account, the relayer allow-list), the Q10 contract decision on day 1, and more scope on a plan that already needs 2.2 units per agent per day. The pivot removes risk too: it replaces the day-10 "maybe real" gate with a schedule, and it makes the README's first step the most impressive one.

## 8. Nov 1 checklist (owner)

1. Answer **Q10** (NEP-245 deposit into `intents.near`) with a real call; pick NEP-245 or ten NEP-141 tokens.
2. Apply for **NEAR Auth mainnet**; create the testnet credentials today.
3. Fund `dev-a`, `dev-b`, `minter`, `relayer`, and the Guild float (10 NEAR total).
4. Register the **1Click partner JWT**; get a **NEAR AI Cloud** API key.
5. Record D-37 (plan decisions) and **D-38 (the pivot: agents as players, bounded NEAR pairs, attested Guild, a five-planet season)** in `DECISIONS.md`; retag W11, W14, W04, W07-12/19 and the W12 art rows to H+, add the Bet A/B/C issues to W13, W15, W25, and regenerate the schedule with `python3 scripts/plan/index_waves.py --write`.
6. Public repo, LICENSE, X account.
