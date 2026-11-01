# Media plan (2026-10-31)

> Every asset is captured from a green wave on the day it becomes capturable (schedule in [`../LAUNCH_PLAYBOOK.md`](../LAUNCH_PLAYBOOK.md) §5). Nothing is staged in a scene the build cannot reproduce. Captures come from the wave scenarios (`/play.html?scenario=…`) with the dev console; the CRT overlay stays on for brand consistency.

## 1. Video A — the demo-post clip (45–90 s, one complete moment)

Rule from `HACKATHON.md`: one complete moment from a real user action to a visible result, no intro, no architecture. Candidate moment: **an agent sells iron to the Guild and the fee lands in NEAR.**

| Time | Screen | Audio / caption |
|---|---|---|
| 0–5 s | terminal: `found colony` | caption: "An AI agent founds a colony." |
| 5–20 s | 3D: pod lands, HQ grades the ground, Hub builds (`warp 3`) | "It gets a NEAR account it will never see." |
| 20–35 s | the family bar fills; the agent exports 300 iron; the shuttle leaves | "Storage is full. It exports." |
| 35–55 s | Kestrel docks; the offer tooltip shows the reason; the agent accepts | "The merchant's price is one rule you can read." |
| 55–75 s | toast: "Contract signed: 300 iron for 0.012 NEAR at Vega Port · fee 0.00003 NEAR" + the `execute_intents` explorer link | "Settled on NEAR Intents. Fee in NEAR." |
| 75–90 s | the sector dashboard price tick moves; end card with the repo and demo links | "Built at NEAR HACKATHON." |

Fallbacks: if the NEAR pair is not live, the toast shows a resource-for-resource contract and the caption drops "fee in NEAR"; if the attestation is not live, the tooltip shows the deterministic reason only.

## 2. Video B — the trailer (2–3 min, for the landing and the thread)

The pivot's seven beats: agent founds a colony → the colony builds itself → Guild docks with attested reasoning → the sector dashboard with a week of history → a treasury vote passes and the globe greens → a real Intents contract with the fee line → a human logs in with Google next to the agents ("players never saw the chain"). Shot on the live sector on D12, not on a staged scenario; narration under 220 words; no architecture slides.

## 3. GIFs (≤ 8 s, ≤ 4 MB, captured at 2× then downscaled)

| # | Moment | From | Day |
|---|---|---|---|
| 1 | descent → Grade → Hub completes | `w01` scenario | D3 |
| 2 | first night: solar dies, terraform pauses first (`waiting(power)`), turrets stay lit | `w02`, `time night` | D4 |
| 3 | terminal and 3D side by side: `found colony` → pod | Bet A dev planet | D8 |
| 4 | Guild ship docks, offers appear, the reason tooltip | `guild.summon kestrel` | D10 |
| 5 | terraform brush: Prepared → Irrigated → Living, the Terraform % ticking | `w05` | D10 |
| 6 | the vote passes, the boost badge, drones speed up | `w22` | D12 |
| 7 | the price chart over the season (time-lapse of the dashboard) | sector | D13 |

## 4. Screenshots (PNG, 1920×1080, HUD on)

Pilot ID chip after login (D5); explorer: the named account (D6); explorer: the NEP-245 mint (D9); the sector dashboard (D10); the Guild tab with six offers (D10); explorer: `execute_intents` with three legs summing to zero (D11); the leaderboard (D11); the Council panel with a passed proposal (D12); the `/me` page (D12).

## 5. Diagrams (SVG, light and dark, for the whitepaper, the landing and the thread)

1. **Trust boundary:** chain (accounts, cargo, settled trades, deeds, treasury) / server (production, stock, combat, terraform, mint amounts) / client (rendering); the Trade Hub as the only door.
2. **Economy flows with sinks:** sources → stock → caps → export → market / Guild → sinks (construction, upkeep, terraforming, treasury burn, Guild off-planet sales).
3. **What an agent's key can and cannot do:** inside the allowance (orders, trades, votes, receipts) vs never (spend beyond, move NEAR, claim, stake).
4. **The season:** five planets, 25 colonies, Guild routes, the dashboard.

## 6. Static images

OG image 1200×630 (orbit hero, the one-line pitch, "built at NEAR HACKATHON"); the X thread header (the same art, 1500×500); two charts from `economy_sim.py` (terraform ceiling at 78 % and the price floor vs sink curves), rendered with the design-system palette.

## 7. Who does what

An agent captures GIFs and screenshots from the scenarios and renders the charts and diagrams; the owner records the two videos (screen capture on the live sector, voice-over optional) and approves every asset against the mock/real table before it is posted.
