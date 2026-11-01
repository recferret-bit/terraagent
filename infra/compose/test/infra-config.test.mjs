// DEP-01 for the infra file: nginx publishes port 80, the server Postgres publishes nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const file = 'infra/compose/infra.yml';

function config() {
  const r = spawnSync('docker', ['compose', '--profile', 'server', '-f', file, 'config', '--format', 'json'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test('nginx publishes 80 and postgres has no ports', () => {
  const { services } = config();
  const nginx = services.nginx;
  const pg = services.postgres;
  assert.ok(nginx, 'nginx service');
  assert.ok(pg, 'postgres service');
  assert.ok(published(nginx).some((p) => p === '80' || p === 80), `nginx ports ${JSON.stringify(nginx.ports)}`);
  assert.deepEqual(published(pg), [], `postgres must not publish a port, got ${JSON.stringify(pg.ports)}`);
  assert.ok((pg.profiles ?? []).includes('server'), 'postgres is profile server only');
  assert.ok((pg.networks?.terra_internal?.aliases ?? []).includes('postgres'), 'postgres alias');
  assert.equal(services.net?.container_name, 'terra-internal-net');
  assert.deepEqual(published(services.net), [], 'network holder publishes nothing');
});

test('nginx config has no rate limit and no Cloudflare real-ip', () => {
  const text = ['nginx.conf', 'snippets/security-headers.conf', 'hosts/00-default.conf']
    .map((p) => readFileSync(resolve(root, 'infra/nginx', p), 'utf8')).join('\n');
  for (const word of ['limit_req', 'limit_conn', 'real_ip', 'cloudflare', 'Strict-Transport-Security']) {
    assert.equal(text.toLowerCase().includes(word.toLowerCase()), false, word);
  }
});

function published(service) {
  return (service.ports ?? []).map((p) => (typeof p === 'object' ? p.published : String(p)));
}
