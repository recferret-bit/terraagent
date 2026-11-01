# 05 — Colony Deed, badges, Settled staking, planet treasury, bounties

> **Status:** 2026-10-31. Grooming reference (legend and template: [`README.md`](./README.md)). Covers F6 (deed, own-NEAR staking), soulbound badges, Settled colonies, F7 (planet treasury DAO), F8 (bounties, mercenaries). Fee legs: [`03-markets-trading-rules.md`](./03-markets-trading-rules.md). Account claim and keys: [`01-accounts-keys-relayer.md`](./01-accounts-keys-relayer.md). Mint / burn authority: [`02-mining-cargo-mint-authority.md`](./02-mining-cargo-mint-authority.md). Real adapters and SputnikDAO vs Trezu: [`06-near-tools-and-adapters.md`](./06-near-tools-and-adapters.md).
>
> **Abbreviations:** as in the README (MP, Review, Pivot, Balance, NEF, units, profile, OWNER_TASKS = `docs/plan/OWNER_TASKS.md`). "W21 demo n" = step n of a wave's demo story. Each fact has one owning file; the treasury leg is owned by 03, the claim by 01, burn authority by 02.

## 1. Purpose

- **Deed (F6):** one dynamic NFT per colony that records its growth and can be shared as a card (NEF F6; NEAR-90/91).
- **Badges:** an optional on-chain record of earned achievement tiers; XP stays cosmetic (profile §2–§3; D-29 is still Proposed).
- **Settled colony + staking:** the endgame leaves an inert colony behind; its deed then lets the player stake **their own NEAR** with no in-game effect (D-18, NEAR-92/93).
- **Treasury (F7):** fees fund planet-wide projects voted by colonies, so the sim changes without a patch (NEF F7; NEAR-100..102).
- **Bounties (F8):** players post escrowed rewards for targets; players or mercenary NPCs claim them (NEAR-110..112).

## 2. Actors and accounts

| Actor / account | Role here | Signs / pays | Source |
|---|---|---|---|
| `deed.terraagent.near` | NEP-171 contract; collections `deed` and `badge` (W23-29) | — | NEAR-90, W23-29 |
| Relayer (`relayer.terraagent.near`) | Operator: mints deeds, updates `extra`, finalises DAO effects, releases escrow; pays gas and storage | relayer key | NEAR-91, NEAR-111, NEAR §2, §12 |
| Colony account `{colony}.{name}.terraagent.near` | Owns the deed; DAO member; bounty poster / claimer; stakes after claim | app keys until claim; after claim the player's full-access key, plus (per NEAR §2) an app FC key → Q-01-11 | NEAR §2, D-18, NEAR-92, NEAR-100 |
| Player (claimed account) | Signs stake / unstake / withdraw in a wallet; never the relayer | player wallet | NEAR-92, W23-32 |
| Badge owner | Unspecified (player named account or colony account?) | — | Q-05-6 |
| Planet DAO `{planet}.sputnik-dao.near` (mock `{planet}.dao.mock`) | Holds the treasury; members = colony accounts | votes via members | NEAR-100, W22-05 |
| Escrow `bounty.terraagent.near` | Holds cargo or NEAR for a bounty | operator `claim` | NEAR-110, W23-38 |
| Mercenary NPCs `merc-N.npc.terraagent.*` | Reserved claimers of defend contracts, paid from escrow | "sub-accounts like the Guild"; key scope not stated | NEAR-112, W22-27 (—) |
| Validator pools | Pay staking rewards; whitelist `NEAR_STAKING_POOLS` | — | NEAR-92, NEAR §12 |

## 3. Rules

**F6 Colony Deed**

