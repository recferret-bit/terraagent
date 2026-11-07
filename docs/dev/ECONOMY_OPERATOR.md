# Economy operator workflow (W13, F2 mock)

How an operator changes the economy without a code deployment. The contract is [`ECONOMY.md`](../spec/ECONOMY.md) (sections 5, 6, 8); commands, routes and env variables are in [`DEV_TOOLS.md`](./DEV_TOOLS.md) ("W13 markets and economy tooling") and [`ENVS.md`](./ENVS.md). Everything below runs against the mock chain: no real cash moves. Owner review, acceptance pack and stress suite commands: [`ECONOMY_REVIEW.md`](./ECONOMY_REVIEW.md).

## Mock versus cash

- Every market token (resources, `USDC`, `NEAR`) is a **mock** in F2. The mock `IntentsPort` keeps balances in Postgres (`NEAR_ADAPTER_INTENTS=mock`, default). Every UI labels them "mock"; a production process refuses mock adapters unless `NEAR_ALLOW_MOCK_IN_PROD=true`.
- Dev faucets (`faucet`, `POST /v1/dev/market/faucet`) credit fixture money. Fixture bot trades are classified `fixture`, never organic (D-45: organic = both sides player or bot, different colonies and different owners), and cannot drive a price board reference or a real cash bot bid.
- An experiment never settles anything. Its revenue, fee and PnL numbers are simulated and must not be shown as real revenue.
- A "cash profile" is a profile whose activation would change real-money behaviour. F2 has none; activations in the dev stack are non-production (`nonProduction`). Dev `tune` cannot change a pinned database profile.

## Roles

| Role | Can | Dev token |
|---|---|---|
| read | schema, profiles, versions, resolve, activations, experiments, artifacts | `dev-economy-reader` |
| edit | clone, patch drafts, validate, submit/cancel/resume experiments | `dev-economy-operator` |
| activate | approve, activate, rollback | `dev-economy-activator` |

AI experiment credentials get read and edit only, never activate. In production the three `TA_ECONOMY_*_TOKEN` variables must be set; without one the role does not exist.

## Steps

1. **Discover.** `GET /v1/economy/schema` lists every parameter with unit, bounds, default, mutability and required wave. Unknown paths or disabled features fail with structured errors.
2. **Clone.** `POST /v1/economy/profiles/:id/versions/:version/clone` makes a new DRAFT from any version (the baseline is immutable).
3. **Patch.** `PATCH /v1/economy/profiles/:id/versions/:version` with ops and `expectedVersion` (the draft's revision). A stale revision is `version_conflict` (409). Only drafts change.
4. **Validate.** `POST .../validate` runs the registry, coverage and compile checks; a clean draft becomes VALIDATED. Errors leave it untouched.
5. **Simulate.** Submit a manifest to `POST /v1/economy/experiments` (202, returns an id; submission is not completion). Or run it headless: `npx tsx scripts/economy/run-experiment.ts --manifest m.json --out tests/economy/artifacts/<exp> --profile candidate.json`. Poll `GET /v1/economy/experiments/:id`; `cancel` and `resume` exist.
6. **Compare.** `npm run economy -- compare --baseline <exp> --candidate <exp>` (or `POST /v1/economy/comparisons`): paired-seed deltas with 95 % intervals, held-out seeds, Pareto dimensions (never one score), gate transitions, `cashApproval` (always false in mock). `npm run economy -- recommend --experiment <exp>` returns a candidate patch with the reasons and the seeds behind them; it refuses a revenue-only gain or a favourable subset of seeds and never activates. Full rules: [`DEV_TOOLS.md`](./DEV_TOOLS.md) (CLI section). Exit codes: 0 ok, 2 invalid input or no permission, 3 failed gates, 4 execution failure.
7. **Approve.** `POST .../versions/:version/approve` (activate role) after the evidence gate passes.
8. **Activate.** `POST /v1/economy/activations` with scope (global, planet type, planet id, sector), version, effective tick and the evidence run id. Audited and idempotent by `requestId`; the host receives the compiled overrides once, orders already open keep their pinned terms.
9. **Roll back.** `POST /v1/economy/activations/:id/rollback`. Completed trades and open orders keep the terms they were placed under.

## Artifacts

Runner output directory (and the server's `TA_ECONOMY_ARTIFACT_DIR`, default `tests/economy/artifacts/`, gitignored), one folder per experiment:

| File | Content |
|---|---|
| `manifest.json` | The exact manifest (immutable: the runner refuses a different manifest in the same directory) |
| `summary.json` | Hashes (profile, data, engine commit), seeds, gate verdicts, per-seed results, environment, actual TPS |
| `metrics.jsonl`, `metrics.csv` | Sampled metrics (runner), per run as `run-<n>-metrics.*` and `run-<n>-summary.json` (server) |
| `replay.txt` | The command that replays each failing seed |

Server artifacts are checksummed (sha256 in the experiment record); a changed file is an error, never served. Fetch with `GET /v1/economy/experiments/:id/artifacts/:name`. Runner exit codes: 0 pass, 2 invalid input, 3 failed gates, 4 execution failure or budget exhausted (incomplete, never a pass). A gate with too little data reports `insufficient_data`, not a pass.
