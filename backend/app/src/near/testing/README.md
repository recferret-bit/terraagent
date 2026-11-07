# Mock chain test knobs

Two kinds of mock chain exist; the fault knobs reach both.

| Fake | Where | Use it for |
|---|---|---|
| `Mock*Adapter` (DB-backed, `infrastructure/adapters/mock/`) | Postgres `chain.mock_chain_*` | integration tests, the dev stack, e2e |
| `InMemory*` (this folder) | process memory | unit tests; never bound in the app |

## Deterministic fault injection (`mockChainControls.faults`)

`import { mockChainControls } from 'near/infrastructure/mock/mock-controls'`. A rule fires **exactly `times` times** (default 1)
on the calls it matches, in call order, after `skip` matching calls; then it disarms. No randomness (unlike `MOCK_FAIL_RATE`).
Always call `mockChainControls.reset()` in `afterEach` (it also releases blocked calls).

```ts
const h = mockChainControls.faults.inject({ kind: 'fail_after', port: 'Intents', method: 'execute', opIdPrefix: 'trade:', times: 1, skip: 0 });
h.fired(); // how often it fired        h.release(); // disarm (hold: let calls through)        await h.waitHeld(); // hold only
```

| `kind` | Effect | State after | Retry with the same opId |
|---|---|---|---|
| `fail_before` | throws `NEAR_MOCK_INJECTED_FAILURE` before anything is written (fail before submit) | unchanged, no receipt | runs normally |
| `fail_after` | the write commits, then `NEAR_UNAVAILABLE` is thrown (unknown outcome) | applied, receipt stored | replays the stored receipt, no second effect |
| `insufficient_funds` | throws `NEAR_INSUFFICIENT_BALANCE` before anything is written | unchanged | runs normally |
| `duplicate` | the call is delivered twice with the same opId (needs an opId) | applied once | n/a: the second delivery replays the receipt |
| `hold` | the call blocks before writing until `release()` / `reset()` (delayed finality); DB mock only, ignored by the in-memory fakes | unchanged until released | n/a |

Matching: `port` (case-insensitive, `*`/omitted = all), `method` (port method names `execute`, `deposit`, `withdraw`, or the
chain method such as `execute_intents`), `opIdPrefix` (`trade:` = settlement batches, `market-deposit:`, `market-withdraw:`,
`cargo-export:` ...). `skip: 1` + `times: 1` fails the second matching call only.

The older knobs still work and are independent: `setFail(port, rate)`, `setLatency(port, min, max)`,
`setOutcomeUnknown('Intents', true)` (every execute applies then throws), env `MOCK_FAIL_RATE`, `MOCK_LATENCY_*`, `MOCK_SEED`.

Dev console / WS dev command (running stack): `near.mock.fault {"kind":"fail_after","port":"Intents","method":"execute","times":1}`;
`near.mock.fault {"kind":"reset"}` disarms everything. Rules live in the app process and are lost on restart.

### Driving the settlement failure paths

| Path | Rule |
|---|---|
| trade batch fails, nothing moved (trade `FAILED`, reservations rolled back) | `{ kind: 'insufficient_funds', method: 'execute', opIdPrefix: 'trade:' }` |
| unknown outcome, recovery decides (`UNKNOWN` -> `FINAL`) | `{ kind: 'fail_after', method: 'execute', opIdPrefix: 'trade:' }` |
| relay retries then succeeds | `{ kind: 'fail_before', method: 'execute', opIdPrefix: 'trade:', times: 2 }` |
| finality delayed (trade stays `SUBMITTED`) | `{ kind: 'hold', method: 'execute', opIdPrefix: 'trade:' }` then `release()` |
| duplicate delivery never double-settles | `{ kind: 'duplicate', method: 'execute', opIdPrefix: 'trade:' }` |
| verifier deposit of an order fails | same rules with `method: 'deposit'`, `opIdPrefix: 'market-deposit:'` |

## Accounts and funding without a human

`MockIntentsAdapter` test/dev hooks (`testRegisterSigner`, `testSeedVerifier`, `testSeedOwn`) create a custodial signer key, put
USDC / resource funds on the verifier or the cargo ledger. For a bot colony use `POST /v1/dev/trade/bots` (dev only, see
`market/README.md`): it creates the colony's mock account + signer without OAuth and funds it, labelled `fixture` in the
chain-explorer notes. The in-memory fakes mirror the hooks (`InMemoryIntents.testRegisterSigner/testSeedVerifier/testSeedOwn`).
