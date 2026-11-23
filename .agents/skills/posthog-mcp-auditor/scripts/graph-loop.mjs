#!/usr/bin/env node
// Graph -> Loop verification & reconciliation engine backed by PostHog MCP tools.
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compilePostHogPlan } from '../../posthog-dashboard-sync/scripts/posthog-compiler.mjs';
import { diffRemotePlan, getInsightDashboardIds, verifyDashboardTileLayouts } from '../../posthog-dashboard-sync/scripts/posthog-diff.mjs';
import { loadPostHogEnv } from '../../posthog-dashboard-sync/scripts/posthog-env.mjs';
import { scanUiGraph } from '../../posthog-surface-scanner/scripts/scan-ui-graph.mjs';
import { createMcpAdapter } from './mcp-adapter.mjs';
import { connectMcp } from './mcp-client.mjs';
import { startMockPostHogServer } from './mock-posthog-server.mjs';

const REQUIRED_STARTER_IDS = [
  'visitors', 'visitors-wau', 'pageviews-by-surface', 'visitors-by-country', 'country-world-map',
  'acquisition', 'landing-to-play', 'whitepaper-to-play', 'pitchdeck-to-play', 'country-acquisition',
  'planet', 'colony-hud-to-command', 'trade', 'market', 'gameplay', 'profile',
  'ui-actions-by-surface', 'ui-actions-top', 'hud-panels-opened', 'visitor-retention', 'colony-retention',
  'auto-in-game-dock-tabs', 'auto-in-game-colony-tabs', 'auto-build-buildings', 'auto-units-queued', 'auto-terraform-ops',
  'auto-in-game-ui-areas', 'auto-funnel-build-button', 'auto-funnel-units-button', 'auto-funnel-terraform-button',
];

const SAMPLE_QUERY_IDS = [
  'visitors-wau',
  'visitors-by-country',
  'country-world-map',
  'acquisition',
  'acquisition-fail',
  'auto-funnel-build-button',
  'ui-actions-top',
  'visitor-retention',
];

function checkGraphStarterCoverage(scan, plan) {
  const errors = [];
  if (scan.coverage.unbootedPages.length > 0) errors.push(`unbooted pages: ${scan.coverage.unbootedPages.join(', ')}`);
  if (scan.coverage.deadMatchers?.length > 0) errors.push(`dead UI matchers: ${scan.coverage.deadMatchers.join(', ')}`);
  const ids = new Set(plan.insights.map((i) => i.id));
  for (const reqId of REQUIRED_STARTER_IDS) {
    if (!ids.has(reqId)) errors.push(`missing required starter insight in graph: ${reqId}`);
  }
  return errors;
}

async function reconcileViaMcp(adapter, diff, plan) {
  for (const dash of diff.missingDashboards) {
    const created = await adapter.createDashboard({
      name: dash.name, description: dash.description, pinned: true, tags: dash.tags,
    });
    if (created?.id) diff.dashIds.set(dash.key, created.id);
  }
  for (const { spec, existing } of diff.driftedDashboards) {
    await adapter.updateDashboard(existing.id, {
      name: spec.name, description: spec.description, pinned: true, tags: spec.tags,
    });
  }
  for (const ins of diff.missingInsights) {
    const dashId = diff.dashIds.get(ins.dashboardKey);
    await adapter.createInsight({
      name: ins.name,
      description: ins.description,
      tags: ins.tags,
      dashboards: dashId ? [dashId] : [],
      query: ins.query,
    });
  }
  for (const { spec, existing } of diff.driftedInsights) {
    const dashId = diff.dashIds.get(spec.dashboardKey);
    const prevDash = getInsightDashboardIds(existing);
    const dashboards = dashId && !prevDash.includes(dashId) ? [...prevDash, dashId] : prevDash;
    await adapter.updateInsight(existing.id, {
      name: spec.name, description: spec.description, tags: spec.tags, dashboards, query: spec.query,
    });
  }
  for (const dash of plan.dashboards) {
    const dashId = diff.dashIds.get(dash.key);
    if (!dashId) continue;
    await adapter.layoutDashboard(dashId, plan.insights.filter((i) => i.dashboardKey === dash.key));
  }
}

