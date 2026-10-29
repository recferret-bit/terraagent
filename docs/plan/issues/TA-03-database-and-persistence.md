# Epic TA-03 — Database & Persistence

> **Orchestrator:** [`EXECUTION_ORCHESTRATOR.md`](../EXECUTION_ORCHESTRATOR.md) · **Status Board:** [`STATUS.md`](../STATUS.md)
> **Spec:** [`ARCHITECTURE.md`](../../spec/ARCHITECTURE.md) §5.1, §8, §9, §14 · [`DATA_MODEL.md`](../../spec/DATA_MODEL.md) (all) · [`PROTOCOL.md`](../../spec/PROTOCOL.md) NT-11..13, NT-40 · [`DECISIONS.md`](../../spec/DECISIONS.md) D-04, D-08, D-12

## Overview

Wave 0, lead only. Lands the single Prisma schema (`core`/`world`/`ai`/`chain` namespaces) with the first migration `0001_init` including the raw-SQL invariants Prisma cannot express; the framework-agnostic `@terra/db` package (client factory, transaction helper, error mapping, seed, per-lane test-DB harness); and the **snapshot store** that makes "close the tab, the colony keeps running" and worker failover durable.

After W0, the schema changes only in wave pre-steps (orchestrator §1.4); lanes request changes in their task DoR.

## Epic analytics

- **Goal / user value:** a player's colony survives worker crashes and deploys (snapshot + command replay), and seats/colonies can never be double-assigned (database-enforced invariants), which is the backbone of matchmaking fairness and resume.
- **Success metrics:**
  - 50 concurrent seat reservations for a 5-seat planet ⇒ exactly 5 succeed (`seat-race.spec.ts`).
  - Snapshot save p95 < **50 ms** and load-latest p95 < **30 ms** for a 200 KiB snapshot on the dev stack.
  - Stale-epoch snapshot write is rejected 100 % (`FencedError`).
  - Lane test DB setup (`migrate deploy` + truncate) < **5 s** per test run.
- **In scope:** schema v1, `0001_init` (+ raw SQL invariants), `@terra/db` client/tx/errors/seed/test harness, snapshot store with compression, checksum, fencing and retention.
- **Out of scope:** service-specific repositories (each app owns them in its lane: core in TA-04/05, worker digest in TA-08.3, ai log in TA-09.4, chain in TA-10), production roles/backup (TA-02.5).
- **Key risks:** Prisma `multiSchema` + raw-SQL constraints silently dropped by a later `migrate dev` (mitigation: `invariants.spec.ts` asserts every named constraint after migrate); snapshots bloating Postgres (mitigation: brotli, `STORAGE EXTERNAL`, retention §6, sizing check in TA-13.5); zombie workers overwriting newer state (mitigation: lease-epoch fencing DM-14).

## Architecture overview

```mermaid
flowchart LR
  subgraph "@terra/db (shared/db)"
    SCHEMA["prisma/schema.prisma<br/>core · world · ai · chain"]
    MIG["prisma/migrations/0001_init<br/>+ raw SQL invariants"]
    CLIENT["createDb(url, opts)<br/>withTx · mapPgError"]
    SNAP["SnapshotStore<br/>save · loadLatest · prune"]
    TESTING["@terra/db/testing<br/>useTestDb() · truncateAll() · factories"]
  end
  PW["planet-worker"] -->|save every 300 ticks, unload, seal, end| SNAP
  PW -->|restore on assignPlanet| SNAP
  CORE["core"] --> CLIENT
  AI["ai-orchestrator"] --> CLIENT
  NEAR["near-gateway"] --> CLIENT
  SNAP --> PG[("Postgres 16<br/>terraagent / terraagent_lane{K}_test")]
  CLIENT --> PG
  JS[("JetStream {NS}_PLANET_CMDS")] -. "replay from snapshot.cmdSeq+1" .-> PW
```

## Task index

| Task | Title | Wave / Lane | Depends On |
|---|---|---|---|
| `TA-03.1` | Prisma schema v1 (`core`/`world`/`ai`/`chain`) + `0001_init` | W0 / Lead | TA-01.1, TA-02.1 |
| `TA-03.2` | `@terra/db`: client, repository base, seed, lane test-DB harness | W0 / Lead | TA-03.1, TA-01.6 |
| `TA-03.3` | Snapshot store: compressed `bytea`, retention policy, load-latest | W0 / Lead | TA-03.2, TA-01.7 |