| # | Rule | Status | Source |
|---|---|---|---|
| R05-1 | One deed per colony, minted at founding, owned by the colony account; replaces the old `colony-registry` log | Decided | NEAR-90, D-26, NEAR §16 #9 |
| R05-2 | Mint runs through the outbox, `opId = deed-mint:{colonyId}`; a restart mid-mint still yields one deed | Planned | W20-05 (H) |
| R05-3 | Metadata `extra`: stage, terraform %, walls, trade volume, truces, rank; fields of waves that are off stay absent | Decided | NEAR-91, W20-01 (H), W20-06 (H) |
| R05-4 | Update triggers: stage reached, Terraform % in 10 % steps, wall-count steps, trade-volume steps, truce signed, rank change | Planned | W20-06 (H) |
| R05-5 | "Dens destroyed" as a deed field (dens = nests per Review C2) | Proposed | MP §8; absent from `DeedMetadataV1` |
| R05-6 | At most one `updateMetadata` per colony per 10 min, coalescing to latest; `opId = deed-meta:{colonyId}:{version}` | Decided | NEAR-91, W20-07 (H) |
| R05-7 | Settle and eliminate updates bypass the debounce | Planned | W20-14 (—), W20-15 (—) |
| R05-8 | Image rendered by the app from the colony snapshot: 1200 × 630 PNG, cached per `version` | Decided | NEAR-91, W20-08 (H) |
| R05-9 | Deed status `active` / `eliminated` / `abandoned`; `settled` is one-way | Planned | W20-01 (H), W20-03 (H), W20-14 (—) |
| R05-10 | Public read `GET /v1/deeds/{tokenId}` without auth; own deeds with history `GET /v1/near/deed` | Planned | W20-09 (H) |
| R05-11 | Share page `/deed/{tokenId}` with OG image, "Share on X" | Planned | W20-12 (H+) |
| R05-12 | Hackathon ships mock mint, metadata updates, card UI ("Recorded on NEAR (mock)") | Planned | W20-28 (H) (`@hack` steps 1, 2, 7); HACKATHON_CUT §2 |
| R05-13 | Step sizes for walls and trade volume; a `rank` producer during the hackathon (see R05-73) | Gap | Q-05-1 |

**Badges (achievement NFTs)**

| # | Rule | Status | Source |
|---|---|---|---|
| R05-14 | 20 families × 3 tiers; XP cosmetic only, idempotent per `(source, sourceId)` (rests on D-29, still Proposed) | Planned | W12-01 (H), W12-05 (H); profile §2–§3 |
| R05-15 | An earned tier may be minted as a soulbound badge via `BadgeNftPort`, outbox `planned → sent → minted / failed / skipped`, 1 h delay; the deterministic `opId` is stated only in W12-25 | Planned | W12-25 (—); profile §3, §5 (D-29, D-30 Proposed) |
| R05-16 | Card back: "Recorded (mock)"; explorer link only with a real adapter | Planned | W12-26 (—); PA-05 |
| R05-17 | Badges non-transferable on chain (transfer panics "soulbound") | Planned | W23-29 (—) |
| R05-18 | Achievement list per MP §8 (Terraformer, Den Hunter 1/3/5, Councilor) differs from profile §3 (Green Thumb, Nest Breaker 1/10/50, no Councilor); Review §6 says the lists match, which is wrong | Proposed | MP §8 vs profile §3 vs Review §6; Q-05-7 |
| R05-19 | Badge NFTs are Stretch (MP §8); Review §5 recommends against them for the hackathon | Proposed | MP §8, Review §5 |

**Settled colonies and own-NEAR staking**

| # | Rule | Status | Source |
|---|---|---|---|
| R05-20 | Launch only when the colony's own territory is 100 % Living, excluding walls, deep water and building footprints | Decided | D-18, UO-R-01, SIM §7.7; W21-04 (—) |
| R05-21 | Terraform % (score, deed) = Living ÷ owned, excluding unreclaimed deep water and walls, **not** footprints; footprints cannot be Living | Decided | UO-TF-06, UO-TF-04 |
| R05-22 | Balance doc: the gate is unreachable (ceiling ≈ 78 %) **if it uses the UO-TF-06 denominator**; its proposal "every non-footprint, non-wall, non-deep tile" restates D-18 | Proposed | Balance §0, §4.1, §8 |
| R05-23 | Settled: inert, no tick cost, invulnerable and untargetable, frozen border, counts for score and occupancy, seat kept, truces end, orders closed | Decided | UO-R-02, UO-R-04, SIM §7.7, NEAR §16 #6; W21-09 (—), W21-10 (—) |
| R05-24 | Settled colony stays a DAO member without the right to propose | Planned | W22-06 (H) |
| R05-25 | Settled Deed: `updateMetadata` with `settled: true`, `opId = deed-settle:{colonyId}`, gold frame | Decided | NEAR-92, W20-15 (—), W20-11 (H+) |
| R05-26 | Staking needs a settled deed **and** a claimed account (`DEED_NOT_SETTLED`, `ACCOUNT_NOT_CLAIMED`) | Decided | NEAR-92, D-18, NEAR §16 #3; W20-18 (—) |
| R05-27 | Player sends own NEAR to the colony account, which calls `deposit_and_stake` on a whitelisted pool; wallet-signed by the claimed account | Decided | NEAR-92, W23-32 (—) |
| R05-28 | Rewards come from the validator; the game never pays NEAR and never holds the player's funds | Decided | D-18, NEAR-92, UO-R-03 |
| R05-29 | No in-game effect from the staked amount; property test 0 … 10⁶ NEAR → deep-equal sim | Decided | NEAR-93, UO-R-03, W20-23 (—) |
| R05-30 | Copy "Real NEAR from your wallet — not game currency, no in-game bonus" visible before signing | Planned | W20-21 (—) |
| R05-31 | Whitelist governance (who adds / removes pools, how often) and legal review of staking copy | Planned | W23-34 (—); NEAR §9 follow-up |
| R05-32 | Testnet → mainnet pool list (an owner task, no decision) | Gap | OWNER_TASKS "Staking validator whitelist"; Q-05-4 |
| R05-33 | `StakingPort` methods: NEAR §1a lists `stake`, `unstake`, `rewards`; W20-01 adds `listPools`, `withdraw`, `position`; NEAR.md not updated | Planned | W20-01 (H) · spec gap (NEAR §1a; OWNER_TASKS N3) |
| R05-34 | "Deed can later become staking vehicle — Later, no in-game power" (consistent with D-18) | Proposed | MP §8, MP §3 |

