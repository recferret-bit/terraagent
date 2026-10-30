import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { createWriteStream, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { OUT, ROOT, urls } from './ports';

/**
 * The E2E stack: a fresh migrated Postgres database (`createTestDatabase()`, dropped at the end), the app and Vite.
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
  const appEnv: NodeJS.ProcessEnv = {
    ...process.env, NODE_ENV: 'development', PORT: String(u.appPort), DATABASE_URL: db.url,
    SIM_THREADS: '1', GAME_DEV_PLANETS: '1', SNAPSHOT_EVERY_S: '5', TA_PORT_BASE: String(u.base),
  };
  let app: ChildProcess | undefined;
  const startApp = async () => {
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
    vite = logged(process.execPath, [resolve(ROOT, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(u.clientPort), '--strictPort'], ROOT, { ...appEnv }, 'vite.log');
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
  const vite = logged(process.execPath, [resolve(ROOT, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(u.clientPort), '--strictPort'], ROOT, { ...process.env }, 'vite.log');
  try { await waitFor(u.client, 'client'); } catch (e) { await terminate(vite); throw e; }
  process.env.E2E_CONTROL = '';
  return { stop: () => terminate(vite) };
}

function listenControl(h: { startApp(): Promise<void>; stopApp(): Promise<void> }): Promise<Server> {
  const server = createServer((req, res) => {
    const op = (req.url ?? '').slice(1);
    const run = op === 'start' ? h.startApp() : op === 'stop' ? h.stopApp() : op === 'restart' ? h.stopApp().then(h.startApp) : Promise.reject(new Error(`unknown op ${op}`));
    run.then(() => res.writeHead(204).end(), (e: Error) => res.writeHead(500).end(e.message));
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

async function control(op: 'start' | 'stop' | 'restart'): Promise<void> {
  const url = process.env.E2E_CONTROL;
  if (!url) throw new Error('stack control is not available (E2E_REUSE=1 attaches to a dev stack: restart the app yourself)');
  const res = await fetch(`${url}/${op}`, { method: 'POST' });
  if (!res.ok) throw new Error(`stack ${op}: ${res.status} ${await res.text()}`);
}

/** For suites (worker process): the app is SIGTERMed, awaited, started again and readyz is 200 on return. */
export const stack = {
  restartApp: () => control('restart'),
  /** SIGTERM and wait for exit (the local-host step runs with the app stopped). */
  stopApp: () => control('stop'),
  startApp: () => control('start'),
};
