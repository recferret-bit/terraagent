#!/usr/bin/env node
// Catalog wiring, quoted emitters, and closed failure reasons.
//   npm run validate:analytics
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TEXT_EXT = /\.(?:ts|tsx|js|mjs|cjs|html|vue|css|json)$/;
const TEST_EXT = /\.(?:spec|test)\.(?:ts|tsx|js|mjs)$/;
const SKIP_DIR = new Set(['node_modules', 'dist', 'coverage', '.vite', 'test-results']);
const TRACK_CALL = /(?<![\w$])track\s*(?:\?\.)?\s*\(\s*(['"])([^'"]+)\1/g;

/** Comments are not emitters. Kept the same length so match indexes stay on the original lines. */
export function maskComments(source) {
  const chars = source.split('');
  let i = 0;
  while (i < chars.length) {
    const c = chars[i];
    const next = chars[i + 1];
    if (c === '/' && next === '/') {
      while (i < chars.length && chars[i] !== '\n') chars[i++] = ' ';
      continue;
    }
    if (c === '/' && next === '*') {
      chars[i] = ' ';
      chars[i + 1] = ' ';
      i += 2;
      while (i < chars.length && !(chars[i] === '*' && chars[i + 1] === '/')) {
        if (chars[i] !== '\n') chars[i] = ' ';
        i += 1;
      }
      if (i < chars.length) chars[i] = ' ';
      if (i + 1 < chars.length) chars[i + 1] = ' ';
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      i += 1;
      while (i < chars.length) {
        if (chars[i] === '\\') { i += 2; continue; }
        if (chars[i] === c) { i += 1; break; }
        i += 1;
      }
      continue;
    }
    i += 1;
  }
  return chars.join('');
}

function hasQuoted(text, value) {
  const escaped = String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`'${escaped}'|"${escaped}"|\`${escaped}\``).test(text);
}

function isVendor(path) {
  return path.includes('/node_modules/') || path.includes('/dist/');
}

function isTest(path) {
  return TEST_EXT.test(path);
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) if (text[i] === '\n') line += 1;
  return line;
}

function sourceText(files, prefix) {
  const parts = [];
  for (const file of files) {
    if (!file.path.startsWith(prefix) || isVendor(file.path) || isTest(file.path)) continue;
    parts.push(maskComments(file.text));
  }
  return parts.join('\n');
}

function propKeys(event) {
  return new Set((event?.props ?? []).map((prop) => prop.key));
}

function checkWhere(label, eventName, where, byName, failures) {
  if (!where?.length || !byName.has(eventName)) return;
  const keys = propKeys(byName.get(eventName));
  for (const clause of where) {
    if (!keys.has(clause.key)) failures.push(`${label}: where '${clause.key}' is not a prop of '${eventName}'`);
  }
}

function checkBreakdown(label, key, events, failures) {
  if (!key) return;
  const hit = events.some((event) => propKeys(event).has(key));
  if (!hit) failures.push(`${label}: breakdown '${key}' is not a prop on that event`);
}

/** Runtime filters are optional. A server step that omits `runtime` is valid. */
function checkWiring(events, funnels, trends, failures) {
  const byName = new Map(events.map((event) => [event.name, event]));
  for (const funnel of funnels) {
    const known = [];
    for (const step of funnel.steps ?? []) {
      if (!byName.has(step.event)) {
        failures.push(`funnel ${funnel.id}: unknown event '${step.event}'`);
        continue;
      }
      known.push(byName.get(step.event));
      checkWhere(`funnel ${funnel.id} step '${step.event}'`, step.event, step.where, byName, failures);
    }
    if (funnel.exclusion && !byName.has(funnel.exclusion)) {
      failures.push(`funnel ${funnel.id}: unknown exclusion '${funnel.exclusion}'`);
    }
    checkBreakdown(`funnel ${funnel.id}`, funnel.breakdown, known, failures);
  }
  for (const trend of trends) {
    if (!byName.has(trend.event)) {
      failures.push(`trend ${trend.id}: unknown event '${trend.event}'`);
      continue;
    }
    checkWhere(`trend ${trend.id}`, trend.event, trend.where, byName, failures);
    checkBreakdown(`trend ${trend.id}`, trend.breakdown, [byName.get(trend.event)], failures);
  }
}

function checkReason(event, clientText, serverText, failures) {
  const reason = (event.props ?? []).find((prop) => prop.key === 'reason');
  if (!reason?.values) return;
  for (const value of reason.values) {
    const inClient = hasQuoted(clientText, value);
    const inServer = hasQuoted(serverText, value);
    const ok = event.plane === 'server' ? inServer : event.plane === 'both' ? (inClient || inServer) : inClient;
    if (!ok) failures.push(`reason '${value}' for '${event.name}' is not a quoted literal in the emitting tree`);
  }
}

function checkEvents(events, clientText, serverText, failures) {
  for (const event of events) {
    if (event.legacy) {
      if (!hasQuoted(clientText, event.name) && !hasQuoted(serverText, event.name)) {
        failures.push(`legacy event '${event.name}' is not quoted in frontend/ or backend/app/src`);
      }
      continue;
    }
    if ((event.plane === 'client' || event.plane === 'both') && !hasQuoted(clientText, event.name)) {
      failures.push(`client event '${event.name}' has no quoted emitter in frontend/`);
    }
    if ((event.plane === 'server' || event.plane === 'both') && !hasQuoted(serverText, event.name)) {
      failures.push(`server event '${event.name}' has no quoted emitter in backend/app/src`);
    }
    checkReason(event, clientText, serverText, failures);
  }
}

function checkBanned(files, failures) {
  for (const file of files) {
    if (!file.path.startsWith('frontend/') || isVendor(file.path)) continue;
    if (file.text.includes('posthog-js')) failures.push(`${file.path}: contains posthog-js`);
    if (file.text.includes('posthog.com')) failures.push(`${file.path}: contains posthog.com`);
    if (file.text.includes('director.policy_changed')) failures.push(`${file.path}: contains director.policy_changed`);
  }
}

function checkTrack(files, names, failures) {
  for (const file of files) {
    if (!file.path.startsWith('frontend/') || isVendor(file.path) || isTest(file.path)) continue;
    const masked = maskComments(file.text);
    const call = new RegExp(TRACK_CALL.source, 'g');
    let match = call.exec(masked);
    while (match) {
      const name = match[2];
      if (!names.has(name)) {
        failures.push(`${file.path}:${lineOf(masked, match.index)}: track('${name}') is not in the catalog`);
      }
      match = call.exec(masked);
    }
  }
}

export function validateAnalytics({ events, funnels = [], trends = [], files }) {
  const failures = [];
  checkWiring(events, funnels, trends, failures);
  const clientText = sourceText(files, 'frontend/');
  const serverText = sourceText(files, 'backend/app/src/');
  checkEvents(events, clientText, serverText, failures);
  checkBanned(files, failures);
  checkTrack(files, new Set(events.map((event) => event.name)), failures);
  return { ok: failures.length === 0, failures };
}

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR.has(name)) continue;
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) walk(abs, out);
    else if (TEXT_EXT.test(name)) out.push(abs);
  }
}