**F7 Planet Treasury & Council**

| # | Rule | Status | Source |
|---|---|---|---|
| R05-35 | One DAO per planet, created on planet creation (`opId = dao-create:{planetId}`); SputnikDAO-like or Trezu multisig | Decided | NEAR-100, NEF F7; W22-05 (H), W23-35 (—) |
| R05-36 | Lazy-create on first Council open for planets that predate W22 | Planned | W22-05 (H) |
| R05-37 | Members are the colony accounts on the planet (sync details: R05-63) | Decided | NEAR-100 |
| R05-38 | 1 colony = 1 vote; pass at > 50 % of members | Planned | W22-03 (H) · spec gap (NEAR-100..102 state no vote rule) |
| R05-39 | W22-03 also passes at "≥ 2 yes votes with no no votes before the deadline" (40 % on a 5-colony planet) | Planned | W22-03 (H) · spec gap; Q-05-9 |
| R05-40 | Proposals close after 6 h real time (`TREASURY_PROPOSAL_TTL_H`), auto-finalised; below quorum → `Expired`, no funds move | Planned | W22-09 (H) |
| R05-41 | Max 1 open proposal per colony; cost checked against balance (`TREASURY_INSUFFICIENT`) | Planned | W22-08 (H) |
| R05-42 | Away colonies abstain; the AI director does not vote in MVP | Planned | W22-16 (—) |
| R05-43 | A share of every market fee leg goes to the planet DAO | Decided | NEAR-101 |
| R05-44 | MP variant 1 example is additive (1 000 @ 1 % → owner +10, treasury +2) | Proposed | MP §7 → Q-03-1 |
| R05-45 | Passed proposal → module-only `system.treasuryEffect {kind, params, untilTick}` | Decided | NEAR-102, W22-01 (H) |
| R05-46 | Project costs are **burned** (a locked decision in MP §0, not yet in a spec) | Proposed | MP §0, Review §6; burn signer → Q-02-3; treasury side Q-05-11 |
| R05-47 | Variant 3: optionally route 15 % of project cost to the project account (toggle) | Proposed | MP §7 |
| R05-48 | Which token the treasury holds and what "cargo-equivalent" means | Gap | W22-13 (H); Q-05-12 |
| R05-49 | One treasury project (terraform boost) with a visible effect is Must | Proposed | MP §0, §3; Review C3 |

**F8 Bounties & mercenaries**