async function doubleCheckViaMcp(adapter, plan, dashIds, insights) {
  const checkedDashboards = [];
  for (const dash of plan.dashboards) {
    const id = dashIds.get(dash.key);
    if (!id) throw new Error(`dashboard ${dash.key} missing after reconcile`);
    const fetched = await adapter.getDashboard(id);
    const tiles = Array.isArray(fetched?.tiles) ? fetched.tiles.filter((t) => t && t.deleted !== true).length : 0;
    const expectedInsights = plan.insights.filter((i) => i.dashboardKey === dash.key);
    const expected = expectedInsights.length;
    if (expected > 0 && tiles < expected) {
      throw new Error(`dashboard ${dash.key} has ${tiles}/${expected} tiles after reconcile`);
    }
    const layoutErrors = verifyDashboardTileLayouts(fetched, expectedInsights);
    if (layoutErrors.length > 0) {
      throw new Error(`dashboard ${dash.key} tile layout invalid: ${layoutErrors.join('; ')}`);
    }
    checkedDashboards.push({ key: dash.key, id, tiles, expected });
  }
  const executedQueries = await adapter.verifyQueries(plan, dashIds, insights, SAMPLE_QUERY_IDS);
  return { checkedDashboards, executedQueries };
}

function resolveKeyOption(options, cfg) {
  return options.personalApiKey !== undefined ? options.personalApiKey : cfg.personalApiKey;
}

function buildMcpSpawn(root, options, mock) {
  if (options.mcpMode === 'remote') {
    const cfg = loadPostHogEnv(root);
    const key = resolveKeyOption(options, cfg);
    return {
      command: 'npx',
      args: [
        '-y',
        'mcp-remote@latest',
        'https://mcp.posthog.com/mcp?features=dashboards,insights,product_analytics,sql,workspace,events',
        '--header',
        'Authorization:${POSTHOG_AUTH_HEADER}',
      ],
      env: key ? { POSTHOG_AUTH_HEADER: `Bearer ${key}` } : {},
    };
  }
  const serverPath = join(root, '.agents/skills/posthog-mcp-auditor/scripts/posthog-mcp-server.mjs');
  const env = mock
    ? { POSTHOG_API_BASE: mock.url, POSTHOG_PROJECT_ID: mock.projectId, POSTHOG_PERSONAL_API_KEY: mock.personalApiKey }
    : {
        ...(options.apiBase ? { POSTHOG_API_BASE: options.apiBase } : {}),
        ...(options.projectId !== undefined ? { POSTHOG_PROJECT_ID: String(options.projectId) } : {}),
        ...(options.personalApiKey !== undefined ? { POSTHOG_PERSONAL_API_KEY: options.personalApiKey } : {}),
      };
  return {
    command: process.execPath,
    args: [serverPath],
    env,
  };
}

async function executeLoopRounds(adapter, plan, apply, maxRounds) {
  const rounds = [];
  let verified = null;
  let finalDriftCount = 0;

  for (let round = 1; round <= maxRounds; round += 1) {
    const dashboards = await adapter.listDashboards();
    const insights = await adapter.listInsights(plan, dashboards);
    const diff = diffRemotePlan(plan, dashboards, insights);
    const driftCount = diff.missingDashboards.length
      + diff.driftedDashboards.length
      + diff.missingInsights.length
      + diff.driftedInsights.length;
    finalDriftCount = driftCount;

    if (apply && driftCount > 0) {
      await reconcileViaMcp(adapter, diff, plan);
      const afterDash = await adapter.listDashboards();
      const afterIns = await adapter.listInsights(plan, afterDash);
      const afterDiff = diffRemotePlan(plan, afterDash, afterIns);
      finalDriftCount = afterDiff.missingDashboards.length
        + afterDiff.driftedDashboards.length
        + afterDiff.missingInsights.length
        + afterDiff.driftedInsights.length;
      verified = await doubleCheckViaMcp(adapter, plan, afterDiff.dashIds, afterIns);
      rounds.push({ round, driftBefore: driftCount, driftAfter: finalDriftCount, reconciled: true, verified });
    } else {
      verified = driftCount === 0 ? await doubleCheckViaMcp(adapter, plan, diff.dashIds, insights) : null;
      rounds.push({ round, driftBefore: driftCount, driftAfter: driftCount, reconciled: false, verified });
    }

    if (finalDriftCount === 0 && verified) break;
  }
  return { rounds, verified, finalDriftCount };
}

