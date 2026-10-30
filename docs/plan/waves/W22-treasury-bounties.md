# W22 — Treasury & Bounties (F7, F8, mock)

> **Track:** Economy/NEAR (E) · **Flag:** `W22` · **Scenario:** `scenarios/w22-treasury-bounties.ts` · **Tag:** `wave-22`
> **Depends on waves:**
> - W13: market fee legs, intent batch builder, `IntentsPort` mock.
> - W18 (optional; only mercenaries and `defend_area` need it): PvP, elimination, defend-area semantics.
> - W10: cargo tokens used for rewards and escrow.
> - W07: nests and combat units for mercenary squads.
> - W06: colony accounts and the relayer (members, escrow parties).
> - W11: planet lifecycle (one DAO per planet, created on planet creation).
>
> Optional: W04 (the Bounties map layer W22-26 uses W04-15's registry), W15 (Guild visits, for `guild_subsidy`; and the mock `AgentWalletPort` W15-03 that the post-hackathon mercenary accounts W22-27 use), W05 (Living ops, for `terraform_boost`), W09 (away mode, for mercenary auto-hire).
> **Specs:** [`NEAR.md`](../../spec/NEAR.md) §1a, §10 (`NEAR-100..102`), §11 (`NEAR-110..112`), §12–§15 · [`near-economy-features-spec.md`](../../game/near-economy-features-spec.md) F7, F8 · [`SIMULATION.md`](../../spec/SIMULATION.md) command groups (diplomacy & bounties), events (`bountyCompleted`) · [`PROTOCOL.md`](../../spec/PROTOCOL.md) F7/F8 rows · [`CLIENT.md`](../../spec/CLIENT.md) §8a · [`DATA_MODEL.md`](../../spec/DATA_MODEL.md) `chain.treasury*`, `chain.bounty` · [`CONTINUITY.md`](../../spec/CONTINUITY.md) AW-20 · D-25, D-26, D-30.

## Goal

**F7.** Each planet gets a **treasury DAO** (mock SputnikDAO). It is funded by a share of market fees. Colonies vote on planet-wide projects, and passed projects change the sim (meteor shield, terraform boost, Guild subsidy).

**F8.** Players post **bounties** with rewards in escrow (mock): clear a nest, defend an area, deliver units. Other players or **mercenary NPC agents** claim them. Mercenaries guard offline colonies for pay.

## Demo story (wave e2e)

1. Open `/play.html?scenario=w22` → a planet with 2 colonies, a fee history and a nest → **Planet menu → Council** → see the treasury balance (fees collected), 2 members and no proposals.
2. Settle one market trade (W13, two profiles as in the W13 demo; or dev console `treasury.fund <planet> <amount>`) → the treasury balance rises by `TREASURY_FEE_SHARE_BP` of the fee.
3. Council → propose **Meteor shield** → colony B votes yes in a second profile (open the join link that the dev console `planet b` prints) → it passes → the HUD shows the shield badge with a timer. (Dev console `treasury.effect meteor_shield` shows the badge without a vote; the −75 % meteor rate itself is (e2e only).)
4. **Planet menu → Bounties** → post "Clear nest N-3: 200 metals" → the escrow receipt (mock, `/dev/chain/`) appears and the reward leaves the poster's cargo.
5. Colony B claims and destroys the nest (or dev console `bounty.complete <id>`) → `bountyCompleted` → B's cargo +200 metals, and the board shows Paid.
6. Post "Defend area for 2 h" and hire a **mercenary** (`merc.hire 2` in the console) → a squad of NPC units spawns on your territory, guards it, and leaves at the end (`warp 100`). Escrow pays the mercenary account in `/dev/chain/`.
7. Let a bounty expire (`warp 100`) → the poster is refunded.
8. Run `TA_WAVES=..21 npm run dev:restart` and reload `/play.html?scenario=w22` → no Council or Bounties menus, and no fee share is taken from trades.

## Owned paths

`backend/app/src/near/{treasury,bounty,mercenary}/**`, `backend/app/src/near/infrastructure/adapters/mock/{treasury,escrow}*`, `backend/app/src/near/__contract__/{treasury,escrow}.contract.ts`, `shared/sim/src/systems/{treasury,bounty,mercenary}/` (E-track sim folders, auto-discovered), `shared/sim/src/data/{treasury,bounty,mercenary}.ts`, `frontend/game/features/{treasury,bounty}/**`, `scenarios/w22-treasury-bounties.ts`, `e2e/w22.spec.ts`, `prisma/near-treasury.prisma`.
Uses from W00 without owning: `TreasuryDaoPort` / `EscrowPort` (W00-30), mock base (W00-32), outbox (W00-37), contract harness (W00-38).

## Hackathon slice

> Column `H`: **H** must for Nov 1–14 · **H+** stretch · **H2** real NEAR after the D10 gate · blank = after the hackathon. Plan and calendar: [`HACKATHON_CUT.md`](../HACKATHON_CUT.md), [`HACKATHON_SCHEDULE.md`](../HACKATHON_SCHEDULE.md).

- **The hackathon e2e covers demo steps:** 1, 2, 3 (propose **Terraform boost** instead of Meteor shield), 4, 5, 8. `W22-36` tags these steps `@hack`; `npm run e2e -- --hack` runs only them, and the other steps run once their rows land.
- **Deferred:** Meteor shield (needs W05 meteors), Guild subsidy, bounty expiry (step 7), mercenaries (step 6), defend-area and deliver-units bounties, map markers.
- **Still true:** with `TA_WAVES` below this wave the app behaves exactly as the previous wave's tag.

## Features covered

| # | Feature (spec) | Issues |
|---|---|---|
| 1 | Extensions of W00-30's `TreasuryDaoPort` / `EscrowPort`, commands, events, data tables, flag | W22-01, W22-02 |
| 2 | Mock SputnikDAO-like DAO + contract suite | W22-03, W22-04 |
| 3 | DAO per planet at creation; members = colony accounts (`NEAR-100`) | W22-05, W22-06 |
| 4 | Fee share 20 % of the fee leg (`NEAR-101`) | W22-07 |
| 5 | Proposals, voting, finalize (`NEAR-102`) | W22-08, W22-09 |
| 6 | Sim effects: meteor shield, terraform boost, Guild subsidy (`NEAR-102`) | W22-10, W22-11, W22-12 |
| 7 | Council UI, HUD effect badges, VFX | W22-13, W22-14, W22-15 |
| 8 | Away rule for votes | W22-16 |
| 9 | Mock escrow + contract suite (`NEAR-110`) | W22-17, W22-18 |
| 10 | Bounty posting, expiry, refund (`NEAR-110`) | W22-19, W22-24 |
| 11 | Target tracking in the sim (clear nest / defend area / deliver units) → `bountyCompleted` (`NEAR-111`) | W22-20, W22-21, W22-22 |
| 12 | Claim and payout (`NEAR-111`) | W22-23 |
| 13 | Bounty board UI and map markers | W22-25, W22-26 |
| 14 | Mercenary NPC agents: accounts, roster, hire, spawn, despawn, pay (`NEAR-112`) | W22-27, W22-28, W22-29, W22-30 |
| 15 | Mercenaries guard offline colonies (away budget) | W22-31 |
| 16 | Mercenary visuals | W22-32 |
| 17 | Edge cases | W22-33 |
| 18 | Telemetry, analytics, dev console | W22-34, W22-35 |
| 19 | Wave e2e, scenario, tag | W22-36 |

## Issues

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W22-01 | Contracts (treasury): extend W00-30's `TreasuryDaoPort` (`createDao`, `propose`, `vote`, `finalize`, `deposit`) with `addMember`, `removeMember`, `get`; commands `system.treasuryEffect {kind, params, untilTick}`; events `treasuryProposalCreated`, `treasuryVoteCast`, `treasuryProposalPassed`, `treasuryProposalFailed`, `treasuryEffectStarted`, `treasuryEffectEnded`; push `treasury.proposal`; errors `DAO_NOT_FOUND`, `NOT_A_MEMBER`, `ALREADY_VOTED`, `TREASURY_INSUFFICIENT`, `PROPOSAL_CLOSED`; flag `W22` | contract | M | H | W00-30 | `npm run check` → contracts compile; `system.treasuryEffect` is rejected when sent by a client (module-only) | NEAR §10, PROTOCOL module-only list | TA-10.12 (part) |
| W22-02 | Contracts (bounties): extend W00-30's `EscrowPort` (`open`, `claim`, `refund`; `claim` is the operator call that pays the claimer, NEAR-111) with `get`; commands `bounty.post {target, reward, expiresAt}`, `bounty.claim {bountyId}`, module-only `bounty.paid`; events `bountyPosted`, `bountyClaimed`, `bountyCompleted`, `bountyPaid`, `bountyRefunded`, `bountyExpired`, `mercenaryHired`, `mercenaryArrived`, `mercenaryLeft`; data tables: target kinds (`clear_nest`, `defend_area`, `deliver_units`) with params, mercenary roster | contract | M | H | W22-01 | A `bounty.post` with an unknown target kind → zod rejection `invalid_args` | NEAR §11, SIM command groups | TA-10.12 (part) |
| W22-03 | `MockTreasuryDaoAdapter`: Postgres `mock_chain_dao*`, SputnikDAO-like states (`InProgress → Approved / Rejected / Expired`), policy 1 colony = 1 vote, pass at > 50 % of members or ≥ 2 yes votes with no no votes before the deadline; `mock:` receipts (latency and failure injection from the W00-32 base); binding `NEAR_ADAPTER_TREASURY` | server | M | H | W22-01, W00-32 | Create a DAO, propose, cast 2 yes votes on a 3-member DAO → state `Approved` | NEAR-100, §1a | — |
| W22-04 | `TreasuryDaoPort` contract suite on the W00-38 harness: create idempotent, membership, single vote per member, finalize transitions, insufficient-funds error; W23-37 runs this same suite against the real DAO | test | S | H | W22-03, W00-38 | `npm run test:contract -- --port treasury` → green vs the mock | NEAR §1a rule 5 | — |
| W22-05 | Planet DAO lifecycle: create on planet creation via the W00-37 outbox (`opId = dao-create:{planetId}`); planets created before W22 got enabled get a DAO lazily on first Council open | server | S | H | W22-03, W11-03, W00-37 | Create a planet → a DAO account `{planet}.dao.mock` exists; turn W22 on for an old planet → opening Council creates it once | NEAR-100 | — |
| W22-06 | Membership sync: add the colony account on `colonyFounded`; on elimination remove it; Settled colonies stay members without proposing rights | server | S | H | W22-05 | Eliminate colony B → member count drops by 1 and B's open votes are ignored at finalize | NEAR-100 | — |
| W22-07 | Fee share: plug a **treasury leg** into the W13 batch builder through its extension point (`registerFeeLeg`); the leg is `TREASURY_FEE_SHARE_BP` (2 000 bp) of the hub-owner fee, and the batch stays zero-sum per token | server | M | H | W13-12, W22-05 | Settle a 300-unit trade with a 1 % fee → the hub owner gets 2.4, the DAO gets 0.6, and the intent batch simulation reports sum = 0 | NEAR-101, NEAR-61 | — |
| W22-08 | Proposals API: `GET/POST /v1/near/treasury/{planetId}` (balance, members, effects, proposals), `POST …/proposals` (kind from the table, cost checked vs treasury balance, max 1 open proposal per colony), `POST …/proposals/{id}/vote` | server | M | H | W22-03 | Propose meteor shield with a treasury below its cost → `TREASURY_INSUFFICIENT` | NEAR-102, PROTOCOL F7 row | — |
| W22-09 | Finalize job: deadline 6 h real time (config `TREASURY_PROPOSAL_TTL_H`), auto-finalize, pay the project cost from the DAO, emit the result event and `treasury.proposal` push | server | S | H | W22-08 | Time-warp past the deadline with only 1 yes vote of 3 → proposal `Expired`, no funds moved | NEAR-102 | — |
| W22-10 | Sim effect **meteor_shield**: `system.treasuryEffect` → meteor and lightning rates −75 % on the planet for 6 h; effect timer in planet state; `treasuryEffectEnded` at the end | sim | M |  | W22-01, W05-16 | Apply the effect via the console and time-warp 1 h → hazard counter vs a control seed shows ≥ 60 % fewer strikes | NEAR-102 | — |
| W22-11 | Sim effect **terraform_boost**: Living-op (Irrigate, Seed) resource and energy costs −25 % for 12 h; disabled kind when W05 is off | sim | S | H | W22-01, W05-07 | With the boost active, queue a Seed → the queue entry shows the cost reduced by 25 % | NEAR-102 | — |
| W22-12 | Sim effect **guild_subsidy**: schedule 1 extra Orbital Guild visit to this planet (W15 hook `guild.scheduleExtraVisit`); kind hidden when W15 is off | server | S | H+ | W22-01, W15-09 | Pass a guild_subsidy → a new `chain.guild_visit` row for this planet within the next schedule cycle | NEAR-102, NEAR-72 | — |
| W22-13 | Data table of project kinds (proposed numbers): meteor_shield 6 h / −75 % / cost 1 500 cargo-equivalent; terraform_boost 12 h / −25 % / 1 000; guild_subsidy 1 visit / 800; all owner-tunable, filtered by wave flags | data | S | H | W22-01 | Change a cost in `data/treasury.ts` → the Council form shows the new cost after reload | NEAR-102 | — |
| W22-14 | Council UI (Planet menu → Council): balance, members, active effects with timers, proposal list (state, votes, deadline), create-proposal form, vote buttons; textContent only; phone-landscape layout | client | M | H | W22-08, W22-09 | Propose and vote from two browsers → both see the vote count update live via push; works by touch in landscape | CLIENT §8a | — |
| W22-15 | HUD effect badges + VFX: shield badge with countdown; subtle planet-wide shimmer while the meteor shield is active; teal tint on Living ops during the terraform boost | visual | S |  | W22-10, W22-11 | Activate both effects → 2 HUD badges with correct timers and visible VFX; frame time stays within the budget on the reference laptop | CLIENT §8a, §9 | — |
| W22-16 | Away rule for votes: away colonies **abstain** (the AI director does not vote in MVP), documented as an AW policy note; notify the player about open proposals (W09) | server | S |  | W22-08 | Mark colony B away → B casts no vote automatically; a notification "Planet council: 1 open proposal" is queued if W09 is on | CONTINUITY AW-14 spirit | — |
| W22-17 | `MockEscrowAdapter` on the W00-32 mock base: Postgres `mock_chain_escrow`, holds cargo (via `CargoTokenPort.transfer` to an escrow account) or mock NEAR; `open` / `claim` / `refund` with `opId` idempotency; binding `NEAR_ADAPTER_ESCROW` | server | M | H | W22-02, W10-10, W00-32 | Open escrow for 200 metals → the poster's cargo balance −200 and the escrow +200 in the dev explorer | NEAR-110 | — |
| W22-18 | `EscrowPort` contract suite on the W00-38 harness: open idempotent, claim only once, refund only if not claimed, amounts conserved; W23-40 runs this same suite against the real contract | test | S | H | W22-17, W00-38 | `npm run test:contract -- --port escrow` → green vs the mock | NEAR §1a rule 5 | — |
| W22-19 | Bounty posting service: validate target (nest exists and is visible to the poster; area inside the poster's territory; deliver amount > 0), reward ≤ the poster's cargo, max 3 active bounties per colony, expiry 2–48 h, escrow via the W00-37 outbox (`opId = bounty-open:{bountyId}`); `GET /v1/bounties/{planetId}` | server | M | H | W22-17, W00-37 | Post a bounty on a nest outside view → `invalid_target`; a valid post → state `open` with an escrow receipt | NEAR-110, PROTOCOL F8 row | — |
| W22-20 | Sim tracking **clear_nest**: when the nest is destroyed, the colony with the most damage dealt to it in the last 60 s (must be a claimer) completes the bounty → `bountyCompleted {bountyId, claimer}` | sim | M | H | W22-02, W07-14 | The claimer destroys the nest → event `bountyCompleted` names the claimer; the poster destroying it themself → bounty auto-cancelled and refunded | NEAR-111 | — |
| W22-21 | Sim tracking **defend_area**: the claimer keeps ≥ 1 combat unit in the area for ≥ 80 % of the duration and the poster loses no building there → complete; a poster building destroyed → fail and refund | sim | M |  | W22-02, W07-12 | Run a 1 h defend contract with a raid that is beaten off → `bountyCompleted` at the end of the hour | NEAR-110, NEAR-111 | — |
| W22-22 | Server tracking **deliver_units** (observed from cargo transfers, not a sim rule): the claimer transfers X cargo of a resource to the poster's colony account (via `CargoTokenPort.transfer`, W10) before expiry → complete | server | S |  | W22-02, W10-09 | Transfer 100 water to the poster → bounty completes; transfer 99 → it stays open | NEAR-110 | — |
| W22-23 | Claim & payout: `bounty.claim` registers the claimer (more than one claimer allowed for nests, one for defend); on `bountyCompleted` call `EscrowPort.claim` to pay the claimer (`opId = bounty-pay:{id}`), then send `bounty.paid` to the sim | server | M | H | W22-19, W22-20 | Complete a bounty → the claimer's cargo +reward exactly once, even after an app restart mid-payout | NEAR-111 | — |
| W22-24 | Expiry and refund job: expired or cancelled bounties refund the poster (`opId = bounty-refund:{id}`); a poster eliminated before completion → refund to its colony account, which still exists | server | S | H+ | W22-23 | Let a bounty expire → state `refunded`, poster cargo restored, and the board shows "Expired" | NEAR-110 | — |
| W22-25 | Bounty board UI (Planet menu → Bounties): open, claimed, completed and expired lists; post form with target picker (click nest or area on the map), reward input, expiry; claim button; progress (defend %, deliver x / y) | client | M | H | W22-19, W22-23 | Post, claim and complete from two browsers → both boards show the final state "Paid" with a receipt link | CLIENT §8a | — |
| W22-26 | Map markers: bounty targets on the minimap and global map (W04 layer registry, layer "Bounties") with a reward tag | client | S |  | W22-25, W04-15 | Open the global map with the Bounties layer on → the targeted nest shows a reward tag; with W04 off → no error | CLIENT §8b | — |
| W22-27 | Mercenary NPC accounts: `merc-N.npc.terraagent.mock` created through `AgentWalletPort` (mock), funding cap per NPC, roster table (squad presets built from unlocked units: e.g. 4 Recon; with W17, 2 Tank + 1 Artillery), price per game-hour | server | M |  | W22-02, W15-03 | Start the app → 3 mercenary accounts exist with roster entries priced from the data table | NEAR-112, NEAR-73 | — |
| W22-28 | Hire flow: "Hire mercenaries" creates a defend_area bounty with the mercenary as the reserved claimer; escrow covers duration × price; cancel refunds the unused part | server | S |  | W22-27, W22-19 | Hire for 2 h then cancel after 1 h → half the escrow is refunded | NEAR-112 | — |
| W22-29 | Sim mercenary squads: spawn NPC units (faction `mercenary`, allied with the poster, no supply cost to the poster) at the poster's Hub edge at contract start; Defend stance in the area; despawn at the end or when all are dead; their presence counts for `defend_area` | sim | M |  | W22-28, W07-03 | Hire a squad → units appear within 10 s, fight raiders in the area, and are gone at the end of the contract | NEAR-112 | — |
| W22-30 | Mercenary payout: on contract end, `EscrowPort.claim` pays the mercenary account for the time served; a squad wiped early → payout pro-rata, rest refunded | server | S |  | W22-29, W22-23 | The squad dies halfway → mercenary paid 50 %, poster refunded 50 % | NEAR-112 | — |
| W22-31 | Mercenaries guard offline colonies: new away setting "Hire mercenaries when attacked while away" with a max spend; autopilot hires within that limit (it counts as defense spending, AW-20); requires W09 | server | M |  | W22-28, W09-14 | Mark away with the setting on, spawn a raid via the console → a squad is hired automatically and the digest lists the hire | CONTINUITY AW-20, near-economy F8 | — |
| W22-32 | Mercenary visuals: faction variant (neutral grey-teal decals, merc emblem) on the Recon/Tank kitbash archetypes; visual QA in the playground 4 views | visual | S |  | W22-29 | Open `/playground.html?inspect=robot.combat&faction=mercenary` → the variant renders with `minY 0.000` | AGENTS.md pillar 1 | — |
| W22-33 | Edge cases and tests: proposal on an ended planet → rejected; double vote → `ALREADY_VOTED`; bounty on a nest already dead → `invalid_target`; escrow mock failure (fail rate 1) → bounty stays `pending` and the poster's cargo is untouched; claimer eliminated → bounty reopens | test | M |  | W22-08, W22-23 | `npm run test -- treasury-bounty-edges` → all 5 cases green | NEAR §15 | — |
| W22-34 | Telemetry + analytics: metrics `treasury_balance{planet}`, `treasury_proposals_total{kind,result}`, `bounties_total{kind,state}`, `mercenary_contracts_total`; `track()` events `council_opened`, `proposal_created`, `vote_cast`, `bounty_posted`, `bounty_claimed`, `bounty_paid`, `mercenary_hired` | server | S |  | W22-14, W22-25 | Run the demo story → each analytics event appears once in the table | NEAR §14, CLIENT §10 | — |
| W22-35 | Dev-console commands: `treasury.fund <planet> <amount>`, `treasury.effect <kind>`, `bounty.post …`, `bounty.complete <id>`, `merc.hire <hours>`; failure injection uses W06-25's `near.mock.fail escrow\|treasury <rate>` | client | S |  | W22-10, W22-23, W22-28, W06-25 | Run `treasury.effect meteor_shield` → the shield badge shows without a vote | PRODUCT_WAVES §3 | — |
| W22-36 | Wave e2e + scenario + tag: `scenarios/w22-treasury-bounties.ts` (2 colonies, fee history, nest, funded cargo); `e2e/w22.spec.ts` covers the demo story with two browser contexts; all earlier e2e suites pass; flag-off check; tag `wave-22` | test | M | H | W22-01..35 | `npm run e2e -- --waves ..22` → green | PRODUCT_WAVES §3 | — |

**Issue count: 36.**

## Wave DoD

- `e2e/w22.spec.ts` and every earlier wave's e2e pass. `?scenario=w22` loads.
- `TA_WAVES=..21` removes the Council, Bounties, mercenaries and the fee-share leg; W13 trades still settle zero-sum.
- The treasury and escrow contract suites are green vs the mocks.
- `NEAR-100..102` and `NEAR-110..112` each map to issues above. Tag `wave-22` is created.
