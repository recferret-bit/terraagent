# Media plan (2026-10-31; pass 4 2026-11-02)

> Every asset is captured from a green wave on the day it becomes capturable (calendar in [`../LAUNCH_PLAYBOOK.md`](../LAUNCH_PLAYBOOK.md) §2, asset checklist §5). Nothing is staged in a scene the build cannot reproduce. Captures come from the wave scenarios (`/play.html?scenario=…`) with the dev console; the CRT overlay stays on for brand consistency. Hosted captures come from the W26 hosts (`play.terraagent.fun`, `devchain.terraagent.fun`, D-37), not Cloudflare or R2.
>
> **Days.** D1 = Nov 1; today is D2; the deadline is Nov 14 23:59 UTC (submit by 20:00 UTC). "Day" below is the earliest capture day at the cut's checkpoints (HACKATHON_CUT §3: W00/W01/W06 by D5, W02/W03/W10/W13 by D8, W05/W07/W12/W15/W04/W08 by D10, W09/W14/W20/W22/W11 by D12). The Playbook's earlier days (D3, D4, D6, D9) assume the pivot ledger (D-PIVOT, proposed). Anything that shows **real** NEAR comes after the D10 gate (Nov 10) and only for F5, F1, F2 (R06-50); before that, or if the gate fails, it is the mock, labelled "mock". Beats that rest on the pivot (agent API, NEAR pairs, attestation, the sector) are marked **(pivot)** and have a cut-only fallback.

## 1. Video A — the demo-post clip (45–90 s, one complete moment)

Rules from `HACKATHON.md` (re-read 2026-11-02): the human records the demo and publishes a public X post that says the project was built at NEAR HACKATHON, tags @NEARProtocol and #NEARHackathon (@NearLegion and @NearBuilders optional), and attaches the video or screenshots. Lead with the user problem in a first line a stranger understands; show one complete moment from a real user action to a visible result, no long intro, no architecture slides, no setup; say concretely what NEAR does in the product (not "powered by NEAR"); give a next step (the demo link, the public repo, a real question). `HACKATHON.md` sets no video length; 45–90 s is our own limit. Screenshots alone are not enough when judges cannot open the demo, so the hosted demo stays up through Nov 18, ideally Nov 25.

Candidate moment **(pivot)**: **an agent sells iron to the Guild and the fee lands in NEAR.** Cut-only fallback: **the director sells 300 metals to the Guild while the player is away** (W15 demo steps 1–7, `?scenario=w15`, all `H`).

| Time | Screen | Audio / caption |
|---|---|---|
| 0–5 s | terminal: `found colony` **(pivot; agent API has no issue, OD-19)** — fallback: the player taps Land | caption: "An AI agent founds a colony." |
| 5–20 s | 3D: pod lands, HQ grades the ground, Hub builds (`warp 3`; the Hub completes at sim 0:47, balance §3.1) | "It gets a NEAR account it will never see." (mock account until real F5) |
| 20–35 s | **hard cut** to the `w15` seed (S2, Trade Hub online, metals 1 400 / 1 500, Kestrel due in 30 s); the family bar is full; 300 iron goes to export | "Storage is full. It exports." A cold landing cannot get here in 15 s: metals are ≈ 20 at sim minute 10 (balance §3.1) and the Trade Hub unlocks only at S5, on a Guild visit or with `TRADE_HUB_AT_S2` (W10-03) |
| 35–55 s | Kestrel docks (`guild.summon kestrel`, W15-28); six offers; the offer reason tooltip *(proposed, R04-16, no issue)*; the agent (fallback: the director) accepts | "The merchant's price is one rule you can read." |
| 55–75 s | toast: "Contract signed: 300 iron for ⟨amount⟩ NEAR at Vega Port · fee ⟨amount⟩ NEAR" **(pivot, NEAR pair)**; numbers open (Q-03-30: 0.012 NEAR / 300 is below the 0.001 tick, and 0.00003 is a protocol fee only); the `execute_intents` explorer link only if real F2 passed the gate **and** Guild orders can settle on real Intents (Q-06-18); otherwise the receipt on `devchain.terraagent.fun/dev/chain/`, labelled mock | "Settled on NEAR Intents. Fee in NEAR." — fallback: "Settled on the mock Intents verifier; the README lists what is real." |
| 75–90 s | the price board tick moves (W13-23; the sector dashboard is **pivot**); end card with the repo link, `play.terraagent.fun` and one question | "Built at NEAR HACKATHON." |

Fallbacks: if the NEAR pair is not live, the toast shows a resource-for-resource contract and the caption drops "fee in NEAR"; if the attestation is not live, the tooltip shows the deterministic reason only (or no tooltip, if R04-16 gets no issue); if F2 stays mock, no explorer link appears and the caption says "mock".

## 2. Video B — the trailer (2–3 min, for the landing and the thread)

