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

### BE-68 · setAutopilot is one command; oil is not a fourth away-budget family

- **Status:** Question for the owner
- **Area / code:** `shared/contracts/src/commands/set-autopilot.ts`, `shared/contracts/src/notify/budget.ts`, CONTINUITY AW-20, PROTOCOL away commands
- **What happens:** `setAutopilot` takes `{ mode, awayRaids, awayBudget }` with integer percents per D-34 family (`metals`, `minerals`, `bio`). A percent outside 0..100 is rejected. PROTOCOL still shows `setAutopilot {aiDirector, awayRaids}` plus a separate `setAwayBudget`. Oil is not its own slider: Petroleum is `bio.t2` inside Bio.
- **Why it is like this:** W09-01 and the wave file name this shape. The grill note Q-04-12 says to use it. The owner tasks (Q5) say the away budget is player-set and do not pick the wire shape. This wave uses the wave-file shape so later issues have one command to ack.
- **Workaround / mitigation:** `autoTrade` stays out of this command. Its checker is W09-13 and its command is W15-01 `setAutoTrade`.
- **To resolve:** Confirm the single-command shape, or split `setAwayBudget` to match PROTOCOL. Confirm Bio covers oil.
- **Found:** 2026-11-09, W09-01 contract default

## W09 Offline notifications

### BE-54 · Mock notify is silent only while a socket is held; live push is not registered

- **Status:** Accepted (by design)
- **Area / code:** `backend/app/src/notify/mock-notifier.ts`, `backend/app/src/notify/presence.ts`, `backend/app/src/ws/connection.ts` (`holdColony`), `GET /v1/dev/notify`
- **What happens:** `NOTIFY_ADAPTER=mock` (the default) inserts one `core.mock_notify` row per `(colonyId, eventId, channel)`. A second send returns that row's id with `status: sent` and does not change title or body. While the colony has a playing `/ws` socket, `send` returns `{ id: 'skipped', status: 'skipped' }` and writes nothing. `skipped` is not a row id. The socket set is an in-memory refcount, cleared on process restart and not the 60s away timer. A dev socket that joined without owning the colony (`colonyId` null) does not suppress rows. `NOTIFY_ADAPTER=webpush`, `telegram` or `live` still selects `live`, and boot fails because no live adapter is registered. Rows are listed at `GET /v1/dev/notify`, not on the chain outbox page.
- **Why it is like this:** W09-20 is the Postgres mock and the connected gate. Web Push and Telegram are W09-22/24. The 60s away timer is a separate tracker (W09-02, BE-55). The chain outbox viewer is chain receipts, so a notify section there would mix two products.
- **Workaround / mitigation:** Leave `NOTIFY_ADAPTER` unset or set it to `mock`. Read `GET /v1/dev/notify?colonyId=`. A repeat of the same event id is one row.
- **To resolve:** W09-22/24 should register the `live` adapter. Until then, do not set `NOTIFY_ADAPTER` to `webpush`, `telegram` or `live`.
- **Found:** 2026-11-09, W09-20

### BE-55 · Presence away memory does not survive a process restart

- **Status:** Accepted (W09-02 scope; restart recovery is a later issue)
- **Area / code:** `backend/app/src/game/presence/tracker.ts`, `shared/sim/src/systems/presence/`
- **What happens:** sockets and the 60s away timer live in process memory. A blip under 60s posts nothing. At 60s (inclusive) the tracker posts `system.presence { away: true }` and stamps `last_seen_at`. A later join posts `away: false`. After a restart those timers and the "already away" bit are gone. The sim blob in a snapshot still says away, so the colony stays away (CT-14), but the new process does not post `away: false` on reconnect because it does not remember the away. A colony that was connected when the process died is not put on a fresh 60s timer either. `colonyBack.awayForS` is omitted: the sim has no wall clock. `submit` results other than a thrown error (`wave_disabled`, `planet_not_loaded`, `thread_down`) do not fail the socket; `last_seen_at` is still written when the row exists. `wave_disabled` is ignored on purpose when flag `W09` is off. A `leave` that keeps the socket open does not start the timer; only the last socket's close does (CT-10).
- **Why it is like this:** D-24 keeps presence in the one app, with no NATS and no leases. W09-02 posts the command and stamps `last_seen_at`. Snapshot resume is a later issue under `backend/app/src/game/{snapshot,restart}/`.
- **Workaround / mitigation:** `last_seen_at` is durable. The away flag already stored in the sim snapshot is left as it was. Flag-off still records presence on the platform rows.
- **To resolve:** on boot, or on the first join, read the `presence` blob and post `away: false` only when it says away. Arm away timers for restored colonies that have no socket.
- **Found:** 2026-11-09, W09-02

### BE-56 · Seal snapshot is admission pause; end snapshot follows a committed archive

- **Status:** Accepted (by design)
- **Area / code:** `backend/app/src/lobby/lifecycle.service.ts` (`pausePlanetAdmission`, `transitionWorldLifecycle`), `backend/app/src/game/persistence/snapshot.service.ts` (`capture`), `backend/app/src/game/persistence/snapshot-scheduler.ts` (`spreadOffset`)
- **What happens:** Canonical worlds never enter `SEALED` (MATCHMAKING §0). The operator action that stops new founders is admission pause, and that writes a `SEAL` snapshot when the planet is loaded. `END` is written only after the archive row commits, so a failed archive cannot make `livePlanetIds` skip the planet. A planet that is not on a sim thread has no bytes to save, so the save point is skipped. If the thread does not answer within 30 s, the unanswered kind is dropped and a later periodic snapshot is not retagged. More than 120 loaded planets can still share a snapshot second (60 seconds × 2); the host budget is 60 planets.
- **Why it is like this:** W09-05 needs `SEAL` and `END` rows on the existing snapshot store. There is no second lifecycle and no `system.seal` / `system.end` command in this tree.
- **Workaround / mitigation:** Retention still keeps the latest `SEAL` and every `END`. Periodic writes are staggered and bumped off a second that already has two planets.
- **To resolve:** If seal should be something other than admission pause (for example the moment free seats hit zero), point `setSnapshotSavePoint` at that path. Raise the per-second cap only if a host runs more than 120 planets.
- **Found:** 2026-11-09, W09-05

### BE-57 · A planet nobody has joined still steps at 5 TPS

- **Status:** Accepted (W09-03 switches on socket crossings, not on load)
- **Area / code:** `backend/app/src/game/presence/planet-mode.ts` (`syncPlanetMode`), `backend/app/src/game/thread/sim-thread.ts` (`scheduler.add`), `shared/sim/src/host/scheduler.ts` (`setMode`)
- **What happens:** a loaded planet starts `active` (`dt` 1 every 200 ms). Coarse (`dt` 5 every 1 s) starts only when its socket count falls from ≥1 to 0. A dev planet or a restored planet that no socket has joined keeps 5 TPS, so `ta_game_planet_mode{mode="active"}` counts it. The first join sends `active` again and does not move `nextDueMs`. A join onto a coarse planet waits for the step already scheduled (at most one coarse interval) and that step uses `dt` 1. The 60 s away timer does not change the mode.
- **Why it is like this:** W09-03 follows sockets at `presence.join` / `presence.close`. Sending coarse on every load would change the W00 lag check: a 2 s stall of a coarse planet is about 2 steps behind, not ≥4. `setMode` leaves the due time so a second join cannot burst catch-up steps.
- **Workaround / mitigation:** the last socket to leave still switches that planet within the stepping loop. Empty-from-boot planets stay on the active cadence until someone joins and later leaves. A restart fast-run (W09-06) steps the gap with coarse `dt` before the planet is scheduled, then `scheduler.add` leaves it `active`.
- **To resolve:** after `loaded`, if `socketsOn` is 0, send coarse, and retune the lag check for that cadence. The restart fast-run already steps the gap coarse and then schedules `active` (W09-06).
- **Found:** 2026-11-09, W09-03

### BE-58 · Alert kind toggles do not survive a process restart

- **Status:** Accepted (W09-21 scope)
- **Area / code:** `backend/app/src/notify/alert-policy.ts` (`AlertToggles`, `UnderAttackWindow`), `backend/app/src/notify/alert-router.ts`
- **What happens:** Per-colony notification toggles live in process memory and default to on. Turning `trade_offer` off stops that kind until the process restarts, which turns every kind back on. The `under_attack` 10-minute mark is the same memory, so a restart can send another `under_attack` immediately. A failed `send` still consumes that window. The router does not read `core.notification_subscription`: it asks `NotifierPort` for one `webpush` payload whose `to` is the colony id (no push endpoint and no Telegram chat). An event that only carries a numeric colony index (today `energyCollapse`) is ignored, because that index is not a colony id.
- **Why it is like this:** W09-21 routes and debounces. Durable toggles and real channel endpoints are W09-22/24/25. The subscription table already has a `kinds` json column. The router must not write notify rows itself.
- **Workaround / mitigation:** Defaults are all on, which matches CT-36. The mock still records a row per send, and it writes nothing while the colony's socket is held.
- **To resolve:** Load `notification_subscription.kinds` plus the endpoint or chat id when sending. Persist the debounce mark, or leave restart dedupe to W09-27. Put a string colony id on `energyCollapse`.
- **Found:** 2026-11-09, W09-21

### BE-59 · Away digest baseline has no building inventory or terraform percent

- **Status:** Accepted (W09-15 scope)
- **Area / code:** `backend/app/src/game/digest/` (`baselineFromState`, `AwayDigestService`), `shared/contracts/src/notify/digest.ts` (`AwayDigestV1`)
- **What happens:** A row opens on `colonyAway` and closes on `colonyBack`, the presence tracker's return (`away: false`), or the join welcome, with `durationS` and `closed_at`. The body stores resources (the 10 stock keys), energy (`colony.power.net`, E/s), robot count (live worker, recon, demoTank, demoArtillery) and owned tiles. The start numbers come from `fullState` at open, or from the snapshot bytes on the next successful snapshot flush when that read missed. Until a read lands they stay 0, including a colony that truly has nothing. `built` stays empty: it is the while-away construction list, not a baseline inventory. Terraform percent has no field on `AwayDigestV1`, so it is not stored. `colonyBack` and presence return do not read stock again (the live reader waits up to 750 ms). The join welcome stamps `after` on resources, energy, robots and territory from the snapshot bytes it already loaded, then copies that one digest onto `welcome.away` and marks every closed unseen row seen. If those bytes cannot be read, or the colony is not in them, `before` stays equal to `after`. `/me/home` reads the newest unseen row (open or closed) by `(colony_id, opened_at)` and omits `awaySummary` if that read exceeds 250 ms. It does not mark the row seen. An open row's headline `durationS` is `now - opened_at`; its `resourcesNet` stays empty until `after` is stamped, so a home call before the welcome reports a zero net. An away while the planet is not loaded does not open a row, because open waits for `colonyAway`. `raidStarted` and `underAttack` increment `attacks.count`; `raidRepelled` increments `attacks.repelled`. Each appends one `byColony` item. The 21st list item is dropped; counts are not capped. Purge deletes `opened_at` strictly older than 7 days. A row opened exactly 7 days ago is kept. Older unseen digests merge into the newest on open and on close (sums, then lists capped at 20) and are marked seen. Two already-closed unseen rows that were never merged are not merged again on welcome: only the latest body is attached, and the older row is marked seen.
- **Why it is like this:** `AwayDigestV1` is a strict object. Building counts and terraform percent from CT-30 do not fit a field without overloading `built` or breaking the contract. The sim state is on a worker thread, so the open path cannot read it inline. A second `fullState` on the welcome path would wait up to 750 ms and can miss the home budget, so the end baseline reuses the snapshot welcome already has.
- **Workaround / mitigation:** The next snapshot fill replaces an all-zero start baseline. Attack counts survive a restart because the body is flushed in the same write as the snapshot. The welcome still carries `before === after` when the snapshot bytes do not name the colony.
- **To resolve:** A schema addition is still needed before terraform percent or per-type building counts can be stored. Home net resources stay zero when `/me/home` runs before the welcome stamps `after`.
- **Found:** 2026-11-09, W09-15

### BE-60 · Restart fast-run drops a short gap and emits events while it steps

- **Status:** Accepted (short gap and crash replay remain; notification hold landed in W09-27)
- **Area / code:** `backend/app/src/game/restart/` (`missedRestartTicks`, `runCoarseCatchUp`), `backend/app/src/game/thread/sim-thread.ts` (`finishCatchUp`), `backend/app/src/game/persistence/snapshot.service.ts` (`restore`), `backend/app/src/notify/alert-router.ts` (`flushFastRun`)
- **What happens:** The missed time is `now − savedAt` at 5 active ticks per wall second (`TICK_MS` 200), capped at `RESTART_FASTRUN_MAX_H` (24). The fast-run steps `dt` 5, so a remainder under 5 ticks is not simulated. Sim events are still posted as the loop runs, so digest and other bus subscribers see them immediately. Notification sends for that planet are held until `fastRan`, then flushed once per colony and kind (CT-54). After the run the planet is scheduled `active` (BE-57), not left coarse. A periodic snapshot is requested when the run finishes so the next boot's gap is ~0. A crash before that snapshot is stored reloads the previous snapshot and runs the gap again; the lost in-memory run is not applied on top. A run that stops before `fastRan` drops its buffer (BE-62).
- **Why it is like this:** Coarse steps are the continuity rule (CT-51). Notifications wait for `fastRan` so a catch-up that spans hours does not page the player once per raid while the process is still booting. Socket mode stays the W09-03 rule. The follow-up snapshot is what stops a second boot from repeating the catch-up.
- **Workaround / mitigation:** Gaps shorter than one coarse step catch up on a later boot once they reach 5 ticks. `AlertRouter` is the notification dedupe. Other bus subscribers still see each sim event as it is posted.
- **To resolve:** No change is needed for the 24 h cap or the coarse remainder. Notification flush is W09-27.
- **Found:** 2026-11-09, W09-06

### BE-61 · Twisters sample once per step, so coarse dt is not five fine ticks

