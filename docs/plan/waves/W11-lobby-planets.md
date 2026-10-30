# W11 — Lobby & Planets

> **Track:** Meta (M) · **Flag:** `W11` · **Tag:** `wave-11` · **Scenario:** `scenarios/w11-lobby.ts` · **E2E:** `e2e/w11.spec.ts`
> **Depends on waves:** W01 (spine). Rocket `TRANSFER` tickets come from W21. Party spawn adjacency uses the W01 generator.
> **Specs:** [MATCHMAKING](../../spec/MATCHMAKING.md) §3–§10 (`MM-01..55`, edge cases E1–E16) · [CONTINUITY](../../spec/CONTINUITY.md) §2 (`CT-01..05`) · [CLIENT](../../spec/CLIENT.md) §3–§4 (`CL-01`, `CL-13`, `CL-14`) · [ARCHITECTURE](../../spec/ARCHITECTURE.md) §15 · D-12 (amended), D-22, D-23, D-24
> **Owned paths:** `backend/app/src/lobby/**`, `backend/app/src/game/planet-loader/`, `prisma/lobby.prisma`, `shared/contracts/src/{lobby,match}/`, `client/src/pages/lobby/`, `client/src/features/{home,party}/`

## Goal

The app becomes multi-planet and multiplayer. Players pick a planet or get matched, queue fairly, play with friends, and come back to the right place every time. Planets follow their lifecycle on their own: recruiting, sealed after 24 h or when full, ended after 14 days or when nobody is left, then archived. Many planets run across the sim threads.

## Demo story (e2e)

1. Load `?scenario=w11` (2 planets: Temperate with 3/5 seats, Desert empty warm pool) as a **new** guest → see the planet picker with the Temperate planet first (fill-first sort) and "New Desert planet".
2. Click **Join** on Temperate → the queue panel shows position and ETA → assigned → the client dives into the new colony.
3. Second guest: create a **party**, share the code; third guest joins with the code → the leader enqueues → both colonies spawn on the **same** planet, on neighbouring spawn slots.
4. Dev console `planet fill <id>` until full → the planet becomes `SEALED` in the same transaction; it disappears from the picker. A 4th guest's `JOIN_PLANET` on it falls back to `AUTO` ("That planet just filled — you've been placed on …").
5. Dev console `planet age +2h` → seat refill is off; eliminate one colony → its seat stays taken. On a 1 h old planet, eliminating frees the seat.
6. Dev console `planet age +14d` → `ENDED` → `ARCHIVED`; the player lands on the **planet results** screen (`PLANET_ENDED`) and can join again.
7. Reload the tab at any point → it routes to the same place (home state machine).
8. Set `TA_WAVES=..10` → no picker: the app falls back to the W01 behaviour of auto-joining the single dev planet.

## Hackathon slice

> Column `H`: **H** must for Nov 1–14 · **H+** stretch · **H2** real NEAR after the D10 gate · blank = after the hackathon. Plan and calendar: [`HACKATHON_CUT.md`](../HACKATHON_CUT.md), [`HACKATHON_SCHEDULE.md`](../HACKATHON_SCHEDULE.md).

- **The hackathon e2e covers demo steps:** 1, 2 (Join → assigned → the client reloads into the colony; no queue panel), 7, 8. `W11-32` tags these steps `@hack`; `npm run e2e -- --hack` runs only them, and the other steps run once their rows land.
- **Deferred:** parties (step 3), sealing and fallback (step 4), seat refill (step 5), planet end and results (step 6), the queue panel, warm pool, admin.
- **Still true:** with `TA_WAVES` below this wave the app behaves exactly as the previous wave's tag.

## Features covered

