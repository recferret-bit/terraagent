# Backend and contracts: questions and limitations

Server side of W01 (`backend/app/src/**`: core auth and home, WS ingress, game planets and sim threads, persistence,
dev routes, progression bus) plus `shared/contracts/**`, `shared/db/**` and their tests. Ledger limits are in
[`economy-ledger.md`](./economy-ledger.md) (LED-xx) and are not repeated here. Format: [README](./README.md).

## Auth and sessions (`core/auth`)

### BE-01 · Production boots with the public default JWT secret

- **Status:** Open
- **Severity:** high
- **Confidence:** CONFIRMED
- **Area / code:** `backend/app/src/core/core.module.ts:23` (`JWT_ACCESS_SECRET` default
  `'terra-dev-jwt-secret-change-in-prod'`), `backend/app/src/core/auth/auth-token.service.ts:6,40-48` (the same literal
  again, plus a third fallback to `process.env`)
- **What happens:** with `NODE_ENV=production` and no `JWT_ACCESS_SECRET`, the app starts and signs and verifies access
  JWTs with a secret that is in the repository. Anyone can mint a token for any `sub` and use every bearer route and
  the WebSocket as that player. No check refuses the default, although `backend/app/src/ports/prod-guard.ts:28` does
  exactly that for mock adapters.
- **Why it is like this:** a development default so local runs and tests need no setup.
- **Workaround / mitigation:** none in code. The deployment must set the variable.
- **To resolve:** in the env section, refuse the default (or require the variable) when `NODE_ENV=production`, in the
  same way as `prod-guard.ts`. Keep the literal in one place only. Add `JWT_ACCESS_SECRET` to the env table in
  `docs/dev/DEV_TOOLS.md` (it is missing; CLAUDE.md requires every env var there).
- **Found:** 2026-11-01, backend/contracts review

### BE-02 · A guest whose handle is already taken becomes a memory-only player

- **Status:** Open
- **Severity:** high
- **Confidence:** CONFIRMED
- **Area / code:** `backend/app/src/core/auth/auth.repository.ts:72-95` (`createPlayer`), `:97-124` (`createSession`),
  `:187-191` (`uniqueHandle`); `shared/db/prisma/migrations/0006_core_auth_home/migration.sql` (`player_handle_key`
  unique, FK `auth_session.player_id → player`)
- **What happens:** `uniqueHandle` only checks the handles this process has seen. After a restart, or when another
  player picked the same name, `POST /v1/auth/guest {handle}` makes `prisma.player.create` fail on the unique handle.
  The bare `catch {}` drops to the in-memory store. `createSession` then fails on the FK and also drops to memory. The
  player gets a working token, `/me/home` writes a real `core.colony` row for them (the colony table has no FK), and
  everything disappears at the next restart: refresh answers 401, and the same `deviceSecret` creates a new player id,
  which leaves the old colony orphaned. Two concurrent first logins with the same `deviceSecret` hit the same path on
  `device_secret_hash`. The default handle `Colonist-<last 4 id chars>` has about 1M values, so random collisions also
  occur once there are a few thousand guests.
- **Why it is like this:** the repository was written to work without a database (see BE-03).
- **To resolve:** on P2002 for the handle, retry with a suffixed handle against the database. Never fall back to memory
  when the database is configured. Add a test: the handle already exists in the DB and the process starts fresh.
- **Found:** 2026-11-01, backend/contracts review

### BE-03 · Core repositories hide every database error behind an in-memory fallback

- **Status:** Open
- **Severity:** high
- **Confidence:** CONFIRMED
- **Area / code:** every method of `backend/app/src/core/auth/auth.repository.ts` and
  `backend/app/src/core/home/home.repository.ts` (`catch { // Fall through to in-memory store }`, e.g.
  `home.repository.ts:102,143,201,247,262,281,320,372,389`), `backend/app/src/ws/home-provider.ts:70`
- **What happens:** with Postgres configured, any error (outage, constraint violation, bad query, bug) is swallowed,
  not logged, and the operation succeeds against a process-local Map. Examples: `createColony` that fails on the unique
  `(planet_id, colony_index)` still returns a colony; `setColonyStatus('ELIMINATED')` that fails leaves the DB row
  `ACTIVE`; `revokeSessionById` (logout or refresh rotation) that fails leaves the refresh token valid in the DB. All
  of these silently disagree with the database and are lost on restart. Reads also mix sources: `findColonyByPlayerAndPlanet`
  returns `null` when the DB has no row even if memory has one (`:234-252`).
