# 07 — Gaps and grooming (cross-cutting view)

> **Status:** 2026-10-31, grooming reference (legend, precedence, abbreviations: [`README.md`](./README.md)). This file restates no rule: every cell points to a rule (`R0x-n`), a question (`Q-0x-n`), an owner decision (`OD-nn`, §7) or a number (`N-nn`, §8) in files [01](./01-accounts-keys-relayer.md)–[06](./06-near-tools-and-adapters.md). Wave agendas that use these ids: [`08-wave-grill-checklist.md`](./08-wave-grill-checklist.md). Spec wins over this file.

## 1. Coverage of the owner's six topics

Completeness: 0 = absent · 1 = mentioned · 2 = rules + flows, open questions block H work · 3 = rules, flows, numbers, wave map; open items do not block H work.

| Topic | Reading | Files · rule ids | Done | Remaining gap ids |
|---|---|---|---|---|
| Trading rules | order book, matching, fees, settlement, failure | 03 R03-1..R03-63; 06 R06-1..R06-10 | 2 | Q-03-1, Q-03-2, Q-03-5, Q-03-7, Q-03-26, Q-06-1 |
| Robot / agent communication | in-colony robots (lanes, dispatch, HQ goals) | 04 R04-36, 04 §4 "In-colony", 04 §6 channels | 3 | — (sim only, no chain) |
| | colony ↔ colony | 04 R04-37, R04-38, R04-58; 03 R03-59 | 2 | Q-03-20, Q-04-10 (truces are W18, —) |
| | colony ↔ Guild | 04 R04-7, R04-12, R04-19; 03 R03-47, R03-48 | 2 | Q-03-6, Q-04-6, Q-06-18 |
| | external agents via API / MCP | 04 R04-44..R04-49, R04-56; 01 R01-41, R01-42 | 1 | Q-04-16, Q-04-17, Q-04-22, OD-19 (no issue exists) |
| | agent ↔ agent on-chain | 04 R04-58; 03 R03-62; 06 R06-68 | 2 | Q-06-18, Q-03-20, Q-06-17 |
| Planet mining → cargo | deposit → stock → export (mint) / import (burn), supply ledger | 02 R02-1..R02-53, 02 §6 ledger | 3 | Q-02-1, Q-02-3, Q-02-4, Q-02-13, Q-02-18 |
| User planet-wide trading | one book per planet and pair, stalls, board, season | 03 R03-2, R03-5, R03-58..R03-61 | 2 | Q-03-29, Q-03-31, Q-03-13, Q-06-19 |
| Staking | own NEAR on a Settled Deed; no other staking | 05 R05-26..R05-34, R05-67, R05-68 | 2 | Q-05-18, Q-05-19, Q-05-20, Q-01-11 (all post-hackathon) |
| NEAR tools | Intents · NEAR AI Cloud · NEAR Auth · NEPs · access keys · SputnikDAO · RPC · 1Click · HOT / Chain Signatures · agent skills | 06 R06-1..R06-38, R06-63..R06-67, R06-77..R06-80 | 2 | Q-06-1, Q-06-5, Q-06-8, Q-06-9, Q-06-10, Q-06-17, Q-01-21 |

## 2. Master plan §0–§10 matrix

Every item of [`MP`](../../terraagent-master-plan-final.md) maps to a pack location. "Out of chain scope" items carry their disposition pointer. Where a cell cites several rules, the statuses follow in rule order.