- **Status:** Open
- **Area / code:** `shared/sim/src/systems/weather/index.ts` (`stepWeather`), `shared/sim/src/systems/weather/twister.ts` (`applyTwisterVortexAt`), `shared/sim/src/systems/weather/types.ts` (`TWISTER_SPEED_HEX_PER_TICK`)
- **What happens:** An active twister moves and hits once per `step`, not once per tick. `TWISTER_SPEED_HEX_PER_TICK` (0.22) is added once, and a building in the vortex loses 25 HP once, even when `dt` is 5. Five `dt=1` steps move and hit five times; one `dt=5` step does each once. A lightning overload that expires inside a coarse step is cleared before later systems in that same step, and those systems then apply the whole `dt`, so a store that charges only while online can gain up to 4 extra ticks on the clearing step. The expiry itself matches when `until` is a multiple of `dt`: both paths are back online at that tick. Insect attacks release once when the interval elapses and stamp `lastAttackTick` to `ctx.tick` (`fauna/step.ts`), so the next swing can slip by up to 4 ticks. A depleting metals tile that passes through 1..10 bp is read by `normalizeRichness` as a multiplier (`production/helpers.ts`), so one fine tick can pull extra ore from the next tile; a `dt=5` step removes 20 bp and skips that band (3600 ticks: 721.4 vs 720 metals). Water, thermal fuel, thermal pollution and `brownoutTicks` multiply by `dt` and match across those 3600 ticks.
- **Why it is like this:** Weather hazards are console-spawned and were written as one sample per step. Replaying the vortex `dt` times is not a multiply: the path turns, bounces and deals 25 HP only while the building is still inside it. Substepping the whole pipeline is a different change.
- **Workaround / mitigation:** The coarse-dt parity test covers dt-scaled production, the brownout collapse timer and lightning expiry. It does not claim twister motion or raid swings.
- **To resolve:** Inside one coarse step, advance each active twister once per tick from `tick - dt + 1` through `tick`. Same for any other hazard that samples once per step. Leave threshold timers that already key off `ctx.tick` alone.
- **Found:** 2026-11-09, W09-04

### BE-62 · A fast-run that stops before fastRan drops its notifications

- **Status:** Accepted
- **Area / code:** `backend/app/src/notify/fast-run-hold.ts` (`drop`), `backend/app/src/game/game-planets.service.ts` (`failLoad`), `backend/app/src/game/restart/notify-hold.ts`
- **What happens:** If a restart catch-up is marked and the load then fails, or the planet goes down, before `fastRan`, the buffered notifications are discarded. `NotifierPort.send` is not called for them. A later successful recovery fast-run of the same snapshot sends once at its own flush. If nothing retries, those alerts are not sent.
- **Why it is like this:** Flushing the failed attempt and flushing again when recovery replays the gap would send non-attack kinds twice. `under_attack` would usually fall inside the 10-minute window; the other kinds would not.
- **Workaround / mitigation:** `wirePlanetRecovery` restores the planet from its snapshot and fast-runs again. That run flushes.
- **To resolve:** Flush the aborted buffer only when recovery will not replay that gap.
- **Found:** 2026-11-09, W09-27

### BE-63 · A colony join does not close a no-colony socket of the same player

- **Status:** Accepted (by design)
- **Area / code:** `backend/app/src/ws/playing-sockets.ts` (`playingKey`), `backend/app/src/ws/ws.gateway.ts` (`replaceOlder`)
- **What happens:** A join with a `colonyId` is keyed `colony:<colonyId>`. A second join of that colony closes the older socket with `4001 replaced`. A different colony stays open. A join with no `colonyId` (dev session or pre-home) is keyed `player:<playerId>` and replaces only another no-colony socket of that player. It does not close a colony socket, and a colony join does not close the no-colony socket. One player can hold a lobby or dev socket and one playing socket per colony. Two playing sockets for one colony are not allowed. The same socket joining again does not close itself.
- **Why it is like this:** W09-28 stops a second colony of the same player from dropping the first (CT-15, CT-16). Dev welcomes still have a null colony id, and that path kept the old per-player takeover. The two keys are distinct so they cannot close each other.
- **Workaround / mitigation:** `leaveRoom` clears `colonyId` before close. The table remembers the join key and only drops a socket that is still registered under it, so the replacement stays.
- **To resolve:** If a colony join should also drop that player's lobby socket, close the `player:` entry from the colony join. Do not key colony sockets by player id again.
- **Found:** 2026-11-09, W09-28

### BE-64 · Away story is sealed at close, before the welcome end baseline

