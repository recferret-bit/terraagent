# 08 — Wave grill checklist (on-chain and NEAR)

> **Status:** 2026-10-31, grooming reference (legend: [`README.md`](./README.md)). One agenda per wave, in grooming order. Ids: rules and questions in [01](./01-accounts-keys-relayer.md)–[06](./06-near-tools-and-adapters.md); owner decisions `OD-nn`, numbers `N-nn` and the deduplicated question table in [`07`](./07-gaps-and-grooming.md) §7, §8, §9. **H set** = issues · units tagged `H` (HACKATHON_CUT §2); **finish** = wave e2e finish unit with 10 agents (HACKATHON_SCHEDULE §4; u ≈ 2.6 × day). Deps from the wave header. Uncited issues from the pass-2 coverage review are marked ★.

## W00 — Platform skeleton (landed, `d2970e8`)

- **H set · deps:** 51 · 41.0 · finish u10.0 · deps none.
- **@hack:** steps 1–3, 5–10 (step 7 `chain.ping` → `mock:` receipt in `/dev/chain`; step 9 `?host=local`).
- **Pre-reads:** R06-39..R06-48, R06-12, R06-62, R06-76, R02-25, R01-31; 06 §7 W00 card.
- **Owner decisions:** OD-17 (allow flags), OD-19 (Bet A step 1).
- **Numbers:** — (W00-59 is the vehicle for every OD-20 number).

| Issue | Ask | Pack id |
|---|---|---|
| W00-30 ports | NEAR §1a lists `stake`, `unstake`, `rewards`; W20-01 adds `listPools`, `withdraw`, `position`. Who updates NEAR §1a (OWNER_TASKS N3)? | R05-33, Q-06-15 |
| W00-31 adapter selection | Waves write `NEAR_ADAPTER_CARGO`, `_DEED`, `_TREASURY`; code reads `_CARGO_TOKEN`, `_DEED_NFT`, `_TREASURY_DAO`. A typo silently selects mock: rename the waves or alias in code? | R06-41, R06-42, Q-06-11 |
| W00-31 / W25-06 | Prod needs three allow flags; `AI_PROVIDER=zai` aborts boot with no Z.ai adapter in the cut | R06-71, R06-73, Q-06-6 |
| ★ W00-33 mock ChainRead | ChainRead stays mock per the cut, yet W23-05/06 are H2: which? | R06-51, Q-06-12 |
| W00-35 NEP-171 base | Deed and Badge share one contract (`deed` / `badge` collections): does the base already model soulbound badges? | R06-29, R05-17 |
| W00-37 outbox | Code `chain.chain_outbox` vs three spec names: fix NEAR §13 and DATA_MODEL | R06-62, Q-06-15 |
| W00-38 harness | `test:contract` filters on `CONTRACT_PORT`; waves pass `--port`. `contract-real.mjs` has no `--dry`, no comma lists | R06-42, Q-06-11 |
| ★ W00-55 local host | Accounts, NEAR, LLM report `host_unavailable`; an `npx` MCP cannot reach the browser worker. Bet A step 1 as written cannot run | R04-56, R06-76, Q-04-22 |
| W00-59 overrides | Which Balance §8 rows go into `balance.overrides.json` on D7, and who signs them off? | OD-20, N-01..N-23 |

**Proposed rows:** `contract-real.mjs` `--dry` + comma lists (W23-01 subtask, Q-06-11); a key alias table if waves keep their names.

## W06 — Invisible chain (F5, mock)

- **H set · deps:** 20 · 12.5 · finish u13.5 · deps W00, W01 (W01-02 guest login, W01-31 `colonyFounded`).
- **@hack:** steps 1, 2, 4, 6, 7. DoD also needs W06-21 copy lint, which is not H.
- **Pre-reads:** R01-1..R01-35, R01-43..R01-56; R06-20..R06-26; Q-01-1, Q-01-2 · Q-06-7 (closed → Q-01-2), Q-01-5, Q-01-7, Q-01-16.
- **Owner decisions:** OD-01, OD-03.
- **Numbers:** — (name length, 01 §5 / Q-01-8).