- **Why it is like this:** W00/W01 tests and the no-database dev flow run the same repositories.
- **To resolve:** choose the store once at construction (DB or memory), let DB errors propagate (they map to 500/409
  through `map-error.ts`), and log them. If a degraded mode is wanted during an outage, make it explicit and read-only.
- **Found:** 2026-11-01, backend/contracts review

### BE-04 · Refresh rotation is not atomic and has no reuse detection; sessions are never pruned

- **Status:** Open
- **Severity:** medium
- **Confidence:** PLAUSIBLE
- **Area / code:** `backend/app/src/core/auth/auth.service.ts:60-75` (`refresh`), `auth.repository.ts:26-30,142-156`
- **What happens:** `refresh` reads the session, checks `revokedAt`, then revokes and issues in separate statements.
  Two concurrent refreshes with the same cookie both pass the check and each gets a new session, so a stolen refresh
  token used at the same time as the real one is not detected. A refresh that presents an already-rotated token only
  answers 401; it does not revoke the token family. `auth_session` rows and the in-memory `sessionsById/ByHash` maps grow
  by one per refresh forever (30-day TTL, never deleted).
- **To resolve:** `UPDATE … SET revoked_at = now() WHERE id = ? AND revoked_at IS NULL` and continue only when one row
  changed. Revoke all of the player's sessions on reuse of a revoked token. Add a periodic delete of expired sessions.
- **Found:** 2026-11-01, backend/contracts review

### BE-05 · Guest sign-up and seating have no throttle; each new guest can make the server generate another planet

- **Status:** Question for the owner
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `backend/app/src/core/auth/auth.controller.ts:32-42`, `backend/app/src/core/home/home.service.ts:176-196`,
  `home.repository.ts:164-188` (`findOrCreateOpenDevPlanet`, up to 1000 indices per type)
- **What happens:** `POST /v1/auth/guest` without a `deviceSecret` creates a new player every call, with no limit. Each
  of those players can call `GET /v1/me/home`, which seats a colony; every 5 seats a new dev planet is generated and
  stays loaded in a sim thread. `findOrCreateOpenDevPlanet` walks indices from 1 and runs 2–3 queries per full planet,
  under the global seat lock, so seating gets slower as planets fill. After 1000 planets of a type it throws a plain
  `Error` (500).
- **Why it is like this:** D-25 (no anti-bot), and the dev planet family is a stand-in for matchmaking (W11).
- **To resolve:** decide whether W01 ships publicly. Recommendation: a per-IP limit on `/auth/guest` and `/me/home`,
  remember the first non-full index per type, and replace the 1000 loop with a query over seat counts.
- **Found:** 2026-11-01, backend/contracts review

### BE-06 · Auth docs describe a different cookie, claims and env vars than the code

- **Status:** Question for the owner
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `backend/app/src/core/auth/auth.service.ts:28-34`, `auth-token.service.ts:5,50-58`;
  `docs/plan/issues/TA-04-core-api-auth-and-home.md:118,127`, `docs/spec/ARCHITECTURE.md:290`
- **What happens:** the plan asks for `ta_rt` with `SameSite=None; Secure; Domain=api.…`, JWT claims
  `{sub, sid, iat, exp}` and an `Authorization: Refresh` fallback. The code sets `SameSite=Lax`, no `Domain`, `Secure`
  only in production, and claims `{sub, handle, iat, exp}` with no `sid`, so a logout cannot invalidate the access token
  or the open sockets before `exp` (15 min). ARCHITECTURE §15 lists env vars `ACCESS_JWT_TTL_M` / `REFRESH_TTL_D`; the
  TTLs are hard-coded constants. `dev:<name>` WS tokens (`backend/app/src/ws/session-verifier.ts:38-74`) have no `exp`, so
  their sockets never time out.
- **Why it is like this:** the current build serves everything from one origin (CLAUDE.md), where `Lax` works.
- **To resolve:** confirm that the single-origin cookie is the W01 target and update TA-04/ARCHITECTURE, or implement
  the cross-origin cookie and env TTLs before the split domains go live. Recommendation: update the docs now, add `sid`
  when logout must cut live sockets.
