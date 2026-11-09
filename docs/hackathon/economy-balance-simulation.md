# TerraAgent — Economy & Terraforming Balance Simulation

> **D-44 supersedes the fee rules below (2026-11-04).** The buyer pays the platform fee (100 bp) and the maker stall's fee (0-100 bp, default 100) in the pair's **quote token**, independent of maker/taker role; the fee is never taken from the received token and there is no 50-300 bp or 0-3 % range. W22's treasury share is carved out of the platform fee. See [ECONOMY](../spec/ECONOMY.md) §3 and [NEAR](../spec/NEAR.md) `NEAR-61`. Older fee statements in this file are historical.

> **Status:** 2026-10-31, design-time calculation for the hackathon build; pass 4 (2026-11-02): every mode re-run and diffed, inputs checked against the specs, the W01/W02 worktree data tables (`../TerraAgent-wt/w01|w02/shared/sim/src/data/`) and the dev commands on main; §5.1 re-runs the key scenarios with the inputs that moved. Every number here is either taken from the specs (`colony-economy-and-buildings-spec.md`, `units-orders-and-progression-spec.md`, `SIMULATION.md`, `near-economy-features-spec.md`, the W10/W13/W15/W22 wave files) or marked **(proposed)**. Proposed values are D-35 data rows: the owner tunes them in playtests with `tune`.
> **Calculator:** [`tools/economy_sim.py`](./tools/economy_sim.py) (`python3 -I -B docs/hackathon/tools/economy_sim.py matrix|colony|terraform|planet|raids|hex|current`; no argument runs every mode except `colony` and `current`). It is a design tool, not game code: a 1-second colony model (Model A) and a 1-slot-per-30-min planet model (Model B). The headless reference bot of the units spec (§8, P-H) must confirm these numbers before anyone tunes the tables.
> **Companion:** [`MASTER_PLAN_REVIEW.md`](./MASTER_PLAN_REVIEW.md) grills the master plan against this data and the track rules.

## 0. What the simulation says in five lines

1. **S0–S3 pace as the units spec intends** (S3 ≈ 7 min), but only with the right build order; S4 lands at ≈ 25 min against a 15-min target. The kit of OWNER_TASKS R11's proposed default (400 / 250 / 150 / 150) leaves **10 minerals** of slack before the Quarry and **0 biomass income** until a Worker Drone T1 clears forest: two dead-ends a new player hits in the first 10 minutes (§3.2). **Moved (2026-11-02):** the W01 code ships the units spec's pod cargo 600 / 350 / 200 / 200 instead; with it (and the other inputs that moved) both dead-ends are gone and S4 lands at 12:35 (§5.1).
2. **D-34 doubles the time to S5.** The Hub T2 upgrade needs 160 `metals.t2` + 100 `minerals.t2` + 150 `bio.t2`. Solo, that means Terraform ≥ 30 %, which a two-drone colony reaches at **57–70 min**, not the spec's 25 min. A trader who exports T1 and buys T2 from the Guild reaches S5 at **53–60 min**. The market is a real but modest shortcut (§5). With the §8 rows (gate as a Living-tile count, Hub T2 at 25 % T2) the solo colony reaches **S5 at 51 min and S6 at 56 min** (§5, R8); with the inputs that moved, 45 and 50 min (§5.1).
3. **Terraform % is capped by footprints and punished by expansion.** Buildings cannot be Living, so a colony tops out near **78 %** of its owned tiles. Every Beacon adds ≈ 136 tiles to the denominator, so a colony that expands reaches 30 % *later* (43 min without beacons, 57 min with one, 70 min with two). The rocket gate already excludes footprints, walls and deep water (`UO-R-01`, SIMULATION §7.7), so the ceiling hits the tier gates and the score, not the rocket (§4).
4. **The Terraforming Processor at 0.5 tiles/s (B1) takes a colony from 30 % to 70 % in 13 minutes** (two drones take 56); at 0.1 tiles/s it never reaches 70 % in 150 min. **0.3 tiles/s (proposed)** does 30 → 70 % in about 50 min, so T3 lands around 1 h 45 from landing, a second-session milestone rather than an instant one (§4.4). With the inputs that moved, 0.3 misses 70 % within 150 min (§5.1): re-run before choosing.
5. **The planet economy needs a sink.** Each of five colonies may mint 20 000 units per sub-resource per day (W10-06); two Guild NPCs absorb 5 000 each. Without an off-planet Guild sink the Guild is full within hours, T1 prices pin at the full-Guild price (0.5× reference) and the "economy that evolves" stops evolving on day 1. Fees are small: at 1 % stall fee and 20 % treasury share a planet funds **one** 1 000-unit treasury project per week (§7).

## 1. Inputs

