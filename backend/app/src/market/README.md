# Market module (W13, F2 mock)

Server side of [W13](../../../../docs/plan/waves/W13-markets.md). Client commands reach the planet sim first (D-31): the sim
checks the Trade Hub, size, TTL and fee range and emits `marketOrderRequested` / `marketCancelRequested` / `marketHubFeeSet`;
this module acts on those events in Postgres (`chain.market_order`, `chain.intent_trade`, `chain.market_stall`) and answers
the sim with the module commands `market.reserve` / `market.release` / `market.settled`. Synchronous rejections that need
server state (verifier balances, open-order count) are registered as `CommandPrechecks` (`core/command-prechecks.ts`).

Pure rules (price compare, matching, fee/rounding, zero-sum batch) are in `@terra/sim` `systems/trade/market-*.ts`, so
the headless experiment runner uses the same code. Chain effects go through the outbox (`trade:{tradeId}`,
`market-deposit:{ref}`, `market-withdraw:{colonyId}:{seq}`) to `IntentsPort` (mock: `near/infrastructure/adapters/mock/intents*`).

| Area | Folder / files | Issue |
|---|---|---|
| Book persistence + restart rebuild | `book/` (`market-order.repository.ts`, `market-books.ts`) | W13-08 |
| Place order (precheck, reserve, deposit) | `orders/place-order.*`, `order-funds.ts`, `market-sim-gateway.ts` | W13-09 |
| Matching | `matching/market-matcher.service.ts` (calls the shared matcher) | W13-11 |
| Batch builder | `settlement/batch-builder.ts`, `trade-plan.ts`, `trade-intents.ts` | W13-12 |
| Settlement + recovery | `settlement/` (`settlement-fills.hook.ts`, `trade-settlement.service.ts`, `trade-recovery.service.ts`) | W13-13, W13-14 |
| Cancel + TTL sweep | `orders/cancel-order.service.ts`, `expiry-*.ts` | W13-15 |
| Price board | `board/price-board.service.ts` | W13-18 |
| REST + pushes | `api/` (`market.controller.ts`, `market-snapshot.service.ts`, `market-book-push.service.ts`) | W13-19, W13-25 |
| Dev faucet, seed, clear | `dev/` | W13-17, W13-30 |
| Progression and history producers | `progression/` (Merchant, Port Authority, `history.trade`) | W13-27, W13-24 |
| Metrics | `telemetry/market-metrics.ts` | W13-29 |
| Trade API (keys, allowance, orders, reads, SSE, agent quote) | `trade/` | W13 bots |

## Trade API for humans and bots (`trade/`)

One REST + SSE surface (`/v1/trade/*`; schemas and route table in `@terra/contracts` `market/trade-api.ts`, `tradeApiOpenApi()` builds an
OpenAPI 3.1 document for client generation). Auth: a session or the dev identity (`?as=<name>`, actor `player`), or an API key as bearer
(`ta_bot_...`, actor `bot`). Mutating routes use the same path as the game client: write the idempotency / allowance row, run the registered
`market.placeOrder` precheck, send the sim command (`source: 'bot'` for keys), and let `PlaceOrderService` reserve, pin the policy and match.
No route calls the matcher or the reservation code.

```bash
API=http://127.0.0.1:4001/v1    # app port = TA_PORT_BASE + 1

# dev only: a bot colony without OAuth (mock account + signer, fixture funding, API key); the secret is shown once
curl -s -XPOST $API/dev/trade/bots -H 'content-type: application/json' -d '{"name":"b1","planetId":"w13-dev","colonyIndex":1,"fund":{"USDC":"500","bio.water":"300"}}'
# a human creates a key for their own colony (session / ?as= identity); allowance fields are optional overrides
curl -s -XPOST "$API/trade/keys?as=alice" -H 'content-type: application/json' -d '{"planetId":"w13-dev","label":"agent","scopes":["read","trade"],"allowance":{"maxOpenOrders":5,"dailyBudget":"50000000"}}'
KEY=ta_bot_...                   # from the response

curl -s $API/trade/pairs; curl -s $API/trade/policy -H "authorization: Bearer $KEY"
curl -s "$API/trade/book/w13-dev/bio.water%2FUSDC?levels=5"; curl -s $API/trade/board/w13-dev
curl -s $API/trade/overview/w13-dev   # every pair in ONE request: [{pair,bestBid,bestAsk,last,volume24h}] (BookLevel rationals, null when empty); use it instead of a book call per pair
curl -s "$API/trade/book/w13-dev/bio.water%2FUSDC/orders?side=sell&limit=100"   # every resting order (public); add -H "authorization: Bearer $KEY" for `mine`
curl -s "$API/trade/agent/quote?resource=bio.water&ownUnitCost=1000&transportPerUnit=0&keep=50" -H "authorization: Bearer $KEY"

# place: Idempotency-Key is required; a retry with the same key and body returns the first answer and reserves nothing twice
curl -s -XPOST $API/trade/orders -H "authorization: Bearer $KEY" -H 'idempotency-key: 7d3e-0001' -H 'content-type: application/json' -d '{"side":"sell","resource":"bio.water","amount":100,"price":{"token":"USDC","amount":"4000000"},"ttlS":3600}'
curl -s "$API/trade/orders?state=open&pair=bio.water%2FUSDC" -H "authorization: Bearer $KEY"
curl -s -XDELETE $API/trade/orders/<orderId> -H "authorization: Bearer $KEY"
curl -s -XPUT "$API/trade/stall?as=alice" -H 'content-type: application/json' -d '{"bp":40,"planetId":"w13-dev"}'   # own stall fee (session/?as= only; keys get 403); 0..stallFeeMaxBp else 422 fee_out_of_range
curl -s "$API/trade/stall?as=alice&planetId=w13-dev"   # {planetId,hubFeeBp,minBp,maxBp,defaultBp,earned}
curl -s $API/trade/fills -H "authorization: Bearer $KEY"; curl -s $API/trade/balances -H "authorization: Bearer $KEY"
curl -sN $API/trade/stream -H "authorization: Bearer $KEY"      # SSE: hello, own order + fill events, book updates
# the owner session tunes or revokes (revoke cancels unsubmitted requests and asks the sim to cancel resting orders)
curl -s -XPATCH "$API/trade/keys/<keyId>/allowance?as=alice" -H 'content-type: application/json' -d '{"killSwitch":true}'
curl -s -XDELETE "$API/trade/keys/<keyId>?as=alice"
```