- **Found:** 2026-11-01, backend/contracts review

## WebSocket ingress

### BE-07 · Any player can join any loaded planet, and on a "scenario colony planet" a player without a colony commands colony 0

- **Status:** Open
- **Severity:** high
- **Confidence:** CONFIRMED
- **Area / code:** `backend/app/src/ws/connection.ts:230-243` (`onJoin`, comment "W00: … a later wave enforces WS-12"),
  `backend/app/src/ws/sim-command-ingress.ts:64-68` (`fallback`), `backend/app/src/game/persistence/snapshot.service.ts:134-138`,
  `backend/app/src/scenarios/scenarios.service.ts:29-31`, `backend/app/src/game/game-planets.service.ts:205-211`;
  `docs/spec/PROTOCOL.md` WS-12
- **What happens:** `join` only checks `isLoaded`, so any authenticated player can watch any planet (PROTOCOL WS-12 says
  `bye 4003` unless it is the planet of the player's own live colony). When the joined planet is marked
  `isScenarioColonyPlanet` and the player has no colony row there, the ingress makes up a `col_0` record (cast
  `as ColonyRecord`) and submits the player's commands as `colonyIndex: 0`, `source: 'player'`. Two places set the mark:
  the dev scenarios route, and `restoreOne` for every restored non-dev planet that has a live colony. That second case is
  not dev-only. A future non-dev planet (`newId('pl')`) with players would let any guest command its colony 0. Outside
  production today, any player can join a scenario planet and play colony 0.
- **Why it is like this:** the `?scenario=` flow joins with `dev:` tokens that have no colony row, and needs colony 0.
- **To resolve:** enforce WS-12 for non-dev sessions, or decide it is deferred and say so in PROTOCOL. Limit the colony 0
  fallback to dev sessions (`dev:` tokens, non-production) or to the session that created the scenario, and do not set
  the mark from `restoreOne` for planets that have colony rows.
- **Found:** 2026-11-01, backend/contracts review

### BE-08 · PROTOCOL contradicts itself on rate limits

- **Status:** Open
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `docs/spec/PROTOCOL.md:86` (WS-16 "No rate limits (D-25)"), `:279` ("There is no `rate_limited` code"),
  `:302` (§10 token bucket), §12 row 5; `backend/app/src/ws/command-rate-limit.ts`, `shared/contracts/src/errors/index.ts:9-10`
- **What happens:** WS-16 and the owner-decision table say there are no rate limits. §10, `DEV_TOOLS.md` and the code
  reject more than 20 commands/s (bursts of 40) per player as `cmd.reject rate_limited`. The limiter is per player and
  shared by all of that player's sockets and planets, although its header comment says "per socket".
- **To resolve:** update WS-16, §12 and D-25 (or record the decision in DECISIONS.md) to match the token bucket.
- **Found:** 2026-11-01, backend/contracts review

### BE-09 · Commands from a player with no in-memory colony can be applied out of order and each costs a DB query

- **Status:** Open
- **Severity:** low
- **Confidence:** PLAUSIBLE
- **Area / code:** `backend/app/src/ws/sim-command-ingress.ts:51-85` (`handle`, `resolveColony`), `ColonyLookup` `:11-17`
- **What happens:** when the in-memory colony lookup misses and the DB is on, each command waits for its own
  `findFirst` query and is submitted when that promise resolves. Queries running on different pool connections can
  finish in a different order than they were sent, so two commands can reach the planet swapped. A lookup that returns
  no colony is not cached, so every command from a spectator or a dev-only session runs a query. Players who joined
  their own planet hit the memory path (join loads the colony), so the case is mostly dev sessions. `ColonyLookup` also
  has four optional lookup paths; the `findColonyByPlayerId` / `findColonyByPlayer` branches are aliases of the same
  repository method and are never reached with the real repository.
- **To resolve:** chain the lookups per player (as `Connection` does for frames), cache a negative result for the
  socket's lifetime, and reduce `ColonyLookup` to the one method the repository provides.
- **Found:** 2026-11-01, backend/contracts review

### BE-10 · `DbHomeProvider` repeats the home mapping by hand and queries the DB a second time

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `backend/app/src/ws/home-provider.ts:23-73`, `backend/app/src/core/home/home.service.ts:51-82`
  (`toColonySummary`, `toPlanetSummary`)
- **What happens:** when `HomeService.getExistingHome` returns null, `getHome` runs its own `colony.findFirst` (ACTIVE
  only) and builds summaries by hand. They differ from the shared ones: no `colonyIndex`, `playerId`, `seed` or `radius`;
  `seats.taken ?? 1`; fallback type `'temperate'`, while `home.repository.ts:65-70` falls back to `DEV_PLANET_TYPE`. The
  `dbEnabled` expression is copied in three files (`auth.repository.ts:37`, `home.repository.ts:91`, `home-provider.ts:31`).
- **To resolve:** let `getHome` return `getExistingHome(...) ?? DEFAULT_HOME` and remove the second query. Keep the
  "is the DB on" rule in one helper.
- **Found:** 2026-11-01, backend/contracts review

## Game planets and sim threads

### BE-11 · A sim thread that dies leaves its commands and loads waiting forever, and is not restarted

- **Status:** Open
- **Severity:** high
- **Confidence:** CONFIRMED
- **Area / code:** `backend/app/src/game/game-planets.service.ts:139-149` (`submit`), `:302-311` (`error`, `stopped`),
  `backend/app/src/game/sim-thread-pool.ts:80-87`
- **What happens:** on a worker crash the pool emits `error` (with no `planetId`) and `stopped`. `stopped` removes the
  thread's planets from `loaded` and fires the unload listeners. It does not settle `cmdWaiters` or `loading`. Commands
  already submitted to that thread resolve only at process shutdown, and `SimCommandIngress` has no timeout, so the
  client gets neither `cmd.ack` nor `cmd.reject`. A `load` in flight never resolves, so a boot `restoreOne` hangs boot.
  The seat path survives only through its 15 s race. The thread is never respawned. Its planets stay gone until a
  restart, sockets in those rooms get no `bye` and no deltas, and readiness stays green while at least one thread lives.
- **To resolve:** on `stopped`, settle every waiter of that thread's planets (`thread_down`), fail its loads, and send
  `bye 4012` to the affected rooms. Then decide whether to respawn and restore from the last snapshot or fail readiness.
  Add a test that kills a worker while a command is in flight.
- **Found:** 2026-11-01, backend/contracts review

### BE-12 · A step that throws drops that step's commands without an answer, and the planet keeps running

- **Status:** Open
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `backend/app/src/game/thread/sim-thread.ts:19-23`, `backend/app/src/game/thread/planet-host.ts:131-144`
  (`stepPlanet`), `shared/sim/src/kernel/step.ts:70-80`
- **What happens:** `stepPlanet` removes the pending commands (`pending.splice(0)`) before `step()`. If a command handler
  or system throws, the thread entry catches the error, posts `error`, and the planet stays in the table. The scheduler
  steps it again on the half-mutated state. The commands of the failed step never get an outcome, so their waiters hang
  (as in BE-11). LED-09 says "hosts already treat a throwing step as fatal for that planet". On the server they do not.
- **To resolve:** on a throwing step, reject the step's commands (`internal`) and stop that planet (remove it from the
  scheduler, `bye` its room), or restore it from its last snapshot. Then correct LED-09.