| Issue | Ask | Pack id |
|---|---|---|
| W06-02 mock OAuth | Keep "X (mock)" when NEAR Auth has no X? Mock Apple / email instead? | R01-4, Q-01-4 |
| W06-04 / 05 names | Reserved list lacks `res`, `deed`, `bounty`, `colonies`, `npc`, `dev-a/b`; `-1` vs `-2`; which display name feeds it? | R01-8, R01-9, Q-01-9, Q-01-10 |
| W06-06 / 09 key store | `core.social_identity` and `chain.near_colony_account` are not in the merged schema; where does the player key live? | R01-55, Q-01-7 |
| W06-08 colony account | What string is `{colony}`; 32-char name on `.testnet`; "guest with 2 colonies" vs DM-10 | Q-01-8, Q-01-14 |
| W06-10 relayer | Account-key actions (`add_key`, `create_account`) are not on the allow-list: who relays them? | R01-29, Q-01-5 |
| W06-12 `storage_deposit` | Can a guest colony reach the Trade Hub before login? | Q-01-13 |
| W06-17 claim stub | `409 not_available_yet` is not in PROTOCOL §8 | Q-01-16 |
| W06-18 NEP-413 | Implement PROTOCOL `/auth/near/challenge` + `/verify` | R01-54, R01-24 |
| W06-19 errors | `NEAR_NAME_TAKEN` vs landed `NEAR_ACCOUNT_EXISTS`; map `NEAR_UNAVAILABLE`, `NEAR_MOCK_INJECTED_FAILURE` | R01-53, Q-01-16 |
| W06-21 copy lint | Tag H or drop from the DoD | R01-43 |
| W06-22 suites | Identity suite assumes app-held keys NEAR Auth may not give; `--port` vs `CONTRACT_PORT` | Q-06-7 (closed → Q-01-2), Q-06-11 |
| W06-07 (—) | Portability without wallet link (D-10 still Proposed) | Q-01-20 |

**Proposed rows:** one migration issue for `core.social_identity` + the key table (Q-01-7); W06-21 → H.

## W09 — Offline and notifications

- **H set · deps:** 14 · 12.0 · finish u25.0 · deps W02; W15 needs W09-13.
- **@hack:** steps 3, 4, 5, 6, 8.
- **Pre-reads:** R04-25, R04-30..R04-35, R04-60; Q-04-1, Q-04-12, Q-04-19.
- **Owner decisions:** OD-09, OD-21.
- **Numbers:** N-21, N-22.

| Issue | Ask | Pack id |
|---|---|---|
| W09-13 `withinAutoTrade` (H) | Issue order is fine (W09-13 u21, W15-19 u22), but W15 opens only after W09 lands in `main` (W09 e2e u25) while W15-01 is scheduled at u17: pre-step or reorder? | Q-04-19, OD-21 |
| W09-09 (H) vs W09-10 / 11 / 12 / 14 (—) | Deny table, budget accounting, rejection log, panel all untagged though D-17 makes them MVP. Say so in the README? | R04-30, R04-32, Q-04-12 |
| W09-11 (—) | NEAR-80 makes the director allowance "the away budget", which nothing enforces in H | R04-24, Q-04-1 |
| W09-01 contracts | `setAutopilot {mode, awayRaids, awayBudget}` vs PROTOCOL `{aiDirector, awayRaids}` + `setAwayBudget` | Q-04-12 |
| W09-20 / 21 notifier | `trade_offer` kind has no producer in H; `away_budget_exhausted` comes from W15-22 | R04-35, Q-04-10 |

**Proposed rows:** README line "away budget and deny table are not enforced in the hackathon build" (Q-04-12 default).

## W10 — Cargo and Trade Hub (F1, mock)

- **H set · deps:** 21 · 14.0 · finish u15.5 · deps W02, W06, W00 outbox + harness. W10-16 starts in u1.
- **@hack:** steps 1–9 (no shuttle VFX).
- **Pre-reads:** 02 R02-1..R02-53 and §6 supply ledger; R01-50; Q-02-1..Q-02-22 (open ones in 07 §9).
- **Owner decisions:** OD-14 (burn), OD-20 (mint cap, kit), OD-12 (deposit method shapes the mock).
- **Numbers:** N-01, N-02, N-05.

| Issue | Ask | Pack id |
|---|---|---|
| W10-01 contracts | Add `market_unavailable` (or map landed `NEAR_UNAVAILABLE`); W10-01 names not in SIM-C-02 | R02-49, Q-02-6, Q-02-7 |
| W10-04 / 06 throughput | One hub, sum, or per hub? Do imports and fills count? | R02-22, Q-02-5 |
| W10-05 + demo step 3 | Exporting 300 at a T1 hub (250/min) fails W10-06: export 200 + 100? | R02-52, Q-02-18 |
| W10-06 caps | UTC-day counter in a sim with no wall clock; 20 000 or 10 000; clamp or reject | R02-23, Q-02-4, Q-02-8, N-01 |
| W10-08 outbox | Snapshot rollback restores stock while the outbox mints; `exportSeq` can repeat | Q-02-1 |
| W10-10 mock adapter | `mock_chain_mt_*` vs landed `mock_chain_balance` / `mock_chain_receipt`; env `NEAR_ADAPTER_CARGO` | R02-51, Q-02-22, R02-50 |
| W10-11 suite | 10 ids and `opId` idempotency as the real `res` enforces; deposit by `mt_batch_transfer_call`? | R06-27, Q-06-1 |
| W10-12 / 13 import | Burn by `minter` (NEAR-50, NEF F1) or colony key (NEAR-52)? Pending import when the hub is shed? | R02-53, Q-02-3 · Q-05-11 (closed → Q-02-3), Q-02-10 |
| W10-26 dev console | `cargo.grant` against a real adapter must refuse | R02-32, Q-02-2 |
| W10-03 unlock | Default of `TRADE_HUB_AT_S2` | Q-02-12 |
| W10-29 (—) docs | `ENVS.md` does not exist; which env name goes in | Q-06-11 |
| any amount | Integer units only? | Q-02-14 |

