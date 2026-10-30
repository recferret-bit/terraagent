# @terra/db

Prisma schema, migrations and DB tooling. Postgres 16 with four namespaces: `core`, `world`, `ai`, `chain`.

## Local database

```bash
npm run db:up        # docker compose (infra/docker-compose.yml): container terra-pg on 127.0.0.1:15434, user/password terra/terra
npm run db:migrate   # create the worktree database if missing, then `prisma migrate deploy`
npm run db:reset     # dev only: drop the worktree database and migrate from scratch
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
