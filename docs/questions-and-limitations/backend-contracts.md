# Backend and contracts: questions and limitations

Server side of W01 (`backend/app/src/**`: core auth and home, WS ingress, game planets and sim threads, persistence,
dev routes, progression bus) plus `shared/contracts/**`, `shared/db/**` and their tests. Ledger limits are in
[`economy-ledger.md`](./economy-ledger.md) (LED-xx) and are not repeated here. Format: [README](./README.md).

## Auth and sessions (`core/auth`)

### BE-01 · Production boots with the public default JWT secret

- **Status:** Resolved (review-fix round 2026-11-01)
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
- **Fix:** the `core-app` env section refuses an absent or default `JWT_ACCESS_SECRET` under `NODE_ENV=production` (boot aborts with `EnvError`, like `prod-guard.ts`); the dev literal lives once (`DEV_JWT_SECRET` in `auth-token.service.ts`) and `AuthTokenService` has no `process.env` fallback. `JWT_ACCESS_SECRET` is in the `DEV_TOOLS.md` env table. Files: `backend/app/src/core/core.module.ts`, `core/auth/auth-token.service.ts`; tests `test/core/app.spec.ts` › "JWT secret in production (BE-01)" (production test boots elsewhere now pass a secret).

### BE-02 · A guest whose handle is already taken becomes a memory-only player

- **Status:** Resolved (review-fix round 2026-11-01)
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
- **Fix:** `AuthRepository.createPlayer` retries a taken handle (`UniqueViolation('handle')`, mapped from Prisma P2002) with a suffix against the store, up to `HANDLE_ATTEMPTS` (8); a device secret registered meanwhile returns that player; there is no memory fallback with a database (BE-03). Files: `core/auth/auth.repository.ts`, `auth.store.ts`, `prisma-auth.store.ts`; tests `test/unit/auth-hardening.spec.ts` › "handles (BE-02)", `test/core/auth.int.spec.ts` › "a handle already in the database (fresh process) gets a suffix and a real row…".

### BE-03 · Core repositories hide every database error behind an in-memory fallback

- **Status:** Resolved (review-fix round 2026-11-01)
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
- **Fix:** the store is chosen once at construction: `AuthRepository` → `PrismaAuthStore` when `databaseEnabled(env)` (new `core/persistence.ts`), else `MemoryAuthStore`; `HomeRepository` → `PrismaHomeStore` when `persistenceEnabled(env)` (BE-14), else `MemoryHomeStore`. No `catch {}` is left: errors propagate to `map-error.ts`. The home repository keeps a write-through colony cache only for the synchronous lookups (ingress, progression), never consulted after the store answered. Files: `core/auth/*.store.ts`, `core/home/home.store.ts`, `core/home/prisma-home.store.ts`, both repositories; test `test/unit/auth-hardening.spec.ts` › "database errors propagate (BE-03)".
- **Also:** `test/core/home.int.spec.ts` seats on Postgres (`PrismaHomeStore`: colony row, seat count) and, after a restart, answers the same colony on its restored planet; `Connection.resolveHome` now logs a failed home lookup instead of swallowing it.

### BE-04 · Refresh rotation is not atomic and has no reuse detection; sessions are never pruned

- **Status:** Resolved (review-fix round 2026-11-01)
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
- **Fix:** rotation revokes with `updateMany … WHERE id AND revoked_at IS NULL` and continues only when this request revoked it; a revoked/rotated token presented again (or the loser of a concurrent refresh) revokes every session of the player (401); expired sessions are deleted at most hourly from a login/refresh (`SESSION_PRUNE_EVERY_MS`). Files: `core/auth/auth.service.ts`, `auth.repository.ts`, stores; tests `test/unit/auth-hardening.spec.ts` › "refresh rotation (BE-04)" (3 tests), `test/core/auth.int.spec.ts` › "a rotated refresh token presented again revokes every session…".

### BE-05 · Guest sign-up and seating have no throttle; each new guest can make the server generate another planet

- **Status:** Resolved (review-fix round 2026-11-01)
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
- **Fix:** recommendation applied. `IpThrottleGuard` (`core/ip-throttle.guard.ts`, token bucket per route and client IP, `AUTH_RATE_PER_MIN` default 30, 429 `rate_limited`) on `POST /v1/auth/guest` and `GET /v1/me/home`; `findOrCreateOpenDevPlanet` reads the family's seat counts in one query (`listPlanets`) and creates the next index when all are full (no 1000 loop, no per-index queries). D-25 amended in `DECISIONS.md`; env var in `DEV_TOOLS.md`. Generic `TokenBucketLimiter` (`core/token-bucket.ts`) is shared with the WS command limiter. Test `test/unit/auth-hardening.spec.ts` › "answers 429 rate_limited over AUTH_RATE_PER_MIN".
- **Note:** behind a reverse proxy set `TA_TRUST_PROXY` (Express `trust proxy`, e.g. `loopback` or `1`), else every client shares the proxy's IP bucket. A wiped dev planet's index is reused (first missing index); test `test/unit/home-seat-reject.spec.ts` › "HomeRepository.findOrCreateOpenDevPlanet (BE-05)".

### BE-06 · Auth docs describe a different cookie, claims and env vars than the code

- **Status:** Resolved (review-fix round 2026-11-01)
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
- **Fix:** recommendation applied: docs updated to the single-origin W01 build (`docs/plan/issues/TA-04-core-api-auth-and-home.md` "As built in W01" note: `SameSite=Lax`, no `Domain`, claims `{sub, handle, iat, exp}`, no `sid`, TTL constants; `docs/spec/ARCHITECTURE.md` §15 row). `sid` (logout cutting live sockets) and the cross-origin cookie stay for the split domains.

## WebSocket ingress

### BE-07 · Any player can join any loaded planet, and on a "scenario colony planet" a player without a colony commands colony 0

- **Status:** Resolved (review-fix round 2026-11-01)
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
- **Fix:** `Connection.onJoin` enforces WS-12: a non-dev session joins only the planet of its own ACTIVE colony, else `bye 4003 not_your_planet`; `dev:` sessions (`VerifiedSession.dev`, never in production) may join any loaded planet. The ingress colony-0 fallback applies only to dev sessions (`CommandContext.dev`), and `SnapshotService.restore` no longer marks a restored planet that has colony rows. PROTOCOL WS-12 and DEV_TOOLS `?join=` updated. Files: `ws/connection.ts`, `ws/session-verifier.ts`, `ws/sim-command-ingress.ts`, `ws/command-ingress.ts`, `game/persistence/snapshot.service.ts`; tests `test/unit/home.spec.ts` › "resolves the seated colonyIndex…" (outsider gets `bye 4003`), `test/ws/ingress-colony.spec.ts` › "colony 0 of a scenario planet only for a dev session…", `test/game/seat-recovery.spec.ts` › "a restored planet with colony rows is not marked…".

### BE-08 · PROTOCOL contradicts itself on rate limits

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `docs/spec/PROTOCOL.md:86` (WS-16 "No rate limits (D-25)"), `:279` ("There is no `rate_limited` code"),
  `:302` (§10 token bucket), §12 row 5; `backend/app/src/ws/command-rate-limit.ts`, `shared/contracts/src/errors/index.ts:9-10`
- **What happens:** WS-16 and the owner-decision table say there are no rate limits. §10, `DEV_TOOLS.md` and the code
  reject more than 20 commands/s (bursts of 40) per player as `cmd.reject rate_limited`. The limiter is per player and
  shared by all of that player's sockets and planets, although its header comment says "per socket".
- **To resolve:** update WS-16, §12 and D-25 (or record the decision in DECISIONS.md) to match the token bucket.
- **Found:** 2026-11-01, backend/contracts review
- **Fix:** PROTOCOL WS-16, §12 row 5 and the status line now describe the per-player token bucket; D-25 has a dated amendment (crash/load limits, not anti-cheat); the limiter's header comment says per player, shared by all sockets and planets (`ws/command-rate-limit.ts`).