- **Found:** 2026-11-01, backend/contracts review

### BE-13 · A planet event whose data fails its contract throws inside the thread message listener (dev and test)

- **Status:** Open
- **Severity:** medium
- **Confidence:** PLAUSIBLE
- **Area / code:** `backend/app/src/bus/event-bus.ts:25-28,62-66`, `backend/app/src/game/bus-bridge.ts:14-20`,
  `backend/app/src/game/game-planets.service.ts:276-281` (`tap` before `each`), `backend/app/src/game/sim-thread-pool.ts:75-79`
- **What happens:** outside production `EventBus.emit('planet.event')` throws when `data` does not match the event's
  strict zod schema. The bridge calls it from `GamePlanets.tap`, which runs before the delta goes to subscribers, inside
  the worker's `message` listener. One sim event with an extra or renamed field (all W01 event `data` are
  `z.strictObject`) drops that delta for every socket on the planet. The throw also escapes the listener, which in Node
  is an uncaught exception that can end the process. In production the check is off, so the same event passes unchecked.
- **To resolve:** catch and log in the bridge (or in `tap`) so a bad event never blocks a delta. Keep the strict check
  in the sim's own tests.
- **Found:** 2026-11-01, backend/contracts review

### BE-14 · An existing home is answered ACTIVE without checking that its planet is loaded

