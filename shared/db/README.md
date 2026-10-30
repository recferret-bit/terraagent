# @terra/db

Prisma schema, migrations and DB tooling. Postgres 16 with four namespaces: `core`, `world`, `ai`, `chain`.

## Local database

```bash
npm run db:up        # docker compose (infra/docker-compose.yml): container terra-pg on 127.0.0.1:15434, user/password terra/terra
npm run db:migrate   # create the worktree database if missing, then `prisma migrate deploy`
npm run db:reset     # dev only: drop the worktree database and migrate from scratch
npm run db:seed      # run shared/db/seeds/*.ts in name order (idempotent seeds only)
npm run db:down
```

One Postgres server, one database per worktree: `TA_DB_NAME` (`.env.worktree`, default `terraagent`) on `TA_PG_PORT`;
`DATABASE_URL` overrides everything. The scripts create the database when missing. `db:gen` uses a throwaway
`<TA_DB_NAME>_shadow` database and drops it afterwards.

## Adding tables

1. Put the models in your module's own file `shared/db/prisma/<module>.prisma` (models only, every model carries
   `@@schema("core" | "world" | "ai" | "chain")` and `@@map("snake_case")`). `_base.prisma` holds the generator and datasource.
2. `npm run db:gen -- --name <slug>`: merges all `prisma/*.prisma` into the committed, generated `prisma/schema.prisma`,
   runs `prisma generate`, and writes the next migration `prisma/migrations/NNNN_<slug>/migration.sql` when the merged schema
   differs from what the migrations produce (otherwise it says so and writes nothing). Name defaults to `auto`.
3. `npm run db:migrate` to apply, commit schema.prisma and the migration together. `npm run gen:check` fails when
   schema.prisma is stale.

## Migrations

- Folders are zero-padded sequence numbers, `0001_init`, `0002_<name>`, never Prisma timestamps. Forward-only: never edit
  an applied migration, add a new one.
- Raw SQL that Prisma cannot express (partial/expression indexes, partitioning, triggers, extensions; DATA_MODEL §7)
  is appended by hand to the same `migration.sql` that `db:gen` just wrote, before committing.
- Parallel branches that each add a migration collide on the number: the branch that merges second renumbers its
  folder (rename to the next free number, rerun `npm run db:gen` to confirm nothing is left to generate).

## Client, repositories, transactions

`postinstall` in this package runs `prisma generate` against the committed `schema.prisma`, so `npm ci` gives a fresh
clone a generated client (rerun `npm run db:gen` after schema changes).

```ts
import { createPrismaClient, RepositoryBase, withTransaction, type DbClient } from '@terra/db';
```

- `createPrismaClient(url, { poolSize? })`: one client per process; sets `connection_limit` (default 20, DATA_MODEL §9)
  unless the URL already has one. In the app it is the `PRISMA` token of the global `DbModule`
  (`backend/app/src/db/db.module.ts`, env `TA_DB_POOL_SIZE`); inject it, never create a second one. The module also registers
  the `db` readiness check (`SELECT 1`) and disconnects on shutdown.
- `withTransaction(db, fn, opts?)`: interactive `$transaction`; rolls back when `fn` throws. Given a transaction client it joins
  it instead of nesting.
- `RepositoryBase`: `this.db(tx?)` returns the caller's transaction or the root client; `this.tx(fn, tx?)` wraps
  `withTransaction`. Repository methods take an optional trailing `tx: DbClient` so callers compose several writes atomically
  (e.g. a domain write plus a chain outbox row).

## Seeds

`shared/db/seeds/NNNN_<name>.ts` default-exports `async ({ prisma, log }) => {}`. `npm run db:seed` runs them in name order
against the worktree database; they must be idempotent (upsert / `ON CONFLICT DO NOTHING`).

## Integration tests (need Postgres)

`npm run test:integration` runs only `**/*.int.spec.ts` (`vitest.integration.config.ts`); plain `npx vitest run` excludes
them and needs no database. `@terra/db/testing` provides `createTestDatabase()`: creates `terra_test_<random>` on the shared
Postgres, runs `prisma migrate deploy`, returns `{ name, url, prisma, drop() }` (always `drop()` in `afterAll`), plus
`databaseExists(name)`. The log lines `[test-db] created|migrated|dropped <name>` show the lifecycle.
`shared/db/test/harness.int.spec.ts` proves create, migrate, use (including rollback) and drop.