| # | Spec item | Issues |
|---|---|---|
| 1 | Lobby DTOs, ticket and party models, error codes, lobby Prisma schema | W11-01, W11-02 |
| 2 | Planet lifecycle state machine + guard table + optimistic concurrency (`MM-01..03, 10`) | W11-03 |
| 3 | Window seal 24 h, lifetime 14 d, extinct and all-settled early end, warm planets don't age (`MM-04, 07, 09`) | W11-04 |
| 4 | `ENDED → ARCHIVED`: final snapshot, `planet_result`, unload, deed update hook (`MM-08`) | W11-05 |
| 5 | Planet loading on a sharded sim thread, `placementAttempts`, `provision_failed` (`MM-44, 50`) | W11-06 |
| 6 | Multi-planet boot: load all live planets on start (`MM-51`; fast-run in W09) | W11-07 |
| 7 | Picker listing, filters, sort, hide-before-close, `newPlanet`, 2 s cache, public stats (`MM-20..24`) | W11-08 |
| 8 | Lobby WS topics `planets.changed`, `queue.position`, `match.assigned/failed` (`MM-23, 48`) | W11-09 |
| 9 | Tickets: enqueue/cancel, idempotency, one open ticket, live-colony bypass, `too_late` (`MM-30, 31, 39`, E1–E3) | W11-10 |
| 10 | Seat reservation transaction, `SKIP LOCKED`, sealing never over-commits (`MM-06, 33`) | W11-11 |
| 11 | Matchmaker loop and target selection per mode, join fallback (`MM-32, 34, 41, 42`, E4) | W11-12 |
| 12 | Spawn saga, retries, TTL, orphan reconciliation (`MM-35..38`, E6–E9) | W11-13 |
| 13 | Ticket expiry, backpressure, pause, priority, position/ETA (`MM-40, 45..48`, E11) | W11-14 |
| 14 | Warm pool + global cap `MAX_ACTIVE_PLANETS` = 60 (`MM-42, 43`, E10) | W11-15 |
| 15 | Seat refill only within 2 h on recruiting planets (`MM-05`, E12) | W11-16 |
| 16 | Parties: create, invite code, join/leave, leader leaves, `PARTY_MAX`, one ticket reserving `partySize` seats, never split (`MM-55`) | W11-17, W11-18 |
| 17 | Party spawn adjacency | W11-19 |
| 18 | `/me/home` `resolveHome` H1–H6 + recap seen (`CT-01..05`) | W11-20 |
| 19 | Client home routing on boot and reconnect (`CL-01`, `CL-13`) + recap/results modal | W11-21 |
| 20 | Picker page with polling fallback (`CL-14`) | W11-22 |
| 21 | Queue panel state machine | W11-23 |
| 22 | Party UI | W11-24 |
| 23 | Resume colony / "Dive in" shortcut | W11-25 |
| 24 | Admin queue/planet controls + audit (`MM-49`) | W11-26 |
| 25 | `TRANSFER` mode with priority 10 (consumed by W21) | W11-12 |
| 26 | Telemetry `mm_*`, `planet_load_seconds`, log events (§9) | W11-27 |
| 27 | Analytics funnel (picker → join → assigned → first stage) | W11-28 |
| 28 | Dev console: planet create/age/fill/end | W11-29 |
| 29 | Concurrency, lifecycle and saga tests; 200-player soak | W11-30, W11-31 |

## Issues

