#!/usr/bin/env node
// Regenerates frontend/dev/api-atlas from Nest controllers, the contracts schema, and frontend call sites.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const OUT_DIR = join(ROOT, 'frontend/dev/api-atlas');
const SCHEMA_KEYS = ['clientMessages', 'serverMessages', 'commands', 'events'];
const META_KEYS = new Set(['audience', 'summary', 'wave', 'severity', 'origin', 'description']);

const relOf = (path) => relative(ROOT, path).split('\\').join('/');

function walk(dir, accept, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '.git') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, accept, out);
    else if (accept(name, path)) out.push(path);
  }
  return out;
}

function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pre(value) {
  return `<pre>${esc(JSON.stringify(value, null, 2))}</pre>`;
}

function readPrefix(appSource) {
  const match = appSource.match(/setGlobalPrefix\(\s*['"]([^'"]+)['"]([\s\S]*?)\)\s*;/);
  if (!match) return { prefix: 'v1', exclude: [], found: false };
  const exclude = [];
  const list = match[2].match(/exclude\s*:\s*\[([^\]]*)\]/);
  if (list) for (const item of list[1].matchAll(/['"]([^'"]+)['"]/g)) exclude.push(item[1]);
  return { prefix: match[1], exclude, found: true };
}

function decoratorPaths(args) {
  const parts = [...args.matchAll(/['"]([^'"]*)['"]/g)].map((item) => item[1]);
  return parts.length ? parts : [''];
}

function joinRoute(globalPrefix, controllerPrefix, routePath, exclude) {
  const raw = [controllerPrefix, routePath].flatMap((part) => part.split('/')).filter(Boolean).join('/');
  const excluded = new Set(exclude.map((item) => item.split('/').filter(Boolean).join('/')));
  if (excluded.has(raw)) return `/${raw}`;
  const head = globalPrefix.split('/').filter(Boolean).join('/');
  return `/${[head, raw].filter(Boolean).join('/')}`;
}

function takeDecorator(lines, index) {
  let buf = lines[index];
  let depth = 0;
  let started = false;
  const count = (line) => {
    for (const ch of line) {
      if (ch === '(') { depth += 1; started = true; }
      else if (ch === ')') depth -= 1;
    }
  };
  count(buf);
  let end = index;
  while (started && depth > 0 && end + 1 < lines.length && end - index < 8) {
    end += 1;
    buf += `\n${lines[end]}`;
    count(lines[end]);
  }
  return { buf, next: end };
}

