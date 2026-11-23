#!/usr/bin/env node
// Compiles TerraAgent analytics catalogs & UI graph into PostHog Dashboards/Insights and idempotently syncs them.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compilePostHogPlan } from './posthog-compiler.mjs';
import { computeTileLayouts, diffRemotePlan, findByMarker, getInsightDashboardIds, resolveNextPath } from './posthog-diff.mjs';
import { loadPostHogEnv, redactSecrets } from './posthog-env.mjs';

async function apiRequest(cfg, apiBase, path, init = {}) {
  const url = `${apiBase}/api/projects/${cfg.projectId}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${cfg.personalApiKey}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`PostHog ${init.method ?? 'GET'} ${path} failed (${res.status}): ${redactSecrets(text.slice(0, 240), cfg)}`);
  }
  return text ? JSON.parse(text) : {};
}

async function listAll(cfg, apiBase, resource) {
  const items = [];
  let nextPath = `/${resource}/?limit=200${resource === 'insights' ? '&include_dashboards=true' : ''}`;
  while (nextPath) {
    const page = await apiRequest(cfg, apiBase, nextPath);
    if (Array.isArray(page.results)) {
      items.push(...page.results.filter((item) => item && item.deleted !== true));
    }
    nextPath = resolveNextPath(page.next, apiBase, cfg.projectId);
  }
  return items;
}

export async function syncPostHogDashboards(options = {}) {
  const root = options.root ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
  const cfg = { ...loadPostHogEnv(root), ...(options.env ?? {}) };
  const apiBase = (options.apiBase ?? cfg.apiHost).replace(/\/+$/, '');
  const mode = options.apply ? 'apply' : options.verify ? 'verify' : 'dry-run';
  const plan = await compilePostHogPlan(root);

  if (mode === 'dry-run') {
    return {
      ok: true,
      mode,
      projectId: cfg.projectId ?? null,
      apiBase,
      hasPersonalKey: Boolean(cfg.personalApiKey),
      dashboardsPlanned: plan.dashboards.length,
      insightsPlanned: plan.insights.length,
      dashboards: plan.dashboards.map((d) => ({ key: d.key, name: d.name })),
      insights: plan.insights.map((i) => ({ id: i.id, kind: i.kind, dashboardKey: i.dashboardKey, name: i.name })),
    };
  }

  if (!cfg.projectId || !cfg.personalApiKey) {
    return {
      ok: false,
      mode,
      blockedReason: !cfg.projectId ? 'missing_project_id' : 'missing_personal_api_key',
      detail: 'PostHog Admin REST API requires project_id and personal_api_key (phx_...) in infra/.env.posthog or POSTHOG_PERSONAL_API_KEY.',
      dashboardsPlanned: plan.dashboards.length,
      insightsPlanned: plan.insights.length,
    };
  }

  const existingDashboards = await listAll(cfg, apiBase, 'dashboards');
  const existingInsights = await listAll(cfg, apiBase, 'insights');
  if (mode === 'verify') {
    const diff = diffRemotePlan(plan, existingDashboards, existingInsights);
    const missing = [
      ...diff.missingDashboards.map((d) => `dashboard:${d.key}`),
      ...diff.missingInsights.map((i) => `insight:${i.id}`),
    ];
    const drifted = [
      ...diff.driftedDashboards.map((d) => `dashboard:${d.spec.key}`),
      ...diff.driftedInsights.map((i) => `insight:${i.spec.id}`),
    ];
    return {
      ok: missing.length === 0 && drifted.length === 0,
      mode,
      projectId: cfg.projectId,
      apiBase,
      dashboardsPlanned: plan.dashboards.length,
      insightsPlanned: plan.insights.length,
      missing,
      drifted,
    };
  }

  const dashboardIds = new Map();
  const report = { createdDashboards: [], updatedDashboards: [], createdInsights: [], updatedInsights: [], missing: [], drifted: [] };

  for (const dash of plan.dashboards) {
    const match = findByMarker(existingDashboards, 'ta-dashboard', dash.key, dash.name);
    const payload = { name: dash.name, description: dash.description, pinned: true, tags: dash.tags };
    if (match) {
      const updated = await apiRequest(cfg, apiBase, `/dashboards/${match.id}/`, { method: 'PATCH', body: JSON.stringify(payload) });
      dashboardIds.set(dash.key, updated.id ?? match.id);
      report.updatedDashboards.push(dash.key);
    } else {
      const created = await apiRequest(cfg, apiBase, '/dashboards/', { method: 'POST', body: JSON.stringify(payload) });
      dashboardIds.set(dash.key, created.id);
      report.createdDashboards.push(dash.key);
    }
  }

  for (const ins of plan.insights) {
    const match = findByMarker(existingInsights, 'ta-id', ins.id, ins.name);
    const dashId = dashboardIds.get(ins.dashboardKey);
    const existingDashList = getInsightDashboardIds(match);
    const dashboards = dashId && !existingDashList.includes(dashId) ? [...existingDashList, dashId] : existingDashList;
    const payload = {
      name: ins.name,
      description: ins.description,
      tags: ins.tags,
      dashboards: dashboards.length ? dashboards : (dashId ? [dashId] : []),
      query: ins.query,
    };
    if (match) {
      await apiRequest(cfg, apiBase, `/insights/${match.id}/`, { method: 'PATCH', body: JSON.stringify(payload) });
      report.updatedInsights.push(ins.id);
    } else {
      await apiRequest(cfg, apiBase, '/insights/', { method: 'POST', body: JSON.stringify(payload) });
      report.createdInsights.push(ins.id);
    }
  }

  for (const dash of plan.dashboards) {
    const dashId = dashboardIds.get(dash.key);
    if (!dashId) continue;
    const fetchedDash = await apiRequest(cfg, apiBase, `/dashboards/${dashId}/`);
    const dashInsights = plan.insights.filter((i) => i.dashboardKey === dash.key);
    const tiles = computeTileLayouts(fetchedDash, dashInsights);
    if (tiles.length > 0) {
      await apiRequest(cfg, apiBase, `/dashboards/${dashId}/`, {
        method: 'PATCH',
        body: JSON.stringify({ tiles }),
      });
    }
  }

  return {
    ok: true,
    mode,
    projectId: cfg.projectId,
    apiBase,
    dashboardsPlanned: plan.dashboards.length,
    insightsPlanned: plan.insights.length,
    ...report,
  };
}

function invokedDirectly() {
  const entry = process.argv[1];
  return Boolean(entry) && fileURLToPath(import.meta.url) === resolve(entry);
}

if (invokedDirectly()) {
  const args = process.argv.slice(2);
  const opt = (flag) => { const idx = args.indexOf(flag); return idx >= 0 ? args[idx + 1] : undefined; };
  const result = await syncPostHogDashboards({
    apply: args.includes('--apply'),
    verify: args.includes('--verify'),
    apiBase: opt('--api-base'),
  });
  if (args.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else if (!result.ok) {
    console.error(`posthog sync (${result.mode}) failed:`, result.detail ?? result.missing?.join(', '));
    process.exit(1);
  } else {
    console.log(`posthog sync (${result.mode}) ok: ${result.dashboardsPlanned} dashboards, ${result.insightsPlanned} insights`);
  }
}
