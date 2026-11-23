// `npm run dev:cluster`: Postgres + 1 dedicated sim-worker + 1 stateless api/ws replica + Vite client.
// Tests real multi-process simulation lease ownership, WS relay streaming, and Postgres persistence locally.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { devDir, loadEnv, root } from './env.mjs';

const { env, base, appPort, clientPort, dbName } = loadEnv();
const workerPort = Number(env.TA_WORKER_PORT ?? base + 101);
const sharedSecret = env.TA_INTERNAL_SECRET ?? 'terra-local-cluster-secret';

const baseEnv = {
  ...env,
  GAME_DEV_PLANETS: env.GAME_DEV_PLANETS ?? '1',
  TA_SEED_RIVAL_AI: env.TA_SEED_RIVAL_AI ?? '1',
  SNAPSHOT_EVERY_S: env.SNAPSHOT_EVERY_S ?? '10',
  TA_LOCAL_STAKING_TIMINGS: env.TA_LOCAL_STAKING_TIMINGS ?? '1',
  TA_INTERNAL_SECRET: sharedSecret,
};

const colors = { dev: 36, worker: 33, api: 32, client: 35 };
const out = (tag, line) => console.log(`\x1b[${colors[tag] ?? 0}m[${tag}]\x1b[0m ${line}`);

function pipe(tag, child) {
  for (const stream of [child.stdout, child.stderr]) {
    let rest = '';
    stream.on('data', (chunk) => {
      const lines = (rest + chunk).split('\n');
      rest = lines.pop();
      lines.forEach((l) => out(tag, l));
    });
    stream.on('end', () => {
      if (rest) out(tag, rest);
    });
  }
}

function step(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, env: baseEnv, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

out('dev', `starting Postgres, database "${dbName}"`);
step('docker', ['compose', '-f', 'infra/docker-compose.yml', 'up', '-d', '--wait']);
step('npm', ['run', 'db:migrate']);

const spawnOpts = (childEnv) => ({ cwd: root, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
let stopping = false;
let restarting = false;
let worker;
let api;

function startBackend() {
  worker = spawn(process.execPath, ['--import', '@swc-node/register/esm-register', 'src/main.ts'], {
    ...spawnOpts({
      ...baseEnv,
      PORT: String(workerPort),
      TA_SIM_ROLE: 'sim-worker',
      TA_WORKER_ID: env.TA_WORKER_ID ?? 'local-sim-worker-1',
      TA_INTERNAL_URL: `http://127.0.0.1:${workerPort}`,
    }),
    cwd: resolve(root, 'backend/app'),
  });
  pipe('worker', worker);

  api = spawn(process.execPath, ['--import', '@swc-node/register/esm-register', 'src/main.ts'], {
    ...spawnOpts({
      ...baseEnv,
      PORT: String(appPort),
      TA_SIM_ROLE: 'api',
      TA_WORKER_ID: 'local-api-1',
      TA_INTERNAL_URL: `http://127.0.0.1:${appPort}`,
    }),
    cwd: resolve(root, 'backend/app'),
  });
  pipe('api', api);

  const pair = [worker, api];
  for (const child of pair) {
    child.on('exit', (code, signal) => {
      if (restarting) {
        if (pair.every((c) => c.exitCode !== null || c.signalCode !== null)) {
          restarting = false;
          startBackend();
        }
      } else if (!stopping) {
        out('dev', `process exited (${signal ?? code}); shutting down cluster`);
        shutdown(typeof code === 'number' ? code : 1);
      }
    });
  }
}

function restartBackend() {
  if (stopping || restarting) return;
  restarting = true;
  out('dev', 'restarting sim-worker + api (SIGTERM)');
  for (const old of [worker, api]) {
    if (!old || old.exitCode !== null || old.signalCode !== null) continue;
    old.kill('SIGTERM');
    setTimeout(() => old.exitCode === null && old.signalCode === null && old.kill('SIGKILL'), 8000).unref();
  }
}

const vite = spawn(
  process.execPath,
  [resolve(root, 'node_modules/vite/bin/vite.js'), '--config', 'frontend/vite.config.ts', '--host', '127.0.0.1', '--port', String(clientPort), '--strictPort'],
  spawnOpts(baseEnv),
);
pipe('client', vite);
vite.on('exit', (code, signal) => {
  if (!stopping) {
    out('dev', `vite exited (${signal ?? code}); shutting down cluster`);
    shutdown(typeof code === 'number' ? code : 1);
  }
});

function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  rmSync(resolve(devDir, 'runner.pid'), { force: true });
  for (const c of [worker, api, vite]) if (c && c.exitCode === null) c.kill('SIGTERM');
  setTimeout(() => process.exit(code), 8000).unref();
  const wait = setInterval(() => {
    if ([worker, api, vite].every((c) => !c || c.exitCode !== null || c.signalCode !== null)) process.exit(code);
  }, 100);
  wait.unref?.();
}

mkdirSync(devDir, { recursive: true });
writeFileSync(resolve(devDir, 'runner.pid'), String(process.pid));
process.on('SIGUSR2', restartBackend);
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
startBackend();

console.log(`
  TerraAgent multi-worker cluster (base port ${base})
    game              http://127.0.0.1:${clientPort}/play.html
    local spectator   http://127.0.0.1:${clientPort}/play.html?spectator=1   (&reset=1 wipes bots)
    server spectator  http://127.0.0.1:${clientPort}/play.html?spectator=1&host=server   (&reset=1 wipes bots)
    sim-worker        http://127.0.0.1:${workerPort}/v1/readyz   (TA_SIM_ROLE=sim-worker)
    api + ws          http://127.0.0.1:${appPort}/v1/readyz       (TA_SIM_ROLE=api)
    postgres          127.0.0.1:${env.TA_PG_PORT ?? 15434}/${dbName}
`);
