# Autonomous Colony — Game Specification
**NEAR Hackathon 2026 · Games With Real Economies Track**

**Working title:** SectorForge / ColonyLink / TerraAgents  
**Genre:** Autonomous colony builder (Factorio-lite) with indirect control  
**Platform:** Web (NEAR)

---

## 1. Core Concept

Player selects a planet and drops a basic founder robot. The colony then operates mostly autonomously: robots mine, build, trade with other colonies, defend, and terraform.  

The player exercises **indirect control** through a task queue and high-level priorities. An AI orchestrator (director) makes tactical and strategic decisions.

**End goal:** Colonize and terraform an entire sector by launching rockets to new planets.

---

## 2. Resources

Three resource families, each with three tiers (D-34). **T1 is available from landing; T2 and T3 only after terraforming** (the colony's Terraform % and the ground around the extractor). Energy is not a family: it is grid power.

| Family | T1 (from landing) | T2 (after terraforming) | T3 (after more terraforming) | Primary use | Sources |
|---|---|---|---|---|---|
| **Metals** | Iron | Light alloys (copper, aluminium) | Titanium | Robots, buildings, rockets | Metals Extractor on metal deposits; Harvester |
| **Minerals** | Silica | Rare earths | Exotic crystal | Advanced components, electronics | Minerals Quarry on mineral deposits; Harvester |
| **Bio** | Water and Biomass (two T1 sub-resources) | Petroleum / organics | Gene-stock | Fuel, cooling, terraforming, biology | Water Extractor (water); Harvester clearing forest (biomass) and harvesting Living ground (gene-stock); Petroleum Well on oil deposits (petroleum / organics) |
| **Energy** | — | — | — | Everything (grid power, E/s; stored only in capacitors) | Multiple generator types (§3) |

Stock keys: `metals.t1 … metals.t3`, `minerals.t1 … minerals.t3`, `bio.water`, `bio.biomass`, `bio.t2`, `bio.t3`. Unlock thresholds, yield split and cost reading: [`colony-economy-and-buildings-spec.md`](./colony-economy-and-buildings-spec.md) §3.0. Every sub-resource trades as its own cargo token, so a colony can buy T2/T3 before it can mine them.

**Starting resources:** The founder robot begins with a small balanced stock of the T1 sub-resources (iron, silica, water, biomass).

---

## 3. Energy Production

| Station Type     | Pros                          | Cons                          | Best On          |
|------------------|-------------------------------|-------------------------------|------------------|
| Coal / Oil       | Cheap, fast to build          | Consumes fuel, pollutes       | Any              |
| Wind             | No fuel                       | Weather & location dependent  | Open areas       |
| Hydro            | Efficient                     | Requires water                | Rivers / coasts  |
| Solar            | Clean, scalable               | Weak at night / bad weather   | Desert           |
| Nuclear          | Very high output              | Expensive & slow to build     | Late game        |

---

## 4. Production & Terraforming

- **Factories** are required for advanced buildings, robots, and the rocket.
- Basic chains: Raw resource → Processing → Components → Buildings / Units.
- **Terraforming** requires clearing terrain (trees, rocks, etc.), specialized machines, and continuous water + energy consumption.
- Different regions of the same planet have varying resource density.

---

## 5. Planet Types

Three types (D-33), one-to-one with the worlds on the landing page and the render looks. Generator numbers: [`SIMULATION.md`](../spec/SIMULATION.md) §7.6 and §10.

### 5.1 Desert (`desert`, Kharon Dunes, look `dune`)
- Rich in Metals and Minerals deposits, scarce water (Water Extractor ×0.5)
- Sandstorms
- Solar is more effective (+35 %)

### 5.2 Ocean (`ocean`, Thalassa Verde, look `oceanForest`)
- Much water and forest; rich Bio deposits, poorer Metals
- Hydro-friendly coasts; land must be reclaimed from the sea
- Frequent storms (×1.5)

### 5.3 Temperate (`temperate`, Granite Hollow, look `forestRock`)
- Baseline; richer Minerals deposits
- Forests that must be cleared
- Cold, long nights (45 % of the day)

The hackathon demo runs on Temperate only (D-27). Ice / Cold is not a planet type.

---

## 6. Events & Hazards

Examples (vary by planet type):
- Lightning (damages power grid)
- Meteorites (local destruction, sometimes reveal new deposits)
- Storms / Hurricanes (temporary production penalty)
- Radiation anomalies
- Floods / Thaws

Events force the colony (and orchestrator) to repair, rebuild, or reprioritize.

---

## 7. Fauna

- Alien creatures of varying aggression.
- Attack miners and outlying buildings.
- Require turrets / combat robots (cost metals, minerals, energy).
- Clearing nests reduces attack frequency.
- Different species per planet type.

---

## 8. PvP

- Colonies can attack each other (combat robots or short-range rockets).
- Attacks and defense both consume resources and energy.
- Possible goals: raid storage, slow the opponent, or (advanced) capture territory.
- Full colony capture is intentionally expensive.

---

## 9. Progression & Multi-Planet

1. Colonize and terraform the current planet (control % + terraforming level).
2. Accumulate resources for a **Rocket**.
3. Launch rocket and choose the next planet in the sector.
4. Start on the new planet with partial carried-over resources or an upgraded founder.

Sector = multiple planets. Long-term goal is sector-wide colonization / dominance.

---

## 10. AI Orchestrator (Low Token Cost)

### Architecture
```
Player (queue + priorities)
        ↓
Colony Contract (state + queue)
        ↓
Rule Engine (90–95% of decisions)
        ↓
LLM Orchestrator (rare, event-driven)
        ↓
Actions (NEAR Intents, build orders, trades, defense)
```

### LLM Call Rules
- Only on significant events (new neighbor, critical shortage, major attack, rocket decision, etc.).
- Maximum ~1 call per 5–10 minutes per colony.
- Very short prompts.
- Most behavior handled by the rule engine, which already knows planet type, hazards, and resource map.

### Example Short Prompt
```text
Planet: Desert | Water: critical | Solar: high | Neighbor offer: water for metals
Player priority: expand
Current: 3 miners, 1 solar, low defense

Decision (1-2 sentences + actions):
```

---

## 11. NEAR Integration

- **Robots / Colony** — sub-accounts or accounts with function-call keys / Chain Signatures.
- **Resource trades** — NEAR Intents.
- **Player actions** — meta-transactions + social login (chain stays mostly invisible).
- **Orchestrator** — can initiate intents and write tasks on-chain.
- Optional: NEAR AI / MCP for the orchestrator agent.

---

## 12. MVP Scope (2-week Hackathon)

- 3 planet types (`desert`, `ocean`, `temperate`; the hackathon demo uses Temperate only)
- 3 resource families with T1–T3 sub-resources, plus Energy as grid power; 3–4 energy station types
- Basic factories and 1–2 production chains
- Simple fauna (1–2 creature types)
- 2–3 event types
- Rocket → second planet transition
- Rule-based orchestrator + occasional LLM calls
- Inter-colony trading via NEAR Intents
- Indirect control via task queue

---

## 13. Design Pillars

1. **Indirect control** — player sets intent, colony executes.
2. **Economy is gameplay** — every action costs resources/energy; trade and production matter.
3. **Planet uniqueness** — same systems produce different optimal strategies per planet.
4. **Low LLM cost** — rules first, LLM only for high-level or exceptional decisions.
5. **Chain is invisible** — players interact with the colony, not with wallets and transactions.

---

*Document version: 1.0 · NEAR Hackathon 2026*
