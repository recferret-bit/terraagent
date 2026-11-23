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

test('public vhosts wire 404.html without soft-404s, redirect /index.html (except design), and configure gzip, referrer, and 24h icon cache', () => {
  for (const name of ['apex.conf', 'play.conf', 'whitepaper.conf', 'pitchdeck.conf', 'playground.conf', 'design.conf']) {
    const text = readFileSync(resolve(nginxHosts, name), 'utf8');
    assert.match(text, /error_page 404 \/404\.html;/, name);
    assert.match(text, /location = \/404\.html\s*\{[\s\S]*?internal;/, name);
  }
  for (const name of ['play.conf', 'whitepaper.conf', 'pitchdeck.conf', 'playground.conf']) {
    const text = readFileSync(resolve(nginxHosts, name), 'utf8');
    assert.match(text, /location \/\s*\{[\s\S]*?try_files \$uri \$uri\/ =404;/, name);
    assert.match(text, /location = \/index\.html\s*\{\s*return 301 \/;\s*\}/, name);
  }
  for (const name of ['apex.conf', 'play.conf']) {
    const text = readFileSync(resolve(nginxHosts, name), 'utf8');
    assert.match(text, /location = \/me\s*\{[\s\S]*?try_files \/me\.html =404;/, name);
    assert.match(text, /location = \/me\/\s*\{\s*return 301 \/me;\s*\}/, name);
  }
  const devchain = readFileSync(resolve(nginxHosts, 'devchain.conf'), 'utf8');
  assert.match(devchain, /location \^~ \/dev\/chain\/tx[\s\S]*?\/dev\/chain\/tx\.html =404/);
  assert.match(devchain, /location = \/robots\.txt[\s\S]*?Disallow: \//);

  const nginxRoot = resolve(here, '../nginx');
  const mainConf = readFileSync(resolve(nginxRoot, 'nginx.conf'), 'utf8');
  assert.match(mainConf, /\bgzip on;/);
  assert.match(mainConf, /application\/manifest\+json\s+webmanifest;/);
  const secConf = readFileSync(resolve(nginxRoot, 'snippets/security-headers.conf'), 'utf8');
  assert.match(secConf, /Referrer-Policy strict-origin-when-cross-origin always;/);
  const cacheConf = readFileSync(resolve(nginxRoot, 'snippets/assets-cache.conf'), 'utf8');
  assert.match(cacheConf, /max-age=86400/);
  assert.match(cacheConf, /og-cover/);
  assert.match(cacheConf, /deed-entry[\s\S]*?Cache-Control "no-cache" always;/);

  for (const name of ['whitepaper.conf', 'pitchdeck.conf']) {
    const text = readFileSync(resolve(nginxHosts, name), 'utf8');
    assert.match(text, /\bindex index\.html;/, name);
    assert.doesNotMatch(text, /\bindex\s+\//, name);
  }
});

test('every public vhost proxies /v1/ or /v1/analytics/ to app:3000', () => {
  for (const name of ['apex.conf', 'play.conf', 'whitepaper.conf', 'pitchdeck.conf', 'playground.conf', 'design.conf']) {
    const text = readFileSync(resolve(nginxHosts, name), 'utf8');
    assert.match(text, /location (?:\^~ )?\/v1\/(?:analytics\/)?\s*\{[\s\S]*?set \$terra_app app:3000;[\s\S]*?proxy-app\.conf;/, name);
  }
});