| MP | Items (each named) | Pack location | Status / open |
|---|---|---|---|
| §0 | Treasury project costs → burn | R05-46; burn signer R02-53 | Proposed · Q-02-3, OD-14 |
| §0 | Social login → NEAR Auth | R01-3, R01-4, R06-20..R06-26 | Proposed · OD-01 |
| §0 | NEAR AI Cloud verifiable layer (Guild / Director asks LLM, shows attestation) | R06-13, R04-21, R04-22, R06-15, R06-16 | Proposed · OD-08 |
| §0 | Fee control 0–3 % is Must | R03-21 (W13-22 H+) | Decided rule, client H+ · OD-06 |
| §0 | One treasury project (terraform boost) Must | R05-49; W22-11 (H) | Proposed · W22 is drop #4 in the cut |
| §0 | Guild NEAR float "safest" (no NEAR/USDC pairs, float unused) | R03-38, R04-51 | Proposed · OD-02 |
| §0 | Protocol fee exists, goes to project owner | R03-26; account 01 §2 row "Project protocol-fee account" | Proposed / Gap · OD-04 |
| §1 | Track table: NPCs with wallets · player-owned markets · economies evolve without patch · players never notice chain · NEP-245 | R04-1, R04-23 · R03-1, R03-21 · R04-17, R04-18, R05-45 · R01-1, R01-43 · R02-12 | track map §6 |
| §1 | Trust boundary (server sim mints; chain for ownership, settlement, deeds, treasury; only settlement waits) | R02-1, R02-45, R03-57 | Decided |
| §2 | 3 families, 10 ids, Energy not a token · storage caps per family · tier unlocks by terraform % · daily mint cap 20 000 · throughput 250/900/3 500 | R02-8, R02-12 · R02-11 (R02-39) · R02-9 (R02-40) · R02-23 (N-01) · R02-16 (N-05) | Decided |
| §3 | Must #1 invisible chain · #2 cargo NEP-245 | 01 R01-1..R01-35 · 02 R02-12..R02-37 | Decided; real only H2 (R06-50) |
| §3 | Must #3 markets on Intents + fee 0–3 % | 03; R03-21 | OD-06 |
| §3 | Must #4 Guild resource-for-resource + verifiable NEAR AI Cloud layer | R04-1..R04-12; R04-21, R04-22 (no issue) | OD-02, OD-08 |
| §3 | Must #5 AI Orchestrator (planet + wild directives) | out of chain scope → Balance §6 / Review C1, C2; R04-42, R04-43 | Proposed · OD-10 |
| §3 | Must #6 one treasury project | R05-49, R05-61 | Planned W22-11, W22-36 (H) |
| §3 | High Stretch: deeper attestation UI · extra treasury projects · dens visual polish | R04-22 · W22-10, W22-12 (R05 §5), Q-05-14 · out of chain scope → Balance §6 / Review C2 | Proposed |
| §3 | Later / mock: Deed full staking · full bounties / mercenaries · cross-planet carry · NEAR pairs | R05-26..R05-34 · R05-55..R05-58, R05-64 · R04-15, R02-30 · R03-38 vs R03-39 | Planned (—) / OD-02 |
| §4 | Orchestrator cadence 5–15 min, attestation on every response, Planetary Log or Guild panel | R06-14; N-20; Planetary Log 04 §5 MP-field table | Proposed · Q-04-15 |
| §4.1 | `fauna_spawn_modifier` · `new_den_chance` · `disaster` · `disaster_intensity` · `global_yield_modifier` · `reason` · rule "habitat_pressure > 55" | out of chain scope → Balance §6 / Review C2; dispositions in 04 §5 MP-field table | Proposed / Gap · Q-04-15 |
| §4.2 | `directive` enum · `intensity` · `duration_minutes` · `reason` · "player can accept/override" | out of chain scope → Review C1; 04 §5; R04-42 | Proposed · Q-04-14 |
| §4.3 | `offers` (resource, side, amount 150–400, `spread_pct` 4.5–12) · `priority` · `reason` | R04-21 (vs NEAR-71); reason → R04-16 | Proposed · Q-04-8, Q-04-5 |
| §5 | Den rows: base spawn 8–14 min · modifier ×0.6–1.8 · wave 4–12 · HP 80–140 / dmg 12–22 · habitat radius 10 · anger +1.5 / Living tile · destroy cost 400 M + 250 Min · destroy effect +25 · max dens 3 | out of chain scope → Balance §6 / Review C2; per-row dispositions in 04 §5 | Proposed |
| §5 | On-chain touchpoints of dens | `clear_nest` bounty R05-50, R05-52 · deed "dens destroyed" R05-5 · Den Hunter R05-18 · "fauna shield" R05-70 | Q-05-21 |
| §6 | Scenario A steps 1–7 · B (mass_export, accept, market + dust storm) · C (den pressure, truce, shield vote) | 08 demo-beat map, each beat a row | keep / drop / seed per row |
| §7 | Principle "never pays out real NEAR from treasury" | R05-69; consistent with R05-28, R05-67 | Proposed |
| §7 | V1: protocol 0.25 % · stall 0–3 % · treasury 20 % of stall fee → burn · example 1 000 @ 1 % (+10 / +2 / +2.5) | R03-26 · R03-21 · R03-54, R05-46 · R03-55 | Proposed / Planned · OD-04, OD-05 |
| §7 | V2 protocol 0.40 % · V3 0.25 % + optional 15 % of project cost | R03-26 · R03-27, R05-47 | Proposed, no issue |
| §7 | Later: premium (order slots, priority Guild visits, robot skins) · sponsored gas / relayer tips · badge / deed cosmetics | 03 §5 monetization table "Later" row | Proposed, no issue |
| §7 | "Show the 0.25 % line in the settlement toast" | R03-26, R03-45 (W13-24) | Proposed · Q-03-7 |
| §8 | Achievements: Merchant 5/50/500 · Port Authority 100/1k/10k · Guild Contact 5/50/250 | R03-43 (W12-01, W13-27) · 04 §4 Guild flow (`progress.guildContact`, W15-25) | Planned |
| §8 | Achievements: Terraformer · Den Hunter 1/3/5 · Councilor | R05-18 (vs profile §3) | Proposed · OD-11, Q-05-7 |
| §8 | NFTs: Colony Deed (dynamic; terraform, volume, dens, rank) · Badge NFTs (non-transferable, Stretch) · Deed as later staking vehicle | R05-1..R05-13, R05-5, R05-73 · R05-14..R05-19 · R05-34 | Decided / Planned / Proposed |
| §9 | `{name}.terraagent.near` (NEAR Auth) · `{colony}.{name}` · `guild-N.npc` restricted keys · relayer pays gas, allow-list only · app keys encrypted, claim later | 01 §2, R01-2 · R01-13 · R01-39, R04-3 · R01-27..R01-29 · R01-16, R01-19, R01-20 | Decided · Q-06-7, Q-06-17, Q-01-11 |
| §10 | Everything on mocks first · day-10 gate (login, cargo, markets, **Guild**) · README states real vs mock | R06-50 (Guild not in the cut's H2) · R06-52 · R06-54 | Decided / Conflict · OD-03, OD-13 |

## 3. Outward-claims matrix

"Copy changes if" names the open item whose other answer forces a rewrite. Statuses follow the cited rules in order. Sources: [`WP`](../public/whitepaper.md), [`landing-brief`](../public/landing-brief.md), [`media-plan`](../public/media-plan.md), [`Playbook`](../LAUNCH_PLAYBOOK.md), [`Pivot`](../GRAND_PRIZE_PIVOT.md), [`Review`](../MASTER_PLAN_REVIEW.md).

| Claim (where) | Rests on | Status | Copy changes if |
|---|---|---|---|
| Social login gives `name.terraagent.near`, no seed / popup / gas (WP §3, landing `chain`, `final`) | R01-2, R01-3, R01-4 | Decided / Proposed / Gap | Q-01-2 = provider parent account; OD-01 = custodial fallback |
| "Land now (Google login)" (landing `hero`); human logs in with Google (Pivot §5 1:55) | R01-4 (Google offered), W23-11 (H2) | Gap · Planned | OD-03 keeps F5 mock (then "Google (mock)") |
| Colonies are sub-accounts that hold cargo, sign orders, own the deed (WP §3) | 01 §2, R03-8, R05-1 | Decided | — |
| Director signs with a restricted key whose allowance is the away budget; one tap revokes (WP §3, landing `drop`, `director`) | R04-23, R04-24 | Decided / Conflict | Q-04-1 picks W15-18 basis (allowance = autoTrade caps) |
| "Enforced by the key, not by a prompt"; "can never spend more than you allowed" (WP §3, landing `director`) | R04-47, R06-67, R06-64, R06-65 | Proposed / Gap | Q-06-17 confirms gas-only FC allowance → "enforced by the server" |
| Agent cannot spend beyond allowance, move NEAR, claim, stake (WP §3, media diagram 3, T3 thread) | R04-47 | Proposed | Q-04-16 |
| Agent's allowance covers votes (media diagram 3) | R04-55 | Conflict | Q-04-21 default → votes outside the allowance |
| Guild traders have own sub-accounts, inventories, published rule (WP §3, landing `chain`, Playbook T1 post 4) | R04-1, R04-53, R04-16 | Decided / Planned / Proposed | wallets stay mock (R06-50, R06-68): say "mock" |
| Every offer shows its reason (WP §6, landing `market`, media Video A 35–55 s, GIF 4) | R04-16 | Proposed, no issue | Q-04-5 not added → drop the claim |
| Guild price formula, 24 h VWAP reference, spread 4 → 15 %, clamped (WP §6) | R04-53, R04-9, R04-10 | Planned | Q-04-3 (clamp numbers Gap) |
| Strategy in a TEE on NEAR AI Cloud; "verified" is a goal (WP §6, Pivot Bet C, T3 thread "attested reasoning") | R04-22, R06-15..R06-19 | Proposed / Gap | OD-08 drops Bet C → remove "attested" (Pivot §6 kill switch) |
| External agents found colonies, trade under allowance, vote, get receipts (WP §3, §7; landing `faq`; Pivot §1; Playbook T2, T3) | R04-44..R04-46, R01-41 | Proposed, no issue | OD-19 not taken → Pivot §6 "agents can observe and trade" |
| README step 1 offline local agent (Pivot Bet A, Playbook §4.1) | R04-56, R06-76 | Conflict | Q-04-22 default → "against the local app with mock adapters" |
| NEAR holds accounts, NEP-245 cargo, settled trades, NEP-171 deeds, SputnikDAO-style treasury, bounties (WP §5) | R02-12, R03-31, R05-1, R05-35, R05-50; real only F5/F1/F2 (R06-50) | Decided | WP §7 table already says mock |
| Trade Hub is the only door; export mints, import burns (WP §5, media diagram 1) | R02-45, R02-27 | Decided | Q-02-3 (burn signer) does not change copy |
| Fee leg to stall, treasury leg, protocol-fee leg (WP §5) | R03-1, R03-54, R03-26 | Decided / Planned / Proposed | OD-04 drops the protocol leg |
| "Set a 0–3 % fee, every trade through your stall pays you" (landing `market`) | R03-21, R03-22 | Decided (client H+) | OD-06 keeps W13-22 H+ → fee fixed at default (Q-03-26) |
| Sinks: treasury projects burned, Guild off-planet sales (proposed) (WP §4, media diagram 2) | R05-46, R04-17 | Proposed | OD-14 burn infeasible; Q-04-4 no sink row |
| Storage per sub-resource, T2 by 100 Living tiles (proposed) (WP §4) | R02-39, R02-40 | Proposed | N-03, N-04 stay at spec |
| Cargo mintable only from simulated stock (landing `faq`) | R02-1; exceptions R02-31..R02-33 | Decided | add "except Guild seed" if Q-02-13 sets no cap |
| Markets: one small real trade, dry-run first; NEAR pairs bounded by 10 NEAR float (WP §7) | R03-39, R04-51, W23-24 (H2) | Proposed / Planned | OD-02 = no pairs; OD-03 = no real F2 |
| "Contract signed: 300 iron for 0.012 NEAR at Vega Port · fee 0.00003 NEAR" (media Video A, Pivot §5 1:40, Playbook T5) | R03-63 | Proposed | Q-03-30, Q-03-14, Q-03-15, Q-03-6 |
| `execute_intents` with three legs summing to zero (media §4 screenshot) | R03-29, R03-63 | Decided / Proposed | treasury leg on (W22) or protocol leg (OD-04) → 4–5 legs |
| Real named account from Google on D6; real mint D9; real Intents trade with fee line D11 (Playbook §2) | R06-52, R02-37, W23-24 | Proposed / Decided / Planned | OD-03 = D10 gate; Q-03-2 (1-unit trade fee 0) |
| "300 iron left the planet; here is the NEP-245 transfer" (Playbook D9) | R02-37 (mainnet smoke 1 unit), Q-02-18 | Decided / Conflict | the smoke mints 1 unit, not 300 |
| Player lands on the next planet with "part of the cargo" (WP §8) | R02-48 | Conflict | Q-02-21 default → "all in-orbit cargo" |
| Own-NEAR staking on a Settled Deed, no in-game power, post-hackathon (WP §8, landing `roadmap`) | R05-26..R05-29 | Decided | — |
| Planet DAO funded by fees; vote passes and globe greens (Pivot §5 1:20, media GIF 6, Video B) | R05-43, R05-61 | Decided / Planned | Q-05-13 (6 h real-time TTL) → "vote in progress" |
| Each planet has its own market, treasury and Guild schedule (landing `planets`) | R03-2, R05-35, R04-6 | Decided / Planned | Q-04-23 (2 NPCs over 5 planets) |
| Protocol fee paid in cargo, no NEAR value yet, say so in README (Review §4.3) | R03-28 | Proposed | OD-02 adds a NEAR line |
| Achievement list "matches the profile spec's 20 families" (Review §6) | R05-18 | Proposed (Review is wrong) | OD-11 |
| "No anti-cheat / anti-bot; Guild float is the loss limit" (WP §9) | R03-51, R04-51 | Decided / Proposed | Q-03-17 records wash trading |
| `intents.near` mainnet only; tiny amounts and dry runs (WP §9) | R03-36, R06-2 | Decided | — |
| Apply to NEAR Protocol Rewards (Playbook Nov 18) | R06-80 | Proposed | — |

## 4. End-to-end swimlane

"H?" = what runs in the hackathon (06 §7 last column). Keys and their limits: Q-06-17 wherever a function-call (FC) key would have to attach a deposit.

| # | Step | Signer | Key | Gas payer | H? | Failure path | Rules |
|---|---|---|---|---|---|---|---|
| 1 | Guest | — | device secret | — | mock-free (no chain) | — | R01-1 |
| 2 | Login → Pilot ID | creator of `{name}.*`: Gap (root vs relayer) | app ed25519 under KEK, or NEAR Auth derived key | relayer ("relayer-funded") | mock W06 (H); real W23-10..12 (H2) | `NEAR_PROVIDER_REJECTED` → stay guest; cancel → guest | R01-2..R01-12, Q-01-1, Q-01-2 / Q-06-7 |
| 3 | Found colony | same as 2; `storage_deposit` by colony key | per-colony app key | relayer | mock W06-08, W06-12 (H); deed mint W20-05 (H, mock) | relay retry toast; `opId` dedupe | R01-13, R01-50, R05-1, R05-2, Q-01-5 |
| 4 | Mine | — (sim) | — | — | sim | caps halt output | R02-6..R02-11 |
| 5 | Export (mint) | `minter` | full-access file secret | relayer | mock W10 (H); real W23-19/20 (H2, mainnet smoke 1 unit) | `mint_cap`, `hub_offline`, refund on fail, `market_unavailable` | R02-19..R02-26, R02-49, Q-02-1 |
| 6 | Deposit to verifier | colony account | app full-access key until claim (R01-19); an FC key cannot attach 1 yocto | relayer | mock W13-09 (H); real W23-21 (H2) | method Conflict; storage cost unknown | R03-13, R03-56, R06-6, R06-65, Q-06-1, Q-06-3 |
| 7 | Place order | colony key signs NEP-413 `token_diff` | custodial colony key | none (off-chain signature) | mock W13-07/09 (H); real W23-22 (H2) | reject codes R03-53 | R03-7..R03-15, Q-03-5, Q-03-11 |
| 8 | Match | market module | — | — | app | crossed book | R03-16..R03-20, Q-03-4, Q-03-18 |
| 9 | Legs | server signs fill-sized diffs; receive-only legs: Gap | custodial colony keys; NPC key; director key | — | mock (H) | sum ≠ 0 → `NEAR_INTENT_DIFF_NOT_ZERO` | R03-17, R03-29, R03-30, Q-03-9, Q-03-19 |
| 10 | Settle | relayer submits `execute_intents` after `simulate_intents` | relayer key | relayer | mock W13-13 (H); real one tiny trade W23-22..24 (H2); Guild / director legs cannot settle real while AgentWallet is mock | FAILED → orders back to book, release | R03-31, R03-32, R06-5, R06-68, Q-03-3, Q-06-18 |
| 11 | Treasury leg | DAO receives inside the batch | — | — | mock W22-07 (H); no real DAO (W23-35..37 —) | rounding to 0 | R03-24, R03-54, Q-03-1, Q-03-2, Q-03-19 |
| 12 | Vote | colony account | colony key (DAO receivers are on the relayer allow-list, not on FC keys) | relayer | mock W22-03, W22-09 (H) | `ALREADY_VOTED`, `PROPOSAL_CLOSED`, `NOT_A_MEMBER`, below quorum → Expired | R05-37..R05-42, R01-29, Q-05-9, Q-05-13 |
| 13 | Project burn | Gap: `minter` only may `mt_burn`; DAO holds the cargo | — | — | mock debit W22-09 (H); no real path | — | R05-46, R02-53, Q-02-3 / Q-05-11 |
| 14 | Deed update | relayer as operator | relayer key | relayer | mock W20-06/07 (H); real W23-31 (—) | pending + retry badge | R05-3..R05-9, Q-05-1 |
| 15 | Launch → Settled | sim; deed settle by relayer | relayer key | relayer | post-hackathon (W21 —, W20-15 —) | `launch_gate` | R05-20..R05-25, R05-74, Q-05-2 |
| 16 | Claim | player wallet (NEP-413), then `add_key` / `delete_key` on the account | player full-access key; residual app FC key: Conflict | not stated (account actions are not on the allow-list) | mock W21-15/16 (—); real W23-14 (—) | wrong network suffix, nonce expiry | R01-19..R01-26, Q-01-11, Q-01-5, Q-01-21 |
| 17 | Stake | claimed colony account via wallet | player key | player (never the relayer) | mock W20-18 (—); real W23-32 (—) | `DEED_NOT_SETTLED`, `ACCOUNT_NOT_CLAIMED`, "Cancelled in wallet" | R05-26..R05-31, R06-34, Q-05-19 |

## 5. Accounts registry and supply ledger pointers

| Register | Owner section | Remaining gaps |
|---|---|---|
| Accounts registry (root, `colonies.*`, relayer, minter, `res` / `deed` / `bounty`, planet DAOs, `intents.near`, named, colony, `npc.*`, Guild, mercenary, protocol-fee account, payout wallet, `dev-a` / `dev-b`, agent colonies) | 01 §2 | protocol-fee account (Q-03-7); `colonies.*` parent and `{name}` creator (Q-01-1); deployer key holder for `res` / `deed` / `bounty` not stated; `npc.*` key holder not stated; `dev-a` / `dev-b` Proposed only; payout wallet kept apart from relayer / minter (01 §9 W25-31); NEAR AI Cloud API key, 1Click JWT and NEAR Auth credentials have no named holder (06 §9 "Owner, Nov 1") |
| Supply ledger (every mint and burn path) | 02 §6 "Supply ledger" | Guild seed amount and cap (Q-02-13); Guild T2 restock mint (R02-41, Q-04-4); import burn signer (Q-02-3); Guild off-planet sale burn or hold (R02-53); treasury burn (Q-05-11); carry-over amount (Q-02-21); mock → real re-mint (R02-33, W23-41 —) |
| Live-sector chain budget | 06 §5.1 | Q-06-19, Q-01-17 / Q-06-14 |

## 6. Track requirement map

Requirements: track 09 and 07 / 05 from Review §3.1, §3.2; tracks 10 / 12 from NEF F6 / F7, Pivot §5 ("only if live") and W25-31. Statuses follow the cited rules in order.

| Track | Requirement | Rules | Status | Open |
|---|---|---|---|---|
| 09 | NEP-245, one contract for every item | R02-12, R02-37 | Decided; real H2 | Q-06-1, Q-06-4 |
| 09 | Social / email sign-in only; no seed phrase, wallet popup, gas prompt | R01-1..R01-4, R01-43 | Decided / Proposed | OD-01, OD-03; W06-21 (—) copy lint |
| 09 | NPC merchants with own wallets and inventories, prices from stock and demand | R04-1, R04-8, R04-53 | Decided / Planned (wallets mock) | Q-04-3, Q-06-18 |
| 09 | Pricing rules in one readable file + reasoning tooltip | R04-16 | Proposed, no issue | Q-04-5 |
| 09 | Fast-forward a week of trading in about a minute | R04-57 | Proposed, no issue | Q-04-5 |
| 09 | Economy changes without a patch | R04-17, R04-18, R05-45, R05-61 | Proposed / Decided | Q-04-4 |
| 09 | Game loop on paper at 30 s / 5 min / session | out of chain scope → Balance §2, WP §2; no README issue | Proposed | add to W25-25 / W25-26 (08 W25) |
| 09 | Bonus: players never notice the chain | R01-43, R01-44 | Decided / Planned | W06-21 not H |
| 07 | Negotiate: one counteroffer with reasoning | R04-19 | Proposed, no issue | Q-04-6 |
| 07 | Pay through NEAR Intents | R03-50, R04-58, R06-68 | Decided / Planned / Conflict | Q-06-18 |
| 07 | One receipt per task | R04-44 (`receipts`), R03-45 | Proposed / Planned | OD-19 |
| 07 | Key-custody checkpoint: what the agent cannot do without approval | R01-42, R04-47, R06-67 | Proposed | Q-04-16, Q-06-17 |
| 05 | Per-agent sub-accounts | R04-1, 01 §2 Guild rows | Decided (mock) | — |
| 05 | A coordinator | R04-40 (market module) | Decided | — |
| 05 | `RULES.md` before code | R04-46 | Proposed, no issue | OD-19 |
| 05 | Scripted simulation mode with no LLM calls | R04-57 | Proposed, no issue | Q-04-5 |
| 05 | A live page | R03-58 (price board); season dashboard (Pivot §2) | Planned / Proposed | Q-03-31 |
| 10 | NFT that does something: deed updates on milestones; Settled Deed opens staking | R05-1..R05-12, R05-25, R05-26 | Decided / Planned (mock; staking —) | Q-05-22, R05-72 |
| 12 | Planet DAO funded by fees, votes change the sim | R05-35..R05-45, R05-61 | Decided / Planned (mock) | Q-05-22, Q-05-13 |

## 7. Owner-decision list (D-37 / D-38)

Deadline "Nov 1" = Pivot §8 checklist, D-37 / D-38, or an issue that starts in schedule units 1–5 (HACKATHON_SCHEDULE §3). "Before W.." = before that wave's first affected issue starts.

| OD | Decision | Options | Pack default (source) | Closes | Changes waves / issues | Deadline |
|---|---|---|---|---|---|---|
| OD-01 | Login provider and custody | NEAR Auth · HOT / other · custodial named accounts | NEAR Auth with custodial fallback (MP §0, Review C6, R01-5) | Q-01-3, Q-01-2 / Q-06-7, Q-06-8, Q-01-1, Q-01-4 | W23-09..12 (H2); W06-02 mock "X"; D-18 claim if MPC | Nov 1 (mainnet application) |
| OD-02 | NEAR pairs in the demo (Bet B) | none (MP §0) · 3 T1/NEAR pairs + 10 NEAR float (Pivot Bet B) | none until owner records D-38 (MP §0, Review C7); kill switch D11 | Q-03-15, Q-03-14, Q-03-27, Q-06-2, Q-04-7 | W13-17 tag, W15-12 → H, W23-25, W23-26/28, toast fee line | Nov 1 |
| OD-03 | Real-NEAR start | D10 gate (D-27, cut §3) · D6 (Pivot §4, Review change 2) | D10 gate (Decided) unless D-38 | Q-06-13 | W23 H2 rows; staffing (two extra agents) | Nov 1 |
| OD-04 | Protocol fee: payer, recipient account, issue | taker from received token · both sides; new S issue in W13 · none | taker (Balance §10 Q6); one S issue in W13 (Review C4); account Gap | Q-03-7, R03-26, R03-28 | W13-12, W13-24, README (W25-26), 01 §2 registry | before W13-12 (u12) |
| OD-05 | Treasury leg | carve-out of stall fee · additive | carve-out (NEAR-101, W22-07, Balance §7.2) | Q-03-1, Q-03-2 (rounding) | W13-02 note (u1), W13-31, W22-07 | Nov 1 (W13-02) |
| OD-06 | Tags W13-22 (fee slider) and W15-12 (float guard) | H+ · H | W13-22 → H (Review C3); W15-12 → H only with OD-02 | Q-03-16, Q-04-7 | regenerate HACKATHON_SCHEDULE | Nov 1 |
| OD-07 | Default stall fee and `setHubFee` owner | 100 bp in W13-03 · other | `defaultFeeBp = 100`; handler in W13-09 or W13-12 (Q-03-26 default) | Q-03-26, N-07 | W13-03, W13-09/12, W13-35 | before W13-03 (u13) |
| OD-08 | NEAR AI Cloud: provider and home of the Guild LLM call | Z.ai (D-09) · NEAR AI Cloud (Review C1); W16-21 (—) · new W15 row | new W15 row H+, minimal budget gate + decision row, NEAR AI Cloud behind `LlmProviderPort`, Z.ai fallback (Q-04-8) | Q-04-8, Q-06-5, R06-15..R06-19 | W15 new row, W16-07/08/15/21, D-37 | Nov 1 (key) / before W15 (u17) |
| OD-09 | Director allowance: basis, unit, enforcement | away budget (NEAR-80) · autoTrade caps (W15-18); per token · NEAR; key · server | W15-18 basis, per-token per resource, server-enforced (Q-04-1, Q-06-17) | Q-04-1, Q-04-20, Q-06-17, R04-54 | W15-03/04/18/21, W23-26/27, DATA_MODEL `chain.director_key`, WP §3, landing `drop`/`director` | before W15-03 (u19) |
| OD-10 | Drop MP Must #5 (orchestrator) | keep · drop for rules + nest rows | drop; nest rows as data (Review C1, C2; Q-04-14, Q-04-15) | Q-04-14, Q-04-15 | MP §3 list, D-37 | Nov 1 |
| OD-11 | Achievement list | MP §8 · profile §3 | profile §3 frozen ids (D-29) (Q-05-7) | Q-05-7, R05-18 | W12-01 catalogue, MP §8 | before W12-01 (u3) |
| OD-12 | Deposit method and token count | `mt_batch_transfer_call` · `mt_transfer_call`; 10 ids · "4 tokens" | `mt_batch_transfer_call`, 10 ids, drop W23-21a/b, still run a 1-unit mainnet deposit (Q-06-1, Q-06-4) | Q-06-1, Q-06-4, R02-34, R02-44 | NEAR-55, W13-04 mock semantics, W23-17/18/21/38 | Nov 1 |
| OD-13 | ChainRead in the hackathon | real (W23-05/06 H2) · mock (cut §1) | owner picks (Q-06-12) | Q-06-12, R06-51 | W23-05/06 tags or cut §1 | H2 start |
| OD-14 | Burn mechanism | minter-only (transfer to `minter`, then `mt_burn`) · holder burns on `res` · DAO action | none in repo (Q-02-3, Q-05-11) | Q-02-3 / Q-05-11, R02-53 | W10-13 (u11), W22-09, W23-17, Guild sink | before W10-13 (u11) |
| OD-15 | Claim residual key | keep one FC key (NEAR §2, W23-14) · none (D-18, W21-15) | NEAR §2 until decided (Q-01-11) | Q-01-11, Q-01-12 | W21-15, W23-14, D-18 wording, 05 §2 | before WP / landing copy freeze (D12) |
| OD-16 | Season scope | five 5-colony planets from Nov 10 (Pivot §2) · 48 h on one planet from D12 (Pivot §6) · none | none recorded (Pivot is Proposed) | Q-06-19, Q-04-23, Q-03-31, Q-05-16, R05-71 | W22-05 e2e, W25-28, W23-07/08, season dashboard (no issue) | Nov 1 (D-38) / D10 |
| OD-17 | Mock-in-prod and AI config | tag W16-03 · relax `validate-env`; set three allow flags | W25-06 / W25-28 set `NEAR_` / `AI_` / `NOTIFY_ALLOW_MOCK_IN_PROD` (Q-06-6) | Q-06-6, R06-71..R06-73 | W25-06 (u29), W25-28 (u31), W16-03/04, DEPLOYMENT §4 | before W25-06 |
| OD-18 | Relayer guardrails while real NEAR runs | tag W23-07/08 H2 · manual daily check | fresh DB, manual daily balance check (Q-06-14) | Q-01-17 / Q-06-14, N-26 | W23-07/08, W25-13 | H2 start |
| OD-19 | Bet A (Agent API / MCP) | add rows (Pivot §8) · none | none recorded (Pivot is Proposed) | Q-04-16, Q-04-17, Q-04-22, R04-44..R04-49 | new rows in W13 / W15 / W25; README steps | Nov 1 (D-38) |
| OD-20 | Balance rows (mint cap, kit, Guild numbers, project costs) | spec · Balance §8 | spec values until the owner adopts Balance §8 via W00-59 overrides | Q-02-19, Q-04-3, Q-05-14, N-01..N-04, N-15..N-19, N-23 | W00-59 overrides; W10-06, W15-02, W22-13 data | before W10-06 (u7) |
| OD-21 | Wave order W09 vs W15 | W09-13 as a W15 pre-step · move W09 before W15 | W09-13 as pre-step (Q-04-19) | Q-04-19 | W15 deps, schedule | before W15 (u17) |
| OD-22 | Tracks 10 / 12 entry | mock deed / DAO on the live planet · real only | "only if live" (Pivot §5) | Q-05-22, R05-72 | W25-31 | before W25-31 (u34) |

## 8. Numbers sheet

Status = the status of the pack default (one per row); the id after "·" is the open question.

| N | Value | Spec | Wave | MP | Balance | Pivot | Pack default | Status · open |
|---|---|---|---|---|---|---|---|---|
| N-01 | Daily mint cap / sub-resource / colony | 20 000 (NEAR §12) | 20 000 (W10-06) | 20 000 | 10 000 | 10 000 | 20 000 until OD-20 | Decided (value proposed) |
| N-02 | Starting kit | 400/250/150/150 (SIM §7.3) | 600/350/200/200 (W01-09) | — | 400/300/200/150 | — | SIM §7.3 | Conflict · Q-02-19 |
| N-03 | Storage caps | per family | per family (W02-02) | per family | per sub-resource, T2/T3 half | — | per family | Decided |
| N-04 | T2 / T3 gate | 30 % / 70 % share (D-34) | W05-34 | "by terraform %" | 100 / 230 Living tiles | — | share | Decided (value proposed) |
| N-05 | Trade Hub throughput / min | 250 / 900 / 3 500 | W10-06; demo exports 300 at T1 | same | same | — | same; demo 200 + 100 | Decided · Q-02-18 |
| N-06 | Stall fee range | 0–3 %, max 300 bp | W13-03 | 0–3 % | 1 % modelled | — | same | Decided |
| N-07 | Default stall fee | — | e2e asserts 1 %, unset | — | 1 % | — | 100 bp | Gap · Q-03-26 |
| N-08 | Treasury share | 2 000 bp of stall fee | carved (W22-07) | 20 %, additive example | 20 % carved | — | carve-out | Decided (value proposed) · Q-03-1 |
| N-09 | Treasury leg on Guild fills | — | — | — | 0.2 % | — | none until OD-20 | Proposed |
| N-10 | Protocol fee | — | no issue | 0.25 % (V1) / 0.40 % (V2) | 0.25 %, in cargo | NEAR line (Bet B) | 0.25 %, taker | Proposed · Q-03-7 |
| N-11 | Fee unit precision | 18 decimals (NEAR-50) | floor whole units (W13-31) vs 0.6 (W22-07) | — | — | — | — | Gap · Q-03-2 |
| N-12 | Price tick | — | 0.001 (W13-03) | — | 0.0001 NEAR / unit illustrative | 0.012 NEAR / 300 = 0.00004 | 0.001 | Planned · Q-03-14 |
| N-13 | Guild NPC count | — (NEAR-70) | 2 (W15-02); 3 funded (W23-28) | — | 2, offset | 2 for 5 planets | 2 | Conflict · Q-04-24 |
| N-14 | Guild NEAR float | small, capped (NEAR-73) | 5 NEAR, scope unstated (W15-02) | minimal, unused | — | 5 / NPC, 10 total | per OD-02 | Planned |
| N-15 | Guild inventory cap / target | — | 5 000 / unset | — | 10 000 / 3 000 | — | Balance (Q-04-3) | Planned · Q-04-3 |
| N-16 | Guild `k` / clamp | — | formula, no numbers (W15-06) | — | 1.0 / 0.25×–4× | — | Balance (Q-04-3) | Gap |
| N-17 | Guild spread | — | 4 % → 15 % thin side | `spread_pct` 4.5–12 | — | — | W15-02 | Planned |
| N-18 | Guild schedule | NEAR-72 | dock 12 min, gap 20–40 | — | dock 15, gap 10–20, offset | — | W15-02 until OD-20 | Planned |
| N-19 | Guild sink / T2 restock | — | none | — | 10 % / visit; +300 / T2 key / NPC / day | — | two S rows (Q-04-4) | Proposed |
| N-20 | Guild LLM cadence | ≤ 1 / NPC / h (NEAR-71) | hourly (W15-13, W16-21) | 5–15 min | — | hourly (Bet C) | hourly | Decided |
| N-21 | Director allowance | = away budget (NEAR-80) | 600 metals (W15-03); 0.1 NEAR (W23-26) | — | — | — | per token per resource | Conflict · Q-04-1 |
| N-22 | Away budget | 40 % / directive, 60 % / session (AW-20) | W09-11 (—) | "away budget" | — | — | same | Decided (value proposed) |
| N-23 | Treasury project costs | — | 1 000 / 1 500 / 800 (W22-13) | — | 300 / 450 / 250 | — | W22-13 until OD-20 | Planned · Q-05-14 |
| N-24 | Proposal TTL | — | 6 h real time (W22-09) | — | — | vote passed by D12 | — | Planned · Q-05-13 |
| N-25 | Pass rule | none (NEAR-100..102) | > 50 % or ≥ 2 yes, no no (W22-03) | — | — | — | > 50 % | Planned · Q-05-9 |
| N-26 | Relayer low-balance alert; daily spend cap | 5 NEAR; cap has no value (Gap) | W23-07 / W23-08 (—) | — | — | — | 5 NEAR + manual check | Decided (value proposed) · Q-01-17 |
| N-27 | Account / tx cost | ≈ 0.01 / 0.0005–0.002 NEAR (NEAR §12) | W23-16 measures | — | — | ≈ 25 accounts in the season | measure | Decided (value proposed) |
| N-28 | Rocket gate denominator | D-18 (footprints excluded) | W21-04 vs demo `312 / 325` | — | non-footprint, non-wall, non-deep | — | D-18 | Conflict · Q-05-2 |
| N-29 | Bet costs | — | H2 15 units | — | — | A 9, B 4, C 4, season 5 | — | Proposed (Pivot §3) |

## 9. Canonical open questions

Deduplicated across 01–06; closed ids are omitted (Q-01-6, Q-01-18, Q-02-9, Q-02-11, Q-04-9, Q-04-18, Q-04-25 → Q-05-21, Q-05-10, Q-06-20 → Q-01-21, Q-05-11 → Q-02-3, Q-06-7 → Q-01-2, Q-06-14 → Q-01-17, Q-06-16 → Q-04-8). Folded pairs list both ids. **Decider:** owner · spec (a spec or DATA_MODEL edit) · wave (the wave lead in grooming) · verify (NEAR docs or a real call). **Default:** the owning file's proposed default and its source, "—" when none. **Deadline:** schedule unit (HACKATHON_SCHEDULE §3, 10 agents; u ≈ 2.6 × day, so u5 ≈ D2, u13 ≈ D5, u20 ≈ D8, u26 ≈ D10, u32 ≈ D12); "H2" = the first H2 row (D6 Pivot / D10 cut, OD-03). W13-02 starts in u1, so every rule it writes into NEAR.md is a Nov 1 decision. **Sev:** B blocks an H / H2 issue or an outward claim · M changes an acceptance · m wording or post-hackathon. **Order:** deadline bucket (Nov 1 → u6–u16 W06 / W10 / W13 → u17–u22 W15 / W09 → u25–u34 W12-32 / W20 / W22 / W25 → H2 → D10 season → post), then severity inside each bucket.

| Id | Question | Decider | Default (source) | Blocks (H) | Deadline | Sev |
|---|---|---|---|---|---|---|
| Q-03-15 | NEAR pairs in the demo? | owner | D-38; kill switch D11 (Pivot §6) | W13-17 (H+), W15-12 (H+) | Nov 1 | B |
| Q-06-13 | D10 gate or D6 start? | owner | D-38 (06) | W23 H2 rows | Nov 1 | B |
| Q-06-1 | Deposit method: `mt_batch_transfer_call` vs `mt_transfer_call` | verify + spec | `mt_batch_transfer_call`; fix NEAR-55; W23-17 implements it (06) | W13-04 (H), W23-17 (H2) | Nov 1 | B |
| Q-01-3 | Record the login provider | owner | D-37 (Review C9) | W23-09 (H2) | Nov 1 | B |
| Q-06-8 | NEAR Auth name format, gas sponsor, mainnet lead time | verify | apply Nov 1; custodial fallback (06) | W23-10 (H2) | Nov 1 | B |
| Q-03-1 | Treasury leg carved out or additive? | owner | carve-out (03) | W13-02 (H), W22-07 (H) | Nov 1 | B |
| Q-03-2 | Unit precision: floor vs 0.6 vs 18 decimals | spec | — | W13-02 (H), W22-07 (H), W23-24 (H2) | Nov 1 | B |
| Q-03-5 | Pair identity, base token, per-unit price | spec | — | W13-01, W13-02 (H) | Nov 1 | B |
| Q-04-16 | Agent deny list and credential | owner | WP §3 list + AW-14, server-enforced (04) | Bet A rows (none) | Nov 1 | B |
| Q-04-22 | Bet A step 1 offline vs W00-55 | owner | local app with mock adapters (04) | W00-55 (H, landed) | Nov 1 | B |
| Q-06-17 | FC key: one receiver, gas-only allowance, no deposit | verify + owner | server-enforced limits; one key per receiver (06) | W15-03/04 (H), W23-26/27 (—), WP §3 | Nov 1 | B |
| Q-03-4 | Self-trade "rest" crosses the book | spec | — | W13-02, W13-11 (H) | Nov 1 | M |
| Q-03-3 | Failed settlement re-match loop | spec | — | W13-02, W13-14 (H) | Nov 1 | M |
| Q-03-16 | Fee slider H+ vs Must | owner | promote to H (Review C3) | W13-22 (H+) | Nov 1 | M |
| Q-04-7 | Float cap enforced only by H+ W15-12 | owner | promote if a NEAR pair goes real (04) | W15-12 (H+) | Nov 1 | M |
| Q-04-8 | Guild LLM: provider, home, budget gate, authority, cadence | owner | new W15 row H+, NEAR AI Cloud, Z.ai fallback (04) | W16-21 (—) | Nov 1 | M |
| Q-04-15 | Planet directives / nest rows | owner | nest rows as data; drop the rest (04) | none | Nov 1 | M |
| Q-06-2 | wNEAR in the verifier: who wraps, which account | owner | only with Bet B; float as wNEAR (06) | W13-17 (H+), W23-22 (H2) | Nov 1 | M |
| Q-06-4 | "4 tokens" vs 10 ids; drop W23-21a/b | spec | 10; drop; still deposit Nov 1 (06) | W23-18, W23-21 (H2) | Nov 1 | M |
| Q-02-19 | Which starting kit ships | owner | SIM §7.3 (02) | W01-09 (H) | Nov 1 | M |
| Q-05-7 | MP §8 vs profile §3 achievements | owner | profile §3 (05) | W12-01 (H) | Nov 1 | M |
| Q-04-14 | Wild directives | owner | drop (04) | none | Nov 1 | m |
| Q-06-9 | Chain Signatures, HOT, NEAR AI beyond Cloud | owner | "not used directly" in D-37 (06) | none | Nov 1 | m |
| Q-01-7 | Key storage table; player key location; missing tables | spec | W06 migration (01) | W06-09 (H) | u6 | B |
| Q-02-4 | Where the daily cap counter lives; game vs wall time | spec | — | W10-06 (H) | u7 | B |
| Q-02-1 | Snapshot rollback vs outbox; `exportSeq` monotonic | spec | keep seq outside the sim (02) | W10-05, W10-08 (H) | u8 | B |
| Q-02-3 · Q-05-11 | Who burns: `minter` only or holder; DAO burn path | owner | — | W10-13 (H), W22-09 (H), W23-17 (H2) | u11 | B |
| Q-06-11 | Env and port names in waves vs code | wave | rename; add `--dry`, comma lists (06) | W06-22 (H) first | u12 | B |
| Q-03-26 | Default fee; owner of `setHubFee` handler and storage | wave | 100 bp in W13-03; W13-09 or W13-12 (03) | W13-03, W13-35 (H) | u13 | B |
| Q-01-5 | Account-key actions not on the relayer allow-list | spec | — | W06-10 (H) | u6 | M |
| Q-02-6 | Detecting "unreachable"; `market_unavailable` in W10-01 | spec | add the code (02) | W10-01 (H) | u6 | M |
| Q-03-11 | PROTOCOL `placeOrder` / RejectCode drift; client-visible code | spec | update with W13-01; map to `market_unavailable` (03) | W13-01 (H) | u6 | M |
| Q-02-5 | Throughput: per hub, sum, imports / fills | spec | sum of online hubs, exports only (02) | W10-04, W10-06 (H) | u7 | M |
| Q-02-22 | Mock tables `mock_chain_mt_*` vs landed | wave | reuse landed (02) | W10-10 (H) | u7 | M |
| Q-02-14 | Integer amounts and rounding | spec | integer units (02) | W10-05 (H) | u8 | M |
| Q-02-18 | Demo export 300 > T1 250/min | wave | 200, then 100 (02) | W10-05, W10-30 (H) | u8 | M |
| Q-01-13 | Can a guest colony export or trade? | owner | — | W10-05, W06-08 (H) | u8 | M |
| Q-03-10 | `market_order` / `intent_trade` schema drift | spec | align DATA_MODEL (03) | W13-08 (H) | u8 | M |
| Q-02-10 | Failed mint and counters; import needs hub; hub shed | spec | — | W10-07, W10-12 (H) | u9 | M |
| Q-01-8 | `{colony}` label and length budget | spec | — | W06-08 (H) | u11 | M |
| Q-03-18 | Mid-sweep fill failure | spec | — | W13-11 (H) | u10 | M |
| Q-03-9 | `signed_intent` for custodial fills; claimed cancel | spec | — | W13-07 (H) | u11 | M |
| Q-01-16 | One error model (landed vs waves vs PROTOCOL) | spec | add every code to `errors.ts` (01) | W06-19 (H) | u12 | M |
| Q-03-7 | Protocol fee payer, token, account, toast, issue | owner | taker; one S issue in W13 (03) | W13-12, W13-24 (H) | u12 | M |
| Q-02-2 | `cargo.grant` against a real adapter | spec | refuse (02) | W10-26 (H) | u14 | M |
| Q-03-21 | Does a taker / Guild acceptor need a Trade Hub? | spec | — | W13-09, W15-11 (H) | u14 | M |
| Q-01-9 | Reserved names list and suffix | wave | — | W06-04 (H) | u9 | m |
| Q-01-10 | Which name feeds derivation | wave | — | W06-04 (H) | u9 | m |
| Q-01-4 | Mock "X" when NEAR Auth has none | wave | — | W06-02 (H) | u6 | m |
| Q-02-7 | W10-01 error names not in SIM-C-02 | spec | add to SIM-C-02 (02) | W10-01 (H) | u6 | m |
| Q-02-8 | Over-cap export: clamp or reject | wave | reject; slider clamps (02) | W10-06 (H) | u7 | m |
| Q-02-15 | Per-sub caps and import; re-export of imported T2/T3 | spec | — | W10-12 (H) | u9 | m |
| Q-03-27 | Mock `native:near` vs `nep141:wrap.near` | wave | rename, only with Bet B (03) | W13-04 (H) | u9 | m |
| Q-03-28 | W13 text: step 6 fresh ask; `bio.water` id | wave | fix in grooming (03) | W13-04, W13-35 (H) | u9 | m |
| Q-01-14 | "Guest with 2 colonies" vs DM-10 | spec | — | W06-08 (H) | u11 | m |
| Q-03-12 | Orders when a hub is shed or destroyed | spec | — | W13-11 (H) | u10 | m |
| Q-03-25 | Matching while the verifier is down | spec | — | W13-11 (H) | u10 | m |
| Q-06-15 | Outbox table name | spec | `chain.chain_outbox` (06) | W10-08 (H) docs | u10 | m |
| Q-02-12 | `TRADE_HUB_AT_S2` default | wave | — | W10-03 (H) | u13 | m |
| Q-03-8 | "fee paid by buyer" vs taker | wave | "fee paid by taker" (03) | W13-21 (H) | u16 | m |
| Q-03-29 | Stall competition, foreign stall | owner | own stall only in H (03) | W13-21 (H); W13-25, W04-18 (—) | u16 | m |
| Q-03-22 | Port Authority sums fee units across tokens | spec | — | W13-27 (H) | u17 | m |
| Q-03-24 | Toast example NEF F2 vs W13 | wave | use W13 (03) | W13-24 (H) | u17 | m |
| Q-04-1 | Director allowance basis, unit, signer | owner | W15-18 basis, per token, server-enforced (04) | W15-03, W15-18 (H) | u19 | B |
| Q-04-4 | Guild sink and T2 restock: owner wave | owner | two S rows in W15, H (04) | none | u19 | B |
| Q-04-5 | Reason field, pricing file, fast-forward page | owner | `reason` on W15-01; one M row W15 (H) (04) | W15-01 (H) | u17 | B |
| Q-04-19 | W15 needs W09-13, W09 lands later | owner | W09-13 as W15 pre-step (04) | W15-19, W15-20 (H) | u17 | B |
| Q-04-3 | `target`, `k`, clamp numbers | owner | Balance §8 as W15-02 rows (04) | W15-02 (H) | u19 | M |
| Q-04-20 | Allowance decrement on sign or settle | spec | reserve, commit, release (04) | W15-03, W15-21 (H) | u19 | M |
| Q-02-13 | Guild seed and restock mints: any cap? | owner | — | W15-05 (H) | u20 | M |
| Q-03-6 | Stall fee on Guild fills; who pays 0.2 % leg | owner | — | W15-08 (H) | u20 | M |
| Q-04-12 | Deny table and budget unenforced; command shapes; revoke verb | owner | accept, say so in README (04) | W09-09, W15-18 (H) | u20 | M |
| Q-04-23 | 2 NPCs for 5 season planets | owner | offset schedule per planet (04) | W15-09 (H) | u21 | M |
| Q-04-6 | Counteroffer: trigger, count, reason, contract | owner | one W15 row after W15-07 (04) | none | u22 | M |
| Q-04-11 | Digest step 7 `@hack` but W15-24 untagged | wave | tag H or event log (04) | W15-24 (—), W15-34 (H) | u22 | M |
| Q-04-17 | API rate limits (D-25 vs Pivot §7) | owner | — | none | u22 | M |
| Q-03-17 | Wash trading moves VWAP, farms achievements | owner | accepted risk, record it (03) | W15-06 (H) | u19 | m |
| Q-04-2 | autoTrade fields vs AW-13; `truce partners` | spec | W15-19 set into AW-13; hide truce (04) | W15-19 (H) | u22 | m |
| Q-03-23 | Director / agent orders and the 20-order limit | spec | — | W15-21 (H) | u22 | m |
| Q-04-10 | `trade_offer` kind with no producer | spec | drop from H routing (04) | W09-20 (H) | u21 | m |
| Q-04-13 | No offline Guild-arrival notification | owner | accept (04) | W15-09 (H) | u21 | m |
| Q-05-13 | 6 h real-time TTL vs `warp` | owner | — | W22-09, W22-36 (H) | u29 | B |
| Q-06-6 | `validate-env` `zai` rule, `AI_LIVE_REQUIRED`, three allow flags | owner | tag W16-03 or relax; W25-06/28 set flags (06) | W25-06, W25-28 (H) | u29 | B |
| Q-05-23 | Card string; W12-25/26 untagged vs W12-32 | wave | — | W12-32 (H) | u25 | M |
| Q-05-1 | `rank` producer; wall / volume step sizes | owner | — | W20-06 (H) | u27 | M |
| Q-05-9 | Pass rule; Settled in the denominator | spec | > 50 % of members (05) | W22-03 (H) | u26 | M |
| Q-05-16 | Lazy DAO creation in `@hack` e2e; five DAOs | wave | check in W22-36 (05) | W22-05 (H) | u29 | M |
| Q-05-14 | Balance costs 300 / 450 / 250 and 0.2 % leg | owner | Proposed (05) | W22-13, W22-07 (H) | u29 | M |
| Q-05-12 | Treasury token; "cargo-equivalent" | spec | — | W22-13 (H) | u30 | M |
| Q-05-22 | What "qualify" means for tracks 10 / 12 | owner | "only if live" (Pivot §5) | W25-31 (H) | u34 | M |
| Q-03-30 | Video beat 0.012 NEAR / fee / 3 legs | owner | rewrite after Q-03-14 / Q-03-15 (03) | W25-29 (H) | u32 | M |
| Q-05-3 | Deed `terraformBp` denominator | spec | UO-TF-06 (05) | W20-06 (H) | u27 | m |
| Q-05-17 | Bounty rewards in NEAR or cargo | owner | cargo (05) | W22-19 (H) | u27 | m |
| Q-05-21 | "Fauna shield" project kind | owner | drop or widen `meteor_shield` (05) | W22-10 (—) | u30 | m |
| Q-02-16 | Carry-over in the demo story | owner | not in the demo (02) | W25-29 (H) | u32 | m |
| Q-01-2 · Q-06-7 | NEAR Auth parent account and key custody vs app keys and D-18 | owner | new decision before W23-10 (06) | W23-10 (H2) | H2 | B |
| Q-01-1 | Who signs creation of `{name}.terraagent.near` | spec | — | W23-04, W23-10 (H2) | H2 | B |
| Q-01-19 | Testnet Pilot ID vs mainnet cargo | spec | — | W23-02 (H2) | H2 | B |
| Q-01-17 · Q-06-14 | Relayer alerts, spend cap, rollback while real funds move | owner | fresh DB, manual daily check (06) | W23-07/08 (—), W23-15 (H2) | H2 | B |
| Q-06-18 | Guild / director orders on real Intents with mock AgentWallet | owner | W23-26/28 to H2 for Bet B, or mock NPC books + README (06) | W23-22 (H2) | H2 | B |
| Q-03-19 | Signer of receive-only legs; DAO holding verifier balances | verify | research (03) | W23-22 (H2), W22-07 (H) | H2 | M |
| Q-06-3 | Verifier storage cost, withdraw names, fees | verify | measure in W23-21 (06) | W23-21 (H2) | H2 | M |
| Q-03-14 | NEAR-pair tick, decimals, USDC decimals | owner | — | W13-17 (H+) | H2 | M |
| Q-06-5 | NEAR AI Cloud endpoints and signature format | verify | verify before any adapter (06) | Bet C (none) | before Bet C | M |
| Q-06-12 | ChainRead real or mock | owner | owner picks (06) | W23-05/06 (H2) | H2 | m |
| Q-06-10 | Agent skills install; JS SDK for real adapters | owner | install before W23; pick in W23-01 (06) | W23-01 (H2) | H2 | m |
| Q-06-19 | Live-sector chain budget and Guild coverage | owner | owner budget before D10 (06) | none (season) | D10 | M |
| Q-03-31 | Five disconnected season books; dashboard endpoint | owner | — | none (season) | D10 | M |
| Q-01-11 | Claim scope, residual FC key, director key after claim | owner | NEAR §2 FC key (01) | W21-15, W23-14 (—) | post (copy D12) | M |
| Q-01-12 | "At launch": product or rocket | owner | — | W21-15 (—) | post | m |
| Q-01-15 | Device B guest + existing identity | owner | — | W06-07 (—) | post | m |
| Q-01-20 | D-10 portability without wallet link | owner | — | W06-07 (—) | post | m |
| Q-01-21 | Wallet connector for link, claim, staking | owner | post-hackathon, pick with W23-14 (01) | W23-14 (—) | post | m |
| Q-02-17 | Trade Hub T2 / T3 extra mechanics | spec | throughput only (02) | none | post | m |
| Q-02-20 | Do deposits deplete? | spec | no; state it in SIM §10 (02) | none | post | m |
| Q-02-21 | Carry-over amount; W21-13 base | owner | all cargo (NEAR-54); fix WP §8 (02) | W21-13 (—) | post (WP now) | m |
| Q-03-13 | Orders and verifier balances at planet end / elimination / Settled | spec | — | W11-04/05 (—) | post | m |
| Q-03-20 | Negotiate: direct offers or order book | spec | order book; fix UO-HQ-05 (03) | W13-26 (—) | post | m |
| Q-04-21 | Votes inside the agent allowance | spec | votes via colony key, outside (04) | W22-16 (—) | post (copy now) | m |
| Q-04-24 | 2 vs 3 funded NPCs | wave | 2; fix W23-28 (04) | W23-28 (—) | post | m |
| Q-05-2 | Rocket gate denominator in W21-04 | spec | D-18 wording (05) | W21-04 (—) | post | m |
| Q-05-4 | Mainnet pool list and maintainer | owner | W23-34 runbook (05) | W23-34 (—) | post | m |
| Q-05-5 | Trigger for deed status `abandoned` | spec | — | W20-14 (—) | post | m |
| Q-05-6 | Badge owner account; guest badges | spec | — | W12-25 (—) | post | m |
| Q-05-8 | When is a `BadgeMint` skipped | spec | — | W12-25 (—) | post | m |
| Q-05-15 | Mercenary away spend vs AW-20 | spec | — | W22-31 (—) | post | m |
| Q-05-18 | Rule out other staking in a spec | spec | yes (05) | W20-23 (—) | post | m |
| Q-05-19 | Deed transfer vs staking and operator updates | spec | — | W20-18 (—) | post | m |
| Q-05-20 | Staked position and deed at planet archive | spec | — | W11-05 (—) | post | m |

## 10. NEAR facts still to verify

| Fact | Pack row | Page to check | State |
|---|---|---|---|
| NEP-245 deposit by `mt_batch_transfer_call`; is single `mt_transfer_call` accepted | R06-6, Q-06-1 | [X2] docs.near-intents.org/integration/verifier-contract/deposits-and-withdrawals/deposits.md + a real 1-unit call | docs read 2026-10-31; no call yet |
| Balance id `nep245:<contract>:<token_id>`, `mt_balance_of` on `intents.near` | R06-7 | [X3] …/balances.md | docs read; untested |
| Native NEAR must be wrapped to wNEAR | R06-9, Q-06-2 | [X2] | docs read |
| 1 yoctoNEAR on `mt_batch_transfer_call` / `ft_transfer_call`; simple deposit 100 TGas | R06-65, 06 §5 | [X2] | docs read |
| Withdraw method names; verifier fees | R06-79, Q-06-3 | withdrawals page listed in [X1] llms.txt | not read |
| Signer key registration on `intents.near` (`add_public_key`) | R06-66 | "Account Abstraction" page listed in [X1] | not read |
| FC key: one `receiver_id`, gas-only allowance, no deposit; allowance under NEP-366 | R06-64, R06-65, Q-06-17 | [X6] docs.near.org/protocol/access-keys; NEP-366 spec | fetched once; NEP-366 part not read |
| NEAR Auth providers (no X), mainnet whitelist, testnet setup | R06-22, R06-24 | [X4] docs.auth.near.org, [X5] …/resources/testnet.md | re-verified |
| NEAR Auth account naming, gas sponsor, MPC key derivation | R06-25, R06-26, Q-06-7 | [X4], [X5], github.com/peersyst/fast-auth | inferred, not stated |
| NEAR Auth mainnet approval lead time | Q-06-8 | docs.auth.near.org `home/apply.md` | not read |
| CSP origins `login.*.fast-auth.com` | 06 §9 W23 | [X5] | not checked |
| NEAR AI Cloud base URL, signing in TEE, verifier repos | R06-17 | docs.near.ai/cloud/verification | per session research, not re-fetched |
| `GET /v1/attestation/report`, `GET /v1/signature/{chat_id}` | R06-18, Q-06-5 | docs.near.ai/cloud/verification | [T1] third-party claim |
| NEAR AI Cloud price per token | 06 §5 | NEAR AI Cloud pricing page | not read |
| 1Click 0.2 % without partner JWT; registration | R06-10, R03-40 | partners.near-intents.org, [X1] | not read |
| SputnikDAO: a DAO holding verifier balances, signing receive-only legs, 1 colony = 1 vote policy | Q-03-19, R06-33 | SputnikDAO v2 docs; Trezu | not read |
| `docs.near.org/llms.txt` and `near/agent-skills` | R06-38, Q-06-10 | docs.near.org/llms.txt; github.com/near/agent-skills | not fetched |

## 11. Glossary

| Term | Meaning (pack usage) |
|---|---|
| In orbit | cargo on the colony account plus its free verifier balance (R02-29, R03-35) |
| Stall | a Trade Hub as a market place; earns the fee leg of trades listed there (R03-1, R03-59) |
| Contract | player-facing word for a settled trade (R03-45) |
| Maker / taker | resting order / crossing order; the taker pays the stall fee (R03-22) |
| `opId` | deterministic idempotency key of a chain write, e.g. `cargo-export:{colonyId}:{exportSeq}` (R02-25) |
| Outbox | Postgres table written in the game change's transaction; the relay drains it (R06-46, Q-06-15) |
| Verifier | `intents.near`, holds deposits and executes zero-sum batches (R06-2..R06-5) |
| `token_diff` | signed NEP-413 intent stating what an account gives and gets (R03-8) |
| Receive-only leg | a batch leg with no outflow (stall, DAO, project) (Q-03-19) |
| FC key | NEAR function-call access key: one receiver, gas allowance (R06-64) |
| Allowance | director / agent spending limit; basis and unit open (Q-04-1) |
| Carve-out | treasury leg taken from the stall fee, not added (R03-54) |
| H / H+ / H2 / — | hackathon must / stretch / real NEAR after the gate / post-hackathon (HACKATHON_CUT) |
| `@hack` | demo steps of a wave e2e run by `npm run e2e -- --hack` |
| Unit (effort) | one M issue; S = ½ (HACKATHON_SCHEDULE §1) |
| D10 gate | day-10 check that starts H2 rows (HACKATHON_CUT §3); Pivot moves real NEAR to D6 (OD-03) |
| Bet A / B / C | Pivot: agents as players (API / MCP) · NEAR pairs + float · attested Guild reasoning |
| Season / sector | Pivot: five 5-colony dev planets from Nov 10 (OD-16) |
| Dev-seat flow | W01-05 seat assignment (`pl_dev`, `pl_dev_2` …) without the W11 lobby |
| Model A / B | Balance: 1-second colony model / 30-minute-slot planet model |
| Settled | colony after launch: inert, invulnerable, deed can stake (R05-23) |
| `threatStage` | stage-based raid scaling, raid = `2 + threatStage` Skitters (Balance §6) |
| Pilot ID | the player's named account shown in the HUD (R01-49) |
| Director | in the cut: the sim `autotrade` system + market module, not the W16 AI director (04 header) |
| Mixed mode | some ports real, others mock in one run (R06-68) |
| Mock-in-prod flags | `NEAR_` / `AI_` / `NOTIFY_ALLOW_MOCK_IN_PROD` (R06-12, R06-73) |
| KEK | key-encryption key `NEAR_KEK` for app-held keys (R01-16) |
| D-35 data row | a tunable balance value; "Decided (value proposed)" in the status cell |
| W00-59 overrides | runtime balance overrides file + `tune` (D-35) |
| Q10 | Pivot's open question "NEP-245 into the verifier?"; answered by docs (R06-8) |
| D-37 / D-38 | proposed decision rows: master plan decisions / the pivot (Review C9, Pivot §8) |
| UO- / AW- / CT- / SIM- / MM- / PA- / DM- / NEAR- / AI- ids | rule ids of the units, away (CONTINUITY), continuity, simulation, matchmaking, profile, data-model, NEAR and AI_ORCHESTRATOR specs |
| R0x-n / Q-0x-n / OD-nn / N-nn | pack rule / question / owner decision (§7) / number (§8) |

## 12. Review log

**Pass 1 (six writers, one file each).**

| File | Covered |
|---|---|
| 01 | F5 accounts registry, key custody, claim, relayer, wallet link, error model; director / Guild / agent key rows |
| 02 | Mining → stock → export / import, caps, idempotency, mint exceptions, token ids |
| 03 | F2 books, matching, fees, settlement, failures, limits, NEAR pairs, monetization table |
| 04 | F3 Guild, F4 director and away, communication channels, Agent API / MCP |
| 05 | F6 deed and badges, Settled and own-NEAR staking, F7 treasury, F8 bounties and mercenaries |
| 06 | Intents, NEAR AI Cloud, NEAR Auth, NEPs, ports / adapters / env, network and costs |

**Pass 2 (three reviewers).**

| Reviewer | Main findings |
|---|---|
| R1 (01–03) | NEP-245 deposit still "unverified" in 02 / 03; Guild float and allowance basis over-stated as Decided; claim keys Decided on both sides; treasury-leg status split; W10 demo 300 > 250; no default fee or `setHubFee` owner; outbox name; landed error codes; missing mock tables; wNEAR; wave cards |
| R2 (04–06) | compound statuses; D-10 / D-29 / D-30 rows mislabelled Decided; env / `--port` names vs code; three mock-in-prod flags; mixed real/mock mode; allowance decrement double count; deny table unenforced; W12 badge rows; W22 TTL vs warp; `ai_decision` untagged |
| R3 (coverage) | FC-key semantics; contradictions across files; no demo map; live season absent; Bet A step 1 vs W00-55; MP §4 / §5 rows unmapped; deny list in outward copy; fast-forward page; supply ledger; accounts registry; tracks 10 / 12; 18 uncited issues; duplicate questions; content list for 07 |

Canonical rulings applied in every file: C1 deposit method (owner 06) · C2 treasury leg (owner 03) · C3 director key (owner 04) · C4 FC-key semantics (owner 06) · C5 claim (owner 01) · C6 Guild float (owner 04) · C7 protocol fee (owner 03) · C8 outbox name (owner 06) · C9 env and port names (owner 06) · C10 NEAR Auth facts Gap (owner 06) · C11 NEAR §12 estimates · C12 unreachable chain · C13 W13 note rules Planned · C14 agent deny list (owner 04) · C15 mixed mode (owner 06) · C16 Guild LLM owner (owner 04) · C17 one status per row · C18 abbreviations · C19 wave cards in §7.

### Pass 3 audit edits

The pass-3 auditor read README, the canonical rulings and files 01–06 in full, opened NEAR.md §1–§16, PROTOCOL §7/§8/§10, CONTINUITY AW-13/AW-20/CT-31/CT-36, the units rules UO-R-01/02, UO-TF-06, UO-DIP-02/04, econ §3.5, the DECISIONS index, MP §0 and about 40 wave rows, and checked about 60 Decided rows against them. No id was renumbered, deleted or reused (id sets compared by script before and after). A script found 0 undefined `R0x-n` / `Q-0x-n` references. [X4] (docs.auth.near.org) was re-fetched on 2026-10-31.

| # | File · id | Change | Why |
|---|---|---|---|
| 1–5 | 01 · registry `colonies.*`, R01-20, R01-38, R01-53, R01-55 | "Conflict → Q…" in the status cell → status `Conflict`, pointer moved to the source cell | legend (C17) |
| 6 | 01 · R01-4 | NEAR Auth text aligned to [X4]: gas sponsored through delegate actions, mainnet needs approved credentials, X not listed; "named accounts" and "NEP-366" only in Review C6 | C10: [X4] does not state them |
| 7–9 | 01 · R01-32, §5 relayer alert, §5 away budget | 5 NEAR alert is a spec rule (Decided, R06-58); stuck-outbox and error-rate alerts only in W23-07; away budget 40 / 60 % Decided (AW-20 does not mark it proposed) | C11, source check |
| 10–15 | 01 · R01-39, R01-51, R01-52, §5 float rows, §1, §5 allowance | bare "→ 06 / 04" pointers given ids (Q-06-17, R04-5, R04-50, R04-51, Q-04-1) | C4, C6 |
| 16 | 01 · W06-02 row, Q-01-4, W06 grill | "NEAR Auth has no X" → "does not list X ([X4], R06-22)" | [X4] wording |
| 17 | 01 · Q-01-21 | absorbs Q-06-20 (wallet connector for NEP-413 link, claim, staking); default post-hackathon with W23-14 | duplicate closed |
| 18 | 01 · R01-29 | "checked before submit" sourced to W06-10 (H) | source check |
| 19–20 | 02 · R02-50, W10-10 row | wrong env name `NEAR_ADAPTER_CARGO` also in W10-10 and W23-01 | C9, matches R06-42 |
| 21–23 | 02 · R02-29, §5 mint cap, R02-34 | pointer ids; same source as R02-38; W23-17 also names `mt_transfer_call` | C1, consistency |
| 24–26 | 03 · §5 default fee, §6 stall fee, §5 treasury share | status cells cleaned; only the 2 000 value is Decided (value proposed), the carve-out is Planned (R03-54, W22-07) | C17, C2 |
| 27–33 | 03 · Guild rows, R03-39, R03-62, R03-13, R03-27/35/36/44/50, Q-03-9, §2, §6, §7, W15 and W23 grills | pointer ids; R03-62 → R04-58 (was R04-46); R03-13 → R06-7 (was R03-56) | wrong targets fixed |
| 34 | 03 · W23 grill | "fallback not needed" → "dropping the NEP-141 fallback is Proposed (R06-8)" | C1 |
| 35–40 | 04 · R04-3, §6 Guild balances, Q-04-16, §5 NPC count, R04-40, §2 / channels / Q-04-1 / Q-04-21 / flows / W23 grill | pointer ids (Q-06-17, R06-68, Q-06-18, Q-04-24, R03-29, R03-59, R01-27, R01-16, R05-38, R03-33); Q-04-16 owns the credential part from closed Q-01-18; R04-40 source NEAR-61 | C4, C6, C15, source check |
| 41 | 04 · Q-04-25 | Closed → Q-05-21 (fauna-shield project kind) | duplicate; 05 owns the treasury |
| 42–44 | 05 · §5 treasury share, §2 badge owner, Q-05-21 | C2 wording; status word removed from a source cell; Q-05-21 absorbs Q-04-25 (default: drop, or widen `meteor_shield` to fauna) | C2, C17, duplicate |
| 45–51 | 06 · header, §2 NEAR Auth, R06-22, R06-25, R06-26, Q-06-7, R06-36 | aligned to the re-fetched [X4]: "a Multi-Party Computation network produces every signature from distributed key shares"; "sponsor gas via delegate actions" without naming the sponsor or NEP-366 | C10 |
| 52 | 06 · R06-6 | W23-17 added to the `mt_transfer_call` list | C1 |
| 53 | 06 · R06-43 | spec states only `NEAR_ALLOW_MOCK_IN_PROD` (NEAR §1a r3); AI / NOTIFY flags are code facts (R06-12) | source check |
| 54 | 06 · R06-63 | no longer states the residual post-claim key or the allowance basis as Decided; points to Q-01-11 and Q-04-1 | C3, C5 |
| 55 | 06 · R06-66 | PROTOCOL §7 already names an `add_public_key` intent for the director key | source check |
| 56–58 | 06 · R06-69, §5.1 loss limit, §5.1 external agents | float stated in one line pointing to owner 04 (R04-5, R04-50..52, Q-04-24, Q-03-15); rate limits → Q-04-17, relayer spend → Q-01-17 | C6 |
| 59 | 06 · R06-77, Q-06-20 | Q-06-20 Closed → Q-01-21 | duplicate |
| 60–63 | 06 · §6 keys row, R06-58, R06-35, §5 port count | key table stated as the R01-55 conflict (→ Q-01-7); relayer owner 01 (R01-32); W23-05 details Planned; 13 abstract classes is a code fact (→ R06-39) | C17, consistency |

**Still open after pass 3 (owner decisions; the spec side wins until decided):** Q-01-1, Q-01-7, Q-01-11, Q-01-16; Q-02-3 / Q-05-11, Q-02-18, Q-02-19, Q-02-21, Q-02-22; Q-03-1, Q-03-15; Q-04-1, Q-04-20, Q-04-24; Q-05-2, Q-05-23; Q-06-1, Q-06-4, Q-06-6, Q-06-7, Q-06-11, Q-06-12, Q-06-15, Q-06-17, Q-06-18.

**Hygiene notes:** Q-01-17 and Q-06-14 overlap on relayer alerts and rollback during the season (both kept; Q-01-17 cites Q-06-14). The relayer alert row is owned by 01 (R01-32); R06-58 carries the spec threshold. Of the external pages only [X4] was re-fetched in pass 3; [X1] and [X6] (access keys, behind R06-64/65) were fetched once in pass 2.

### Final reconciliation (orchestrator, after pass 3)

| Change | Why |
|---|---|
| Q-05-11 Closed → Q-02-3; Q-02-3 absorbs the DAO burn path and the W22-09 "burn or only debit" question | duplicate pair left open in both owner files |
| Q-06-14 Closed → Q-01-17; Q-01-17 absorbs rollback (W23-42) while real funds move | duplicate pair |
| Q-06-7 Closed → Q-01-2; Q-01-2 absorbs the MPC-signer vs app-created sub-accounts and D-18 claim question | duplicate pair; 01 owns custody |
| Q-06-16 marked Closed → Q-04-8 | pointer row looked open to a grep |
| R04-4 now says it implements R02-31 (Guild seed mint) | same fact in two files with different statuses: R02-31 is the rule (Decided, NEAR-73), R04-4 the provisioning job (Planned, W15-05) |
| 06 W23 card: "@hack demo steps 1–3" → "no `@hack` tag; the H2 rows cover demo steps 1–3" | W23 has no `@hack` tag |
| `docs/hackathon/README.md` lists the `near/` pack | entry point |

Checks run after the final edits: every relative link in the pack resolves; every table row has its header's column count; every `R0x-n` and `Q-0x-n` cited in 01–08 is defined; every rule-row status cell is one of the six legal values.

## Appendix A — canonical rulings C1–C19 (pass 2)

The orchestrator issued these after the three pass-2 reviews so that every fact has one owning file and one status. The pass-3 audit checked every file against them. They record how each conflict is **stated** in the pack, not how it is resolved: resolutions are the owner decisions in §7.


- **C1** NEP-245 deposit into intents.near — OWNER 06. Docs say NEP-245 deposits go through `mt_batch_transfer_call` with receiver `intents.near`; id `nep245:<contract>:<token_id>` (ours `nep245:res.terraagent.near:<ResourceKey>`), verified on docs.near-intents.org [X2][X3] 2026-10-31, not yet tested with a call. NEAR-55 / W23-21 / W23-38 say `mt_transfer_call` → status Conflict → Q-06-1 (W23-17 `res` contract must implement `mt_batch_transfer_call`). Ten-NEP-141 fallback not needed: Proposed (06 R06-8). W23-18/W23-21 "4 tokens" vs 10 ids → Conflict → Q-06-4. Old Q-02-9 closes → Q-06-1.
- **C2** Treasury leg — OWNER 03 (Q-03-1). "A share of every market fee goes to the planet DAO": Decided (NEAR-101). "2 000 bp of the stall fee, carved out of the hub owner's fee (300 @ 1 % → 2.4 owner / 0.6 DAO)": Planned W22-07 (H); value `TREASURY_FEE_SHARE_BP` 2 000 is Decided (value proposed) via NEAR §12. MP §7 additive example: Proposed. Balance §7.2 Model B also models carve-out. Rounding: floor to whole units (W13-31) makes 0.6 impossible → Q-03-2. 05 Q-05-10 closes → Q-03-1.
- **C3** Director key — OWNER 04 (Q-04-1). Key exists, `POST /v1/near/director-key` adds, revoke deletes, HUD spent vs allowance: Decided (NEAR §2, NEAR-80). Allowance BASIS (away trading budget per NEAR-80/NEAR §2/W15 Goal/AI_ORCHESTRATOR §15 #8/landing+whitepaper copy vs autoTrade per-session caps W15-18; AW-20 says separate) and UNIT (per token W15-03/W15-04 vs NEAR W23-26 "0.1 NEAR"; DATA_MODEL `chain.director_key.allowance numeric` single value) → Conflict → Q-04-1 (Q-01-6 and Q-04-18 close → Q-04-1). The F4 "director" in the cut is the sim autotrade system (W15-21), not the W16 AI director.
- **C4** Function-call key semantics — OWNER 06 (new rows + question). NEAR access keys (to verify on docs.near.org): a FunctionCall permission has ONE receiver_id (no wildcard), its allowance is GAS (and under NEP-366 the relayer pays gas), and it cannot attach a deposit, while `mt_batch_transfer_call` / `ft_transfer_call` need 1 yoctoNEAR. Consequences: "FC key scoped to intents.near + res.*" needs two keys or a different design; token allowances, director limits and agent limits are enforced by the server, not the key; after claim the app's FC key cannot deposit cargo into the verifier; signer keys may need registering on `intents.near` (`add_public_key`, to verify). Whitepaper §3 "enforced by the key, not by a prompt" depends on this. Files 01 and 04 state their key rules as design and point to the 06 question.
- **C5** Claim — OWNER 01 (Q-01-11). Full-access key passes to the player: Decided (NEAR §2, D-18). Residual app FC key: NEAR §2 / W23-14 keep it; D-18 wording / W21-15 "drop game key" remove it → Conflict → Q-01-11. 05 states "app keys until claim; after claim the player's full-access key, plus (per NEAR §2) an app FC key — Q-01-11".
- **C6** Guild NEAR float — OWNER 04. "Seeded from the owner treasury, capped": Decided (NEAR-73). "5 NEAR" cap: Planned W15-02 (H), scope (per NPC or total) unstated. "5 per NPC, 10 total": Proposed (Pivot Bet B). W23-28 funds 3 NPCs vs W15-02's 2 → Conflict → new Q in 04. MP §0 locks the "safest" float (no NEAR pairs in demo, float unused for trading) vs Pivot Bet B → Q-03-15 (owner 03).
- **C7** Protocol fee — OWNER 03 (Q-03-7). 0.25 %: Proposed (MP §7); no issue (Review C4 proposes one S issue in W13); payer default "taker, from the received token": Proposed (Balance §10 Q6); recipient account: Gap.
- **C8** Outbox table name — OWNER 06 (Q-06-15). code `chain.chain_outbox` (shared/db/prisma/chain-outbox.prisma, W00-37) vs NEAR §1a `chain_outbox` vs NEAR §13 `chain.near_tx` vs DATA_MODEL §4.4 `chain.near_job` (§4.2 note `chain.near_tx`) → Conflict → Q-06-15. Q-02-11 closes → Q-06-15.
- **C9** Adapter env and port names — OWNER 06 (Q-06-11). Code key `NEAR_ADAPTER_<UPPER_SNAKE(port)>`: `NEAR_ADAPTER_CARGO_TOKEN`, `_DEED_NFT`, `_TREASURY_DAO`, `_AGENT_WALLET`; `contract-real.mjs` takes PascalCase `--port`, no `--dry`; `test:contract` filters on `CONTRACT_PORT` env. Waves use other names (list in 06). Fail-closed → typo selects mock silently.
- **C10** NEAR Auth facts — OWNER 06. Not in any spec → status Gap, tagged [X4]/[X5] verified 2026-10-31, plus Review C6. MP §0 "NEAR Auth locked" is Proposed. Key derivation via MPC: inferred, not stated. 01 R01-4 uses the same status and points to 06.
- **C11** NEAR §12 cost estimates — status "Decided (value proposed)" with "estimate; W23-16 measures" in the source cell, in every file.
- **C12** Unreachable chain — NEAR §1 p4 + PROTOCOL §10 agree: cargo/market commands rejected `market_unavailable` when NEAR or the verifier is unreachable; accepted exports settle async (Decided). Open: how "unreachable" is detected before accept, and W10-01 lacks the code (Q-02-6). Landed code also has `NEAR_UNAVAILABLE` (503) in backend/app/src/near/domain/errors.ts.
- **C13** W13 header-note rules (partial fills, taker pays, no self-trade, over-cap refund) implemented by H issues → Planned, source `W13-11 / W13-12 (H) · spec gap (W13 note)`; W13-02 writes them into NEAR.md.
- **C14** Deny list for agents/director — OWNER 04. Proposed: WP §3 ("spend beyond allowance, move player's NEAR, claim, stake"), media-plan diagram 3, landing `director` section. Media plan puts "votes" inside the allowance but the key scope excludes DAO receivers → Conflict in 04.
- **C15** Mixed real/mock — OWNER 06 (rule + Q), 04 points. With Intents real (W23-22, H2) and AgentWallet mock (W23-26, untagged): Guild accounts `guild-N.npc.terraagent.mock` and mock director keys cannot sign `token_diff` on `intents.near`, so Guild and director orders cannot settle on real books; Bet B needs W23-26/28 real.
- **C16** Guild LLM strategy owner — OWNER 04 (Q-04-8). One place for: provider (D-09 Z.ai vs NEAR AI Cloud, Review C1), home (W16-21 hook untagged vs a new W15 row), and the minimal budget gate + decision row (W16-07/08/15 untagged). 06 Q-06-5 / Q-06-16 point to Q-04-8.
- **C17** Statuses: exactly one of Decided / Planned / Proposed / Conflict / Gap; only "Decided (value proposed)" may carry a qualifier. Rows resting only on still-Proposed decisions D-10, D-15, D-28, D-29, D-30 are Planned with the issue. Code facts: `code: <path>`.
- **C18** Abbreviations per README: MP, Review (not MPR), Pivot, Balance, Playbook, WP, units, econ, NEF, profile. Do not cite `economy-and-onchain-summary.md` as a source for a status; cite the spec/issue behind it.
- **C19** Wave card: add 3 lines at the top of §7 per main wave: deps · @hack steps · DoD gates.