| # | Rule | Status | Source |
|---|---|---|---|
| R05-50 | Escrow holds cargo or NEAR for a target: `clear_nest`, `defend_area`, `deliver_units` | Decided | NEAR-110, W22-02 (H) |
| R05-51 | Post: target valid and visible; reward ≤ poster's cargo; ≤ 3 active per colony; expiry 2–48 h; `opId = bounty-open:{bountyId}` | Planned | W22-19 (H) |
| R05-52 | `clear_nest`: colony with most damage to the nest in the last 60 s, among registered claimers, completes it; poster kills it → cancelled and refunded | Planned | W22-20 (H) |
| R05-53 | On `bountyCompleted` the operator calls `EscrowPort.claim` once (`opId = bounty-pay:{id}`), then `bounty.paid` to the sim | Decided | NEAR-111, W22-23 (H) |
| R05-54 | Expiry / cancel refund (`bounty-refund:{id}`); eliminated poster refunded to its colony account | Planned | W22-24 (H+) |
| R05-55 | `defend_area`: ≥ 1 claimer unit present ≥ 80 % of duration, no poster building lost; `deliver_units` = cargo transfer of X before expiry | Planned | W22-21 (—), W22-22 (—) |
| R05-56 | Mercenaries: app-run NPC agents (sub-accounts like the Guild) accept defense bounties, spawn NPC combat units on the poster's territory for the contract, paid from escrow (details: R05-64) | Decided | NEAR-112 |
| R05-57 | Mercenaries guard offline colonies within a player-set max spend, counted as AW-20 defense spending; conflict: AW-20 says defense spending is never capped | Planned | W22-31 (—) vs AW-20; Q-05-15 |
| R05-58 | Claimer eliminated → bounty reopens; double vote → `ALREADY_VOTED` | Planned | W22-33 (—) |
| R05-59 | Hackathon ships `clear_nest` only, escrow (mock), board (`@hack` steps 4–5) | Planned | W22-36 (H); HACKATHON_CUT §2 |

**Added in pass 2 (in id order; feature in brackets)**

| # | Rule | Status | Source |
|---|---|---|---|
| R05-60 | [F7] Treasury leg = 2 000 bp of the stall fee, carved out of the hub owner's fee (300 @ 1 % → 2.4 owner / 0.6 DAO); value `TREASURY_FEE_SHARE_BP` 2 000 is Decided (value proposed) in NEAR §12. Owner 03; floor rounding makes 0.6 impossible → Q-03-2 | Planned | W22-07 (H); NEAR §12 → Q-03-1 |
| R05-61 | [F7] Hackathon ships the DAO, fee share, propose / vote / finalize, terraform boost, Council UI (`@hack` steps 1–3 with the boost, 8) | Planned | W22-36 (H) |
| R05-62 | [Settled] W21-04 counts the D-18 set (footprints excluded), but W21-05 / W21-06 acceptance and demo step 1 show `Living 312 / 325` (owned minus deep water, footprints included) | Conflict | W21-04 vs W21-05, W21-06, W21 demo 1 → Q-05-2 |
| R05-63 | [F7] Member sync: add on `colonyFounded`, remove on elimination (open votes ignored at finalize), Settled stay without propose rights | Planned | W22-06 (H) |
| R05-64 | [F8] Hire = `defend_area` bounty with the mercenary as reserved claimer; escrow = duration × price; cancel refunds the unused part; early wipe → pro-rata pay, rest refunded | Planned | W22-28 (—), W22-30 (—) |
| R05-65 | [Badges] Card string W12-26 "Recorded (mock)" vs W20-10 "Recorded on NEAR (mock)"; W12-32 (H) asserts PA-05 mock mint but W12-25 / W12-26 are untagged | Conflict | W12-26 vs W20-10; W12-32 (H) → Q-05-23 |
| R05-66 | [Tests] `deed` contract tests and `deed-metadata.spec.ts` (NEAR-90..93); DAO proposal → sim effect and bounty escrow release in `near-workspaces` (NEAR-100..112) | Decided | NEAR §15 |
| R05-67 | [Staking] The game pays no yield: rewards come from validators only; game-treasury rewards were the rejected alternative | Decided | D-18 (Alternatives), NEAR-92 |
| R05-68 | [Staking] No other staking is defined: no cargo staking, no NEAR or cargo yield, no stake-weighted vote (votes are 1 colony = 1, W22-03), no stall bond. Nothing forbids them either | Gap | Q-05-18 |
| R05-69 | [F7] The project "never pays out real NEAR from treasury" | Proposed | MP §7 core principle |
| R05-70 | [F7] "Fauna shield" project kind (MP §6 Scenario C "meteor/fauna shield vote") exists in no kind list | Gap | NEAR-102, W22-13 lack it; Q-05-21 |
| R05-71 | [F7] Pivot season: five dev planets, so five DAOs, created only by W22-05's lazy path because the pivot drops W11 (no W11-03 creation hook) | Proposed | Pivot §2, §3 → Q-05-16 |
| R05-72 | [F6/F7] Tracks 10 and 12 are entered only if the deed card and the vote ran on the live planet; W25-31 lists "+ 10/12 if F6/F7 qualify" | Proposed | Pivot §5 (D14, "only if live"), NEF §4; W25-31 (H) → Q-05-22 |
| R05-73 | [F6] The only `rank` producer is W11-05 (`planet_result` ranks, deed metadata hook at `ARCHIVED`); the pivot drops W11, so `rank` has no producer in the hackathon | Planned | W11-05 (—); Pivot §3 |
| R05-74 | [Settled] Launch path around the gate: in-app confirm modal (AI never launches), 30 s countdown with cancel, `TRANSFER` ticket and Founder Pod ×1.25 stock, `/me` claim panel, Prepare Rocket goal (no auto-launch), `rocket_ready` notification | Planned | W21-07, W21-08, W21-12, W21-13, W21-16, W21-17, W21-19 (all —); AW-12, SIM §7.7 |