- **Status:** Open
- **Severity:** medium
- **Confidence:** PLAUSIBLE
- **Area / code:** `backend/app/src/core/home/home.service.ts:176-178`, `backend/app/src/game/game.module.ts:138-144`,
  `backend/app/src/game/persistence/persistence-enabled.ts:7-9`
- **What happens:** `getOrAssignHome` returns the existing colony at once and never calls `ensureLoaded`. Boot only
  generates the `GAME_DEV_PLANETS` ids. So after a restart a player whose dev planet was not restored gets `ACTIVE`, and
  their `join` closes `4003` (planet not loaded) on every retry. This happens when the DB was down at boot (nothing is
  restored or generated), and with `SNAPSHOTS=off` plus a `DATABASE_URL`: colony rows persist, snapshots do not, so
  `pl_dev_ocean*` / `pl_dev_temperate*` are never loaded and a regenerated `pl_dev` has no colony for the existing row.
  Held planets are LED-06.
- **To resolve:** in `getOrAssignHome`, ensure the home planet is loaded (restore or `loadNew`), or answer a state the
  client can act on. Tie the colony-row persistence switch to `persistenceEnabled`.
- **Found:** 2026-11-01, backend/contracts review

### BE-15 · Main-thread planet generation for spawn slots, cached by DB seed

- **Status:** Accepted (by design)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `backend/app/src/core/home/home.service.ts:291-308` (`getSpawnSlotsForPlanet`)
- **What happens:** the server builds a whole `PlanetState` on the main thread (no `worldSalt`) only to read its spawn
  slots, once per planet, and caches them by the DB row's `id:type:seed:radius:capacity`. The salt only seeds the hidden
  subsurface (`shared/sim/src/gen/world/context.ts:57`, used only by `stages/subsurface.ts`), so the slots match the sim's.
  After a dev `seed` command the sim's ground (and slots) change but the cache key does not. The sim then refuses stale
  sites, and the retry in LED-14 handles that. The generation blocks the event loop once per planet.
- **To resolve:** if it matters, ask the planet's thread for `getSpawnSlots` instead.
- **Found:** 2026-11-01, backend/contracts review

### BE-16 · Leftover main-thread protocol code

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `backend/app/src/game/game-planets.service.ts:131-136` (`unload`), `:98-113` (`load`),
  `backend/app/src/game/game.module.ts:43-48`, `:141`
- **What happens:** `GamePlanets.unload` has no caller. If one is added, the thread drops the planet's pending commands
  without a reject (same hang as BE-11). `load` with a snapshot for a planet that is already loading sends a second
  `load`; the second `loaded` re-fires the load listeners (a second ledger restore). Not reachable today. In the env
  section, the comment for `GAME_DEV_PLANETS` sits above `TA_BALANCE_OVERRIDES`, and `GAME_DEV_PLANETS` has none. Line 141
  hard-codes `radius: 56, capacity: 5` next to `DEV_PLANET_RADIUS` / `DEV_PLANET_CAPACITY` in `home.repository.ts:9-10`.
  The live-colony predicate is also copied between `scenarios.service.ts:29` and `snapshot.service.ts:136`.
- **To resolve:** remove `unload`, or make it reject pending commands. Refuse a second load. Fix the comment and use
  the constants.
- **Found:** 2026-11-01, backend/contracts review

## REST errors and dev routes

### BE-17 · Status-based REST codes give misleading `error.code` values

- **Status:** Open
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `backend/app/src/core/errors/map-error.ts:18-39` (`REST_BY_STATUS`, `restCodeFor`), `docs/spec/PROTOCOL.md:279`
- **What happens:** every 503 maps to `near_unavailable`, including the ledger's `LEDGER_UNAVAILABLE`. Every 409 without
  its own code maps to `already_queued`, including Prisma P2002 `CONFLICT`. 413 (analytics) and 429 map to
  `validation_error`. A client that switches on `error.code` as PROTOCOL §8 says reads a NEAR outage or a queue
  conflict. `errorCode` (UPPER_SNAKE) is right, but PROTOCOL's envelope does not document it.
