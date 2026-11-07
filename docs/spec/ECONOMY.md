# Resource economy and experiment contract

**Status:** Accepted design, owner direction 2026-11-04 (D-44); implementation is assigned to W13, W15 and W23. This document defines the economy rules, database management and reproducible analysis interface. It does not claim the new tools or migrations already exist.

**Authority:** Extends D-31/D-35 and amends the market fees and Guild exclusivity in D-19/D-26. See [W13](../plan/waves/W13-markets.md), [W15](../plan/waves/W15-guild-agents.md), [W23](../plan/waves/W23-real-near.md), [NEAR](NEAR.md), [data model](DATA_MODEL.md), and [LED-18](../questions-and-limitations/economy-ledger.md#led-18--w13-economy-implementation-and-empirical-calibration-remain-outstanding).

## 1. Economic objective and scope

Players buy resources to accomplish enjoyable goals. Producers earn sales proceeds; platform and stall owners earn explicit service fees. NPCs redistribute funded purchasing power and inventory; they do not create outside demand. No guaranteed prices, buybacks, farming income or appreciation.

Keep the ten existing ResourceKeys and off-chain production. Cargo export removes spendable sim stock and creates its token representation; import consumes the token and restores sim stock. A custody or representation transfer is not resource consumption. Energy stays local grid power.

USDC is the default quote for the cash-market experience. Resource barter remains supported; NEAR is an optional quote. Resource and NEAR balances are reported in their native units; any USDC valuation includes its source, age and confidence. A mark-to-market estimate is not realized revenue.

D-25 remains: no new identity verification or anti-bot programme. Automation uses the same resource, territory, production and trading rules. Test multi-colony supply; per-colony quotas are not a global scarcity guarantee. Starter grants and system subsidies are separate production sources in the ledger and reports.

## 2. Demand and resource balance

| Resource keys | Recurring consumption role | Initial delivery |
|---|---|---|
| `bio.water`, `bio.biomass` | Irrigation, active biological work, fuel | Reuse existing terraform/power recipes; meter consumption while work runs |
| `metals.t1`, `minerals.t1` | Builds, repairs, replacement parts and expendable equipment | Existing construction/repair paths; keep basic inputs in advanced recipes |
| `metals.t2`, `minerals.t2`, `bio.t2` | Advanced equipment and transport supplies | Existing advanced recipes; W13 transport recipe and calibration |
| `metals.t3`, `minerals.t3`, `bio.t3` | Advanced construction, specialist equipment and prestige projects | Existing tier recipes plus optional W13 project recipe |

Every resource must have a production source, at least one repeatable consuming activity, a producer cohort and a potential buyer cohort recorded in the profile. At least one repeatable multi-resource prestige project is playable in W13: a player selects a funded project recipe at the Hub, an existing worker/queue build consumes its inputs progressively, and completion grants a non-tradable colony prestige fact. It grants no cash or production multiplier. Repeating a project requires new resources. Use existing UI and assets; new cosmetics and expedition gameplay belong to later content, not a second W13 engine.

Consumption follows chosen activity. Do not charge new passive absence fees. W09's existing away budgets still govern active work. All recipe changes reuse the canonical queue, progressive payment, refund and eligibility rules; profile version is pinned when a job starts. Candidate recipes cannot bypass placement or supply rules.

Regional specialization starts with a **20–30% delivered-cost advantage hypothesis** (a measured outcome target, not an abundance-weight rule), tested across desert, ocean and temperate. Local basic survival must remain possible. Runtime production and recipe coefficients are configurable; generation parameters remain fixed for an existing world's atlas. External cargo access can reduce regional spreads and must be modeled.

For resource r and time interval t, using one consistent boundary:

```text
inventory_next = inventory + production + imports - consumption - exports
consumption_r = sum(activity_count_a * input_r_a) - recovered_resources_r
potential_buy_r = max(0, planned_consumption_r + desired_reserve_r
                         - available_stock_r - expected_own_production_r)
days_of_inventory_r = available_inventory_r / mean_daily_consumption_r
unit_cost_r = (valued_inputs + equipment_amortization + transport + expected_losses)
              / saleable_output_r
platform_contribution = eligible_quote_volume * platform_fee_rate
                        - treasury_allocations - execution_costs - subsidies - attributed_operating_costs
```

At global scope transfers cancel. Count stock, orbital cargo, verifier holdings and in-flight representations once; reserved assets are a subset, not additional supply. Inventory held by inactive owners is reported separately. Separate actual production from potential output lost to storage caps. A zero consumption denominator yields `null` with reason `no_consumption`, never infinity or a fabricated price.

Preserve whole-unit sim balances with deterministic integer/rational production accumulators; post whole credits through the canonical treasury and persist residual production separately. Existing fractional snapshots require a versioned migration that records whole opening stock and residuals without deleting value. Token import fractions remain in orbital holdings until a whole sim unit can be credited. Refund rounding and residual handling are explicit and shared by all hosts.

All values carry units, window and scope. Separate physical units, nominal quote amounts, estimated valuations and real cash flows. Costs guide decisions but do not set a market price floor. Potential buys become orders only under the actor's price/budget constraints. Balance recipes first in specialist production minutes and progression time; test price elasticity and willingness to pay as uncertain scenario inputs.

### 2.1 Why a player buys or sells

| Situation visible to the player | Reason to buy | Reason to sell | Required feedback |
|---|---|---|---|
| Desert metal specialist, crystal-poor sector | Import crystals for advanced equipment instead of a long, low-yield mining detour | Sell metal surplus above planned builds and reserve | Local production minutes vs delivered purchase cost; abundant/scarce resource badges |
| Water/biomass specialist | Buy industrial inputs for pumps, repairs and expansion | Sell renewable production after operating reserves | Net surplus and next hour's commitments, not gross production |
| A build or refit is missing one material | Complete the planned job sooner | Supply another colony's specific deficit | Queue shortage → exact shopping basket → inclusive quote; estimated saved time |
| A large deployed army or factory cluster consumes supplies | Replenish fuel, coolant and replacement materials repeatedly | Run a local supply business near sustained consumers | Consumption rate, reserve duration, delivery cost and logistics utilization |
| Long routes or overloaded logistics | Buy from a closer source, stock a nearby depot, or expand capacity | Serve a reachable local market with a lower delivered cost | Compare buy/haul/build-depot/reserve-unit alternatives |
| Stock exceeds useful reserves or storage is nearly full | Buy only another resource needed by a selected goal | Convert genuine excess into a scarce input or quote balance | Sellable amount after jobs, orders and safety stock; price floor set by player |

The UI must name the selected goal and its missing quantities. Suggested buys/sells require player confirmation or an existing explicit autoTrade budget; a recommendation never invents a wallet debit. Directors use these same need and cost functions. Rivalry, projects and time-saving are motivations; no reward is paid simply for generating trade volume.

### 2.2 Planet and sector resource endowments

`ECON-GEO-01`: Configure each ResourceKey independently, including tiers. “Crystal” means `minerals.t3`, not the whole minerals family: a desert can be rich in `minerals.t1` silica while poor in exotic crystals. No new sand commodity is required.

Resolve a validated resource map in this order: **global default → planet-type preset → planet ID override → sector archetype → sector ID override**. Each layer replaces explicitly supplied fields; omitted fields inherit, zero is a deliberate value. Store the resolved values, source layer and content hash. Overrides apply by field, never by multiplying every layer accidentally. Planet and sector IDs are the canonical atlas IDs; no renderer chunk IDs or new planet instances.

Each sector profile sets `depositDensityPer1000Tiles` once. Generation fills that total density using normalized resource weights. Each resource row specifies:

- `occurrenceWeightBp`: relative probability weight among eligible deposits, normalized only after geology/tier eligibility; all-zero eligible sets produce no optional deposits, not a uniform fallback.
- `reserveUnitsMin/Max`: size of each finite deposit, distinct from the sector-wide deposit frequency and this resource’s occurrence weight.
- `extractionYieldBp`: output per work unit, affecting both finite reserves and credited output consistently. It cannot credit more finite units than it removes. Renewable sources have a separate versioned `renewableUnitsPerSimHour` sector-total limit; zero means no renewal. All producers share that budget with deterministic allocation; adding extractors cannot multiply the sector allowance.
- `terraformFindWeightBp`, eligible source kinds and extraction tier shares: surface, underground, clearing yields, terraform discoveries, built extractors and renewable production all resolve through the same regional policy. Unlocking T3 does not manufacture the standard 20% crystal share on a crystal-poor deposit. Existing terraforming discovery chances also draw their resource/tier from this policy; no alternate scarcity bypass.
- `starterGuarantee` for essential T1 access and `mainResource` display intent. Main-resource badges must match measured expected recoverable output; reject contradictory profiles. No advanced resource is silently inserted to satisfy the old “every deposit” spawn guarantee. Water/basic industry remain accessible through bounded starter reserves or nearby sources; no cash purchase is required to become operational.

Illustrative **abundance weights**, not fixed prices or live defaults (100 = reference weight):

| Preset | Iron | Silica | Water | Biomass | Exotic crystal |
|---|---:|---:|---:|---:|---:|
| Desert baseline | 150 | 160 | 30 | 20 | 15 |
| Ocean land sectors | 60 | 80 | 180 | 150 | 60 |
| Temperate baseline | 100 | 120 | 110 | 100 | 100 |
| Desert crystal-ridge sector override | inherit | inherit | inherit | inherit | 80 |

These are five sample columns; a validated profile resolves **all ten** resources. A crystal ridge is a valuable local exception within a generally crystal-poor planet. Expected supply also depends on density, reserves, yields, eligibility and depletion; a weight of 15 is not a promise of 15% of global supply. Validate and display realized abundance, not only preset labels.

`ECON-GEO-02`: Endowment generation is pinned to the world's manifest and per-sector resource hash at first world creation, including sectors materialized later by W27. Changing DB settings previews a candidate/new-world fixture; it never regenerates occupied terrain, restores mined deposits or changes hidden reserves on a cache reload. Existing worlds need an explicit value-preserving migration for endowment changes; no such migration is implied by profile activation. Operational yields/renewal for future production windows may change through audited runtime activation, with an effective tick and separate runtime hash. Stored cargo and existing physical reserve units remain intact. The operator panel labels **new-world only** versus **future production** fields.

Resource facts are attributed to the production site's sector, even if the owner or depot is elsewhere. Cross-border footprints resolve output per actual deposit tile, never by a convenient centroid; moving an extractor or cargo cannot change its resource type. Reveals are seeded once by stable tile/event identity; repeated terraform/cancel/reload cannot reroll discoveries. Pre-W11 hosts use the existing whole-planet region; with W11 enabled the same resolver receives canonical sector IDs. No future-wave dependency is required for the single-region case.

### 2.3 Base and army logistics costs

`ECON-LOG-01`: Keep storage capacity, robot command slots and logistics throughput distinct. Existing control-slot limits remain hard recruitment limits. Logistics is an additional resource-consuming service for operating buildings and ready/deployed units; it does not change the seller's market price or take extra USDC automatically.

Use existing Command Hubs and powered Supply Depots as supply nodes, with registered throughput and service-reach fields by tier. No new renderer or parallel pathfinder. Entities are assigned once to an eligible reachable node using cached shared path distances and deterministic tie-breaking; route/capacity changes invalidate affected assignments. Nodes contribute capacity only while commissioned, powered and operational, once per service domain. A service domain is one colony's connected reachable supply network; arbitrary UI sectors or splitting a group into several armies do not create extra free capacity. Global colony load/ledger reports aggregate every domain. Default is no cross-colony capacity sharing.

For each supply window, evaluate intended operating activity before shortages throttle it:

```text
L = sum(building_logistics_weight * operating_fraction)
    + sum(unit_logistics_weight * readiness_factor)
K = sum(available_node_throughput)
u = L / K
congestion = 1 + alpha * max(0, u - 1)^2
M = min(maxMultiplier, congestion)
distanceFactor_i = 1 + beta * min(routeTiles_i / referenceRouteTiles, maxDistanceRatio)
supplyCost_r = sum(baseConsumption_r_i * activity_i * distanceFactor_i) * M
```

`L` and `K` use the same documented logistics-load units per window. Base consumption is units of resource per window; the actual tick duration is converted by the authoritative sim clock. For `K=0` or unreachable routes, mark supply unavailable and use the entity's bounded local reserve; never divide by zero or invent capacity. A route outside service reach is unavailable rather than simply capped to a cheap distance surcharge.

Initial **calibration fixture**: alpha 0.25, maximum multiplier 2.5, beta 0.10, reference route 30 tiles, maximum distance ratio 3. Army readiness factors: reserve 0, ready/garrison 0.25, moving 0.75, combat 1.0; weight and recipe vary by unit type/tier. Operating factories/extractors have load and recipe rows; construction jobs consume their existing build inputs plus separately metered logistics, without silently multiplying pinned build prices. Higher-tier units require higher-grade supplies. Basic robot supplies use common metals/minerals/water/biomass; advanced recipes can add petroleum, alloys and crystals. Existing fuel/coolant consumption is reused or explicitly included once, never double-billed.

| Intended load with K = 100 | Congestion multiplier | Example material bill before distance, at 0.2 units/load/window |
|---|---:|---:|
| 100 | 1.0000 | 20 |
| 150 | 1.0625 | 31.875 |
| 200 | 1.2500 | 50 |
| 300 | 2.0000 | 120 |

Thus doubling activity without more logistics raises the example bill from 20 to 50. At load 200, raising capacity to 200 removes congestion and reduces it to 40, but the extra depots consume construction resources, power and their own operating supplies. This is a controllable cost of scale, not a permanent punishment for progress. A remote route of 60 tiles adds 20% under the illustrative distance settings. These figures are simulation inputs awaiting calibration, not economic promises.

`ECON-LOG-02`: Supply windows use exact accumulated sub-unit costs and canonical ledger postings. Preview windows reserve available inputs, consume only actual delivered service, and deduplicate by domain/entity/window IDs. For a bundled service recipe, delivered fraction is the minimum available/required ratio across its required resources; consume each input in that proportion and release unconsumed reservations. Allocate scarce inputs under the existing player priorities with stable entity-ID ties, not request arrival order. Scale input consumption with delivered service on partial funding; per-resource delivery must conserve inventory. A supply window is its own bounded activity: its profile version, planned load, assignment, multiplier and spend cap are pinned for that window, refreshed next window. Building orders retain their original build recipe. Route loss invalidates undelivered service and releases its unused reservations. Never create fractional float stock or recharge on replay.

Paying the supply bill provides full operation. If supplies are short, the player can buy, shorten routes, build depots, reduce activity or put units in reserve. After local reserves and a configured grace interval expire, production/construction throughput scales by delivered-service ratio. Army work/attack cadence scales by `max(minCombatServiceFraction, deliveredServiceRatio)`; initial minimum 0.5. Movement and retreat stay possible, with no teleport, HP drain, unit deletion, debt or automatic liquidation. Apply the service factor once in the existing work/combat execution paths; attack cadence changes require battle regression tests, not altered damage/armor rules. Current control-slot/power consequences remain separate. The grace timer and reserves persist; reconnect, toggling activity and splitting groups cannot reset them.

Reserve mode stops attack/production and has a versioned deployment delay and activation recipe; it retains command-slot usage, ownership and storage footprint. Toggling reserve cannot grant grace/refill, complete a pending attack or bypass the activation cost. Garrison/ready forces continue to demand supplies while active, including away operation within W09 budgets. No new cost is charged merely for being logged out. Budget exhaustion applies the same supply-shortage response; safe retreat remains available. HUD, away estimates and director orders show next-window bill, reserve duration, congestion and distance components, bottleneck node and remediation. Do not promise indefinite full combat performance without supplies; assess the 50% floor in combat/economy tests.

The logistics purchase estimate is a basket of resources, priced from accessible offers including market fees and actual transport service. Show trade notional, fees and in-game supply consumption separately. A supplied army does not get an extra market surcharge; a larger army buys a larger recurring basket.

## 3. Market and fees

`ECON-MKT-01`: Shared planet books, price-time priority and maker execution price. Default platform fee **100 bp**; stall owner chooses **0–100 bp**, default **100 bp**. Buyer pays both fees in the pair's quote token, independent of maker/taker role. Maker's stall receives the stall fee. Barter explicitly names its base and quote resources; fees are in that quote resource. Configurable ceilings prevent accidental excessive fees; changing ceilings requires a new validated profile.

```text
quote notional 10.00 USDC, platform 1%, stall 1%:
buyer:  -10.20 USDC, +full resource amount
seller: +10.00 USDC, -full resource amount
platform: +0.10 USDC
stall:    +0.10 USDC
```

Aggregate legs when accounts coincide, but retain fee attribution. Same-colony orders do not match. Known same-player colonies and Guild-to-Guild fills are excluded from reference-price and organic-volume metrics; this is not proof that unknown wallets have independent owners. Do not reward raw trading volume with withdrawable subsidies.

Amounts use integer atomic units (`numeric(78,0)` in Postgres, bigint in calculations, decimal strings in JSON). Token metadata defines decimals; display precision never defines settlement precision. Prices are rational integer numerator/denominator or equivalent exact tick-scaled integers; no binary floats in settlement. Round notional and each fee using cumulative floor differences per taker order and `(quote, rate, beneficiary, policyVersion)` bucket, so splitting a fill within a bucket cannot avoid fees. Buyer reservations include maximum quote spend and both fees; seller reservations cover base quantity. Enforce per-pair minimum notional and base lot so separately submitted dust orders cannot bypass fees. Preview exact totals, base quantity, execution/network charges and maximum spend; any slippage cap includes fees.

Each order pins its policy version and fee terms. Compatible policies share platform/rounding terms; the maker stall rate must fit the buyer’s explicit maximum, but need not equal the taker’s own posted stall rate. Reserve that maximum. Match only compatible policies or require cancel/repost after a policy change; never silently increase a standing order's fees. Revalidate funds under lock. Concurrent fills/cancels, retries and unknown chain outcomes cannot release or spend the same reservation twice. Failed final settlement restores executable orders with reservations reacquired atomically; unknown outcomes remain quarantined until reconciled. Keep custodial partial fills and claimed-account all-or-nothing orders.

W22's treasury share is carved out of the platform fee (default 20% of that fee when W22 is enabled), not an extra buyer surcharge and not the stall fee. Report gross platform fee, treasury allocation and retained platform fee separately.

Unrestricted token transfers remain enabled. Accept external-market fee leakage: same-planet is the scope of our book, not a token mobility restriction. Remove the Guild-only cross-planet monopoly claim. An authorized colony can import legally held cargo on its current planet under the normal Hub throughput and import rules. Generic cargo does not carry origin-planet restrictions. Transport work/fuel is charged by published import/export recipes wherever the game performs that service; external wallet transfers themselves incur no game transport charge. Transport jobs pin the recipe and reserve fuel/inputs before starting; consume inputs once against a unique operation ID as actual service runs. Retries of the same mint/burn cannot recharge transport. If the chain fails before service starts release inputs; after service has run preserve its consumption and release unconsumed reservations; any cancel refund on consumed work follows the shared queue rule. Define import headroom before burn and never discard purchased cargo on a full store. Do not add a transfer tax or reserve custody to enforce platform fees.

## 4. Funded bots and reference prices

Player directors use the shared shortage/surplus functions, stock floors, maximum effective prices, order reservations and session spend limits. Outstanding orders count against limits before fills. Reserve allowance on order creation, consume on final settlement and release on cancel/expiry/final failure; a signing operation alone does not spend principal. Revoke cancels unsubmitted orders; already submitted irrevocable settlement must reconcile and remains counted.

Guild funding is an explicit finite treasury allocation. Initial real cargo comes from treasury-owned, stock-backed exported cargo or purchased cargo. Mock seed grants are labeled fixtures and excluded from organic demand. No silent mint exception, automatic refill or unlimited standing buyback.

Profile policy includes per-NPC and global cash ceilings, inventory targets/caps, maximum per-order size, daily spend/loss budgets, reference-price staleness, minimum eligible trade volume and counterparties, max price move, allowed pairs and kill switch. Hard checks run transactionally before reservations/signing, after fills and on restart. Loss includes conservative inventory valuation; if it cannot be valued reliably, pause new cash bids rather than assume zero loss. Persist rolling-window counters so restart cannot reset budgets.

Pure quote function (fixed-point implementation):

```text
mid = reference * clamp((target + epsilon) / (inventory + epsilon), low, high)^k
bid = mid * (1 - bid_half_spread)
ask = mid * (1 + ask_half_spread)
```

`epsilon`, clamps, k and spreads belong to the profile. A full spread of 4% means 2% on each side. Inventory scarcity widens asks; excess inventory reduces bids; cash scarcity reduces bid size or disables bids. Quotes cannot exceed inventory/cash reservations, and must account for fees and transport. Exponentiation has one specified deterministic rounding implementation shared by runtime and experiments.

Reference price uses only finalized eligible trades, a rolling window, per-counterparty weight cap and configured outlier/change bounds. Guild/self/known related trades do not establish the reference. On stale/thin markets, real cash bids pause. A manually funded bootstrap session can use explicit temporary bounded prices, expiry and loss budget; label it subsidy and exclude it from organic-price validation. Re-quote after each fill, cancel invalid resting quotes, and serialize per-NPC updates. LLM route suggestions cannot bypass these checks.

## 5. Database management

Extend the existing NestJS app, Postgres/Prisma and D-35 `compileData`; do not add another configuration service or simulation engine. Sim ticks never query the DB. Export one immutable compiled snapshot to server workers, browser hosts and experiments, all identified by `dataHash` and profile version.

| Planned table | Keys and essential fields | Constraints and purpose |
|---|---|---|
| `economy.profile` | id, name, description, current draft/version references | Named baseline and candidate families |
| `economy.profile_version` | id, profile_id, version, parent_id, schema_version, engine_compatibility, status, content_hash, author, rationale, created_at | Unique profile/version; indexed content hash permits identical clones; immutable content after validation; clone to edit |
| `economy.parameter` | version_id, registered path, typed value JSONB, unit | Unique version/path; registry schema checks type, bounds, enum, tunability and required wave |
| `economy.recipe` | version_id, recipe_id, activity_kind, duration_ticks, eligibility, output/fact, enabled_wave | Registered operations only; no SQL/JS/formula strings evaluated from the DB |
| `economy.recipe_input` | version_id, recipe_id, resource_key, amount_atomic | Composite FK, unique resource per recipe; nonnegative exact integers |
| `economy.resource_policy` | version_id, resource_key, source/consumer IDs, reserve horizon, target inventory band | Ten known keys; full source/consumer coverage check |
| `economy.region_profile` | version_id, region_profile_id, sector archetype, density, resource-map hash | All ten keys; distinguish endowment/new-world fields and operational runtime fields |
| `economy.region_resource` | version_id, region_profile_id, resource_key, occurrence/find weights, reserves, yield, renewal and starter guarantees | Unique profile/resource; typed constraints; one resolved source path for every production mechanism |
| `economy.scope_binding` | version_id, scope_kind, planet_type/planet_id/sector_id/archetype, region_profile_id | Canonical atlas IDs; explicit priority, uniqueness and inheritance provenance; no arbitrary SQL expressions |
| `economy.logistics_policy` | version_id, building/unit/node kind and tier, load/consumption/readiness, capacity/reach, congestion/distance, grace/reserve rules | Registered role/recipe IDs; bounded deterministic coefficients; no stored duplicate unit balances |
| `economy.market_policy` | version_id, pair_id, token metadata, fees, lot/tick/min notional, treasury share | Typed columns and range checks; one policy per enabled pair |
| `economy.agent_policy` | version_id, actor/pool ID, targets, cash/inventory/spend/loss limits, reference rules | Per-actor and aggregate limits; JSONB maps validated against known assets |
| `economy.activation` | id, scope, version_id, previous_id, requested_tick, applied_tick, state, operator, evidence_run_id | One active version per scope; compare-and-swap expected previous version |
| `economy.audit_event` | id, actor, action, version_id, request_id, diff, timestamp | Append-only; unique request ID for mutation idempotency |
| `economy.scenario` | id, version, manifest JSONB, hash | Immutable seeds, populations, shocks and assumptions |
| `economy.experiment` | id, request_id, manifest/hash, status, lease, progress, failure, parent experiment | Idempotent submit; queued/running/completed/failed/cancelled, bounded workers |
| `economy.experiment_run` | experiment_id, candidate_id, scenario_id/version, seed, hashes, status, artifact refs | Unique experiment/candidate/scenario/seed; resumable independent runs |
| `economy.metric` | run_id, window, scope, resource/pair/cohort, metric_key, value, unit, reason | Nullable undefined values; indexed run/window/key; sampled series, not DB writes per tick |
| `economy.gate_result` | run_id, gate_id/version, pass/fail/insufficient_data, observed, threshold | Machine-readable evidence for promotion |

Migrations, foreign keys, indexes and seed/import/export utilities are W13 deliverables. Store balances in existing ledger/cargo tables, not a second profile balance system. Extend orders/trades with policy/version hashes, exact notional, cumulative fee buckets, both fee beneficiaries, actor/funding classification and settlement identifiers. Funding allocations and durable risk counters link to the existing Guild accounts.

An authenticated operator panel provides planet/sector inheritance, resource/recipe/logistics/fee/bot-policy forms with units, validation errors, baseline diff, experiment comparison, activation and rollback history. API/CLI exposes every operation so the UI is optional. Raw DB edits to active rows are not a supported management path. Authorize read, candidate-edit, experiment-run and activate separately; AI experiment credentials have the first three, never live activation or access to signing keys. Operators can activate validated candidates without a code deployment. These are planned product permissions, not an extra approval step for this documentation task.

Version lifecycle: `DRAFT → VALIDATED → APPROVED`; activation is a separate per-scope record. Validation checks schema, recipe cycles/free production loops, reachability, integer safety, conservation, allowed waves and required evidence. Approval records the operator decision; concurrent edits use version guards. Simulation outputs cannot mutate the baseline they evaluate.

Activation records a future tick and payload hash; host persists the transition alongside its checkpoint before acknowledgment. In-flight market orders and started jobs retain their pinned terms; new work uses the new version. Clients receive the same compiled payload/hash at the effective tick. Atomic DB activation/outbox plus idempotent host acknowledgment supports crashes. A DB outage keeps an already loaded snapshot; never revert silently to seed defaults. Rollback schedules a previous immutable version and does not reverse completed trades or rewrite inventory. Cold-start missing versions fail closed for cash actions.

Bundled TS tables remain bootstrap defaults; production uses the pinned database version. Dev `tune` and override files create/export a sandbox candidate and mark the run non-production; they cannot override a live cash profile. Scope resolution is explicit: global → planet type → planet ID → sector archetype → sector ID, with per-field inheritance and resolved provenance (§2.2); compile pinned endowment and runtime hashes; no hidden env override of economic numbers. Generation/atlas endowments are database-configurable before world creation but remain non-live-tunable for an existing manifest. Historical run manifests and activated versions are retained; detailed traces can expire only under a documented retention policy with checksummed summaries retained.

## 6. AI experiment interface

Use the actual `@terra/sim` step/queue/resource rules and extracted shared market/fee/agent pure functions, wrapped by isolated mock adapters. Reuse the scenario runner and compiled data; no independent spreadsheet implementation as authority. A fast analytical recipe/flow calculator may rank candidates, but only integrated sim runs satisfy gates. Pure calculations belong in `shared/sim` or an existing shared package; app orchestration and DB I/O remain in backend/scripts.

A versioned JSON Schema advertises registered parameters, descriptions, units, bounds, defaults, mutability, required wave and dependencies. An AI can discover valid inputs without reading source. Candidate patches use these paths; unknown paths or disabled features fail with structured errors. Export minimal anonymized aggregate snapshots; no private keys, auth tokens or player-identifying records in artifacts.

Planned CLI (not yet available):

```sh
npm run economy -- schema --json
npm run economy -- profile export --id baseline --version 1 --out /tmp/economy-baseline.json
npm run economy -- profile clone --from baseline:1 --name candidate-a --json
npm run economy -- profile patch --id candidate-a --file /tmp/economy-patch.json --json
npm run economy -- validate --profile candidate-a --json
npm run economy -- simulate --manifest /tmp/economy-run.json --json
npm run economy -- experiment status --id exp_123 --json
npm run economy -- experiment cancel --id exp_123 --json
npm run economy -- compare --baseline exp_123 --candidate exp_124 --json
npm run economy -- recommend --experiment exp_124 --json
```

Commands accept files/stdin, never require interactive prompts for experiments, return structured stdout and diagnostics on stderr. Exit codes: 0 success, 2 invalid input, 3 failed gates, 4 execution failure. Async submission returns an ID, not a false completion result. `recommend` produces an explainable candidate patch and evidence; it never activates it. Operator-only activation/rollback are separate audited API operations.

Manifest example (integer amounts serialized as strings):

```json
{
  "schemaVersion": 1,
  "profile": {"id": "candidate-a", "version": 2, "hash": "sha256:..."},
  "engineCommit": "<git-sha>",
  "waves": "..13",
  "scenarios": [{"id": "mature-flat-population", "version": 1}],
  "seeds": [101, 202, 303],
  "warmupTicks": 432000,
  "measureTicks": 12960000,
  "sampleEveryTicks": 18000,
  "ticksPerSecond": 5,
  "budget": {"maxRuns": 12, "maxWallSeconds": 1800, "maxWorkers": 2},
  "behaviorProfile": "specialists-v1",
  "demandModel": {"source": "assumed", "perPayingActorMonthlyBudgetUsdcAtomic": "30000000"},
  "output": {"format": "jsonl", "trace": "failures"}
}
```

The tick values above describe one warmup day and 30 measured days at 5 TPS; they are simulated time, not a performance promise. Record actual TPS, clock scales, snapshot/atlas hash, all dependency versions, run environment, scenario and policy hashes, PRNG seeds, model/provider/prompt version if applicable and every exogenous action. Engine versions must match manifests; never silently substitute latest. Restart uses saved RNG state and pinned inputs. Deterministic policy baselines are required; live model outputs are captured as replayable directives, not treated as seeded randomness. Budget exhaustion produces `incomplete`, never pass.

Outputs: manifest, summary JSON, metrics JSONL/CSV, gate results, confidence intervals across seeds, per-resource flow reconciliation, fee/subsidy/PnL breakdown, candidate diff, rejection reasons and failing-seed replay command. Compare candidates using paired seeds, independent held-out seeds and sensitivity ranges for unknown demand. Search budget and objective/weights are explicit; do not optimize a single scalar revenue target or select only favorable seeds. Pareto comparisons cover retention proxies, progression, affordability, trading depth, inventory growth and net contribution. Player retention and willingness to pay remain empirical inputs, not facts established by bots.

## 7. Test matrix and release gates

Required scenarios: per-planet/per-sector shortage and specialist trade; crystal-poor deserts with crystal-ridge exceptions; no scarcity bypass through tier unlocks/terraform finds; local vs distant providers; growing base/army with fixed and expanded logistics; depot loss, reserve cycling, split armies/colonies and away-budget exhaustion; early colonies; mature colonies with flat population; 2x production capacity; 10x new-colony/automated-account pressure including starter grants; 50% buyer-budget contraction; zero treasury subsidy; inactive holders returning cargo; thin/related-account trades; external venue fee bypass and cross-planet imports; regional specialization; restart/duplicate settlement; loss of chain access. Use enabled-wave fixtures only; future mechanics are labeled counterfactual and cannot pass current-wave release gates.

Hard gates always apply: exact conservation/reconciliation; no negative stock or double spend; bounded funded NPC losses and exposure; reservation/fee rounding correctness; no fee-policy mutation of standing orders; no real credentials/network settlement during experiments; reproducibility; restart and later-waves-off parity. Ledger drift LED-16 must be reconciled before cash activation.

Economic gates are versioned data: regional realized supply and specialist import/export flows, logistics load/cost/shortage by base/army size, distance burden, reserve-mode usage and effective combat service; inventory days and mature growth trend, shortage duration, progression time, specialist delivered-cost advantage, fill ratio/spread, repeat buyer demand, payer concentration, organic vs subsidized volume, realized fee contribution and NPC drawdown. Every resource has explicit threshold/window/cohort coverage before approval; missing observations return `insufficient_data`. Initial numerical targets are calibration hypotheses, not a guaranteed result. Cash launch requires all hard gates, all approved economic gates across baseline/held-out/stress runs, plus a limited real-player pilot showing repeated voluntary purchases. A mock-only demo can ship with uncalibrated economics visibly labeled; it cannot claim cash-launch approval.

W13 lands with schema/DB management, shared accounting, mock USDC fees, regional resource configuration, base/army logistics, at least one recurring project and transport recipe, deterministic headless simulations and comparison reports. W15 adds actual funded Guild/autoTrade stress runs. W23-48 enforces cash modes and W23-49 records pilot evidence. W23 permits a capped smoke trade after technical gates, with no public cash trading until the full pilot/gate record is approved. No calendar deadline waives these gates.

## 8. Management API and operator surface

The planned routes and internal operator UI are enumerated in [DEV_TOOLS](../dev/DEV_TOOLS.md#planned-w13-economy-tooling-d-44-not-implemented-yet). The internal panel extends `/dev/chain/?tab=economy`; production uses the same authenticated management API via the CLI, not a publicly exposed dev page. All mutations carry request IDs and expected versions; scope authorization, pagination and bounded result sizes apply. Operator `activate`/`rollback` commands are separate from AI candidate/run commands.

## 9. AI region and logistics analysis

The schema exposes resolved inheritance and editable regional/logistics paths with units and new-world/runtime mutability. Extend the experiment manifest with `regionBindingsHash`, `endowmentHash`, `runtimeEconomyHash`, `logisticsPolicyHash` and population/base/army distributions. An endowment candidate regenerates an isolated seeded fixture; a runtime candidate starts from the same checkpoint and preserves reserves. Compare both modes explicitly, never interpret different terrain as a yield-only intervention.

Required comparisons: desert crystal weight 15 vs 30 vs 60; identical planets with homogeneous vs specialized sectors; army load 100/150/200/300 under fixed/expanded depot capacity; routes 0/30/60/90 tiles; congestion alpha 0/0.1/0.25/0.5; small/new vs mature colonies; supply-cut and reserve-toggle adversaries; multi-colony exports/imports, allied sourcing and external-market leakage. These are candidate grids, not automatic production changes. Optimizers must preserve local starter viability, affordable basic operations and shared accounting/combat constraints.

Export per-sector expected/realized sources and sinks, imports/exports, delivered price, trade reasons, production-minute savings, route/throughput and resource bill breakdowns, base/army progression costs, shortage windows and observed purchase conversion. Report which shortage was resolved by trading versus local production, logistics investment or reserve mode. Directors receive the same explainable alternatives under player budgets; simulations cannot prove real buyer willingness to pay.