**Proposed rows:** `exportSeq` / `importSeq` stored outside the sim (Q-02-1); prod guard on `cargo.grant` (Q-02-2).

## W11 — Lobby and planets (dropped by the Pivot; drop #2 in the cut)

- **H set · deps:** 12 · 11.5 · finish u31.5 · deps W01. Pivot §3 drops W11; the W01-05 dev-seat flow carries the sector.
- **@hack:** steps 1, 2, 7, 8.
- **Pre-reads:** R05-71, R05-73, R03-61; Q-03-13, Q-05-1, Q-05-20.
- **Owner decisions:** OD-16 (season).
- **Numbers:** —.

| Issue | Ask | Pack id |
|---|---|---|
| ★ W11-04 (—) lifecycle sweeper | 14 d end, extinct / all-settled end: what happens to resting orders and verifier balances? | Q-03-13 |
| ★ W11-05 (—) `ARCHIVED` | Only producer of `planet_result` rank and the deed metadata hook; with W11 dropped, who emits `rank`? Staked position at archive? | R05-73, Q-05-1, Q-05-20 |
| W11-03 creation hook | Planet DAOs are created on planet creation; without W11 only W22-05's lazy path runs | R05-36, R05-71, Q-05-16 |
| W11-08 stats | W24-28 binds the landing band to it; dropped with W11? | 08 W24 |

**Proposed rows:** if W11 is dropped, remove `rank` from `DeedMetadataV1` in H or name another producer (Q-05-1).

## W12 — Player page and achievements

- **H set · deps:** 18 · 14.5 · finish u25.0 · deps W01. W12-01 starts in u3. Pivot trims W12 (no flip-card art, titles, XP levels).
- **@hack:** steps 1, 2, 3, 6, 7, 9, 10 (step 8 "Recorded (mock)" is not `@hack`).
- **Pre-reads:** R03-43, R05-14..R05-19, R05-65; Q-05-6, Q-05-7, Q-05-23, Q-03-17, Q-03-22.
- **Owner decisions:** OD-11.
- **Numbers:** — (achievement thresholds are W12-01 data, not chain).

| Issue | Ask | Pack id |
|---|---|---|
| W12-01 catalogue | MP §8 (Terraformer, Den Hunter 1/3/5, Councilor) or profile §3 frozen ids; Review §6 says they match (wrong) | R05-18, Q-05-7 |
| W12-32 (H) vs W12-25 / 26 (—) | e2e asserts PA-05 mock mint while the minting rows are untagged; card string "Recorded (mock)" vs W20-10 | R05-65, Q-05-23 |
| ★ W12-10 (H+) history writer | "big trade" row: which threshold, and does a settled-on-chain trade or a mock one count? | R03-43 |
| ★ W12-17 (H+) Planets cards | "Deed link if W20 on": which label, mock or real? | R05-12, Q-05-23 |
| W13-27 producers | Wash trades count toward Merchant / Port Authority; Port Authority sums water and NEAR | Q-03-17, Q-03-22 |
| W12-25 (—) | Badge owner: named account or colony; guest badges | Q-05-6 |

## W13 — Markets (F2, mock)

- **H set · deps:** 25 · 18.5 · finish u18.0 · deps W10 (via W06); hooks W08 (Negotiate), W04 (map layer). W13-02 starts in u1: every rule it writes is a Nov 1 decision.
- **@hack:** steps 1, 3–9 (step 2 uses the default fee, which no issue sets).
- **Pre-reads:** 03 R03-1..R03-63; R02-29; R06-1..R06-9; Q-03-1, Q-03-2, Q-03-5, Q-03-7, Q-03-26, Q-06-1.
- **Owner decisions:** OD-04, OD-05, OD-06, OD-07, OD-12, OD-02.
- **Numbers:** N-06, N-07, N-08, N-10, N-11, N-12.

