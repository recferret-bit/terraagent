# Orbital Guild Merchant Pricing Rules (`GUILD_PRICING.md`)

> Single-file specification of NPC Orbital Guild pricing, inventory dynamics, cold-start reference prices, and human-readable offer tooltips (**Track 09 — Games With Real Economies**).

## 1. Merchant Roster & Wallets

Two autonomous Orbital Guild merchant ships dock at persistent planets on staggered schedules, each holding its own inventory wallet (`*.npc.<root>.testnet` on NEAR Testnet, `*.npc.terraagent.mock` in mock mode):

| Guild Ship | Specialty | Cadence | Target Stock (`target_i`) | Max Capacity (`cap_i`) | Spread (`s`) | Elasticity (`k`) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Kestrel Consortium** (`kestrel`) | Industrial Metals & Minerals | Regular orbital dock | `3,000` units | `10,000` units | `6%` (`±3%`) | `1.0` |
| **Vanguard Bio-Logistics** (`vanguard`) | Hydro & Biomass Terraforming Supply | Offset orbital dock | `3,000` units | `10,000` units | `8%` (`±4%`) | `1.0` |

---

## 2. Exact Pricing Formula

For any Tier-1 cargo resource $i \in \{\text{metals.t1}, \text{minerals.t1}, \text{bio.water}, \text{bio.biomass}\}$:

### Step 1 — Reference Price ($\text{ref}_i$) with Cold-Start Fallback
- **Organic Market VWAP (when $\ge 3$ organic trades across distinct colonies exist in the 24h window):**
  $$\text{ref}_i = \text{VWAP}_{24\text{h}}(i)$$
- **Cold-Start Seeded Baseline (when $< 3$ prior trades exist on a young planet):**
  To prevent a cold-start deadlock on newly founded planets, Guild merchants fall back to the canonical baseline parity vector:
  - `metals.t1`: **`1.00`**
  - `minerals.t1`: **`1.20`**
  - `bio.water`: **`0.90`**
  - `bio.biomass`: **`1.25`**

### Step 2 — Inventory Scarcity Mid-Price ($\text{mid}_i$)
Each merchant computes its internal valuation of resource $i$ from its current cargo hold $I_i$ relative to target stock $T_i = 3,000$ (clamped to $[0.25 \cdot \text{ref}_i,\; 4.00 \cdot \text{ref}_i]$):

$$\text{mid}_i = \text{clamp}\!\left(\text{ref}_i \cdot \left(\frac{T_i}{\max(I_i, 100)}\right)^k,\; 0.25\,\text{ref}_i,\; 4.00\,\text{ref}_i\right)$$

- **Surplus in Guild hold ($I_i > T_i$):** $\text{mid}_i$ drops — the Guild discounts its sell price and lowers its buy bid.
- **Shortage in Guild hold ($I_i < T_i$):** $\text{mid}_i$ rises — the Guild pays a premium to colonies supplying scarce resources.

### Step 3 — Two-Sided Barter Quotes & Half-Spread ($h = s / 2$)
For a barter pair offering Guild resource $A$ in exchange for Colony resource $B$:

$$\text{askRate}(A \leftarrow B) = \frac{\text{mid}_A \cdot (1 + h)}{\text{mid}_B \cdot (1 - h)}$$

Plus platform fee (`100 bp` = `1.0%`) and optional maker stall fee (`0–100 bp`), settled atomically.

---

## 3. Off-Planet Sink & Restock (Why the Economy Never Freezes)

On every departure between orbital visits:
1. **10% Off-Planet Export Sink:** If $I_i > T_i$, the Guild exports $10\%$ of its excess $(I_i - T_i)$ off-world (burning surplus inflation from planetary mining).
2. **10% Off-Planet Restock:** If $I_i < 0.5 \cdot T_i$, the Guild restocks $10\%$ of $(T_i - I_i)$ from off-world reserves so depleted terraforming inputs (`bio.water`, `bio.biomass`) recover over time without developer intervention.

---

## 4. Mandatory Offer Tooltip Format (UI Transparency)

Every Guild offer in the **Market / Guild** HUD tab exposes a plain-English `reason` string explaining the exact price driver to the player:

> `"{guildName}: stock {inventory}/{target} ({stockRatio}x target), ref {refPrice} ({priceSource}) → mid {midPrice} ({deltaPct}% vs ref), spread ±{halfSpreadPct}%"`

**Example:**
> `"Kestrel: stock 6,300/3,000 (2.10x target), ref 1.00 (24h VWAP) → mid 0.48 (-52% vs ref), spread ±3.0%"`