| Input | Value | Source |
|---|---|---|
| `ECONOMY_RATE_SCALE` | 0.25 → Metals Extractor T1 1.0/s, Quarry 0.75/s, Water Extractor 0.875/s, Worker Drone T1 0.5/s, Thermal fuel 0.375 biomass/s. Terraform water (25 W per Living tile, Processor −4 W/s) is **not** scaled here; `UO-S-03` lists "terraform water use" as scaled (Q3) | units spec §6.4, `UO-S-03`, D-16; code: W02 `shared/sim/src/data/_compile.ts` (scales `outputPerS`, `harvestRatePerS`, `upkeepPerS`, `waterPerS`, `ammoPerS`) |
| Day | 20 min, 55 % daylight (sine curve), Solar T1 +21 gross × daylight, Wind +16 × 0.5–1.4 | SIMULATION §7.6; code: W02 `economy-t1-basic.ts` (`dayLengthS` 1 200, temperate night 0.45, Solar 21 gross) |
| Starting kit | 400 metals.t1 / 250 minerals.t1 / 150 biomass / 150 water; Hub T1 claims hex R 10 = **331 tiles**; storage 500 per family. **Moved:** units spec §6.4 S0 and W01-09 use the pod cargo **600 / 350 / 200 / 200**, and the W01 code ships it with pre-Hub pod-hold caps 600 / 500 / 500 ("a Hub never lowers a cap"); SIMULATION §7.2 says the units spec supersedes §7.3's kit. R11 is still an open owner question (Q7); `current` uses 600 / 350 / 200 / 200 | SIMULATION §7.3, OWNER_TASKS R11; code: W01 `hq.ts` `startingKit`, W02 `hub.ts` (`claimRadius` 10, `storageCapPerFamily` 500) |
| Founder Core / HQ cell | +8 E/s; cell 1 000 E (2026-10-31 assumption). **Moved:** the cell is **800 E**, recharge 3 E/s anywhere and 20 E/s near a powered Hub (`UO-HQ-06`; W01 `hq.ts` `cellCapacity` 800); `current` uses 800 | D-16, `UO-HQ-06`; code: W01/W02 `hub.ts` `founderCoreGenPerS` 8 |
| Build costs, drains, build times | economy spec §3; T2 items pay 60 % T1 + 40 % T2 of M and Min, Pet in `bio.t2`. Rows checked against W02 data (Metals Extractor, Solar, Worker Drone T1, Hub T1: equal). Recon is 55 / 30 / 15 / 0, 14 s, 2.5 E/s (units spec §5.2); the baseline runs used a 60 / 30 / 10 / 0, 12 s, 2.0 E/s placeholder, `current` uses the spec row | economy spec §3.0, D-34, units spec §5.2; code: W02 `economy-t1-basic.ts`, `units-workers-basic.ts` |
| Terraform ops | Grade 3 s / 20 E; Clear 5 s / 30 E (+5 biomass); Irrigate 10 s / 80 E / 15 W; Seed 15 s / 90 E / 10 W + 5 Min; Living tile from Flat = **28 s, 190 E, 25 W, 5 Min** at 1.0× | units spec §4.5 |
| Terrain mix (temperate, among owned tiles) | Flat 56 % · Forest 20 % · Rock 8 % · Slope 8 % · Hole 2 % · Shallow 4 % · Deep 2 % (2026-10-31 split, read from SIMULATION §10 under R12; never a spec value). **Moved:** SIMULATION §10 now ends "terrain mix follow units spec §4.5", and the W01 generator uses that table: **45 / 25 / 8 / 10 / 2 / 6 / 4** (planet-wide; the spawn guarantee keeps ≥ 60 % Flat within R 4, `UO-TF-09`); `current` uses it | units spec §4.5, SIMULATION §10; code: W01 `worldgen.ts` (temperate `share*`) |
| Tier gates | T2 at Terraform ≥ 30 % (+ deposit ring, not modelled), yield 70/30; T3 at ≥ 70 %, yield 50/30/20 | D-34, economy spec §3.0; code: W02 `resources.ts` (`minTerraformPct` 30 / 70, ring 2, ring ratio 0.5, `yieldShare` 0.3 / 0.2) |
| Beacon T1 | R 8; placed 10 tiles from the Hub it adds **136** new tiles (217 − overlap) | economy spec §3.1, hex arithmetic |
| Trade Hub T1 | 250 units/min export; daily mint cap 20 000 per sub-resource per colony | W10-02, W10-06 |
| Guild | 2 NPCs, inventory cap 5 000 per sub-resource, spread 4 % → 15 %, docks 12 min every 20–40 min, `mid = ref × (target/inventory)^k` | W15-02, W15-06 |
| Fees | buyer pays platform 100 bp + stall 0–100 bp (default 100) in the quote token; W22 treasury 20 % of the platform fee **(D-44; older 0–3 % / 0.25 % figures are historical)** | W13-12, W22, master plan §7 |
| Load shedding | group 1 terraform → group 2 Factory / Trade Hub → group 3 extractors / depots; defenses, Hub, DCA and robots stay on | economy spec §1 rule 2 |
| Raids | `2 + threatStage` Skitters (120 HP, 8 DPS, one bite/s), cap 12, +1 per Thermal Plant; every 10 min with 10 % + 5 % × Thermal chance; not before S3 + 5 min | units spec §6.3 (`UO-T-01..04`), §5.6, B11; W07-14, W07-15 (Planned) |

Model A simplifications: one scripted build order (the §6.4 reference order, extended to S6; the Petroleum Well is ordered at S4 in every run, so the spec's S2 unlock and R9's S5 are not tested), construction before units when stock is short, drones work the cheapest terrain first, the HQ counts as a 1.0× worker on both lanes at once (spec: 1.5×, one job at a time, `UO-L`; the Hub T1's 30 s at 1.0× is modelled as the HQ's 20 s; `current` sets 1.5×), the T2 deposit ring is not modelled, pylons cost but have no reach model, no fauna damage. Model B ignores production detail and treats each colony as a daily surplus (6 k → 25 k units per T1 sub-resource per day as it grows, **proposed**).

## 2. The paper game loop (track 09 asks for this before any code)

| Cadence | What the player does | What the economy does |
|---|---|---|
| **Every 30 s** | Reads the family bar and the power line; places one order (a building, a drone, a terraform brush); accepts or ignores one Guild offer; watches a shuttle leave | Storage fills in 5–25 min (§7.1), so every half minute the player decides *spend, export or lose it*. Export is the valve |
| **Every 5 min** | A stage beat: a new building type, the first night, a raid, a Guild docking, the terraform % crossing a line (10 / 30 / 70 %), a treasury vote | Night sheds production for 9 of every 20 min unless the grid is sized for it (§3.3); a Guild visit re-prices every pair; a raid costs 110–430 metals of defense (§6) |
| **Every session (30–45 min)** | Reaches the next tier or the next terraform gate; sets the away budget and autoTrade limits; checks "while you were away" | T2 unlocks change what the colony mines and sells; the director trades overnight within the allowance; the deed card updates |

The 30-second loop exists only if the Trade Hub is open early (the `TRADE_HUB_AT_S2` demo flag, W10-03, Planned) and the Guild docks often enough; W15's 20–40 min interval means a 40-minute session sees about one visit per NPC, about two with both W15-02 NPCs on one planet (§7.4).

## 3. Progression

### 3.1 Reference solo run (recommended numbers: Clear yield 25, per-sub-resource caps, one Beacon)

Model A run A11 (`colony` mode), 150 min, temperate, no trading, no Processor, 2026-10-31 inputs (R11 kit). Stock columns are the T1 sub-resources (M = `metals.t1`, Mi = `minerals.t1`, W = `bio.water`, Bio = `bio.biomass`); M2 / Mi2 / B2 are the T2 stocks. Power is the instantaneous generation / drain at that minute (day or night). `brown` = cumulative seconds of production shed. `tE` / `tW` = energy and water spent on terraforming so far.