Errors are `{ "error": { "code", "message", "details?" } }` with a stable `code`: `unauthorized`, `forbidden_scope`, `key_revoked`, `rate_limited`, `server_busy`,
`idempotency_key_required`, `idempotency_key_reuse`, `wrong_planet`, `no_colony`, `order_not_found`, `order_not_open`, `invalid_request`, and the
allowance rails `kill_switch`, `pair_not_allowed`, `max_order_notional`, `max_open_orders`, `daily_budget_exceeded`, `price_out_of_band`, and `fill_policy_not_allowed`. A sim or
reservation rejection passes through as its own code (`insufficient_cargo`, `order_limit`, ...). Placement answers 201 `accepted` (the order exists,
fills included), 202 `pending` (poll `GET /orders`) or 422 `rejected`.

Hardening: every path and query id of `/v1/trade/*` and `/v1/market/*` is validated by `trade-input.guard.ts` (letters, digits and `. _ : ~ @ -`, at most 128 characters; pairs `base/quote`), else 400 `invalid_request`; unexpected errors answer 500 `internal` with a generic message and a `requestId` (the real text is only logged). Every 429 and 503 carries `Retry-After` (whole seconds) and `details.retryAfterMs`. Placements and cancels pass `InflightGate` (`inflight-gate.ts`): at most `TA_TRADE_MAX_INFLIGHT` run at once (default `floor(TA_DB_POOL_SIZE / 2) - 1`; the pool defaults to 20), others queue up to `TA_TRADE_QUEUE_WAIT_MS` (default 8000) and then get 503 `server_busy`; no request holds a database connection while it waits for its outcome (backoff poll). Stored rejections replay `error.details` as the first answer had them (`chain.trade_api_request.error_details`). A session without a colony on a planet gets 409 `no_colony`; only explicit dev identities (`?as=<name>`, `dev:<name>`) fall back to the scenario's seat 0, never in production. `GET /trade/stall` shows an accepted PUT immediately (the stored value follows via `marketHubFeeSet`).

Allowance (`chain.trade_api_allowance`, one persisted row per key): `maxOpenOrders`, `maxOrderNotional`, `dailyBudget` (quote atomic, UTC day),
`allowedPairs`, `priceBandBp` (against the organic VWAP when one exists), `killSwitch`. Outstanding and in-flight orders count before any fill. `dailyBudget` is a spend cap on exposure: orders of an earlier UTC day that still rest (or are in flight) count in full towards today's budget until they end, so the midnight reset never frees budget that resting orders still hold.
A cancel without an `Idempotency-Key` is retried as a new attempt after a REJECTED/FAILED one; a settled or in-flight one is replayed. Per owner: at most 20 active keys, 5 SSE streams per caller, and one shared rate bucket across the owner's keys.
Public `/v1/trade/*` reads (and failed key lookups) share a bounded per-IP token bucket (30 requests/s, burst 90 by default; override with `TA_TRADE_PUBLIC_RPS` / `TA_TRADE_PUBLIC_BURST`; one call is one token, `overview` included; `req.ip`, honouring `TA_TRUST_PROXY`; without it the socket address, so behind an untrusted proxy all callers share one bucket). `colonyRef` in the public order list is an HMAC keyed by `TA_COLONY_REF_SECRET` (random per process when unset in dev; in production an unset secret logs a warning and uses a random per-process one, so refs change on restart).

Organic rule (`settlement/organic.ts`): a fill is organic when both sides are `player` or `bot`, in different colonies, with different owners.
Same owner, fixture, subsidy, npc and guild are never organic; a missing owner counts as different outside production (dev scenario seats carry none) and as NOT organic in production (fail closed); the price-board limits are unchanged.

Fill policy is a property of the account, not of the order (ECONOMY section 3, NEAR-60/61): custodial = `partial`, claimed (`near_colony_account.claimed_at`) =
`all_or_nothing`. `fillPolicy` in `PlaceTradeOrderRequest` is optional; naming the other policy than the account's is `422 fill_policy_not_allowed`
(`details.allowed`). The sim command carries no policy; `PlaceOrderService` pins it on the order.

Accounts and reservations: real colony ids (`co_<cuid>`) are unique, so their mock account is named by the id. Scenario planets repeat `col_<n>` on every
planet, so `resolveColonyAccountId` names those accounts `<planet>--col_<n>` (`mockAccountStem`), and open-order counts key on (planet, colony). Funds are
reserved per chain account (`listOpenByAccount`). Dev fixtures that need an account name must go through the resolver.

Known trade-off: an `UNKNOWN` trade (ambiguous chain outcome) keeps its debit counted in flight. If the chain did apply the batch the verifier balance already
shows it and free funds are under-reported until `reconcile()` resolves the trade (<= 30 s). Telling the two cases apart needs a receipt lookup that
`IntentsPort` does not offer; guessing "applied" could over-report and allow a double spend, so the conservative figure stays.