function loadFiles(root) {
  const files = [];
  for (const rel of ['frontend', 'backend/app/src']) {
    const abs = join(root, rel);
    const found = [];
    try {
      walk(abs, found);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    for (const file of found) {
      const path = relative(root, file).split(sep).join('/');
      files.push({ path, text: readFileSync(file, 'utf8') });
    }
  }
  return files;
}

async function loadCatalog(root) {
  const catalog = await import(pathToFileURL(join(root, 'shared/contracts/src/analytics/catalog.ts')).href);
  const funnels = await import(pathToFileURL(join(root, 'shared/contracts/src/analytics/funnels.ts')).href);
  return { events: catalog.ANALYTICS_EVENTS, funnels: funnels.ANALYTICS_FUNNELS, trends: funnels.ANALYTICS_TRENDS };
}

function invokedDirectly() {
  const entry = process.argv[1];
  return Boolean(entry) && fileURLToPath(import.meta.url) === resolve(entry);
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
  const { events, funnels, trends } = await loadCatalog(root);
  const result = validateAnalytics({ events, funnels, trends, files: loadFiles(root) });
  if (result.ok) {
    console.log(`analytics ok: ${events.length} events, ${funnels.length} funnels, ${trends.length} trends`);
    return;
  }
  console.error(`analytics validation failed (${result.failures.length}):`);
  for (const line of result.failures) console.error(`- ${line}`);
  process.exit(1);
}

if (invokedDirectly()) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