| min | stage | Terraform % | Living | owned | M | Mi | W | Bio | M2 | Mi2 | B2 | gen / drain E/s | supply | cap/family | brown s | tE | tW |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | S0 | 0 | 0 | 331 | 200 | 150 | 100 | 100 | 0 | 0 | 0 | 8 / 0 | 0 / 10 | 500 | 0 | 0 | 0 |
| 10 | S3 | 0 | 0 | 331 | 20 | 75 | 385 | 475 | 0 | 0 | 0 | 69 / 34 | 1 / 10 | 1 500 | 0 | 964 | 0 |
| 20 | S3 | 0 | 0 | 331 | 17 | 131 | 607 | 415 | 0 | 0 | 0 | 38 / 56 (night) | 1 / 18 | 1 500 | 318 | 1 206 | 0 |
| 30 | S4 | 4.2 | 19 | 467 | 244 | 52 | 737 | 1 501 | 0 | 0 | 0 | 150 / 119 | 7 / 18 | 2 500 | 365 | 5 828 | 486 |
| 40 | S4 | 17.0 | 78 | 467 | 2 124 | 564 | 676 | 2 191 | 0 | 0 | 0 | 97 / 119 | 7 / 18 | 2 500 | 428 | 17 004 | 1 956 |
| 50 | S4 | 23.6 | 108 | 467 | 2 500 | 1 218 | 1 330 | 1 966 | 0 | 0 | 0 | 122 / 119 | 7 / 18 | 2 500 | 491 | 22 745 | 2 712 |
| 60 | S4 | 33.0 | 151 | 467 | 2 500 | 1 833 | 1 829 | 1 741 | 158 | 67 | 94 | 130 / 119 | 7 / 18 | 2 500 | 493 | 30 888 | 3 783 |
| 70 | S6 | 47.2 | 216 | 467 | 2 830 | 1 522 | 1 006 | 1 506 | 293 | 13 | 52 | 96 / 166 | 9 / 41 | 3 500 | 720 | 43 619 | 5 405 |
| 80 | S6 | 58.1 | 266 | 467 | 3 500 | 1 373 | **8** | 1 306 | 455 | 57 | 112 | 138 / 166 | 9 / 41 | 3 500 | 1 224 | 55 117 | 6 655 |
| 90 | S6 | 65.3 | 299 | 467 | 3 500 | 1 624 | 369 | 1 081 | 1 218 | 260 | 395 | 110 / 166 | 9 / 41 | 3 500 | 1 372 | 63 402 | 7 480 |
| 110 | S6 | 72.8 | 333 | 467 | 3 487 | 1 605 | 803 | 631 | 2 043 | 480 | 700 | 143 / 166 | 9 / 41 | 3 500 | 2 083 | 74 772 | 8 330 |
| 140 | S6 | 73.2 | 335 | 467 | 3 500 | 2 098 | 2 543 | **0** | 3 194 | 787 | 1 126 | 72 / 166 | 9 / 41 | 3 500 | 3 201 | 75 307 | 8 380 |

Milestones: Hub 0:47 · Depot 8:19 · Factory 12:32 · **S4 24:49** · Beacon 25:21 · Petroleum Well 28:06 · Terraform 30 % **57:29** · **Hub T2 (S5) 62:28** · Factory T2 (S6) 67:35 · 50 % 71:12 · 70 % 102:42 · ceiling 73 % (footprints).

### 3.2 Stage timing against the units-spec targets

| Stage | Spec target | Model A (solo) | Model A (trader, T2 at 4× T1) | Why |
|---|---|---|---|---|
| S1 Hub | 1:00 | 0:47 | 0:47 | HQ prep + Hub build (30 s at 1.0×, 20 s for the 1.5× HQ) |
| S2 Extractor + generator | 3:00 | 1:45 | 1:45 | Solar must come **before** the Extractor and Quarry, or the Founder Core's 8 E/s cannot carry the 14 E/s of two extractors and the HQ cell drains in 3 min |
| S3 First Contact | 8:00 | 6:45 | 6:45 | S2 dwell 5 min |
| S4 Shape the Land | 15:00 | 24:49 | 25:39 | Factory + first combat unit + 6 min dwell; the Factory (30 biomass) and the Recons wait for biomass. **With the W01 pod cargo: 12:35** (§5.1) |
| S5 Second Tier | 25:00 | **62:28** | **52:57** | Hub T2 needs T2 sub-resources (D-34): Terraform ≥ 30 % or purchases. **With the §8 rows (R8): 50:36 solo** |
| S6 Combined Arms | 32:00 | 67:35 | 67:02 | Factory T2 Δ + 5 min dwell. **§8 rows: 55:36** (80–85 min if the Processor is ordered before the Factory T2) |
| S7–S10 | 40 min – 1:30 | not modelled | | Post-hackathon (W17–W19); T3 needs 70 % (≈ 100 min solo) |

**Two early dead-ends found by the model (both are the R11 kit, not the rates; neither occurs with the W01 pod cargo, see the end of this section):**