export async function runGraphLoop(options = {}) {
  const root = options.root ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
  const maxRounds = Math.max(1, Number(options.maxRounds ?? 2));
  const cfg = loadPostHogEnv(root);
  const scan = await scanUiGraph(root);
  const plan = await compilePostHogPlan(root);
  const graphErrors = checkGraphStarterCoverage(scan, plan);
  if (graphErrors.length > 0) {
    return { ok: false, stage: 'graph', errors: graphErrors, coverage: scan.coverage };
  }

  const mock = options.mock ? await startMockPostHogServer({ projectId: cfg.projectId ?? '364100' }) : null;
  const apply = Boolean(options.apply || options.mock);
  const verify = Boolean(options.verify || options.mock);
  const resolvedKey = resolveKeyOption(options, cfg);
  const hasLiveKey = Boolean(mock || resolvedKey);

  if ((apply || verify || options.requireLive) && !hasLiveKey) {
    return {
      ok: false,
      mode: apply ? 'apply' : verify ? 'verify' : 'plan',
      blockedReason: 'missing_personal_api_key',
      detail: 'Add personal_api_key=phx_... to infra/.env.posthog (or pass --mock for local MCP verification).',
      mcpTools: [],
      coverage: scan.coverage,
    };
  }

  const spawnSpec = buildMcpSpawn(root, options, mock);
  const mcp = await connectMcp(spawnSpec);
  try {
    await mcp.initialize();
    const rawTools = (await mcp.listTools()).map((t) => t.name);
    const adapter = createMcpAdapter(mcp, rawTools, mock ? mock.projectId : (options.projectId ?? cfg.projectId));
    const { tools, missing } = await adapter.init();
    if (missing.length > 0) {
      return { ok: false, stage: 'mcp-tools', errors: [`missing MCP tools: ${missing.join(', ')}`] };
    }

    if (!apply && !verify) {
      return {
        ok: !options.requireLive || hasLiveKey,
        mode: 'plan',
        mcpAdapter: adapter.mode,
        hasLiveKey,
        mcpTools: tools,
        coverage: scan.coverage,
        dashboardsPlanned: plan.dashboards.length,
        insightsPlanned: plan.insights.length,
        rounds: [],
        ...(options.requireLive && !hasLiveKey ? { blockedReason: 'missing_personal_api_key' } : {}),
      };
    }

    if (!hasLiveKey) {
      return {
        ok: false,
        mode: apply ? 'apply' : 'verify',
        blockedReason: 'missing_personal_api_key',
        detail: 'Add personal_api_key=phx_... to infra/.env.posthog (or pass --mock for local MCP verification).',
        mcpTools: tools,
        coverage: scan.coverage,
      };
    }

    const { rounds, verified, finalDriftCount } = await executeLoopRounds(adapter, plan, apply, maxRounds);
    return {
      ok: finalDriftCount === 0 && Boolean(verified),
      mode: options.mock ? 'mock' : apply ? 'apply' : 'verify',
      mcpAdapter: adapter.mode,
      mcpTools: tools,
      coverage: scan.coverage,
      dashboardsPlanned: plan.dashboards.length,
      insightsPlanned: plan.insights.length,
      rounds,
      verified,
    };
  } finally {
    await mcp.close();
    if (mock) await mock.close();
  }
}

function invokedDirectly() {
  const entry = process.argv[1];
  return Boolean(entry) && fileURLToPath(import.meta.url) === resolve(entry);
}

if (invokedDirectly()) {
  const args = process.argv.slice(2);
  const opt = (flag, d) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : d; };
  const result = await runGraphLoop({
    mock: args.includes('--mock'),
    apply: args.includes('--apply'),
    verify: args.includes('--verify'),
    requireLive: args.includes('--require-live'),
    mcpMode: opt('--mcp-mode', 'local'),
    maxRounds: Number(opt('--max-rounds', 2)),
  });
  if (args.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else if (!result.ok) {
    console.error(`graph-loop failed (${result.blockedReason ?? result.stage ?? 'drift'}):`, result.detail ?? result.errors?.join('; ') ?? 'unconverged');
    process.exit(1);
  } else {
    const rCount = result.rounds?.length ?? 0;
    console.log(`graph-loop (${result.mode}) ok: ${result.dashboardsPlanned} dashboards, ${result.insightsPlanned} insights, ${rCount} MCP round(s), ${result.coverage.trackedUiActions} UI actions`);
  }
}
