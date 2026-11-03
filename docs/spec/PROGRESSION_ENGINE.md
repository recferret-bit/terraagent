# Progression persistence and delivery

W12 owns the shared progression boundary. Producers submit `ProgressEventV1` to `FactsUpdaterService.applyProgressEvent` with a stable `eventId`, player/colony/planet identity, tick, family, metric and value. A producer retains its event ID across retry. The current sim bridge derives IDs from its event envelope; future persisted producers must supply their own durable IDs, including world incarnation and source sequence.

## Transaction and rules

`ProgressionEngine.apply` is the database path. One PostgreSQL transaction, serialized per player with a transaction-scoped advisory lock, records the input journal, updates the lifetime fact, evaluates the catalogue, inserts each newly earned tier, credits its XP ledger and player total, and inserts independent badge and notification effects. A failure rolls everything back. Replaying an event ID does not increment statistics or reward XP again; changing its payload is rejected.

`shared/contracts/src/progression/achievements.ts` is the rule catalogue: family, metric (`counter` or `max`), producer wave, thresholds, tier XP and presentation. Add tiers/thresholds there; do not add achievement-specific service branches. `event-rules.ts` maps existing source events to families and numeric fields. New source semantics still require a producer and a typed event contract; configuration cannot infer a night without a brownout or a settled trade from unrelated inputs. Profile statistics read the persisted facts, never UI counters.

`FactsStore` and the in-memory evaluator remain the isolated test/dev implementation. Database reads do not merge speculative cache writes. Administrative XP awards share the progression lock and transact the XP ledger and total together.

## Durable effects

Each unlock queues `achievement.notification` and `achievement.badge` independently. IDs are deterministic per player, achievement and consumer. `ProgressionEffects.drain(kind, handler)` claims bounded batches with a 60-second lease, records attempts/errors, retries with capped exponential backoff and acknowledges only the matching lease. A crashed worker's lease expires; a stale worker cannot acknowledge a replacement claim. Delivery is **at least once**: downstream systems must use `effect.id` as their idempotency key. Handler execution longer than the lease may overlap; external deduplication is required.

No external notification or NFT is sent by this change. Those consumers are future-wave work; unhandled rows remain pending rather than being silently acknowledged. W09 notifications and W23 badge adapters register scheduled consumers through Nest providers, reuse this queue and carry the effect ID through their own outbox/port. A Nest saga can orchestrate additional steps, but an in-memory saga alone is not a durability boundary.

## Required checks for every producer

- Unit tests for field mapping, invalid/zero values, metric semantics and wave availability.
- PostgreSQL integration tests for replay, rollback, concurrent inputs, all affected thresholds, restart and independent effect retries.
- A real producer → journal → fact → unlock → XP → effect → profile assertion, including another player's isolation and disabled producer waves.
- Never increment on order placement if the achievement counts completion/settlement. Compensation is an explicit new event, not deletion of lifetime history.
- Persist source events before acknowledging their authoritative operation; the existing in-process sim bridge still has a pre-commit crash window (BE-48 in the backend limitations register).

## Navigation contract

The gameplay scene has no PILOT / ME navigation. Landing and planet selection expose the profile only after session verification; every profile link opens a new browser tab. The hub has an explicit `/me.html?as=w12` mock card. Mock Dive in enters `/play.html?scenario=w12&as=w12`; real profiles use `/play.html?skip=1` and authenticated home routing. Arbitrary multi-colony selection is W11 follow-up: implement a validated colony resume contract before showing a selectable destination, do not use the dev-only `join` flow for authenticated colony resume.
