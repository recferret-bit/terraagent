// Docker compose helpers for the four site stacks (DEPLOYMENT §5).
// `down` never removes volumes and never targets the dev Postgres file.
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export const COMPOSE = {
  infra: 'infra/compose/infra.yml',
  frontend: 'infra/compose/frontend.yml',
  backend: 'infra/compose/backend.yml',
  chain: 'infra/compose/chain.yml',
};

const DEV_POSTGRES = 'infra/docker-compose.yml';

export const upArgv = {
  infra: ['compose', '-f', COMPOSE.infra, 'up', '-d'],
  frontend: ['compose', '-f', COMPOSE.frontend, 'up', '-d', '--build'],
  devPostgres: ['compose', '-f', DEV_POSTGRES, 'up', '-d', '--wait'],
  backend: ['compose', '-f', COMPOSE.backend, 'up', '-d', '--build', '--wait'],
  chain: ['compose', '-f', COMPOSE.chain, 'up', '-d', '--force-recreate'],
};

export function downArgv() {
  return ['chain', 'backend', 'frontend', 'infra'].map((stack) => ['compose', '-f', COMPOSE[stack], 'down']);
}

export function run(cmd, args, env) {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  const status = spawnSync(cmd, args, { cwd: root, env, stdio: 'inherit' }).status ?? 1;
  if (status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${status})`);
}

function capture(cmd, args, env) {
  const r = spawnSync(cmd, args, { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if ((r.status ?? 1) !== 0) throw new Error((r.stderr || `${cmd} failed`).trim());
  return r;
}

function pause(seconds) {
  spawnSync('sleep', [String(seconds)]);
}

function portOwners(port) {
  const r = capture('docker', ['ps', '--filter', `publish=${port}`, '--format', '{{.Names}}']);
  return r.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function assertNginxCanBind() {
  const others = portOwners(80).filter((name) => name !== 'terra-nginx');
  if (others.length) throw new Error(`port 80 is held by ${others.join(', ')}`);
}

export function reloadNginx(env) {
  let detail = 'terra-nginx is not running';
  for (let i = 0; i < 30; i += 1) {
    const r = spawnSync('docker', ['exec', 'terra-nginx', 'nginx', '-s', 'reload'], {
      cwd: root,
      env,
      encoding: 'utf8',
    });
    if (r.status === 0) {
      console.log('$ docker exec terra-nginx nginx -s reload');
      return;
    }
    detail = (r.stderr || r.stdout || `exit ${r.status}`).trim();
    pause(1);
  }
  throw new Error(`nginx reload failed: ${detail}`);
}

export function upInfra(env) {
  if (upArgv.infra.includes('--profile')) throw new Error('local infra must not enable a profile');
  assertNginxCanBind();
  run('docker', upArgv.infra, env);
  reloadNginx(env);
}

export function upFrontend(env) {
  run('docker', upArgv.frontend, env);
}

export function upBackend(env) {
  run('docker', upArgv.devPostgres, env);
  run('npm', ['run', 'db:migrate'], env);
  run('docker', upArgv.backend, env);
}

function chainState(env) {
  const r = spawnSync(
    'docker',
    ['compose', '-f', COMPOSE.chain, 'ps', '-a', '--format', '{{.Service}}\t{{.State}}\t{{.ExitCode}}'],
    {
      cwd: root,
      env,
      encoding: 'utf8',
    },
  );
  if ((r.status ?? 1) !== 0) return null;
  const line = r.stdout
    .split('\n')
    .map((row) => row.trim())
    .find((row) => row.startsWith('vhost\t') || row.startsWith('vhost '));
  if (!line) return null;
  const parts = line.split(/\t|\s+/);
  return { state: parts[1] ?? '', code: Number(parts[2]) };
}

function waitChainExit(env) {
  const deadline = Date.now() + 60_000;
  let last = null;
  while (Date.now() < deadline) {
    last = chainState(env);
    if (last && last.state.toLowerCase() === 'exited') return last;
    pause(0.5);
  }
  return last;
}

export function upChain(env) {
  console.log(`$ docker ${upArgv.chain.join(' ')}`);
  const started = spawnSync('docker', upArgv.chain, { cwd: root, env, stdio: 'inherit' });
  const state = waitChainExit(env);
  const exited = state && state.state.toLowerCase() === 'exited' && state.code === 0;
  if (!exited) {
    const detail = state ? `${state.state} ${state.code}` : 'missing';
    throw new Error(`chain oneshot ${detail} (compose exit ${started.status})`);
  }
  reloadNginx(env);
}

const STARTERS = { infra: upInfra, frontend: upFrontend, backend: upBackend, chain: upChain };

export function upOne(name, env) {
  const start = STARTERS[name];
  if (!start) throw new Error(`unknown stack ${name}`);
  start(env);
}

export function upAll(env) {
  for (const name of Object.keys(STARTERS)) upOne(name, env);
}

export function downAll(env) {
  for (const args of downArgv()) {
    if (args.includes('-v') || args.includes('--volumes') || args.some((part) => part.includes('docker-compose.yml'))) {
      throw new Error(`refusing ${args.join(' ')}`);
    }
    run('docker', args, env);
  }
}

export function publishedOf(service) {
  return (service?.ports ?? [])
    .map((port) => (port && typeof port === 'object' ? port.published : port))
    .filter((port) => port !== undefined && port !== null && port !== '')
    .map((port) => String(port));
}

export function composeConfig(stack, env, profile) {
  const args = ['compose'];
  if (profile) args.push('--profile', profile);
  args.push('-f', COMPOSE[stack], 'config', '--format', 'json');
  const stdout = capture('docker', args, env).stdout;
  const start = stdout.indexOf('{');
  if (start < 0) throw new Error(`compose config ${stack} returned no JSON`);
  return JSON.parse(stdout.slice(start));
}

export function runningProjectPorts(env) {
  const found = [];
  for (const stack of Object.keys(COMPOSE)) {
    const services = composeConfig(stack, env).services ?? {};
    if (stack === 'infra' && services.postgres) throw new Error('local infra config includes postgres');
    for (const [name, service] of Object.entries(services)) {
      for (const port of publishedOf(service)) found.push({ stack, name, port });
    }
  }
  return found;
}

export function healthOf(name) {
  const r = spawnSync(
    'docker',
    ['inspect', '--format', '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}', name],
    {
      encoding: 'utf8',
    },
  );
  if ((r.status ?? 1) !== 0) return null;
  return r.stdout.trim();
}

export function waitHealthy(name, seconds = 180) {
  console.log(`waiting for ${name} to be healthy`);
  const deadline = Date.now() + seconds * 1000;
  let last = 'missing';
  while (Date.now() < deadline) {
    last = healthOf(name) ?? 'missing';
    if (last === 'running healthy') return;
    pause(2);
  }
  throw new Error(`${name} did not become healthy (${last})`);
}

export function isRunning(name) {
  const names = capture('docker', ['ps', '--format', '{{.Names}}']).stdout.split('\n');
  return names.some((line) => line.trim() === name);
}

export function assertNotRunning(name) {
  if (isRunning(name)) throw new Error(`${name} is running`);
}

export function assertHealthy(name) {
  const got = healthOf(name);
  if (got !== 'running healthy') throw new Error(`${name} is ${got ?? 'missing'}`);
}
