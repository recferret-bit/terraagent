// `npm run dev`: Postgres (docker) + this worktree's DB + app + Vite client, one command, prefixed coloured output.
// Ctrl-C stops app and Vite (Postgres keeps running). App restarts on demand: `npm run dev:restart` (SIGUSR2 to this
// runner), the app gets SIGTERM first (SIGKILL after 8 s), Vite is untouched.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { devDir, loadEnv, root } from './env.mjs';

const { env, appPort, clientPort, dbName } = loadEnv();
const colors = { dev: 36, app: 32, client: 35 };
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
  const r = spawnSync(cmd, args, { cwd: root, env, stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`dev: \`${cmd} ${args.join(' ')}\` failed`);
    process.exit(r.status ?? 1);
  }
}

out('dev', `starting Postgres, database "${dbName}"`);
step('docker', ['compose', '-f', 'infra/docker-compose.yml', 'up', '-d', '--wait']);
step('npm', ['run', 'db:migrate']);

const spawnOpts = { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] };
let stopping = false;
let restarting = false;
let app;

function startApp() {
  app = spawn(process.execPath, ['--import', '@swc-node/register/esm-register', 'src/main.ts'], {
    ...spawnOpts,
    cwd: resolve(root, 'backend/app'),
  });
  pipe('app', app);
  const mine = app;
  app.on('exit', (code, signal) => {
    out('dev', `app exited (${signal ?? code})`);
    if (restarting) {
      restarting = false;
      startApp();
    } else if (!stopping && mine === app) {
      out('dev', 'app is down; run `npm run dev:restart` to start it again (Vite keeps running)');
    }
  });
}

function restartApp() {
  if (stopping || restarting) return;
  if (!app || app.exitCode !== null || app.signalCode !== null) return startApp();
  restarting = true;
  out('dev', 'restarting app (SIGTERM)');
  const old = app;
  old.kill('SIGTERM');
  setTimeout(() => old.exitCode === null && old.signalCode === null && old.kill('SIGKILL'), 8000).unref();
}

const vite = spawn(
  process.execPath,
  [resolve(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(clientPort), '--strictPort'],
  spawnOpts,
);
pipe('client', vite);
vite.on('exit', (code) => {
  out('dev', `vite exited (${code}); stopping`);
  shutdown(code ?? 1);
});

function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  rmSync(resolve(devDir, 'runner.pid'), { force: true });
  for (const c of [app, vite]) if (c && c.exitCode === null) c.kill('SIGTERM');
  setTimeout(() => process.exit(code), 8000).unref();
  const wait = setInterval(() => {
    if ([app, vite].every((c) => !c || c.exitCode !== null || c.signalCode !== null)) process.exit(code);
  }, 100);
  wait.unref?.();
}

mkdirSync(devDir, { recursive: true });
writeFileSync(resolve(devDir, 'runner.pid'), String(process.pid));
process.on('SIGUSR2', restartApp);
process.on('SIGINT', () => shutdown());
process.on('SIGTERM', () => shutdown());

startApp();
console.log(`
  TerraAgent dev stack (worktree base port ${env.TA_PORT_BASE})
    game      http://127.0.0.1:${clientPort}/play.html
    hub       http://127.0.0.1:${clientPort}/
    app       http://127.0.0.1:${appPort}/v1/healthz   (proxied: http://127.0.0.1:${clientPort}/v1, /ws)
    postgres  127.0.0.1:${env.TA_PG_PORT ?? 15434}/${dbName}
    restart   npm run dev:restart   (app only; Vite keeps running)   Ctrl-C stops app + Vite
`);