| Issue | Ask | Pack id |
|---|---|---|
| W13-02 note | Which reading of carve-out, unit precision, release-on-fail, pair identity goes into NEAR.md? | Q-03-1, Q-03-2, Q-03-3, Q-03-5 |
| W13-03 config | No default `fee_bp`; no off-tick reject code | Q-03-26, Q-03-11, N-07 |
| W13-04 mock verifier | Deposit semantics `mt_transfer_call` → `mt_batch_transfer_call`; NEAR leg `native:near` vs `nep141:wrap.near`; acceptance id `water` → `bio.water`; mock table name | R03-13, Q-06-1, Q-03-27, Q-03-28 |
| W13-07 signing | What is stored in `signed_intent` when the fill diff is signed at match time? | Q-03-9 |
| W13-08 book | DATA_MODEL `market_order` states / columns differ; `intent_trade` has no amount or price | Q-03-10 |
| W13-09 place | Taker or Guild acceptor needs a Trade Hub? Owner of the `setHubFee` handler and fee storage | Q-03-21, Q-03-26 |
| W13-11 matcher | Self-trade "rest" crosses the book; mid-sweep failure; orders when a hub is shed; verifier down | Q-03-4, Q-03-18, Q-03-12, Q-03-25 |
| W13-12 fee legs | Take a protocol leg now (one S issue)? Guild fills: who gets the stall fee? | Q-03-7, Q-03-6, OD-04 |
| W13-14 failure | Released reservations + orders back on book → re-match loop | Q-03-3 |
| W13-17 (H+) NEAR / USDC | Only if OD-02; tick and decimals | Q-03-15, Q-03-14 |
| W13-21 form | "fee paid by buyer" → "taker"; no stall field | Q-03-8, Q-03-29 |
| W13-22 (H+) slider | Promote to H (MP Must #3, Review C3) | Q-03-16, OD-06 |
| ★ W13-25 (—) `/stalls` and ★ W04-18 (—) map Market layer | No stall discovery in H: makers list at their own stall only (W04 has no section here) | R03-60, Q-03-29 |
| W13-26 (—) Negotiate | Order book or direct offers; goal budget is sim stock, orders need in-orbit cargo | Q-03-20 |
| W13-35 e2e | Step 6 needs a fresh ask of 200; step 4 asserts 1 % with no default | Q-03-28, Q-03-26 |

**Proposed rows:** protocol-fee leg + toast line + README row (S, Review C4, OD-04); `defaultFeeBp = 100` in W13-03; `setHubFee` server handler + fee storage (W13-09 or W13-12); `wNEAR` id in the mock (only with OD-02); Bet A `placeOrder` / `receipts` over the command stream (Pivot §8, OD-19).

## W15 — Guild and agents (F3, F4, mock)

- **H set · deps:** 20 · 15.0 · finish u26.0 · deps W13, W09 (W09-13); through W13 also W10, W06.
- **@hack:** steps 1, 2 (toast + tab, no ship VFX), 3, 5–8, 9 (quotes vanish, no carry), 10. Step 4 (price reaction, W15-07 H+) is not `@hack`.
- **Pre-reads:** 04 R04-1..R04-60; R03-47, R03-48, R03-50; R01-36..R01-39, R01-51, R01-52; R06-63..R06-69.
- **Owner decisions:** OD-09, OD-08, OD-02, OD-06, OD-19, OD-21, OD-20.
- **Numbers:** N-13..N-21.

| Issue | Ask | Pack id |
|---|---|---|
| W15-02 data | Float "5 NEAR": per NPC or total; `target`, `k`, clamp have no numbers; plan vs Balance §8 schedule and caps | R04-50, Q-04-3, N-13..N-18 |
| W15-03 / 18 key | Allowance basis (away budget vs autoTrade caps), unit (per token vs NEAR), single `allowance numeric` | R04-24, Q-04-1, OD-09 |
| W15-03 / 21 decrement | On sign (W15-03) and on settle (W15-21) → double count | R04-60, Q-04-20 |
| W15-04 suite | Per-token allowance cases cannot run on a real FC key (gas-only, one receiver) | R06-64, R06-65, Q-06-17 |
| W15-05 seed | Seed amounts and any cap; the seed is a mint without stock | R02-31, Q-02-13 |
| W15-06 pricing | `refPrice` from a VWAP that wash trades move | R04-9, Q-03-17 |
| W15-08 maker loop | Guild owns no stall: who earns the fee on its quotes? | Q-03-6 |
| W15-11 accept | Does accepting a Guild offer need an online Trade Hub? | Q-03-21 |
| W15-12 (H+) guard | Float and inventory caps unenforced in H; promote with OD-02 | R04-14, Q-04-7 |
| W15-13 / W16-21 (—) | Guild LLM: provider, home row, budget gate, cadence | Q-04-8, OD-08 |
| W15-18 revoke | `DELETE` (W15-18) vs `POST … revoke` (PROTOCOL) | Q-04-12 |
| W15-19 limits | `truce partners` needs W18 (not in the cut) | Q-04-2 |
| W15-21 signer | "AI director" (NEAR §2, NEAR-81) vs sim + market module | R04-54 |
| W15-24 (—) digest | Step 7 is `@hack`, the row is untagged | Q-04-11 |
| W15-32 (—) README | "How the Guild prices" is the track-09 readable file; untagged | Q-04-5 |
| W15-09 schedule | 2 NPCs for 5 season planets; offset schedule | Q-04-23 |

**Proposed rows (none exist yet):** `reason` field on every offer in W15-01 (Q-04-5); pricing page / economy fast-forward `/dev/market/fastforward?days=7` (M, H; Balance §9.3, R04-57); Guild off-planet sink and T2 restock (2 × S, H; Q-04-4); counteroffer after W15-07 (Q-04-6); Guild LLM row H+ with a minimal budget gate + decision row (Q-04-8); agent deny list as a server check (Q-04-16, R04-47); Bet A API module + MCP package + `RULES.md` + two scripted agents (Pivot Bet A, ≈ 9 units); Bet B float guard = W15-12 → H (Q-04-7); migration for `mock_chain_access_key` (R01-55).

## W16 — AI director (not in the cut)

- **H set · deps:** 0 (all 26 rows —) · deps W08; optional W09, W15 (W15-13 slot).
- **@hack:** none.
- **Pre-reads:** R04-20..R04-22, R04-41..R04-43; R06-11..R06-19, R06-71, R06-72; Q-04-8, Q-04-14, Q-04-15, Q-06-5, Q-06-6.
- **Owner decisions:** OD-08, OD-10, OD-17.
- **Numbers:** N-20.

| Issue | Ask | Pack id |
|---|---|---|
| W16-21 Guild strategy hook | The only LLM path the Review keeps: move it to a W15 row, or keep W16 out entirely? | Q-04-8 |
| W16-03 Z.ai adapter | Untagged, yet `validate-env` requires `AI_PROVIDER=zai` in prod | R06-71, Q-06-6 |
| W16-04 | `AI_LIVE_REQUIRED` vs the code's mock fallback | R06-72, Q-06-6 |
| W16-07 / 08 / 15 | Budget gate and `ai_decision` row untagged: an H+ Guild call has neither | Q-04-8 |
| W16-01 `DirectiveV1` | MP §4.2 wild directives match no action | R04-42, Q-04-14 |

**Proposed rows:** NEAR AI Cloud adapter + signature check + attestation chip (Bet C, ≈ 4 units, R06-16) only if OD-08 keeps Bet C.

## W18 — PvP and diplomacy (not in the cut)

- **H set · deps:** 0 (all 28 rows —) · deps W07, W11, W09.
- **@hack:** none.
- **Pre-reads:** R04-37, R04-38; R05-3 (`truces` deed field); Q-04-2, Q-04-10.
- **Owner decisions:** OD-10 (Scenario C beats).
- **Numbers:** —.

| Issue | Ask | Pack id |
|---|---|---|
| W18-01, W18-11..W18-15 truces | MP §6 Scenario C "temporary truce proposal" depends on these: drop the beat | demo-beat map C2 |
| W18-16 / 17 / 20 | `truce_offered` notification kind fires in no H path | R04-35, Q-04-10 |
| W15-19 partner list | `truce partners` must be hidden while W18 is off | Q-04-2 |
| W20-06 deed fields | `truces` stays absent from deed metadata in H | R05-3 |

## W20 — Colony Deed (F6, mock)

- **H set · deps:** 10 · 8.5 · finish u29.5 · deps W06, W01, W00; fields from W05, W08, W13, W14, W18, W21 when on.
- **@hack:** steps 1, 2, 7. Staking steps 4–6 are —.
- **Pre-reads:** R05-1..R05-13, R05-25..R05-34, R05-66..R05-68, R05-72, R05-73; R06-29, R06-34.
- **Owner decisions:** OD-22 (track 10), OD-11.
- **Numbers:** — (step sizes are Q-05-1).

| Issue | Ask | Pack id |
|---|---|---|
| W20-01 ports | `StakingPort` methods beyond NEAR §1a | R05-33 |
| W20-03 / 04 / 13 | Env `NEAR_ADAPTER_DEED` vs code `_DEED_NFT`; `--port` usage; W20-03 acceptance passes on mock regardless | R06-42, Q-06-11 |
| W20-06 projector | `rank` producer (W11 dropped); wall / volume step sizes; "dens destroyed" field | R05-13, R05-73, R05-5, Q-05-1 |
| W20-10 card | "Recorded on NEAR (mock)" vs W12-26 "Recorded (mock)" | Q-05-23 |
| W20-11 (H+) gold frame | Needed in H when settlement is post-hackathon? | R05-25 |
| W20-14 / 15 (—) | `abandoned` trigger; W21-27 asserts W20-15 though both are untagged | Q-05-5, R05-7 |
| W20-18..W20-23 (—) staking | Deed transfer vs staking; rule out other staking | Q-05-19, Q-05-18 |
| track 10 | Does a mock deed on the live planet "qualify"? | R05-72, Q-05-22 |

**Proposed rows:** `dens` field in `DeedMetadataV1`, or drop it from MP §8 (R05-5).

## W21 — Rocket and settlement (not in the cut)

- **H set · deps:** 0 (all 26 rows —) · deps W05, W11, W17, W20, W06.
- **@hack:** none.
- **Pre-reads:** R05-20..R05-23, R05-62, R05-74; R01-19..R01-22; R02-48.
- **Owner decisions:** OD-15.
- **Numbers:** N-28, N-02 (Founder Pod base).

| Issue | Ask | Pack id |
|---|---|---|
| W21-04 gate | D-18 set (footprints excluded) vs demo `312 / 325` | R05-62, Q-05-2, N-28 |
| ★ W21-13 Founder Pod | 750/437/250/250 = 1.25 × the W01-09 kit, not SIM §7.3; stock or cargo? | R02-48, Q-02-21, Q-02-19 |
| W21-15 claim | "drop game key" vs NEAR §2 FC key kept | R01-20, Q-01-11 |
| ★ W21-23 analytics | `account_claimed` event is mock-only in any hackathon run | R01-22 |
| W21-27 | Asserts the Settled Deed of W20-15 (different wave, untagged): how? | R05-7 |

## W22 — Treasury and bounties (F7, F8, mock)

- **H set · deps:** 19 · 15.5 · finish u32.5 · deps W13, W10, W07, W06, W11 (optional W18). Pivot drops W11; drop #4 in the cut.
- **@hack:** steps 1, 2, 3 (terraform boost instead of meteor shield), 4, 5, 8.
- **Pre-reads:** R05-35..R05-64, R05-69..R05-71; R03-24, R03-25, R03-54; R02-53.
- **Owner decisions:** OD-05, OD-14, OD-16, OD-20, OD-22.
- **Numbers:** N-08, N-09, N-23, N-24, N-25.

| Issue | Ask | Pack id |
|---|---|---|
| W22-03 DAO | Pass rule (> 50 % vs "≥ 2 yes, no no"); env `NEAR_ADAPTER_TREASURY` vs `_TREASURY_DAO` | R05-38, R05-39, Q-05-9, Q-06-11 |
| W22-05 lazy create | Only creation path without W11; covered by the `@hack` e2e? Five DAOs in the season | R05-36, R05-71, Q-05-16 |
| W22-07 fee share | Carve-out 2.4 / 0.6 vs floor rounding to whole units | R03-54, Q-03-1, Q-03-2 |
| W22-09 finalize | Does it burn or only debit? Who signs a burn on `res`? 6 h real-time TTL under `warp` | R05-46, Q-02-3 · Q-05-11 (closed → Q-02-3), Q-05-13 |
| W22-13 data | Treasury token and "cargo-equivalent"; costs 1 000 vs Balance 300 | Q-05-12, Q-05-14, N-23 |
| W22-16 (—) | Director never votes vs Pivot agents voting as colonies | R05-42, Q-04-21 |
| W22-19 / 20 bounties | Cargo-only rewards; W22-20's refund depends on H+ W22-24 | R05-51, R05-52, Q-05-17 |
| W22-35 (—) `treasury.fund` | Demo step 2 needs a seeded balance; the console command is not H | Review §4.4 |
| W22-10 (—) shield | "Fauna shield" kind absent | R05-70, Q-05-21 |
| track 12 | Mock DAO on the live planet "qualifies"? | R05-72, Q-05-22 |

**Proposed rows:** treasury leg on Guild fills 0.2 % (Balance §8, Review change 8; Q-05-14); project costs 300 / 450 / 250 as W00-59 overrides (OD-20); seeded treasury balance in `w22` and the hosted scenario; W22 deps without W11.

## W23 — Real NEAR (H2: F5, F1, F2)

- **H set · deps:** H2 21 · 15.0 (all other 26 rows —) · deps per port group: W00 (infra, ChainRead), W06 (identity, relayer), W10 (cargo), W13 (intents), W15, W20, W12, W22, W21 for the rest. Start: D10 gate (cut) or D6 (Pivot), OD-03.
- **H2 covers demo steps 1–3** (identity, cargo, intents); W23 has no `@hack` tag. Steps 4–6 need W23-43/46, W23-42, W23-47 (all —).
- **Pre-reads:** 06 R06-1..R06-80; R01-14..R01-17, R01-27..R01-35; R02-26, R02-34, R02-37; R03-36, R03-56; 07 §4 swimlane, §10.
- **Owner decisions:** OD-01, OD-02, OD-03, OD-12, OD-13, OD-18.
- **Numbers:** N-26, N-27.

| Issue | Ask | Pack id |
|---|---|---|
| W23-01 env | Acceptance uses `NEAR_ADAPTER_CARGO`; `NEAR_NETWORK_<PORT>` override | R06-42, R06-44, Q-06-11 |
| W23-02 network matrix | Testnet Pilot ID with mainnet cargo: which account holds cargo? | R06-53, Q-01-19 |
| W23-04 accounts | Who signs `create_account` for `{name}.*`; `npc.*` key holder | Q-01-1 |
| W23-05 / 06 ChainRead | H2 here, mock in the cut | R06-51, Q-06-12 |
| W23-07 / 08 (—) | Real relayer runs without alert or spend cap | R01-32, R01-33, Q-01-17 · Q-06-14 (closed → Q-01-17) |
| W23-09 provider | Already decided by MP §0? Record D-37 with the fallback trigger date | R01-3, Q-01-3 |
| W23-10 identity | NEAR Auth derives the player key: does W06-09's key store still apply? | R06-25, Q-01-2 · Q-06-7 (closed → Q-01-2) |
| W23-11 client login | CSP for `login.*.fast-auth.com` | Q-06-8 |
| W23-14 (—) claim | Residual FC key; wallet connector | Q-01-11, Q-01-21 |
| W23-17 `res` | Issue text says `mt_transfer_call`; docs need `mt_batch_transfer_call` | R06-6, Q-06-1 |
| W23-18 deploy | "`mt_metadata` returns the 4 tokens" vs 10 ids | R06-28, Q-06-4 |
| W23-21 deposit | A tested 1-unit mainnet deposit; drop 21a/b; storage cost, withdraw names | R06-8, Q-06-3, Q-06-4 |
| W23-22 intents | Guild / director legs cannot sign on real Intents while AgentWallet is mock | R06-68, Q-06-18 |
| W23-24 smoke trade | 1-unit trade at 1 % → fee leg 0 under floor rounding | Q-03-2 |
| W23-25 (—) 1Click | Bet B needs it by D11 | Q-06-13, R06-10 |
| W23-26 / 27 (—) agent wallet | `addLimitedKey(allowance, receivers: intents.near + res.*)` is two receivers and a token allowance | R06-63..R06-66, Q-06-17 |
| W23-28 (—) funding | Funds 3 NPCs vs W15-02's 2 | R04-52, Q-04-24 |
| W23-38 (—) escrow | `open` uses `mt_transfer_call` | R06-6, Q-06-1 |
| W23-41 (—) migration | Re-mint of mock balances: order with deed / DAO / escrow | R02-33 |

**Proposed rows:** rename env keys / add `--dry` (Q-06-11); W23-07/08 → H2 or a manual check runbook (OD-18); W23-26/28 → H2 if OD-02 (Q-06-18); `add_public_key` registration check on `intents.near` (R06-66); wNEAR wrap path (Q-06-2, only with OD-02).

## W24 — Mobile and landing

- **H set · deps:** 0 H (W24-36 is the only H+, 0.5) · deps W04, W02; optional W09, W11.
- **@hack:** none.
- **Pre-reads:** 07 §3 rows citing landing-brief; R01-43.
- **Owner decisions:** OD-09 and OD-08 decide the `director` and `market` copy; OD-16.
- **Numbers:** —.

| Issue | Ask | Pack id |
|---|---|---|
| ★ W24-28 live stats band | Binds to W11-08's endpoint; W11 dropped → hide the band or point it at the season dashboard? | Q-03-31, OD-16 |
| landing copy | "One small H issue (text swaps)" per landing-brief has no row: which wave owns it? Copy for `director`, `chain`, `market`, `faq` depends on Q-04-1, Q-06-17, Q-04-5 | 07 §3 |

**Proposed rows:** one S row (H) for landing text swaps after OD-09 / OD-08.

## W25 — Launch and ops

- **H set · deps:** 15 · 10.5 · finish u34.0 (critical path W25-29 → W25-30 → W25-31 → W25-33) · deps W00; W25-29 reads W05, W07, W10, W12, W13, W14, W15.
- **@hack:** steps 3, 4 (backup only), 7 (smoke against the hosted demo).
- **Pre-reads:** R06-43, R06-54, R06-71..R06-73, R05-72, R03-28; 01 §2 payout-wallet row; 07 §3, §6.
- **Owner decisions:** OD-16, OD-17, OD-18, OD-22, OD-03.
- **Numbers:** N-26, N-27, N-29.

| Issue | Ask | Pack id |
|---|---|---|
| W25-06 `validate-env` | Three allow flags; `zai` rule with no Z.ai adapter | R06-71, Q-06-6 |
| ★ W25-13 (—) alerts | Relayer-balance and outbox-stuck alerts reuse W23-07 (—) while real NEAR runs to Nov 25 | R06-58, Q-01-17 · Q-06-14 (closed → Q-01-17) |
| W25-26 README | `ports:table` network column; monetization honesty (fee in cargo); paper loop; mock / real wording | R06-54, R03-28 |
| ★ W25-28 hosted demo | `NEAR_ALLOW_MOCK_IN_PROD=true` only; AI / NOTIFY flags unset; real only for green ports | R06-73, Q-06-6 |
| ★ W25-29 video | Script "… walls …" depends on W14-28 (Pivot drops W14) and differs from Pivot §5 and media-plan Video A / B: one script | demo-beat map |
| ★ W25-30 X post | Claims must match the mock / real table | 07 §3 |
| ★ W25-31 submission | Tracks 10 / 12 "qualify"; payout wallet apart from `relayer` / `minter` | Q-05-22, OD-22, 01 §2 |

**Proposed rows:** README "do X → see Y" for Bet A steps 1 / 2 (R04-46, OD-19); `RULES.md`; season dashboard + seed and ops (Pivot ≈ 5 units, OD-16).

## Demo-beat map

**Keep** = runs in H as written · **seed** = runs only with a seeded scenario or dev command · **drop** = no H issue carries it.

| Beat (source) | Rule | Issue · H | Verdict |
|---|---|---|---|
| A1 two players land, build, open Trade Hubs (MP §6) | R02-16, R02-17 | W01-05, W10-02 · H | seed at S4 (Balance §9.1, Review C5) |
| A2 Guild docks; offers with attestation | R04-12, R04-22 | W15-11 · H; attestation none | keep dock; drop attestation unless OD-08 |
| A3 they trade; one mines, one terraforms | R03-31 | W13-13 · H | keep (mock) |
| A4 habitat pressure → den wave | R04-43 | W07 raids · H; nest rows none | seed (`spawnRaid`) |
| A5 joint defense + market buy of military resources | R03-31 | W07, W13 · H | seed |
| A6 vote terraform boost → visible cost cut | R05-45, R05-61 | W22-11, W22-36 · H | keep if Q-05-13 solved, else seed (`treasury.effect`) |
| A7 ≈ 40 % terraform, live book, "Guild fees earned" | R03-1 (stall fees, not Guild) | W05 · H | seed (S4, 20 %, `warp 3`); reword "Guild fees" |
| B1–B2 orchestrator pushes `mass_export`; player accepts | R04-42 | W16 · — | drop (OD-10) |
| B3 market moves, dust storm | R03-58; storms W05 deferred | W13-18 · H | keep market part; drop storm |
| C1 heavy den pressure on both | R04-43 | none | seed (`spawnRaid`) or drop |
| C2 market + temporary truce | R04-38 | W18 · — | drop truce |
| C3 meteor / fauna shield vote | R05-70 | W22-10 · —; no fauna kind | drop (boost only) |
| Balance §9.1 rows (S4 seed, `guild.summon`, exports, terraform beat, summoned raid, vote, end state) | as A1–A7 | as A1–A7 | seed, with the warps in Balance §9.1 |
| Balance §9.2 B / C beats | R04-42, R04-43 | none | drop B; seed C raid |
| Balance §9.3 week of trading in a minute | R04-57 | none | proposed row (W15, Q-04-5) |
| Pivot §5 / Video B 0:00 agent `found colony` in a terminal | R04-44, R04-56 | none | drop unless OD-19; Q-04-22 |
| Pivot 0:20 colony builds itself | autopilot (out of chain scope) | W08 · H | keep |
| Pivot 0:40 Kestrel docks, attested reasoning tooltip | R04-16, R04-22 | W15-11 · H; reason none | keep dock; reason needs row; attestation per OD-08 |
| Pivot 1:00 sector dashboard, 7 days of history, leaderboard | R03-61 | none | drop unless OD-16; fast-forward replay |
| Pivot 1:20 treasury vote passes, globe greens | R05-61 | W22-36 · H | keep (seed balance, Q-05-13) |
| Pivot 1:40 "300 water for 0.012 NEAR … protocol fee 0.00003 NEAR" | R03-63, R03-26 | W13-17 · H+; protocol leg none | drop NEAR price unless OD-02; Q-03-30 |
| Pivot 1:55 human logs in with Google next to agents | R01-3, R01-4 | W23-11 · H2 | keep if real F5 (OD-03), else "Google (mock)" |
| Video A 0–5 s terminal `found colony` | R04-44 | none | as Pivot 0:00 |
| Video A 5–20 s pod lands, "a NEAR account it will never see" | R01-41 | W01 · H; agent account none | keep landing; account line per OD-19 |
| Video A 20–35 s agent exports 300 iron | R02-52 | W10-05 · H | keep with 200 (Q-02-18) |
| Video A 35–55 s Kestrel docks, reason tooltip, agent accepts | R04-16, R04-12 | W15-11 · H | keep; reason row needed |
| Video A 55–75 s toast 0.012 NEAR + `execute_intents` link | R03-63 | W23-24 · H2 | resource-for-resource toast; real link only after the gate |
| Video A 75–90 s dashboard price tick moves | R03-58 | W13-18, W13-23 · H | keep (planet board) |
| Media screenshot `execute_intents` with three legs | R03-29 | W13-12 · H | keep for W13 demo; 4–5 legs with W22 / OD-04 |
| Media GIF 6 vote passes, boost badge | R05-61 | W22-36 · H | keep (seed) |
| W25-29 landfall → economy → terraform → combat | out of chain scope | W01, W02, W05, W07 · H | keep |
| W25-29 walls | out of chain scope | W14 · H (Pivot drops W14) | drop if W14 dropped; fix W25-29 deps |
| W25-29 cargo → market → Guild → profile | R02-19, R03-31, R04-12, R03-43 | W10, W13, W15, W12 · H | keep |
