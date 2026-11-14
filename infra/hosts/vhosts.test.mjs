// A catalog host with no vhost file, or a local.hosts that omits a name, fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from './load-catalog.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const nginxHosts = resolve(here, '../nginx/hosts');

function escaped(host) {
  return host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('every catalog host has a vhost whose server_name is that host', () => {
  for (const row of loadCatalog().hosts) {
    const file = resolve(nginxHosts, row.vhost);
    assert.equal(existsSync(file), true, `${row.vhost} missing under infra/nginx/hosts`);
    const text = readFileSync(file, 'utf8');
    assert.match(text, new RegExp(`server_name\\s+${escaped(row.host)}\\s*;`), row.host);
  }
});

test('local.hosts mentions every catalog host', () => {
  const text = readFileSync(resolve(here, 'local.hosts'), 'utf8');
  assert.match(text, /127\.0\.0\.1/);
  for (const row of loadCatalog().hosts) {
    assert.match(text, new RegExp(`(^|\\s)${escaped(row.host)}(\\s|$)`, 'm'), row.host);
  }
});

test('design.conf resolves root-level design pages and /index.html under /design/', () => {
  const text = readFileSync(resolve(nginxHosts, 'design.conf'), 'utf8');
  assert.match(text, /location = \/index\.html[\s\S]*?try_files \/design\/index\.html =404;/);
  assert.match(text, /try_files \$uri \$uri\/ \/design\$uri \/design\$uri\/ =404;/);
});
