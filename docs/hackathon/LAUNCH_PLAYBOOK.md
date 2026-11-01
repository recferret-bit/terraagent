# Launch playbook — build, comms and judge awareness, Nov 1 → Nov 18

> **Status:** 2026-10-31, proposal. The build column repeats [`GRAND_PRIZE_PIVOT.md`](./GRAND_PRIZE_PIVOT.md) §4 so that no post ever promises something that is not green. Rules quoted from nearhackathon.com and its `HACKATHON.md` (read the live version again on D13; the organisers say dates and rules may change). Outward-facing material lives in [`./public/`](./public/): [`whitepaper.md`](./public/whitepaper.md), [`landing-brief.md`](./public/landing-brief.md), [`media-plan.md`](./public/media-plan.md).

## 1. Strategy in one line

**Ship a 5-minute path that the AI screen passes, put real NEAR under it by day 11, open an agents-only sector on day 10 that anyone's Claude Code or Codex can join, and let the daily "what the agents did" thread carry the project to the judges.** Optimise for first place in tracks 09, 07 and 05; the grand prize is the upside if the sector catches fire.

## 2. The schedule (build × comms)

**Dates assume the pivot ledger** (W11, W14, W04 and the W07/W12 trims dropped, so their agents move onto the spine). At the cut's own checkpoints the early milestones land later: W01 ≈ D5, W02 ≈ D7, W06 ≈ D6, W15 ≈ D12. The rule below protects the posts either way: **no post until the wave e2e is green**; if D3/D4 slip to D5–D8, the GIF beats slip with them and the X cadence drops to every second day.

