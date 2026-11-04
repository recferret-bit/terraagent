# Progression persistence and delivery

W12 owns the shared progression boundary. Producers submit `ProgressEventV1` to `FactsUpdaterService.applyProgressEvent` with a stable `eventId`, player/colony/planet identity, tick, family, metric and value. A producer retains its event ID across retry. The sim bridge hashes its event envelope; checkpoint ingress prefixes a persisted planet-incarnation UUID, so world resets cannot collide with prior receipts. Other persisted producers must supply durable IDs including incarnation and source sequence.

## Transaction and rules

`ProgressionEngine.apply` is the database path. One PostgreSQL transaction, serialized per player with a transaction-scoped advisory lock, records the input journal, updates the lifetime fact, evaluates the catalogue, inserts each newly earned tier, credits its XP ledger and player total, and inserts independent badge and notification effects. A failure rolls everything back. Replaying an event ID does not increment statistics or reward XP again; changing its payload is rejected.

`shared/contracts/src/progression/achievements.ts` is the rule catalogue: family, metric (`counter` or `max`), producer wave, thresholds, tier XP and presentation. Add tiers/thresholds there; do not add achievement-specific service branches. `event-rules.ts` maps existing source events to families and numeric fields. New source semantics still require a producer and a typed event contract; configuration cannot infer a night without a brownout or a settled trade from unrelated inputs. Profile statistics read the persisted facts, never UI counters.

`FactsStore` and the in-memory evaluator remain the isolated test/dev implementation. Database reads do not merge speculative cache writes. Administrative XP awards share the progression lock and transact the XP ledger and total together.

## Durable effects

Each unlock queues `achievement.notification` and `achievement.badge` independently. IDs are deterministic per player, achievement and consumer. `ProgressionEffects.drain(kind, handler)` claims bounded batches with a 60-second lease, records attempts/errors, retries with capped exponential backoff and acknowledges only the matching lease. A crashed worker's lease expires; a stale worker cannot acknowledge a replacement claim. Delivery is **at least once**: downstream systems must use `effect.id` as their idempotency key. Handler execution longer than the lease may overlap; external deduplication is required.

Nest lifecycle workers now deliver notifications to `core.player_notification` (the latest 50 appear in ME History) and mint badges through the selected `BadgeNftPort` after a one-hour wall-clock delay. The PostgreSQL mock adapter is wired today. Guests wait until an account is linked; failures retain the effect for retry. The deterministic effect ID is the mint `opId`, including recovery after mint succeeds but acknowledgment fails. W09 must add a separate external-push effect after subscriptions/preferences exist; it must not repurpose already-completed in-app notification effects. W23 supplies the live badge adapter and receipt reconciliation. `PROGRESSION_WORKERS=off` pauses automatic replay/delivery for maintenance or isolated HTTP tests; checkpoint inputs still persist. A Nest saga can orchestrate additional steps, but an in-memory saga alone is not a durability boundary.

## Required checks for every producer

- Unit tests for field mapping, invalid/zero values, metric semantics and wave availability.
- PostgreSQL integration tests for replay, rollback, concurrent inputs, all affected thresholds, restart and independent effect retries.
- A real producer → journal → fact → unlock → XP → effect → profile assertion, including another player's isolation and disabled producer waves.
- Never increment on order placement if the achievement counts completion/settlement. Compensation is an explicit new event, not deletion of lifetime history.
- Persist source events before acknowledging their authoritative operation. `SnapshotStore.save` commits the sim snapshot, staged progression inbox and colony stage/outcome projection in one transaction. The sim flushes open event/production windows before sending its checkpoint. A polling worker replays inbox rows until accepted. A crash before the checkpoint rolls back world changes and rewards together; facts become visible after the next checkpoint (normally within 60 seconds plus polling). Production counts whole lifetime resource units, preserving fractional carry across windows/restarts. Profile loading also evaluates saved facts for newly available/missing catalogue tiers under the same lock.

## Navigation contract

The gameplay scene has no PILOT / ME navigation. Landing and planet selection expose the profile only after session verification; every profile link opens a new browser tab. The hub has an explicit `/me.html?as=w12` mock card. Mock Dive in enters `/play.html?scenario=w12&as=w12`; real profiles use `/play.html?skip=1&colonyId=<id>`. Authenticated `/v1/me/home?colonyId=<id>` verifies ownership and active colony/planet status; unavailable destinations return 404 without creating a replacement. WebSocket join resolves the owned seat on the selected planet. Colony stages and archive outcomes are projected from explicit checkpoint state; future W08/W11 producers must supply those values.
