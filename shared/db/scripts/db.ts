// Database tooling (run with tsx). Subcommands: gen [--name slug] | migrate | reset.
// Uses databaseUrl(env) from @terra/config; each worktree has its own database (TA_DB_NAME) on the shared Postgres.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { coreEnv, databaseUrl, parseEnv, readEnvSource } from '@terra/config';
import { mergeSchema, PRISMA_DIR } from './merge-schema.mjs';

const ROOT = resolve(import.meta.dirname, '../../..');
const DB_DIR = resolve(import.meta.dirname, '..');
const SCHEMA = join(PRISMA_DIR, 'schema.prisma');
const MIGRATIONS = join(PRISMA_DIR, 'migrations');

const env = parseEnv([coreEnv], readEnvSource(ROOT));
const url = new URL(databaseUrl(env));
const dbName = decodeURIComponent(url.pathname.slice(1));
if (!/^[a-z][a-z0-9_]{0,62}$/.test(dbName)) throw new Error(`unsafe database name: ${dbName}`);
const withDb = (name: string) => {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
};

/** Runs admin SQL on the `postgres` maintenance database via `prisma db execute` (needs no generated client). */
function admin(sql: string) {
  const r = spawnSync(join(ROOT, 'node_modules/.bin/prisma'), ['db', 'execute', '--url', withDb('postgres'), '--stdin'], {
    cwd: DB_DIR,
    input: sql,
    encoding: 'utf8',
    env: { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
  });
  return { ok: r.status === 0, out: `${r.stdout}${r.stderr}` };
}

function ensureDb(name: string) {
  const r = admin(`CREATE DATABASE "${name}"`);
  if (r.ok) return console.log(`created database ${name}`);
  if (/already exists/.test(r.out)) return;
  throw new Error(`cannot create database on ${url.host} (is \`npm run db:up\` running?):\n${r.out}`);
}

function dropDb(name: string) {
  const r = admin(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  if (!r.ok) throw new Error(`cannot drop database ${name}:\n${r.out}`);
}

function prisma(args: string[], dbUrl: string, capture = false) {
  const r = spawnSync(join(ROOT, 'node_modules/.bin/prisma'), args, {
    cwd: DB_DIR,
    env: { ...process.env, DATABASE_URL: dbUrl, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    encoding: 'utf8',
  });
  return { status: r.status ?? 1, stdout: r.stdout ?? '' };
}

const pad = (n: number) => String(n).padStart(4, '0');

function nextMigrationDir(slug: string) {
  const nums = readdirSync(MIGRATIONS)
    .map((d) => /^(\d{4})_/.exec(d)?.[1])
    .filter((x): x is string => !!x)
    .map(Number);
  return join(MIGRATIONS, `${pad(Math.max(0, ...nums) + 1)}_${slug}`);
}

async function gen(slug: string) {
  if (!/^[a-z][a-z0-9_]*$/.test(slug)) throw new Error(`migration name must match [a-z][a-z0-9_]*: ${slug}`);
  writeFileSync(SCHEMA, mergeSchema());
  console.log('merged → shared/db/prisma/schema.prisma');
  if (prisma(['generate', '--schema', SCHEMA], url.toString()).status) throw new Error('prisma generate failed');
  const shadow = `${dbName}_shadow`;
  dropDb(shadow);
  ensureDb(shadow);
  try {
    const args = ['migrate', 'diff', '--from-migrations', MIGRATIONS, '--to-schema-datamodel', SCHEMA, '--shadow-database-url', withDb(shadow), '--script', '--exit-code'];
    const r = prisma(args, url.toString(), true);
    if (r.status === 0) return console.log('schema matches migrations: no migration written');
    if (r.status !== 2) throw new Error('prisma migrate diff failed');
    const dir = nextMigrationDir(slug);
    mkdirSync(dir);
    writeFileSync(join(dir, 'migration.sql'), r.stdout);
    console.log(`wrote ${dir.replace(`${ROOT}/`, '')}/migration.sql`);
  } finally {
    dropDb(shadow);
  }
}

function migrate() {
  ensureDb(dbName);
  if (prisma(['migrate', 'deploy', '--schema', SCHEMA], url.toString()).status) throw new Error('migrate deploy failed');
}

const [cmd, ...rest] = process.argv.slice(2);
const nameIdx = rest.indexOf('--name');
if (cmd === 'gen') await gen(nameIdx >= 0 ? (rest[nameIdx + 1] ?? 'auto') : 'auto');
else if (cmd === 'migrate') migrate();
else if (cmd === 'reset') {
  if (env.NODE_ENV === 'production') throw new Error('refusing to reset in production');
  dropDb(dbName);
  console.log(`dropped database ${dbName}`);
  migrate();
} else {
  console.error('usage: db.ts gen [--name <slug>] | migrate | reset');
  process.exit(1);
}