- **Status:** Accepted (W09-18 scope)
- **Area / code:** `backend/app/src/game/digest/service.ts` (`sealStory`), `backend/app/src/game/digest/story.ts`, `backend/app/src/ai/story/away.ts`
- **What happens:** The paragraph is written once when the row closes (`colonyBack`, a presence return, or welcome's close of a still-open row). It joins duration (if non-zero), attack counts, and the first non-zero resource net already on the body. `deliverWelcome` may then stamp `after` from the snapshot bytes (BE-59). That stamp keeps the paragraph it already stored, so the sentence can omit a net the structured digest shows. A paragraph that opens with build, attack, buy, sell, move, or destroy is dropped and the token reserve is reconciled to 0. A null paragraph, or a provider that throws, does not set `story` and does not fail the close. The text is the joined facts, not an LLM call.
- **Why it is like this:** CT-34's model call is the W16 provider. W09-34 wires that provider. This hook must not call the network, and a second call when welcome stamps `after` would charge the daily budget again.
- **Workaround / mitigation:** The structured digest is unchanged. The paragraph stays at most 600 characters and cannot add commands. With the provider off, or with W16 off, the body has no `story` field.
- **To resolve:** Stamp `after` before the one story call on the welcome path, or have W09-34 recompute the paragraph after that stamp.
- **Found:** 2026-11-09, W09-18

### BE-65 · Dev hard-mode clock is process memory and does not eliminate the sim colony

- **Status:** Accepted (W09-31 starts the clock; W09-19 owns the hard-mode path)
- **Area / code:** `backend/app/src/game/presence/hard-mode-clock.ts` (`HardModeClock`), `backend/app/src/game/presence/dev-presence.ts` (`eliminate`), `frontend/game/store/local/devPresence.ts` (`LocalHardModeClock`)
- **What happens:** `colony eliminate` while the presence blob is away emits `colonyEliminated` (`cause: other`) on `planet.event` and to joined sockets, and stores `{ startedAtMs, atTick, cause }` on `HardModeClock`. The first mark wins. A later eliminate emits again but does not move `startedAtMs`. A restart drops the map. The sim colony is not marked `eliminated` and buildings are not ruins (W18). The presence tracker is not told, so a socket that stays open keeps the dev away flag; after the last socket has been gone for 60s the tracker posts away again (no second `colonyAway`), and the next join posts `away: false`. `?host=local` keeps a separate page clock that W09-19 will not see.
- **Why it is like this:** W09-31 only has to fire the event and start a timestamp. The sim has no wall clock (SIM-D-06). Ruins stay W18. Home `ELIMINATED` from this clock is BE-66.
- **Workaround / mitigation:** In the same process, `HardModeClock.get(planetId, colonyId)`. While the dev socket stays connected, `away` and `back` stick.
- **To resolve:** Persist the mark if a restart must keep it. Sync the presence tracker if a reconnect must not clear a dev away. W18 turns the sim colony into ruins.
- **Found:** 2026-11-09, W09-31

### BE-66 · Hard-mode home is the in-memory clock, not a stored elimination

- **Status:** Accepted (W09-19)
- **Area / code:** `backend/app/src/core/home/hard-mode-home.ts` (`eliminatedHomeFromClock`), `backend/app/src/core/home/home.service.ts` (`buildHomeResponseAsync`), `backend/app/src/notify/alert-router.ts` (`claimEliminated`), `backend/app/src/game/presence/hard-mode-clock.ts`
- **What happens:** `GET /v1/me/home` returns `ELIMINATED` when `HardModeClock` has a mark for that colony and the row is still `ACTIVE`, while the sim is not eliminated (BE-65). A colony row already `ELIMINATED` keeps its stored recap. A planet that is already ended still returns `PLANET_ENDED`. `recap` is `{ startedAtMs, atTick, cause }` only. `planets` is a one-element list of the current planet, not the recruiting picker, and `newPlanetTypes` is `[]`. A restart clears the clock, so home is `ACTIVE` again. `POST /v1/me/home/recap-seen` does not clear the mark, so the same process keeps returning `ELIMINATED` and does not seat a new colony. A second `colony eliminate` still emits `planet.event` (BE-65). The router sends `colony_eliminated` once per colony and event id, so that repeat (same planet and tick) does not call `NotifierPort` again; a later elimination at a new tick still notifies. A failed send drops the claim so the same id can be tried again. There is no `?host=local` home, so `LocalHardModeClock` does not change `/v1/me/home`. `digestSignal` ignores `colonyEliminated`, so the away digest gains no elimination line.
- **Why it is like this:** W09-19 reads the dev clock. It does not scan the event log and does not add a store (BE-65 is process memory). The home schema allows this recap. Full ruins, the picker, and a digest line are later waves.
- **Workaround / mitigation:** In the same process, `HardModeClock.get(planetId, colonyId)` is what home reads. After a restart the player is `ACTIVE` on the same colony.
- **To resolve:** Persist the mark, or set the colony row `ELIMINATED`, and build the PROTOCOL recap (survived time, peak stats, open planets). Clear the mark when the recap is seen if a new colony should be seatable. Fold `colonyEliminated` into the digest if the away modal must mention it. A local home, if one is added, should read `LocalHardModeClock`.
- **Found:** 2026-11-09, W09-19

### BE-67 · A scenario away digest is keyed by the home id, so its baseline stays zero

- **Status:** Accepted (W09-33)
- **Area / code:** `backend/app/src/game/presence/dev-presence.ts` (`findColony`), `shared/sim/src/systems/presence/resolve.ts` (`colonyAt`), `backend/app/src/game/digest/baseline.ts` (`baselineFromState`), `backend/app/src/notify/notify-test.ts`
- **What happens:** A dev scenario seat writes a `co_` colony row and leaves the sim colony id as the fixture (`col_w09`, BE-45). `away` / `back` post `system.presence` with the `co_` id so `welcome.away` finds the digest. The snapshot still names `col_w09`, so `baselineFromState` misses the colony and `before` stays equal to `after` (BE-59). `POST /v1/dev/notify/test` routes `under_attack` through the alert router only. It does not emit a sim raid, so the plate's attack count stays 0 unless something else folded one. The local host has no `welcome.away`; its console lines are the away record.
- **Why it is like this:** Rewriting the sim colony id on the first away would move every id lookup in the same step. The plate still shows the duration and the attacks line. The mock row is the attack the e2e checks.
- **Workaround / mitigation:** Read nets only when the snapshot colony id equals the digest colony id. For a scenario, treat a zero net as "not measured", not as "nothing changed".
- **To resolve:** On scenario seat, set the sim colony id to the `co_` row (or stamp `after` by colony index). Fold a sim `underAttack` in the dev notify route only if the plate must count that test ping.
- **Found:** 2026-11-09, W09-33

## W20 Colony Deed & Staking (F6, mock)

### BE-53 · Tier-1 vertical slice settlement (`Stage 4 + 100% Living Planet` / `Seal Settled Deed`) and mock NEP-413 account claim while W14, W21, and W23 are deferred

- **Status:** Resolved (`e9e8c7d0` + Web3 Testnet→Mainnet hardening: all 11 real Testnet/Mainnet NEAR adapters, atomic `[AddKey, DeleteKey]` non-custodial `claimAccount` key rotation, Day-1 lossless `StakingPort`, and `DeedNftPort` are now live; Tier-1 `S4 + 100% Living Planet` settlement remains active until `W14`/`W21` open)
- **Area / code:** `backend/app/src/near/deed/deed-settled.service.ts`, `backend/app/src/near/deed/deed-projector.service.ts`, `backend/app/src/near/staking/account-claim.service.ts`, `backend/app/src/near/infrastructure/adapters/real/testnet-{identity,deed-nft,staking}.adapter.ts`, `shared/contracts/src/deed/index.ts`, [`docs/plan/waves/W20-colony-deed.md`](../plan/waves/W20-colony-deed.md)
- **What happens:** Because `W14` (walls) and `W21` (Silo T2 / Rocket departure) are postponed outside the Tier-1 vertical slice (`S0–S4`), a Colony Deed transitions to `settled: true` upon reaching Stage 4 (`S4`) + `100 %` Living Planet (`terraformBp: 10000`), via the `colonySettled` event, via the in-panel **Seal Settled Deed** button (`POST /v1/near/deed/settle`), or via the `deed.settle` dev console command (`opId = deed-settle:{colonyId}`, bypassing the 10-minute metadata debounce). The `walls` field in `DeedMetadataV1` remains omitted unless `W14` is enabled in `TA_WAVES`. Account claiming (`POST /v1/near/claim-account`) now runs both in `NEAR_MODE=mock` and on real NEAR (`NEAR_MODE=testnet|mainnet`, verifying NEP-413 signatures against on-chain `FullAccess` keys at `final` finality and atomically rotating `[AddKey, DeleteKey]`), and Day-1 lossless staking (`StakingPort`) + soulbound deeds (`DeedNftPort`) run on live `staking.<root>` and `deed.<root>`.
- **Why it is like this:** `W20-colony-deed.md` keeps the `S0–S4` vertical slice playable without postponed `W14`/`W21` rocket departure while real Testnet/Mainnet adapters now back all 11 NEAR ports (`BE-112`).
- **Workaround / mitigation:** Both `DeedNftPort` (`describeNearPortContract('deed')`) and `StakingPort` (`describeNearPortContract('staking')`) contract suites pass against Postgres mocks and live Testnet adapters.
- **To resolve:** Connect `W21` rocket departure to `colonySettled` when `W21` opens.
- **Found:** 2026-11-09, W20 delivery (resolved for W23 adapters 2026-11-13).

### BE-93 · Director allowance is per token; revoke is DELETE; guild offers may carry a reason

- **Status:** Question for the owner
- **Area / code:** `backend/app/src/near/application/ports/agent-wallet.port.ts`, `shared/contracts/src/guild/offers.ts`, `shared/contracts/src/commands/set-auto-trade.ts`, NEAR-80, NEAR-81, PROTOCOL `POST /v1/near/director-key`
- **What happens:** A limited key stores a NEAR gas allowance and a separate per-token principal ledger (`allowance`, `reserved`, `spent`, `available`). Signing does not spend principal. `director.status` is a WebSocket push and is not the W16 event `directorStatus`. Revoke is specified as `DELETE` by W15-18; PROTOCOL still says `POST` add/revoke. Each `guild.arrived` offer may include a `reason` string and may omit it. `setAutoTrade` carries the W09 limit row (`maxPerTrade`, `maxPerSession`, `minStock`, `partners`) plus optional `sellAboveStoragePct` and `buyBelowStock` (BE-95).
- **Why it is like this:** Q-04-1 conflicts on allowance basis (away budget vs per-session caps) and unit (per token vs one NEAR number). The wave text for W15-03 and W15-18 is per-token principal plus a separate gas allowance, so that is the default. Q-04-12 leaves the revoke verb open; W15-18's `DELETE` is the default. Q-04-5 asks for a reason on offers; the field is optional so a missing reason still parses.
- **Workaround / mitigation:** Command rejects use `allowance_exhausted`. The port throws `NEAR_ALLOWANCE_EXHAUSTED`. W15-03 stores that ledger on `chain.mock_chain_agent_key` and `chain.mock_chain_agent_allowance` (available is computed) and does not write `chain.director_key`. The storage-percent trigger is the optional field in BE-95. W15-18 implements `DELETE`.
- **To resolve:** Confirm per-token principal, `DELETE` revoke, and optional offer reasons.
- **Found:** 2026-11-10, W15-01

### BE-94 · Mock agent-wallet principal is one pool per token, and gas is not metered

- **Status:** Accepted (by design, W15-03)
- **Area / code:** `backend/app/src/near/infrastructure/adapters/mock/agent-wallet.adapter.ts`, `shared/db/prisma/agent-wallet.prisma`, NEAR-80, NEAR-81
- **What happens:** `MockAgentWalletAdapter` stores a limited key in `chain.mock_chain_agent_key` and principal in `chain.mock_chain_agent_allowance` (`allowance`, `reserved`, `spent`). Available is `allowance - reserved - spent` and is not a column. Reserve, consume, and release take an amount from that pool. They are not tied to a reservation id, so two holds on one key share one reserved total. `gasSpent` stays `0`. `addLimitedKey` records the gas allowance and does not move principal. Revoke sets `revoked` and `revoked_at` and leaves the totals. A later reserve, consume, or release throws `NEAR_KEY_REVOKED`. A second `addLimitedKey` for the same key with a new opId throws `NEAR_ACCOUNT_EXISTS` and does not change the caps. `NEAR_ADAPTER_AGENT_WALLET=testnet` fails boot. Only the mock class is registered.
- **Why it is like this:** The port methods are amount-based. `chain.director_key` belongs to W15-18. Real function-call allowance is gas only (NEAR-81). The real adapter is W23.
- **Workaround / mitigation:** Callers that overlap two holds must consume and release amounts that fit the combined reserved total. Read live balances through `keyStatus`. W15-18 copies that ledger onto `chain.director_key` (`tokens` jsonb, plus one numeric pair for the primary resource) and the `director.status` push is still built from `keyStatus` (BE-96).
- **To resolve:** W23 registers the testnet class. Gas metering, if it is required, is a later change. The W15-18 projection is BE-96.
- **Found:** 2026-11-10, W15-03

### BE-95 · autoTrade storage percent and buy floor are optional

- **Status:** Accepted (by design)
- **Area / code:** `shared/contracts/src/notify/auto-trade.ts`, `shared/sim/src/systems/away/auto-trade.ts` (`withinAutoTrade`), `shared/sim/src/systems/trade/autotrade/`, planet blob `autoTrade`
- **What happens:** `sellAboveStoragePct` (0..100) and `buyBelowStock` may be omitted. A W09 row still parses, and `withinAutoTrade` then ignores those rules. When the percent is set, a sell is allowed at that fill or above (inclusive); a sell with no `storagePct` and no positive `storageCap` is refused. A buy is allowed only when stock is at or below `buyBelowStock` (inclusive). `setAutoTrade` stores the map on blob `autoTrade` under the colony index. `partners: 'truce'` is rejected and not stored while W18 is off; the row is not rewritten to `guild`. The forecast defaults `tier1Only` to true (`metals.t1`, `minerals.t1`, `bio.water`, `bio.biomass`). T2/T3 keys still parse on the command. Surplus is stock after queues, open reservations and the service window; the reserve floor feeds shortage, not that surplus. A buy is preferred only when `withinAutoTrade` accepts it. Haul, produce, depot and reserve are not partner trades.
- **Why it is like this:** W15-19 requires existing rows to keep parsing. BE-93 left the storage-percent trigger open; the issue makes it optional rather than required. The id is BE-95 because W15-03 already took BE-94.
- **Workaround / mitigation:** Send `sellAboveStoragePct: 80` for the demo rule. Pass `tier1Only: false` to forecast a T2 key. Turn W18 on before storing `partners: 'truce'`.
- **To resolve:** Owner can require the percent on every row later. AW-13 still lists fewer fields than this row.
- **Found:** 2026-11-10, W15-19

### BE-69 · A settled Colony Deed push is not one of the eight away-alert toggles

- **Status:** Accepted (by design)
- **Area / code:** `backend/app/src/near/deed/deed-settled.service.ts` (`notifySettledIfEnabled`), `shared/contracts/src/notify/kinds.ts` (`NOTIFIER_EXTRA_KINDS`), `backend/app/src/ports/notifier.port.ts`
- **What happens:** When W09 and W20 are both on, sealing a Colony Deed calls `NotifierPort.send` once per colony per process. The payload kind is `deed_settled`, the channel is always `telegram`, and `to` is the deed's `playerId` or else its `accountId`. That kind is not in `NOTIFICATION_KINDS`, so the away alert toggles do not list it and cannot turn it off. The alert router does not turn a `deedSettled` planet event into this push. A repeat seal in the same process does not send again. The idempotency key is `deed-settled:<colonyId>` plus the channel.
- **Why it is like this:** CT-36 fixes eight player-configurable alerts. W20-25 asks for one push on settle and was written against an older port shape (`channel`, `to`, `title`, `body`). The port now requires `colonyId`, `eventId` and `kind`. Adding a ninth toggle would change that closed list.
- **Workaround / mitigation:** The send is skipped when W09 is off, when no notifier is bound, or when both `playerId` and `accountId` are empty. A send that fails is logged and does not fail the seal.
- **To resolve:** Owner: add a player toggle and route the seal through the alert router, or keep this one-shot telegram push.
- **Found:** 2026-11-10, merge of main into W09.

### BE-96 · Director key gas is zero; the numeric columns mirror one resource

- **Status:** Accepted (by design, W15-18)
- **Area / code:** `backend/app/src/near/director-key/`, `shared/db/prisma/agent-wallet.prisma` (`DirectorKey`), `chain.director_key`, NEAR-80, NEAR-81
- **What happens:** `POST /v1/near/director-key` turns each autoTrade `maxPerSession` into that resource's principal allowance (whole units, decimal string). The function-call gas allowance passed to `addLimitedKey` is `0`, because no data row names a gas budget. Signing does not spend principal. `chain.director_key.allowance` and `spent` mirror the first resource in `RESOURCE_KEYS` order that the limits name (`metals.t1` when it is present). The full ledger is jsonb `tokens`. `director.status` is built from `AgentWalletPort.keyStatus`, not from those columns. A second POST while the key is active returns the same key and does not raise the caps. After revoke, a later POST stores a new public key on the same row. The limited key names only `intents.near` (the port takes one receiver). A body `limits` map wins over the sim blob `autoTrade`. An empty map, or no blob and no body limits, is 400 and writes nothing. W15 off is 403 `wave_disabled` and writes nothing.
- **Why it is like this:** DATA_MODEL sketches one numeric allowance. The wave is per-token principal plus a separate gas allowance (BE-93). There is no gas constant in data, so the issue's fallback is `0`. Revoke stays DELETE (BE-93).
- **Workaround / mitigation:** Read per-token numbers from `director.status` or `keyStatus`. Do not treat the numeric column as a sum, and do not treat gas `0` as a principal cap.
- **To resolve:** The owner can set a gas constant (W23-26's 0.1 NEAR) and a second receiver when the real adapter lands.
- **Found:** 2026-11-10, W15-18

### BE-97 · A second 300 still fits the 600 cap; the loop will not sell it against the same stock reading

- **Status:** Accepted (by design, W15-21)
- **Area / code:** `shared/sim/src/systems/trade/autotrade/decide.ts`, `shared/sim/src/systems/trade/autotrade/price.ts`, `backend/app/src/market/director/director-loop.service.ts`, `backend/app/src/market/director/director-source.ts`, `backend/app/src/market/director/director-market.ts` (`DirectorSimMarket`)
- **What happens:** `withinAutoTrade` allows `sessionSpent` 300 plus another give of 300 when `maxPerSession` is 600 (the sum is not greater than the cap). `decideDirectorTrade` returns that sell. The loop remembers the stock it just filled against. The next `runDirectorOnce` on that same reading returns `session_cap` and does not reserve or place, so one tick sells 300 and the key stays spent 300 / available 300. A later reading with a different stock can sell the remaining 300. The memory is the process. After a restart, spent 300 and a stock that is still above 80% can sell again. `priceDirectorOrder` calls `quoteColony`. The data cap `maxOrderUnits` is 100, so the call raises it to the authorized amount (300) and still uses that function. Transport is `0` (known free). If there is no measured unit cost, the board VWAP is the cost input; with neither, the loop skips `no_quote` and does not place. The away reader passes queues, reservations and the service window as 0, so surplus is the ledger stock. `DirectorSimMarket` treats a sim accept as `open` and does not consume; the loop consumes only when the market port reports `filled`. A live book does not yet report that fill, so a sweep that uses the sim port reserves the metal and leaves it reserved (`awaiting_fill`). The order is `source: 'player'` with the colony index, because a `bot` source is subject to the away gate. Revoke skips `director_key_revoked`, emits `directorAllowanceExhausted` once, and does not place (W15-22). A spent allowance emits that event once and stops that resource (BE-98). Settings are the Away autoTrade section (W15-23, FF-103). The digest line is BE-99.
- **Why it is like this:** The cap check is the one `withinAutoTrade`. The demo's second tick must not sell another 300 while the stock number has not moved. The quote library sizes bot orders at 100 units; the player cap for this sell is 300. Settlement already consumes trade principal on its own path; this loop's consume is the director-key ledger, and the sim command result is not a fill.
- **Workaround / mitigation:** Tests pass a market port that reports the Guild fill, so the 300 is consumed in that tick. Do not read a second 300 from `decideDirectorTrade` as a second placed order. Do not treat gas or the quote total as the metal reserve.
- **To resolve:** Have the matcher report the fill (or the reject) back to `DirectorLoopService` so the sim port consumes and releases. Subtract real queues and open reservations in the away reader. Replace the zero transport and the VWAP-as-cost stand-in when a measured cost exists.
- **Found:** 2026-11-10, W15-21

### BE-98 · Director allowance stop is once per process and key; only a spent allowance notifies

- **Status:** Accepted (by design, W15-22)
- **Area / code:** `backend/app/src/market/director/director-loop.service.ts` (`noteStop`), `backend/app/src/notify/alert-map.ts` (`directorBudgetNotifies`), `backend/app/src/notify/alert-router.ts`
- **What happens:** After a fill that leaves `spent >= allowance` (available 0), or when a tick starts with available 0, the loop emits `directorAllowanceExhausted` with reason `allowance_exhausted` once for that resource and public key, logs the reason, and does not place again. A later tick in the same process does not emit again. A revoked key emits once with `director_key_revoked` and does not place. The latch is the process: a restart emits again for the same key. A new public key (the key was replaced) can emit again. W09 maps only reason `allowance_exhausted` to `away_budget_exhausted`. `director_key_revoked` is the event only. A remainder above 0 that cannot cover the next order still returns `allowance_exhausted` and does not emit. W15 off returns `wave_disabled` and does not emit. The digest line is BE-100.
- **Why it is like this:** The issue asks for one event per resource until the key is replaced, and for W09 to notify `allowance_exhausted`. The same-reading latch (BE-97) stays for a 600 cap that still has 300 left. The notify path is the existing alert router, not a second sender.
- **Workaround / mitigation:** Read the planet event. Do not expect a second notification after a process restart, and do not expect a push for a revoked key. A positive remainder that is short of the next order is a skip, not this event.
- **To resolve:** Persist the once-latch if a restart must stay silent. Notify revoke only if the owner wants that push.
- **Found:** 2026-11-10, W15-22

### BE-99 · Guild strategy is deterministic; the LLM slot is not called

- **Status:** Accepted (by design, W15-13)
- **Area / code:** `backend/app/src/market/guild/strategy/port.ts` (`parseGuildStrategy`), `backend/app/src/market/guild/strategy/apply.ts` (`priceGuildPair`), `backend/app/src/market/guild/strategy/deterministic.ts`, `backend/app/src/market/guild/strategy/llm.ts`, `backend/app/src/market/guild/guild.module.ts`, `backend/app/src/market/guild/visit/guild-visit.service.ts` (`noteStrategy`), `backend/app/src/market/guild/maker/guild-maker.service.ts` (`quoteTargets`)
- **What happens:** `GuildStrategyPort.choose(npc, clock)` resolves to `{ route, stockpile, specialisation, risk }`. There is no price field. `parseGuildStrategy` rejects a payload that contains a `price` or `free_price` key, and rejects a missing or empty `stockpile`. `GuildModule` binds the port to `DeterministicGuildStrategy`. The route token is one entry of that NPC's `route` list in `shared/sim/src/data/guild.ts`, index `hashString(npcId) % route.length`, so the same id always yields the same token (`loop-local` while the list has one stop). Stockpile goals are that NPC's `targets` (`targetMetalsT1`, `targetMineralsT1`, `targetWater`, `targetBiomass`) in pair order. Specialisation is `balanced` and risk is `conservative` for every NPC. The clock does not change the deterministic result. W15-35 calls `choose` when a visit is planned and again before the maker quotes. An accepted stockpile target is copied onto the `quoteGuild` fixture (`stockpileTarget`) and replaces the guild-table target for that resource. A payload `parseGuildStrategy` rejects is not copied, so the quote stays the guild-table target. The chosen route replaces the data route only when that token is not already on it. `LlmGuildStrategy` takes an `LlmProviderPort`. Its `choose` throws `w16_off` with message `unused`, does not call the provider, and does not log, unless it was constructed with `w16` true. With that flag it calls `complete` at most once per NPC per hour and parses the JSON. `GuildModule` does not register the class and does not import an LLM adapter, so wave W16 on does not switch the binding, does not spend the AI budget, and does not make that call. `quoteColony` is unchanged. The visit service and the maker each call `choose`; the deterministic result ignores the clock, so the two calls agree.
- **Why it is like this:** W15-13 keeps prices in the W13 quote library and requires zero LLM calls while W16 is off. The guild table has a route and stockpile targets and no specialisation or risk columns. The budgeted hourly call is W16-21. W15-35 wires `choose` into the visit and the quote fixture and still prices with `quoteGuild`. The W16 kill switch is BE-106.
- **Workaround / mitigation:** A test passes another `GuildStrategyPort` when it needs a different route. Do not read a price from this object. Do not expect a model call from the Guild module.
- **To resolve:** W16-21 can construct `LlmGuildStrategy` with `w16: true` behind the AI budget, still through `parseGuildStrategy`. Add guild-table columns if specialisation or risk must differ by NPC.
- **Found:** 2026-11-10, W15-13 (updated 2026-11-11, W15-35)

### BE-100 · A director trade line is stored only on an open W09 digest

- **Status:** Accepted (by design, W15-24)
- **Area / code:** `backend/app/src/market/director/digest-line.ts` (`directorDigestLine`), `backend/app/src/market/director/digest-recorder.ts`, `backend/app/src/game/digest/service.ts` (`noteDirectorTrade`), `shared/contracts/src/notify/digest.ts` (`items`), `frontend/game/features/director-log/`, `frontend/game/features/away-digest/render.ts`
- **What happens:** `directorDigestLine` turns a fill into `Director sold 300 metals to the Guild.` (buy says `bought` … `from`). The names are metals, minerals, water, and biomass. `bio.t2` and `bio.t3` are not a line. Amount 0 is not a line. The sentence does not depend on W09. When the loop fills while `view.away` is true and both W09 and W15 are on, it calls `AwayDigestService.ensureOpen` before it emits `directorTrade`, then `DirectorDigestRecorder` appends `{ kind: 'digest.directorTrade', line }` on that row (the same store, not a second one). The 21st line is dropped (CT-31). A fill while the colony is present does not open a row, and `noteDirectorTrade` still drops the line if none is open. `suppressAway` (the player already returned) does not reopen. The same fill is fanned to joined sockets with `data.line`. When W09 is off, or W15 is off, the digest is not written. W09 off still fans the sentence; the HUD event log shows it from the event fields. W15 off does not emit and does not notify. `directorAllowanceExhausted` with reason `allowance_exhausted` is `away_budget_exhausted` only while W09 and W15 are both on. A player with no socket and W09 off never sees that fill. `?host=local` does not run this loop. Buy uses `from the <counterparty>`.
- **Why it is like this:** W15-24 renders through the existing W09 digest when that wave is on, and through the HUD log when it is off. W15-36 opens the row on an away fill so the welcome plate (`renderAwayDigest`) can list `items`. The formatter stays on the server; the HUD calls the same function.
- **Workaround / mitigation:** Read `directorTrade` on the bus. With W09 and W15 on, an away fill opens the row, and welcome carries `items`. With W09 off, stay connected if the log must show the line.
- **To resolve:** Persist a line that arrives while the colony is present only if the owner wants that. Replay a fill that lands after `suppressAway` only if a late trade should reopen the plate.
- **Found:** 2026-11-10, W15-24 (updated 2026-11-11, W15-36)

### BE-101 · The market re-checks autoTrade only when the order is flagged director

- **Status:** Accepted (by design, W15-20)
- **Area / code:** `shared/sim/src/systems/trade/market-matcher.ts` (`directorAutoTradeCode`, `matchIncoming`), `backend/app/src/market/director/director-match-guard.ts`, `backend/app/src/market/orders/place-order.service.ts` (`directorBlock`), `backend/app/src/market/director/director-market.ts` (`directorPlaceCommand`)
- **What happens:** `decideDirectorTrade` already calls `withinAutoTrade`. A director `market.placeOrder` also sets `director: true`. Before that order is opened for matching, `DirectorMatchGuard` calls `withinAutoTrade` again with the colony limit and the director key's `spent` for that resource. False, a missing limit, a missing key, a revoked key, or a resource with no token row is `autotrade_limit` and the order is not matched. `matchIncoming` does the same when the in-memory order carries an `autoTrade` claim, and it uses the book amount as `give` even if the claim still says 300. An order without the flag or the claim is not capped: a player sell of 400 still matches. The persisted book row does not store the claim, so a later match of an already OPEN row does not run this check again. The loop may already have reserved the key before this refusal; that reserve is not released here (BE-97 still treats a sim accept as `open`).
- **Why it is like this:** The cap function stays `withinAutoTrade`. The flag is how a forged or stale director command is told apart from a player order after the sim has already accepted `market.placeOrder`. Player orders are not subject to autoTrade limits. Reading the key at match time is the session number; the sim forecast still stores session spend as 0 (BE-97).
- **Workaround / mitigation:** Do not treat a player or bot `market.placeOrder` as autoTrade-capped. Do not expect a second match of an OPEN director row to refuse. If the loop reserved and the market then refuses, release that key reserve yourself; this path does not.
- **To resolve:** Carry the claim on the book row and refuse inside the match lock, and release the director-key reserve when the market returns `autotrade_limit`.
- **Found:** 2026-11-10, W15-20

### BE-102 · Dev `director.allowance` revokes the key and adds a new one

- **Status:** Accepted (by design, W15-28)
- **Area / code:** `backend/app/src/near/director-key/director-key.service.ts` (`setDevAllowance`), `backend/app/src/near/application/ports/agent-wallet.port.ts`, `backend/app/src/market/guild/dev/guild-dev.command.ts`, BE-94, BE-96
- **What happens:** `director.allowance [resource] <amt>` sets one Tier-1 token allowance (`metals.t1` when the resource is omitted). `AgentWalletPort` has no method that changes the allowance of a key that already exists. A second `addLimitedKey` for the same public key throws `NEAR_ACCOUNT_EXISTS` and does not raise the cap. The command revokes the current key and adds a new public key (`nextDirectorPublicKey`) with the new cap. Other tokens keep their allowance numbers. Spent, reserved, and available on the new key start at 0. Gas stays `0`. The numeric `chain.director_key.allowance` column still mirrors the primary resource (BE-96), not necessarily the resource just edited. If the add fails after the revoke, the row still names the old public key, which is now revoked, until the command is run again. No row is `director_key_missing` and nothing is written. W15 off is `wave_disabled` and the wallet is not called.
- **Why it is like this:** The mock ledger is insert-only for caps (BE-94). Editing the row in place would diverge from the port the real adapter has to implement.
- **Workaround / mitigation:** Read the new numbers from `director.status` or `keyStatus`. A session that had already spent part of the old cap starts again at spent 0. The director loop's once-latch is per public key, so the new key can emit `directorAllowanceExhausted` again (BE-98).
- **To resolve:** Add an allowance-update method on `AgentWalletPort` if a later wave needs to change a cap without rotating the key.
- **Found:** 2026-11-10, W15-28

### BE-103 · `away.simulate` posts `system.presence`; it is not a second director flag

- **Status:** Accepted (by design, W15-28)
- **Area / code:** `backend/app/src/market/guild/dev/guild-dev.service.ts` (`simulateAway`), `backend/app/src/game/presence/dev-presence.ts`, `backend/app/src/market/director/director-source.ts` (`listAway`), `shared/sim/src/systems/away/gate.ts` (`colonyIsAway`)
- **What happens:** `away.simulate on|off` calls `DevPresence.setAway`, which posts module `system.presence`. The director sweep's `SimDirectorSource.listAway` restores the planet and keeps colonies where `colonyIsAway` is true (presence blob or an open away session). There is no separate away bit on the director loop. W15 off throws `wave_disabled` before that post. W09 off throws `WAVE_DISABLED` from `DevPresence`, and the sim would reject `system.presence` as `wave_disabled` anyway, so the blob does not change and the sweep does not see the colony.
- **Why it is like this:** The loop already reads the sim blob. A second in-memory flag would disagree with `colonyIsAway` after a restart and with the `away` / `back` commands.
- **Workaround / mitigation:** Run with W09 on (W15 depends on it). `away` and `back` write the same blob. `runDirectorOnce` itself does not re-check away; only the sweep's `listAway` does.
- **To resolve:** If a demo must force the director while W09 is off, add a dev override inside `listAway` and document that it is not the sim blob.
- **Found:** 2026-11-10, W15-28

### BE-104 · An away director fill opens the digest; a present fill does not

- **Status:** Accepted (by design, W15-36)
- **Area / code:** `backend/app/src/market/director/director-loop.service.ts` (`openAwayDigest`), `backend/app/src/game/digest/service.ts` (`ensureOpen`), `frontend/game/features/away-digest/render.ts` (`renderAwayDigest`)
- **What happens:** The welcome plate is `renderAwayDigest` (`[data-testid="away-digest"]`). Director lines are `[data-kind="digest.directorTrade"]` inside `[data-testid="away-director-trades"]`. The ColonyBook AWAY tab stays the settings editor and does not repeat those lines. `ensureOpen` uses the loop's `view.away`. A fill while the player is present does not open a row. A colony already marked returned (`suppressAway`) is not reopened, so that fill is not stored. The line sits on the in-memory body until a snapshot flush or welcome close, the same as a raid fold. A colony id that is not a home id is skipped by `draftDigest` and the line is not stored.
- **Why it is like this:** BE-100 dropped a fill with no open row. Opening on every fill would write an away digest while the player is still here. The plate already listed `items`; the AWAY tab is the limits editor (W15-23).
- **Workaround / mitigation:** Go away (presence blob or an open away session) before the director sells. Return through welcome to read the line. Do not look for it on the AWAY tab.
- **To resolve:** Store a present-colony fill, or copy the same lines onto the AWAY tab, only if the owner asks.
- **Found:** 2026-11-11, W15-36

### BE-105 · Guild Contact counts a committed NPC fill and does not undo a later failure

- **Status:** Accepted (by design, W15-25)
- **Area / code:** `backend/app/src/market/progression/guild-contact.producer.ts` (`note`, `noteOutcome`), `backend/app/src/market/orders/place-order.service.ts` (`noteGuild`), `backend/app/src/market/guild/offers/accept-guild-offer.service.ts` (`noteContact`)
- **What happens:** A committed fill with `actorKind === 'npc'` on exactly one side and `player` or `bot` on the other adds fact `guild-contact` +1 for that owner (`progress.guildContact`). The receipt id is `guild:guildContact:<tradeId>:<playerId>`. The same trade id does not add again. W15 off adds nothing. Amount 0, a player-player fill, the same colony, and the same owner add nothing. Actor kind `guild` is not the signal (live quotes are stored as `npc`). The count is written when the match commits. Accept emits `guildTradeSettled` at that moment; a book fill is counted from the same committed outcome. It is not written when the intent later reaches FINAL. If that row becomes FAILED, the fact is not reduced. A retry stored as `tradeId~n` counts as its own trade once that row is the live one. This producer does not write unlock rows; W12's progression engine evaluates the catalogue when it applies the fact, so Guild Contact tiers unlock at 5 / 50 / 250.
- **Why it is like this:** W15-25 hooks the committed guild fill. Lifetime facts are not deleted (PROGRESSION_ENGINE). Achievement tiers stay in the W12 catalogue.
- **Workaround / mitigation:** Do not expect the fact before the match commits, and do not expect a failed settlement to subtract it. A book-path id is `tradeIdOf` until a FAILED row forces the live retry id.
- **To resolve:** Emit only from `TradeSettlement.notify` (FINAL) if chain finality should gate the fact, and add an explicit compensating event if a counted trade later fails.
- **Found:** 2026-11-11, W15-25

### BE-106 · A released director reserve is not taken again, but the same command is submitted again

- **Status:** Open
- **Area / code:** `backend/app/src/market/director/director-loop.service.ts` (`reserve`, `placePick`), `backend/app/src/near/testing/in-memory-agent-wallet.ts`, `backend/app/src/near/infrastructure/adapters/mock/agent-wallet.adapter.ts`
- **What happens:** The wallet op id is `dir:rsv:` plus `d{colonyIndex}-{resource}-{spent}-{amount}`. A reject releases that hold. The next `runDirectorOnce` with the same index, resource, spent, and amount hits the stored op. The adapter returns the first receipt and does not reserve again. The loop still treats that as a new hold and calls `place`. If that attempt reports `filled`, `consumeAllowance` throws `NEAR_ALLOWANCE_EXHAUSTED` (`reserved` is 0, the amount is 300) and spent stays at the earlier consumed part. Revoke between reserve and consume also leaves the unconsumed hold: consume and release both throw `NEAR_KEY_REVOKED` (BE-94) and do not add to spent.
- **Why it is like this:** W15-30 adds tests for the races the ledger already enforces. It does not change the loop. The command id is the order id, so a released attempt cannot buy a second hold without a new id.
- **Workaround / mitigation:** One tick is safe: a reject releases the full hold, an open order keeps it, and a filled order consumes it. Do not run the same decision again after a release and expect either a new hold or a quiet skip.
- **To resolve:** If the live reserved total did not grow by this order's amount, skip `place`. Give a released attempt a new op id only when a retry should be allowed to reserve again.
- **Found:** 2026-11-11, W15-30

### BE-107 · W15-35 does not trip the W16 AI kill switch

- **Status:** Accepted (by design, W15-35)
- **Area / code:** `backend/app/src/market/director/director-loop.service.ts` (`runDirectorOnce`), `backend/app/src/market/guild/funding/guild-kill.ts` (`killGuild`), `backend/app/src/ai/audit/kill.ts` (`DirectorKillSwitch`), `backend/app/src/ai/audit/prisma-store.ts` (`isKilled`)
- **What happens:** `DirectorKillSwitch` and `PrismaDirectorStore.isKilled` are not Nest providers. The director loop and the guild maker do not read them. Revoking the director key makes `runDirectorOnce` return `director_key_revoked` and place nothing. `GuildKillSwitch.killGuild` sets that NPC's funding row to `killed` and the maker then skips new quotes. There is no `proposeBotTradeOrder` or `resolveEffectivePermissions` in this process. Turning W16 on does not switch `GuildStrategyPort` off `DeterministicGuildStrategy` and does not call an LLM.
- **Why it is like this:** W15-35 must not invent a W16 provider. The kill-switch classes exist for W16 tests and the Prisma store, but nothing in the market process constructs them. The gates that already exist are the director key and `killGuild`.
- **Workaround / mitigation:** Revoke the director key to stop autoTrade. `guild.disable` / `killGuild` stops that NPC's quotes. Do not expect `DirectorKillSwitch.kill`, or a row in `ai.director_kill_switch`, to stop the loop.
- **To resolve:** When W16 wires a kill-switch provider into this process, have `runDirectorOnce` skip the same way as `director_key_revoked` when `isKilled` is true for `global` or `colony:<id>`.
- **Found:** 2026-11-11, W15-35

### BE-108 · W15 e2e does not finish the empty book, the director fill, or the second planet

- **Status:** Open
- **Area / code:** `tests/e2e/w15.spec.ts`, `tests/scenarios/w15-guild-agents.ts`, `backend/app/src/market/guild/maker/`, `backend/app/src/market/director/director-loop.service.ts`
- **What happens:** Demo step 2 asserts `guild.summon kestrel` (`Kestrel docked — N quotes`) and a `guild.arrived` push. It does not assert the toast text, the ship mesh, or six offers. Step 3 sends `market.acceptGuildOffer` only when that push lists an offer. A fresh planet has no organic last price, so the maker rests nothing and `offers` stays `[]` (LED-38). The suite then only checks that the Guild tab button is mounted (`trade-hub-tab-guild`). The panel starts closed, so the offer list is not clicked. It does not check the 71.4 water total or `guild-1.npc.terraagent.mock` on `/dev/chain/`. Step 4 is `guild.setInventory kestrel metals.t1 600`, not a player sell, and the next metals quote is not compared. Steps 6 and 7 assert `away.simulate on` and `off`. They do not wait for a 300-metal director fill, `spent 300 / 600`, or the digest line "While you were away: Director sold 300 metals to the Guild." The loop is a timer; the suite does not warp 20 minutes. Step 8 asserts `DELETE /v1/near/director-key` returns `revoked`. It does not run another away pass to see `director_key_revoked`. Step 9 asserts `guild.depart kestrel` and `guild.departed`. It does not open a second planet or check carried cargo (W11). Step 10 asserts `guild.disable kestrel` (`quotes killed`). It does not exhaust the cash budget, race concurrent bids, or replay the W13 stress report (LED-44). Step 11 restarts the e2e app with `TA_WAVES=..14` when `E2E_CONTROL` is set. Under `E2E_REUSE=1` that step is skipped. The same flag-off is already asserted by `backend/app/test/market/guild-visit.int.spec.ts` ("W15 off writes no row") and `shared/sim/test/systems/auto-trade.int.spec.ts` (`setAutoTrade` is `wave_disabled` below W15).
- **Why it is like this:** W15-34 asks for a serial server e2e that does not hunt pixels and does not block on wall-clock visits or an empty book. The scenario can seed sim stock. It cannot insert `chain.guild_visit` or an organic VWAP. The roster's two NPCs (Kestrel, Vanguard) already live in `shared/sim/src/data/guild.ts`. The visit clock is `dockWindowS` 720, not 30 seconds (LED-36).
- **Workaround / mitigation:** `guild.summon` docks now. An empty offer list is a pass plus the Guild tab. Funding, re-quote, and W15-off writes stay in the integration specs named above. Do not treat this e2e as proof of a 300-metal director sale or of cross-planet carry.
- **To resolve:** Seed one organic (or labelled) reference last on the four Tier-1 barter books before summon if step 3 must accept. Drive one `runDirectorOnce` from a dev command if steps 6–7 must show spent 300 and the digest line. A W11 planet pair is required before step 9 can show cargo on the next world.
- **Found:** 2026-11-11, W15-34

### BE-109 · Combined hack e2e through W15 still fails five earlier-wave tests

- **Status:** Open
- **Area / code:** `tests/e2e/w00.spec.ts`, `tests/e2e/w03.spec.ts`, `tests/e2e/w09.spec.ts`, `tests/e2e/w10.spec.ts`, `tests/e2e/w13.spec.ts`
- **What happens:** `npm run e2e -- --waves ..15 --hack` on 2026-11-11 finished 83 passed, 5 failed, 64 not run. `tests/e2e/w15.spec.ts` passed all 12. The failures were: w00 `?lag=300` predicted nudge (`movedAfterMs` −1), w03 dismantle water stock 96.48 against 102.5, w09 reload welcome plate (`[data-testid=away-digest]` not in the document; the frame was 3.3 s), w10 export confirm covered by a top-right book page, w13 market tab covered by the locked Thermal Plant card. A first run also failed w03 supply hover because the Guild toast sat on `hud-supply`. That toast is now at the bottom center and that hover failure did not return. The same day, `npm run test:integration` was 523 passed and 4 failed (`outbox.int.spec.ts` relay timing, `deed-lifecycle.int.spec.ts` version). Those two files passed alone (10 tests).
- **Why it is like this:** The combined suite runs every earlier wave with W15 on, on a shared Postgres that already holds connections from other worktrees. The W15 file does not depend on those five clicks. The outbox and deed files do not import the guild maker.
- **Workaround / mitigation:** Trust `tests/e2e/w15.spec.ts` and `npm run ci:fast` for this wave. Re-run a single failed file before treating it as a Guild defect.
- **To resolve:** Re-run `npm run e2e -- --waves ..15 --hack` when the machine and Postgres are quiet. If w09, w10, or w13 still fail, the plate and the top-right hit targets need a layout fix that is not the Guild toast.
- **Found:** 2026-11-11, W15 pre-landing validation
### BE-70 · Escrow `open` still requires a beneficiary

- **Status:** Question for the owner
- **Area / code:** `backend/app/src/near/application/ports/escrow.port.ts` (`EscrowOpenInput.beneficiary`), Q-05-26
- **What happens:** `EscrowPort.open` still requires `beneficiary`. A bounty posted before anyone claims it has no payee (NEAR-110, W22-19). Only a mercenary hire knows the payee at open (W22-28). W22-02 added `get` and left `open`, `claim`, and `refund` on the W00-30 fields. `claim` still pays `caller`.
- **Why it is like this:** W22-02 keeps the landed `open` / `claim` / `refund` shapes and adds `get`. Making `beneficiary` optional would answer Q-05-26 without the owner.
- **Workaround / mitigation:** `MockEscrowAdapter` (W22-17) stores `beneficiary` and holds the tokens on the escrow id. `claim` pays `caller`, not that beneficiary. W22-19 passes that hold id (`escrow:` + 32 hex of the open op) as `beneficiary`. `EscrowOpenInput` and `EscrowView` accept that id as well as a colony account. The payee is still named only on `claim`, as `caller`.
- **To resolve:** Owner: keep a holding-account beneficiary, or make `beneficiary` optional and name the payee only on `claim`.
- **Found:** 2026-11-10, W22-02

## W22 Treasury DAO mock

### BE-71 · Mock DAO balance lives in policy JSON and a short deciding vote is rolled back

- **Status:** Accepted (by design)
- **Area / code:** `backend/app/src/near/infrastructure/adapters/mock/treasury.adapter.ts`, `backend/app/src/near/treasury/policy.ts` (`settleCost`), `backend/app/src/near/treasury/actions.ts` (`approvePassed`)
- **What happens:** `deposit` adds `balances[tokenId]` inside `MockChainDao.policy`. It does not debit `from` on `chain.mock_chain_balance`. A second `createDao` for the same slug with a new opId keeps the existing members and balances. `Rejected` is never written: a `remove` vote counts as no, and a failed `finalize` becomes `Expired`. When the vote that would pass cannot pay `payload.cost`, the adapter throws `TREASURY_INSUFFICIENT` inside the mock transaction, so that vote is not stored and the proposal stays `InProgress`.
- **Why it is like this:** W22-03 stores members, `canPropose` and balances in the policy JSON so the landed `mock_chain_dao` tables need no new migration. `MockChainBase.call` rolls the callback and the receipt back together; persisting the vote and still throwing would leave a success receipt for the same opId on retry.
- **Workaround / mitigation:** After a top-up, the same member can vote again. `finalize` of an already `Approved` proposal does not debit a second time.
- **To resolve:** Keep this. A real Sputnik adapter (W23-36) maps chain state onto the same port errors.
- **Found:** 2026-11-10, W22-03

### BE-72 · The finalize job owns the 6 h deadline

- **Status:** Resolved (W22-09)
- **Area / code:** `backend/app/src/near/treasury/finalize.service.ts` (`finalizeDue`), `backend/app/src/near/treasury/actions.ts` (`finalizeProposal`), `shared/sim/src/data/treasury-policy.ts` (`proposalTtlH`)
- **What happens:** `TreasuryFinalizeService.finalizeDue` calls port `finalize` only when `now >= payload.deadlineMs`. The hours are `treasuryPolicy.vote.proposalTtlH` (6 real hours, `TREASURY_PROPOSAL_TTL_H`). One yes of three past that deadline becomes `Expired` and the DAO balance does not change. The same proposal stays `InProgress` when `finalizeDue` runs earlier. The mock `finalize` function still does not read a clock: a direct call expires a failing `InProgress` proposal immediately. An already `Approved` proposal is not debited again. Removed members' votes still do not count (W22-06).
- **Why it is like this:** W22-03 was told not to implement the deadline. The contract suite still calls `finalize` immediately, so the mock must keep expiring when asked. W22-09 is the clock.
- **Workaround / mitigation:** Call `finalizeDue`. Do not call port `finalize` before the deadline. The job does not.
- **To resolve:** Done for the deadline. A direct `finalize` stays immediate on purpose.
- **Found:** 2026-11-10, W22-03. Resolved 2026-11-10, W22-09.

### BE-77 · DAO membership follows the colony account row and `deedSettled`

- **Status:** Accepted (by design)
- **Area / code:** `backend/app/src/near/treasury/membership.service.ts`, `backend/app/src/near/treasury/lifecycle.bind.ts`, `backend/app/src/near/identity/colony-accounts.ts`, `backend/app/src/near/deed/deed-settled.service.ts`
- **What happens:** A member is the `near_colony_account` row for that colony, not the colony id. `colonyFounded` looks up the row (a few retries, then again after `ColonyAccounts` commits it) and calls `addMember` with `canPropose: true` (`opId = dao-member:{planetId}:{colonyId}`). A guest has no row, so they are not added. Accounts created later by social login (`ensureForLinkedPlayer`) are not backfilled onto the DAO. Elimination of a colony with no account, or of an account that was never a member, does not throw and does not change the count. `colonySettled` is not a registered event in this tree. `deedSettled` (emitted when the W20 settle outbox finishes) is the live wire: the colony stays a member with `canPropose: false`, or is added that way if they were not a member. W22 off adds and removes nothing.
- **Why it is like this:** W22-06 asked for colony accounts and for a settled event. The deed service already emits `deedSettled`. The sim `colonySettled` kind is not in the contract catalogue, so the bus rejects it outside production.
- **Workaround / mitigation:** Link the player before the colony is founded, or rely on the second `onFounded` after the account row is written. Seal the deed (`deedSettled`) to clear propose rights.
- **To resolve:** When `colonySettled` becomes a contract event, listen for it as well. Backfill login-time accounts only if the owner wants colonies that predate the link to sit on the council.
- **Found:** 2026-11-10, W22-06

### BE-73 · Mock escrow does not store `expiresAtMs`

- **Status:** Accepted (by design)
- **Area / code:** `backend/app/src/near/infrastructure/adapters/mock/escrow.adapter.ts` (`get`), `shared/db/prisma/mock-chain.prisma` (`MockChainEscrow`)
- **What happens:** `EscrowOpenInput` requires `expiresAtMs`, but `mock_chain_escrow` has no expiry column. `MockEscrowAdapter.get` always returns `expiresAtMs: 0`. A replay of `open` does not move tokens again; it also does not remember the original expiry.
- **Why it is like this:** W22-17 must not alter the W00 escrow table. The bounty service (W22-19, W22-24) owns the 2–48 h expiry and the refund job. Adding a column would need a new Prisma fragment and a migration this issue does not own.
- **Workaround / mitigation:** Callers that need the deadline keep it on the bounty row, not on the escrow. `0` means "not tracked here", and `EscrowView` still parses. The W22-18 contract suite asserts `expiresAtMs === 0` after an open that passed a non-zero deadline, and does not treat the dropped deadline as a failure.
- **To resolve:** Keep the deadline on the bounty (W22-19, W22-24). Do not make this suite require a round-trip. A real escrow (W23-38) may store expiry on chain; this mock still answers `0`.
- **Found:** 2026-11-10, W22-17

### BE-74 · A planet row insert does not itself open the treasury DAO

- **Status:** Accepted (by design)
- **Area / code:** `backend/app/src/near/treasury/lifecycle.service.ts` (`ensurePlanetDao`), `backend/app/src/near/treasury/lifecycle.bind.ts`, `backend/app/src/lobby/prisma-lobby.store.ts` (`provisionCanonicalWorld`), `backend/app/src/core/home/prisma-home.store.ts` (`upsertPlanet`)
- **What happens:** Inserting `core.planet` does not create `{planet}.dao.mock`. Lobby provision and home upsert are two writers, and the sim thread loads the world without going through either. The DAO opens when that sim planet finishes loading, and on `colonyFounded` if the planet still has none. `ensurePlanetDao` is the lazy path for a planet that already existed before W22 (Council, W22-08). A second call, including two in flight, keeps the one DAO. W22 off returns null and writes nothing. `GamePlanets.onPlanetLoaded` has no unsubscribe; after shutdown the bind ignores it.
- **Why it is like this:** W22-05 asked for one create path. There is not one. The DAO has to exist before W22-06 adds members on `colonyFounded`, so load is the earlier hook, and the colony event covers a planet that was already running.
- **Workaround / mitigation:** `GET /v1/near/treasury/:planetId` (W22-08) calls `ensurePlanetDao`. The outbox id is `dao-create:{planetId}`; a replay does not insert a second row.
- **To resolve:** Keep both hooks. Do not also call `ensurePlanetDao` from the two planet stores unless those stores gain one shared create function.
- **Found:** 2026-11-10, W22-05

### BE-75 · Treasury fee credit looks up `{planetId}.dao.mock` and does not move verifier USDC again

- **Status:** Accepted (by design)
- **Area / code:** `backend/app/src/market/settlement/treasury-fee.service.ts` (`termsFor`, `depositSettled`, `signerFor`), `backend/app/src/market/settlement/treasury-terms.ts`, `shared/sim/src/systems/trade/market-batch.ts` (`carveTreasury`)
- **What happens:** While W22 is on, each fill stores `treasury:{planetId}` or the DAO account from `daoAccountIdFor(planetId)` (`{slug}.dao.mock`). `TreasuryDaoPort.deposit` (`opId = treasury-fee:{tradeId}`) runs after the trade is FINAL, and only when `get` succeeds. A missing DAO leaves the trade FINAL with `treasuryAllocation` stored. `deposit` adds `balances[tokenId]` in the DAO policy and does not debit the verifier. The verifier already received the carve-out on the batch account. Dev and test seal a custodial key for that account on first use so the leg can be signed. In production a missing key is signed by `treasury.terraagent.mock` instead, so the stored leg account and the verifier credit can differ. A rollback rebuilds the treasury bucket only for fills that stored `treasuryAccountId`.
- **Why it is like this:** W22-05 owns creating the DAO. This issue must not create one, and a missing council must not fail a W13 trade. The buyer total and the stall fee stay the amounts W13 already charged.
- **Workaround / mitigation:** Create the DAO with `name` equal to the planet id before expecting a council balance. The allocation is still on `chain.intent_trade` when the DAO does not exist yet.
- **To resolve:** W22-05 should create `{planetId}.dao.mock` (or teach this lookup the stored dao account). A real chain adapter (W23) should not seal a dev key.
- **Found:** 2026-11-10, W22-07

### BE-76 · A chain bounty and the sim bounty are not the same post

- **Status:** Open
- **Area / code:** `backend/app/src/near/bounty/post.service.ts`, `backend/app/src/near/bounty/posted.listener.ts`, `backend/app/src/near/bounty/bounty.controller.ts`, `shared/sim/src/systems/bounty/handlers.ts`
- **What happens:** `POST /v1/bounties/:planetId` opens escrow and writes `chain.bounty`. It does not send `bounty.post` to the sim, and it does not check that the caller owns the colony. A socket `bounty.post` is screened first (vision, territory, cargo, the 3-active cap, the 2–48 h window). The sim then records `clear_nest` and `defend_area` under `bt:{colony}:{tick}`. Escrow for that id opens when `bountyPosted` arrives. If that open throws, the sim bounty stays and the chain row is absent; cargo is unchanged. `deliver_units` can open a chain escrow over HTTP. The sim handler still rejects it. The chain row is completed from cargo transfers (BE-79), not from a sim blob.
- **Why it is like this:** W22-20 already records `clear_nest` inside the sim and must keep doing so. The chain id is not known until that handler runs. W22-21 owns `defend_area`. W22-22 completes the chain row and does not add a sim rule. W22-25 owns the board, which should post on the player's socket.
- **Workaround / mitigation:** The precheck stops an unseen nest before the sim. A retried chain id reuses `bounty-open:{bountyId}`, so cargo is not taken twice. Expiry is the bounty row (`expiresAt`), not escrow `get` (BE-73).
- **To resolve:** Have the board post over the socket. Require the session colony on `POST /v1/bounties/:planetId`. Do not teach the sim `deliver_units` unless the owner wants one id in both places (BE-79).
- **Found:** 2026-11-10, W22-19

### BE-78 · A guild subsidy schedules a visit row and does not quote

- **Status:** Accepted (by design)
- **Area / code:** `backend/app/src/near/treasury/guild-subsidy.ts` (`applyGuildSubsidy`, `scheduleExtraVisit`), `shared/db/prisma/near-treasury.prisma` (`ChainGuildVisit`)
- **What happens:** `applyGuildSubsidy` inserts one `chain.guild_visit` row (`subsidy` true, `organic` false, `arrives_at` one hour ahead). A second call inserts a second row. W22 off writes nothing. W15 off does not skip the row. There is no Guild quote engine, so nothing labels quotes. The Council form lists `guild_subsidy` whenever `GET /v1/near/treasury/:planetId` includes it in `projects` (W22-14). It does not check W15. `TreasuryFinalizeService` calls `applyGuildSubsidy` once when it posts an approved `guild_subsidy` effect (W22-09). A second `finalizeDue` does not insert another row. The row has no `npc_id`, `depart_at`, or `offers` (DATA_MODEL sketch); W15 must alter this table, not create it.
- **Why it is like this:** W15-09's `scheduleExtraVisit` and quote engine are absent. D-45 says a subsidy visit is never organic. The `organic` column false is that guarantee.
- **Workaround / mitigation:** The finalize job inserts the row. It stays `organic` false.
- **To resolve:** W15 should add quotes without setting `organic`. Hide `guild_subsidy` in the Council form only when the API omits that project.
- **Found:** 2026-11-10, W22-12

### BE-79 · deliver_units completes the chain row from cargo transfers

- **Status:** Accepted (by design)
- **Area / code:** `backend/app/src/near/bounty/deliver.service.ts` (`onTransfer`), `backend/app/src/near/bounty/pay.service.ts` (`pay`), `backend/app/src/near/bounty/deliver.ledger.ts`, `backend/app/src/near/cargo/cargo-transfer.hook.ts`, `backend/app/src/near/infrastructure/adapters/cargo/mock-cargo-token.adapter.ts` (`transfer`), `chain.bounty_delivery`
- **What happens:** A mock cargo `transfer` that resolves notifies one process-wide watcher. While W22 is on, a destination equal to the poster's `accountId`, a token equal to the `deliver_units` resource, and a sender equal to `claimerAccountId` inserts `chain.bounty_delivery` (primary key bounty id + opId) with the base-unit amount. The same opId does not add twice. When the sum reaches the target and `expiresAt` is still ahead, `chain.bounty.state` becomes `completed`. 99 of 100 stays `claimed`. A later transfer that makes up the rest completes it. A transfer after expiry, to another account, from an account that is not `claimerAccountId`, or while W22 is off, is not stored. A transfer after `completed` does not change the state. The same transfer is applied in full to every matching bounty. On that transition `BountyPayService.pay` calls `EscrowPort.claim` with `opId = bounty-pay:{id}` and `caller` the claimer. Success sets the row to `paid` and the escrow to `claimed`. A second pay replays the receipt and does not credit again. If `claim` throws, the row stays `completed` and the escrow stays `open`. No `bountyCompleted` sim event is emitted. The sim still rejects `bounty.post` of `deliver_units` (GP-119). Only `MockCargoTokenAdapter.transfer` notifies. A `fail_after` that throws after the receipt is stored is counted when that same opId is retried.
- **Why it is like this:** W22-22 is observed from cargo transfers, not a sim rule. BE-76: the chain bounty and the sim bounty are different posts. W22-23 pays a `completed` row through the same opId, including `deliver_units`, and does not add a sim rule.
- **Workaround / mitigation:** `BountyClaimService.claim` sets `state = claimed` and `claimerAccountId` before the transfer. Water sent before that, or while W22 was off, does not count later. A real cargo adapter must call `notifyCargoTransferred` or its transfers never complete a bounty.
- **To resolve:** W23's cargo adapter should call the same hook. Do not add a sim `deliver_units` rule unless the owner wants one id in both places.
- **Found:** 2026-11-10, W22-22

### BE-80 · Council propose does not start the sim effect

- **Status:** Resolved (W22-09)
- **Area / code:** `backend/app/src/near/treasury/proposals.service.ts`, `backend/app/src/near/treasury/finalize.service.ts`, `backend/app/src/near/treasury/treasury.controller.ts`, `backend/app/src/ws/ws.gateway.ts` (`broadcastTreasuryProposal`)
- **What happens:** A vote that passes still debits the DAO on that vote (the mock, BE-71) and this API still does not send `system.treasuryEffect`. `TreasuryFinalizeService` sends that command once for an `Approved` proposal, including one that already passed before the deadline (W22-09). `GET /v1/near/treasury/:planetId` still returns `effects: []` (BE-82). Kinds are the three W22 table rows; W05/W15 do not hide `terraform_boost` or `guild_subsidy`. The caller is the bearer session's colony account on that planet (`core.colony` plus `near_colony_account`). When `NODE_ENV=test`, body `colonyAccountId` or header `x-colony-account-id` is accepted instead (body wins) and is ignored otherwise. One open proposal per colony is checked on the DAO view before `propose`. Two concurrent first proposes from the same colony share `opId` `dao-propose:{planet}:{account}:1`, so the mock replays one row. `near.treasury.proposal` is emitted and the gateway broadcasts `treasury.proposal` to the planet room.
- **Why it is like this:** W22-08 was told not to run the 6 h finalize job and not to start the sim effect. The job does that now. Integration tests have no session, so the test account field exists only there. Hiding a kind when another wave is off is W22-11 and W22-12.
- **Workaround / mitigation:** A project the balance cannot cover throws `TREASURY_INSUFFICIENT` (HTTP 409) and writes no proposal. The shield and the boost start when the finalize job can post into a loaded planet.
- **To resolve:** Done for the effect command. The empty `effects` list is BE-82. W22-11 and W22-12 drop kinds whose waves are off.
- **Found:** 2026-11-10, W22-08. Resolved 2026-11-10, W22-09.

### BE-81 · Mock agent wallet only creates mercenary sub-accounts

- **Status:** Accepted (by design)
- **Area / code:** `backend/app/src/near/infrastructure/adapters/mock/agent-wallet.adapter.ts`, `backend/app/src/near/mercenary/accounts.service.ts`
- **What happens:** W15-03 has not landed, so this branch's mock `AgentWalletPort` implements `createSubAccount` only. The same `opId` replays the stored receipt. The same account id does not insert a second row. `addLimitedKey` and `revokeKey` reject with `NEAR_UNAVAILABLE` and store no allowance. The parent `npc.terraagent.mock` is not created. A database error on boot is logged and does not stop the app; the next boot tries again.
- **Why it is like this:** W22-27 has to create `merc-N.npc.terraagent.mock` through the port. Copying the unlanded W15 key ledger would collide with that wave. The funding cap stays on the roster row (LED-33) and is not minted.
- **Workaround / mitigation:** Hire and payout code must keep using the roster `fundingCap`. Do not treat a successful boot as a funded balance.
- **To resolve:** When W15-03 lands, replace this adapter with its allowance ledger. The seeder's stable `merc-account:{accountId}` opId still replays, and `NEAR_ACCOUNT_EXISTS` is treated as already created.
- **Found:** 2026-11-10, W22-27

### BE-82 · Council effect list stays empty and a missed sim post is not retried

- **Status:** Open
- **Area / code:** `backend/app/src/near/treasury/finalize.service.ts` (`post`, `tickOf`), `backend/app/src/near/treasury/council-view.ts` (`effects`), `backend/app/src/game/game-planets.service.ts` (`submit`)
- **What happens:** `GET /v1/near/treasury/:planetId` still returns `effects: []`. The finalize job stores `system.treasuryEffect` on the proposal JSON (`effectCommand`, `effectPosted`) and calls `GamePlanets.submit` once. If the planet is not loaded, `submit` returns `thread_down` and the job does not try again. `untilTick` is the loaded planet tick, else the latest snapshot tick, else 0, plus `durationH` at 200 ms per tick. A command built at tick 0 is already over on a planet that has moved past that `untilTick`. `guild_subsidy` still inserts one `chain.guild_visit` when the effect is claimed. A direct `TreasuryDaoPort.finalize` still expires an `InProgress` proposal immediately (BE-72).
- **Why it is like this:** W22-09 posts the module command. It does not own the council read model (W22-14) and does not keep a retry queue after the one stored command.
- **Workaround / mitigation:** Load the planet before `finalizeDue` if the shield must start at the live tick. Do not call port `finalize` before the deadline.
- **To resolve:** Read active effects from the sim blob on the council GET, and retry `submit` while the planet is down without sending a second command after `ok`.
- **Found:** 2026-11-10, W22-09

### BE-83 · One chain claimer, and `bounty.paid` only while the planet is loaded

- **Status:** Accepted (by design)
- **Area / code:** `backend/app/src/near/bounty/claim.service.ts`, `backend/app/src/near/bounty/pay.service.ts` (`tellSim`, `replay`), `backend/app/src/near/bounty/lifecycle.listener.ts`
- **What happens:** `chain.bounty.claimer_account_id` stores one account. A second `clear_nest` caller overwrites it. `defend_area` and `deliver_units` reject a different caller with `queue_full`. The same caller claiming again is a no-op. W22 off rejects `claim` with 404. On `bountyCompleted`, the listener writes the sim winner's colony account (resolved the same way as a post) and sets `completed`, then `EscrowPort.claim` pays that account. `bounty.paid` is `GamePlanets.submit` with `source: 'near'` only when that planet is loaded. `unknown_entity` is treated as nothing left to mark, which is the `deliver_units` case (no sim row). If the planet is not loaded, the chain row still becomes `paid` after the receipt, and the next process start retries `bounty.paid` while the outbox payload lacks `simPaid`. A chain-only `deliver_units` post never emits `bountyClaimed`; `BountyClaimService.claim` is what records the caller. Rows left `completed` are paid again at process start, replaying `bounty-pay:{id}` when the receipt already exists.
- **Why it is like this:** The table has one claimer column. The sim names the nest winner and does not move cargo (W22-23). The mock escrow replays `opId`.
- **Workaround / mitigation:** Call `BountyClaimService.claim` for a deliver bounty. A second `pay` with the same opId does not credit the claimer again.
- **To resolve:** A claimer list would be a schema change. W22-25's claim button should call `BountyClaimService` for `deliver_units`.
- **Found:** 2026-11-10, W22-23

### BE-84 · A mercenary cancel refunds the unused metals and does not pay the squad

- **Status:** Question for the owner
- **Area / code:** `backend/app/src/near/mercenary/hire.service.ts`, `backend/app/src/near/mercenary/hire-math.ts` (`refundSplit`), `backend/app/src/near/mercenary/spawn-submit.ts`, `backend/app/src/near/infrastructure/adapters/mock/escrow.adapter.ts` (`refundOpen`)
- **What happens:** A hire is a `defend_area` bounty. Escrow is `hours × pricePerGameHour` from the roster table (light 100 `metals.t1`, so 2 h is 200). The beneficiary is the escrow hold (BE-70). The squad account is `claimerAccountId` and the row is `claimed`. Cancel floors the served metals (`paid = floor(total × elapsed / duration)`) and refunds the rest, so 1 h of that 2 h hire refunds 100 and leaves 100 in the hold. The bounty row becomes `refunded`. The mercenary balance does not move. A cancel at the start refunds the whole hold and closes the escrow. A cancel at or after the end refunds 0 and leaves the full hold `open`. `refund` with an `amount` smaller than the hold is what returns only the unused part; omitting `amount` still returns everything. Hours are whole design hours (the bounty 2–48 h window and `defend.ts`'s 18000 ticks), not 1/24 of a planet day. `mercenary.spawn` is submitted only when `GamePlanets` has that planet loaded. The hire integration test has no sim thread, so it checks `spawnOrder` against the command schema and does not place units. The funding cap (LED-33) is the sum of this account's open and claimed rewards plus the new total; two hires at the same moment can both pass. The cap is not minted. A mercenary hire of 1 design hour is allowed (BE-87). A player bounty post is still 2–48 h.
- **Why it is like this:** W22-30 owns paying the mercenary for time served. This cancel must not pay them the refunded half, and `EscrowPort.refund` previously closed the whole hold. The roster says "per game-hour" (LED-32) but the defend contract is measured in design hours.
- **Workaround / mitigation:** Read the poster's cargo for the refund and the escrow hold for the floored served part. Cancel still does not pay the squad. `MercenaryPayoutService.payout` claims that open remainder (`opId` `bounty-pay:{id}`, caller `claimerAccountId`) and sets the row to `paid`. Load the planet before expecting units.
- **To resolve:** Owner: confirm a billed hour is a design hour, not a solar game-hour. The open-remainder claim is W22-30.
- **Found:** 2026-11-10, W22-28

### BE-85 · Away colonies abstain; the director is not asked to vote

- **Status:** Accepted (by design)
- **Area / code:** `backend/app/src/near/treasury/proposals.service.ts` (`vote`), `backend/app/src/near/treasury/away-notice.service.ts`, `backend/app/src/near/treasury/away-colonies.ts`
- **What happens:** No process calls `TreasuryDaoPort.vote` for an away colony. The AI director is not invoked. `POST …/proposals/:id/vote` while that colony has an open `world.planet_event_digest` row (`closedAt` null) on the planet throws `away_policy` (HTTP 409) and writes no vote. A colony with no open digest, including a present member, still votes. `TreasuryAwayNoticeService` polls every 60s and never votes. When W09 and W22 are on, each away member gets one `NotifierPort` payload, kind `council_proposal` (not a CT-36 toggle), body `Planet council: N open proposal` or `proposals`. The event id is `council-open:<planetId>:<sorted proposal ids>`. The mock store's unique key means a second poll of the same open set does not insert another row. A newly opened proposal changes the id and queues a new note. W09 off sends nothing. Away is the open digest, not a live read of `blobs.presence`. A colony marked away in the sim before that row exists is treated as present for this guard and is not notified. The HTTP reject is not counted in `away_policy_rejections_total` (that counter is sim `cmd.reject` only).
- **Why it is like this:** W22-16 abstains by not calling the director (AW-14). AW-23 would let a player command through, but a council vote is a chain action and the issue asked for no automatic vote plus a guard while away. The digest is the server row `colonyAway` already opens.
- **Workaround / mitigation:** Come back (`colonyBack` closes the digest) and vote. The note says how many proposals are open.
- **To resolve:** If the owner wants AW-23 to win, drop the HTTP reject and keep the missing auto-vote. Reading `blobs.presence` would catch away before the digest opens.
- **Found:** 2026-11-10, W22-16

### BE-86 · Treasury console hire now opens escrow; bounty.complete still needs a claimer

- **Status:** Resolved (1fbdc801)
- **Area / code:** `backend/app/src/near/treasury/dev-console.command.ts`, `backend/app/src/near/treasury/dev-console.handlers.ts` (`runMercHire`), `frontend/game/features/treasury/devCommands.ts`
- **What happens:** `merc.hire <hours>` now calls `MercenaryHireService.hire` for the light roster. That opens the defend escrow (whole hours × the table price) and submits `mercenary.spawn`. A fractional hour is rejected. `bounty.complete` is unchanged: pay still runs only when a claimer is stored or passed. W22 off still answers 404.
- **Why it is like this:** W22-36 needed the console squad to be the hire, not a spawn that skipped escrow. The chain post and the sim post stay two paths (BE-76).
- **Workaround / mitigation:** None for the hire. Claim the bounty first, or pass `bounty.complete <id> <claimerAccount>`, so pay runs.
- **To resolve:** Done for the console hire. A board post should keep using the socket so the sim id and the chain id stay one bounty (BE-76).
- **Found:** 2026-11-10, W22-35; console hire wired 2026-11-11, W22-36

### BE-87 · A wiped squad is paid from the bounty clock, and a lost leave event is not retried

- **Status:** Accepted (by design)
- **Area / code:** `backend/app/src/near/mercenary/payout.service.ts` (`payout`, `settleOpen`), `backend/app/src/near/mercenary/payout.listener.ts`, `backend/app/src/near/bounty/pay.service.ts` (`claimEscrow`)
- **What happens:** `mercenaryLeft` with reason `wiped` pays `floor(total × elapsed / duration)` using `Date.now()` against the chain window (`expiresAt − durationH`). Reason `ended` pays the full window even when the wall clock is short. Reason `cancelled` does nothing. A served share of 0 refunds the poster and marks the row `refunded`. A share above 0 refunds the rest, claims the open hold for the squad, and marks the row `paid`. The claim uses `bounty-pay:{id}`, the same op as W22-23, so a second claim does not move metals. If that claim already ran, this service does not refund; the claimer keeps the whole hold that claim paid. W22 off returns null and writes nothing. The leave event is in-process. A restart after the wipe does not settle the escrow. The service does not submit `bounty.paid` (the hire is a chain row plus `mercenary.spawn`, not a sim bounty).
- **Why it is like this:** The leave event has no served fraction, and `warp` does not move `expiresAt`. Cancel (BE-84) already refunds the unused part and must keep doing so. Sharing `bounty-pay:{id}` is what stops a double pay.
- **Workaround / mitigation:** Call `payout` with `nowMs` at the wipe. Do not call it for a `cancelled` leave. If W22-23 has already claimed the id, do not expect a poster refund.
- **To resolve:** Put the served fraction on `mercenaryLeft`, or settle from the planet tick, and retry unsettled hires after a restart.
- **Found:** 2026-11-10, W22-30

### BE-88 · An expired bounty is stored as `refunded`; the board word is Expired

- **Status:** Accepted (by design)
- **Area / code:** `backend/app/src/near/bounty/expiry.service.ts` (`refundDue`, `refundIfOpen`), `backend/app/src/near/bounty/view.ts` (`bountyBoardLabel`), `backend/app/src/near/bounty/lifecycle.listener.ts`, `chain.bounty`
- **What happens:** `refundDue(nowMs)` selects `open` or `claimed` rows with `expiresAt <= nowMs`. It does not read escrow `get` (that `expiresAtMs` is 0, BE-73). `EscrowPort.refund` with `opId = bounty-refund:{id}` and no `amount` returns the whole remaining hold to the escrow opener, which is the poster's `accountId`. The row becomes `refunded`. There is no reason column. `bountyBoardLabel` (and `board` on `GET /v1/bounties/:planetId`) says `Expired` for every `refunded` row (W22-36). A refund that lands before `expiresAt` uses the same word. A second `refundDue` does not select the row and does not credit again. `paid` and `completed` are not refunded (`completed` stays for `BountyPayService`). W22 off returns `{ refunded: 0 }` and moves no cargo. Eliminating the poster drops the DAO member (W22-06) and leaves `near_colony_account` and the bounty `accountId`; the refund credits that account. A claimer ending in `.npc.terraagent.mock` is skipped by the clock so W22-30 can still `claim` the open hold. Sim `bountyRefunded` calls `refundIfOpen`, which refunds an `open` or `claimed` row even before `expiresAt` and even for a mercenary claimer. A mercenary cancel that already set `refunded` via `merc-refund` is not touched, so the floored remainder stays in the open escrow (BE-84). The job does not emit `bountyExpired`.
- **Why it is like this:** W22-24 stores one state, `refunded`, and the board word is derived. Adding `expired` or a reason column would be a migration this issue does not own. A full clock refund must not close a mercenary contract that reached its end still `claimed`.
- **Workaround / mitigation:** Read `board`, or `state === 'refunded'` and `expiresAt <= now`, for the Expired list. Do not treat escrow `get` as the deadline. W22-30 should `claim` a mercenary hold before relying on this job, and should not expect a clock refund of `*.npc.terraagent.mock`.
- **To resolve:** If the owner wants the word in the database, add a reason column and keep the refund op idempotent. W22-30 should pay time served from the open hold, then refund any remainder with its own op, not by deleting this skip.
- **Found:** 2026-11-10, W22-24

### BE-89 · An eliminated claimer reopens the chain bounty, not the sim blob

- **Status:** Open
- **Area / code:** `backend/app/src/near/bounty/bounty.repository.ts` (`reopenClaimedBy`), `backend/app/src/near/bounty/lifecycle.listener.ts` (`reopen`), `shared/sim/src/systems/bounty/blob.ts`
- **What happens:** `colonyEliminated` resolves the colony account and sets every `chain.bounty` row in `claimed` for that account back to `open`, with `claimerAccountId` cleared. `completed`, `paid`, and other claimers stay. The escrow id and the poster's hold are not refunded. W22 off ignores the event. The sim bounty blob still lists that colony index in `claimers`. A later `bountyCompleted` from the sim can name them again, and the listener will mark the chain row `completed` and pay that account.
- **Why it is like this:** W22-33 reopens the chain row the board reads and says not to drop the poster's escrow. The sim blob has no `colonyEliminated` handler, and clearing it would be a second store.
- **Workaround / mitigation:** The chain board shows the bounty `open` with no claimer, so another colony can `bounty.claim`. Do not expect the sim claimer list to drop on the same event.
- **To resolve:** On `colonyEliminated`, drop that colony from sim bounty `claimers` while the bounty is not completed, and ignore an eliminated colony in `bountyCompleted`.
- **Found:** 2026-11-10, W22-33

### BE-90 · Away mercenary hire is capped by the player max, not the session percent

- **Status:** Accepted (by design)
- **Area / code:** `backend/app/src/near/mercenary/away.service.ts`, `backend/app/src/near/mercenary/away-pick.ts`, `shared/sim/src/systems/away/store.ts` (`hireMercenaries`, `mercenaryMaxSpend`), `shared/contracts/src/commands/set-autopilot.ts`, CONTINUITY AW-20, Q-05-15
- **What happens:** `setAutopilot` stores `hireMercenaries` (default false) and `mercenaryMaxSpend` (default 0, whole metals, max 1_000_000) on the existing away blob. There is no second settings store. The ColonyBook AWAY tab, when W22 and W09 are on, shows "Hire mercenaries when attacked while away" and a whole-metals max. Both live in the same `ta.away.autopilot` record and go out on `setAutopilot`. W22 off hides them and does not send them. W09 off hides the tab. On `raidStarted` or `underAttack`, if W22 and W09 are on, the colony is away, the switch is on, and the 1 h price fits the max, `MercenaryHireService.hire` posts one light squad (100 `metals.t1`). Reserve is the same size and price; light wins the tie. Heavy is 200 and is not picked while light fits. A max of 50 hires nothing. A second raid hires nothing while that mercenary bounty is `open` or `claimed`. W09 off or W22 off hires nothing. The defend tile is the raid tile when the colony owns it, else the HQ, else the first owned tile. A raid with no colony index is colony 0. Away is the sim presence or open session, or an open `world.planet_event_digest` row. The hire is defense: `chargeAwaySpend` with purpose `defense` does not move `session.spent`, so a 0 % metals session still hires. The digest line is an `ai.highlights` summary `Hired light squad for 100 metals.t1`, saved on the open row. No open row means the hire still stands and the line is dropped. The 21st highlight is dropped (CT-31). A 1 h hire is inside the mercenary expiry floor; player bounty posts stay 2–48 h. The squad spawns only when the planet host is loaded (BE-84). No cargo, or no owned tile, hires nothing and writes no line.
- **Why it is like this:** W22-31 asks for a player max and for the spend to count as defense (AW-20), which is uncapped. Q-05-15 asked which cap wins. W22-31 and W22-38 keep both (the proposed default): the player max is the mercenary cap, and the session percent does not block this hire because it is defense. "Uncapped under AW-20" means the session percent, not "ignore the player max". The bounty window is 2 h, so the hire path lowers only its own expiry floor to 1 h.
- **Workaround / mitigation:** Set the max to at least 100 on the AWAY tab before leaving. Come back to stop a further hire after the contract ends. Read the highlight on the digest, not the headline alerts (FF-102).
- **To resolve:** Owner confirms Q-05-15. Do not delete `mercenaryMaxSpend`. Point `merc.hire` at the same hire service if the console must open escrow (BE-86).
- **Found:** 2026-11-10, W22-31; AWAY tab wired 2026-11-11, W22-38

### BE-91 · Council analytics has one writer per name, and `open` is a counter label

- **Status:** Accepted (by design)
- **Area / code:** `backend/app/src/near/telemetry/w22-telemetry.service.ts`, `frontend/game/features/treasury/analytics/treasuryTracker.ts`, `frontend/game/features/bounty/bountyEvents.ts`, `MercenaryHireService.hire`
- **What happens:** The client `track()` call writes only `council_opened`, when the Council sheet opens and consent is on. The server inserts `proposal_created`, `vote_cast`, `bounty_posted`, `bounty_claimed`, `bounty_paid` and `mercenary_hired`. The treasury and bounty features list those names in `Feature.analytics`, but the client does not send the six server names. `treasury_proposals_total` uses `result=open` when a proposal is stored `InProgress`, and `approved`, `rejected` or `expired` only when that status is newly stored. A vote that stays `InProgress` does not increment again. The mock never writes `Rejected` (a failing vote stays open until the deadline, then `Expired`), so `result=rejected` is only incremented if a `Rejected` row is stored. A mercenary hire opens a `defend_area` bounty with `playerPost: false`, so it records `mercenary_hired` and not `bounty_posted` or `bounty_claimed`. Cancel and a pro-rata payout do not increment `mercenary_contracts_total`. `merc.hire` does, because it now calls `MercenaryHireService` (BE-86). `treasury_balance` omits a planet with no DAO row.
- **Why it is like this:** Two writers for one name would put two rows in `core.analytics_event`. Counting `open` at propose, and the terminal label later, keeps both "proposals opened" and "proposals decided" on one counter. Treating a hire as a player bounty post would make the demo story show `bounty_posted` twice.
- **Workaround / mitigation:** Read `council_opened` from the consented intake and the other six from the server recorder. Use `result=open` for proposals that are still in progress. Do not expect `bounty_posted` for a mercenary contract.
- **To resolve:** If the owner wants a hire to count as a bounty post as well, drop `playerPost: false` and accept two `bounty_posted` rows in a story that also posts a player bounty. If `Rejected` should be reachable, store that status from a vote and the existing counter label will move.
- **Found:** 2026-11-10, W22-34

### BE-92 · `bounty.expire` runs the shared refund sweep

- **Status:** Accepted (by design)
- **Area / code:** `backend/app/src/near/treasury/dev-console.handlers.ts` (`runBountyExpire`), `backend/app/src/near/bounty/expiry.service.ts` (`refundDue`)
- **What happens:** `bounty.expire <id>` sets that one player row's `expiresAt` one second into the past, then calls `refundDue(now)`. The sweep refunds every open or claimed player bounty that is already due, not only `<id>`. A second call on the same id finds the row `refunded` and does not pay again. A claimer ending in `.npc.terraagent.mock` is not updated and `refundDue` is not called for that command. The 60s clock still skips those mercenary rows (BE-88). Sim `warp` still does not move `expiresAt`.
- **Why it is like this:** W22-36 asked the console to reuse `refundDue` instead of a second refund path. The sweep is already the idempotent refund.
- **Workaround / mitigation:** Expire a player bounty only when no other player bounty is already past `expiresAt`, or accept that those rows refund in the same call.
- **To resolve:** Give `refundDue` an optional id filter if the console must not touch other due rows.
- **Found:** 2026-11-11, W22-36

### BE-110 · Bonded Peace Treaties & `6h` War Escrows (`DiplomacyEscrowService`), `slash_escrow` `90% / 10%` split, and operator-gated `bounty.<root>`

- **Status:** Resolved (live Testnet redeploy `2Uw4SkRkKedPtTtjzyewAFy2N5jnAcgB9HnKpPS7aSua`, 2026-11-14)
- **Area / code:** `backend/near-contracts/bounty/src/lib.rs` (`open_escrow`, `refund_escrow`, `slash_escrow`), `backend/app/src/near/application/ports/escrow.port.ts` (`slash`), `backend/app/src/near/infrastructure/adapters/{mock/escrow.adapter.ts,real/testnet-escrow.adapter.ts}`, `backend/app/src/near/diplomacy/{diplomacy-escrow.service,diplomacy-escrow.listener}.ts`, `shared/sim/src/systems/diplomacy/parts/{truceLifecycle,warBonds}.ts`, `shared/sim/src/systems/away/eliminate.ts`
- **What happens:**
  1. **Bonded Peace Treaties (`2h–72h`) & `6h` War Bonds (`108_000` ticks at `5 Hz`):** Optional bilateral truce bonds lock matching `NEAR` or `NEP-245` cargo escrows (`diplomacy-truce:<a>:<b>:<tick>:side:<col>`) once accepted; peaceful expiry refunds `100%` to both colonies, while early `cancelTruce` slashes the breaker's bond **`90%` (`victimBp = 10_000 - NEAR_ESCROW_SLASH_PROTOCOL_BP`) to the betrayed partner + `10%` (`NEAR_ESCROW_SLASH_PROTOCOL_BP = 1000`) to `TerraAgent Protocol` (`protocol.<root>`)** and refunds the betrayed partner's bond `100%`. Declaring war (`diplomacy.declareWar`) with an optional `bond` opens `diplomacy-war:<attacker>:<defender>:<tick>` for `6h` (`WAR_DURATION_TICKS = 108_000`), doubles raider `siphonCarryCap` (`40 -> 80`), and tracks `structuresDestroyed` (`>= 1`) and `resourcesSiphoned` (`>= 200`); achieving either objective before expiry refunds `100%`, whereas early `diplomacy.cancelWar`, attacker colony elimination during war (`attacker_eliminated`), or `6h` timer expiry without hitting an objective slashes **`90%` to the Defender + `10%` to `TerraAgent Protocol`**.
  2. **Account normalization (`--` -> `-`) & deterministic chain errors:** `DiplomacyEscrowService.accountFor` normalizes `/[-_]{2,}/g` to `'-'` (`pl1-col_0.terraagent.mock`) when no `near_colony_account` DB row exists in unit tests, and `DiplomacyEscrowService` abandons outbox jobs only on deterministic `NearException` codes (`NEAR_INSUFFICIENT_BALANCE`, `NEAR_ESCROW_ALREADY_SETTLED`, `NEAR_ESCROW_NOT_OPEN`, `NEAR_NOT_OWNER`) so transient RPC hiccups retry normally via `OutboxRelayService`.
  3. **Operator-only `bounty.<root>` & idempotent cargo transfers:** `bounty/src/lib.rs` (deployed live on `bounty.terraagent.testnet`, codeHash `79UNK5jUfEWWQYtBjSqD69UyKEw6vVGmUSrtBGy1ow2e`, txHash `2Uw4SkRkKedPtTtjzyewAFy2N5jnAcgB9HnKpPS7aSua`) restricts `open_escrow`, `claim_escrow`, `refund_escrow`, and `slash_escrow` to `operator`, rejects `amount == 0` and self-victim slashes (`NEAR_ESCROW_INVALID_VICTIM`), computes basis-point splits without `u128` overflow, caps derived escrow hold account IDs (`hold-<hex>.<root>`) at `<= 64` chars, and skips `res.<root>::operator_transfer` when `tokenId === 'NEAR'`.
- **Why it is like this:** Keeps deterministic `@terra/sim` ticks non-blocking while relaying escrow locks/refunds/slashes asynchronously via `DiplomacyEscrowListener`.
- **Workaround / mitigation:** Verified live on `bounty.terraagent.testnet` (`npm run contract:real -- --port Escrow` 8/8 passed); `TestnetEscrowAdapter.slash()` also retains a `MethodNotFound` fallback for legacy deployments.
- **To resolve:** Resolved on Testnet; if native `NEAR` war/peace bonds on Mainnet should attach payable `yoctoNEAR` deposits directly to `bounty.terraagent.near::open_escrow` from browser wallets, add wallet-signed `#[payable]` attached-deposit transfers alongside `BE-114`.
- **Found:** 2026-11-13, Diplomacy & War Escrow slashing implementation; resolved on Testnet 2026-11-14.

### BE-111 · X social login requires enabling the `twitter` connection on the Auth0 tenant; existing named NEAR sub-accounts keep their original account ID

- **Status:** Resolved (owner enabled `twitter` social connection on Auth0 & verified live X login, 2026-11-14)
- **Area / code:** `frontend/design/pilot/mockToken.ts` (`buildFastAuthLoginUrl`, `consumeFastAuthRedirect`), `backend/app/src/near/identity/account-name.ts` (`deriveSocialAccountName`, `isAutoGeneratedSocialHandle`), `backend/app/src/near/identity/social-link.ts` (`maybeUpgradeHandle`)
- **What happens:** Auth0 social sign-in derives new pilot handles and `{name}.pilots.terraagent.*` / `{name}.terraagent.*` NEAR sub-accounts from OIDC profile hints (`preferred_username`, `screen_name`, `nickname`, `email` local-part, `name`) while keeping `payload.sub` (`google-oauth2|...`, `twitter|...`) as the unique `core.social_identity.subject`. On re-login, a player whose `core.player.handle` was auto-generated from an opaque OAuth subject (e.g. `google-oauth2-106920817337195603`) has `player.handle` upgraded in place, whereas any already-allocated `accountId` in `core.social_identity` / `chain.near_colony_account` is preserved so sealed keys, deeds, badges, and cargo balances are never orphaned. Clicking **X** sends `connection=twitter` (overrideable via `VITE_NEAR_FASTAUTH_X_CONNECTION`) and surfaces the Auth0 profile's X username cleanly.
- **Why it is like this:** Rotating an already-created NEAR sub-account would strand on-chain assets and violate W06-08 key stability.
- **Workaround / mitigation:** `twitter` social connection enabled and toggled ON for the TerraAgent Auth0 application (`GhPTEx5u0o5Bh16F6LWjPXOXAyQROUNL`).
- **To resolve:** Resolved on live Auth0 tenant 2026-11-14.
- **Found:** 2026-11-13, Auth0 Google/X review (renumbered from duplicate `BE-93`; resolved 2026-11-14).

### BE-112 · Hybrid Testnet Intents vs live `intents.near` Mainnet, cold-root `pilots.<root>`, and post-claim non-custodial orderbook rules

- **Status:** Accepted (by design)
- **Area / code:** `backend/app/src/near/infrastructure/adapters/real/testnet-intents.adapter.ts`, `backend/app/src/near/infrastructure/adapters/real/mainnet-intents-rpc.ts`, `backend/app/src/near/infrastructure/adapters/real/testnet-identity.adapter.ts`, `backend/app/src/market/orders/{parts/place-draft.ts,place-order.service.ts}`, `backend/near-contracts/pilots/src/lib.rs`
- **What happens:**
  1. **Hybrid Testnet (`NEAR_MODE=testnet`) vs Direct `intents.near` Mainnet (`NEAR_MODE=mainnet` + `NEAR_ALLOW_MAINNET=1`):** Because NEAR's canonical `intents.near` verifier contract has no official public `.testnet` deployment (`Q-007`), `NEAR_MODE=testnet` executes canonical NEP-413 `token_diff` signatures and `checkBatchStatic` conservation checks against Postgres-backed settlement while syncing real NEP-245 cargo balances on `res.<root>.testnet` and fetching live 1Click `dry: true` quotes. Flipping `NEAR_MODE=mainnet` + `NEAR_ALLOW_MAINNET=1` switches `IntentsPort` and `IntentsBalanceReadPort` directly to live `intents.near`: `buildMainnetSaltNonce` prefixes `intents.near::current_salt` (4 bytes) ahead of the deterministic 28-byte trade-nonce tail so retries never double-settle, `ensureMainnetIntentsKeyRegistered` registers signer `ed25519:` public keys via `intents.near::has_public_key` / `add_public_key` (`1 yoctoNEAR`), and `deposit`/`simulate`/`execute`/`withdraw` call `mt_transfer_call`, `ft_transfer_call`, `simulate_intents`, `execute_intents`, and `mt_withdraw`/`ft_withdraw`. Unprovisioned 5-segment colony sub-accounts (`{col}.{pilot}.pilots.<root>`) transparently resolve signing to their provisioned `ownerAccountId` (`{pilot}.pilots.<root>`).
  2. **Cold root key via `pilots.<root>`:** When `NEAR_ROOT_SECRET_KEY` is omitted (or `NEAR_USE_PILOTS_FACTORY=true`), `IdentityPort.createNamedAccount` calls `pilots.<root>.create_pilot_account` (codeHash `6nKVXYo46jG61ZUB1VUogGwC1ennpDzEWzqAGKQguU4z`, callback-confirmed via `#[private] on_pilot_created` with 18 reserved system labels and storage-reserve checks) signed by `relayer.<root>` (`minter.<root>` fallback), creating `{label}.pilots.<root>` sub-accounts without holding the root `FullAccess` key on the backend.
  3. **Post-claim non-custodial key wipe (`encryptedSecret === 'claimed'`) & resting-order eviction:** `AccountClaimService.claimColonyAccount` enforces `colony.playerId === request.playerId`, verifies a live NEP-413 `walletSignature` against `FullAccess` ownership of `walletPublicKey` on `walletAccountId` at `final` finality, and atomically executes `[addFullAccessKey(walletPublicKey), deleteKey(custodialPublicKey)]`, setting `encryptedSecret = 'claimed'` (idempotent on same-wallet replay). Once `encryptedSecret === 'claimed'`, server-custodial `signTokenDiff` and new server-signed order placements fail closed (`NEAR_NOT_OWNER` / `market_unavailable`), and `PlaceOrderService.evictSelfCustodyRestingOrders` automatically cancels any pre-claim resting custodial orders on match so a wiped custodial key never blocks counterparties; rows that only set `claimedAt` while keeping a KEK-sealed key (W13/W20 `all_or_nothing` fixtures) continue signing normally.
- **Why it is like this:** Owner selected Option 1a (Hardened Custodial KEK → Full Non-Custodial Claim with cold root key) and Option 2b (Hybrid Testnet → Direct `intents.near` Mainnet via `.env` switch) on 2026-11-13.
- **Workaround / mitigation:** Keep `NEAR_MODE=testnet` during staging; promote to Mainnet by running `NEAR_ALLOW_MAINNET=1 npm run near:deploy-contracts -- --network mainnet --ensure-accounts` and setting `NEAR_MODE=mainnet`, `NEAR_ALLOW_MAINNET=1`, `NEAR_ROOT_ACCOUNT=terraagent.near`.
- **To resolve:** Add interactive client-side wallet NEP-413 `token_diff` order signing on `/trade.html` so accounts with `encryptedSecret === 'claimed'` can place resting/market orders directly from their browser wallet without a custodial key.
- **Found:** 2026-11-13, Web3 Testnet→Mainnet hardening (renumbered from duplicate `BE-94`)

### BE-113 · NEP-413 challenge & replay stores and single-operator RPC key queues assume single-replica `terra_app`

- **Status:** Accepted (by design)
- **Area / code:** `backend/app/src/near/identity/{nep413-auth.service.ts,nep413-verifier.ts}`, `backend/app/src/near/infrastructure/rpc/near-rpc.client.ts`, `frontend/design/pilot/{walletSelectorRuntime.ts,fastAuthSpa.ts}`
- **What happens:**
  1. `POST /v1/auth/near/challenge` stores single-use 32-byte CSPRNG NEP-413 challenges (`5m` TTL, max `4096` active entries) in an in-memory `Map` inside `Nep413AuthService`, and `verifyNep413Signature` tracks up to `4096` consumed nonces in-memory (`5m` TTL) while verifying optional `callbackUrl` and `FullAccess` ownership at `final` finality on the active network (`testnet` or `mainnet`). Similarly, `NearRpcClient` serializes per-`(accountId, publicKey)` access-key nonces (`minter.<root>`, `relayer.<root>`) via an in-process FIFO promise queue with 1 `InvalidNonce` retry. In the single-instance `terra_app` deployment (`DEPLOYMENT.md` §2, D-24), both are atomic; in a multi-replica horizontal deployment without shared state or key-pool sharding, replica B would not see replica A's ephemeral challenge map and concurrent `minter`/`relayer` writes across processes would contend on access-key nonces.
  2. Self-custodial NEAR wallet logins (`Meteor`, `OKX`, `NEAR Mobile`, `near-cli-rs`, `Intear`, `MyNearWallet`) validate network account format (`.testnet` on Testnet; `.near`, `.tg`, `.sweat`, `aurora`, or 64-hex implicit on Mainnet) and link directly without minting a second custodial sub-account.
  3. Email / Passkey sign-in uses `@auth0/auth0-spa-js` (`loginWithPopup` + S256 PKCE + CSPRNG `nonce`), requiring the page origin (`https://terraagent.fun`, `http://127.0.0.1:5173`, `http://localhost:5173`) in Auth0 **Allowed Web Origins** & **Allowed Callback URLs**.
- **Why it is like this:** Matches the single-process D-24 server architecture without extra Redis/key-pool complexity while closing unsigned wallet/email auth bypasses and bounded-memory nonce DoS vectors.
- **Workaround / mitigation:** Run a single `terra_app` replica (current production topology) and list `https://terraagent.fun` + local dev origins in Auth0 Allowed Callback URLs & Allowed Web Origins.
- **To resolve:** Persist `challengeId` / `usedNonces` in Postgres (or Redis) and attach a pool of multiple `FullAccess` / `FunctionCall` keys to `relayer.<root>` and `minter.<root>` if `terra_app` scales horizontally across multiple replicas.
- **Found:** 2026-11-13, NEAR Testnet→Mainnet review (renumbered & expanded from duplicate `BE-95`)

### BE-114 · Live NEAR Mainnet (`*.terraagent.near`) deployment requires owner `~/.near-credentials/mainnet/terraagent.near.json`

- **Status:** Open (owner action required; Testnet live + Mainnet dry-run verified)
- **Area / code:** `infra/near/deploy-contracts.mjs`, `scripts/dev/deploy-testnet-contracts.mjs`, `backend/near-contracts/{res,deed,bounty,staking,dao,pilots}`, `backend/app/src/near/infrastructure/config/protocol-fee.config.ts`
- **What happens:** All 6 hardened Rust `near-sdk 5.7` contracts (`67` unit tests passing) were compiled to WASM, redeployed live on **NEAR Testnet** (`*.terraagent.testnet`, `node infra/near/deploy-contracts.mjs all --redeploy --network testnet`), and verified against FastNEAR RPC (`npm run contract:real -- --port Staking|Escrow|CargoToken`). Mainnet deployment (`*.terraagent.near`) was verified via `--network mainnet --dry-run`, because `~/.near-credentials/mainnet/terraagent.near.json` is not present on this development workstation (`~/.near-credentials/` holds `testnet` keys only).
- **Why it is like this:** Production Mainnet root credentials (`terraagent.near`) and Mainnet `NEAR` funding belong exclusively in the owner's cold wallet / operator credential store.
- **Workaround / mitigation:** Run on live `NEAR_MODE=testnet` until ready to fund `terraagent.near` (~`25–30 NEAR` covers all 6 WASM contract storage bytes + `protocol`, `relayer`, and `minter` sub-account reserves).
- **To resolve:** Provision `~/.near-credentials/mainnet/terraagent.near.json` (or `NEAR_ROOT_SECRET_KEY`), run `NEAR_ALLOW_MAINNET=1 npm run near:deploy-contracts -- --network mainnet --ensure-accounts`, and flip `NEAR_MODE=mainnet`, `NEAR_ALLOW_MAINNET=1`, `NEAR_ROOT_ACCOUNT=terraagent.near`, `NEAR_PROTOCOL_ACCOUNT=protocol.terraagent.near`.
- **Found:** 2026-11-14, Protocol & NEAR contracts review
