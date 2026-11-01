# docs/hackathon/near — on-chain and NEAR feature reference (grooming pack)

> **Status:** 2026-10-31. A grooming reference, not a spec: it gathers every on-chain and NEAR rule from the specs, the wave files, the master plan ([`../../terraagent-master-plan-final.md`](../../terraagent-master-plan-final.md)) and the hackathon proposals ([`../GRAND_PRIZE_PIVOT.md`](../GRAND_PRIZE_PIVOT.md), [`../economy-balance-simulation.md`](../economy-balance-simulation.md)), labels each with its status and source, and lists the gaps and the questions to grill each wave with. When it disagrees with `docs/spec/DECISIONS.md` or a spec, the spec wins and the disagreement is a gap.

## Files

| # | File | Covers |
|---|---|---|
| 01 | [`01-accounts-keys-relayer.md`](./01-accounts-keys-relayer.md) | F5: guest → social login → named account, colony sub-accounts, key custody and the one-way claim, relayer, wallet link, director / Guild / agent keys |
| 02 | [`02-mining-cargo-mint-authority.md`](./02-mining-cargo-mint-authority.md) | Planet mining → stock → export (mint) / import (burn), mint caps, idempotency, exceptions to mint authority, token ids |
| 03 | [`03-markets-trading-rules.md`](./03-markets-trading-rules.md) | F2: planet-wide order books, matching, fees, settlement on NEAR Intents, failure handling, limits, NEAR pairs |
| 04 | [`04-agents-and-communication.md`](./04-agents-and-communication.md) | F3 Guild NPCs, F4 director and autoTrade, how colonies, robots and agents communicate (negotiation, truces, pushes), the proposed Agent API / MCP |
| 05 | [`05-deed-staking-treasury-bounties.md`](./05-deed-staking-treasury-bounties.md) | F6 deed and badges, Settled colonies and own-NEAR staking, F7 planet treasury DAO, F8 bounties and mercenaries |
| 06 | [`06-near-tools-and-adapters.md`](./06-near-tools-and-adapters.md) | NEAR Intents, NEAR AI Cloud, NEAR Auth, NEPs used, SputnikDAO, RPC, agent skills; ports, mock/real adapters, contract suites, network, funding, costs |
| 07 | [`07-gaps-and-grooming.md`](./07-gaps-and-grooming.md) | Cross-cutting view: coverage of the owner's six topics, master-plan §0–§10 matrix, outward-claims matrix, end-to-end swimlane, accounts and supply pointers, track map, owner-decision list for D-37 / D-38, numbers sheet, canonical open questions, glossary, review log of the three passes |
| 08 | [`08-wave-grill-checklist.md`](./08-wave-grill-checklist.md) | Wave-by-wave grooming agendas (W00, W06, W09, W10, W11, W12, W13, W15, W16, W18, W20, W21, W22, W23, W24, W25): pre-reads, decisions, numbers, issues to grill, proposed new rows, demo-beat map |

## Status legend (every rule carries exactly one)

| Status | Meaning | Source id format |
|---|---|---|
| **Decided** | Recorded in an **Accepted** decision or a spec rule. A row resting only on a decision that is itself still Proposed (D-10, D-15, D-28, D-29, D-30 in the `DECISIONS.md` index) is **Planned** with the implementing issue, not Decided | `D-26`, `NEAR-61`, `UO-TF-06`, `SIM-G-RES`, `AW-13`, `CT-34` |
| **Planned** | A wave issue implements it (the `H` tag goes in the source cell, not the status cell) | `W13-12 (H)`, `W15-07 (H+)`, `W23-10 (H2)`, `W20-14 (—)` for post-hackathon |
| **Proposed** | Only in a proposal: the master plan, the pivot, the balance doc, the whitepaper, or a wave header note not yet in a spec | `MP §7`, `Pivot Bet B`, `Balance §8`, `W13 note` |
| **Conflict** | Two sources the pack must respect disagree (spec vs spec, spec vs wave, wave vs wave, or a spec vs the running code). The rule states both sides; the question carries the proposed resolution. The spec side wins until the owner decides | `Conflict → Q-04-1` |
| **Gap** | Nothing in the repo says it. Not invented: written as a question | `Q-<file>-<n>` |

**Precedence rules.**
- A rule implemented by a wave issue but absent from every spec is **Planned**, source `W13-11 (H) · spec gap (W13 note)`.
- A spec rule whose number is a D-35 proposed default is **Decided (value proposed)**: the only qualifier allowed in the status cell.
- Facts read in the running code (`backend/`, `shared/`, `scripts/`) are cited as `code: <path>` and take the status of the issue that landed them (W00 rows are landed).
- An external fact (a NEAR doc page) does not change the repo status: a rule no spec states stays **Gap** and carries the URL tag, e.g. `Gap · [X4] verified 2026-10-31`.
- Each fact has one **owning file**; other files state it in one line and point to the owner's rule or question id. Duplicate questions are closed with "→ Q-xx-n".

Other qualifiers ("to verify", "estimate", "post-hackathon") go in the rule text or the source cell, never in the status cell. External facts carry the URL tag of the page they were read on (`[X2]`) and the date; facts remembered from earlier research but not re-fetched say so.

## Source abbreviations

`MP` master plan · `Review` [`../MASTER_PLAN_REVIEW.md`](../MASTER_PLAN_REVIEW.md) · `Pivot` [`../GRAND_PRIZE_PIVOT.md`](../GRAND_PRIZE_PIVOT.md) · `Balance` [`../economy-balance-simulation.md`](../economy-balance-simulation.md) · `Playbook` [`../LAUNCH_PLAYBOOK.md`](../LAUNCH_PLAYBOOK.md) · `WP` [`../public/whitepaper.md`](../public/whitepaper.md) · `units` units-orders-and-progression spec · `econ` colony-economy-and-buildings spec · `NEF` near-economy-features spec · `profile` player-profile-and-achievements spec. The `economy-and-onchain-summary.md` grooming summary is derived, not a spec: cite the spec or issue behind it.

## Section template (identical in files 01–06)

1. **Purpose** — what the feature is for, in the game loop.
2. **Actors and accounts** — who signs, who pays, which account holds what.
3. **Rules** — numbered `R<file>-<n>`, one rule per row: rule · status · source.
4. **Flows** — text sequences, happy path and every failure path.
5. **Numbers** — value · source · status.
6. **On-chain vs app vs sim** — where each piece of state lives and who is the truth.
7. **Wave map** — rule → issue ids → `H` tag → gap.
8. **Open questions** — `Q-<file>-<n>`, with the proposed default if any.
9. **Grill questions** — what to ask when grooming each wave that touches this file.

## Conventions

- Hackathon cut (`HACKATHON_CUT.md`, D-27): only F5, F1, F2 can go real during the hackathon (`H2` rows of W23, after the D10 gate in the cut; from D6 in the pivot). Everything else is mock.
- The master-plan conflicts already settled in [`../MASTER_PLAN_REVIEW.md`](../MASTER_PLAN_REVIEW.md) §2 (NEAR AI Cloud vs Z.ai D-09, dens vs nests, fee slider and treasury priority, protocol fee) are cited, not re-argued.
- No marketing language. Numbers marked Proposed are D-35 data rows the owner tunes.
