#!/usr/bin/env node
// Local stdio MCP (JSON-RPC 2.0) server exposing official PostHog MCP tool names backed by PostHog REST API.
import { createInterface } from 'node:readline';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractList, resolveNextPath } from '../../posthog-dashboard-sync/scripts/posthog-diff.mjs';
import { loadPostHogEnv, redactSecrets } from '../../posthog-dashboard-sync/scripts/posthog-env.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const cfg = loadPostHogEnv(ROOT);
const API_BASE = (process.env.POSTHOG_API_BASE || cfg.apiHost).replace(/\/+$/, '');
const PROJECT_ID = process.env.POSTHOG_PROJECT_ID || cfg.projectId;
const API_KEY = process.env.POSTHOG_PERSONAL_API_KEY || cfg.personalApiKey;

const TOOLS = [
  { name: 'dashboards-get-all', description: 'List dashboards in the PostHog project', inputSchema: { type: 'object', properties: {} } },
  { name: 'dashboard-get', description: 'Get a single dashboard with tiles', inputSchema: { type: 'object', properties: { dashboardId: { type: 'number' } }, required: ['dashboardId'] } },
  { name: 'dashboard-create', description: 'Create a PostHog dashboard', inputSchema: { type: 'object', properties: { data: { type: 'object' } }, required: ['data'] } },
  { name: 'dashboard-update', description: 'Update a PostHog dashboard', inputSchema: { type: 'object', properties: { dashboardId: { type: 'number' }, data: { type: 'object' } }, required: ['dashboardId', 'data'] } },
  { name: 'insights-get-all', description: 'List saved insights in the PostHog project', inputSchema: { type: 'object', properties: {} } },
  { name: 'insight-get', description: 'Get a single insight', inputSchema: { type: 'object', properties: { insightId: { type: 'number' } }, required: ['insightId'] } },
  { name: 'insight-create-from-query', description: 'Create an insight from an InsightVizNode query', inputSchema: { type: 'object', properties: { data: { type: 'object' } }, required: ['data'] } },
  { name: 'insight-update', description: 'Update an existing insight', inputSchema: { type: 'object', properties: { insightId: { type: 'number' }, data: { type: 'object' } }, required: ['insightId', 'data'] } },
  { name: 'query-run', description: 'Execute an InsightVizNode or Query API payload', inputSchema: { type: 'object', properties: { query: { type: 'object' } }, required: ['query'] } },
];

async function phFetch(path, init = {}) {
  if (!PROJECT_ID || !API_KEY) throw new Error('Missing project_id or personal_api_key');
  const res = await fetch(`${API_BASE}/api/projects/${PROJECT_ID}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${API_KEY}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${redactSecrets(text.slice(0, 200), cfg)}`);
  return text ? JSON.parse(text) : {};
}

async function listAll(resource) {
  const out = [];
  let nextPath = `/${resource}/?limit=200${resource === 'insights' ? '&include_dashboards=true' : ''}`;
  while (nextPath) {
    const page = await phFetch(nextPath);
    out.push(...extractList(page));
    nextPath = resolveNextPath(page.next, API_BASE, PROJECT_ID);
  }
  return out;
}

async function runTool(name, args = {}) {
  switch (name) {
    case 'dashboards-get-all': return listAll('dashboards');
    case 'dashboard-get': return phFetch(`/dashboards/${args.dashboardId}/`);
    case 'dashboard-create': return phFetch('/dashboards/', { method: 'POST', body: JSON.stringify(args.data ?? args) });
    case 'dashboard-update': return phFetch(`/dashboards/${args.dashboardId}/`, { method: 'PATCH', body: JSON.stringify(args.data ?? {}) });
    case 'insights-get-all': return listAll('insights');
    case 'insight-get': return phFetch(`/insights/${args.insightId}/`);
    case 'insight-create-from-query': return phFetch('/insights/', { method: 'POST', body: JSON.stringify(args.data ?? args) });
    case 'insight-update': return phFetch(`/insights/${args.insightId}/`, { method: 'PATCH', body: JSON.stringify(args.data ?? {}) });
    case 'query-run': return phFetch('/query/', { method: 'POST', body: JSON.stringify({ query: args.query ?? args }) });
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

async function handle(msg) {
  if (!msg || typeof msg !== 'object') return;
  const { id, method, params } = msg;
  if (method === 'notifications/initialized') return;
  try {
    if (method === 'initialize') {
      send({ jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'terra-posthog-mcp', version: '0.1.0' } } });
      return;
    }
    if (method === 'tools/list') {
      send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
      return;
    }
    if (method === 'tools/call') {
      const data = await runTool(params?.name, params?.arguments);
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(data) }] } });
      return;
    }
    if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
  } catch (err) {
    const message = redactSecrets(err instanceof Error ? err.message : String(err), cfg);
    if (method === 'tools/call' && id !== undefined) {
      send({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: message }] } });
      return;
    }
    if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code: -32000, message } });
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    void handle(JSON.parse(trimmed));
  } catch (err) {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: err instanceof Error ? err.message : 'Parse error' } });
  }
});
