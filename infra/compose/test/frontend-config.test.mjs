// DEP-01 for the frontend file: the static image publishes no port.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const file = 'infra/compose/frontend.yml';

function config() {
  const r = spawnSync('docker', ['compose', '-f', file, 'config', '--format', 'json'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

function published(service) {
  return (service.ports ?? []).map((p) => (typeof p === 'object' ? p.published : String(p)));
}

test('static service publishes no ports', () => {
  const { services } = config();
  const names = Object.keys(services);
  assert.deepEqual(names, ['static']);
  const staticSite = services.static;
  assert.equal(staticSite.image, 'terra-frontend:local');
  assert.equal(staticSite.container_name, 'terra-static');
  assert.deepEqual(published(staticSite), [], `static must not publish a port, got ${JSON.stringify(staticSite.ports)}`);
});
