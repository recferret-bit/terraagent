// Chain stack: mount devchain.conf and publish nothing (D-37, D-24, DEP-01).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const file = 'infra/compose/chain.yml';

function compose(args) {
  const r = spawnSync('docker', ['compose', '-f', file, ...args], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

test('chain compose publishes no ports and mounts devchain.conf', () => {
  const text = compose(['config', '--format', 'json']);
  assert.match(text, /devchain\.conf/);
  const { services } = JSON.parse(text);
  for (const service of Object.values(services ?? {})) {
    assert.deepEqual(published(service), [], `no published ports, got ${JSON.stringify(service.ports)}`);
  }
});

test('devchain vhost serves the explorer and proxies the ledger', () => {
  const conf = readFileSync(resolve(root, 'infra/nginx/hosts/devchain.conf'), 'utf8');
  assert.match(conf, /server_name devchain\.terraagent\.fun/);
  assert.match(conf, /try_files[^;]*\/dev\/chain\/index\.html/);
  assert.match(conf, /proxy-app\.conf/);
});

function published(service) {
  return (service.ports ?? []).map((p) => (typeof p === 'object' ? p.published : String(p)));
}