- **Minerals.** 250 at landing − Hub 100 = 150 for Solar 75 + Extractor 20 + Quarry 30 + Worker Drone T1 15 = 140. **10 left.** Any other order before the Quarry runs (Worker Drone T3 30, Worker Drone T2 25, Wind 35, a second Worker Drone T1 15) stalls the colony with no minerals income. The spec's own pacing table used the 600/350 pod cargo and did not see this.
- **Biomass.** 150 at landing; the Hub (50), Solar (10), Water (10), Depot (10), Factory (30), DCA (10), two turrets (20) and Worker Drone T2 (10) use 150. Biomass income is **only** forest clearing (5 per tile, finite: a colony's ≈ 66 forest tiles hold 330 biomass) until Living ground gives gene-stock at T3. The Thermal Plant burns 22.5 biomass/min, so one fuel load of a whole forest lasts 15 min.

Proposed fixes (pick one per line): keep the W01 pod cargo **600 / 350 / 200 / 200** (350 − 100 − 140 leaves 110 minerals; biomass 200), or, if R11's kit is chosen, **400 / 300 / 200 / 150**; Clear yield **25** biomass per forest tile (the model uses it from §3.1 on); Worker Drone T1 on Living ground yields **0.5 biomass/s** from S4 (D-34 only gives `bio.t3` at T3); a Hub auto-suggestion "Quarry before anything else".

### 3.3 Power at night

The reference colony sheds production for **37–42 % of all seconds** between minutes 20 and 120 (the `brown` column). Night is 45 % of the cycle; Solar is 0 at night, Wind averages 15 E/s per station, and the Capacitor T1 holds 1 500 E with 30 E/s discharge, which covers a 30 E/s deficit for **50 seconds of a 540-second night**. A colony that wants its extractors on all night needs either 7–8 Wind stations, a Thermal Plant per 25 E/s (fuel per §3.2), or capacitors 5–10× their listed size. **Proposed:** Capacitor T1 stores 6 000 E (T2 20 000, T3 60 000), discharge unchanged; or Wind T1 +24 gross. Without this, "Night Shift" (10 nights with no brownout) is unreachable before S6.

## 4. Terraforming

### 4.1 Colony arithmetic (hex R 10 = 331 tiles, 2 % deep water excluded, 70 footprint tiles at S5)

Drones take the cheapest tiles first: Flat (28 s, 190 E), then Forest (+5 s / +30 E), Rock, Slope, Hole, Shallow water (+14 s / +200 E / 20 M + 10 Min).

| Target | Living tiles | 1 drone | 3 drones | Energy | Water | Minerals | Reachable? |
|---|---|---|---|---|---|---|---|
| 30 % (T2 gate) | 98 | 46 min | 15 min | 18 600 E | 2 450 | 490 | yes |
| 50 % | 163 | 80 min | 27 min | 32 400 E | 4 075 | 815 | yes |
| 70 % (T3 gate) | 228 | 117 min | 39 min | 48 100 E | 5 700 | 1 180 | yes, with Rock/Slope/Hole/water work |
| 100 % Terraform % (`UO-TF-06`) | 325 | — | — | — | — | — | **no: ceiling 78 %** (footprints stay in the `UO-TF-06` denominator and cannot count as Living, `UO-TF-04`). The rocket gate `UO-R-01` excludes footprints, walls and deep water, so it is reachable |

With the units spec mix (45 / 25 / 8 / 10 / 2 / 6 / 4, `current` mode) the targets are 96 / 159 / 223 tiles, the work times are within 1 min of these and the ceiling is 78.0 %. These are pure work times; the model's wall-clock times are 1.5–2× longer because terraforming is shed first at night, waits for water (W hits 0 at minutes 80 and 100 in §3.1) and shares drones with site prep. Energy for 70 % is ≈ 75 000 E over two hours (10 E/s average), small against a 100–150 E/s grid; **water** is the binding input: 8 400 water by 70 %, against two Water Extractors at 105 water/min. That holds only if `ECONOMY_RATE_SCALE` does not apply to Irrigate/Seed water; if it does, the bill is 4× smaller (Q3).

### 4.2 The denominator problem

Terraform % = Living ÷ owned (`UO-TF-06`). A Beacon placed at 10 tiles adds 136 owned tiles and no Living tiles.

| Territory | Owned | 30 % needs | Model A time to 30 % | Time to S5 |
|---|---|---|---|---|
| Hub only | 331 | 98 | 43 min | 57 min |
| Hub + 1 Beacon | 467 | 138 | 57 min | 62 min |
| Hub + 2 Beacons | 603 | 178 | 70 min | 78 min |

The S4 lesson is "expand and reclaim", and expanding delays the tier that S5 teaches. **Proposed:** gate tiers on **Living tiles inside the Hub's R 10** (98 / 228 tiles), or on an absolute count (100 / 250 Living tiles), and keep the colony-wide % for score and the deed. The rocket gate already reads "every owned tile that is not a footprint, wall or deep water is Living" (`UO-R-01`).

### 4.3 Planet level (five colonies, hex R 56 = 9 577 tiles)

| Measure | Value |
|---|---|
| Owned by 5 colonies, one Beacon each | 2 335 tiles (24 % of the planet) |
| Living at 70 % per colony | 1 635 tiles = **17 % of the planet** |
| Living at 30 % per colony (demo end state) | 700 tiles = 7 % of the planet |
| Water for 5 colonies to 70 % | 42 000 water; energy 375 000 E |

The master plan's orchestrator prompt uses a single "Terraform %" of the planet. Define it as **Σ Living ÷ Σ owned tiles** (so the demo planet shows 20–40 %), not Living ÷ all planet tiles (which would show 3–7 % and never move). The 0.15 %/s "planet score" in the Processor row is the Hub's 331 tiles, not the planet.

### 4.4 Drones vs the Terraforming Processor (Model A with the §8 rows, Hub T2 at 50:36, 30 % at 52–55 min)

| Living-ground tool after S5 | Nominal rate | Water / tile | Energy / tile | 50 % at | 70 % at | 30 → 70 % | Verdict |
|---|---|---|---|---|---|---|---|
| 2 drones only (HQ + Worker Drone T3) | 0.08 tiles/s | 25 | 170 | 80 min | 111 min | 56 min | the S4–S5 phase; night shedding and water make it 2× slower than its work time |
| 4 drones (R6) | 0.16 | 25 | 170 | 84 min | 124 min | 72 min | no better (slower than 2 drones to 70 %): terraforming is shed 42–48 % of the time and water hits 0; drones are not the limit (§5, A4 / R6) |
| Processor **0.5 tiles/s** (B1) | 0.5 | 8 | 50 | 55 min | **65 min** | **13 min** | finishes the colony before the player has used the drones it just paid for |
| Processor **0.3 tiles/s (proposed)** | 0.3 | 13 | 83 | 62 min | 103 min | 50 min | T3 at ≈ 1 h 45 from landing; drones still matter at S4–S5 |
| Processor 0.2 tiles/s | 0.2 | 20 | 125 | 81 min | 128 min | 75 min | barely faster than drones |
| Processor 0.1 tiles/s | 0.1 | 40 | 250 | 127 min | never (150 min) | — | slower than the drones it replaces |

Model assumption: with a Processor present the drones Grade ahead of it until 30 Prepared tiles are waiting, then help with Irrigate/Seed; the Processor only converts Prepared tiles (`UO-TF-08`). The Processor runs are shed for ≈ 57 % of seconds (R8 45 %, R6 48 %) because the reference build never adds generation after S4, so the effective rates are about half the nominal ones. **Proposed: 0.3 tiles/s, −6 W/s, −30 E/s.** With the inputs that moved (§5.1) the 0.3 run sheds 67 % of seconds and does not reach 70 % in 150 min, and 0.5 reaches it at 104 min against 111 for drones only, so the Processor rate must be re-run with a build that adds generation after S5 before it is tuned.

## 5. Scenario matrix (Model A, 150 min, 2026-10-31 inputs; `matrix` mode)

| # | Scenario | S4 | S5 | S6 | 30 % | 50 % | 70 % | end % | water for TF | shed % | exported |
|---|---|---|---|---|---|---|---|---|---|---|---|
| A1 | Spec defaults: Clear 5, family caps, 2 drones, 2 Beacons | 24:49 | **never** (biomass fills the Bio cap, water starves) | — | 69 min | 91 | 136 | 79 | 11 700 | 38 | 0 |
| A2 | + Clear yield 25 | 24:49 | 139:52 | 144:52 | 71 | 94 | 118 | 83 | 12 200 | 22 | 0 |
| A3 | + per-sub-resource caps | 24:49 | 78:29 | 83:29 | 70 | 93 | 125 | 77 | 11 300 | 40 | 0 |
| A4 | A3 + 4 drones | 24:49 | 79:01 | 84:01 | 70 | 91 | 130 | 74 | 10 900 | 42 | 0 |
| A5 | A3 + Processor 0.5/s (B1) | 24:49 | 78:29 | 83:29 | 70 | 85 | **89** | 78 | 7 500 | 48 | 0 |
| A6 | A3 + Processor 0.1/s | 24:49 | 78:29 | 83:29 | 70 | 89 | — | 56 | 9 200 | 49 | 0 |
| A8 | A3 + Trade Hub, Guild T2 = 4× T1 | 25:39 | **52:57** | 67:02 | 70 | 110 | — | 59 | 8 800 | 50 | 9 166 |
| A9 | A3 + Trade Hub, Guild T2 = 8× T1 | 25:39 | 60:06 | 80:59 | 74 | 110 | — | 59 | 8 800 | 47 | 11 043 |
| A10 | A3, no Beacons | 24:49 | 57:08 | 62:08 | **43** | 59 | — | 68 | 5 500 | 51 | 0 |
| A11 | A3, 1 Beacon (the §3.1 run) | 24:49 | 62:28 | 67:35 | 57 | 71 | 103 | 73 | 8 400 | 42 | 0 |
| **R8** | **§8 rows, solo, no Processor:** kit 400/300/200/150, Clear 25, per-sub caps, Capacitor 6 000, gate 100 / 230 Living tiles, Hub T2 at 25 % T2, 1 Beacon (the Well is at S4 in every run) | 24:49 | **50:36** | **55:36** | 55 | 80 | 111 | 73 | 8 400 | 45 | 0 |
| R7 | R8 + Processor 0.3/s after S5 | 24:49 | 50:36 | 84:55 | 53 | 62 | **103** | 73 | 5 900 | 57 | 0 |
| R4 | R8 + Processor 0.5/s | 24:49 | 50:36 | 80:31 | 52 | 55 | 65 | 73 | 4 700 | 57 | 0 |
| R6 | R8 + 4 drones | 24:49 | 48:35 | 54:38 | 52 | 84 | 124 | 73 | 8 400 | 48 | 0 |
| R9 | R7 with 2 Beacons | 24:49 | 55:28 | 105:50 | 59 | 85 | — | 69 | 7 200 | 57 | 0 |
| R10 | R7 + Trade Hub, Guild T2 = 4× T1 | 25:39 | 47:28 | 84:15 | 51 | 65 | 104 | 73 | 5 900 | 60 | 3 649 |

Readings:

- **A1 → A3 is the D-34 shared-cap trap.** A full Bio family (biomass from forest clearing) halts the Water Extractor, and a full Metals family at 2 500 discards the `metals.t2` the colony just unlocked (A1 and A2 waste 13 800 and 24 000 units in 150 minutes; A3 still wastes 11 700 at the per-sub-resource caps). **Proposed: cap per sub-resource** (each T1 sub-resource gets the family cap; T2/T3 get half), or auto-export when a sub-resource is at cap and a Trade Hub is online.
- **A8 vs A3:** trading cuts S5 from 78 to 53 min. The gain is bounded by the Trade Hub's 250 units/min and by when the hub is built (24 min). A hub at S2 (the demo flag) and 2 Guild visits in the first 40 min might bring S5 under 40 min (not modelled). The Guild T2 price (4× or 8× T1) matters less than the throughput.
- **A4 = A3:** the four Worker Drones (T3) are built (the model confirms `worker` tier 3 ×4), and 30 % still arrives at 70 min. Terraforming is shed first at night (42 % of all seconds in this build) and water runs dry; power and water limit the terraform lane at S4, not the number of drones.
- **R8 vs A11:** the §8 rows alone (no Processor, no trading) move S5 from 62 to **51 min** and S6 from 68 to **56 min**. The spec's 25-min target is not reachable while S5 depends on terraforming at all; 51 min (45 min with the inputs that moved, §5.1) is the honest "second tier in the first hour".
- **R7 vs R8:** the Processor is a T1 purchase (200 / 180 / 80 / 100 at 40 s) that competes with the Factory T2 for stock and adds 25–30 E/s at night; ordered first, it delays S6 to 85 min. The Hub's suggestion card should put the Factory T2 ahead of the Processor.
- **R9:** a second Beacon still delays S5 by 5 min and S6 by 20 min even with the count-based gate, because the extra tiles pull drones onto expensive terrain (Rock, Slope, water) and the prep bill grows. That is the intended cost of expansion.
- **R10 vs R7:** buying the Hub T2's T2 share from the Guild moves S5 from 51 to 47 min. (Until 2026-11-02 the script's trader bought the D-34 bill of 160 `metals.t2` even when the §8 Hub T2 needs 100; the R10 row is the corrected run.)