**(pivot)** The pivot's seven beats: agent founds a colony → the colony builds itself → Guild docks with attested reasoning → the sector dashboard with history → a treasury vote passes → a real Intents contract with the fee line → a human logs in with Google next to the agents ("players never saw the chain"). Narration under 220 words; no architecture slides. Limits on D12: the sector opens Nov 10 (Pivot §2), so it has two days of history, not a week (a week only through the fast-forward page, balance §9.3, proposed, no issue); "attested" goes if OD-08 drops Bet C (kill switch D10); the W22 Terraform boost cuts Seed and Irrigate costs by 25 % (W22-11), it does not green the globe by itself, and a pass on camera depends on Q-05-13 (6 h real-time TTL), else "vote in progress"; "Google" is labelled mock unless real F5 passes the gate; the Intents beat needs real F2 (H2).

Cut-only trailer (all `H` waves, scenario captures): descent → Hub (W01) → first night and brownout (W02/W03) → terraform brush (W05) → raid and turrets (W07) → export at the Trade Hub (W10) → order book and price board (W13) → Guild docks, the director sells (W15) → deed card (W20) → Council vote (W22). Shoot it on D12–D13 from green waves.

## 3. GIFs (≤ 8 s, ≤ 4 MB, captured at 2× then downscaled)

| # | Moment | From | Day |
|---|---|---|---|
| 1 | descent → Grade → Hub completes | `w01` scenario | D5 (Playbook D3) |
| 2 | first night: solar dies, the Extractor sheds (`offline: brownout`); the full version (terraform pauses first, `waiting(power)`, turrets stay lit) needs W05 and W07 | `w02`, `time night`; full version `w05`, `time night` with W07 on | D8; full version D10 |
| 3 | terminal and 3D side by side: `found colony` → pod **(pivot)** | Bet A dev planet | D8 if Bet A is taken (Pivot calendar); none in the cut |
| 4 | Guild ship docks, offers appear, the reason tooltip *(proposed, R04-16)* | `w15`, `guild.summon kestrel` | D10 |
| 5 | terraform brush: Prepared → Irrigated → Living, the Terraform % ticking | `w05` | D10 |
| 6 | the vote passes, the Terraform boost badge, the Seed cost −25 % in the queue (W22-11) | `w22` | D12 |
| 7 | the price chart over the season (time-lapse of the dashboard) **(pivot)**; fallback: the W13 price board on the hosted demo planet | sector / `play.terraagent.fun` | D13 |

## 4. Screenshots (PNG, 1920×1080, HUD on)

Pilot ID chip after login, mock `test-pilot.terraagent.mock` (D5, labelled mock); explorer: the named account (D11+, only if real F5 passed the gate); explorer: the NEP-245 mint (after real F5, real F1 only; the mainnet smoke mints and burns 1 unit, not 300, R02-37); the Guild tab with six offers (D10); explorer: `execute_intents` with every leg summing to zero per token (after the gate, real F2 only; a NEAR pair with stall, treasury and protocol legs has five legs, not three, Q-03-30); the Council panel with a passed proposal (D12; Q-05-13); the `/me` page (D10, W12). **(pivot)**, no wave issue: the sector dashboard and the leaderboard. Before the gate, explorer shots come from `devchain.terraagent.fun/dev/chain/` and say "mock".

## 5. Diagrams (SVG, light and dark, for the whitepaper, the landing and the thread)

1. **Trust boundary:** chain (accounts, cargo, settled trades, deeds, treasury) / server (production, stock, combat, terraform, mint amounts) / client (rendering); the Trade Hub as the only door.
2. **Economy flows with sinks:** sources → stock → caps → export → market / Guild → sinks (construction, upkeep, terraforming, treasury burn *(proposed)*, Guild off-planet sales *(proposed)*).
3. **What the director and an agent can and cannot do:** inside the allowance (orders, trades, receipts); votes go through the colony key, outside the allowance (R04-55 Conflict → Q-04-21 default); never (spend beyond, move NEAR, claim, stake; R04-47 proposed). The limits are server rules; the NEAR key only fixes one receiver and a gas allowance (R06-64, R06-65).
4. **The season (pivot):** five planets, 25 colonies, Guild routes, the dashboard.

## 6. Static images

OG image 1200×630 (orbit hero, the one-line pitch, "built at NEAR HACKATHON"); the X thread header (the same art, 1500×500); two charts from `../tools/economy_sim.py` (terraform ceiling at 78 % and the full-Guild price vs sink curves), rendered with the design-system palette.

## 7. Who does what

An agent captures GIFs and screenshots from the scenarios and renders the charts and diagrams; the owner records the two videos (screen capture on the hosted demo, voice-over optional), writes and publishes the demo post (`HACKATHON.md`), and approves every asset against the mock/real table before it is posted.
