import { computeTileLayouts, extractList, findByMarker } from '../../posthog-dashboard-sync/scripts/posthog-diff.mjs';

const REMOTE_REQUIRED = [
  'dashboards-get-all',
  'dashboard-get',
  'dashboard-create',
  'dashboard-update',
  'insights-list',
  'insight-get',
  'insight-create',
  'insight-update',
  'insight-query',
  'dashboard-insights-run',
];

const LOCAL_REQUIRED = [
  'dashboards-get-all',
  'dashboard-get',
  'dashboard-create',
  'dashboard-update',
  'insights-get-all',
  'insight-create-from-query',
  'insight-update',
  'query-run',
];

export function unwrapExecPayload(raw) {
  if (typeof raw === 'string') return parseEnvelopeText(raw);
  if (raw && typeof raw === 'object' && Array.isArray(raw.content)) {
    const text = raw.content.find((item) => item?.type === 'text')?.text ?? '';
    return parseEnvelopeText(text);
  }
  if (raw && typeof raw === 'object' && typeof raw.content === 'string') {
    return parseEnvelopeText(raw.content);
  }
  return raw;
}

function parseEnvelopeText(text) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return {};
  const tagMatch = /<[a-z-]+-reference[^>]*>\s*([\s\S]*?)\s*<\/[a-z-]+-reference>/i.exec(trimmed);
  const candidate = tagMatch ? tagMatch[1].trim() : trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    return { text: trimmed };
  }
}

async function paginateRemote(execCall, toolName, extra = {}) {
  const out = [];
  const limit = 200;
  let offset = 0;
  while (true) {
    const page = await execCall(toolName, { limit, offset, ...extra });
    const rows = extractList(page);
    out.push(...rows);
    const rawCount = Array.isArray(page) ? page.length : Array.isArray(page?.results) ? page.results.length : 0;
    if (!page?.next || rawCount === 0) break;
    offset += limit;
  }
  return out;
}

async function enrichRemoteInsightQueries(execCall, plan, dashboards, insights) {
  const byInsightId = new Map(insights.map((ins) => [ins.id, ins]));
  for (const dashSpec of plan.dashboards) {
    const dash = findByMarker(dashboards, 'ta-dashboard', dashSpec.key, dashSpec.name);
    if (!dash) continue;
    const full = await execCall('dashboard-get', {
      id: dash.id,
      expand: ['tiles.*.insight.query'],
      include_dashboards: true,
    });
    for (const tile of full?.tiles ?? []) {
      const ins = tile?.insight;
      if (ins && byInsightId.has(ins.id)) {
        const target = byInsightId.get(ins.id);
        target.query = ins.query;
        if (!Array.isArray(target.dashboards)) target.dashboards = [];
        if (!target.dashboards.includes(dash.id)) target.dashboards.push(dash.id);
      }
    }
  }
  for (const spec of plan.insights) {
    const match = findByMarker(insights, 'ta-id', spec.id, spec.name);
    if (match && !match.query) {
      const full = await execCall('insight-get', { id: match.id, include_dashboards: true });
      if (full?.query) match.query = full.query;
      if (Array.isArray(full?.dashboards)) match.dashboards = full.dashboards;
    }
  }
  return insights;
}