### 5.1 Re-run with the inputs that moved (2026-11-02, `current` mode)

Same build orders, with the W01 pod cargo 600 / 350 / 200 / 200 (overrides the §8 kit in the R rows too), the units spec §4.5 terrain mix, HQ cell 800 E, HQ 1.5× on both lanes and the units spec Recon row (§1).

| # | S4 | S5 | S6 | 30 % | 50 % | 70 % | end % | water for TF | shed % | baseline S4 / S5 / S6 |
|---|---|---|---|---|---|---|---|---|---|---|
| A1 | 12:35 | 147:06 | — | 59 | 82 | 122 | 84 | 12 100 | 38 | 24:49 / — / — |
| A3 | 12:35 | 64:03 | 82:02 | 59 | 79 | 127 | 76 | 10 900 | 44 | 24:49 / 78:29 / 83:29 |
| A8 | 13:55 | 48:47 | 82:35 | 56 | 104 | — | 63 | 9 100 | 50 | 25:39 / 52:57 / 67:02 |
| A10 | 12:35 | 39:40 | 47:11 | 34 | 52 | — | 65 | 5 200 | 61 | 24:49 / 57:08 / 62:08 |
| A11 | 12:35 | 47:56 | 54:16 | 43 | 64 | 110 | 74 | 8 300 | 52 | 24:49 / 62:28 / 67:35 |
| R8 | 12:35 | 44:56 | 49:56 | 41 | 78 | 111 | 74 | 8 300 | 53 | 24:49 / 50:36 / 55:36 |
| R7 | 12:35 | 44:56 | 49:56 | 41 | 85 | — | 63 | 5 500 | 67 | 24:49 / 50:36 / 84:55 |
| R4 | 12:35 | 44:56 | 49:56 | 41 | 81 | 104 | 73 | 5 100 | 67 | 24:49 / 50:36 / 80:31 |

Readings:

