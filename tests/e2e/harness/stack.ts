import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { createWriteStream, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { LAST_WAVE } from '../../../shared/contracts/src/flags/index';
import { OUT, ROOT, urls } from './ports';

/**
 * The E2E stack: a fresh migrated Postgres database (`createTestDatabase()`, dropped at the end), the app and Vite.
 * `--waves` also narrows the app (`TA_WAVES`, see `appWavesFor`); `E2E_REUSE=1` and `--host local` leave it alone.
 * With `E2E_HOST=local` only Vite is started (no database, no app). Booted by Playwright's globalSetup (main process). Suites run in a worker, so they control the app through a tiny
 * loopback HTTP control server (URL in `E2E_CONTROL`): see `restartApp` / `stopApp` / `startApp` below.
 */
export interface Stack { stop(): Promise<void> }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(url: string, what: string, ms = 90_000, ok: (s: number) => boolean = (s) => s === 200): Promise<void> {
  const until = Date.now() + ms;
  for (;;) {
    try { if (ok((await fetch(url)).status)) return; } catch { /* not up yet */ }
    if (Date.now() > until) throw new Error(`e2e: ${what} did not become ready at ${url} within ${ms / 1000}s`);
    await sleep(300);
  }
}

const exited = (c: ChildProcess) => c.exitCode !== null || c.signalCode !== null;

async function terminate(c: ChildProcess | undefined, graceMs = 10_000): Promise<void> {
  if (!c || exited(c)) return;
  const done = new Promise<void>((r) => c.once('exit', () => r()));
  c.kill('SIGTERM');
  const t = setTimeout(() => !exited(c) && c.kill('SIGKILL'), graceMs);
  await done;
  clearTimeout(t);
}

function logged(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, logName: string): ChildProcess {
  mkdirSync(resolve(OUT, 'logs'), { recursive: true });
  const log = createWriteStream(resolve(OUT, 'logs', logName), { flags: 'a' });
  const child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout?.pipe(log, { end: false });
  child.stderr?.pipe(log, { end: false });
  return child;
}

/**
 * `TA_WAVES` for the app under `--waves` (`E2E_WAVES`): every wave up to the highest one selected (`..01` stays `..01`,
 * `00,03` → `..03`), so the server runs the selected suites' waves with the later ones off, as the owner's check does.
 * Empty / `all` / a bound at or past the last wave → undefined (the app's own default: every wave on).
 */
export function appWavesFor(spec: string | undefined): string | undefined {
  const s = (spec ?? '').trim();
  if (s === '' || s.toLowerCase() === 'all') return undefined;
  const nums = (s.match(/\d{1,2}/g) ?? []).map(Number);
  if (nums.length === 0) return undefined;
  const top = Math.max(...nums);
  return top >= LAST_WAVE ? undefined : `..${String(top).padStart(2, '0')}`;
}

/** Boots DB + app + Vite and the control server. Throws (after cleanup) when something does not come up. */
export async function bootStack(): Promise<Stack> {
  const u = urls();
  if (process.env.E2E_HOST === 'local') return bootViteOnly(u);
  if (u.reuse) {
    await waitFor(`${u.app}/v1/readyz`, 'app (E2E_REUSE)', 10_000);
    await waitFor(u.client, 'client (E2E_REUSE)', 10_000);
    process.env.E2E_CONTROL = '';
    return { stop: async () => undefined };
  }
  const { createTestDatabase } = await import('@terra/db/testing');
  const db = await createTestDatabase();
  // W13: the economy operator API needs the baseline profile (`baseline@1`); seeded like the integration suites do
  try {
    const seed = (await import('../../../shared/db/seeds/0002_economy_baseline')).default;
    await seed({ prisma: db.prisma, log: () => undefined });
  } catch (e) {
    console.warn(`e2e: baseline economy profile not seeded: ${(e as Error).message}`);
  }
  const waves = appWavesFor(process.env.E2E_WAVES);
  const appEnv: NodeJS.ProcessEnv = {
    ...process.env, NODE_ENV: 'development', PORT: String(u.appPort), DATABASE_URL: db.url,
    SIM_THREADS: '1', GAME_DEV_PLANETS: '1', SNAPSHOT_EVERY_S: '5', TA_PORT_BASE: String(u.base),
    ...(waves ? { TA_WAVES: waves } : {}),
  };
  process.env.E2E_APP_WAVES = appEnv.TA_WAVES ?? ''; // the suites (workers) read it: `expectedOnWaves()`
  let app: ChildProcess | undefined;
  const baseWaves = appEnv.TA_WAVES;
  /** `waves` (restart only): `TA_WAVES` of the app from now on (`''` = the suite's own value again), for flag-off steps. */
  const startApp = async (waves?: string) => {
    if (waves !== undefined) { if (waves) appEnv.TA_WAVES = waves; else if (baseWaves) appEnv.TA_WAVES = baseWaves; else delete appEnv.TA_WAVES; }
    if (app && !exited(app)) return;
    app = logged(process.execPath, ['--import', '@swc-node/register/esm-register', 'src/main.ts'], resolve(ROOT, 'backend/app'), appEnv, 'app.log');
    await waitFor(`${u.app}/v1/readyz`, 'app');
  };
  const stopApp = async () => { await terminate(app); };
  let vite: ChildProcess | undefined;
  let control: Server | undefined;
  const stop = async () => {
    control?.close();
    await terminate(vite);
    await stopApp();
    await db.drop();
  };
  try {
    await startApp();
    vite = logged(process.execPath, [resolve(ROOT, 'node_modules/vite/bin/vite.js'), '--config', 'tests/e2e/harness/vite.e2e.config.ts', '--host', '127.0.0.1', '--port', String(u.clientPort), '--strictPort'], ROOT, { ...appEnv }, 'vite.log');
    await waitFor(u.client, 'client');
    control = await listenControl({ startApp, stopApp });
    process.env.E2E_CONTROL = `http://127.0.0.1:${(control.address() as { port: number }).port}`;
  } catch (e) {
    await stop().catch(() => undefined);
    throw e;
  }
  return { stop };
}

/** `--host local`: the browser local host needs no app and no database, only the page server (D-31, SIM-X-06). */
async function bootViteOnly(u: ReturnType<typeof urls>): Promise<Stack> {
  const vite = logged(process.execPath, [resolve(ROOT, 'node_modules/vite/bin/vite.js'), '--config', 'tests/e2e/harness/vite.e2e.config.ts', '--host', '127.0.0.1', '--port', String(u.clientPort), '--strictPort'], ROOT, { ...process.env }, 'vite.log');
  try { await waitFor(u.client, 'client'); } catch (e) { await terminate(vite); throw e; }
  process.env.E2E_CONTROL = '';
  return { stop: () => terminate(vite) };
}

function listenControl(h: { startApp(waves?: string): Promise<void>; stopApp(): Promise<void> }): Promise<Server> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://control');
    const op = url.pathname.slice(1);
    const waves = url.searchParams.get('waves') ?? undefined;
    const run = op === 'start' ? h.startApp(waves) : op === 'stop' ? h.stopApp() : op === 'restart' ? h.stopApp().then(() => h.startApp(waves)) : Promise.reject(new Error(`unknown op ${op}`));
    run.then(() => res.writeHead(204).end(), (e: Error) => res.writeHead(500).end(e.message));
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

async function control(op: 'start' | 'stop' | 'restart', waves?: string): Promise<void> {
  const url = process.env.E2E_CONTROL;
  if (!url) throw new Error('stack control is not available (E2E_REUSE=1 attaches to a dev stack: restart the app yourself)');
  const res = await fetch(`${url}/${op}${waves === undefined ? '' : `?waves=${encodeURIComponent(waves)}`}`, { method: 'POST' });
  if (!res.ok) throw new Error(`stack ${op}: ${res.status} ${await res.text()}`);
}

/** For suites (worker process): the app is SIGTERMed, awaited, started again and readyz is 200 on return. */
export const stack = {
  /** `waves`: restart with `TA_WAVES=<waves>` (e.g. `..12`); `''` restores the suite's own waves. */
  restartApp: (opts: { waves?: string } = {}) => control('restart', opts.waves),
  /** SIGTERM and wait for exit (the local-host step runs with the app stopped). */
  stopApp: () => control('stop'),
  startApp: () => control('start'),
};
