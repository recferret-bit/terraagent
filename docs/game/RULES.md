# TerraAgent — Multi-Agent Swarm, Colony AI & Custody Rules (`RULES.md`)

> Canonical ruleset for **Track 09 (Games With Real Economies)**, **Track 07 (Agent Economy)**, and **Track 05 (AI Swarms)**.

## 1. Game & Economy Loop (30 Seconds / 5 Minutes / Session)

- **Every 30 Seconds (Micro Colony Loop):**
  Workers harvest Tier-1 resources (`metals.t1`, `minerals.t1`, `bio.water`, `bio.biomass`), generators balance the day/night solar + storage grid, and construction/terraforming queues advance tiles from raw terrain → `Flat` (`TERRAFORM [G]`) → `Irrigated` → `Living` (`CULTIVATE [V]`).
- **Every 5 Minutes (Planetary Market & Diplomacy Loop):**
  Colonies export surplus resources at their Trade Hub (`NEP-245` cargo tokens) and trade against **2 autonomous Rival AI Colonies** and **Orbital Guild NPC merchant ships** (`Kestrel` & `Vanguard`) whose quotes shift dynamically from inventory and 24h VWAP (`docs/game/GUILD_PRICING.md`). Colonies dispatch Recon squads to **raid** unshielded rivals (`2 units/s` depot siphon, capped at `25%`) or negotiate **bilateral peace truces** (`2h / 6h / 24h / 72h`).
- **Per Session (Planetary Progression & On-Chain Settlement):**
  Expanding `Living` green tiles across colony territory advances Stage `S0 → S4` (`100% Living Planet`), settling the colony's dynamic **NEP-171 Colony Deed NFT** on NEAR, funding **Mercenary Bounty Escrows** against raids, and compounding Planet Treasury boosts.

---

## 2. Multi-Agent Roster & On-Chain Sub-Accounts (`NEAR_MODE=testnet`)

Every economic actor on a planet owns an isolated NEAR account (`*.<root>.testnet` in `NEAR_MODE=testnet`, deterministic `*.terraagent.mock` in zero-key `NEAR_MODE=mock`):

| Actor | Account Pattern | Role on the Shared Planet |
| :--- | :--- | :--- |
| **Player Colony** | `{pilot}.<root>.testnet` / `col-{n}.{pilot}.<root>.testnet` | **100% Human-controlled by default** while online. Switches to AI Director control only when the player clicks **`AI AUTOPILOT: ON`** or goes **offline**. |
| **Rival AI Colony #1 (Trader)** | `rival-trader-{planet}.<root>.testnet` | Established Stage 3–4 autonomous neighbor (`conservative` risk, `trade`/`terraforming` focus): posts liquidity on `/v1/trade/orders`, terraforms to `Living`, defends, and favors peace truces. |
| **Rival AI Colony #2 (Warlord)** | `rival-warlord-{planet}.<root>.testnet` | Established Stage 3–4 autonomous neighbor (`risky` risk, `expansion`/`diplomacy` focus): trades shortages, launches `raid_target` offenses against unshielded neighbors, and negotiates truces when outmatched. |
| **Orbital Guild NPCs** | `kestrel.npc.<root>.testnet`, `vanguard.npc.<root>.testnet` | Scheduled orbital merchant ships quoting two-sided barter spreads from live stock ratios (`docs/game/GUILD_PRICING.md`), with 10% off-planet sink and restock per visit so prices evolve without developer patches. |

---

## 3. Agent Authority vs. Human-Only Safety Guardrails (Track 07 Custody Checkpoint)

### What the Colony AI Agent CAN Do (When `AI AUTOPILOT: ON` or Player is Offline)
1. **Economy & Grid:** Queue extractors, solar/wind/thermal power, supply depots, and outpost beacons (`establish_colony`, `grow_economy`, `secure_power`).
2. **Terraforming:** Run `terraform_zone` (`Grade/Clear → Irrigate → Seed`) whenever `bio.water` and `bio.biomass` exceed the policy's safety reserve (`40%` conservative / `15%` risky).
3. **Autonomous Trading:** Place and cancel resource orders on `/v1/trade/orders` strictly inside the player's **per-resource allowance budget** and maximum slippage guard, emitting one verifiable receipt + rationale string per trade.
4. **War & Peace (Opt-In Policy Toggle):**
   - Dispatch `raid_target` against unshielded rivals when `Allow War & Diplomacy` is enabled (default `ON` for `risky` & Rival AIs, `OFF` for `conservative` unless toggled).
   - Propose (`proposeTruce`) and accept (`respondTruce`) bilateral peace treaties (`2h–72h`), and auto-hire mercenary defense squads (`EscrowPort`) when raided while away.

### What the AI Agent CANNOT Do Without the Human Owner (Hard Server-Enforced Blocks)
1. **NEVER Break an Active Truce Early (`AW-13` / Oathbreaker Guard):** Cancelling an active truce triggers a 10-minute notice window and brands the colony **`OATHBREAKER`** for 24 hours (blocking all future truce offers). Only a human click can cancel an active truce.
2. **NEVER Touch User-Wallet NEAR Staking (`D-18`):** Native `NEAR` validator staking (`StakingPort`) requires a settled Colony Deed and a direct user wallet signature — neither the relayer nor any AI director key can stake or unstake user `NEAR`.
3. **NEVER Exceed Trade Allowance or Bypass Kill Switch:** Every AI trade checks the colony's server-enforced director allowance (`DirectorKey`) and global/per-colony kill switch before hitting the orderbook or relayer; any manual player override increments `intentRevision` and immediately supersedes open AI directives (`stale_revision`).
4. **NEVER Demolish Player Buildings While Away (`AW-10`):** Away AI cannot dismantle existing player-placed structures.

---

## 4. Dual Execution Modes: Zero-Key Deterministic Simulation vs. Verifiable NEAR AI Cloud

- **Scripted Deterministic Mode (`AI_PROVIDER=mock`, `NEAR_MODE=mock` — Zero Keys Required):**
  Runs 100% deterministically out of the box (`npm run dev` and `/dev/economy-sim` 60-second 7-day fast-forward) using `@terra/sim` goal executors and the Guild inventory power-law pricing curve — zero LLM API keys or RPC keys required.
- **Verifiable TEE Inference + Live Testnet Mode (`AI_PROVIDER=nearai`, `NEAR_MODE=testnet`):**
  Upgrades Colony AI and Guild strategy prompts to **NEAR AI Cloud** (`https://cloud-api.near.ai/v1`, Intel TDX + NVIDIA TEE GPUs) with SHA-256 request/response hash binding verified against `/v1/signature/{chat_id}`, and settles NEP-245 Cargo, NEP-171 Colony Deeds, and Mercenary Bounty Escrows on **NEAR Testnet** (`testnet.nearblocks.io`) alongside live **NEAR Intents 1Click** (`dry: true`) cross-asset quotes.
