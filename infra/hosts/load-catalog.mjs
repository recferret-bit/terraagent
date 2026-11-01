// Host catalog for terraagent.fun (D-37, DEPLOYMENT §2 and §4).
// Later W26 issues import this module. W26 adds no gameplay toggle: LAST_WAVE stays 25
// (the flag panel and `TA_WAVES` keep the previous wave's behaviour). Do not edit the app env schema.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));

/** Compose projects. `infra` publishes nginx and has no public host of its own. */
export const STACKS = ['infra', 'frontend', 'backend', 'chain'];

const DEPLOY_KEYS = ['TA_DOMAIN', 'DEPLOY_HOST', 'DEPLOY_USER'];

export const catalogPath = () => resolve(dir, 'catalog.json');

/** The eight public hosts, each tagged with its compose stack. */
export function loadCatalog() {
  const raw = JSON.parse(readFileSync(catalogPath(), 'utf8'));
  assertCatalog(raw);
  return raw;
}

export const hostsByStack = (catalog, stack) => catalog.hosts.filter((h) => h.stack === stack);

/** `http://` origins for the app CORS allow-list. TLS is off in this phase (D-37). */
export function catalogOrigins(catalog = loadCatalog()) {
  return catalog.hosts.map((h) => `http://${h.host}`);
}

export function readDeployEnv(env = process.env) {
  return {
    TA_DOMAIN: env.TA_DOMAIN ?? '',
    DEPLOY_HOST: env.DEPLOY_HOST ?? '',
    DEPLOY_USER: env.DEPLOY_USER ?? '',
  };
}

/** DEP-08 for this phase: the three deploy vars are set and none is a CHANGE_ME placeholder. */
export function validateDeployEnv(env = process.env, catalog = loadCatalog()) {
  const got = readDeployEnv(env);
  for (const key of DEPLOY_KEYS) refuse(key, got[key]);
  const domain = got.TA_DOMAIN.trim();
  if (domain !== catalog.domain) throw new Error(`validate-env: TA_DOMAIN must be ${catalog.domain}`);
  return { TA_DOMAIN: domain, DEPLOY_HOST: got.DEPLOY_HOST.trim(), DEPLOY_USER: got.DEPLOY_USER.trim() };
}

/** Parsed `infra/hosts/.env.example` (empty values stay empty strings). */
export function loadEnvExample() {
  const out = {};
  for (const line of readFileSync(resolve(dir, '.env.example'), 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i >= 0) out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

function refuse(key, value) {
  const v = value.trim();
  if (!v) throw new Error(`validate-env: ${key} is empty`);
  if (v.includes('CHANGE_ME')) throw new Error(`validate-env: ${key} is a CHANGE_ME placeholder`);
}

function assertCatalog(raw) {
  if (!raw || raw.domain !== 'terraagent.fun') throw new Error('catalog: domain must be terraagent.fun');
  if (raw.wave !== 'W26') throw new Error('catalog: wave must be W26');
  if (!sameList(raw.stacks, STACKS)) throw new Error(`catalog: stacks must be ${STACKS.join(', ')}`);
  if (!Array.isArray(raw.hosts) || raw.hosts.length !== 8) throw new Error('catalog: expected eight hosts');
  const seen = new Set();
  for (const h of raw.hosts) checkHost(h, seen);
  if (raw.hosts.some((h) => h.stack === 'infra')) throw new Error('catalog: infra is the nginx stack, not a public host');
}

function checkHost(h, seen) {
  if (!h.id || !h.host || seen.has(h.host)) throw new Error(`catalog: bad or duplicate host ${h.host}`);
  seen.add(h.host);
  if (!h.host.endsWith('terraagent.fun')) throw new Error(`catalog: ${h.host} is outside terraagent.fun`);
  if (!STACKS.includes(h.stack)) throw new Error(`catalog: ${h.host} stack ${h.stack} is not one of ${STACKS.join(', ')}`);
  if (!h.vhost?.endsWith('.conf')) throw new Error(`catalog: ${h.host} needs a vhost file`);
}

const sameList = (a, b) => Array.isArray(a) && a.length === b.length && a.every((x, i) => x === b[i]);
