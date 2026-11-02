// DEP-01: across the four compose files, only nginx publishes a port, and it is 80.
// Infra is configured with --profile server so the server Postgres is present and must publish nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const FILES = [
  { file: 'infra/compose/infra.yml', profile: 'server' },
  { file: 'infra/compose/frontend.yml' },
  { file: 'infra/compose/backend.yml' },
  { file: 'infra/compose/chain.yml' },
];

function config(file, profile) {
  const args = ['compose'];
  if (profile) args.push('--profile', profile);
  args.push('-f', file, 'config', '--format', 'json');
  const r = spawnSync('docker', args, { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

function published(service) {
  return (service.ports ?? [])
    .map((port) => (port && typeof port === 'object' ? port.published : port))
    .filter((port) => port !== undefined && port !== null && port !== '')
    .map((port) => String(port));
}

test('only nginx publishes port 80 and postgres publishes none', () => {
  const found = [];
  let sawPostgres = false;
  for (const { file, profile } of FILES) {
    const { services } = config(file, profile);
    for (const [name, service] of Object.entries(services ?? {})) {
      if (name === 'postgres') {
        sawPostgres = true;
        assert.deepEqual(
          published(service),
          [],
          `postgres must not publish a port, got ${JSON.stringify(service.ports)}`,
        );
      }
      for (const port of published(service)) found.push({ file, name, port });
    }
  }
  assert.equal(sawPostgres, true, 'profile server must include postgres');
  assert.ok(found.length >= 1, 'nginx must publish port 80');
  for (const row of found) {
    assert.equal(row.file, 'infra/compose/infra.yml');
    assert.equal(row.name, 'nginx');
    assert.equal(row.port, '80');
  }
});