### BE-09 · Commands from a player with no in-memory colony can be applied out of order and each costs a DB query

- **Status:** Resolved (review-fix round 2026-11-01)
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
- **Fix:** the ingress chains each player's commands (resolve colony → submit) so they reach the planet in arrival order whatever the lookup latency; a miss is remembered in a per-socket memo (`CommandContext.memo`, reset when the socket leaves the planet); `ColonyLookup` is the one `findColonyByPlayerAndPlanet` (cache first, store on a miss); `handle` returns a promise (the rate-limit spec no longer waits a fixed 5 ms). Files: `ws/sim-command-ingress.ts`, `ws/connection.ts`; tests `test/ws/ingress-colony.spec.ts` (order, memo, failing lookup).

### BE-10 · `DbHomeProvider` repeats the home mapping by hand and queries the DB a second time

- **Status:** Resolved (review-fix round 2026-11-01)
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
- **Fix:** `DbHomeProvider.getHome` returns `HomeService.getExistingHome(...) ?? DEFAULT_HOME` (no second query, no hand-built summaries; `DEFAULT_HOME.newPlanetTypes` is `[DEV_PLANET_TYPE]` like `/me/home`); the "is the DB on" rule is `databaseEnabled` / `persistenceEnabled` in `core/persistence.ts`. Files: `ws/home-provider.ts`, `ws/ws.module.ts`; test `test/unit/ws-auth.spec.ts` (ready payload).

## Game planets and sim threads

### BE-11 · A sim thread that dies leaves its commands and loads waiting forever, and is not restarted

- **Status:** Resolved (review-fix round 2026-11-01)
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
- **Fix:** `GamePlanets` handles a dead thread (`stopped` outside shutdown) as "planet down" for every planet it owned, was loading or had commands for: waiting commands answer `thread_down`, loads and `fullState`/`tune`/`landingSite` requests fail (`ThreadRequests`), unload listeners run, `onPlanetDown`/`onThreadDown` fire. The gateway sends `bye 4012 planet_down` to the planet's sockets; `wirePlanetRecovery` restarts the thread (`SimThreadPool.restart`, at most 3 times per 10 min) and restores its planets from their latest snapshots (`SnapshotService.recover`, at most 3 per planet per 10 min); readiness fails while any thread is down. Files: `game/game-planets.service.ts`, `game/thread-requests.ts`, `game/sim-thread-pool.ts`, `game/planet-recovery.ts`, `game/game.module.ts`, `ws/ws.gateway.ts`; test `test/game/planet-down.spec.ts` › "answers in-flight commands thread_down, fails pending requests, reports its planets down, and can be restarted" (a worker killed mid-step by `fixtures/fault-module.ts`).

### BE-12 · A step that throws drops that step's commands without an answer, and the planet keeps running

