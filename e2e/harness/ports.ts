import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

export const ROOT = resolve(import.meta.dirname, '../..');
export const OUT = resolve(ROOT, 'e2e/.out');

const fileEnv = (name: string): Record<string, string | undefined> => {
  const f = resolve(ROOT, name);
  return existsSync(f) ? parseEnv(readFileSync(f, 'utf8')) : {};
};

/**
 * Ports (PRODUCT_WAVES §7): the worktree dev stack is base+1 (app) / base+1173 (client); the E2E stack is base+2 / base+1174
 * so it can run next to `npm run dev`. With `E2E_REUSE=1` the suites attach to the running dev stack instead.
 */
export function urls() {
  const env = { ...fileEnv('.env'), ...fileEnv('.env.worktree'), ...process.env };
  const base = Number(env.TA_PORT_BASE ?? 4000);
  const reuse = env.E2E_REUSE === '1';
  const appPort = base + (reuse ? 1 : 2);
  const clientPort = base + (reuse ? 1173 : 1174);
  return {
    base, reuse, appPort, clientPort,
    app: `http://127.0.0.1:${appPort}`,
    client: `http://127.0.0.1:${clientPort}`,
  };
}
