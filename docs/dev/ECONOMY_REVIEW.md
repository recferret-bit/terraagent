# W13 economy owner review (F2 mock)

One page for the owner: how to review the W13 mock economy, run the acceptance pack and the stress suite, and what is deliberately **not** approved. Workflow of changing the economy: [`ECONOMY_OPERATOR.md`](./ECONOMY_OPERATOR.md). Contract: [`ECONOMY.md`](../spec/ECONOMY.md).

## Cash eligibility is false in W13

Every number here comes from the **mock** economy (mock USDC/NEAR, mock chain, simulated behaviour). Nothing in W13 can make a profile cash-eligible:

- `compareExperiments` / `GET /v1/economy/comparisons` always return `cashApproval: false` with the blockers listed (no approved gate thresholds, no external pilot reference; the API accepts none).
- A production activation needs `evidenceRunId` of a passing run of that exact candidate; sandbox activations are `nonProduction`.
- Cash needs W15 funded-bot runs and W23 limited-pilot evidence (LED-18 in `docs/questions-and-limitations/economy-ledger.md`). Calibration constants are hypotheses, not facts.

The acceptance pack asserts this (`cashApproval === false`, blockers non-empty); a pass of the pack means "reviewable", never "cash approved".

## Acceptance pack (`tests/economy/acceptance/`)

| Command | Needs | Covers |
|---|---|---|
| `npx vitest run --config tests/vitest.config.ts tests/economy` | nothing (about 6 s) | recipe pinning across a profile swap and rollback (`recipe-pinning.spec.ts`); integrated source/sink flows reconcile exactly, hard gates, candidate comparison with a held-out seed, `cashApproval` false (`economy-flows.spec.ts`) |
| `npm run db:up` then `npx vitest run --config tests/vitest.integration.config.ts tests/economy/acceptance` | Postgres (about 15 s) | profile management over the REST API: clone, patch a prestige recipe and the platform fee, validate, approve, activate (sandbox), new planets load the new data, rollback (`profile-management.int.spec.ts`); per-token zero-sum of FINAL trade batches, closed mock ledger, reservations released exactly once, insufficient inclusive funds refused, Merchant and Port Authority facts from a real trade (`market-conservation.int.spec.ts`) |

The first command is also part of `npm test`; the second is part of `npm run test:integration`.

## Stress suite

Short (1 seed, 800 ticks, every fixture, hard gates): `npx vitest run --config tests/vitest.config.ts shared/sim/test/economy/stress-suite.spec.ts`.

Full length (10 stress scenarios, seeds 101 and 202 plus held-out seed 303, 3000 measured ticks, 30 runs, about 50 s):

```bash
npx tsx scripts/economy/run-experiment.ts --manifest tests/economy/acceptance/stress-manifest.json --out tests/economy/artifacts/acceptance-stress
```

Exit code 0 = every gate passed, 3 = a gate failed (the failing seeds and their replay command are in `summary.json` / `replay.txt`), 4 = incomplete. Artifacts (`manifest.json`, `summary.json`, `metrics.jsonl`, `metrics.csv`, `replay.txt`) land in the `--out` directory; `tests/economy/artifacts/` is gitignored. The probe and the future-wave counterfactual scenarios are left out on purpose: they fail by design.

Compare a candidate profile against the baseline: run the same manifest with `--profile <candidate.json>` into a second `--out`, then `npm run economy -- compare --baseline <exp> --candidate <exp>` against a running dev stack (`npm run dev`), or submit both through `POST /v1/economy/experiments`.

## What to look at

1. `summary.json`: hashes (profile, data, engine), seeds, per-seed gate verdicts (`pass`, `fail`, `insufficient_data`).
2. `hard.flow_reconciliation`: per resource, opening + production + imports + recovered - consumption - exports = closing, drift 0, whole units.
3. `hard.mock_ledger_conservation` and `hard.no_negative_stock`.
4. Economic gates are calibration hypotheses (`approved: false` in `gate-catalog.ts`); read them as signals.
5. Asserted by assumption only: demand (`demandModel.source: assumed`) and the fee-leakage estimate of `GET /v1/dev/market/analytics/:planetId`.
