import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scanUiGraph } from '../../posthog-surface-scanner/scripts/scan-ui-graph.mjs';

export const DASHBOARD_DEFS = [
  {
    key: 'exec',
    name: 'TerraAgent · Executive, Views & Countries',
    description: '[ta-dashboard:exec] Starter overview: cookieless visitors (DAU/WAU), pageviews by surface, GeoIP countries, traffic/UTM sources, D1-D7 retention, and landing/content conversions.',
    tags: ['terraagent', 'exec'],
  },
  {
    key: 'gameplay',
    name: 'TerraAgent · Gameplay, Planets & In-Game Buttons',
    description: '[ta-dashboard:gameplay] Planet drop funnel, colony HUD tabs (Build/Units/Terraform/Queue/HQ/Trade/Deed), building & unit button clicks, first commands, and colony retention.',
    tags: ['terraagent', 'gameplay'],
  },
  {
    key: 'economy',
    name: 'TerraAgent · Trading, Web3 & Profile',
    description: '[ta-dashboard:economy] Exchange ticket-to-fill funnel, in-game market funnel, sign-in methods, NEAR wallet kinds, and pilot profile / staking section engagement.',
    tags: ['terraagent', 'economy'],
  },
  {
    key: 'health',
    name: 'TerraAgent · Errors & Broken Steps',
    description: '[ta-dashboard:health] Auth, boot, colony-enter, trade, and profile failure funnels with exclusions and closed reasons, plus client and gameplay errors.',
    tags: ['terraagent', 'health'],
  },
];

function toPropertyFilters(where = []) {
  return where.map((clause) => ({
    key: clause.key,
    type: 'event',
    value: [clause.value],
    operator: 'exact',
  }));
}

function toBreakdownFilter(breakdown) {
  if (!breakdown) return undefined;
  return { breakdown, breakdown_type: 'event' };
}

export function compileFunnelInsight(spec, eventProps = new Map()) {
  const series = spec.steps.map((step) => ({
    kind: 'EventsNode',
    event: step.event,
    name: step.event,
    ...(step.where?.length ? { properties: toPropertyFilters(step.where) } : {}),
  }));
  const exclusions = spec.exclusion
    ? [{
        kind: 'EventsNode',
        event: spec.exclusion,
        name: spec.exclusion,
        funnelFromStep: 0,
        funnelToStep: Math.max(1, series.length - 1),
      }]
    : undefined;
  const attribution = resolveFunnelBreakdownAttribution(spec, eventProps);
  return {
    id: spec.id,
    kind: 'funnel',
    dashboardKey: spec.dashboard ?? 'exec',
    name: spec.title,
    description: `[ta-id:${spec.id}] Conversion funnel (${spec.window.interval} ${spec.window.unit})`,
    tags: ['terraagent', spec.dashboard ?? 'exec', 'funnel'],
    pin: spec.pin !== false,
    query: {
      kind: 'InsightVizNode',
      source: {
        kind: 'FunnelsQuery',
        series,
        dateRange: { date_from: '-30d' },
        funnelsFilter: {
          funnelOrderType: 'ordered',
          funnelVizType: 'steps',
          funnelWindowInterval: spec.window.interval,
          funnelWindowIntervalUnit: spec.window.unit,
          ...attribution,
          ...(exclusions ? { exclusions } : {}),
        },
        ...(spec.breakdown ? { breakdownFilter: toBreakdownFilter(spec.breakdown) } : {}),
      },
    },
  };
}

function resolveFunnelBreakdownAttribution(spec, eventProps) {
  if (!spec.breakdown || spec.breakdown.startsWith('$')) return {};
  const idx = spec.steps.findIndex((s) => eventProps.get(s.event)?.has(spec.breakdown));
  if (idx > 0) return { breakdownAttributionType: 'step', breakdownAttributionValue: idx };
  if (idx === 0) return { breakdownAttributionType: 'first_touch' };
  return {};
}

const POSTHOG_MATH = {
  wau: 'weekly_active',
};

export function compileTrendInsight(spec) {
  return {
    id: spec.id,
    kind: 'trend',
    dashboardKey: spec.dashboard ?? 'exec',
    name: spec.title,
    description: `[ta-id:${spec.id}] ${spec.math.toUpperCase()} trend on ${spec.event}`,
    tags: ['terraagent', spec.dashboard ?? 'exec', 'trend'],
    pin: spec.pin !== false,
    query: {
      kind: 'InsightVizNode',
      source: {
        kind: 'TrendsQuery',
        series: [{
          kind: 'EventsNode',
          event: spec.event,
          name: spec.event,
          math: POSTHOG_MATH[spec.math] ?? spec.math,
          ...(spec.where?.length ? { properties: toPropertyFilters(spec.where) } : {}),
        }],
        interval: 'day',
        dateRange: { date_from: '-30d' },
        trendsFilter: { display: spec.display ?? 'ActionsLineGraph' },
        ...(spec.breakdown ? { breakdownFilter: toBreakdownFilter(spec.breakdown) } : {}),
      },
    },
  };
}

export function compileRetentionInsight(spec) {
  return {
    id: spec.id,
    kind: 'retention',
    dashboardKey: spec.dashboard ?? 'exec',
    name: spec.title,
    description: `[ta-id:${spec.id}] ${spec.period} retention (${spec.targetEvent} -> ${spec.returningEvent})`,
    tags: ['terraagent', spec.dashboard ?? 'exec', 'retention'],
    pin: spec.pin !== false,
    query: {
      kind: 'InsightVizNode',
      source: {
        kind: 'RetentionQuery',
        dateRange: { date_from: '-30d' },
        ...(spec.where?.length ? { properties: toPropertyFilters(spec.where) } : {}),
        retentionFilter: {
          period: spec.period,
          totalIntervals: spec.totalIntervals ?? 8,
          retentionType: 'retention_first_time',
          targetEntity: { id: spec.targetEvent, name: spec.targetEvent, type: 'events' },
          returningEntity: { id: spec.returningEvent, name: spec.returningEvent, type: 'events' },
        },
      },
    },
  };
}

export async function compilePostHogPlan(root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')) {
  const catalogMod = await import(pathToFileURL(join(root, 'shared/contracts/src/analytics/catalog.ts')).href);
  const funnelsMod = await import(pathToFileURL(join(root, 'shared/contracts/src/analytics/funnels.ts')).href);
  const scan = await scanUiGraph(root);
  const eventProps = new Map(
    catalogMod.ANALYTICS_EVENTS.map((ev) => [ev.name, new Set((ev.props ?? []).map((p) => p.key))]),
  );

  const compiled = [
    ...funnelsMod.ANALYTICS_FUNNELS.filter((f) => f.pin).map((f) => compileFunnelInsight(f, eventProps)),
    ...funnelsMod.ANALYTICS_TRENDS.filter((t) => t.pin).map(compileTrendInsight),
    ...(funnelsMod.ANALYTICS_RETENTION ?? []).filter((r) => r.pin).map(compileRetentionInsight),
    ...(scan.autoFunnels ?? []).filter((f) => f.pin).map((f) => compileFunnelInsight(f, eventProps)),
    ...scan.autoTrends.map(compileTrendInsight),
  ];

  const byId = new Map();
  for (const item of compiled) byId.set(item.id, item);

  return {
    dashboards: DASHBOARD_DEFS,
    insights: [...byId.values()],
    coverage: scan.coverage,
  };
}
