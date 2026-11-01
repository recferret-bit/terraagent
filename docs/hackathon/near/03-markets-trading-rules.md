# 03 — Markets and trading rules (F2)

> **Status:** 2026-10-31, grooming reference, pass 2 (legend, precedence rules and abbreviations: [`README.md`](./README.md)). **Sources:** [`NEAR.md`](../../spec/NEAR.md) §1, §6, §12, §15 · [`W13-markets.md`](../../plan/waves/W13-markets.md) · W15-08/11, W22-07, W23-21..25, W11-04/05, W04-18 · [`PROTOCOL.md`](../../spec/PROTOCOL.md) §7, §8, §10 · [`DATA_MODEL.md`](../../spec/DATA_MODEL.md) §4.4.1 · NEF F2 · D-19, D-25, D-26, D-30 · MP §0, §1, §3, §7 · Review §2, §4 · Balance §7, §10 · Pivot §2, §6 · [`media-plan.md`](../public/media-plan.md).
> **Owned here:** the treasury-leg split (Q-03-1), the protocol fee (Q-03-7), NEAR pairs in the demo (Q-03-15). **W13 header note:** partial fills, taker pays the fee, and no self-trade are implemented by H issues but are in no spec, so they are **Planned · spec gap** until W13-02 writes them into NEAR.md (the note's fourth item, the over-cap mint refund, is in [02](./02-mining-cargo-mint-authority.md)).

## 1. Purpose

Every Trade Hub is a **market stall**. Colonies sell surplus cargo and buy what they cannot mine yet (T2/T3 before they mine them, D-34), and stall owners earn a fee. This is the "player-owned markets" answer to track 09 (NEF §1). Trades settle as NEAR Intents `token_diff` batches. Players see "contracts" and never see intents (NEF §1, W13 Goal). Files that own the neighbouring topics:
- [02](./02-mining-cargo-mint-authority.md): minting and the deposit of cargo.
- [04](./04-agents-and-communication.md): the Guild, the director and the Agent API.
- [05](./05-deed-staking-treasury-bounties.md): the DAO.
- [06](./06-near-tools-and-adapters.md): the Intents call details, wNEAR, 1Click and the mainnet setup.

## 2. Actors and accounts

| Actor | Account | Role in a trade | Who signs |
|---|---|---|---|
| Maker colony | `{colony}.{name}.terraagent.near` (`.mock` in phase 1) | rests an order; the side it gives is deposited into the verifier | the server, with the custodial colony key until the account is claimed (NEF F2, D-18, W13-07); claimed accounts: Q-03-9 |
| Taker colony | same shape | crosses a resting order; pays the stall fee out of what it receives (W13 note) | same as the maker |
| Stall owner | colony account of the Trade Hub where the **maker** listed (`stallId`) | receives the fee leg | receive-only leg, signer unknown: Q-03-19 |
| Planet DAO | `{planet}.sputnik-dao.near` (mock `{planet}.dao.mock`, W22-05) | receives the treasury leg (W22-07) | Q-03-19 → [05](./05-deed-staking-treasury-bounties.md) |
| Project account | not named anywhere | receives the protocol fee (MP §7, Proposed) | Q-03-7 |
| Guild NPC | `guild-N.npc.terraagent.near` | market maker on the books of the planet it is docked at (W15-08) | its own NPC key (NEAR-70) → [04](./04-agents-and-communication.md) R04-1 |
| Director / external agent | director key on the colony account; Agent API colony (Pivot Bet A) | an ordinary maker or taker (R03-50, R03-62) | → [04](./04-agents-and-communication.md) R04-25, R04-58 |
| Market module | `near` module of the one app | message bus, matcher, batch builder (NEAR-61, D-26) | submits batches; does not sign legs |
| Relayer | `relayer.*` | submits `execute_intents`, pays the gas (NEAR §4, NEAR-62) | relayer key |
| Verifier | `intents.near` (mock: `MockIntentsAdapter`, W13-04) | holds deposits, checks that each token sums to zero, applies the batch atomically | — |

## 3. Rules

| ID | Rule | Status | Source |
|---|---|---|---|
| R03-1 | Every Trade Hub is a market stall. Each settled trade carries a fee leg to the stall's owner. | Decided | NEF F2, NEAR-61 |
| R03-2 | One order book per planet per pair (sub-resource × sub-resource, or sub-resource × NEAR/USDC), with price-time priority. Persisted in `chain.market_order` and rebuilt on boot. | Decided | NEAR-61 · W13-08 (H) |
| R03-3 | Same-planet books only. Cross-planet flow goes only through Guild NPCs. | Decided | D-19, NEAR-63, NEAR-72 |
| R03-4 | Placing an order requires a Trade Hub T1. A truce is not required. | Decided | NEAR-63, D-19 |
| R03-5 | The stall is any online Trade Hub on the planet. Default: the maker's own. | Planned | W13-09 (H) |
| R03-6 | Each of the 10 `ResourceKey`s is its own pair against each quote token. T1 trades from day one. Energy is not tradable. | Decided | D-34, NEAR-50 |
| R03-7 | Order fields: `side`, `resource`, `amount`, `price {token, amount}`, `ttlS`, `stallId`. PROTOCOL §4.2 uses `price.resource` and has no `stallId` (Q-03-11). | Planned | W13-01 (H) |
| R03-8 | An order is a signed NEP-413 `token_diff` from the maker's colony account, with deadline = TTL. It covers in-orbit cargo or NEAR/USDC held in the verifier. | Decided | NEAR-60 |
| R03-9 | TTL options: 15 min, 1 h, 6 h, 24 h. | Planned | W13-03 (H) |
| R03-10 | Minimum order: 10 units (`order_too_small`). | Planned | W13-03 (H) |
| R03-11 | Price tick: 0.001. No reject code exists for an off-tick price (Q-03-11). | Planned | W13-03 (H) |
| R03-12 | At most 20 open orders per colony (`order_limit`). | Planned | W13-03 (H) |
| R03-13 | Placing an order auto-deposits the side the maker gives into the verifier through the outbox (`opId = market-deposit:{orderId}`). Mock token id `nep245:res.terraagent.mock:<ResourceKey>` (W13-04) matches the verified real format (R06-7, [X3]). | Planned | W13-09, W13-04 (H) |
| R03-14 | The sim mirrors reservations as `reservedInOrbit` (`market.reserve` / `release` / `settled`). Sim stock does not change. | Planned | W13-10 (H), SIMULATION §4 |
| R03-15 | `fee_bp` is snapshotted onto the order when it is placed. | Planned | W13-08 (H) |
| R03-16 | A fill executes at the maker's price. | Planned | W13-11 (H) |
| R03-17 | Partial fills for custodial accounts: the server signs a fill-sized diff at match time. | Planned | W13-11 / W13-12 (H) · spec gap (W13 note) |
| R03-18 | Orders from claimed accounts are all-or-nothing. Claim is post-hackathon (W23-14 has no H tag), so this path does not run in the demo. | Planned | W13-11 (H) · spec gap (W13 Goal bullet) |
| R03-19 | Self-trade prevention: two orders from the same colony never match. The note says "the older stays, the incoming rests"; W13-11 says "skip". | Planned | W13-11 (H) · spec gap (W13 note) |
| R03-20 | A Guild NPC never trades with another Guild NPC. | Planned | W15-08 (H) |
| R03-21 | The stall owner sets the fee to 0–3 % with `market.setHubFee` (`fee_out_of_range`), `MARKET_FEE_BP_MAX = 300`. The slider is H+; no H issue sets a default fee or owns the server handler (Q-03-26). | Decided | NEAR-61, NEAR §12 · W13-22 (H+) |
| R03-22 | The taker pays the fee out of the token it receives. The fee goes to the owner of the stall where the maker listed. | Planned | W13-12 (H) · spec gap (W13 note) |
| R03-23 | Fee rounding: floor, remainder to the maker. A 1 % fee on 7 units is 0, with no dust. | Planned | W13-31 (H+), a test row only |
| R03-24 | A share of every market fee goes to the planet DAO. | Decided | NEAR-101 |
| R03-25 | The treasury also gets 0.2 % of every Guild fill. | Proposed | Balance §7.2, §8; Review §4.4 |
| R03-26 | A protocol fee of 0.25 % (variant 1) or 0.40 % (variant 2) goes to the project account, as a line in the toast. Default payer: the taker, out of the token it receives. **No issue exists.** | Proposed | MP §0, §7; Review C4; Balance §8, §10 Q6 |
| R03-27 | Variant 3: optionally route 15 % of each treasury project's cost to the project instead of burning it. | Proposed | MP §7 → [05](./05-deed-staking-treasury-bounties.md) R05-47 |
| R03-28 | Until a NEAR pair exists, the protocol fee is paid in cargo, and the README must say it has no NEAR value. | Proposed | Review §4.3, Balance §7.3 |
| R03-29 | A match builds `[maker, taker, feeLeg(, treasuryLeg)]`. The sum per token is asserted before submission. A batch that does not sum to zero fails whole (`NEAR_INTENT_DIFF_NOT_ZERO`). | Decided | NEAR-61, §1a rule 4 · W13-05, W13-12 (H) |
| R03-30 | The server signs the legs of unclaimed (custodial) colonies with the decrypted colony key. | Decided | NEF F2, D-18 · W13-07 (H) |
| R03-31 | Settlement path: outbox `opId = trade:{tradeId}` → relayer → `execute`. On final: `chain.intent_trade` set to FINAL, `market.settled` to both sims, push `market.trade`. No restart executes a batch twice. | Decided | NEAR-62, §1a rule 6 · W13-13 (H) |
| R03-32 | Failure after retries: the trade is FAILED, both orders go back to the book (EXPIRED if past their TTL), `market.release` is sent, and the toast says "Contract failed, order returned". | Decided | NEAR-62, PROTOCOL §10 · W13-14 (H) |
| R03-33 | If NEAR or the verifier is unreachable, market and cargo commands are rejected with `market_unavailable` and the planet keeps running. Landed code also has `NEAR_UNAVAILABLE` (503). Detection before accept: Q-02-6. | Decided | NEAR §1 p4, PROTOCOL §10; code: `backend/app/src/near/domain/errors.ts` |
| R03-34 | An order can be cancelled (by its owner only) or expire (TTL sweep every 30 s). Its deposit stays in the verifier as free in-orbit cargo. | Planned | W13-15 (H) |
| R03-35 | In-orbit cargo = cargo account + free verifier balance. Import auto-withdraws from the verifier first (`opId = market-withdraw:{importSeq}`). | Planned | W13-16 (H) → [02](./02-mining-cargo-mint-authority.md) R02-29 |
| R03-36 | `intents.near` is mainnet only. Dev uses `simulate_intents` / `dry: true`; CI stubs the verifier. | Decided | NEAR-64 → [06](./06-near-tools-and-adapters.md) R06-2 |
| R03-37 | Orders may be priced in NEAR or USDC (open in beta). | Decided | NEAR-65, D-26 · W13-17 (H+) |
| R03-38 | No NEAR/USDC pairs in the demo: resource-for-resource only, and the Guild float is not used for trading. MP §0 calls this "locked". | Proposed | MP §0 ("safest"), §3 "Later"; Review C7 |
| R03-39 | One NEAR pair per T1 family (`metals.t1/NEAR`, `minerals.t1/NEAR`, `bio.water/NEAR`). The Guild float is the loss limit, numbers in [04](./04-agents-and-communication.md) R04-50..52. The protocol fee shows as a NEAR line. Kill switch at D11, falling back to resource-only. | Proposed | Pivot Bet B, §6 |
| R03-40 | The 1Click API "may be used" for external swaps; 0.2 % fee without a JWT; "verify the API details". | Decided | NEAR-65 · W23-25 (—) |
| R03-41 | Settled trade history feeds the planet price board. | Decided | NEAR-62 |
| R03-42 | The Guild `refPrice` is the board's 24 h VWAP (NEAR-71 only says "the planet's last 24 h of settled trades"). | Planned | W15-06 (H) |
| R03-43 | Progress events: `merchant` +1 per settled trade per colony; `portAuthority` + fee units earned by the stall owner. Thresholds come from the W12 catalogue. | Planned | W13-27, W12-01 (H); profile rows 16, 17 |
| R03-44 | Deed metadata carries the colony's trade volume. | Decided | NEAR-91 → [05](./05-deed-staking-treasury-bounties.md) R05-3 |
| R03-45 | Toast "Contract signed: X for Y at <Stall> (n % fee)", plus a Contracts list (last 20) and `history.trade` rows. | Planned | W13-24 (H), NEF F2 |
| R03-46 | `market.book` push is debounced to 1 Hz per pair; `market.trade` is pushed on each settlement; snapshot at `GET /v1/market/{planetId}`. | Planned | W13-19 (H), PROTOCOL §7 |
| R03-47 | Guild maker loop: while docked, one bid and one ask per pair, signed with the NPC key, with capped sizes; all quotes are cancelled on departure. | Planned | W15-08 (H), NEAR-70 |
| R03-48 | `market.acceptGuildOffer` crosses the NPC quote at once through the W13 path. A stale offer id gets `offer_expired` with the new price. | Planned | W15-11 (H) |
| R03-49 | Negotiate goal hook: places and refreshes orders within the goal's give/want bounds and budget. | Planned | W13-26 (—), units §4.6 |
| R03-50 | `autoTrade` orders are signed with the director key within limits. `withinAutoTrade` runs in the sim and again in the matcher (`autotrade_limit`). | Decided | NEAR-81 · W15-20, W15-21 (H) → [04](./04-agents-and-communication.md) R04-25 |
| R03-51 | No rate limits and no anti-bot. Farm bots trading for value is an accepted risk. | Decided | D-25, D-26 |
| R03-52 | With `TA_WAVES` below 13: the Market tab is gone, market commands get `wave_disabled`, and orders stay in the DB untouched. | Planned | W13 DoD, W13-35 (H) |
| R03-53 | Placement checks: own colony; the maker's own online Trade Hub T1 (`no_trade_hub`, `hub_offline`); an online stall; amounts within config. | Planned | W13-09 (H) |
| R03-54 | Treasury leg = `TREASURY_FEE_SHARE_BP` 2 000 bp **of the stall fee, carved out of the hub owner's fee** (300 at 1 % → owner 2.4, DAO 0.6), plugged in through `registerFeeLeg`; the batch stays zero-sum. The 2 000 value itself is Decided (value proposed) in NEAR §12. | Planned | W22-07 (H); NEAR §12 |
| R03-55 | Additive example: 1 000 units at 1 % → stall +10, treasury +2, project +2.5 (Q-03-1). | Proposed | MP §7 |
| R03-56 | Cargo must be in the verifier to trade, credited as `nep245:res.terraagent.near:<ResourceKey>`. The deposit method (`mt_transfer_call` in NEAR-55 vs `mt_batch_transfer_call` in the docs) is a conflict owned by 06 → Q-06-1. | Decided | NEAR-55 |
| R03-57 | Gameplay never blocks on the chain, except a trade's own settlement. Mint, burn and settlement are async outbox jobs. | Decided | NEAR §1 p4 |
| R03-58 | Price board per planet and pair: last price, 24 h volume, VWAP, 1 h OHLC candles from `chain.intent_trade`, and a sparkline UI. | Planned | W13-18, W13-23 (H) |
| R03-59 | One book and one board per planet and pair, shared by every stall. The stall decides only the fee recipient and the `fee_bp` snapshot. A maker may list at another colony's online stall. | Planned | NEAR-61 · W13-08, W13-09, W13-18 (H) |
| R03-60 | Stall discovery: `GET /v1/market/{planetId}/stalls` (position, fee, best bid/ask) and the map Market layer. Neither is H, and the W13-21 form has no stall field, so in the demo every order lists at the maker's own stall (Q-03-29). | Planned | W13-25 (—), W04-18 (—) |
| R03-61 | Season: five dev planets, each with its own books. The Guild is the only bridge, but cross-planet carry (W15-10) is post-hackathon, so the five economies do not connect (Q-03-31). | Proposed | Pivot §2 "living season"; NEAR-63, NEAR-72 |
| R03-62 | Agent ↔ agent trading: external-agent colonies (Bet A `placeOrder` / `acceptGuildOffer` / `counterOffer`) and director orders enter the matcher as ordinary makers and takers under R03-1..R03-60. | Proposed | Pivot Bet A → [04](./04-agents-and-communication.md) R04-58 |
| R03-63 | Video beat: "Contract signed: 300 iron for 0.012 NEAR at Vega Port · fee 0.00003 NEAR", and `execute_intents` "with three legs summing to zero" (Q-03-30). | Proposed | media-plan.md l.15, l.38 |

## 4. Flows

**Placing an order (happy path).**
1. The client sends `market.placeOrder`.
2. Checks (R03-53): zod schema, own colony, the maker's own online Trade Hub T1, an online stall, amount ≥ 10, fewer than 20 open orders, price on tick, a valid TTL option.
3. The outbox deposits the given side into the verifier, and the order is signed with `signTokenDiff` (custodial key).
4. `chain.market_order` gets the order as OPEN with a `fee_bp` snapshot, and `market.reserve` goes to the sim.
5. Ack to the client; the `market.book` push follows within 1 s (W13-09, W13-10, W13-19).

**Match and settle.**
1. A new order crosses the opposite side by price-time priority. Same-colony orders are skipped. Fills are at the maker's price, and custodial accounts can be partly filled (W13-11).
2. For each fill: a maker diff, a taker diff, the stall fee leg and any registered legs (the treasury leg from W22). The sum per token is asserted to be zero, then the colony legs are signed.
3. Outbox `trade:{tradeId}` → relayer → `IntentsPort.execute` → FINAL.
4. Then: `chain.intent_trade` is written, the fills are updated, `market.settled` goes to both sims, `market.trade` is pushed, the toast shows, and `progress.merchant` / `progress.portAuthority` are emitted (W13-12, W13-13, W13-27).

**Settlement fails.** `execute` is rejected (sum not zero, balance, nonce, deadline) or the mock failure rate hits. After retries the trade is FAILED, both orders are OPEN again (EXPIRED if past TTL), `market.release` is sent, and the toast says "Contract failed, order returned" (W13-14). Nothing stops an immediate re-match (Q-03-3).
**Cancel or expire.** `market.cancelOrder` (owner only) or the 30 s TTL sweep → CANCELLED / EXPIRED → reservation 0. The cargo stays in the verifier as free in-orbit cargo, and a later `cargo.import` withdraws it, then burns it (W13-15, W13-16).
**Guild offer.** The Guild docks → `guild.arrived` with the top 6 offers → the player taps Accept → `market.acceptGuildOffer {offerId}` crosses the NPC quote through the same settlement path, or gets `offer_expired` with the new price after a re-quote (W15-11).
**Verifier down.** `market.*` and `cargo.*` are rejected with `market_unavailable` and gameplay continues (R03-33, R03-57). What happens to resting orders is open (Q-03-25).
**Planet end, elimination, Settled.** No flow exists (Q-03-13).
**Reject codes.**
- W13-01: `no_trade_hub`, `hub_offline`, `insufficient_cargo`, `fee_out_of_range`, `order_limit`, `order_too_small`, `market_unavailable`, `NEAR_INTENT_DIFF_NOT_ZERO`.
- Elsewhere: `NEAR_INSUFFICIENT_BALANCE` (NEAR §1a; code), `NEAR_UNAVAILABLE` (code), `offer_expired` (W15-11), `autotrade_limit` (W15-20), `wave_disabled` (W13 DoD).
- PROTOCOL's `RejectCode` lists only `no_trade_hub` and `market_unavailable` of these (Q-03-11).

**Worked example 1: W13 demo (Planned, W13-12 / W22-07).** A rests an ask: sell 300 `bio.water` for 120 `metals.t1` (0.4 metals per water) at A's own stall, with a 1 % fee. B is the taker and receives water, so the fee is in water: 1 % × 300 = 3.

| Leg | water | metals |
|---|---|---|
| A (maker) | −300 | +120 |
| B (taker) | +297 | −120 |
| Stall owner (A again, as a separate leg) | +3 | 0 |
| **Sum** | 0 | 0 |

With W22 on, W22-07 splits the 3 water: stall owner 2.4, DAO 0.6. Flooring to whole units (W13-31) makes 0.6 impossible (Q-03-2).

**Worked example 2: NEAR pair, all legs (illustrative, Proposed: Pivot Bet B + MP §7 variant 1; the NEAR leg is wNEAR `nep141:wrap.near` on the real verifier, `native:near` in the mock, Q-03-27).**
- Stall owner C sets 1 %. A rests a bid at C's stall: buy 1 000 `bio.water` at 0.002 wNEAR per unit (2 wNEAR).
- B sells into the bid. B is the taker and receives wNEAR, so every fee is paid in wNEAR.
- Protocol-fee payer (Proposed default, Balance §10 Q6): the taker, out of the token it receives.

| Leg | water | wNEAR, treasury carved out (W22-07) | wNEAR, treasury added on top (MP §7) |
|---|---|---|---|
| A (maker) | +1 000 | −2.000 | −2.000 |
| B (taker) | −1 000 | +1.975 (2 − 0.02 − 0.005) | +1.971 (2 − 0.02 − 0.004 − 0.005) |
| C (stall owner) | 0 | +0.016 | +0.020 |
| Planet DAO (20 % of 0.02) | 0 | +0.004 | +0.004 |
| Project (0.25 % of 2) | 0 | +0.005 | +0.005 |
| **Sum** | 0 | 0 | 0 |

This batch has five legs; the video beat claims three (Q-03-30).

## 5. Numbers

| Value | Source | Status |
|---|---|---|
| Stall fee 0–3 %, `MARKET_FEE_BP_MAX = 300` | NEAR §12, NEAR-61 · W13-03 (H) | Decided |
| Default stall `fee_bp` for the demo (the e2e asserts 1 %): not set anywhere | W13 slice, W13-03 → Q-03-26 | Gap |
| `TREASURY_FEE_SHARE_BP = 2 000` (the value; NEAR-101 "proposed: 20 % of `fee_bp`"). The carve-out from the stall fee is Planned (R03-54, W22-07) | NEAR §12, NEAR-101 | Decided (value proposed) |
| Treasury 0.2 % of Guild fills | Balance §8 | Proposed |
| Protocol fee 0.25 % (v1) / 0.40 % (v2), taker pays | MP §7; Balance §10 Q6 | Proposed |
| TTL 15 min / 1 h / 6 h / 24 h; min order 10; tick 0.001; 20 open orders per colony | W13-03 (H) | Planned |
| TTL sweep 30 s; book push 1 Hz per pair; book depth top 10 per side (phone: best 5) | W13-15, W13-19, W13-20 (H), W13-32 (—) | Planned |
| Contracts list: last 20; NEAR/USDC shown with 2 decimals | W13-24 (H), W13-17 (H+) | Planned |
| Matcher perf: 1 000 resting + 100 incoming per s, ≤ 5 ms p99 | W13-34 (—) | Planned |
| Mock verifier latency 300–1 500 ms, injectable failure rate | NEAR §1a rule 4 | Decided |
| Gas per intent batch ≈ 0.0005–0.002 NEAR, paid by the relayer | NEAR §12 (estimate; W23-16 measures) | Decided (value proposed) |
| Guild: 2 NPCs, 6 curated offers; NEAR float cap "5 NEAR", scope unstated | W15-02, W15-11 (H) → [04](./04-agents-and-communication.md) R04-2, R04-50 | Planned |
| Guild float 5 NEAR per NPC, 10 NEAR total | Pivot Bet B → [04](./04-agents-and-communication.md) R04-51 | Proposed |
| 1Click surcharge 0.2 % without a JWT | NEAR-65 · W23-25 (—) | Decided |
| Merchant 5 / 50 / 500 trades; Port Authority 100 / 1 000 / 10 000 fee units | W12-01 (H); profile rows 16, 17 | Planned |
| Per planet-week (Model B, §8 set): protocol ≈ 2 474, stall fees 2 376, treasury 594 units | Balance §7.2, §7.3 | Proposed |
| `chain.market_order` rows in a terminal state kept 30 d; `chain.intent_trade` kept forever | DATA_MODEL §6 | Decided |
| W23 smoke trade: 1 `metals.t1` for 1 `bio.water` + a 1 % fee leg (+ the treasury leg if W22 is on) | W23-24 (H2) | Planned |

**Monetization (MP §7; every row Proposed, nothing has an issue).**

| Line | Rate / form | Recipient | Source |
|---|---|---|---|
| Principle | "project earns from activity, never pays out real NEAR from treasury" | — | MP §7 |
| Variant 1 (recommended) | protocol 0.25 % + stall 0–3 % + treasury 20 % of the stall fee | project / stall owner / DAO → burn | MP §7 |
| Variant 2 | protocol 0.40 %, same treasury share | project | MP §7 |
| Variant 3 | protocol 0.25 % + an optional 15 % of each treasury project's cost | project | MP §7 → [05](./05-deed-staking-treasury-bounties.md) R05-47 |
| Later | premium (extra order slots, priority Guild visits, robot skins; paid in NEAR or cargo), sponsored gas / relayer tips, badge and deed cosmetic upgrades | project | MP §7 "Additional later sources"; Review §4.3 |

## 6. On-chain vs app vs sim

| State | Lives in | Truth |
|---|---|---|
| Deposited balances (cargo, wNEAR, USDC) | `intents.near` (mock: W13-04 names `mock_chain_intents_balance`; the landed mock schema has `mock_chain_balance`; same drift as [02](./02-mining-cargo-mint-authority.md) Q-02-22) | chain (DATA_MODEL §4.4.1: "the chain is the truth for balances") |
| Cargo outside the verifier | colony balance on `res.terraagent.near` | chain → [02](./02-mining-cargo-mint-authority.md) R02-12 |
| Order book, signed orders, fills, `fee_bp` snapshot | `chain.market_order` | app; the deadline (= TTL) is also inside the signed intent (NEAR-60) |
| Trade record, fee legs, batch hash | `chain.intent_trade` | app read model; final state from the chain receipt |
| Stall fee setting (`market.setHubFee`) | not in DATA_MODEL, and no H issue owns it | undefined (Q-03-26) |
| Price board | derived from `chain.intent_trade` | app (derived) |
| `reservedInOrbit`, Trade Hub online / shed, `autoTrade` decisions | sim (`@terra/sim`) | sim (D-31) |
| Client | rendering and inputs | nothing (NEF §2) |

## 7. Wave map

- **W13 deps:** W10, and W06 through W10. W13 uses W00-30/32/37/38. Hooks: W08 (Negotiate) and W04 (map layer).
- **W13 @hack steps:** 1, 3–9, tagged by W13-35. Step 2 (set the fee) is skipped; the e2e uses "the default fee from `data/market.ts`", which no issue sets (Q-03-26).
- **W13 DoD gates:** the W13 e2e and every earlier e2e pass; `?scenario=w13` loads; `TA_WAVES=..12` hides the Market tab and rejects commands with `wave_disabled`, leaving orders untouched; the Intents contract suite is green on the mock; no restart executes a batch twice; tag `wave-13`.

| Issue(s) | H | Rule(s) | Note / gap |
|---|---|---|---|
| W13-01 | H | R03-7, reject codes | PROTOCOL shape drift (Q-03-11); does not own the server `setHubFee` handler (Q-03-26) |
| W13-02 | H | R03-17, R03-18, R03-19, R03-22 | writes the W13 note into NEAR.md |
| W13-03 | H | R03-9..R03-12, R03-21 | no default `fee_bp`, no off-tick code |
| W13-04, W13-05, W13-06 | H | R03-13, R03-29 | acceptance text `nep245:…:water` should read `bio.water` (Q-03-28) |
| W13-07 | H | R03-30 | NEP-413 payload reused by W23-22 |
| W13-08 | H | R03-2, R03-15, R03-59 | states differ from DATA_MODEL (Q-03-10) |
| W13-09 | H | R03-5, R03-13, R03-53, R03-59 | |
| W13-10 | H | R03-14 | |
| W13-11 | H | R03-16..R03-19 | crossed-book risk (Q-03-4) |
| W13-12 | H | R03-22, R03-29; `registerFeeLeg` | the protocol leg would plug in here (Review C4) |
| W13-13, W13-14 | H | R03-31, R03-32 | release vs keep (Q-03-3) |
| W13-15, W13-16 | H | R03-34, R03-35 | |
| W13-17 | H+ | R03-37 | the W13 slice says only quote tokens "beyond NEAR" are deferred (Q-03-15) |
| W13-18, W13-19 | H | R03-41, R03-46, R03-58 | `intent_trade` has no amount or price columns (Q-03-10) |
| W13-20, W13-21 | H | R03-7, R03-60 | preview text "fee paid by buyer" (Q-03-8); no stall field |
| W13-22 | H+ | R03-21 | MP §3 Must #3; Review C3: promote to H |
| W13-23 | H | R03-58 | |
| W13-24 | H | R03-45 | MP wants a protocol-fee line in the toast; no issue |
| W13-25, W04-18 | — | R03-60 | stall discovery after the hackathon (Q-03-29) |
| W13-26 | — | R03-49 | the Negotiate design conflict (Q-03-20) |
| W13-27 | H | R03-43 | |
| W13-28, W13-29 | — | analytics, telemetry | |
| W13-30 | H | dev console `market.seed`, `faucet` | |
| W13-31 | H+ | R03-23 | the only place the rounding rule is written |
| W13-32, W13-33, W13-34 | — | mobile, docs, perf | |
| W13-35 | H | R03-52 | e2e `@hack` steps; step 6 text (Q-03-28) |
| W15-08, W15-11 | H | R03-20, R03-47, R03-48 | fee recipient for Guild maker orders (Q-03-6) |
| W15-20, W15-21 | H | R03-50 | → [04](./04-agents-and-communication.md) R04-25, R04-27 |
| W15-12 | H+ | float cap enforcement | Pivot Bet B wants it at H → [04](./04-agents-and-communication.md) R04-14, Q-04-7 |
| W22-07 | H | R03-24, R03-54 | carved out vs added on top (Q-03-1) |
| W23-21 | H2 | R03-13, R03-56 | deposit method → Q-06-1; "4 tokens" vs 10 ids → Q-06-4 |
| W23-22, W23-23, W23-24 | H2 | R03-29..R03-31, R03-36 | 1-unit smoke trade fee floors to 0 (Q-03-2); Guild and director orders cannot settle while AgentWallet stays mock → [06](./06-near-tools-and-adapters.md) R06-68, Q-06-18 |
| W23-25 | — | R03-40 | |
| W11-04, W11-05 | — | none | planet end and archive have no market step (Q-03-13) |
| **no issue** | — | R03-25..R03-28, R03-38, R03-39, R03-55, R03-61..R03-63 | protocol leg, Guild-fill treasury leg, NEAR pair and fee line, season, agent API, video beat, default fee |

## 8. Open questions

| ID | Question | Proposed default / note |
|---|---|---|
| Q-03-1 | Is the treasury leg carved out of the stall fee (W22-07: 2.4 + 0.6 = 3) or added on top (MP §7: stall +10, treasury +2)? Balance §7.2 Model B also carves it out: stall fees 2 376 + treasury 594 = 2 970 = 1 % of 297 000 player-to-player volume. | Carve out (NEAR-101 "share of every fee leg", W22-07, Balance §7.2). Closes Q-05-10. |
| Q-03-2 | Unit precision: W13-31 floors to whole units (1 % of 7 → 0), W22-07 expects 0.6, NEAR-50 says 18 decimals. Under the floor, W23-24's 1-unit trade has a fee leg of 0. What does "remainder to maker" mean? | none |
| Q-03-3 | After a failed settlement, W13-14 and PROTOCOL §10 release the reservation although the orders are back on the book (demo step 8: "reservations stay correct"). What stops the same pair re-matching and failing in a loop? | none |
| Q-03-4 | Self-trade: if the incoming order "rests" (W13 note) after skipping a same-colony order, the book can be crossed. Rest, skip and continue, or cancel? | none |
| Q-03-5 | Pair identity: is "sell water for metals" the same book as "buy metals for water"? Which token is the base? Is `price.amount` per unit (board 0.4, tick 0.001) or a total ("for 120 metals")? | none |
| Q-03-6 | Guild quotes are maker orders, but the Guild owns no Trade Hub. Who gets the stall fee on a Guild fill, and who pays the 0.2 % treasury leg (Balance §7.2)? | none |
| Q-03-7 | Protocol fee: payer, token, recipient account, toast wording, owning issue. | Taker, out of the token it receives (Balance §10 Q6, Proposed). Recipient: Gap. Issue: one S issue in W13 (Review C4). |
| Q-03-8 | W13-21's preview says "fee paid by buyer", but the rule is "taker pays". The two differ whenever the taker is the seller. | "fee paid by taker" |
| Q-03-9 | For custodial makers, what is stored in `signed_intent` if the fill-sized diff is signed at match time? For claimed accounts: who signs, and how is a cancel enforced on chain (nonce)? → [01](./01-accounts-keys-relayer.md) Q-01-11 | none |
| Q-03-10 | Schema drift: DATA_MODEL's `market_order` has `hub_entity_id` and `hub_owner_colony_id` but no `filled` or `stall_id`, and its states are `OPEN/MATCHED/…` where W13-08 has `OPEN/PARTIAL/…`. `intent_trade` has no amount or price. The hub fee has no storage. | Align DATA_MODEL in W13-01 / W13-08 |
| Q-03-11 | PROTOCOL §4.2 `placeOrder` lacks `stallId` and uses `price.resource`. `RejectCode` lacks the W13 and W15 codes. An off-tick price has no code. Landed `NEAR_UNAVAILABLE` (503) vs `market_unavailable` (WS) vs `near_unavailable` (REST): which does the client see? | Update PROTOCOL with W13-01; map `NEAR_UNAVAILABLE` → `market_unavailable` |
| Q-03-12 | Resting orders when the maker's hub or the stall hub goes offline (brownout group 2, W10-04) or is destroyed: keep matching, pause, or cancel? Does an offline stall still earn its fee? | none |
| Q-03-13 | What happens to open orders and verifier balances when a colony is eliminated or Settled, or when the planet ends? W11-04 (14 d end, extinct / all-settled end) and W11-05 (ENDED → ARCHIVED, `planet_result`, deed hook) have no market step, and both are untagged. Do verifier balances follow the player as cargo does (NEAR-54)? | none |
| Q-03-14 | NEAR-pair tick and decimals: the 0.001 tick vs Balance §7.3's illustrative 0.0001 NEAR per unit and the video's 0.00004; the 2-decimal display (W13-17); USDC decimals. | none |
| Q-03-15 | NEAR pairs in the demo? MP §0 locks the "safest" float (no NEAR/USDC pairs, float not used for trading); Pivot Bet B proposes 3 pairs with a capped float; W13-17 (H+) covers NEAR and USDC; W13's own slice defers only quote tokens "beyond NEAR". | Owner decision (D-38 per Pivot §8). Fallback: Pivot §6 kill switch at D11 → resource-only. |
| Q-03-16 | Fee slider: MP calls it a Must, W13-22 is H+. | Review C3: promote to H |
| Q-03-17 | Wash trading under D-25: at a 0 % fee and 10 units, the trader pays nothing and the relayer pays the gas. Wash volume moves the VWAP and therefore the Guild `refPrice` (W15-06), and farms Merchant, Port Authority and deed volume. The only brakes in the repo: the 0.25×–4× clamp (Balance §7.2), the float cap (W15-12, H+) and mint caps. Under Bet B this is a path to the NEAR float. | Accepted risk (D-25); record it explicitly |
| Q-03-18 | An incoming order that sweeps several price levels makes one batch per fill. If one fill fails mid-sweep, what happens to the rest? | none |
| Q-03-19 | Who signs the receive-only legs (stall owner, DAO, project)? Can a SputnikDAO account hold verifier balances? → [05](./05-deed-staking-treasury-bounties.md), [06](./06-near-tools-and-adapters.md) | research |
| Q-03-20 | Negotiate: direct partner offers (UO-HQ-05, which still points at "the trade saga (NEAR.md §7)"; DATA_MODEL keeps `trade_offer`) or order-book orders (W13-26)? The goal budget is sim stock, but orders need in-orbit cargo. | Order book (W13-26), and fix UO-HQ-05 to NEAR §6 |
| Q-03-21 | Must the taker, or a player accepting a Guild offer, own an online Trade Hub T1? NEAR-63 says one is needed "to place orders"; units §6.2 lets the first Guild visit unlock the hub. | none |
| Q-03-22 | Port Authority sums "fee units" across tokens (water and NEAR together). | none |
| Q-03-23 | Do director, Negotiate and Agent API orders count toward the 20-order limit? | none |
| Q-03-24 | Toast example mismatch: NEF F2 says "120 light alloys" (`metals.t2`), W13 says "120 metals" (`metals.t1`). | Use W13 |
| Q-03-25 | While the verifier is unreachable, do resting orders still match and queue, or does matching pause? | none |
| Q-03-26 | The @hack e2e skips step 2 yet asserts a 1 % fee in step 4, but no default `fee_bp` is set (W13-03 sets only the max). Which H issue owns the server `market.setHubFee` handler and the per-hub fee storage (W13-01 is the contract only, W13-22 is the H+ client)? | Add `defaultFeeBp = 100` to W13-03; give the handler and storage to one H issue (W13-09 or W13-12) |
| Q-03-27 | The NEAR leg is wNEAR `nep141:wrap.near` on the real verifier (R06-9, Q-06-2), but the W13-04 mock uses `native:near`. Who wraps, and when? | Rename the mock id to `nep141:wrap.near`; only if Bet B |
| Q-03-28 | W13 text fixes: step 6 refers to "A's order of 200", but step 4 fills A's 300 ask completely, so the scenario needs a fresh 200 ask; W13-04's acceptance writes `nep245:…:water` instead of `bio.water`. | Fix in W13 grooming |
| Q-03-29 | Stall competition: in H the form has no stall field and `/stalls` and the map layer are untagged, so makers cannot compare stalls. Does a taker's `stallId` mean anything? Can a maker list at a 0 % foreign stall? | H: own stall only; picker after the hackathon |
| Q-03-30 | Video beat (R03-63): 0.012 NEAR / 300 = 0.00004 per unit, below the 0.001 tick; 0.00003 is 0.25 % of 0.012, so only a protocol fee is shown, with no stall fee; a NEAR pair with stall, treasury and protocol legs has 5 legs, not 3; with the Guild as counterparty the stall fee is open (Q-03-6). | Rewrite the beat once Q-03-14 / Q-03-15 are settled |
| Q-03-31 | Season: do the five planets' books stay disconnected (no carry, W15-10 —)? Does the sector dashboard aggregate the five boards, and from which endpoint? | none |

## 9. Grill questions

- **W13:** Which reading of Q-03-1, Q-03-2, Q-03-3 and Q-03-5 does W13-02 write into NEAR.md? Who sets the default fee and owns the `setHubFee` handler (Q-03-26)? Does W13-12 take a protocol leg now (Review C4)? Is W13-22 promoted to H? Which code does an off-tick price get?
- **W13 e2e:** step 8 asserts "reservations stay correct". Correct in which sense: released or kept? Step 6 needs a fresh ask (Q-03-28).
- **W15:** Where are Guild quotes listed (`stallId`), who earns the fee on them, and does `acceptGuildOffer` need a Trade Hub? Float numbers → [04](./04-agents-and-communication.md) R04-50..52, Q-04-24.
- **W22:** Can W22-07's 2.4 / 0.6 coexist with W13-31's floor? Does the 0.2 % Guild-fill leg get an issue?
- **W23:** What does W23-24's 1-unit trade put in the fee leg? W23-21: the docs name `mt_batch_transfer_call` (Q-06-1), dropping the NEP-141 fallback is Proposed (R06-8), and the token count is Q-06-4. Does the mock id format already match (R03-13)? With Intents real and AgentWallet mock, Guild and director orders cannot settle ([06](./06-near-tools-and-adapters.md) R06-68, Q-06-18).
- **W11 / season:** What happens to orders and verifier balances at planet end, elimination and Settled (Q-03-13)? Five disconnected books (Q-03-31)?
- **W08 / Negotiate:** order book or direct offers (Q-03-20)? Is W13-26 still post-hackathon?
- **W12 / W20:** Do wash trades count toward Merchant, Port Authority and deed volume, and is that accepted (Q-03-17)?
- **Pivot / media plan / owner:** NEAR pairs in or out (Q-03-15)? If in: tick, decimals, wNEAR (Q-03-27), the protocol-fee payer in NEAR, and which wave owns the float guard and the fee line. Rewrite the video beat (Q-03-30).