- **Status:** Resolved (review-fix round 2026-11-01)
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
- **Fix:** `PlanetHost.stepPlanet` catches a throwing `step()`: the step's (and still pending) commands are rejected `internal`, the planet is dropped from the thread and the scheduler, and `planetFailed` goes to main, which treats it as down (as BE-11: room closed, journal state dropped) and restores the last snapshot on its live thread (capped). LED-09 corrected. Files: `game/thread/planet-host.ts`, `thread/sim-thread.ts`, `thread/protocol.ts`, `game/game-planets.service.ts`, `game/planet-recovery.ts`; test `test/game/planet-down.spec.ts` › "rejects the step's commands internal, drops the planet and reports it down; other planets keep running".
- **Fix (final pass 2026-11-01, `StepError`):** the failed step is now answered like `SimHost.step` does (LED-09): when `step()` throws a `StepError`, `PlanetHost.fail` first posts its `postings` (`ledger`, before `planetFailed`, because main drops the planet's journal when it hears the planet is down), then one `ack` / `reject` per `err.outcomes` (with `detail`), then `internal` only for the commands without an outcome (a handler that threw, and commands still queued); every command gets exactly one answer. The postings are journaled and dropped again by the restore (`deleteAfter(snapshotTick)`). Caveat (as for any restore): a command acked by the failed step (or by any step since the last snapshot) is lost when the planet is restored. Test `test/game/planet-down.spec.ts` › "posts the failed step's postings, answers its outcomes, rejects only the rest internal, then planetFailed" (fixture `test/game/fixtures/fault-module.ts` gained `test.armSystemThrow` + a throwing system and `test.reject`).

### BE-13 · A planet event whose data fails its contract throws inside the thread message listener (dev and test)

- **Status:** Resolved (review-fix round 2026-11-01)
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
- **Fix:** `bridgePlanetEvents` guards the forwarder and each `bus.emit`: a refused event (or forwarder error) is logged with the planet id and skipped, so it never escapes the thread message listener or blocks the delta; the bus keeps its strict check outside production. File `game/bus-bridge.ts`; test `test/game/seat-recovery.spec.ts` › "logs and skips an event the bus refuses…".

### BE-14 · An existing home is answered ACTIVE without checking that its planet is loaded

- **Status:** Resolved (review-fix round 2026-11-01)
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
- **Fix:** `getOrAssignHome` loads an ACTIVE home's planet before answering (`HomeLandingHost.ensureHomeLoaded` → `SnapshotService.loadHome`: restore from snapshot, or generate a planet without snapshots and land its live colony rows again at their recorded sites); a planet that cannot be loaded answers 503 `HOME_UNAVAILABLE`. Colony/planet rows now persist with the snapshots (`persistenceEnabled`), so `SNAPSHOTS=off` keeps them in memory. Files: `core/home/home.service.ts`, `core/home/home.repository.ts`, `game/home-landing-host.ts`, `game/persistence/snapshot.service.ts`; tests `test/unit/home-seat-reject.spec.ts` › "loads the ACTIVE home planet first, and answers 503 HOME_UNAVAILABLE…", `test/game/seat-recovery.spec.ts` › "loadHome restores…" and "lands the live colony rows again on a home planet generated fresh".

### BE-15 · Main-thread planet generation for spawn slots, cached by DB seed

- **Status:** Resolved (review-fix round 2026-11-01)
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
- **Fix:** superseded by LED-14/BE-24: seating no longer builds a planet on the main thread; the planet's own sim answers the landing site (`landingSite` thread request), so a dev `seed` regeneration is seen at once.

### BE-16 · Leftover main-thread protocol code

- **Status:** Resolved (review-fix round 2026-11-01)
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
- **Fix:** `GamePlanets.unload` removed; a second load of a planet that is loading (with a snapshot) or loaded is refused; the `GAME_DEV_PLANETS` comment fixed; boot uses `DEV_PLANET_RADIUS` (`@terra/sim`) and `DEV_PLANET_CAPACITY`; the live-colony predicate is one helper (`game/live-colony.ts`). Test `test/game/planet-down.spec.ts` › "refuses a second load of a planet that is loading or loaded (BE-16)".

## REST errors and dev routes

### BE-17 · Status-based REST codes give misleading `error.code` values

- **Status:** Resolved (review-fix round 2026-11-01)
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
- **Fix:** status fallbacks are generic (`409 conflict`, `413 payload_too_large`, `429 rate_limited`, `503 unavailable`; new codes in `REST_ERROR_CODES`), only `NEAR_*` 503s are `near_unavailable`; PROTOCOL §8 documents `errorCode` and the codes. Files: `core/errors/map-error.ts`, `shared/contracts/src/errors/index.ts`; test `test/core/errors.spec.ts` › "generic codes by status; only NEAR codes are near_unavailable (BE-17)".

### BE-18 · Dev routes are gated four different ways, all by hand in each handler

- **Status:** Resolved (review-fix round 2026-11-01)
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
- **Fix:** one `DevOnlyGuard` (`core/dev-only.guard.ts`) on every `dev*` controller (planets, ledger, scenarios, commands, chain dev, chain explorer); the per-handler checks are gone (the explorer keeps its "ChainRead is the mock" check, which is not a dev gate). Test `test/core/dev-routes.spec.ts` boots production, walks every mapped `/v1/dev` route and asserts 404 `not_found`.

### BE-19 · `/v1/me/home` is also mounted as `/v1/v1/me/home`

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED (Nest route log: `Mapped {/v1/v1/me/home, GET}`)
- **Area / code:** `backend/app/src/core/home/home.controller.ts:12` (`@Controller(['me', 'v1/me'])`), `backend/app/src/app.ts:50`
  (`setGlobalPrefix('v1')`)
- **What happens:** Nest adds the global prefix to both controller paths, so the second path is mounted as a duplicate
  route that nothing uses.
- **To resolve:** `@Controller('me')`.
- **Found:** 2026-11-01, backend/contracts review
- **Fix:** `@Controller('me')`; test `test/core/dev-routes.spec.ts` › "the home route is mounted once: /v1/v1/me/home does not exist (BE-19)".

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
- **Note (review-fix round 2026-11-01):** most conservative variant of the recommendation applied, owner question kept open: new colonies get `newId('co')` ULIDs; `HomeColonyId` still accepts legacy `col_…` rows (no DB reset) and `HomePlanetId` is one bounded pattern (`pl_` + 1..64 chars) for ULID and dev ids; `ELIMINATED` / `PLANET_ENDED` require `recap`/`results`, `planets`, `newPlanetTypes` (PROTOCOL §8). Drop the `col_` pattern after the next DB reset. Files: `shared/contracts/src/rest/home.ts`, `core/home/home.repository.ts`; test `test/unit/home.spec.ts` (colony id `co_<ULID>`).

## Progression events and bus

### BE-22 · Progression forwarder: duplicated aggregators, unused wiring API, triple emits, guessed player ids

- **Status:** Resolved (review-fix round 2026-11-01)
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
- **Fix:** one generic count aggregator (`aggregateCounts` + per-kind key table) and one event builder; each batch is published once on `planet.event` (the six `<kind>`/`progression.<kind>` channels are removed from `bus/channels.ts`); the test-only API (`wireSimHost`, `wireGamePlanets`, `wireProgressionEvents`, `setCustomResolver`, `PROGRESSION_PLAYER_RESOLVER`) is removed; the player comes from the event, the seat registration or the `HomeRepository` colony cache, never from the colony id or `col_0`, and an event without one is skipped with a warn log. Files: `backend/app/src/game/progression-events.service.ts`, `progression-achievements.ts`, `backend/app/src/bus/channels.ts`; test `progression-events.spec.ts` › "skips (with a warning) an event whose player cannot be resolved, never guessing it from the colony id" (plus exact one-emit-per-batch and batch-shape assertions).

## Tests

### BE-23 · Failure paths without tests

- **Status:** Resolved (review-fix round 2026-11-01)
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
- **Fix:** tests added: worker death and throwing step (`test/game/planet-down.spec.ts`), bad event at the bridge (`test/game/seat-recovery.spec.ts`), handle in the DB on a fresh process and reuse revocation (`test/core/auth.int.spec.ts`), repository DB errors, concurrent refresh, per-IP throttle and `dev:` tokens refused in production (`test/unit/auth-hardening.spec.ts`), production default JWT secret (`test/core/app.spec.ts`), WS-12 and the colony-0 fallback (`test/unit/home.spec.ts`, `test/ws/ingress-colony.spec.ts`), `restCodeFor` 503/409/413/429 (`test/core/errors.spec.ts`), every `/v1/dev/*` 404 in production (`test/core/dev-routes.spec.ts`); `rate-limit.spec.ts` awaits `handle` instead of `setTimeout(5)`.

## Cross-area findings (added by the lead)

### BE-24 · Seat path regenerates the whole planet to read its spawn slots

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `backend/app/src/core/home/home.service.ts` (`getSpawnSlotsForPlanet`, ~L291)
- **What happens:** each cache miss runs `createPlanet` on the main thread to get the slots instead of reading the loaded planet's `blobs.spawnSlots`. Slow (full world generation on the request path) and wrong if world generation changed without a `GEN_VERSION` bump or the planet was generated with other params.
- **To resolve:** ask the owning sim thread for the live `spawnSlots` (or the landing planner, see LED-14) instead of regenerating.
- **Found:** 2026-11-01, lead (cross-area finding from the world/engine, gameplay, features and cross-cutting reviews)
- **Fix:** seating asks the planet's own sim: `HomeService` → `HomeLandingHost.landingSite` → `GamePlanets.landingSite` → thread `landingSite` request → `nextLandingSite` on the live state with the planet's compiled data (`PlanetHost.landingSite`); `getSpawnSlotsForPlanet`, `pickSpawnSlot` and the slot cache are gone. Files: `core/home/home.service.ts`, `game/home-landing-host.ts`, `game/thread/{protocol,planet-host}.ts`; tests `test/game/seat-recovery.spec.ts` › "PlanetHost answers landingSite from the live sim (LED-14)", `test/unit/home-seat-reject.spec.ts` › "HomeService seats where the planet's sim says (LED-14)".

### BE-25 · Three different defaults for the planet generator type

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** PLAUSIBLE
- **Area / code:** `backend/app/src/game/thread/planet-host.ts:106` (`params.type ?? 'flat'`), `shared/sim/src/gen/createPlanet.ts` (defaults to temperate), `backend/app/src/game/game.module.ts` ~L140 (W01 boots dev planets as `desert` whatever the id)
- **What happens:** a load without `params.type` builds a flat planet on the thread while the same call through `createPlanet` builds temperate; dev planet ids (`pl_000…` at boot vs the `pl_dev_*` families of `/me/home?type=`) and types are decided in several places.
- **To resolve:** one exported default (`DEV_PLANET_TYPE`) used by every caller, and one place that maps dev planet id → type. Recommendation: make `type` required in `LoadMsg.params`.
- **Found:** 2026-11-01, lead (cross-area finding from the world/engine, gameplay, features and cross-cutting reviews)
- **Fix:** recommendation applied: `LoadMsg.params.type` is required whenever `params` is given; a load with neither params nor snapshot is the named W00 flat planet (`W00_PLANET_TYPE`), and boot passes it explicitly when W01 is off; seats and boot pass the planet's type (`DEV_PLANET_TYPE` default, dev id → type via `devPlanetTypeOf`). `createPlanet`'s own temperate default is the sim's (SIM-ENGINE). Files: `game/thread/protocol.ts`, `thread/planet-host.ts`, `game/game.module.ts`.

### BE-26 · A home planet with colony rows but no snapshot is regenerated and its colonies landed again

- **Status:** Accepted (by design)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `backend/app/src/game/home-landing-host.ts` (`ensureHomeLoaded`, `reland`), `game/persistence/snapshot.service.ts` (`loadHome`)
- **What happens:** when `/me/home` finds an ACTIVE colony whose planet is not loaded and has no snapshot at all (the
  server died before the planet's first snapshot, 60 s after it was generated), the planet is generated fresh and each
  ACTIVE colony row of it is landed again at its recorded site, with fresh landing cargo. Whatever happened since the
  first landing is lost; players see a new start on the same site.
- **Why it is like this:** the alternative is a home that answers 503 forever (BE-14). The world was never saved, so
  nothing better can be restored.
- **To resolve:** snapshot a planet right after its first landing.
- **Found:** 2026-11-01, backend review-fix round

### BE-27 · Seating ignored the sim's colony limit (`planet_full`)

- **Status:** Resolved (review-fix round 2026-11-01)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `backend/app/src/core/home/home.service.ts` (`seatOnPlanet`), `backend/app/src/core/home/home.repository.ts` (`findOrCreateOpenDevPlanet`, `freeColonyIndex`); sim limit `MAX_COLONIES_PER_PLANET = 8` (`shared/sim/src/systems/landing/index.ts`, GP-17)
- **What happens:** the repository offered every colony index below the planet's `capacity`, and the seat flow treated only `landing_site_taken` / `already_landed` as "try elsewhere". A planet row with `capacity` above 8 would offer index 8, the sim answers `planet_full`, and `/me/home` failed with 409 `host_unavailable` (site question) or the sim's code (landing) instead of seating the player on the next planet. Dev planets (capacity 5) never reached it.
- **Why it is like this:** `planet_full` was added to the sim (GP-17) after the seat flow was written.
- **Fix:** seats per planet are `min(capacity, MAX_COLONIES_PER_PLANET)` (`seatsOf`); `planet_full` from the landing-site question or from the landing itself marks the planet like one without a site (`NO_SITE_CODES`), the row is rolled back and the next planet of the family is tried. Tests `backend/app/test/unit/home-seat-reject.spec.ts` › "a planet the sim calls planet_full (8 colonies) is marked…", "a landing the sim refuses planet_full rolls the row back…", "never offers more colony indices than the sim lands…".
- **Found:** 2026-11-01, final cross-cutting pass (SimHost/server contract leftovers from SIM-GAMEPLAY)

## Found in the W02 review (rounds 1–2)

### BE-28 · `resourceProduced` batch windows live in sim-thread memory

- **Status:** Resolved (bcaf867; open windows flush with checkpoints, fractional carry follows lifetime counters)
- **Severity:** medium
- **Confidence:** CONFIRMED
- **Area / code:** `backend/app/src/game/thread/production-batches.ts` (`ProductionBatches`, `PRODUCTION_WINDOW_TICKS`, `windowEndAfter`), `backend/app/src/game/thread/planet-host.ts` (`production`, `collect` after each step); W02-28
- **What happens:** the Stockpile batches (one `resourceProduced {colonyId, res, amount}` per colony and resource per 60 s window) compare `production.produced` with a baseline kept in the `PlanetHost` entry, not in the snapshot. The baseline is taken when the planet is loaded:
  - restart / failover: production between the last closed window and the restored snapshot's tick is never reported (the window that was open is lost);
  - a failed step restored from the last snapshot (BE-12, planet recovery): windows already emitted after that snapshot are produced and emitted again, so a consumer counts them twice;
  - windows end on absolute tick multiples of 300 (60 s of planet time), so under warp they come faster in real time;
  - a warped step that crosses two window ends emits one combined batch for both.
- **Why it is like this:** the counters live in `PlanetState` (sim thread); the batcher was added in round 1 without a state field.
- **To resolve:** keep the open window (`windowEnd` + baseline per colony) in a blob so it is saved and restored with the snapshot, or let the consumer dedupe by `(colonyId, res, windowEnd)` (add `windowEnd` to the event). Recommendation: the blob.
- **Found:** 2026-11-03, W02 review rounds 1–2 (backend agent)

### BE-29 · `resourceProduced` has no player id; W02 progression events carry no achievement tag

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `shared/contracts/src/events/resource-produced.ts` (`playerId` optional), `production-batches.ts` (never sets it), `backend/app/src/game/progression-achievements.ts` (`PROGRESSION_ACHIEVEMENTS`: `tilePrepared`, `obstacleRemoved`, `colonyFounded` only), `backend/app/src/game/bus-bridge.ts`
- **What happens:** `resourceProduced` and `buildingCompleted` reach the bus as plain `planet.event` entries: no `playerId` on `resourceProduced` (the sim thread does not know players) and no `achievement` field on either, because neither is in `PROGRESSION_ACHIEVEMENTS`, whose forwarder resolves players and tags achievements for the W01 kinds. A consumer (W12 Stockpile) must map colony → player itself and decide which kind counts for which achievement.
- **To resolve:** add both kinds to the progression forwarder (player from the colony cache, achievement tag), or document that W12 maps them.
- **Found:** 2026-11-03, W02 review rounds 1–2 (backend agent)

### BE-30 · Event `audience: 'server'` is not enforced

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `backend/app/src/ws/rooms.ts` (`fanout`: `onDelta` sends `delta.events`, `onEvent` forwards every kind `hasEventKind` knows), `shared/contracts/src/events/{resource-produced,treasury-rejected,dev-tuned}.ts`
- **What happens:** events declared `audience: 'server'` (`resourceProduced`, `treasuryRejected`, `dev.tuned`) go to every socket on the planet like player events; every player sees every colony's production batches. The client's `WorldStore` ignores kinds it does not handle, so nothing breaks, but the client does rely on one of them: `dev.tuned` rebuilds the replica's data (`frontend/game/store/replica/tuneEvent.ts`). Filtering by audience would break live `tune` unless `dev.tuned` becomes `player`.
- **To resolve:** filter `server` events in `fanout` and change `dev.tuned` to `player` (or `dev`) in the same change.
- **Found:** 2026-11-03, W02 review rounds 1–2 (frontend / backend agents)

### BE-31 · No test runs real Extractor production into a `resourceProduced` batch

- **Status:** Open
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `backend/app/test/game/production-batches.spec.ts`
- **What happens:** the spec raises `production.produced` by hand before each step and checks the batches; the earlier spec that drove `creditResource` was deleted in round 1. Nothing checks that an Extractor or Worker Drone T1 on a running planet ends up in a batch (the flag gate `flags.includes('W02')`, the step order, the colony id).
- **To resolve:** one test that loads a `PlanetHost` with the `w02` scenario (an active Extractor), steps 300+ ticks and expects a `metals.t1` batch.
- **Found:** 2026-11-03, W02 review round 2 (backend agent)

### BE-32 · `npm run e2e -- --waves ..NN` narrows the app, with exceptions

- **Status:** Accepted (by design); the problem "`E2E_WAVES` is not consumed, no run with later waves off" is Resolved (58956ab)
- **Severity:** low
- **Confidence:** CONFIRMED
- **Area / code:** `tests/e2e/harness/stack.ts` (`appWavesFor`, `E2E_APP_WAVES`), `tests/e2e/harness/helpers.ts` (`expectedOnWaves`, `hostMode`), `scripts/dev/e2e.mjs`, `tests/e2e/w00.spec.ts` (step 5)
- **What happened:** `--waves ..NN` only selected suites; the app always ran with every wave on, so no run checked an earlier wave with later waves off.
- **Fix (round 2):** the harness boots the app with `TA_WAVES` = every wave up to the highest one selected (`appWavesFor`) and tells the suites (`E2E_APP_WAVES` → `expectedOnWaves()`; the W00 suite's flag-chip step expects that count).
- **Still true:** `E2E_REUSE=1` attaches to the running dev stack and keeps its own `TA_WAVES`; `expectedOnWaves()` then assumes every wave is on. `--host local` boots no app (sim-only suites; the W01 suite is skipped there). `--waves ..00` runs on the flat W00 dev planet and `..01` on the pure W01 server path, so a failure there can be a missing W02 piece rather than a regression.
- **Found:** 2026-11-03, W02 review rounds 1–2 (frontend agent)


## W06 Invisible Chain

These entries were BE-28..BE-40 on `wave/w06-invisible-chain`. W02 landed BE-28..BE-32 on `main` first, so the W06 entries continue at BE-33.

### BE-33 · Landed IdentityPort shapes differ from the W06 issue text (Q-01-22)

- **Status:** Question for the owner
- **Area / code:** `backend/app/src/near/application/ports/identity.port.ts`, `shared/contracts/src/rest/near-account.ts` (`namedAccountOpId`)
- **What happens:** W06-01 says the port is used unchanged. The landed `loginSocial` returns `{playerId, email, isNew}`, and `createNamedAccount` takes `{opId, name, parent?}` with no `(provider, subject)`. The issue text for W06-03 asks the adapter to return `{provider, subject, email?}`, and W06-05 asks for idempotency per `(provider, subject)`.
- **Why it is like this:** Q-01-22 has no proposed default. W06-01 forbids redefining the port, so this wave keeps the landed signatures. The HTTP `POST /v1/auth/social` still returns `{accessToken, player, accountId}` (PROTOCOL §8). Idempotency rides on `opId = named-account:{provider}:{subject}` (`namedAccountOpId`). Token verification (`{provider, subject, email?}`) stays inside the mock adapter, then the service maps it onto `SocialLoginResult`.
- **Workaround / mitigation:** callers that need "the same social subject, the same account" pass that opId. A repeat with the same opId returns the stored account. A different subject with the same display name gets the `-2` suffix.
- **To resolve:** confirm this mapping, or change `IdentityPort` (and W23's real adapter) to take `(provider, subject)` on the port itself.
- **Found:** 2026-11-02, W06-01 (open question Q-01-22; owner default was "none", so the port stays as landed)

### BE-34 · Dev KEK seals rows when NEAR_KEK is unset

- **Status:** Accepted (by design)
- **Area / code:** `backend/app/src/near/keystore/kek.ts` (`DEV_KEK`, `loadKekRing`)
- **What happens:** with `NEAR_KEK` unset, new key rows are sealed with the in-repo 32-byte `DEV_KEK` (`terraagent-dev-kek-do-not-ship!!`) at version 1. Anyone with the source can open those rows. `NODE_ENV=production` throws inside `loadKekRing` when the key is missing or equals `DEV_KEK`. Nest boot does not call `loadKekRing`, so a production process that never seals a key still starts. Colony sub-account creation (W06-08) is the first caller and passes the parsed app env; `NEAR_KEK`, `NEAR_KEK_VERSION` and `NEAR_KEK_RING` are optional on the near env section, so a missing key still boots and this rule applies when a key is sealed. `NEAR_KEK_RING` entries are not compared to `DEV_KEK`, so a rotation can still open rows sealed under the dev key. The envelope has no AAD, and `open` does not check that the seed matches `publicKey`.
- **Why it is like this:** unit tests and local play must run without a secret, and adding a required boot env would fail existing production boot tests (W06-09).
- **Workaround / mitigation:** set `NEAR_KEK` (base64 of 32 bytes) before any real deployment. Production refuses the dev key at the moment a ring is loaded.
- **To resolve:** require `NEAR_KEK` at boot when `NODE_ENV=production`, the same way as `JWT_ACCESS_SECRET` (BE-01).
- **Found:** 2026-11-02, W06-09

### BE-35 · Mock OAuth secret is a public dev default, read from process.env

- **Status:** Accepted (by design)
- **Area / code:** `backend/app/src/near/identity/mock-token.ts` (`MOCK_OAUTH_SECRET_DEFAULT`), `mock-oauth.controller.ts` (`nearAdapterFor('Identity', process.env)`)
- **What happens:** unset or empty `MOCK_OAUTH_SECRET` uses `terra-dev-mock-oauth-secret`. The Identity-adapter check reads `process.env` at request time, so a test `createApp({ source })` override of `NEAR_ADAPTER_IDENTITY` does not change it. `verifyMockToken` treats `exp` equal to the current unix second as expired. There is no HTTP verify route; a bad signature throws `NEAR_PROVIDER_REJECTED` from `verifyMockToken` (W06-03 maps that to the social login response).
- **Why it is like this:** the dev screen must sign tokens with no setup, and the route is already 404 in production (`DevOnlyGuard`).
- **Workaround / mitigation:** set `MOCK_OAUTH_SECRET` outside local dev. The page is only linked from the hub.
- **To resolve:** none for the hackathon mock. W23 replaces the provider.
- **Found:** 2026-11-02, W06-02

### BE-36 · Social subject → player is `core.social_identity` on the database path, and a process map in unit tests

- **Status:** Accepted (by design)
- **Area / code:** `backend/app/src/near/identity/social-link.ts` (`link`, `bySubject`), `backend/app/src/near/identity/social-auth.service.ts`
- **What happens:** When `databaseEnabled` is true, `POST /v1/auth/social` finds `core.social_identity` by `(provider, subject)`. A hit uses that player. A miss with a guest bearer links that player (colonies stay; no second player). A miss with no bearer creates a player, the same as before. The row is upserted with `playerId`, `provider`, `subject`, `accountId` from `createNamedAccount`, and the token email when it fits 254 characters. A restart finds the same player. When the database is off (`NODE_ENV=test` and no `DATABASE_URL`), the in-memory map remains and nothing is written to `core.social_identity`, so `social-auth.spec.ts` needs no Postgres. `isGuest` is still not a column. Guest login and refresh read the social row (`AuthRepository.findPilotAccount`) and, when one exists, answer `isGuest: false` plus top-level `accountId`. Every social login revokes that player's refresh sessions, then issues a new one.
- **Why it is like this:** W06-06 persists the link. The unit spec must keep passing with the database off, so the memory path stays.
- **Workaround / mitigation:** the database path is the one play uses. The memory path forgets the subject when the process stops; that path is tests only.
- **To resolve:** nothing for this split. A real provider is W23. `account.created` is built but not on the socket (BE-40).
- **Found:** 2026-11-02, W06-03; database path updated W06-06

### BE-37 · Receipt detail URL is rewritten only by Vite

- **Status:** Open
- **Area / code:** `frontend/vite.config.ts` (`rewriteChainTx`), `infra/nginx/hosts/devchain.conf` (`try_files` → `/dev/chain/index.html`), `backend/app/src/core/dev-only.guard.ts`
- **What happens:** `/dev/chain/tx/<hash>` serves the receipt page under Vite dev and preview. On `devchain.terraagent.fun` that path is the explorer list (`/dev/chain/index.html`), so the hash link does not open the receipt. `GET /v1/dev/chain/accounts` and `GET /v1/dev/chain/tx` also stay 404 in production when `NEAR_ALLOW_MOCK_IN_PROD=true`, because `DevOnlyGuard` hides every `/v1/dev/*` route (`backend/app/test/core/dev-routes.spec.ts` boots with that flag and expects 404).
- **Why it is like this:** W06-14 asked for the Vite rewrite and the same guard as the other explorer routes. The nginx vhost and the production 404 test were left unchanged.
- **Workaround / mitigation:** open the receipt from the Vite app (`http://127.0.0.1:5173/dev/chain/`). The API is available when `NODE_ENV` is not `production`.
- **To resolve:** add an nginx location that serves `/dev/chain/tx.html` for `/dev/chain/tx` and `/dev/chain/tx/*`, and leave `/v1` on the app proxy. Do not weaken `DevOnlyGuard` unless that production test is changed on purpose.
- **Found:** 2026-11-02, W06-14

### BE-38 · Named-account collisions skip `-1`, ignore `parent`, and do not sleep

- **Status:** Accepted (by design)
- **Area / code:** `backend/app/src/near/identity/account-allocate.ts` (`nextFreeLabel`), `backend/app/src/near/infrastructure/adapters/identity/named-account.db.ts`, `mock-identity.adapter.ts` (`createNamedAccount`)
- **What happens:** A free label is used as-is. A taken label gets `-2`, then `-3`, never `-1` (`-1` stays the reserved-name suffix from `deriveAccountName`). The search stops after 64 candidates fitted into 32 characters; the next caller gets `NEAR_NAME_TAKEN`. `parent` is not read (colony sub-accounts are W06-08). The write does not go through `MockChainBase.call`, so `MOCK_LATENCY_*`, `MOCK_FAIL_RATE`, and `near.mock.fail` do not apply to named-account creation. When `databaseEnabled` is false, nothing is inserted into `chain.mock_chain_account`. When it is true, one transaction inserts kind `named` and a `mock:` receipt; a unique clash retries the next suffix or replays the opId (at most 4 extra attempts, then `NEAR_UNAVAILABLE`).
- **Why it is like this:** W06-05 says `-1` is only for reserved labels, `parent` may be ignored, and the unit-test path must not sleep. Social login is the caller, so a 300–1500 ms mock delay would stall `POST /v1/auth/social`.
- **Workaround / mitigation:** the in-memory book and the database path share `nextFreeLabel`. Replaying an opId returns the stored account and does not consume a suffix.
- **To resolve:** W06-08 reads `parent` for colony sub-accounts. Route this write through `MockChainBase` only if named-account creation should honour the mock clock.
- **Found:** 2026-11-02, W06-05

### BE-39 · Mock fail overrides are process-wide

- **Status:** Accepted (by design)
- **Area / code:** `backend/app/src/near/infrastructure/mock/mock-controls.ts` (`mockChainControls`), `backend/app/src/near/infrastructure/dev/near-mock.command.ts` (`account.reset`, `account.upgrade`), `backend/app/src/near/identity/social-link.ts` (BE-36)
- **What happens:** `near.mock.fail` and `near.mock.latency` write one process singleton. Every mock port in that process sees the override until `reset()` or a restart. `setFail(port, 0)` forces success even when the boot `MOCK_FAIL_RATE` is 1. An unset port keeps the config the adapter was built with. Named-account creation does not read this singleton (BE-38). `account.reset` revokes sessions and deletes `core.social_identity` rows for that player. It does not delete the player or their colonies. It also does not clear the in-memory subject map, which matters only when the database is off (unit tests). With the database on, the table is the source of truth, so after a reset the next `account.upgrade` of that subject (no guest bearer) creates a new player. `account.upgrade` signs a 60-second mock token and calls `SocialAuthService.login`, which writes `social_identity` when the database is on (W06-06). The refresh token from login is dropped; only `{ playerId, accountId, accessToken }` is returned, so a refresh session row sits unused until `account.reset` or expiry.
- **Why it is like this:** W06-25 asked for one process singleton, not a second DI graph. A stored mock `opId` still returns before the fail roll; that was already the base behaviour. W06-06 made login persist the subject on the database path and left the memory map for unit tests.
- **Workaround / mitigation:** restart the app to clear overrides and, when the database is off, the subject map. Tests call `mockChainControls.reset()` in `afterEach`. `account.reset` revokes the sessions `account.upgrade` created.
- **To resolve:** nothing for the singleton. Clearing the in-memory map inside `account.reset` is unused on the database path.
- **Found:** 2026-11-02, W06-25; social row note updated W06-06

### BE-40 · `account.created` is built and not sent on the socket

- **Status:** Accepted (by design)
- **Area / code:** `backend/app/src/near/identity/social-link.ts` (`noteAccountCreated`), `backend/app/src/ws/rooms.ts` (`onEvent`), `shared/contracts/src/events/account-created.ts`
- **What happens:** The first time a `(provider, subject)` is linked, `SocialLink` parses `{ playerId, accountId, provider, subject }` with `eventDef('account.created').data` and keeps that object on the service (`lastAccountCreated`). A repeat login of the same subject does not build another one. The websocket only forwards events the sim thread emits (`rooms.ts` `onEvent`, plus the `dev.warp` push). `account.created` is not a sim event, so the client never receives it.
- **Why it is like this:** W06-06 says to write the event with the existing contract and not to invent a second protocol or fake a websocket. There is no player-audience push outside the sim path.
- **Workaround / mitigation:** `POST /v1/auth/social` already returns `accountId`. The checked payload stays in this process until restart.
- **To resolve:** when a non-sim player push exists, send this payload on that path. Do not put it on `planet.event`.
- **Found:** 2026-11-02, W06-06

### BE-41 · Relayer replay reads the caller opId from the payload

- **Status:** Accepted (by design)
- **Area / code:** `backend/app/src/near/infrastructure/adapters/relayer/mock-relayer.adapter.ts` (`startRelay`, `inflight`), `backend/app/src/near/infrastructure/mock/mock-chain.base.ts` (`findReceiptByPayload`)
- **What happens:** The receipt row's unique `op_id` stays `relayTxHash:nonce`, so a new nonce is a new row. The caller's `opId` is only in the JSON payload. `submitMetaTx` loads that field and returns the row before `runRelayed`, so a repeat in this process does not take another nonce. Two overlapping calls in one process share one in-flight promise. Two processes can both miss the row and each take a nonce; both inserts succeed because the unique column includes the nonce. The dev explorer's `opId` is that hash:nonce key. The payload still has the caller opId.
- **Why it is like this:** W06-22 says a repeated caller `opId` returns the stored receipt before the lane (the lane hands out a nonce before the attempt) and that a distinct `opId` still takes a nonce. Keeping the nonce in the unique key is what makes those two rows different.
- **Workaround / mitigation:** one Nest process. A failed attempt writes nothing, so a retry of that `opId` still goes through the lane.
- **To resolve:** put the caller `opId` in the unique column only if a second process double-submits in practice. The retry must then still be a new row when the first attempt did not commit.
- **Found:** 2026-11-02, W06-22

### BE-42 · Colony account ids shorten the player name to stay within 64 characters

- **Status:** Accepted (by design)
- **Area / code:** `backend/app/src/near/identity/colony-account-id.ts` (`fitColonyAccountId`), `backend/app/src/near/identity/colony-account-write.ts` (`ensureColonyAccounts`), `shared/contracts/src/rest/near-account.ts` (`colonyAccountId`)
- **What happens:** A colony sub-account id is `colonyAccountId(colonyId, deriveAccountName(subject))`, which is `{colonyId lowercased}.{name}.terraagent.mock`. `NearAccountId` and `chain.near_colony_account.account_id` are at most 64 characters. A `co_` ULID (29 characters) plus a short name fits (`co_01arz….test-pilot.terraagent.mock` is 57). A 32-character name does not (79). The stored id keeps the whole colony segment and cuts the name stem (a trailing `-` is removed) until the id is at most 64 and still a valid account id. A stem that would collide with an existing mock or near account id gets `-2`, `-3`, … inside the same budget. The colony id is never removed. If the colony segment alone cannot leave room for a one-character name, creation throws and no row is written. These rows are not `createNamedAccount({ parent })`. They are written beside the social link (one `near_colony_account` row and a mock row of kind `colony`). `CreateNamedAccountInput.parent` is still not read (BE-38). The identity port still has no colony list. The name stem is `deriveAccountName(subject)`, not a `-2` collision suffix that `createNamedAccount` may have put on the named account. The owner is that named account id.
- **Why it is like this:** W06-08 requires a valid account id and says not to throw away the colony id. The port signature was left unchanged.
- **Workaround / mitigation:** pilot names that fit (a `deriveAccountName` result of about 17 characters or fewer next to a `co_` ULID) are stored unchanged. `test-pilot` is one of those.
- **To resolve:** a shorter colony label (a hash) if 64 stops being enough for the colony id plus a readable name. Do not drop the colony id to make room.
- **Found:** 2026-11-02, W06-08

### BE-43 · Colony storage_deposit delegate is a JSON stub

- **Status:** Accepted (by design)
- **Area / code:** `backend/app/src/near/identity/colony-account-write.ts` (`enqueueStorageDeposit`), `backend/app/src/near/infrastructure/adapters/relayer/mock-relayer.adapter.ts` (`submitAt`, `delegateReceiptFields`)
- **What happens:** Each colony sub-account enqueues `storage-deposit:{accountId}` for `Relayer.submitMetaTx`. `signedDelegate` is the JSON text `{"action":"storage_deposit","account_id":"<colony account id>"}`, not a NEP-366 signed delegate. The mock receipt copies `action` and `account_id` onto the payload. It does not debit the relayer or credit storage on `res.terraagent.mock`. The signer is `relayer.terraagent.mock` and the receiver is `res.terraagent.mock`. The player row (`slot` `player`) is not enqueued. The receipt row's own `op_id` stays `relayTxHash:nonce` (BE-41); the caller opId is in the payload.
- **Why it is like this:** W06-12 specifies that JSON so the mock relayer pays and `/dev/chain` can show the action. A real signature and an attached deposit are not part of this issue.
- **Workaround / mitigation:** one outbox row and one mock receipt per colony account. A second submit of the same caller opId returns the stored receipt.
- **To resolve:** when the real relayer lands (W23), replace the JSON stub with a signed delegate and whatever deposit `res.*` requires. Keep the opId `storage-deposit:{colonyAccountId}`.
- **Found:** 2026-11-02, W06-12

### BE-44 · Relay outcome is polled, not pushed on the socket

- **Status:** Accepted (by design)
- **Area / code:** `backend/app/src/near/identity/relay-status.controller.ts` (`GET /v1/near/relay`), `frontend/game/features/identity/orbitStatus.ts`, `backend/app/src/ws/rooms.ts` (`onEvent`)
- **What happens:** After social login the client shows `Saving to orbit…` and polls `GET /v1/near/relay` about every 400 ms until the deposit is `settled` or `failed`. The socket still only forwards sim events and `dev.warp` (BE-40). `relay.settled` and `relay.failed` are not delivered to the browser. The outbox relay does not publish those payloads. `POST /v1/near/relay/retry` sets that player's `FAILED` rows back to `PENDING` with `nextAttemptAt` now. A `RUNNING` row keeps its lease. A `DEAD` row is `failed` in the poll and is not requeued.
- **Why it is like this:** W06-20 says not to invent a second websocket. The outbox may `bus.publish` the same payloads later, when a non-sim player push exists. Until then the HUD learns the state from the authenticated poll.
- **Workaround / mitigation:** the pilot bearer poll, and Retry. The first `failed` stops the poll. Retry watches for 20 s, including through another `failed` from an attempt that was already `RUNNING` (that row is not requeued), so a later backoff success clears the toast. A reload polls once and shows the chip or the toast only when that deposit is still pending or failed.
- **To resolve:** when a non-sim player push exists, publish `relay.settled` / `relay.failed` on that path and drop the poll. Do not put them on `planet.event`.
- **Found:** 2026-11-02, W06-20

### BE-45 · A dev scenario player gets a database colony so Save progress can attach a deposit

- **Status:** Accepted (by design)
- **Area / code:** `backend/app/src/near/identity/dev-scenario-seat.ts` (`seatDevScenarioPlayer`), `backend/app/src/ws/connection.ts` (`seatScenario`), `frontend/game/app/online/pilotBridge.ts` (`sessionToken`)
- **What happens:** `?scenario=` joins with a `dev:` token and plays colony 0 with no `core.colony` row (BE-07). Social login only enqueues the colony deposit for rows of that player, so the join writes a player and a colony at index 0 on that planet. The row id is a new `co_` id, not the sim colony id `col_0`. Save progress sends the `dev:` token as the bearer (non-production only) so the upgrade is that same player. A real guest session (JWT, home seating) is unchanged.
- **Why it is like this:** the W06 demo starts from the W01 landfall scenario. Without the row, the pilot id appears and no relayer deposit is enqueued.
- **Workaround / mitigation:** one colony row per dev player per scenario planet. A unique clash on index 0 leaves the existing row.
- **To resolve:** when scenario join seats through the same home path as a guest, drop this extra write and keep using that colony id.
- **Found:** 2026-11-02, W06-28

## W12 Player Page & Achievements

### BE-46 · Progression stores (`FactsStore`, `AchievementUnlockStore`, `XpStore`) use Postgres when `databaseEnabled` is true and in-memory maps in unit tests

- **Status:** Accepted (by design)
- **Area / code:** `backend/app/src/progression/{facts.store,achievement-unlock.store,xp.store,w12-seed.service}.ts`, `backend/app/src/profile/{colony-history.store,me-profile.service,me-achievements.service}.ts`, `shared/db/prisma/progression.prisma`
- **What happens:** `FactsStore`, `AchievementUnlockStore`, and `XpStore` persist to `core.player_fact`, `core.achievement_unlock`, `core.xp_ledger`, and `core.player_xp` (migration `0009_w12_progression`) when `PRISMA` is injected and `databaseEnabled(env)` is true, and fall back to in-memory maps when the database is off (`NODE_ENV=test` without `DATABASE_URL`). In non-production builds, `W12SeedService.ensureSeeded` automatically seeds only the explicit `pr_dev_w12` demo pilot with the W12 scenario baseline (9 earned achievements, Level 4 `1 120 / 1 500` XP, title `Surveyor`, `unlockStage = 4`, 1 active colony + 2 past colonies) unless `profile.reset` was called for that pilot in the current process.
- **Why it is like this:** The W12 unit suites (`w12-facts`, `w12-evaluator`, `w12-xp`, `w12-me-profile`, `w12-me-achievements`, `w12-dev-commands`) run without Postgres, while the dev stack and e2e suite persist progression in Postgres across restarts.
- **Workaround / mitigation:** `profile reset` in the dev console clears a pilot's Postgres and in-memory progression rows; `npm run dev:restart` after `profile reset` re-seeds the W12 baseline on the next `/me.html` or `/play.html?scenario=w12` load.
- **To resolve:** Add catch-up evaluation (`W12-04`) and the `BadgeMint` outbox worker (`W12-25`).
- **Validation note (2026-11-04):** the fixed-baseline W12 E2E suite failed on a reused demo pilot at 1,270 XP versus its expected 1,120 XP. `npm run e2e -- --waves 12` with a fresh isolated database passed all seven implemented checks (three explicit deferrals). Use the isolated run for baseline assertions; `E2E_REUSE=1` intentionally retains demo progress.
- **Found:** 2026-11-03, W12

### BE-47 · Remaining extended W12 profile work

- **Status:** Open (explicit follow-up scope)
- **Area / code:** `docs/plan/waves/W12-player-page-achievements.md`, `backend/app/src/profile/`
- **What happens:** ME History shows the latest 50 delivered achievement notifications; full multi-event, planet/type-filtered cursor history and infinite scrolling are not implemented. Rich colony telemetry, lobby queue/party embedding, milestone XP for future stage/settlement/planet-result producers, additional level cosmetics, analytics consent events, and automated viewport screenshots remain follow-ups. The browser history test is explicitly skipped, not counted as passing.
- **Why it is like this:** stage/combat/trade/lobby producers and notification preferences are not present; the complete history schema/retention and event catalogue must be integrated with those waves. A partial achievement feed is labeled accurately.
- **Workaround / mitigation:** current/past colony cards, selected-colony resume, all 60 configurable tier rules, profile catch-up, durable statistics and independent mock badge/in-app delivery are implemented and tested. Real identity reads stored creation date/account ID; absent accounts are not fabricated.
- **To resolve:** implement W12-10/11/18 with bounded cursor pagination and filters once the unified history events are defined; complete producer-dependent items in their owning waves. Preserve the current queue and catalogue. W12-04 catch-up and the mock W12-25 delivery path are now done.
- **Found:** 2026-11-03, W12; revised 2026-11-04.

### BE-48 · Sim progression ingress still precedes durable commit

- **Status:** Resolved (bcaf867)
- **Area / code:** `backend/app/src/progression/checkpoint-progression.ts`, `backend/app/src/game/persistence/snapshot-store.ts`
- **What happened:** a process crash could lose a sim input independently of its saved world state; reset worlds reused source IDs.
- **Resolution:** checkpoint, inbox and colony projection commit atomically; replay deduplicates rewards; per-planet incarnation IDs change on wipe. Open production/event windows flush before checkpoint. PostgreSQL tests cover rollback, fresh-worker replay, duplicate acknowledgment recovery and reset identity.
- **Found:** 2026-11-03, W12 fixes.

### BE-49 · Queued badge and notification consumers

- **Status:** Partially resolved; external delivery remains open
- **Area / code:** `backend/app/src/progression/effect-consumers.ts`, `docs/spec/PROGRESSION_ENGINE.md`
- **What happens:** in-app achievement notifications are persisted and shown in ME; badges mint through the selected mock port after one wall-clock hour. Guests wait for account linking. Queue leases/retries and deterministic mint IDs survive retry after external success. Web push/Telegram and real-chain badge delivery are not available yet.
- **Why it is like this:** there is no notification adapter, subscription/preferences store or deployed live badge adapter in this branch.
- **Workaround / mitigation:** independent effect rows retain failures; the PostgreSQL mock adapter proves idempotent minting. `PROGRESSION_WORKERS=off` pauses automatic workers for maintenance.
- **To resolve:** W09 adds opt-in recipients and a separate external-push effect kind (do not reuse acknowledged in-app effects); W23 registers the live badge adapter and reconciles pending receipts. Recommendation: retain this queue and effect-ID deduplication, not a second saga outbox.
- **Found:** 2026-11-03, W12 fixes; updated 2026-11-04.

### BE-50 · Live colony profile stage and multi-colony resume

- **Status:** Resolved (bcaf867); stage producers remain a future-wave dependency
- **Area / code:** `backend/app/src/game/persistence/colony-projection.ts`, `backend/app/src/core/home/home.service.ts`
- **What happened:** stage was hardcoded and Dive in could resume a different latest home.
- **Resolution:** the database stores stage; explicit sim stages/outcomes project with snapshots and settled/eliminated colonies archive idempotently. Dive in carries the colony ID; HTTP validates ownership/status and WS resolves the selected planet's seat. Foreign/missing/inactive destinations are rejected without replacement seating. Current sim colonies have no stage producer yet, so stage stays at the initial 1 until W08 supplies it; no invented progression is shown.
- **Found:** 2026-11-03, W12 fixes.

### BE-51 · Checkpoint latency and exceptional world rollback

- **Status:** Accepted (checkpoint latency); Open (corruption reconciliation)
- **Area / code:** `backend/app/src/game/persistence/snapshot-store.ts`, `backend/app/src/progression/checkpoint-progression.ts`
- **What happens:** real sim statistics appear after the next saved checkpoint, normally up to 60 seconds plus polling. A CRC failure can restore an older checkpoint while lifetime achievements from a newer committed checkpoint remain earned. A dev profile reset is not an external NFT burn or a transactional cancellation of already-running effect handlers.
- **Why it is like this:** world snapshots are the durability boundary; lifetime awards and external mints are append-only. Rewinding those needs explicit compensation policy.
- **Workaround / mitigation:** normal restart replays committed inputs exactly once; uncheckpointed world/facts roll back together. Incarnation IDs isolate intentional planet wipes. Stop workers before administrative data resets.
- **To resolve:** W09 recovery must quarantine/reconcile rollback beyond committed progression rather than automatically revoke earned badges. Recommendation: retain earned lifetime awards and record an audited recovery incident; choose compensation rules before enabling automatic rollback of external effects.
- **Found:** 2026-11-04, W12 hardening.

## W11 Planet Foundations & Sector Admission

### BE-52 · W11 hackathon (`H`) foundation scope vs deferred untagged / `H+` lobby rows

- **Status:** Accepted (by design, W11 `H` scope split)
- **Area / code:** `backend/app/src/lobby/`, `frontend/game/ui/`, `frontend/game/app/online/joinQueueFlow.ts`, [`docs/plan/waves/W11-lobby-planets.md`](../plan/waves/W11-lobby-planets.md), [`docs/plan/w27-readiness-manifest.md`](../plan/w27-readiness-manifest.md)
- **What happens:** W11 delivers all 28 `H`-tagged foundation issues (`W11-01..04, 06..08, 10..13, 15, 20, 22, 32..43, 46, 47`): the three canonical worlds (`pl_desert`, `pl_ocean`, `pl_temperate`), 7-sector small-atlas partition, widened `i16` owner, per-colony exploration bitsets, pinned immutable `AtlasManifestV1`, REST planet/sector summaries and ticket queue, atomic sector-seat reservations, idempotent spawn saga, reconciliation sweep, orbital picker sector chooser, queued boot overlay, and Global Map `Sectors` layer. The 19 untagged / `H+` rows in `W11-lobby-planets.md` (`W11-05` dynamic planet rules, `W11-09` dedicated lobby WS event stream, `W11-14` full party leader/member HTTP controller + same-planet spread, `W11-16..19` transfer carry/bonus/archive/notification hooks, `W11-21` standalone `/lobby` HTML entry, `W11-23..31` orbital drawer/queue/party/recap/stats/onboarding plates, and `W11-44..45` Prometheus lobby gauges & structured audit events) remain explicitly deferred to full W11 / W27 (`docs/plan/w27-readiness-manifest.md`). Note that `LobbyPersistenceService` already implements the underlying party store methods (`createParty`, `joinPartyByCode`, `leaveParty`, `setPartyIntent`) and transfer-carry ticket metadata so those follow-ups require no schema migration.
- **Why it is like this:** The hackathon wave scope (`tags: H`, 28 issues) focuses on the persistent canonical-world architecture, sector admission, and reusing the existing `/play.html` orbital selector rather than building a separate `/lobby` app or multi-party UI before W27.
- **Workaround / mitigation:** The orbital picker in `/play.html?planet=<kind>` polls `/v1/planets` + `/v1/planets/:id/sectors` (with optional WebSocket summary bridge) and supports `Auto (recommended)` + manual sector selection + queued retry/cancel; `docs/plan/w27-readiness-manifest.md` records all 19 deferred rows.
- **To resolve:** Implement the remaining untagged / `H+` W11 rows when full lobby party/transfer/standalone-entry scope is scheduled alongside W27.
- **Found:** 2026-11-08, W11 delivery.

### BE-53 · setAutopilot is one command; oil is not a fourth away-budget family

- **Status:** Question for the owner
- **Area / code:** `shared/contracts/src/commands/set-autopilot.ts`, `shared/contracts/src/notify/budget.ts`, CONTINUITY AW-20, PROTOCOL away commands
- **What happens:** `setAutopilot` takes `{ mode, awayRaids, awayBudget }` with integer percents per D-34 family (`metals`, `minerals`, `bio`). A percent outside 0..100 is rejected. PROTOCOL still shows `setAutopilot {aiDirector, awayRaids}` plus a separate `setAwayBudget`. Oil is not its own slider: Petroleum is `bio.t2` inside Bio.
- **Why it is like this:** W09-01 and the wave file name this shape. The grill note Q-04-12 says to use it. The owner tasks (Q5) say the away budget is player-set and do not pick the wire shape. This wave uses the wave-file shape so later issues have one command to ack.
- **Workaround / mitigation:** `autoTrade` stays out of this command. Its checker is W09-13 and its command is W15-01 `setAutoTrade`.
- **To resolve:** Confirm the single-command shape, or split `setAwayBudget` to match PROTOCOL. Confirm Bio covers oil.
- **Found:** 2026-11-09, W09-01 contract default

### BE-54 · Seal snapshot is admission pause; end snapshot follows a committed archive

- **Status:** Accepted (by design)
- **Area / code:** `backend/app/src/lobby/lifecycle.service.ts` (`pausePlanetAdmission`, `transitionWorldLifecycle`), `backend/app/src/game/persistence/snapshot.service.ts` (`capture`), `backend/app/src/game/persistence/snapshot-scheduler.ts` (`spreadOffset`)
- **What happens:** Canonical worlds never enter `SEALED` (MATCHMAKING §0). The operator action that stops new founders is admission pause, and that writes a `SEAL` snapshot when the planet is loaded. `END` is written only after the archive row commits, so a failed archive cannot make `livePlanetIds` skip the planet. A planet that is not on a sim thread has no bytes to save, so the save point is skipped. If the thread does not answer within 30 s, the unanswered kind is dropped and a later periodic snapshot is not retagged. More than 120 loaded planets can still share a snapshot second (60 seconds × 2); the host budget is 60 planets.
- **Why it is like this:** W09-05 needs `SEAL` and `END` rows on the existing snapshot store. There is no second lifecycle and no `system.seal` / `system.end` command in this tree.
- **Workaround / mitigation:** Retention still keeps the latest `SEAL` and every `END`. Periodic writes are staggered and bumped off a second that already has two planets.
- **To resolve:** If seal should be something other than admission pause (for example the moment free seats hit zero), point `setSnapshotSavePoint` at that path. Raise the per-second cap only if a host runs more than 120 planets.
- **Found:** 2026-11-09, W09-05