- **The kit is the big mover.** Alone it moves S4 to 12:45 and S5 by 7–14 min; the HQ's 1.5× moves S5 by 1–4 min; the mix, the 800 E cell and the Recon row move S4 and S5 by ≤ 1 min each in the one-Beacon runs (the mix moves A10's S5 by 6 min and gives A1 an S5 at 148 min). S4 is now inside the 15-min target, and the §3.2 dead-ends do not occur. Later milestones (S6 with a Processor, 70 %) flip with small build-order changes in this scripted model (R4's S6 moves 22 min with the Recon row alone), so read them as ± 15 min.
- **S5 is still terraforming-bound:** 48 min solo (A11), 45 min with the §8 rows (R8), 49 min for the trader (A8). The §8 rows now buy 3 minutes, not 12; the per-sub-resource caps still matter (A3 64 min).
- **The Processor conclusion (§4.4) does not survive the re-run:** R7 and R4 now build the Processor at 45:51, one minute after the Hub T2 and before the Factory T2, and still reach S6 5 min after S5, but night shedding (67 %) starves it, so 0.3 tiles/s ends at 63 % and 0.5 reaches 70 % only 7 min before drones alone. Re-run with a generation step after S5 before choosing B1's value.
- These runs are the reference for the next tuning pass once W01 and W02 land; the headless bot (units spec §8, P-H) replaces them.

## 6. Fauna, defense and the "den" numbers

Battle v1 arithmetic (one bite per second, focus fire, defenders die in order; `economy_sim.py raids`), raid of `2 + threatStage` Skitters (no Thermal Plant; each one adds a Skitter, `UO-T-02`):

| threatStage | Raid | 1 Autocannon (55 M) | 2 Autocannon (110 M) | 2 Autocannon + 2 Recon (220 M) | 3 Autocannon + 1 Laser (215 M) | 4 AC + 2 Laser + 2 Recon (430 M) |
|---|---|---|---|---|---|---|
| S3 | 5 Skitters, 600 HP, 40 DPS | loses in 12 s | wins, 17 s | wins, 10 s | wins, 8 s | wins, 5 s |
| S4 | 6 · 720 HP · 48 DPS | loses | wins, loses 1 turret | wins | wins | wins |
| S5 | 7 · 840 · 56 | loses | **loses** | wins | wins | wins |
| S6 | 8 · 960 · 64 | loses | loses | wins, loses 1 | wins, loses 1 | wins |
| S8 | 10 · 1 200 · 80 | loses | loses | wins, loses 2 | wins, loses 1 | wins |
| S10 | 12 · 1 440 · 96 | loses | loses | **loses** | wins, loses 3 | wins, loses 1 |

So the defense bill is about **one turret per stage** (≈ 55–60 metals and 3–8 E/s each), i.e. 2–4 % of a colony's metals income, plus repairs. Raids every 10 min at 10 % chance (+5 % per Thermal) means one raid per 100 min per colony at S3; a colony with two Thermal Plants sees one every 50 min. That is too rare for a 10-minute demo and about right for a session.

**The master plan's Fauna Den (§5) against the existing data:** SIMULATION §7.6 already has nests (1 per ≈ 400 tiles, 1 500 HP, 1 Skitter per 900 ticks, max 6 alive; W07-14, Planned) and the units spec scales raids by stage. The den table's 80–140 HP / 12–22 damage units contradict the Skitter row (120 HP, 8 DPS), and its "4–12 per wave" duplicates `2 + threatStage`. **Proposed: implement "habitat pressure" as three data rows on the existing nests, not a new building:**

| Row | Default | Effect |
|---|---|---|
| `nest.angerPerLivingTile` | +1.5 pressure per Living tile within 10 of a nest, cap 100 | pressure raises `raidChance` from 10 % to 10 % + 0.3 % × pressure (max 40 %) and raid size by +1 per 25 pressure |
| `nest.spawnModifier` | 0.6–1.8, from the orchestrator or the rules | multiplies the 900-tick spawn interval |
| `nest.maxOnPlanet` | 3 near colonies | the orchestrator never exceeds it |

Destroying a nest (the "Den Hunter" achievement) costs an army, not "400 metals + 250 minerals". Keep the +25 global pressure on destruction: it makes nest clearing a planet-wide decision, which is what the treasury vote needs.

## 7. The planet economy (Model B: 5 colonies, 7 days, one Guild pair)

### 7.1 The cap hierarchy

| Limit | Binds after | Value |
|---|---|---|
| Storage per family (Hub 500, +1 000 per Depot) | **5–25 min** of production | the real pacing lever: the player must spend or export |
| Trade Hub throughput (T1 250/min) | every minute | 360 000 units/day, never binding at T1 |
| Daily mint cap 20 000 per sub-resource per colony | after 80 min of saturated export | one Extractor T1 makes 86 400 metals/day, so the cap is 23 % of one extractor |
| Guild inventory cap 5 000 per sub-resource per NPC | **within hours** at 20 k/day/colony (Model B spec row: the Guild is full by hour 9 and the price sits at 0.5, the full-Guild price; the 0.25× clamp floor is never reached) | the Guild stops bidding; T1 prices pin to the floor |
| Guild T2 stock (seeded, no restock rule) | day 2–3 | T2 asks run out; the trader path closes |

### 7.2 Price paths (`metals.t1`, reference 1.0, `k = 1`, clamp 0.25×–4×)

"Sink" = the share of its stock the Guild sells off-planet **per docked visit**; the spec schedule (12 min dock + 20–40 min gap) gives ≈ 34 dockings a day per NPC, the proposed schedule (§7.4) 48. Model B pools both NPCs' stock, so the per-NPC count is the drain rate. `planet` mode prints every row.

| Scenario (proposed values in bold) | Minted/week | Guild volume | Player-to-player | Price hour 6 → hour 36 → day 3 → day 6 | Guild stock day 6 | Treasury/week | Stall fees/week | Protocol fee/week |
|---|---|---|---|---|---|---|---|---|
| Spec: cap 20 k, Guild cap 5 k / target 2.5 k, no sink | 1.77 M | 22 500 | 531 000 | 0.61 → 0.5 → 0.5 → 0.5 (Guild full from hour 9) | 10 000 (full) | 1 062 | 4 248 | 1 383 |
| + sink 10 % per visit | 1.77 M | 682 000 | 531 000 | 1.03 → 0.52 → 0.5 → 0.5 | 10 000 (full) | 1 062 | 4 248 | 3 032 |
| **cap 10 k** + sink 10 % | 0.99 M | 666 000 | 297 000 | 1.03 → 0.55 → 0.54 → 0.54 | 9 266 | 594 | 2 376 | 2 406 |
| cap 10 k + sink 10 % + **Guild cap 10 k / target 3 k** | 0.99 M | 693 000 | 297 000 | 1.18 → 0.66 → 0.62 → 0.62 | 9 676 | 594 | 2 376 | 2 474 |
| cap 10 k + Guild 10 k / 3 k + sink **25 %** | 0.99 M | 693 000 | 297 000 | 2.39 → 1.69 → 1.69 → 1.69 | 3 548 | 594 | 2 376 | 2 474 |
| **cap 10 k + Guild 10 k / 3 k + sink 10 % + 48 visits/day (the §8 set)** | 0.99 M | 693 000 | 297 000 | **1.46 → 0.85 → 0.82 → 0.82** | 6 562 | 594 | 2 376 | 2 474 |
| same, `k = 0.5` | 0.99 M | 693 000 | 297 000 | 1.21 → 0.92 → 0.91 → 0.91 | 6 562 | 594 | 2 376 | 2 474 |
| cap 5 k + Guild 10 k / 3 k + sink 10 % | 0.53 M | 367 000 | 157 500 | 1.35 → 1.24 → 1.24 → 1.24 | 4 838 | 315 | 1 260 | 1 312 |
| §8 set, fee 2 %, half of exports traded peer-to-peer | 0.99 M | 495 000 | 495 000 | 1.89 → 1.19 → 1.15 → 1.15 | 4 687 | **1 979** | 7 919 | 2 475 |

Model B is coarse (one surplus profile per colony age, a fixed player-to-player share), so read the shapes, not the decimals. (Before 2026-11-02 the `k = 0.5` and fee-2 % rows were run at 34 visits a day, not with the §8 set their labels name; they are corrected above.)

- **A sink is mandatory.** Mint caps only slow the flood. The Guild must sell part of what it buys off-planet (cross-planet carry is W15-10, post-hackathon, so for the hackathon it is a decay row: `guild.offPlanetSalePerVisit = 0.10`). The §8 set is the row whose price moves on day 0–1 (1.46 → 0.85) and then settles mid-range with the Guild holding two thirds of its cap, so it keeps bidding and keeps re-pricing. Rows pinned at 0.5 (a full Guild) or at 4.0 (the clamp ceiling: `planet` row "ceiling case", cap 10 k, Guild 10 k / 8 k, 25 % sink) are both frozen economies.
- **`k = 1`** (inventory doubles → price halves) gives visible moves on a dock (1.46 → 0.85 on day 0–1); `k = 0.5` moves half as far (1.21 → 0.92), too flat for a demo. Keep the clamp at 0.25×–4× so a dump cannot zero a pair.
- **The Guild needs a T2 restock rule:** +300 of each T2 sub-resource per NPC per day **(proposed)**; otherwise the trader path (§5, A8) dies on day 2 when the seed is sold. Model B's T2 leg is too crude to set the number: it prices T2 against the restock itself, so with 600 or 300 per NPC per day the T2 ask sits at its 2.0 floor from day 1. Keep restock at or below the colonies' T2 demand (≈ 600/day for five colonies, i.e. ≤ 300 per NPC) and tune it in playtests.
- **Treasury:** at 1 % fee × 20 % share a planet collects ≈ 1 000 units a week: one Terraform-boost project (cost 1 000). For a demo that shows a vote passing and its effect, either seed the treasury, or take the treasury leg from **Guild trades too** (0.2 % of Guild volume ≈ 1 400/week with the §8 set, 693 000 × 0.2 %), or price projects at **200–300** units. Proposed: treasury share 20 % of stall fees **plus 0.2 % of every Guild fill**, project costs 300 (boost) / 450 (shield) / 250 (subsidy).

### 7.3 Monetization (the master plan's variant 1)

| Flow | Per planet-week (Model B, cap 10 k + sink) | Per planet-week at 20 k | Note |
|---|---|---|---|
| Protocol fee 0.25 % of all settled volume | ≈ 2 500 cargo units | ≈ 3 000 with the 10 % sink (1 400 without) | paid in **cargo tokens**, never NEAR, until a NEAR/USDC pair exists (Later / mock) |
| Stall fees to players (1 %) | ≈ 2 400 | ≈ 4 200 | |
| Treasury (20 % of stall fees) | ≈ 600 | ≈ 1 100 | |

In the hackathon the protocol fee is a visible line in the settlement toast and a growing balance on the project account; it has **no NEAR value**. Say so in the README. For a post-hackathon projection: 200 planets × 3 000 units × a NEAR pair would need an assumed cargo price; at an illustrative 0.0001 NEAR per unit (nothing in the repo sets one) that is ≈ 60 NEAR a week. The sustainable lines are the ones the plan lists as "later": premium order slots, priority Guild visits, skins.

### 7.4 Guild visit cadence

With docking 12 min and 20–40 min between visits, each NPC is docked ≈ 29 % of the time and a 40-minute session sees about one of its visits. W15-02 has two NPCs (Kestrel, Osprey); if both serve the one hackathon planet (W15-10: with W11 off a route loops back to it), then on independent seeds a ship is docked ≈ 49 % of the time and a session sees about two visits, but nothing keeps them apart. **Proposed for the hackathon planet:** the two NPCs on offset schedules (one is always within 10 min of docking), dock 15 min, 10–20 min gaps, so every session has two re-pricings and the "accept offer" beat is always available. `guild.summon` (W15-28, Planned) stays for the demo.

## 8. Recommended balance numbers (all proposed, D-35 data rows)

| Row | Spec / plan today | Proposed | Why (section) |
|---|---|---|---|
| Starting kit | 400 / 250 / 150 / 150 (SIMULATION §7.3, R11 default); 600 / 350 / 200 / 200 in units spec §6.4, W01-09 and the W01 code | **keep 600 / 350 / 200 / 200**; if R11's kit is chosen, **400 / 300 / 200 / 150** | §3.2 minerals and biomass dead-ends, §5.1 (owner: Q7 → R11) |
| Clear yield (biomass per forest tile) | 5 | **25** | §3.2 the only biomass source before T3 |
| Worker Drone T1 on Living ground | `bio.t3` at T3 only | **+0.5 biomass/s from S4**, `bio.t3` at T3 | §3.2 ties terraforming to fuel |
| Storage caps | per family | **per sub-resource** (T1 = family cap, T2/T3 = half) | §5 A1 → A3 |
| Capacitor T1 / T2 / T3 storage | 1 500 / 5 000 / 18 000 E | **6 000 / 20 000 / 60 000 E** | §3.3 nights are 9 min |
| T2 / T3 gate | 30 % / 70 % of owned tiles | **100 / 230 Living tiles** (count, not share; colony % stays for score and the deed) | §4.2 expansion must not delay tiers; R8 / R9 |
| Hub T2 T2-share | 40 % of M and Min in T2 | **25 %** (100 `metals.t2`, 63 `minerals.t2`), Pet 150 `bio.t2` | §3.2 / §5 R8: S5 at 51 min solo instead of 62–78 (45 instead of 48 with the inputs that moved, §5.1) |
| Rocket gate | 100 % Living, footprints, walls and deep water excluded (`UO-R-01`, SIMULATION §7.7) | no change: the spec already reads this way | §4.1 |
| Terraforming Processor T1 | 0.5 tiles/s, −4 W/s, −25 E/s | **0.3 tiles/s, −6 W/s, −30 E/s** (30 → 70 % in ≈ 50 min after S5; 0.5 does it in 13). Re-run first: with the inputs that moved 0.3 misses 70 % in 150 min (§5.1) | §4.4, §5.1 |
| Petroleum Well unlock | S2 (R9 proposes S5) | **S4** | the Hub T2 that triggers S5 needs 150 `bio.t2`; a Well at S5 deadlocks solo play |
| Daily mint cap | 20 000 / sub-resource / colony | **10 000** | §7.2 |
| Guild inventory cap / target | 5 000 / (unset) | **10 000 / 3 000** per sub-resource per NPC | §7.2 |
| Guild off-planet sale | none (carry is W15-10, later) | **10 % of stock per docked visit** (data row) | §7.2 the sink |
| Guild T2 restock | seed only | **+300 per T2 sub-resource per NPC per day**; T2 ref price 4× T1 (metals), 5× (minerals), 4× (bio); T3 12× | §5, §7.1 |
| Guild `k` / clamp | unset | **1.0 / 0.25×–4×** | §7.2 |
| Guild schedule | dock 12, gap 20–40 min | **dock 15, gap 10–20, two NPCs offset** | §7.4 |
| Treasury income | 20 % of stall fees | **20 % of stall fees + 0.2 % of Guild fills** | §7.2 |
| Treasury project costs | 1 000 / 1 500 / 800 | **300 / 450 / 250** | §7.2 one project per demo session |
| Protocol fee | 0.25 % | **0.25 %**, shown in the toast, paid in cargo | §7.3 |
| Fauna "den" | new building, own unit stats | **three rows on the existing nests** (§6) | §6 |
| Raid chance | 10 % + 5 % × Thermal per 10 min | **+0.3 % per habitat-pressure point, max 40 %** | §6 one raid per demo session |
| `ECONOMY_RATE_SCALE` | 0.25 | **0.25** (unchanged) | income is not the limiter after S3; caps and gates are |

## 9. Demo timelines (what to warp, what to seed)

`warp <k>` exists on main (W00-41; `backend/app/src/dev/warp.command.ts`, `docs/dev/DEV_TOOLS.md`): k = 1–100, and the server lowers it if the sim thread cannot keep up. The other dev commands named below are Planned: `guild.summon` (W15-28), `spawnRaid <n>` (W07-29), scenarios `w05-tiers` (W05) and `w17` (W17). One real week at 5 TPS is 3 M ticks: `warp 100` plays it in 100 minutes, not the "about a minute" that track 09 asks for (§9.3).

### 9.1 Scenario A — two pilots terraform (8–12 min on stage)

| Stage minute | Sim minute | What is on screen | How |
|---|---|---|---|
| 0:00 | 0 | S4 colonies at 20 % Terraform, Trade Hubs open, 3 drones each, stock 2 000 T1 | seeded scenario (like W05's `w05-tiers`, W17's `w17`; Planned) |
| 0:00–2:00 | +0–2 | both Hubs, Guild docked (`guild.summon`, W15-28), six offers, one accepted, toast with fee lines | real time |
| 2:00–4:00 | +2–8 | A exports iron, B buys `metals.t2`; book and price board move | `warp 3` |
| 4:00–6:00 | +8–20 | the terraform beat: ≈ 26 → 35 % (the §3.1 run gains ≈ 0.75 % per sim-minute from 20 % and passes 32 % 16 sim-minutes later; extra drones do not help, A4); the T2 chip appears at 30 % | `warp 6` |
| 6:00–8:00 | +20–24 | pressure raid (`spawnRaid`, W07-29), joint defense, market buys turrets' metals | `warp 2` |
| 8:00–10:00 | +24–30 | treasury vote → Terraform boost; drones visibly faster; planet globe greens | `warp 3`; boost −25 % |
| 10:00 | +30 | ≈ 40–50 % Terraform on A (the §3.1 run goes 20 → 40 % in 23 sim-minutes and 20 → 50 % in 28), live book, Guild fees earned | end state |

To reach 40 % from 20 % in 30 sim-minutes a colony needs ≈ 0.7 % per sim-minute. The §3.1 run (two drones) does 20 → 40 % in 23 sim-minutes (21 with the inputs that moved), so the seed needs the §3.1 grid and water, not more drones (A4); the boost is visible but not required. From a cold landing (0 %) the same scene needs ≈ 66 sim-minutes (§3.1; ≈ 55 with the inputs that moved), i.e. a 10-minute demo at `warp 6–7` with nothing to show for the first 25 (13) sim-minutes. **Seed at S4.**

### 9.2 Scenarios B and C

B (Wild AI): the directive is a rule-engine or LLM output; the "mass export" effect is visible within one Guild dock (12 min sim, 4 min at `warp 3`). C (Conflict): with the §6 pressure rows, a colony at 40 % next to a nest raises `raidChance` to ≈ 30 % (≈ 67 pressure points), so a raid lands within 2–3 raid ticks (20–30 sim-min, 7–10 min at `warp 3`; P ≈ 66 % within 3 ticks at 30 %); `spawnRaid` (W07-29) makes it certain. Both fit a 5-minute beat after Scenario A's seed.

### 9.3 "A week of trading in about a minute"

Not the tick engine. An **aggregate economy fast-forward** is Model B: production surplus per colony per 30-min slot, exports under the caps, Guild fills and re-pricing, fee legs, treasury. 336 slots compute in milliseconds; animate them over 60 seconds on the price board (a proposed `/dev/market/fastforward?days=7` page; no wave issue exists yet) with the Guild's reason strings ("inventory 2.1× target → mid −52 %"). It doubles as the pricing-rules page the track asks for: **one readable file** (`data/guild.ts` + the pure `pricing.ts`) and the same reason string in the offer tooltip. Make it a dev page first (one M issue in W15), a judge-facing page if time allows.

## 10. Open questions

| # | Question | Default used here |
|---|---|---|
| Q1 | Hub R 10 is 331 hex tiles; W05's demo text says "Terraform 10 / 412". Which is it? | 331 |
| Q2 | HQ cell capacity (the HQ prepares the Hub site from it) | **Answered:** 800 E (`UO-HQ-06`; W01 `hq.ts` `cellCapacity`). The baseline runs used 1 000 E; `current` uses 800 |
| Q3 | Does `ECONOMY_RATE_SCALE` apply to the Processor's tiles/s, to Clear/Break yields and to terraform water? `UO-TF-05` says Clear/Break yields are lump sums (not scaled). `UO-S-03` lists "terraform water use" as scaled, but the §4.5 op table lists Irrigate/Seed water as a cost per tile, and costs are not scaled. W02 `_compile.ts` scales only `outputPerS`, `harvestRatePerS`, `upkeepPerS`, `waterPerS` and `ammoPerS`, so a Processor `waterPerS` row would be scaled (−4 → −1 W/s) and a tiles/s row would not. If terraform water is scaled, the water bill of §4.1 drops 4× and "water is the binding input" no longer holds | no (water unscaled) |
| Q4 | Does the Construction lane take precedence over the Units lane when stock is short? The model assumes yes; the spec's precedence string is `system > …` | yes |
| Q5 | Guild reference prices for T2/T3 (nothing in the repo sets them) | 4× / 5× / 4× T1; T3 12× |
| Q6 | Who pays the protocol fee leg: taker (with the stall fee) or both sides? | Resolved by D-44: the buyer, in the quote token |
| Q7 | Starting kit: OWNER_TASKS R11's default (SIMULATION §7.3, 400 / 250 / 150 / 150) or the units spec pod cargo the W01 code ships (600 / 350 / 200 / 200, pod-hold caps 600 / 500 / 500)? → OWNER_TASKS R11 | baseline: R11 kit; `current`: W01 kit |
