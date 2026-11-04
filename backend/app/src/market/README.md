# Market module (W13, F2 mock)

Server side of [W13](../../../../docs/plan/waves/W13-markets.md). Client commands reach the planet sim first (D-31): the sim
checks the Trade Hub, size, TTL and fee range and emits `marketOrderRequested` / `marketCancelRequested` / `marketHubFeeSet`;
this module acts on those events in Postgres (`chain.market_order`, `chain.intent_trade`, `chain.market_stall`) and answers
the sim with the module commands `market.reserve` / `market.release` / `market.settled`. Synchronous rejections that need
server state (verifier balances, open-order count) are registered as `CommandPrechecks` (`core/command-prechecks.ts`).

Pure rules (price compare, matching, fee/rounding, zero-sum batch) are in `@terra/sim` `systems/trade/market-*.ts`, so
the headless experiment runner uses the same code. Chain effects go through the outbox (`trade:{tradeId}`,
`market-deposit:{ref}`, `market-withdraw:{colonyId}:{seq}`) to `IntentsPort` (mock: `near/infrastructure/adapters/mock/intents*`).

| Area | Files (planned) | Issue |
|---|---|---|
| Book persistence + restart rebuild | `book/` | W13-08 |
| Place order (precheck, reserve, deposit) | `orders/place-*.ts` | W13-09 |
| Matching | `matching/` (calls the shared matcher) | W13-11 |
| Batch builder | `settlement/batch-*.ts` | W13-12 |
| Settlement + recovery | `settlement/` | W13-13, W13-14 |
| Cancel + TTL sweep | `orders/cancel-*.ts`, `orders/expiry-*.ts` | W13-15 |
| Price board | `board/` | W13-18 |
| REST + pushes | `api/` | W13-19, W13-25 |