Owner comms budget: **30–45 min a day**, two slots: 09:00 UTC (post the previous day's green milestone) and 18:00 UTC (replies, Telegram/Discord). An agent drafts every post from the template in §3; the owner edits and sends. Nothing is posted about a milestone until its wave e2e is green.

| Date | Build milestone (green when) | Comms beat | Asset | Owner min |
|---|---|---|---|---|
| **Nov 1** | Repo public + LICENSE; Q10 (NEP-245 deposit into `intents.near`) answered; NEAR Auth mainnet application; dev accounts funded; 1Click JWT; NEAR AI Cloud key; two agents reserved for H2 | **Pinned launch thread** on X (§3.1 T1); intro + one real question in the Builders Telegram and NEAR Discord (§3.2); read each server's rules, find the showcase channel | OG image, 3 prototype screenshots (baseline, labelled as such) | 45 |
| Nov 2 (D2) | W00 spine green; pace check | Reply day only. Discord/Telegram: answer anyone who asked about the approach | — | 15 |
| Nov 3 (D3, cut: D5) | W01 Landfall: HQ lands, prepares ground, Hub builds | X post: "the first thing a colony does is terraform its own doorstep" + descent GIF | GIF 1 (descent → Grade → Hub) | 30 |
| Nov 4 (D4, cut: D7) | W02 First Light: resources, first night | X post: the first-night brownout GIF ("everything costs energy, terraforming first") | GIF 2 | 30 |
| Nov 5 (D5) | W06 mock login: `name.terraagent.near`, first gasless action | X post: "you got a NEAR account and never saw it" (say: NEAR Auth, NEP-366 relayer, mock today, real on D6) | screenshot of the Pilot ID chip | 30 |
| **Nov 6 (D6)** | **Real F5** (NEAR Auth testnet, mainnet when whitelisted) | X post with the explorer link of the first real named account created from a Google login. Telegram: thank whoever answered the whitelist question | explorer screenshot | 30 |
| Nov 7 (D7) | Balance overrides applied (R8 run reproduced: S5 ≈ 51 min) | X post: one chart from the balance doc (terraform ceiling 78 %, or the price-floor vs sink curve) + "why the economy needs a sink" | chart PNG | 30 |
| **Nov 8 (D8)** | **Bet A**: Colony Agent API + MCP + `RULES.md`; two scripted agents play the dev planet | X post (§3.1 T2): "an AI agent just founded a colony with one tool call" + terminal/3D split GIF. Builders Telegram: "MCP is up, try it on the dev sector" | GIF 3, `RULES.md` link | 45 |
| Nov 9 (D9) | **Real F1** cargo mint on mainnet | X post: the mint receipt ("300 iron left the planet; here is the NEP-245 transfer") | explorer screenshot | 30 |
| **Nov 10 (D10)** | **Sector opens**: five 5-colony planets, 20 scripted agents, 5 owner-Claude colonies; Guild on NEAR AI Cloud; sector dashboard live. **Reserve a showcase planet with two open seats** (the dev-seat flow never seals), so a judge's agent lands next to a week of history instead of on a fresh `pl_dev_N`; the dashboard carries the history either way | **"Agents-only sector is open" thread** (§3.1 T3) with the join command; Discord showcase channel + Builders Telegram + NEAR DevHub chat invite (§3.2); nearbuilders.org listing if it has one | dashboard screenshot, GIF 4 (Guild docks, reason tooltip) | 45 |
| **Nov 11 (D11)** | **Real F2**: `dry: true`, then one tiny mainnet trade; NEAR pair + float; NEAR fee line in the toast | X post: the first real Intents settlement with the fee line and the `execute_intents` link. First **daily sector report** (§3.1 T4) | explorer screenshot, leaderboard | 40 |
| Nov 12 (D12) | Video A (demo clip) and Video B (trailer) shot on the live sector; W22 vote opened; attestation chip green or removed; landing copy live (if W24-lite lands) | Daily sector report #2; trailer on the landing; optional: Reddit r/near, HN "Show HN" (only if the hosted demo is stable) | Video B | 40 |
| Nov 13 (D13) | README clean-clone run by a fresh Claude Code session; mock/real table final; **reread the live HACKATHON.md** | **Required demo post** (§3.1 T5) with Video A; daily sector report #3 | Video A | 45 |
| **Nov 14 (D14)** | Submit by **20:00 UTC** (deadline 23:59 UTC): tracks 09, 07, 05 (+10, +12 if the deed card and the vote ran live) | Submission confirmation post quoting the demo post; Telegram/Discord thanks | — | 30 |
| Nov 15 | Keep the sector up; monitor relayer balance, Guild float, API rate limits | Daily sector report #4 | — | 20 |
| **Nov 16–18 (judging)** | Hosted demo must stay up (ideally through Nov 25); no deploys except hotfixes | Daily sector report #5–7 (what the agents did overnight, prices, votes); substantive replies only | leaderboard, price chart | 20 |
| Nov 18 | Results by 23:59 UTC | Thank-you post either way; apply to NEAR Protocol Rewards (post-hackathon programme) | — | 15 |

If a milestone slips, its post slips with it. The pivot's kill switches say what the fallback wording is.

## 3. Channel scenarios

### 3.1 X (the required channel)

Rules from `HACKATHON.md`: lead with the user problem in a line a stranger understands; show **one complete moment** from a real action to a visible result; no intros, architecture slides or setup; say NEAR's role concretely, never "powered by NEAR"; close with a link to the demo and the repo and **a genuine question**. Tag `@NEARProtocol` and `#NEARHackathon`; `@NearLegion` and `@NearBuilders` are optional.

**T1 — Nov 1, pinned launch thread (6 posts)**
1. *Your colony keeps mining, trading and terraforming while you sleep. We're building it in 14 days at NEAR HACKATHON. Follow the build.* (OG image)
2. The problem: online strategy games stop when you close the tab, and their economies are spreadsheets the studio patches. We want a planet that runs itself and an economy that moves because players and agents trade.
3. What exists today (honest): a 3D prototype from before the window (baseline, disclosed). Nothing else runs yet. Everything in this thread from here on is built in the window, and we post a milestone only when it runs.
4. What NEAR will do, concretely: Google login **will create** a real named account; cargo **will be** a multi-token; trades **will settle** as NEAR Intents; NPC merchants **will have** their own sub-accounts; a planet DAO **will spend** the fees. The player sees cargo and contracts, never a wallet.
5. The plan: economy first, agents as players, real settlement by day 11, an agents-only sector you can join by day 10.
6. Question: *If your agent had a wallet and a colony, what would you tell it to do first?* + repo link.

**T2 — D8, "an agent founded a colony"**: *An AI agent just founded a colony with one tool call: it got a NEAR account, prepared the ground, and queued its first extractor. Any Claude Code or Codex session can do the same with our MCP.* GIF of the terminal and the 3D landing side by side. Close: `npx terraagent-mcp` + the `RULES.md` link + "what should the agents be allowed to do without asking a human?"

**T3 — D10, "the sector is open" thread**: *Five planets. Twenty-five colonies. No humans required. Point your agent at the sector and it gets a colony, a wallet with an allowance, and a market to trade in.* Then: how to join (three lines), what the agents can and cannot do (the key custody line from the whitepaper), the leaderboard link, the Guild's attested reasoning screenshot, and the question: *which agent framework should we support next?*

**T4 — daily sector report (D11 → Nov 18)**: one image (price chart or leaderboard), three facts (trades settled, Living tiles, the vote), one anomaly ("Osprey ran out of rare earths; three colonies paid 3× yesterday's price"), one question. Same format every day so it becomes a series people expect.

**T5 — D13, the required demo post** (this is the one the judges open): *An AI agent founded a colony, mined iron and sold it to an NPC merchant whose price is a rule you can read. Built at NEAR HACKATHON.* Video A (45–90 s, one moment: the agent founds, exports iron, sells to Kestrel, the toast shows the NEAR fee and the Intents receipt). Then: NEAR's role in two lines (named accounts via NEAR Auth, settlement on NEAR Intents, NEP-245 cargo), the hosted demo link, the repo link, `@NEARProtocol #NEARHackathon`, and the question: *what would make you trust an NPC merchant's price?*

### 3.2 Telegram and Discord

The site describes the NEAR Discord (`discord.gg/nearprotocol`) and the Builders Telegram (`t.me/nearbuilderschat`) as places "for finding teammates and asking questions". Behave accordingly: a builder who ships daily and asks real questions, not a marketer. The NEAR DevHub Telegram carries builder announcements and has a chat.

- **Nov 1, intro (each channel, different wording):** one line on the project, one line on the stack (NEAR Auth, Intents, NEP-245, SputnikDAO-style treasury, NEAR AI Cloud), and **one real question**: Telegram: "has anyone deposited NEP-245 balances into `intents.near`, or do we need ten NEP-141 tokens?"; Discord: "NEAR Auth mainnet whitelist: typical turnaround?"
- **Before any promotional post:** read the server rules and find the showcase / projects channel. Post progress only there.
- **D6, D9, D11:** one-line progress notes with the explorer link, in the showcase channel only; thank the people who answered.
- **D10:** the "come land a colony" invite with the three join lines, in the showcase channel and the Builders chat. One post per channel, never the same text twice.
- **D14 and Nov 18:** thanks, the leaderboard screenshot, the demo post link.

### 3.3 Other venues (optional, D12 or later, only with a stable hosted demo)

nearbuilders.org (listed on the site: check whether it lists projects); Reddit r/nearprotocol; Hacker News "Show HN: a colony game where AI agents are the players" (this audience likes the MCP angle more than the chain). Skip Product Hunt during the window.

## 4. Judge awareness, the legitimate way

The site lists the judges' X handles and no contact rules. Do **not** DM judges, cold-tag them, or ask for votes: with an investor panel a lobbying read costs more than it gains. What works:

1. **Reach the screeners by design.** The README's step 1 is a local scripted agent founding a colony; step 2 is "point your own agent at the sector". Claude Code and Codex are the screeners; the project is built for exactly the agent they are. Never name them in a pitch; let the step speak.
2. **Let partners amplify.** Projects that use a partner's stack correctly get reposted by that partner. Mention `@NEARProtocol` and `@SputnikDAO` (handles from the hackathon page), and, once their handles are verified from the partner sites, the NEAR Intents and NEAR AI accounts, with the concrete thing you used (an `execute_intents` link, an attestation report, a proposal id). Partner reposts are how a project reaches a judge's timeline without tagging the judge.
3. **Substantive replies on the judges' own threads**, only when the thread is about agents, intents, game economies or TEEs, and only with a fact from the sector ("our NPC merchants settled 1 200 trades this week; the price rule is one file"). No links in the first reply.
4. **Traction is the message.** The daily sector report series, the leaderboard, and other people's agents on the planets are what a judge will have seen before opening the submission.
5. **Consistency across surfaces.** The README (no marketing), the demo post (one moment), the landing (the pitch), the whitepaper (the mechanics) must agree on every claim and on the mock/real table. The AI screen checks claims; a judge who finds a mismatch stops reading.

## 5. Assets checklist (see `media-plan.md` for scripts)

| Asset | Needed by | Captured from |
|---|---|---|
| OG image (1200×630), 3 baseline screenshots | Nov 1 | the prototype (labelled baseline) |
| GIF 1 descent → Grade → Hub | D3 | W01 e2e scenario |
| GIF 2 first night brownout | D4 | W02 `time night` |
| Pilot ID screenshot, explorer screenshot (account) | D5 / D6 | W06 / real F5 |
| Chart: terraform ceiling; price floor vs sink | D7 | `economy_sim.py` |
| GIF 3 agent founds a colony (terminal + 3D) | D8 | Bet A |
| Explorer screenshot (mint) | D9 | real F1 |
| Dashboard screenshot, GIF 4 Guild docks + reason tooltip | D10 | sector |
| Explorer screenshot (`execute_intents`), leaderboard | D11 | real F2 |
| Video A (45–90 s), Video B (2–3 min), vote GIF, price-chart GIF | D12 | live sector |
| Landing copy live | D12 | `landing-brief.md` |

## 6. Submission procedure (from `HACKATHON.md`)

1. Repo public, LICENSE present, no secrets in the history, README with "do X → see Y" steps verified from a clean clone, the baseline prototype and AI-generated code disclosed, libraries listed.
2. Demo post live on X with the video, "built at NEAR HACKATHON", `@NEARProtocol`, `#NEARHackathon`.
3. **The owner sends the submission** (the setup guide lists submission among the actions an agent must not take without the human's confirmation; an agent may prepare the payload and must show it in full first). Form at nearhackathon.com/#apply, or the API `POST https://nearhackathon.com/api/applications` (JSON ≤ 12 000 bytes, exactly the listed fields, **`website` is a spam trap: leave it empty**, one `requestId` UUID reused on retries, `consent` true only after the human agrees). A submission cannot be edited; send once, after the repo is public and the post is live. 409 means the repo or email was already used: ask, do not change the link.
4. Tracks: 09, 07, 05; add 10 and 12 only if the deed card and the vote ran on the live sector. Description 20–2 000 chars: the one-line pitch, NEAR's role concretely, and the mock/real sentence.
5. Payout: a mainnet NEAR account owned by the owner. Judging Nov 16–18; the repo stays public through judging; keep the hosted demo up through Nov 18, ideally Nov 25.

## 7. Rules table

| Rule | Source | Our handling |
|---|---|---|
| Code written since the announcement counts; pre-window code is baseline | site, `HACKATHON.md` | the `frontend/` prototype is disclosed as baseline in the README |
| README for a machine reader, "no marketing" | `HACKATHON.md`, `00-setup.md` | marketing lives in the landing and whitepaper only |
| One submission per project; up to two independent projects per person if each README names the other | site | one project, several tracks |
| Keys in `.env`, never in the repo; build on testnet first | `00-setup.md` | relayer / minter secrets as files; NEAR Auth testnet on D6 |
| Hosted demo is a plus; keep it up through Nov 18 | `HACKATHON.md` | the sector stays up to Nov 25 |
| AI screen: reproducibility, feature verification, preliminary score; humans decide | `HACKATHON.md` | D13 clean-clone run is a release gate |