- **To resolve:** add the domain codes to `REST_BY_ERROR_CODE` (`LEDGER_UNAVAILABLE` → `internal` or a new
  `unavailable`), make the status fallback generic (`conflict`), and document `errorCode` in PROTOCOL §8.
- **Found:** 2026-11-01, backend/contracts review

### BE-18 · Dev routes are gated four different ways, all by hand in each handler

- **Status:** Open
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `backend/app/src/game/dev-planets.controller.ts:7-9` (`assertDevOnly`), `backend/app/src/scenarios/scenarios.controller.ts:12`,
  `backend/app/src/dev/dev.controller.ts:11` (`registry.enabled`), `backend/app/src/near/infrastructure/dev/mock-chain-read.ts:8`
- **What happens:** each `/v1/dev/*` handler must remember its own `NODE_ENV === 'production'` call. A new handler that
  forgets it is public in production. Dev routes have no authentication, so outside production anyone who can reach the
  port can create scenario planets, run dev commands and read any planet's ledger. Each gate is tested, but no test
  covers "every `/v1/dev` route is 404 in production".
- **To resolve:** one Nest guard (or not mounting dev controllers at all) when `NODE_ENV=production`, plus one test that
  walks the router and asserts it.
- **Found:** 2026-11-01, backend/contracts review

### BE-19 · `/v1/me/home` is also mounted as `/v1/v1/me/home`

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED (Nest route log: `Mapped {/v1/v1/me/home, GET}`)
- **Area / code:** `backend/app/src/core/home/home.controller.ts:12` (`@Controller(['me', 'v1/me'])`), `backend/app/src/app.ts:50`
  (`setGlobalPrefix('v1')`)
- **What happens:** Nest adds the global prefix to both controller paths, so the second path is mounted as a duplicate
  route that nothing uses.
- **To resolve:** `@Controller('me')`.
- **Found:** 2026-11-01, backend/contracts review

## Database schema

### BE-20 · Core tables: no foreign keys from colonies, defaults no code produces, radius not stored

- **Status:** Accepted (by design)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/db/prisma/core.prisma`, `shared/db/prisma/migrations/0006_core_auth_home/migration.sql`,
  `0007_ledger_entry/migration.sql`, `backend/app/src/core/home/home.repository.ts:422-447`
- **What happens:** migrations 0006/0007 match `core.prisma` / `world.prisma` exactly, and `npm run gen:check` is clean.
  Things to know: `colony.player_id` and `colony.planet_id` have no FK, so orphans are possible (BE-02), and
  `wipeDevPlanet` deletes colonies by hand. `planet.state` defaults to `RECRUITING`, which no code writes (dev planets are
  `ACTIVE`). `planet.type` defaults to `temperate`, while the dev default type is desert. `radius` is not a column:
  `fromDbPlanet` puts `DEV_PLANET_RADIUS` (56) on every planet read from the DB, so a planet of another radius would be
  reported, and its slots generated, wrongly.
- **To resolve:** add the FKs and a `radius` column when non-dev planets arrive (W11).
- **Found:** 2026-11-01, backend/contracts review

## Contracts

### BE-21 · Loosened id schemas and optional-everything home variants

- **Status:** Question for the owner
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/contracts/src/rest/home.ts:5-6,39-58`, `shared/contracts/src/ws/client.ts` (`Join`),
  `shared/contracts/src/ws/server.ts` (`WelcomePlanet`, `Welcome.colonyId`)
- **What happens:** `HomePlanetId` (`/^pl_[A-Za-z0-9_-]+$/`, no length limit) is a superset of `PlanetId`, so the union is
  redundant. `HomeColonyId` accepts `co_…` and `col_…`, because server colony ids are `col_<base36>_<hex>`
  (`home.repository.ts:77-79`), not the ULID `co_` ids of `ids/`. These loose ids now validate `join` and `welcome`.
  The `ELIMINATED` / `PLANET_ENDED` home variants make every field optional, unlike PROTOCOL §8 (`recap`/`results`,
  `planets`, `newPlanetTypes` required).
- **To resolve:** decide the colony id format. Recommendation: generate colonies with `newId('co')` and go back to the
  strict `ColonyId`/`PlanetId` (dev planet ids would need their own pattern), and require the PROTOCOL fields.