## 4. Flows

- **Deed mint:** `colonyFounded` → outbox `deed-mint` → `DeedNftPort.mint` → `chain.deed` row with `mock:` tx (≤ 2 s) → card. Failure: latency / fail-rate injection leaves it pending with a retry badge; retries reuse the `opId` (W20-05, W20-27).
- **Deed update:** milestone → projector → debounce 10 min → `deed-meta:{colonyId}:{version}` → push `deed.updated` → toast (W20-06/07/10/25). Flag off (`TA_WAVES=..19`) → no mint, no push; rows untouched (W20-28).
- **Settle → stake:** Prepare Rocket goal terraforms the missing tiles (W21-17) → `rocket_ready` push (W21-19) → gate met (W21-04; reject `launch_gate`) → confirm modal (W21-07) → 30 s countdown, cancellable (W21-08) → `colonySettled {colonyId, terraformBp, ownedTiles}` → Settled (W21-09/10) → `TRANSFER` ticket, Founder Pod ×1.25 on the next planet (W21-12/13) → deed settled, bypassing the debounce (W20-15) → staking panel → unclaimed → claim on `/me` (W21-15/16, [01](./01-accounts-keys-relayer.md) Q-01-11) → pick pool → wallet modal (approve / reject → "Cancelled in wallet" / timeout) → position → unstake → unbonding → withdraw (W20-18/21/22). Planet end: all settled → `ENDED` (W21-14, W11-04) → `ARCHIVED` with the deed hook (W11-05); the staked position then: Gap (Q-05-20).
- **Badge:** tier earned → `BadgeMint planned` → after 1 h `sent` → `minted` or `failed` / `skipped` (W12-25). Trigger for `skipped`: Gap (Q-05-8).
- **Proposal:** member proposes (cost ≤ balance) → votes → 6 h deadline → `Approved` → cost leaves the DAO → `system.treasuryEffect` → HUD badge → `treasuryEffectEnded`. Failures: `TREASURY_INSUFFICIENT`, `ALREADY_VOTED`, `PROPOSAL_CLOSED`, `NOT_A_MEMBER`, below quorum → `Expired` (W22-01/08/09).
- **Bounty:** post → escrow open (poster cargo −reward) → claim registered → sim `bountyCompleted` → `EscrowPort.claim` → claimer cargo +reward. Failures: escrow fail-rate 1 → stays `pending`, poster cargo untouched (W22-33); expiry → refund (W22-24, H+); poster self-kill → refund (W22-20); claimer eliminated → reopen.

## 5. Numbers

