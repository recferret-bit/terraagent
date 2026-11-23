// Shared PostHog API pagination, marker matching, and canonical query drift helpers.

export function extractList(payload) {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.results)
      ? payload.results
      : [];
  return list.filter((item) => item && item.deleted !== true);
}

export function resolveNextPath(nextUrl, apiBase, projectId) {
  if (typeof nextUrl !== 'string' || !nextUrl.trim()) return null;
  try {
    const base = new URL(apiBase);
    const parsed = new URL(nextUrl, base);
    if (parsed.origin !== base.origin) return null;
    const pathAndQuery = `${parsed.pathname}${parsed.search}`;
    const projPrefix = `/api/projects/${projectId}`;
    if (pathAndQuery.startsWith(projPrefix)) return pathAndQuery.slice(projPrefix.length) || '/';
    const envMatch = /^\/api\/environments\/\d+(\/.*)$/.exec(pathAndQuery);
    if (envMatch) return envMatch[1];
    return pathAndQuery;
  } catch {
    return null;
  }
}

export function getInsightDashboardIds(insight) {
  if (Array.isArray(insight?.dashboards) && insight.dashboards.length > 0) {
    return insight.dashboards;
  }
  if (Array.isArray(insight?.dashboard_tiles)) {
    return insight.dashboard_tiles
      .filter((t) => t && t.deleted !== true && typeof t.dashboard_id === 'number')
      .map((t) => t.dashboard_id);
  }
  return [];
}

export function findByMarker(items, prefix, key, name) {
  const marker = `[${prefix}:${key}]`;
  const active = extractList(items);
  return active.find((item) => typeof item.description === 'string' && item.description.includes(marker))
    ?? active.find((item) => item.name === name);
}

function queryMatchesSubset(actual, expected) {
  if (expected === undefined || expected === null) return true;
  if (typeof expected !== 'object') return actual === expected;
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return false;
    return expected.every((item, i) => queryMatchesSubset(actual[i], item));
  }
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false;
  for (const [k, v] of Object.entries(expected)) {
    if (v === undefined) continue;
    if (!queryMatchesSubset(actual[k], v)) return false;
  }
  return true;
}

export function queriesMatch(existingQuery, plannedQuery) {
  if (!existingQuery || typeof existingQuery !== 'object') return false;
  if (!queryMatchesSubset(existingQuery, plannedQuery)) return false;
  const actualSrc = existingQuery.source ?? {};
  const plannedSrc = plannedQuery.source ?? {};
  const actualExcl = actualSrc.funnelsFilter?.exclusions;
  const plannedExcl = plannedSrc.funnelsFilter?.exclusions;
  if (!plannedExcl && Array.isArray(actualExcl) && actualExcl.length > 0) return false;
  if (!plannedSrc.funnelsFilter?.breakdownAttributionType && actualSrc.funnelsFilter?.breakdownAttributionType) return false;
  const actualProps = actualSrc.properties;
  const plannedProps = plannedSrc.properties;
  if (!plannedProps && Array.isArray(actualProps) && actualProps.length > 0) return false;
  const actualBreakdown = actualSrc.breakdownFilter?.breakdown;
  const plannedBreakdown = plannedSrc.breakdownFilter?.breakdown;
  if (!plannedBreakdown && actualBreakdown) return false;
  if (Array.isArray(plannedSrc.series) && Array.isArray(actualSrc.series)) {
    for (let i = 0; i < plannedSrc.series.length; i += 1) {
      if (!plannedSrc.series[i]?.properties && Array.isArray(actualSrc.series[i]?.properties) && actualSrc.series[i].properties.length > 0) {
        return false;
      }
    }
  }
  return true;
}

export function diffRemotePlan(plan, rawDashboards, rawInsights) {
  const dashboards = extractList(rawDashboards);
  const insights = extractList(rawInsights);
  const dashIds = new Map();
  const missingDashboards = [];
  const driftedDashboards = [];

  for (const dash of plan.dashboards) {
    const match = findByMarker(dashboards, 'ta-dashboard', dash.key, dash.name);
    if (!match) {
      missingDashboards.push(dash);
      continue;
    }
    dashIds.set(dash.key, match.id);
    if (match.name !== dash.name || match.description !== dash.description) {
      driftedDashboards.push({ spec: dash, existing: match });
    }
  }

  const missingInsights = [];
  const driftedInsights = [];
  for (const ins of plan.insights) {
    const match = findByMarker(insights, 'ta-id', ins.id, ins.name);
    const dashId = dashIds.get(ins.dashboardKey);
    if (!match) {
      missingInsights.push(ins);
      continue;
    }
    const existingDashIds = getInsightDashboardIds(match);
    const linked = !dashId || existingDashIds.includes(dashId);
    const sameName = match.name === ins.name;
    const sameDesc = match.description === ins.description;
    const sameQuery = queriesMatch(match.query, ins.query);
    if (!linked || !sameName || !sameDesc || !sameQuery) {
      driftedInsights.push({ spec: ins, existing: match });
    }
  }

  return { dashIds, missingDashboards, driftedDashboards, missingInsights, driftedInsights };
}