| ID | Title | Type | Size | H | Deps | Acceptance (do X → see Y) | Spec | Replaces |
|---|---|---|---|---|---|---|---|---|
| W11-01 | Contracts: `PlanetSummaryV1`, `PlanetListV1`, ticket/party DTOs, `HomeV1`, lobby WS messages, error codes (`ticket_open`, `already_has_colony`, `queue_full`, `too_late`, `party_full`), flag `W11` | contract | M | H | W00-01 | Parse the sample `PlanetListV1` → valid; a ticket with mode `JOIN_PLANET` and no `planetId` → rejected | §4, §5.1 | TA-05.2, TA-05.3 |
| W11-02 | Prisma `lobby.prisma`: `planet`, `match_ticket` (partial unique open), `colony` (partial unique live), `party`, `party_member`, `mm_settings`, `planet_result`, `admin_audit` | server | M | H | W11-01 | `npm run db:migrate` → tables exist; inserting a 2nd open ticket for one player → unique violation | DATA_MODEL, `MM-30, 31` | TA-03.1 |
| W11-03 | Server: `PlanetLifecycle.transition()` pure + guard table + optimistic `version` update | server | M | H | W11-02 | Table test: every §3.2 row passes; illegal transitions throw; two concurrent transitions → one wins | `MM-01..03, 10`, §3.2 | TA-05.1 |
| W11-04 | Server: lifecycle sweeper every 30 s (24 h window seal, 14 d end, extinct/all-settled end, warm planets never age) | server | M |  | W11-03 | Fake clock +24 h → a recruiting planet seals with `reason=window`; an empty warm planet does not | `MM-04, 07, 09` | TA-05.4 |
| W11-05 | Server: `ENDED → ARCHIVED` (final snapshot ack, `planet_result` ranks/territory/terraform/survived, unload, deed metadata hook) | server | M |  | W11-03 | End a planet → a results row per colony, the planet is unloaded from its thread, state `ARCHIVED` | `MM-08` | TA-08.5 |
| W11-06 | Server: planet loader `game.loadPlanet` on thread `hash(id) % SIM_THREADS`, 10 s timeout, 3 attempts → `provision_failed` | server | M | H+ | W11-03 | Create 6 planets → they are spread over the 3 threads; a forced load failure × 3 → `ARCHIVED` with `faultCode=provision_failed` | `MM-44, 50` | TA-05.5 |
| W11-07 | Server: multi-planet boot (load every `RECRUITING`/`SEALED`/`ENDED` planet on start; fast-run handled by W09) | server | S | H+ | W11-06 | Restart with 5 live planets → all 5 load and accept joins | `MM-51` | TA-05.5 |
| W11-08 | Server: `GET /v1/planets` (filters, sort, hide-before-close 15 min, `newPlanet` per type, 2 s cache) + `GET /v1/planets/stats` | server | M | H | W11-03 | Planet closing in 10 min → absent from the list; a full planet → absent; `newPlanet.available=false` at the cap with no warm planet | `MM-20..24` | TA-05.2 |
| W11-09 | Server: lobby WS topics (`planets.changed` coalesced ≤ 1/s, `queue.position` ≤ 1 per 2 s, `match.assigned`, `match.failed`) | server | M |  | W11-08 | Subscribe and create a planet → `planets.changed` within 1 s | `MM-23, 48` | TA-04.6 |
| W11-10 | Server: tickets `POST`/`DELETE /v1/match/tickets` (idempotent, `Idempotency-Key`, live-colony bypass, `too_late` in `SPAWNING`) | server | M | H | W11-02 | 20 concurrent POSTs → 1 ticket; POST with a live colony → `409 already_has_colony` + home | `MM-30, 31, 39`, E1–E3 | TA-05.3 |
| W11-11 | Server: seat reservation transaction (`FOR UPDATE`, seats + active reservations < capacity, `FOUNDING` colony row, TTL 90 s) | server | M | H | W11-10 | 30 concurrent tickets for 1 planet → exactly 5 seats reserved | `MM-06, 33` | TA-05.3; the W01-05 dev-seat stub stays as the fallback for `NEW` players until W11-20/21 (home routing) land, then it is removed |
| W11-12 | Server: matchmaker loop 500 ms, claims 50 with `SKIP LOCKED`, targets for `AUTO`/`JOIN_PLANET`/`NEW_PLANET`/`TRANSFER` (priority 10), join fallback | server | M | H | W11-11 | Join a planet that just filled → assigned to another planet of the same type with `fallbackFromPlanetId` set | `MM-32, 34, 41, 42`, E4 | TA-05.4 |
| W11-13 | Server: spawn saga (`game.spawnColony` idempotent by `colonyId`, 3 retries in TTL, re-queue with original `createdAt`, `FAILED`, orphan retire) | server | M | H | W11-12 | Fake game module times out twice then succeeds → assigned; a late success after TTL → the colony is retired as an orphan | `MM-35..38`, E6–E9 | TA-05.3, TA-05.4 |
| W11-14 | Server: queue controls (15 min expiry, `queue_full` at 1 000 + `Retry-After`, pause, priority −10..100, position, EWMA ETA) | server | M |  | W11-12 | Pause the queue → no assignments, ETA `null`, no expiry; resume → assignments continue in priority order | `MM-40, 45..48`, E11 | TA-05.6 |
| W11-15 | Server: warm pool (`WARM_POOL_PER_TYPE` = 1, trim > 1 h) + `MAX_ACTIVE_PLANETS` = 60 cap + `mm_capacity_blocked_total` | server | S |  | W11-12 | Assign the warm Desert planet → a new warm Desert planet is created within 1 s; at the cap → the ticket waits and the counter increases | `MM-42, 43`, E10 | TA-05.4 |
| W11-16 | Server: 2 h seat refill on recruiting planets (eliminated colony stops counting in the same transaction) | server | S |  | W11-11 | Eliminate a colony on a 1 h old planet → `seatsTaken` drops; on a 3 h old planet → unchanged | `MM-05`, E12 | TA-05.7 |
| W11-17 | Server: parties (create, invite code, join/leave, leader leaves → next member leads, `PARTY_MAX` = 5, `party_full`) | server | M |  | W11-02 | Create a party and join with the code twice → 3 members; a 6th join → `409 party_full` | `MM-55` | TA-05.7 |
| W11-18 | Server: party ticket (one ticket, `partySize` seats reserved atomically, never split, per-member spawn and per-member seat release) | server | M |  | W11-17, W11-11 | Party of 3 on a planet with 2 free seats → never placed there; a planet with 3 free → all 3 spawn on it | `MM-55` | TA-05.7 |
| W11-19 | Sim + generator: party spawn adjacency (pick neighbouring spawn slots for party members) | sim | S |  | W11-18 | A party of 2 → spawn slots are each other's nearest free slots | `MM-55` (follow-up) | TA-05.7 |
| W11-20 | Server: `GET /v1/me/home` `resolveHome` (H1–H6) + `POST /v1/me/recap/seen` + `GET /v1/me/colonies/:id/recap` | server | M | H+ | W11-10 | Table test for H1–H6; a guest with an eliminated last colony → `ELIMINATED` with the recap; p95 ≤ 80 ms | `CT-01..05` | TA-04.4 |
| W11-21 | Client: home routing on boot and every reconnect (`NEW`/`QUEUED`/`ACTIVE`/`ELIMINATED`/`PLANET_ENDED`), recap and results modal first if unseen | client | M | H+ | W11-20 | Reload while queued → the picker with the queue panel; reload while active → straight into the colony | `CT-01`, `CL-01`, `CL-13` | TA-11.3 |
| W11-22 | Client: planet picker page (type tabs, cards: seats, timers, colonies, Join; "New planet" per type; polling fallback every 10 s). Join posts a ticket, then polls `/me/home` every 2 s until `ACTIVE` and reloads into the colony (the W11-23 queue panel replaces the polling) | client | M | H | W11-08, W11-10 | Open `/planets` with the lobby WS blocked → the list still refreshes every 10 s | `MM-20..24`, `CL-14` | TA-11.2 |
| W11-23 | Client: queue panel state machine (position, ETA, cancel, paused banner, fallback notice, failed/timeout retry) | client | M |  | W11-14 | Enqueue while paused → "Queue paused" with no ETA; resume → position counts down → dive in | §5, CLIENT §4.2 | TA-11.2 |
| W11-24 | Client: party UI (create, share code/link, join by code, member list, leader badge, leave) | client | M |  | W11-17 | Create a party → the code is shown and copyable; a 2nd browser joins with it → both lists show 2 members | `MM-55` | TA-05.7 |
| W11-25 | Client: "Resume colony" / "Dive in" shortcut on the picker and landing | client | S |  | W11-21 | With a live colony, open `/planets` → a "Dive in" plate at the top that opens the colony | `CT-01` | TA-11.3 |
| W11-26 | Server: admin endpoints (list/inspect queue, pause/resume, priority, cancel ticket, force-seal/end, create warm planet, unfault) + `admin_audit` | server | M |  | W11-14 | Call force-seal → the planet is `SEALED` with `reason=admin` and an audit row exists | `MM-49` | TA-04.7 |
| W11-27 | Telemetry: `mm_*`, `planet_load_seconds`, structured logs `mm.ticket.*`, `planet.transition` | ops | S |  | W11-13 | `curl /metrics` after the demo → every `mm_*` metric from §9 is present | §9 | TA-13.2 |
| W11-28 | Analytics: `picker_viewed`, `join_clicked{mode}`, `queue_entered`, `match_assigned{waitS}`, `party_created`, `party_joined` | client | S |  | W11-22 | Join with consent on → `join_clicked` then `match_assigned` rows | CLIENT §10.3 | — |
| W11-29 | Dev console: `planet create <type>`, `planet age <+dur>`, `planet fill <id>`, `planet end <id>`, `colony eliminate` | client | S |  | W11-03 | `planet age +24h` → the planet seals on the next sweep | PRODUCT_WAVES §3 | — |
| W11-30 | Test: lifecycle guard table, seat concurrency (30 → 5), join fallback, spawn saga with a fake game module, warm pool, cap | test | M |  | W11-15 | `npm run test:int lobby` → green | §10 | TA-05.1–05.6 |
| W11-31 | Test: matchmaking soak with 200 synthetic players (no planet > 5, no join into a sealed planet) | test | M |  | W11-18 | `npm run soak:mm -- --players 200` → the report shows 0 violations | §10 end-to-end | TA-13.6 |
| W11-32 | Wave e2e + seed scenario `w11-lobby` + tag `wave-11` | test | M | H | all W11 | `npm run e2e -- --waves ..11` → the demo story passes, and every earlier suite passes | PRODUCT_WAVES §3 | — |

## Wave DoD

- `e2e/w11.spec.ts` passes, together with all earlier suites.
- `?scenario=w11` loads the 2-planet lobby.
- `TA_WAVES=..10` falls back to the single dev planet auto-join.
- Tag `wave-11` is created.
- Every `MM-*` rule, edge cases E1–E16 and `CT-01..05` map to issues above. E15–E16 are covered by W11-03 (`capacity` copied at creation) and W09-06 (sim-version restore).
