# docs/hackathon — NEAR Hackathon strategy pack (Nov 1–18, 2026)

Everything proposed for the hackathon on 2026-10-31 in one place: the review of the master plan, the balance simulation behind it, the grand-prize pivot, the day-by-day launch playbook, and the outward-facing material. All of it is a **proposal**: nothing here overrides `docs/spec/DECISIONS.md` until the owner records it there (D-37 / D-38 are suggested in the files).

The owner's own plan stays where it is: [`../terraagent-master-plan-final.md`](../terraagent-master-plan-final.md).

## Read in this order

| # | File | What it is | Read it when |
|---|---|---|---|
| 1 | [`MASTER_PLAN_REVIEW.md`](./MASTER_PLAN_REVIEW.md) | Grill of the master plan: 10 conflicts with the repo's decisions and cut, the official track 09 / 07 / 05 requirements it misses, honest odds, ranked unit-neutral changes | first: what is wrong today and what to fix |
| 2 | [`economy-balance-simulation.md`](./economy-balance-simulation.md) | The numbers: stage timing vs spec, terraforming arithmetic, scenario matrix, raid tables, a 7-day planet economy, the recommended balance rows, demo warp timelines | before tuning anything or promising a demo beat |
| 3 | [`GRAND_PRIZE_PIVOT.md`](./GRAND_PRIZE_PIVOT.md) | The bold version: agents as players through an MCP, bounded real NEAR pairs, TEE-attested merchants, a live five-planet season; unit ledger, calendar, kill switches | when deciding scope for Nov 1 |
| 4 | [`LAUNCH_PLAYBOOK.md`](./LAUNCH_PLAYBOOK.md) | Nov 1–18 build × comms schedule, drafted X posts, Telegram / Discord scenarios, judge-awareness stance, asset checklist, submission procedure, rules table | daily during the hackathon |
| 5 | [`public/whitepaper.md`](./public/whitepaper.md) | Outward-facing whitepaper draft (mechanics, trust boundary, mock/real table; no token promises) | to share with anyone outside the repo |
| 6 | [`public/landing-brief.md`](./public/landing-brief.md) | Copy for every section of `frontend/landing.html`, with the stale claims flagged | when the landing gets its text pass |
| 7 | [`public/media-plan.md`](./public/media-plan.md) | Demo clip and trailer scripts, GIF / screenshot / diagram lists, capture days | when recording assets |
| 8 | [`near/README.md`](./near/README.md) | **On-chain and NEAR feature reference for grooming** (8 files, ≈ 2 500 lines): accounts and keys, mining and cargo, markets and trading rules, agents and communication, deed / staking / treasury / bounties, NEAR tools and adapters; every rule with a status and source; owner-decision list, numbers sheet, 129 open questions, and a wave-by-wave grill checklist ([`near/08-wave-grill-checklist.md`](./near/08-wave-grill-checklist.md)) | before grooming any wave that touches the chain |
| — | [`tools/economy_sim.py`](./tools/economy_sim.py) | The calculator behind every table in file 2 | to rerun or change a number |

```bash
python3 -I docs/hackathon/tools/economy_sim.py matrix     # colony scenarios A1–A11, R1–R8
python3 -I docs/hackathon/tools/economy_sim.py planet     # 7-day planet economy
python3 -I docs/hackathon/tools/economy_sim.py raids      # battle v1 raid arithmetic
python3 -I docs/hackathon/tools/economy_sim.py terraform  # closed-form terraform table
```

## Owner decisions these files ask for

| Decision | Where it is argued |
|---|---|
| Adopt the balance rows (kit, Clear yield, per-sub caps, capacitor, tier gate as a Living count, Hub T2 at 25 % T2, Processor 0.3, Guild sink) as `balance.overrides.json` | file 2 §8 |
| Take the pivot (drop W11, W14, W04; add the Agent API / MCP, NEAR pairs, attested Guild, the season) | file 3 §3 |
| Start real NEAR on D6 with two extra agents | files 1 §5, 3 §3 |
| Answer Q10 (NEP-245 deposit into `intents.near`) on Nov 1 | file 3 §2, file 4 §2 |
| Record D-37 (master-plan decisions) and D-38 (the pivot) in `DECISIONS.md`, then regenerate the schedule | file 3 §8 |
