// DEP-01 for the backend file: the app publishes no port.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const file = 'infra/compose/backend.yml';

function config() {
  const r = spawnSync('docker', ['compose', '-f', file, 'config', '--format', 'json'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test('app publishes no ports', () => {
  const { services } = config();
  const app = services.app;
  assert.ok(app, 'app service');
  assert.deepEqual(published(app), [], `app must not publish a port, got ${JSON.stringify(app.ports)}`);
});

function published(service) {
  return (service.ports ?? []).map((p) => (typeof p === 'object' ? p.published : String(p)));
}