- **Found:** 2026-11-01, backend/contracts review

## Progression events and bus

### BE-22 · Progression forwarder: duplicated aggregators, unused wiring API, triple emits, guessed player ids

- **Status:** Open
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `backend/app/src/game/progression-events.service.ts:33-44` (`resolvePlayer`), `:67-169`, `:253-363`,
  `:308-326` (`publish`); `backend/app/src/bus/channels.ts:90-98`
- **What happens:** `aggregateTileEvents` and `aggregateObstacleEvents` are near-identical (AGENTS.md "no copy/paste").
  `wireSimHost`, `wireGamePlanets`, `wireProgressionEvents`, `setCustomResolver` and `PROGRESSION_PLAYER_RESOLVER` are used
  only by tests. `publish` emits each batch three times (`<kind>`, `progression.<kind>`, `planet.event`). The first two
  channels are declared but have no subscriber in the app. When an event has no `playerId`, `resolvePlayer` uses the
  colony id as the player id (and `col_0` when the colony is missing), so a consumer would credit an achievement to a
  non-player id without any warning. Today the sim always sets `colonyId`/`playerId` in these events
  (`shared/sim/src/systems/terraform-basic/work.ts:31-37`), so the guess only applies to colonies without a player.
- **To resolve:** one generic count aggregator, keep only `planet.event` (or one channel), drop the unused API, and skip
  (with a log) an event whose player cannot be resolved.
- **Found:** 2026-11-01, backend/contracts review

## Tests

### BE-23 · Failure paths without tests

- **Status:** Open
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `backend/app/test/**`
- **What happens:** the unit suite (37 files, 234 tests) passes, but nothing covers: a worker dying with a command in
  flight (BE-11); a throwing step (BE-12); a bad event payload reaching the bridge (BE-13); a handle or device secret
  already in the DB on a fresh process (BE-02); any repository DB error (BE-03); concurrent refresh with one cookie
  (BE-04); `JwtSessionVerifier` refusing `dev:` tokens in production; production refusing the default JWT secret (BE-01,
  not implemented); WS-12 and the colony 0 fallback for a non-owner (BE-07); `restCodeFor` for 503/409/413/429 (BE-17);
  all `/v1/dev/*` 404 in production (BE-18). `backend/app/test/ws/rate-limit.spec.ts:30` waits a fixed `setTimeout(5)` for
  async submits (low flake risk).
- **To resolve:** add the tests with the fixes above.
- **Found:** 2026-11-01, backend/contracts review

## Cross-area findings (added by the lead)

### BE-24 · Seat path regenerates the whole planet to read its spawn slots

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `backend/app/src/core/home/home.service.ts` (`getSpawnSlotsForPlanet`, ~L291)
- **What happens:** each cache miss runs `createPlanet` on the main thread to get the slots instead of reading the loaded planet's `blobs.spawnSlots`. Slow (full world generation on the request path) and wrong if world generation changed without a `GEN_VERSION` bump or the planet was generated with other params.
- **To resolve:** ask the owning sim thread for the live `spawnSlots` (or the landing planner, see LED-14) instead of regenerating.
- **Found:** 2026-11-01, lead (cross-area finding from the world/engine, gameplay, features and cross-cutting reviews)

### BE-25 · Three different defaults for the planet generator type

- **Status:** Question for the owner
- **Severity:** low
- **Confidence:** PLAUSIBLE
- **Area / code:** `backend/app/src/game/thread/planet-host.ts:106` (`params.type ?? 'flat'`), `shared/sim/src/gen/createPlanet.ts` (defaults to temperate), `backend/app/src/game/game.module.ts` ~L140 (W01 boots dev planets as `desert` whatever the id)
- **What happens:** a load without `params.type` builds a flat planet on the thread while the same call through `createPlanet` builds temperate; dev planet ids (`pl_000…` at boot vs the `pl_dev_*` families of `/me/home?type=`) and types are decided in several places.
- **To resolve:** one exported default (`DEV_PLANET_TYPE`) used by every caller, and one place that maps dev planet id → type. Recommendation: make `type` required in `LoadMsg.params`.
- **Found:** 2026-11-01, lead (cross-area finding from the world/engine, gameplay, features and cross-cutting reviews)
