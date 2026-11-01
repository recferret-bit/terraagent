// DEP-01 for the backend file: the app publishes no port, joins both networks,
// and takes NODE_ENV / DATABASE_URL from the environment with a laptop default.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const file = 'infra/compose/backend.yml';
const SERVER_URL = 'postgresql://terra:terra@postgres:5432/terraagent';

function config(extra = {}) {
  const env = { ...process.env, DATABASE_URL: '', NODE_ENV: '', TA_DB_NAME: '', ...extra };
  const r = spawnSync('docker', ['compose', '-f', file, 'config', '--format', 'json'], {
    cwd: root,
    encoding: 'utf8',
    env,
  });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout).services.app;
}

test('app publishes no ports and joins both networks', () => {
  const app = config();
  assert.ok(app, 'app service');
  assert.deepEqual(published(app), [], `app must not publish a port, got ${JSON.stringify(app.ports)}`);
  assert.ok(app.networks.terra_edge, 'terra_edge');
  assert.ok((app.networks.terra_edge.aliases ?? []).includes('app'));
  assert.ok(app.networks.terra_internal !== undefined, 'terra_internal');
});

test('laptop default is development and the dev postgres, and the server env replaces both', () => {
  const text = readFileSync(resolve(root, file), 'utf8');
  assert.match(text, /NODE_ENV: \$\{NODE_ENV:-development\}/);
  assert.match(text, /DATABASE_URL: \$\{DATABASE_URL:-/);
  const laptop = config().environment;
  assert.equal(laptop.NODE_ENV, 'development');
  assert.equal(laptop.DATABASE_URL, 'postgresql://terra:terra@host.docker.internal:15434/terraagent');
  const server = config({ NODE_ENV: 'production', DATABASE_URL: SERVER_URL }).environment;
  assert.equal(server.NODE_ENV, 'production');
  assert.equal(server.DATABASE_URL, SERVER_URL);
});

function published(service) {
  return (service.ports ?? []).map((p) => (typeof p === 'object' ? p.published : String(p)));
}