function createRemoteExecAdapter(mcp, projectId) {
  const execCall = async (toolName, args = {}) => {
    const raw = await mcp.callTool('exec', {
      command: `call --json ${toolName} ${JSON.stringify(args)}`,
      context: 'TerraAgent analytics Graph -> Loop audit',
    });
    const parsed = unwrapExecPayload(raw);
    if (parsed?.error || parsed?.error_message) {
      throw new Error(`PostHog remote MCP ${toolName} failed: ${parsed.error_message ?? parsed.error}`);
    }
    return parsed;
  };

  return {
    mode: 'remote-exec',
    async init() {
      const rawTools = await mcp.callTool('exec', {
        command: 'tools',
        context: 'Verify available PostHog remote MCP tools',
      });
      const parsedTools = Array.isArray(rawTools) ? rawTools : unwrapExecPayload(rawTools);
      const available = Array.isArray(parsedTools)
        ? parsedTools.map((t) => (typeof t === 'string' ? t : t?.name)).filter(Boolean)
        : Array.isArray(parsedTools?.tools)
          ? parsedTools.tools.map((t) => (typeof t === 'string' ? t : t?.name)).filter(Boolean)
          : [];
      const missing = REMOTE_REQUIRED.filter((name) => !available.includes(name));
      if (projectId) {
        await execCall('switch-project', { projectId: Number(projectId) });
      }
      return { tools: available, missing };
    },
    async listDashboards() {
      return paginateRemote(execCall, 'dashboards-get-all');
    },
    async listInsights(plan, dashboards) {
      const rows = await paginateRemote(execCall, 'insights-list', { include_dashboards: true });
      return enrichRemoteInsightQueries(execCall, plan, dashboards, rows);
    },
    getDashboard: (id) => execCall('dashboard-get', { id, expand: ['tiles.*.insight.query'], include_dashboards: true }),
    createDashboard: (data) => execCall('dashboard-create', data),
    updateDashboard: (id, data) => execCall('dashboard-update', { id, ...data }),
    createInsight: (data) => execCall('insight-create', data),
    updateInsight: (id, data) => execCall('insight-update', { id, ...data }),
    async layoutDashboard(dashId, dashInsights) {
      const fetched = await execCall('dashboard-get', { id: dashId, expand: ['tiles.*.insight.query'] });
      const tiles = computeTileLayouts(fetched, dashInsights);
      if (tiles.length > 0) await execCall('dashboard-update', { id: dashId, tiles });
    },
    async verifyQueries(plan, dashIds, insights, sampleIds) {
      for (const dash of plan.dashboards) {
        const id = dashIds.get(dash.key);
        if (!id) continue;
        const fullDash = await execCall('dashboard-get', { id });
        const tileIds = (fullDash?.tiles ?? [])
          .filter((t) => t && t.deleted !== true && t.insight && typeof t.id === 'number')
          .map((t) => t.id);
        for (let i = 0; i < Math.max(1, tileIds.length); i += 6) {
          const chunk = tileIds.slice(i, i + 6);
          const args = chunk.length > 0 ? { id, dashboard_tile_ids: chunk, refresh: 'blocking' } : { id, refresh: 'blocking' };
          const runRes = await execCall('dashboard-insights-run', args);
          const rows = runRes?.results ?? [];
          for (const row of rows) {
            if (row?.error || row?.insight?.error) {
              throw new Error(`dashboard-insights-run failed for ${row?.insight?.name ?? row?.id}: ${row?.error ?? row.insight.error}`);
            }
          }
          if (chunk.length > 0 && rows.length < chunk.length) {
            throw new Error(`dashboard-insights-run returned ${rows.length}/${chunk.length} tiles for dashboard ${id}`);
          }
          if (tileIds.length === 0) break;
        }
      }
      const executedQueries = [];
      for (const id of sampleIds) {
        const spec = plan.insights.find((item) => item.id === id);
        const match = spec ? findByMarker(insights, 'ta-id', spec.id, spec.name) : null;
        if (!match) continue;
        const res = await execCall('insight-query', { insightId: match.id });
        if (res?.error || res?.error_message) {
          throw new Error(`insight-query failed for ${id}: ${res.error_message ?? res.error}`);
        }
        executedQueries.push(id);
      }
      return executedQueries;
    },
  };
}

function createLocalFlatAdapter(mcp, tools) {
  return {
    mode: 'local-flat',
    async init() {
      const missing = LOCAL_REQUIRED.filter((name) => !tools.includes(name));
      return { tools, missing };
    },
    listDashboards: () => mcp.callTool('dashboards-get-all', {}),
    listInsights: () => mcp.callTool('insights-get-all', {}),
    getDashboard: (id) => mcp.callTool('dashboard-get', { dashboardId: id }),
    createDashboard: (data) => mcp.callTool('dashboard-create', { data }),
    updateDashboard: (id, data) => mcp.callTool('dashboard-update', { dashboardId: id, data }),
    createInsight: (data) => mcp.callTool('insight-create-from-query', { data }),
    updateInsight: (id, data) => mcp.callTool('insight-update', { insightId: id, data }),
    async layoutDashboard(dashId, dashInsights) {
      const fetched = await mcp.callTool('dashboard-get', { dashboardId: dashId });
      const tiles = computeTileLayouts(fetched, dashInsights);
      if (tiles.length > 0) await mcp.callTool('dashboard-update', { dashboardId: dashId, data: { tiles } });
    },
    async verifyQueries(plan, _dashIds, _insights, sampleIds) {
      const executedQueries = [];
      for (const id of sampleIds) {
        const ins = plan.insights.find((item) => item.id === id);
        if (!ins) continue;
        const res = await mcp.callTool('query-run', { query: ins.query });
        if (res?.error || res?.error_message) {
          throw new Error(`query-run failed for ${id}: ${res.error_message ?? res.error}`);
        }
        executedQueries.push(id);
      }
      return executedQueries;
    },
  };
}

export function createMcpAdapter(mcp, tools, projectId) {
  if (tools.includes('exec')) return createRemoteExecAdapter(mcp, projectId);
  return createLocalFlatAdapter(mcp, tools);
}