function tileSizeForInsight(spec) {
  if (!spec) return { w: 6, h: 5 };
  const display = spec.query?.source?.trendsFilter?.display;
  if (display === 'WorldMap' || spec.kind === 'retention') return { w: 12, h: 6 };
  if (spec.kind === 'funnel' && (spec.query?.source?.series?.length ?? 0) >= 4) return { w: 12, h: 5 };
  return { w: 6, h: 5 };
}

export function computeTileLayouts(fetchedDashboard, planInsightsForDash = []) {
  const activeTiles = (fetchedDashboard?.tiles ?? []).filter((t) => t && t.deleted !== true && t.insight);
  if (activeTiles.length === 0) return [];
  const orderByMarker = new Map();
  planInsightsForDash.forEach((spec, index) => orderByMarker.set(spec.id, { spec, index }));

  const sorted = [...activeTiles].sort((a, b) => {
    const descA = a.insight?.description ?? '';
    const descB = b.insight?.description ?? '';
    const mA = /\[ta-id:([^\]]+)\]/.exec(descA)?.[1];
    const mB = /\[ta-id:([^\]]+)\]/.exec(descB)?.[1];
    const idxA = mA && orderByMarker.has(mA) ? orderByMarker.get(mA).index : 9999;
    const idxB = mB && orderByMarker.has(mB) ? orderByMarker.get(mB).index : 9999;
    return idxA - idxB;
  });

  let x = 0;
  let y = 0;
  let rowH = 0;
  const updates = [];
  for (const tile of sorted) {
    const marker = /\[ta-id:([^\]]+)\]/.exec(tile.insight?.description ?? '')?.[1];
    const spec = marker ? orderByMarker.get(marker)?.spec : planInsightsForDash.find((s) => s.name === tile.insight?.name);
    const { w, h } = tileSizeForInsight(spec);
    if (x + w > 12) {
      x = 0;
      y += rowH;
      rowH = 0;
    }
    updates.push({
      id: tile.id,
      layouts: { sm: { x, y, w, h } },
    });
    x += w;
    rowH = Math.max(rowH, h);
    if (x >= 12) {
      x = 0;
      y += rowH;
      rowH = 0;
    }
  }
  return updates;
}

export function verifyDashboardTileLayouts(fetchedDashboard, expectedSpecs = []) {
  const errors = [];
  const activeTiles = (fetchedDashboard?.tiles ?? []).filter((t) => t && t.deleted !== true && t.insight);
  const seenIds = new Set();
  for (const tile of activeTiles) {
    const marker = /\[ta-id:([^\]]+)\]/.exec(tile.insight?.description ?? '')?.[1];
    if (marker) seenIds.add(marker);
    else if (tile.insight?.name) {
      const byName = expectedSpecs.find((s) => s.name === tile.insight.name);
      if (byName) seenIds.add(byName.id);
    }
  }
  for (const spec of expectedSpecs) {
    if (!seenIds.has(spec.id)) errors.push(`missing tile on dashboard: ${spec.id}`);
  }
  const boxes = [];
  for (const tile of activeTiles) {
    const box = tile.layouts?.sm;
    if (!box || !Number.isFinite(box.x) || !Number.isFinite(box.y) || !Number.isFinite(box.w) || !Number.isFinite(box.h)) {
      errors.push(`tile ${tile.id} missing layouts.sm box`);
      continue;
    }
    if (box.x < 0 || box.y < 0 || box.w < 1 || box.h < 1 || box.x + box.w > 12) {
      errors.push(`tile ${tile.id} has out-of-bounds layouts.sm: ${JSON.stringify(box)}`);
      continue;
    }
    for (const prev of boxes) {
      const overlaps = box.x < prev.x + prev.w && box.x + box.w > prev.x && box.y < prev.y + prev.h && box.y + box.h > prev.y;
      if (overlaps) errors.push(`tile ${tile.id} overlaps tile ${prev.id}`);
    }
    boxes.push({ id: tile.id, ...box });
  }
  return errors;
}
