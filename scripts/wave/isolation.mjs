// Per-worktree isolation (PRODUCT_WAVES §7): unique TA_PORT_BASE and database `terra_<branch>` in a gitignored `.env.worktree`.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { parseEnv } from 'node:util';

export const FIRST_BASE = 4100;
export const BASE_STEP = 100;
export const CLIENT_OFFSET = 1173; // mirrors PORT_OFFSETS.client in shared/config/src/core.ts

/** `wave/w07-first-contact` → `terra_wave_w07_first_contact` (lowercase, [a-z0-9_], ≤ 63 chars; a hash suffix keeps truncated names unique). */
export function dbNameFor(branch) {
  const slug = branch.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const name = `terra_${slug}`;
  if (name.length <= 63) return name;
  return `${name.slice(0, 54)}_${createHash('sha1').update(branch).digest('hex').slice(0, 8)}`;
}

export const readWorktreeEnv = (dir) => {
  const file = join(dir, '.env.worktree');
  return existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {};
};

/** Directories that may already hold a `.env.worktree`: the main checkout and every sibling worktree. */
function knownWorktrees(root) {
  const wt = resolve(root, '..', 'TerraAgent-wt');
  const kids = existsSync(wt) ? readdirSync(wt, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => join(wt, d.name)) : [];
  return [root, ...kids];
}

/** Smallest `4100 + 100·k` base (and database name) not used by any other worktree's `.env.worktree`. */
export function allocate(root, branch, self) {
  const others = knownWorktrees(root).filter((d) => resolve(d) !== resolve(self)).map(readWorktreeEnv);
  const usedBases = new Set(others.map((e) => Number(e.TA_PORT_BASE)).filter(Boolean));
  const usedDbs = new Set(others.map((e) => e.TA_DB_NAME).filter(Boolean));
  let base = FIRST_BASE;
  while (usedBases.has(base)) base += BASE_STEP;
  let db = dbNameFor(branch), n = 2;
  while (usedDbs.has(db)) db = `${dbNameFor(branch).slice(0, 59)}_${n++}`;
  return { TA_PORT_BASE: base, TA_DB_NAME: db };
}

/** Writes `.env.worktree` unless it already has both values (idempotent: a resumed worktree keeps its ports). Returns the effective values. */
export function ensureWorktreeEnv(root, dir, branch) {
  const have = readWorktreeEnv(dir);
  if (have.TA_PORT_BASE && have.TA_DB_NAME) return { TA_PORT_BASE: Number(have.TA_PORT_BASE), TA_DB_NAME: have.TA_DB_NAME };
  const v = { ...allocate(root, branch, dir), ...(have.TA_PORT_BASE ? { TA_PORT_BASE: Number(have.TA_PORT_BASE) } : {}), ...(have.TA_DB_NAME ? { TA_DB_NAME: have.TA_DB_NAME } : {}) };
  writeFileSync(join(dir, '.env.worktree'), `# written by scripts/wave (per-worktree ports and database; gitignored)\nTA_PORT_BASE=${v.TA_PORT_BASE}\nTA_DB_NAME=${v.TA_DB_NAME}\n`);
  return v;
}

export const clientUrl = (dir, path) => `http://127.0.0.1:${Number(readWorktreeEnv(dir).TA_PORT_BASE ?? 4000) + CLIENT_OFFSET}${path}`;