---

## Tasks

### `TA-03.1` — Prisma schema v1 (`core`/`world`/`ai`/`chain`) + `0001_init`

- **Status:** `[ ] Todo`
- **Wave / Lane:** `W0 / Lead`
- **Depends On:** `TA-01.1`, `TA-02.1`
- **Spec:** [`DATA_MODEL.md` §2–§5, §7](../../spec/DATA_MODEL.md#4-schema-sketch-shareddbprismaschemaprisma), [`ARCHITECTURE.md` §5.1](../../spec/ARCHITECTURE.md#51-postgresql), [`DECISIONS.md` D-04](../../spec/DECISIONS.md)
- **Target Files:**
  - `shared/db/prisma/schema.prisma`
  - `shared/db/prisma/migrations/0001_init/migration.sql` (Prisma-generated + appended raw SQL from DATA_MODEL §7)
  - `shared/db/prisma/migrations/migration_lock.toml`
  - `shared/db/package.json` (pinned `prisma`, `@prisma/client`; scripts `generate`, `migrate:deploy`, `migrate:diff`)
  - `package.json` root script `db:migrate` → `npm run migrate:deploy -w @terra/db`
  - `shared/db/test/invariants.spec.ts`, `shared/db/test/seat-race.spec.ts`
- **Verify:** `npm run infra:up && npm run db:migrate && TEST_DATABASE_URL=postgresql://terra:terra_dev_password@127.0.0.1:15434/terraagent_test npm run test -w @terra/db`

#### Analytics
- **Problem & goal:** every service needs tables from day one, and matchmaking/resume correctness depends on invariants (one live colony per player, one open ticket per player, seats ≤ capacity, no refill of sealed seats) that must hold even under concurrent core replicas (D-08).
- **Constraints:** one schema/one history (D-04); namespaces per service (DM-02); forward-only; partial unique indexes and `CHECK`s in raw SQL (DM-03); ULID text keys with format checks (DM-19); tunable defaults (`capacity = 5`) match ARCHITECTURE §15.
- **Risks → mitigations:** later `prisma migrate dev` regenerating and dropping raw-SQL objects → lanes never run `migrate dev` (orchestrator §1.4) and `invariants.spec.ts` checks each object by name; enum evolution pain → enums only for closed sets, free-form reasons as `varchar`; cross-namespace FKs making Prisma clients bleed across services → FKs declared only in raw SQL (DATA_MODEL §4 note).
- **Alternatives rejected:** database-per-service (D-04 alternatives); UUIDv7 keys (ULID prefixes make logs/IDs self-describing across WS/NATS/DB, PROTOCOL PR-02); storing seats as `COUNT(*)` queries (race-prone; counters + `CHECK` are atomic).
- **Telemetry (proves it works):** test output `db.invariants.checked=<n>`; `seat-race.spec.ts` logs `seat_race.attempts=50 succeeded=5 rejected=45`. Runtime: Postgres `23505`/`23514` violations surface as `db_constraint_violation_total{constraint}` (counter exported by apps through `mapPgError`, TA-03.2).

#### Architecture
- Models and enums exactly as DATA_MODEL §4.1–§4.4 (`Player`, `AuthIdentity`, `RefreshToken`, `NearLoginNonce`, `Planet`, `Colony`, `MatchTicket`, `SeatReservation`, `RuntimeSetting`, `AdminAudit`; `PlanetSnapshot`, `ColonyDigest`, `ColonyResult`; `AiDecision`, `AiBudgetDay`; `NearAccount`, `NearJob`, `Milestone`, `TradeOffer`, `TradeLeg`).
- Raw SQL appended to `0001_init` (DATA_MODEL §7): `colony_one_live_per_player`, `match_ticket_one_open_per_player`, `planet_seats_le_capacity`, `planet_state_timestamps`, `STORAGE EXTERNAL` on snapshot data, cross-namespace FKs, per-table ULID `CHECK`s.
- Seat reservation SQL pattern documented in DATA_MODEL DM-12 is exercised here in `seat-race.spec.ts` with plain SQL (core's repository implementation follows in TA-05.3).

#### Definition of Ready (DoR)
- [ ] Table names/columns for `ai` and `chain` follow the reconciliation table in [`DATA_MODEL.md`](../../spec/DATA_MODEL.md) §4 (domain specs AI_ORCHESTRATOR §10 and NEAR §10 win); `core.planet.leaseEpoch` and `seatsTaken` are present.
- [ ] DATA_MODEL.md reviewed (or accepted as draft) by the owner, including open questions §11 (display names, no re-join).
- [ ] Dev Postgres up from TA-02.1 (`127.0.0.1:15434`, role `terra`).
- [ ] Pinned Prisma version decided (6.x; record whether `multiSchema` needs the preview flag).

#### Definition of Done (DoD)
- [ ] `npm run db:migrate` applies `0001_init` on an empty `terraagent` and on `terraagent_test`; `prisma migrate diff --exit-code` shows no drift.
- [ ] `invariants.spec.ts`: each named index/constraint exists; inserting a 2nd live colony for a player ⇒ `23505`; a 2nd open ticket ⇒ `23505`; `seats_taken + seats_reserved > capacity` ⇒ `23514`; malformed id ⇒ `23514`; `SEALED` without `sealed_at` ⇒ `23514`.
- [ ] `seat-race.spec.ts`: 50 parallel transactions on 5 seats ⇒ exactly 5 succeed; reservation on a `SEALED` planet or after `admission_ends_at` ⇒ 0 rows.
- [ ] `DATA_MODEL.md` updated by the lead if any field changed during implementation.
- [ ] Status synced in orchestrator, issue file and STATUS.md (§1.6)

---

### `TA-03.2` — `@terra/db`: client, repository base, seed, lane test-DB harness

- **Status:** `[ ] Todo`
- **Wave / Lane:** `W0 / Lead`
- **Depends On:** `TA-03.1`, `TA-01.6`
- **Spec:** [`DATA_MODEL.md` §2, §8, §9](../../spec/DATA_MODEL.md#9-roles--connections), [orchestrator §1.5](../EXECUTION_ORCHESTRATOR.md#15-isolation-per-lane-local--ci)
- **Target Files:**
  - `shared/db/src/client.ts` (`createDb(url, { service, connectionLimit })`)
  - `shared/db/src/tx.ts` (`withTx(db, fn, { isolation, retries })` with serialization-failure retry)
  - `shared/db/src/errors.ts` (`mapPgError` → `UniqueViolation{constraint}`, `CheckViolation{constraint}`, `FkViolation`, `SerializationFailure`)
  - `shared/db/src/ids.ts` (re-export `newId` from contracts for repositories)
  - `shared/db/src/index.ts` (exports generated client types per namespace)
  - `shared/db/src/testing/index.ts` (`useTestDb()`, `truncateAll()`, `assertTestDatabase(url)`), `shared/db/src/testing/factories.ts` (`makePlayer`, `makePlanet`, `makeColony`, `makeTicket`)
  - `shared/db/prisma/seed.ts` + root script `db:seed`
  - `shared/db/test/harness.spec.ts`
- **Verify:** `TEST_DATABASE_URL=postgresql://terra:terra_dev_password@127.0.0.1:15434/terraagent_lane1_test npm run test -w @terra/db`

#### Analytics
- **Problem & goal:** four NestJS apps and the integration harness need the same client setup, transaction semantics, error mapping and a safe, fast way for five parallel lanes to get an isolated, migrated, empty database.
- **Constraints:** framework-agnostic (Nest modules wrap it inside each app); test URLs must end in `_test` or the harness refuses to run (never touch `terraagent`); lane DBs `terraagent_lane{1..5}_test` created by TA-02.1 init scripts; connection limits per DATA_MODEL §9.
- **Risks → mitigations:** a lane accidentally truncating the dev DB → `assertTestDatabase` hard-fails unless the database name matches `/_test$/` and host is localhost/CI; slow per-test resets → migrate once per process (advisory lock `pg_advisory_lock(hashtext('ta.test.migrate'))` guards concurrent Vitest workers), then `TRUNCATE … RESTART IDENTITY CASCADE` across all four schemas between files; flaky serialization retries hiding bugs → retries capped at 3 and counted.
- **Alternatives rejected:** per-test transactions with rollback (breaks code that opens its own transactions and NATS-driven async flows); Testcontainers per lane (slower, Docker-in-agent complexity; shared compose + DB-per-lane suffices).
- **Telemetry (proves it works):** `db_tx_retries_total{service}`, `db_constraint_violation_total{constraint}` counters (names exported; registered by apps' metrics modules); harness logs `testdb.ready db=<name> migrate_ms=<n> truncate_ms=<n>`.

#### Architecture
```ts
export function createDb(url: string, o: { service: "core" | "worker" | "ai" | "near" | "test"; connectionLimit?: number }): PrismaClient;
export async function withTx<T>(db: PrismaClient, fn: (tx: Tx) => Promise<T>, o?: { isolation?: "ReadCommitted" | "RepeatableRead" | "Serializable"; retries?: number }): Promise<T>;
export function mapPgError(e: unknown): DbError | unknown;   // P2002/P2003/P2034 + raw 23505/23514/40001
// testing
export function useTestDb(): { db: PrismaClient; reset(): Promise<void> };  // reads TEST_DATABASE_URL, migrates once, truncates per file
```
- Seed (`db:seed`, dev only): one admin-capable dev player (`pr_…DEV`), `RuntimeSetting` defaults (`mm.paused=false`, `mm.maxActivePlanets=200`, `mm.enabledTypes=["TEMPERATE","DESERT"]`, `mm.warmPoolPerType=1`). **No planets** — planets are created through the matchmaker/worker path so seeding never bypasses lifecycle rules.
- Factories create rows that satisfy all invariants (ULIDs via `newId`, consistent seat counters).

#### Definition of Ready (DoR)
- [ ] `0001_init` applied (TA-03.1).
- [ ] Lane DBs created by `infra/postgres/init/*.sql` (TA-02.1).

#### Definition of Done (DoD)
- [ ] `harness.spec.ts`: refuses `postgresql://…/terraagent`; migrates once under 4 parallel Vitest workers without error; `reset()` leaves all four schemas empty except `_prisma_migrations`.
- [ ] `withTx` retries a forced `40001` up to 3 times then rethrows; `mapPgError` maps `23505` on `colony_one_live_per_player` to `UniqueViolation{constraint:"colony_one_live_per_player"}`.
- [ ] `npm run db:seed` is idempotent (twice ⇒ same rows).
- [ ] Works for each lane: running the spec with `TEST_DATABASE_URL=…lane{1..5}_test` in parallel shows no cross-talk.
- [ ] Status synced in orchestrator, issue file and STATUS.md (§1.6)

---

### `TA-03.3` — Snapshot store: compressed `bytea`, retention policy, load-latest

- **Status:** `[ ] Todo`
- **Wave / Lane:** `W0 / Lead`
- **Depends On:** `TA-03.2`, `TA-01.7`
- **Spec:** [`DATA_MODEL.md` §4.2, DM-14, §6](../../spec/DATA_MODEL.md#42-world--planet-persistence-planet-worker), [`ARCHITECTURE.md` §9, §14](../../spec/ARCHITECTURE.md#14-failover--scaling-summary), [`PROTOCOL.md` NT-11..13, NT-40](../../spec/PROTOCOL.md#63-planet-command-log--nsplanetplanetidcmd)
- **Target Files:**
  - `shared/db/src/snapshots/snapshot-store.ts` (`SnapshotStore`)
  - `shared/db/src/snapshots/codec.ts` (brotli compress/decompress, crc32)
  - `shared/db/src/snapshots/retention.ts` (pure `selectForDeletion(rows, now)`)
  - `shared/db/test/snapshot-store.spec.ts`, `shared/db/test/snapshot-retention.spec.ts`
- **Verify:** `TEST_DATABASE_URL=…/terraagent_test npm run test -w @terra/db -- snapshots`

#### Analytics
- **Problem & goal:** the planet worker (L3, TA-07.6) must persist each planet every 30 s and on unload/seal/end, and a new owner must restore the latest valid snapshot after a crash, then replay commands from `cmdSeq + 1` (NT-13). Providing the store in W0 lets L3 build failover in W3 without schema changes.
- **Constraints:** snapshot cadence `SNAPSHOT_EVERY_TICKS = 300`; retention: last 20 + hourly for 48 h + `END`/last `SEAL` forever (DATA_MODEL §6); `PLANET_CMDS` max age 48 h ≥ any replay window; fencing by `leaseEpoch` (DM-14); simVersion major mismatch refused; compressed size cap **8 MiB**.
- **Risks → mitigations:** corrupted latest snapshot ⇒ restore fails → `crc32` checked on load; on mismatch fall back to the previous snapshot and replay a longer range (still within 48 h), emitting `snapshot_corrupt_total`; save latency spikes blocking ticks → store API is async and the worker calls it off the tick path (TA-07.6), store itself does one `INSERT` + async prune; unbounded growth → prune after every save (bounded delete by primary keys from `selectForDeletion`).
- **Alternatives rejected:** object storage (S3/R2) now (extra infra; revisit per DATA_MODEL open question 3); zstd (not stable in all Node 24 builds without flags — brotli is built in; codec string `sim1+br` allows switching later); updating a single "current snapshot" row (loses fallback, breaks fencing audit).
- **Telemetry (proves it works):** `snapshot_save_duration_seconds` (histogram), `snapshot_load_duration_seconds` (histogram), `snapshot_bytes{kind}` (histogram, compressed), `snapshot_fenced_total` (counter), `snapshot_corrupt_total` (counter), `snapshot_pruned_total` (counter) — names exported for the worker metrics module (TA-07.8).

#### Architecture
```ts
export type SnapshotKind = "PERIODIC" | "UNLOAD" | "SEAL" | "END" | "FAILOVER" | "HOURLY";
export interface SaveInput { planetId: PlanetId; tick: bigint; cmdSeq: bigint; stateHash: string; simVersion: number;
  kind: SnapshotKind; workerId: WorkerId; leaseEpoch: number; raw: Uint8Array /* sim.snapshot() bytes */ }
export interface LoadedSnapshot { planetId; tick: bigint; cmdSeq: bigint; stateHash: string; simVersion: number; raw: Uint8Array; fallbackDepth: number }

export class SnapshotStore {
  constructor(db: PrismaClient, o?: { maxCompressedBytes?: number /* 8 MiB */; brotliQuality?: number /* 4 */ });
  save(i: SaveInput): Promise<{ id: bigint; sizeBytes: number }>;      // throws FencedError (DM-14), SnapshotTooLargeError
  loadLatest(planetId: PlanetId, o?: { maxTick?: bigint; simMajor?: number }): Promise<LoadedSnapshot | null>; // crc fallback up to 3 deep
  list(planetId: PlanetId, limit?: number): Promise<SnapshotMeta[]>;
  prune(planetId: PlanetId, now: Date): Promise<{ deleted: number }>;  // applies retention.ts
}
```
- `save` = compress (brotli q4) → crc32 → fenced `INSERT … SELECT … WHERE NOT EXISTS (… lease_epoch > $epoch)` (0 rows ⇒ `FencedError`) → fire-and-forget `prune` (errors logged, never thrown into the tick path).
- Retention (`selectForDeletion`): keep newest 20; keep the earliest snapshot of each clock hour within the last 48 h (marked `HOURLY` logically, no rewrite); keep all `END` and the newest `SEAL`; for `ARCHIVED` planets keep only `END` (sweep invoked by core/worker nightly, not in this task).
- Restore contract for TA-07.6: `loadLatest` → `sim.restore(raw)` → assert `sim.hash(state) === stateHash` → replay `PLANET_CMDS` from `cmdSeq + 1` using tick markers (NT-11).

#### Definition of Ready (DoR)
- [ ] `world.planet_snapshot` exists with `lease_epoch`, `crc32`, `cmd_seq`, `STORAGE EXTERNAL` (TA-03.1).
- [ ] `sim.snapshot()` / `sim.restore()` / `sim.hash()` available from the stub (TA-01.7) for round-trip tests.

#### Definition of Done (DoD)
- [ ] `snapshot-store.spec.ts`: save→loadLatest round-trip returns identical `raw` bytes and the stub's `hash` matches; epoch 3 saved then epoch 2 save ⇒ `FencedError`; corrupting the newest row's `data` ⇒ `loadLatest` returns the previous one with `fallbackDepth = 1`; > 8 MiB compressed ⇒ `SnapshotTooLargeError`; simVersion major mismatch ⇒ `null` + typed reason.
- [ ] `snapshot-retention.spec.ts`: synthetic 48 h of snapshots every 30 s (5 760 rows) ⇒ kept = newest 20 ∪ hourly (≤ 48) ∪ END/last SEAL; > 48 h-old non-END rows deleted.
- [ ] Benchmark on dev stack logged: 200 KiB raw snapshot save p95 < 50 ms, load p95 < 30 ms (100 iterations).
- [ ] Metric names listed in Telemetry exported from `@terra/db` (`SNAPSHOT_METRICS`).
- [ ] Status synced in orchestrator, issue file and STATUS.md (§1.6)
