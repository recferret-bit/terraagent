// Shared helpers for the dev scripts: env precedence (real env > .env.worktree > .env) and the port convention.
// Mirrors @terra/config (shared/config/src/core.ts); duplicated because .mjs scripts cannot import TS.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const devDir = resolve(root, 'scripts/dev/.out');

const readFile = (name) => {
  const rootFile = resolve(root, name);
  const infraFile = resolve(root, 'infra', name);
  const rootVars = existsSync(rootFile) ? parseEnv(readFileSync(rootFile, 'utf8')) : {};
  const infraVars = existsSync(infraFile) ? parseEnv(readFileSync(infraFile, 'utf8')) : {};
  return { ...rootVars, ...infraVars };
};

export function loadEnv() {
  const env = { ...readFile('.env'), ...readFile('.env.worktree'), ...process.env };
  const base = Number(env.TA_PORT_BASE ?? 4000);
  return {
    env: { ...env, TA_PORT_BASE: String(base) },
    base,
    appPort: Number(env.PORT ?? base + 1),
    clientPort: base + 1173,
    dbName: env.TA_DB_NAME ?? 'terraagent',
  };
}

export function notImplemented(name, lander) {
  console.error(`npm run ${name}: not implemented yet - lands with ${lander}.`);
  process.exit(1);
}