| Value | Source | Status |
|---|---|---|
| Deed update cap 1 per colony per 10 min | NEAR-91, W20-07 | Decided |
| Terraform step 10 %; image 1200 × 630, cache hit < 20 ms | W20-06, W20-08 | Planned |
| Mock staking APY 9 %, unbonding 4 epochs ≈ 2 game-days; read-model sync every 5 min | W20-16, W20-20 | Planned |
| Badge mint delay 1 h; XP Bronze/Silver/Gold 50/150/400 (★ 100/300/800); Settled +500 XP | W12-05 (H), W12-06 (—), W12-25 (—); profile §2–§3 | Planned |
| Rocket gate denominator in W21 demo: `Living 312 / 325` (325 matches Balance §4.1's 331 tiles minus 2 % deep water; footprints not removed) | W21 demo 1, Balance §4.1 | Planned |
| Treasury share `TREASURY_FEE_SHARE_BP` 2 000 bp (the value; NEAR-101 "proposed: 20 % of `fee_bp`"). Carve-out from the stall fee is Planned (R05-60; owner 03 R03-54, Q-03-1) | NEAR §12, NEAR-101 | Decided (value proposed) |
| Proposal TTL 6 h real time; pass > 50 % of members | W22-09, W22-03 | Planned |
| terraform_boost −25 % Irrigate/Seed resource + energy cost, 12 h, cost 1 000 | W22-11, W22-13 | Planned |
| meteor_shield −75 % meteor + lightning, 6 h, cost 1 500; guild_subsidy +1 visit, 800 | W22-10, W22-12, W22-13 | Planned |
| Costs 300 / 450 / 250; treasury leg also 0.2 % of Guild fills | Balance §7.2, §8; Review C3, §4.4 | Proposed |
| Planet income at 1 % × 20 %: ≈ 600–1 100 units/week (one 1 000-unit project) | Balance §0, §7.3 | Proposed |
| Variant 3 project cut 15 % | MP §7 | Proposed |
| Launch countdown 300 ticks (30 s); Founder Pod stock ×1.25 (`stockMultiplierBp 12500`) | SIM §7.7; W21-08, W21-13 | Decided |
| Bounties ≤ 3 active per colony; expiry 2–48 h; claim window 60 s; defend presence ≥ 80 % | W22-19, W22-20, W22-21 | Planned |

## 6. On-chain vs app vs sim

| State | Truth | Mirror / read model | Source |
|---|---|---|---|
| Deed token, owner, `extra`, settled flag | chain (mock: `mock_chain_nft*`) | `chain.deed` (outbox, `metadata_version`) | DATA_MODEL §4.4.1, W00-35 |
| Deed image | app (rendered from snapshot) | cache per version | NEAR-91 |
| Badge mint status | chain | `BadgeMint` outbox (`prisma/progression.prisma`); not in DATA_MODEL §4.4.1 | profile §5 |
| XP, achievements | app (`XpLedger`, `AchievementUnlock`) | — | profile §5 |
| Settled status, launch gate | sim (`colonySettled`, `launchGate` view) | lobby row `SETTLED` | SIM §7.7, W21-05, W21-14 |
| Staking position | chain (pool) | `chain.staking_position`, read model only | DATA_MODEL §4.4.1, W20-20 |
| DAO balance, members, proposals | chain (mock `mock_chain_dao*`) | `chain.treasury`, `chain.treasury_proposal` | DATA_MODEL §4.4.1, W22-03 |
| Active project effect | sim (timer in planet state, `untilTick`) | HUD badge | W22-01, W22-10 |
| Escrow balance | chain (`mock_chain_escrow`) | `chain.bounty` | W22-17, DATA_MODEL §4.4.1 |
| Bounty completion | sim (`clear_nest`, `defend_area`); server for `deliver_units` | `chain.bounty.state` | W22-20..22 |
| Bounty reward | on-chain cargo tokens (exported stock), not sim stock | — | W22-17, W22-19; see [02](./02-mining-cargo-mint-authority.md) |

## 7. Wave map

- **W20 card · deps:** W06, W01, W00; fields need W05, W08, W13, W14, W18, W21 when on · **`@hack`:** demo steps 1, 2, 7 (W20-28) · **DoD:** w20 + earlier e2e green; `TA_WAVES=..19` hides Deed, staking, pushes with `chain.deed` untouched; deed and staking suites green vs mocks; NEAR-90..93 mapped; tag `wave-20`.
- **W22 card · deps:** W13, W10, W07, W06, W11 (W18 for mercenaries / `defend_area`) · **`@hack`:** steps 1, 2, 3 (boost), 4, 5, 8 (W22-36) · **DoD:** w22 + earlier e2e green; `TA_WAVES=..21` removes Council, Bounties, mercenaries and the fee leg while W13 stays zero-sum; treasury and escrow suites green; NEAR-100..112 mapped; tag `wave-22`.
- **W21 / W12 (cited rows only):** every W21 row is untagged (post-hackathon); W12-25/26 untagged, W12-32 (H).

| Rules | Issues (H tag) | Gap |
|---|---|---|
| R05-1..4, 6, 8, 10, 12, 66 | W20-01 (H), W20-03 (H), W20-04 (H), W20-05 (H), W20-06 (H), W20-07 (H), W20-08 (H), W20-09 (H), W20-10 (H), W20-28 (H); base W00-35 (H) | R05-13 step sizes; `deed-metadata.spec.ts` named by no issue |
| R05-5 | — | **no issue** (dens/nests field) |
| R05-7, 9, 25 | W20-14 (—), W20-15 (—), W20-11 (H+) | `abandoned` trigger undefined |
| R05-11 | W20-12 (H+) | — |
| R05-26..30, 33 | W20-13 (—), W20-16 (—), W20-17 (—), W20-18 (—), W20-19 (—), W20-20 (—), W20-21 (—), W20-22 (—), W20-23 (—) | NEAR §1a port table not updated (OWNER_TASKS N3) |
| deed/stake support | W20-24 (—) explorer, W20-25 (—) toasts, W20-26 (—) telemetry, W20-27 (—) console | — |
| R05-14..17, 65 | W12-01 (H), W12-05 (H), W12-25 (—), W12-26 (—), W12-32 (H), W23-29 (—), W23-30 (—), W23-31 (—) | badge owner account: no issue; W12-32 depends on untagged rows |
| R05-18, 19 | — | **no issue** reconciles MP §8 achievements |
| R05-20..23, 62, 74 | W21-04, W21-05, W21-06, W21-07, W21-08, W21-09, W21-10, W21-12, W21-13, W21-14, W21-16, W21-17, W21-19, W21-26, W21-27 (all —) | denominator conflict (Q-05-2) |
| R05-26 claim | W21-15 (—), W20-19 (—) | see [01](./01-accounts-keys-relayer.md) |
| Settler XP | W21-18 (—), W12-06 (—) | — |
| R05-31, 32 | W23-32 (—), W23-33 (—), W23-34 (—) | mainnet pool list: no issue |
| R05-35..41, 43, 45, 60, 61, 63 | W22-01 (H), W22-03 (H), W22-04 (H), W22-05 (H), W22-06 (H), W22-07 (H), W22-08 (H), W22-09 (H), W22-13 (H), W22-14 (H) | R05-39 conflict |
| project effects | W22-11 (H) boost, W22-12 (H+) subsidy, W22-10 (—) shield, W22-15 (—) VFX | — |
| R05-42 | W22-16 (—) | — |
| R05-44, 46..48, 69, 70, Balance costs, Guild-fill leg | — | **no issue**: burn path, token, 300/450/250, 0.2 % Guild leg, fauna shield |
| R05-49 | W22-11 (H); real DAO W23-35 (—), W23-36 (—), W23-37 (—) | W22 is drop #4 (HACKATHON_CUT §3) vs MP Must |
| R05-50..54, 59 | W22-02 (H), W22-17 (H), W22-18 (H), W22-19 (H), W22-20 (H), W22-23 (H), W22-25 (H), W22-36 (H), W22-24 (H+) | W22-20 refund depends on H+ W22-24 |
| R05-55 | W22-21 (—), W22-22 (—), W22-26 (—) markers | — |
| R05-56..58, 64 | W22-27 (—), W22-28 (—), W22-29 (—), W22-30 (—), W22-31 (—), W22-32 (—), W22-33 (—) | AW-20 conflict |
| support | W22-34 (—) telemetry, W22-35 (—) console; real escrow W23-38 (—), W23-39 (—), W23-40 (—); migration W23-41 (—) | `treasury.fund` (W22-35) not in H; escrow workspaces test (NEAR §15) only in W23-38 |
| R05-67, 68 | W20-23 (—) covers no-perk only | no rule excludes other staking |
| R05-71, 72 | W22-05 (H), W25-31 (H) | no issue checks five lazy DAOs or the 10/12 criteria |
| R05-73 | W11-05 (—) | no rank in the hackathon |

## 8. Open questions

| # | Question | Proposed default (source) |
|---|---|---|
| Q-05-1 | Which module produces `rank` (planet rank? score?), and what are the step sizes for walls and trade volume? | none in repo; `rank` only from W11-05 (R05-73) |
| Q-05-2 | The gate (D-18, UO-R-01) excludes footprints but UO-TF-06 Terraform % does not; W21's demo `312 / 325` and Balance §4.1 use the Terraform % denominator. Which does W21-04 count? | D-18 wording (= Balance §8 proposal) |
| Q-05-3 | Does the deed's `terraformBp` and `colonySettled.terraformBp` use UO-TF-06 (max ≈ 78 %)? | UO-TF-06 (Balance §4.2) |
| Q-05-4 | Testnet → mainnet staking pool list and who maintains it | W23-34 runbook; OWNER_TASKS whitelist task |
| Q-05-5 | What triggers deed status `abandoned` (W20-14), given D-18 has no departure without settlement? | none |
| Q-05-6 | Which account owns a badge (player named account or colony)? Can a guest without a named account earn a mintable badge? | none; see [01](./01-accounts-keys-relayer.md) |
| Q-05-7 | Adopt MP §8 achievements (Den Hunter, Councilor, Terraformer) or keep profile §3's 20 frozen ids? | profile §3 (D-29 frozen ids) |
| Q-05-8 | When is a `BadgeMint` row `skipped`? | none |
| Q-05-9 | Pass rule: > 50 % of members only, or also W22-03's "≥ 2 yes, no no"? Do Settled colonies (never voting) count in the denominator? | > 50 % of members (W22-03 first clause) |
| Q-05-10 | Closed → Q-03-1 (owner 03) | — |
| Q-05-11 | Closed → Q-02-3 (burn signer and the DAO burn path; the W22-09 "burn or only debit" part moved there) | — |
| Q-05-12 | Which token(s) does the treasury hold (fee legs arrive in each traded token), and how is "1 000 cargo-equivalent" priced? | none |
| Q-05-13 | Are effect durations (12 h / 6 h, `untilTick`) game time or real time? The 6 h TTL is real time (W22-09): does `warp` advance it? If not, no vote passes on camera and the Pivot kill switch "vote in progress" applies | none |
| Q-05-14 | Adopt Balance costs 300 / 450 / 250 and the 0.2 % Guild-fill leg in W22-13 / W22-07? | Proposed (Balance §8, Review C3 change 8) |
| Q-05-15 | Mercenary away spend: a separate cap (W22-31) or uncapped defense spending (AW-20)? | none |
| Q-05-16 | Lazy-create (W22-05) is the only path in the pivot's sector (planets auto-created by W01-05, no W11). Is it covered by the `@hack` e2e? | check in W22-36; five DAOs in the Pivot season (R05-71) |
| Q-05-17 | Can bounty rewards be NEAR in the hackathon, or cargo only? | cargo (demo "200 metals") |
| Q-05-18 | Is own-NEAR staking on a Settled Deed the only staking? Rule out cargo staking, game-paid yield, stake-weighted votes and stall bonds in a spec? | yes (D-18 rejects game rewards) |
| Q-05-19 | Deed transferability: a deed is a NEP-171 token on the colony account; after claim the player can transfer it. Does staking follow the deed or stay with the colony account? Can a transferred deed still receive operator updates? | none |
| Q-05-20 | What happens to a staked position and the deed when the planet ends and archives (W11-04/05 deed hook)? Does the colony account outlive the planet? | none |
| Q-05-21 | Add a `fauna_shield` kind (MP §6 C), or fold it into `meteor_shield`? Absorbs Q-04-25 | Drop, or widen `meteor_shield` to fauna (default from closed Q-04-25) |
| Q-05-22 | What counts as "qualify" for tracks 10 / 12 (W25-31): mock deed and mock DAO on the live planet, or real NEP-171 / SputnikDAO? | Pivot §5: "only if live" |
| Q-05-23 | Card string: "Recorded (mock)" (W12-26) or "Recorded on NEAR (mock)" (W20-10)? Tag W12-25/26 H or drop PA-05 from W12-32 (H)? | none |

## 9. Grill questions per wave

- **W20:** Which issue adds dens/nests to `DeedMetadataV1` (MP §8)? Who emits `rank`? Does the S4 scenario have W05/W08 on so steps 1–2 show terraform and stage? Is the "(mock)" label on the card enough for the README mock/real table? Is W20-11's gold frame needed in H when settlement is post-hackathon?
- **W21:** Which denominator does W21-04 count (Q-05-2), and why does the demo show 325? W21-27's acceptance already asserts the Settled Deed of W20-15: how, with both untagged and in different waves? Which account does W21-15 claim, and does an FC key stay (Q-01-11)? Who emits `rank` once W11 is dropped (R05-73)?
- **W12:** Are W12-25/26 out of the H slice for good (Review §5), and then how does W12-32 (H) assert PA-05 (Q-05-23)? Badge owner (Q-05-6). Is a Councilor family wanted, given ids are frozen?
- **W22:** Pass rule (Q-05-9); carved vs additive leg (Q-03-1); burn mechanism and token (Q-05-11, Q-05-12); can a 1 000-unit boost pass in a demo without `treasury.fund` (W22-35 is not H) — where does the seeded balance come from? Does W22-20's refund work without W22-24? The 6 h TTL is real time: does `warp` advance it, or can no vote pass on camera (Q-05-13; Pivot kill switch "vote in progress")? Five lazy DAOs in the season (R05-71)? Fauna shield (Q-05-21)? Pivot: external agents vote as colonies; W22-16 says the director never votes. Is that consistent?
- **W23:** SputnikDAO vs Trezu (W23-35) fit for "1 colony = 1 vote" and burn; who signs staking on the claimed account (W23-32 depends on W23-14); pool whitelist owner (W23-34); deed / DAO / escrow migration order (W23-41).
