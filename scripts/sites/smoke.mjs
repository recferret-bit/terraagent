// DEPLOYMENT §5 smoke. Brings the four stacks up and leaves them up when every check passes.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadCatalog } from '../../infra/hosts/load-catalog.mjs';
import { assertHealthy, assertNotRunning, root, run, runningProjectPorts, upAll, waitHealthy } from './compose.mjs';
import { curl } from './curl.mjs';

const HERO = 'Drop one robot. Get a colony that never sleeps.';
const WS_HEADERS = [
  'Connection: Upgrade',
  'Upgrade: websocket',
  'Sec-WebSocket-Version: 13',
  'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
];

export function smoke(env) {
  upAll(env);
  const checks = buildChecks(loadCatalog(), env);
  for (const check of checks) runCheck(check);
  console.log(`smoke: ${checks.length} checks passed`);
}

function runCheck(check) {
  try {
    check.run();
    console.log(`ok  ${check.name}`);
  } catch (err) {
    console.error(`FAIL ${check.name}: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

function buildChecks(catalog, env) {
  const state = { nosniff: false };
  const design = byId(catalog, 'design');
  const play = byId(catalog, 'play');
  const api = byId(catalog, 'api');
  const devchain = byId(catalog, 'devchain');
  const paper = byId(catalog, 'whitepaper');
  const pitch = byId(catalog, 'pitchdeck');
  const health = api.health ?? '/v1/healthz';
  return [
    ...catalog.hosts.map((row) => indexCheck(row, state)),
    named(`tokens ${design.host}/design/css/tokens.css`, () => tokensCss(design, state)),
    named(`health ${play.host}${health}`, () => statusIs(curl(play.host, health), 200, health)),
    named(`websocket ${play.host}/ws`, () => websocket(play.host)),
    named(`root ${api.host}/`, () => statusIs(curl(api.host, '/'), 404, '/')),
    named(`health ${api.host}${health}`, () => apiHealth(api.host, health)),
    named(`explorer ${devchain.host}/dev/chain/ while terra-app is stopped`, () => explorerDown(env, devchain.host)),
    named(`receipts ${devchain.host}/v1/dev/chain/receipts`, () => receipts(devchain.host)),
    named('unknown host not-a-host/', () => statusIs(curl('not-a-host', '/'), 404, 'not-a-host/')),
    named(`h1 ${paper.host}`, () => whitepaperH1(paper)),
    named(`pitch ${pitch.host}`, () => pitchLine(pitch)),
    named('X-Content-Type-Options nosniff', () => nosniffSeen(state)),
    named('compose config publishes only nginx port 80', () => onlyNginx(env)),
    named('terra-sites-pg is not running', () => assertNotRunning('terra-sites-pg')),
    named('terra-pg is healthy', () => assertHealthy('terra-pg')),
  ];
}

function named(name, runCheckFn) {
  return { name, run: runCheckFn };
}

function byId(catalog, id) {
  const row = catalog.hosts.find((host) => host.id === id);
  if (!row) throw new Error(`catalog missing ${id}`);
  return row;
}

function indexCheck(row, state) {
  const path = row.index ?? row.health;
  return named(`index ${row.host}${path}`, () => {
    if (!path) throw new Error('no index');
    const res = curl(row.host, path);
    statusIs(res, 200, path);
    noteNosniff(state, res);
    if (row.index == null) expectOk(res.body);
  });
}

function tokensCss(design, state) {
  const res = curl(design.host, '/design/css/tokens.css');
  statusIs(res, 200, '/design/css/tokens.css');
  noteNosniff(state, res);
  if (!res.body.includes('--ta-void')) throw new Error('tokens.css missing --ta-void');
}

function websocket(host) {
  const res = curl(host, '/ws', { headers: WS_HEADERS, maxTime: 5, allowTimeout: true });
  statusIs(res, 101, '/ws');
}

function apiHealth(host, health) {
  const res = curl(host, health);
  statusIs(res, 200, health);
  expectOk(res.body);
}

function explorerDown(env, host) {
  run('docker', ['stop', 'terra-app'], env);
  let failed = null;
  try {
    const res = curl(host, '/dev/chain/');
    statusIs(res, 200, '/dev/chain/');
    if (!res.body.includes('Mock Chain Explorer')) throw new Error('body missing Mock Chain Explorer');
  } catch (err) {
    failed = err;
  }
  run('docker', ['start', 'terra-app'], env);
  waitHealthy('terra-app');
  if (failed) throw failed;
}

function receipts(host) {
  const res = curl(host, '/v1/dev/chain/receipts');
  statusIs(res, 200, '/v1/dev/chain/receipts');
  const data = parseJson(res.body);
  if (!Array.isArray(data)) throw new Error(`expected a JSON array, got ${snippet(res.body)}`);
}

function whitepaperH1(row) {
  const res = curl(row.host, row.index ?? '/');
  statusIs(res, 200, 'whitepaper');
  const expected = markdownH1();
  const got = pageH1(res.body);
  if (got !== expected) throw new Error(`h1 ${JSON.stringify(got)} != ${JSON.stringify(expected)}`);
}

function pitchLine(row) {
  const res = curl(row.host, row.index ?? '/');
  statusIs(res, 200, 'pitch');
  if (!res.body.includes(HERO)) throw new Error(`missing ${JSON.stringify(HERO)}`);
}

function onlyNginx(env) {
  const found = runningProjectPorts(env);
  const bad = found.filter((row) => row.stack !== 'infra' || row.name !== 'nginx' || row.port !== '80');
  if (bad.length || found.length === 0) throw new Error(`published ports ${JSON.stringify(found)}`);
}

function nosniffSeen(state) {
  if (!state.nosniff) throw new Error('no 200 response included X-Content-Type-Options: nosniff');
}

function noteNosniff(state, res) {
  if (res.status === 200 && res.header('x-content-type-options')?.toLowerCase() === 'nosniff') state.nosniff = true;
}

function statusIs(res, status, label) {
  if (res.status !== status) throw new Error(`${label} expected ${status}, got ${res.status}`);
}

function expectOk(body) {
  const data = parseJson(body);
  if (!data || data.ok !== true || Object.keys(data).length !== 1)
    throw new Error(`expected {"ok":true}, got ${snippet(body)}`);
}

function parseJson(body) {
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`not JSON: ${snippet(body)}`);
  }
}

function snippet(body) {
  return body.replace(/\s+/g, ' ').slice(0, 160);
}

function markdownH1() {
  const markdown = readFileSync(resolve(root, 'docs/hackathon/public/whitepaper.md'), 'utf8');
  const line = markdown.split(/\r?\n/).find((row) => row.startsWith('# '));
  if (!line) throw new Error('whitepaper.md has no # heading');
  return line.replace(/^#\s+/, '').trim();
}

function pageH1(html) {
  const match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (!match) throw new Error('page has no h1');
  return decode(match[1].replace(/<[^>]+>/g, '')).trim();
}

function decode(text) {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