function methodWindow(lines, index) {
  const out = [];
  for (let i = index; i < lines.length && out.length < 40; i += 1) {
    if (i > index && /^[ \t]*@(?:Controller|Get|Post|Put|Patch|Delete)\b/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join('\n');
}

function balancedEnd(source, openAt) {
  let depth = 0;
  for (let i = openAt; i < source.length; i += 1) {
    if (source[i] === '(') depth += 1;
    else if (source[i] === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return source.length - 1;
}

function eachParam(source, name) {
  const found = [];
  const needle = `@${name}`;
  let from = 0;
  while (from < source.length) {
    const at = source.indexOf(needle, from);
    if (at < 0) break;
    const after = at + needle.length;
    if (/[A-Za-z0-9_]/.test(source[after] ?? '')) { from = after; continue; }
    let cursor = after;
    while (/\s/.test(source[cursor] ?? '')) cursor += 1;
    let inside = '';
    if (source[cursor] === '(') {
      const end = balancedEnd(source, cursor);
      inside = source.slice(cursor + 1, end).trim();
      cursor = end + 1;
    }
    const rest = source.slice(cursor).match(/^\s*([A-Za-z0-9_]+)?\s*(\?)?\s*(?::\s*([^,)\n]+))?/);
    const named = inside.match(/['"]([^'"]+)['"]/);
    found.push({
      name: named?.[1] ?? null,
      optional: Boolean(rest?.[2]) || /\| undefined\b/.test(rest?.[3] ?? ''),
      type: rest?.[3]?.trim() ?? null,
      inside,
    });
    from = cursor;
  }
  return found;
}

function zodSource(fileText, name) {
  if (!name) return null;
  const match = new RegExp(`(?:const|let)\\s+${name}\\s*=\\s*`).exec(fileText);
  if (!match) return null;
  let depth = 0;
  let out = '';
  for (let i = match.index + match[0].length; i < fileText.length && out.length < 1500; i += 1) {
    const ch = fileText[i];
    if (ch === '(' || ch === '{' || ch === '[') depth += 1;
    if (ch === ')' || ch === '}' || ch === ']') depth -= 1;
    out += ch;
    if (ch === ';' && depth <= 0) break;
  }
  return out.trim().replace(/\s+/g, ' ');
}

function httpSchemas(signature, routePath, fileText) {
  const params = eachParam(signature, 'Param').map((item) => ({
    name: item.name,
    ...(item.type ? { type: item.type.replace(/\s+/g, ' ') } : {}),
    ...(item.optional ? { optional: true } : {}),
  }));
  const seen = new Set(params.map((item) => item.name).filter(Boolean));
  for (const name of routePath.matchAll(/:([A-Za-z0-9_]+)/g)) {
    if (!seen.has(name[1])) params.push({ name: name[1], in: 'path' });
  }
  const query = eachParam(signature, 'Query').filter((item) => item.name).map((item) => ({
    name: item.name,
    ...(item.type ? { type: item.type.replace(/\s+/g, ' ') } : {}),
    ...(item.optional ? { optional: true } : {}),
  }));
  const bodyDec = eachParam(signature, 'Body')[0];
  let body = null;
  if (bodyDec || /parseBody\s*\(/.test(signature)) {
    const zodName = bodyDec?.inside.match(/ZodPipe\(\s*([A-Za-z0-9_]+)/)?.[1]
      ?? signature.match(/parseBody\(\s*([A-Za-z0-9_]+)/)?.[1]
      ?? null;
    const type = bodyDec?.type?.replace(/\s+/g, ' ') ?? null;
    const source = zodSource(fileText, zodName);
    body = {
      ...(type ? { type } : {}),
      ...(zodName ? { schema: zodName } : {}),
      ...(source ? { zod: source } : {}),
      ...(!type && !zodName ? { note: 'body parameter present; shape not annotated' } : {}),
    };
  }
  const returns = [...signature.matchAll(/\)\s*:\s*([^({]+?)\s*\{/g)];
  const returnType = returns.length ? returns[returns.length - 1][1].trim().replace(/\s+/g, ' ') : null;
  const status = signature.match(/@HttpCode\(\s*(\d+)\s*\)/)?.[1] ?? null;
  return {
    request: { params, query, body },
    response: {
      ...(status ? { status: Number(status) } : {}),
      returnType,
      note: returnType
        ? 'No JSON Schema on this route. Return type is the controller method signature.'
        : 'No JSON Schema or return type on this controller method.',
    },
  };
}

function firstCallArgs(buf) {
  const at = buf.search(/@(?:Controller|Get|Post|Put|Patch|Delete)\s*\(/);
  if (at < 0) return null;
  const name = buf.slice(at).match(/^@(Controller|Get|Post|Put|Patch|Delete)/)?.[1];
  if (!name) return null;
  const open = buf.indexOf('(', at);
  const end = balancedEnd(buf, open);
  return { name, args: buf.slice(open + 1, end) };
}

function parseControllers(globalPrefix, exclude) {
  const files = walk(join(ROOT, 'backend/app/src'), (name) => name.endsWith('.controller.ts'));
  const routes = [];
  const gaps = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    let prefixes = null;
    for (let i = 0; i < lines.length; i += 1) {
      if (!/^[ \t]*@(?:Controller|Get|Post|Put|Patch|Delete)\b/.test(lines[i])) continue;
      const start = i;
      const taken = takeDecorator(lines, i);
      i = taken.next;
      const call = firstCallArgs(taken.buf);
      if (!call) {
        gaps.push(`${relOf(file)}: unparsed decorator near line ${start + 1}`);
        continue;
      }
      if (call.name === 'Controller') {
        prefixes = decoratorPaths(call.args);
        continue;
      }
      if (!prefixes) {
        gaps.push(`${relOf(file)}: @${call.name} before @Controller`);
        prefixes = [''];
      }
      const windowText = methodWindow(lines, start);
      for (const prefix of prefixes) {
        for (const routePath of decoratorPaths(call.args)) {
          const path = joinRoute(globalPrefix, prefix, routePath, exclude);
          const schemas = httpSchemas(windowText, path, text);
          routes.push({
            method: call.name.toUpperCase(),
            path,
            file: relOf(file),
            line: start + 1,
            request: schemas.request,
            response: schemas.response,
            callers: [],
          });
        }
      }
    }
    if (!/^[ \t]*@Controller\b/m.test(text)) gaps.push(`${relOf(file)}: controller file has no @Controller`);
  }
  routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method) || a.file.localeCompare(b.file));
  return { routes, gaps, files: files.map(relOf) };
}

function payloadSchema(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value ?? { note: 'empty schema' };
  if (value.args && typeof value.args === 'object') return value.args;
  if (value.data && typeof value.data === 'object') return value.data;
  const rest = {};
  for (const [key, item] of Object.entries(value)) if (!META_KEYS.has(key)) rest[key] = item;
  return Object.keys(rest).length ? rest : value;
}

function metaOf(value) {
  const meta = {};
  if (!value || typeof value !== 'object') return meta;
  for (const key of META_KEYS) if (key in value) meta[key] = value[key];
  return meta;
}

function loadSchema() {
  const file = join(ROOT, 'shared/contracts/schema/contracts.schema.json');
  const schema = JSON.parse(readFileSync(file, 'utf8'));
  for (const key of SCHEMA_KEYS) {
    if (!schema[key] || typeof schema[key] !== 'object') throw new Error(`contracts schema missing ${key}`);
  }
  return schema;
}

function scanFrontend() {
  const files = walk(join(ROOT, 'frontend'), (name, path) => name.endsWith('.ts') && !name.endsWith('.spec.ts') && !path.includes(`${join('node_modules')}`) && !path.includes(`${join('dist')}`));
  const docs = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const strings = [];
    scanStrings(text, (value) => { if (value.includes('/v1/') || value.includes('/deed/')) strings.push(value); });
    const sockets = new Set();
    for (const item of text.matchAll(/\bt\s*:\s*['"]([A-Za-z0-9_.]+)['"]/g)) sockets.add(item[1]);
    docs.push({ file: relOf(file), text, strings, sockets });
  }
  return docs;
}

function scanStrings(text, onString) {
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '/' && next === '/') { i += 2; while (i < n && text[i] !== '\n') i += 1; continue; }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      i += 1;
      let out = '';
      let closed = false;
      while (i < n) {
        if (text[i] === '\\') { out += text[i + 1] ?? ''; i += 2; continue; }
        if (text[i] === quote) { closed = true; i += 1; break; }
        out += text[i];
        i += 1;
        if (out.length > 8000) break;
      }
      if (closed && out.length <= 8000) onString(out);
      continue;
    }
    i += 1;
  }
}

const PATH_CHARS = '[A-Za-z0-9_.:${}()[\\],/*%+-]*';

function mentionPaths(literal) {
  const found = [];
  for (const item of literal.matchAll(new RegExp(`/v1/${PATH_CHARS}`, 'g'))) found.push(cleanPath(item[0]));
  for (const item of literal.matchAll(new RegExp(`/deed/${PATH_CHARS}`, 'g'))) found.push(cleanPath(item[0]));
  return found;
}

function cleanPath(path) {
  let value = path;
  const hash = value.indexOf('#');
  if (hash >= 0) value = value.slice(0, hash);
  const query = value.indexOf('?');
  if (query >= 0) value = value.slice(0, query);
  value = value.replace(/[),.;:]+$/g, '');
  if (value.length > 1 && value.endsWith('/')) value = value.slice(0, -1);
  return value;
}

function classifyMention(mention) {
  if (mention.endsWith('/*')) return { kind: 'prefix', path: mention.slice(0, -2) };
  const expr = mention.indexOf('${');
  if (expr > 0 && mention[expr - 1] !== '/') return { kind: 'prefix', path: mention.slice(0, expr).replace(/\/+$/, '') };
  return { kind: 'path', path: mention };
}

function segmentMatch(routeSeg, clientSeg) {
  if (routeSeg === clientSeg) return true;
  const template = clientSeg.includes('${') || clientSeg === '*' || clientSeg.startsWith(':');
  if (!template) return routeSeg.startsWith(':') && clientSeg.length > 0 && !clientSeg.includes('*');
  if (routeSeg.startsWith(':')) return true;
  // ${PATH[tab]} or ${encodeURIComponent(id)} can name a static segment. A plain ${id} only fills :params.
  return clientSeg.includes('(') || clientSeg.includes('[');
}

function mentionMatches(routePath, mention) {
  const classified = classifyMention(mention);
  if (classified.kind === 'prefix') return routePath === classified.path || routePath.startsWith(`${classified.path}/`);
  const routeSegs = routePath.split('/').filter(Boolean);
  const clientSegs = classified.path.split('/').filter(Boolean);
  if (routeSegs.length !== clientSegs.length) return false;
  return routeSegs.every((seg, index) => segmentMatch(seg, clientSegs[index]));
}

function attachHttpCallers(routes, docs) {
  const unmatched = new Map();
  for (const doc of docs) {
    const mentions = new Set();
    for (const literal of doc.strings) for (const path of mentionPaths(literal)) mentions.add(path);
    for (const mention of mentions) {
      const hits = routes.filter((route) => mentionMatches(route.path, mention));
      if (!hits.length) {
        if (!unmatched.has(mention)) unmatched.set(mention, new Set());
        unmatched.get(mention).add(doc.file);
        continue;
      }
      for (const route of hits) route.callers.push(doc.file);
    }
  }
  for (const route of routes) route.callers = [...new Set(route.callers)].sort();
  return [...unmatched.entries()]
    .map(([path, files]) => ({ path, files: [...files].sort() }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function mentionsKind(text, kind) {
  if (text.includes(`'${kind}'`) || text.includes(`"${kind}"`) || text.includes(`\`${kind}\``)) return true;
  return new RegExp(`(^|[^A-Za-z0-9_$])${kind.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`).test(text);
}

function callersFor(docs, kind) {
  return docs.filter((doc) => mentionsKind(doc.text, kind)).map((doc) => doc.file).sort();
}

function socketCards(schema, docs) {
  const known = new Set([...Object.keys(schema.clientMessages), ...Object.keys(schema.serverMessages)]);
  const byType = new Map();
  const unknown = new Map();
  for (const doc of docs) {
    for (const type of doc.sockets) {
      const bucket = known.has(type) ? byType : unknown;
      if (!bucket.has(type)) bucket.set(type, new Set());
      bucket.get(type).add(doc.file);
    }
  }
  const cards = [];
  for (const [type, value] of Object.entries(schema.clientMessages)) {
    cards.push(socketCard('client → server', type, value, byType.get(type)));
  }
  for (const [type, value] of Object.entries(schema.serverMessages)) {
    cards.push(socketCard('server → client', type, value, byType.get(type)));
  }
  cards.sort((a, b) => a.name.localeCompare(b.name) || a.direction.localeCompare(b.direction));
  const unknownList = [...unknown.entries()]
    .map(([type, files]) => ({ type, files: [...files].sort() }))
    .sort((a, b) => a.type.localeCompare(b.type));
  return { cards, unknown: unknownList };
}

function socketCard(direction, name, schema, files) {
  const callers = files ? [...files].sort() : [];
  const message = schema ?? { note: 'missing schema' };
  const client = direction.startsWith('client');
  return {
    direction,
    name,
    callers,
    request: client ? message : { note: 'Server push. There is no client request body for this message.' },
    response: client
      ? { note: 'No paired response schema. The server answers with a separate message (for example cmd.ack, cmd.reject, welcome, or pong).' }
      : message,
  };
}

function namedCards(map, docs, requestSide) {
  return Object.entries(map)
    .map(([name, value]) => {
      const schema = payloadSchema(value);
      const meta = metaOf(value);
      const note = requestSide
        ? { note: 'Sim command result is cmd.ack, cmd.reject, or a later event. This catalog does not invent a response schema.', ...meta }
        : { note: 'Sim event published by the server. Not a client request.', ...meta };
      return {
        name,
        callers: callersFor(docs, name),
        request: requestSide ? schema : note,
        response: requestSide ? note : schema,
        summary: typeof meta.summary === 'string' ? meta.summary : '',
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function callerBlock(files) {
  if (!files.length) return '<p class="from"><span class="lbl">called from</span> <span class="none">no client caller found</span></p>';
  const items = files.map((file) => `<code>${esc(file)}</code>`).join(' ');
  return `<p class="from"><span class="lbl">called from</span> ${items}</p>`;
}

function card(dataKey, summary, body) {
  return `<details class="card" data-k="${esc(dataKey)}"><summary>${summary}</summary><div class="body">${body}</div></details>`;
}

function schemaBody(callers, request, response, extra = '') {
  return `${extra}${callerBlock(callers)}<h3>Request</h3>${pre(request)}<h3>Response</h3>${pre(response)}`;
}

function renderHtml(model) {
  const http = model.routes.map((route) => card(
    `${route.method} ${route.path} ${route.file} ${route.callers.join(' ')}`.toLowerCase(),
    `<span class="verb ${route.method === 'GET' ? 'get' : 'act'}">${esc(route.method)}</span><span class="path">${esc(route.path)}</span><span class="src">${esc(route.file)}</span>`,
    schemaBody(route.callers, route.request, route.response),
  )).join('\n');
  const sockets = model.sockets.map((item) => card(
    `${item.direction} ${item.name} ${item.callers.join(' ')}`.toLowerCase(),
    `<span class="verb ${item.direction.startsWith('client') ? 'act' : 'server'}">${esc(item.direction)}</span><span class="path">${esc(item.name)}</span>`,
    schemaBody(item.callers, item.request, item.response),
  )).join('\n');
  const commands = model.commands.map((item) => card(
    `cmd ${item.name} ${item.summary} ${item.callers.join(' ')}`.toLowerCase(),
    `<span class="verb act">cmd</span><span class="path">${esc(item.name)}</span>`,
    schemaBody(item.callers, item.request, item.response, item.summary ? `<p class="meta">${esc(item.summary)}</p>` : ''),
  )).join('\n');
  const events = model.events.map((item) => card(
    `event ${item.name} ${item.summary} ${item.callers.join(' ')}`.toLowerCase(),
    `<span class="verb server">event</span><span class="path">${esc(item.name)}</span>`,
    schemaBody(item.callers, item.request, item.response, item.summary ? `<p class="meta">${esc(item.summary)}</p>` : ''),
  )).join('\n');
  const gapItems = [
    ...model.gaps,
    ...model.unmatched.slice(0, 40).map((item) => `unmatched ${item.path} (${item.files.slice(0, 3).join(', ')})`),
    ...model.unknownT.slice(0, 40).map((item) => `t:'${item.type}' is not a wire message (${item.files.slice(0, 2).join(', ')})`),
  ];
  const more = model.unmatched.length + model.unknownT.length > 80 ? '<li>further unmatched mentions omitted</li>' : '';
  const noCaller = model.routes.filter((route) => route.callers.length === 0).length;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TerraAgent API atlas</title>
<link rel="stylesheet" href="./atlas.css">
</head>
<body>
<header>
  <p class="kicker">GENERATED</p>
  <h1>TerraAgent API atlas</h1>
  <p class="note">Generated file. Regenerate with <code>npm run api:atlas</code>. Do not hand-edit.</p>
  <p class="counts">${model.routes.length} HTTP · ${model.sockets.length} socket messages · ${model.commands.length} commands · ${model.events.length} events · ${noCaller} HTTP routes with no client caller</p>
  <nav>
    <a href="#http">HTTP</a>
    <a href="#socket">WebSocket</a>
    <a href="#commands">Commands</a>
    <a href="#events">Events</a>
  </nav>
  <div class="search-wrap"><input id="q" type="search" placeholder="Filter by name or path" aria-label="Filter by name or path" autocomplete="off"></div>
</header>
<main>
<section class="group" id="http"><h2>HTTP</h2>${http}</section>
<section class="group" id="socket"><h2>WebSocket</h2>${sockets}</section>
<section class="group" id="commands"><h2>Commands</h2>${commands}</section>
<section class="group" id="events"><h2>Events</h2>${events}</section>
<section class="group" id="gaps"><h2>Scan gaps</h2>
<p class="meta">Comment-only paths are ignored. <code>t:</code> values that are not in clientMessages or serverMessages (worker protocol, local host) are listed here and are not routes.</p>
<ul>${gapItems.map((item) => `<li><code>${esc(item)}</code></li>`).join('')}${more}</ul>
</section>
</main>
<script>
(() => {
  const q = document.getElementById('q');
  const cards = Array.from(document.querySelectorAll('details.card'));
  const groups = Array.from(document.querySelectorAll('section.group'));
  const apply = () => {
    const needle = q.value.trim().toLowerCase();
    for (const card of cards) card.hidden = needle.length > 0 && !(card.getAttribute('data-k') || '').includes(needle);
    for (const group of groups) {
      if (group.id === 'gaps') continue;
      group.hidden = needle.length > 0 && !Array.from(group.querySelectorAll('details.card')).some((card) => !card.hidden);
    }
  };
  q.addEventListener('input', apply);
})();
</script>
</body>
</html>
`;
}

const CSS = `/* Generated by npm run api:atlas. Do not hand-edit. */
:root {
  color-scheme: dark;
  --void: #07080a;
  --plate: #12151b;
  --text: #e8e4da;
  --muted: #93a0ae;
  --seam: #2a3340;
  --orange: #ff7a1a;
  --ink: #140c06;
  --blue: #8eb7ff;
}
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--void); color: var(--text); }
body { font-family: "IBM Plex Sans", system-ui, sans-serif; line-height: 1.45; min-height: 100vh; }
header, main { width: min(1100px, 100%); margin: 0 auto; padding: 28px 24px 8px; }
main { padding-top: 8px; padding-bottom: 64px; }
h1 { margin: 4px 0 8px; font-size: 32px; letter-spacing: 0.04em; font-weight: 650; }
h2 { margin: 28px 0 12px; color: var(--orange); font-size: 13px; letter-spacing: 0.16em; text-transform: uppercase; }
.kicker { margin: 0; color: var(--blue); letter-spacing: 0.18em; font-size: 11px; }
.note, .counts, .meta { color: var(--muted); }
.counts, code, .path, .src, .verb, pre { font-family: "IBM Plex Mono", ui-monospace, monospace; }
nav { display: flex; flex-wrap: wrap; gap: 8px 16px; margin: 12px 0 16px; }
nav a { color: var(--blue); font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; text-decoration: none; }
nav a:hover { color: var(--orange); }
.search-wrap {
  width: min(560px, 100%);
  background: var(--seam);
  clip-path: polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px);
  padding: 1px;
}
.search-wrap input {
  width: 100%;
  background: var(--void);
  color: var(--text);
  border: 0;
  padding: 10px 12px;
  font: inherit;
  clip-path: polygon(7px 0, 100% 0, 100% calc(100% - 7px), calc(100% - 7px) 100%, 0 100%, 0 7px);
}
.card {
  background: var(--plate);
  clip-path: polygon(12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%, 0 12px);
  margin: 0 0 12px;
}
summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  align-items: baseline;
  padding: 12px 16px 12px 18px;
  cursor: pointer;
  list-style: none;
}
summary::-webkit-details-marker { display: none; }
.verb { display: inline-block; font-size: 12px; letter-spacing: 0.06em; padding: 2px 8px; background: var(--orange); color: var(--ink); }
.verb.get, .verb.server { background: transparent; color: var(--blue); box-shadow: inset 0 0 0 1px var(--blue); }
.path { font-size: 14px; }
.src { margin-left: auto; color: var(--muted); font-size: 11px; }
.body { padding: 0 16px 16px 18px; }
.card h3 { margin: 14px 0 6px; color: var(--blue); font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; font-weight: 600; }
.from code { color: var(--text); font-size: 12px; margin-right: 8px; }
.lbl { color: var(--blue); letter-spacing: 0.08em; font-size: 11px; text-transform: uppercase; margin-right: 6px; }
.none { color: var(--orange); }
pre {
  margin: 0;
  padding: 12px;
  background: var(--void);
  color: #d7dde6;
  overflow: auto;
  max-height: 420px;
  font-size: 12px;
  line-height: 1.4;
  clip-path: polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px);
}
ul { padding-left: 18px; }
li { margin: 4px 0; }
[hidden] { display: none !important; }
`;

function main() {
  const appSource = readFileSync(join(ROOT, 'backend/app/src/app.ts'), 'utf8');
  const prefix = readPrefix(appSource);
  const schema = loadSchema();
  const parsed = parseControllers(prefix.prefix, prefix.exclude);
  const docs = scanFrontend();
  const unmatched = attachHttpCallers(parsed.routes, docs);
  const sockets = socketCards(schema, docs);
  const commands = namedCards(schema.commands, docs, true);
  const events = namedCards(schema.events, docs, false);
  const gaps = [...parsed.gaps];
  if (!prefix.found) gaps.push('setGlobalPrefix not found; assumed /v1');
  const html = renderHtml({
    routes: parsed.routes,
    sockets: sockets.cards,
    commands,
    events,
    gaps,
    unmatched,
    unknownT: sockets.unknown,
  });
  for (const needle of ['GET', '/v1/planets', '>cmd<', 'placeBuilding']) {
    if (!html.includes(needle)) throw new Error(`generated atlas missing ${needle}`);
  }
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'index.html'), html);
  writeFileSync(join(OUT_DIR, 'atlas.css'), CSS);
  const summary = {
    http: parsed.routes.length,
    sockets: sockets.cards.length,
    clientToServer: sockets.cards.filter((item) => item.direction.startsWith('client')).length,
    serverToClient: sockets.cards.filter((item) => item.direction.startsWith('server')).length,
    commands: commands.length,
    events: events.length,
    httpNoCaller: parsed.routes.filter((route) => route.callers.length === 0).length,
    unmatchedPaths: unmatched.length,
    unknownSocketShapes: sockets.unknown.length,
    prefix: prefix.prefix,
    exclude: prefix.exclude,
    controllers: parsed.files.length,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (sockets.unknown.length) console.log(`unknown t: ${sockets.unknown.map((item) => item.type).join(', ')}`);
  if (unmatched.length) console.log(`unmatched paths: ${unmatched.map((item) => item.path).slice(0, 30).join(', ')}`);
}

main();
