import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../../../..');
const modUrl = (rel: string) => pathToFileURL(resolve(ROOT, rel)).href;

interface MockServer {
  url: string;
  projectId: string;
  personalApiKey: string;
  dashboards: Map<number, Record<string, unknown>>;
  insights: Map<number, Record<string, unknown>>;
  close(): Promise<void>;
}

describe('posthog superset skills & graph->loop MCP harness', () => {
  it('scans all public pages, HUD tabs, matchers, and game buttons into a complete UI graph', async () => {
    const { scanUiGraph } = await import(modUrl('.agents/skills/posthog-surface-scanner/scripts/scan-ui-graph.mjs'));
    const { validateUiMatchers } = await import(modUrl('.agents/skills/posthog-surface-scanner/scripts/scan-ui-matchers.mjs'));
    const scan = await scanUiGraph(ROOT);
    expect(scan.coverage.unbootedPages).toEqual([]);
    expect(scan.coverage.deadMatchers).toEqual([]);
    expect(scan.coverage.matcherCount).toBeGreaterThanOrEqual(100);
    expect(scan.coverage.publicHtmlPages).toBeGreaterThanOrEqual(14);
    expect(scan.coverage.hudDockTabs).toBeGreaterThanOrEqual(4);
    expect(scan.coverage.hudColonyTabs).toBeGreaterThanOrEqual(10);
    expect(scan.controls.buildingButtons).toContain('commandHub');
    expect(scan.controls.unitButtons).toContain('worker');
    expect(scan.controls.terraformOps).toEqual(expect.arrayContaining(['terraform', 'cultivate', 'repair', 'dismantle']));
    expect(scan.autoFunnels.map((f: { id: string }) => f.id)).toEqual(
      expect.arrayContaining(['auto-funnel-build-button', 'auto-funnel-units-button', 'auto-funnel-terraform-button']),
    );
    expect(scan.graph.nodes.some((n: { id: string }) => n.id === 'surface:whitepaper')).toBe(true);
    expect(scan.graph.nodes.some((n: { id: string }) => n.id === 'surface:design')).toBe(true);
    expect(scan.surfaces.bootedSurfaces['nf-heading']).toBeUndefined();
    expect(scan.controls.meTabs).toContain('staking');

    const tmp = mkdtempSync(join(tmpdir(), 'ta-ui-matcher-'));
    try {
      mkdirSync(join(tmp, 'frontend/design/analytics'), { recursive: true });
      writeFileSync(
        join(tmp, 'frontend/App.ts'),
        'const el = { testid: "trade-hub-panel" };',
      );
      writeFileSync(
        join(tmp, 'frontend/design/analytics/uiRules.ts'),
        [
          "export const TESTID_MATCHERS = { 'fake-dead-testid': { area: 'cta', action: 'noop' }, 'trade-hub': { area: 'market', action: 'noop' } };",
          "export function classifyByTestIdPrefix(testid: string) { if (testid.startsWith('trade-hub-quick-')) return { area: 'market', action: 'q' }; return null; }",
          "export function classifyByDataAttr(el: HTMLElement) { return el.closest('[data-testid=\"trade-hub\"]') ? { area: 'market', action: 'r' } : null; }",
        ].join('\n'),
      );
      const check = validateUiMatchers(tmp);
      expect(check.deadMatchers).toEqual(expect.arrayContaining([
        'TESTID_MATCHERS:fake-dead-testid',
        'TESTID_MATCHERS:trade-hub',
        'PREFIX_MATCHERS:trade-hub-quick-',
        'CLOSEST_TESTID:trade-hub',
      ]));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('posthog compilation, REST sync, and Graph->Loop MCP', () => {
  it('compiles starter dashboards and idempotently creates, updates, and verifies via REST + Graph->Loop MCP', async () => {
    const { compilePostHogPlan } = await import(modUrl('.agents/skills/posthog-dashboard-sync/scripts/posthog-compiler.mjs'));
    const { syncPostHogDashboards } = await import(modUrl('.agents/skills/posthog-dashboard-sync/scripts/sync-dashboards.mjs'));
    const { startMockPostHogServer } = await import(modUrl('.agents/skills/posthog-mcp-auditor/scripts/mock-posthog-server.mjs'));
    const { runGraphLoop } = await import(modUrl('.agents/skills/posthog-mcp-auditor/scripts/graph-loop.mjs'));

    const plan = await compilePostHogPlan(ROOT);
    expect(plan.dashboards.map((d: { key: string }) => d.key)).toEqual(['exec', 'gameplay', 'economy', 'health']);
    expect(plan.insights.some((i: { id: string }) => i.id === 'visitors-by-country')).toBe(true);
    expect(plan.insights.some((i: { id: string }) => i.id === 'country-world-map')).toBe(true);
    expect(plan.insights.some((i: { id: string }) => i.id === 'visitor-retention')).toBe(true);
    expect(plan.insights.some((i: { id: string }) => i.id === 'auto-funnel-build-button')).toBe(true);

    const wau = plan.insights.find((i: { id: string }) => i.id === 'visitors-wau');
    expect(wau?.query.source.series[0]?.math).toBe('weekly_active');
    const acqFail = plan.insights.find((i: { id: string }) => i.id === 'acquisition-fail');
    expect(acqFail?.query.source.funnelsFilter.breakdownAttributionType).toBe('step');
    expect(acqFail?.query.source.funnelsFilter.breakdownAttributionValue).toBe(1);
    const acq = plan.insights.find((i: { id: string }) => i.id === 'acquisition');
    expect(acq?.query.source.funnelsFilter.breakdownAttributionType).toBe('step');
    expect(acq?.query.source.funnelsFilter.breakdownAttributionValue).toBe(1);

    const mock: MockServer = await startMockPostHogServer({ projectId: '364100', personalApiKey: 'phx_mock_unit' });
    try {
      const env = { projectId: mock.projectId, personalApiKey: mock.personalApiKey };
      const first = await syncPostHogDashboards({ root: ROOT, apply: true, apiBase: mock.url, env });
      expect(first.ok).toBe(true);
      expect(first.createdDashboards).toHaveLength(4);
      expect(first.createdInsights.length).toBe(plan.insights.length);

      const second = await syncPostHogDashboards({ root: ROOT, apply: true, apiBase: mock.url, env });
      expect(second.ok).toBe(true);
      expect(second.createdDashboards).toEqual([]);
      expect(second.createdInsights).toEqual([]);
      expect(second.updatedDashboards).toHaveLength(4);

      const verified = await syncPostHogDashboards({ root: ROOT, verify: true, apiBase: mock.url, env });
      expect(verified.ok).toBe(true);
      expect(verified.missing).toEqual([]);
      expect(verified.drifted).toEqual([]);

      // Simulate silent query drift while keeping the same source.kind: verify + Graph->Loop must catch and heal it
      const firstInsight = [...mock.insights.values()][0] as { id: number; name: string; query: { source: Record<string, unknown> } };
      firstInsight.query.source.series = [];
      const firstDash = [...mock.dashboards.values()][0] as { id: number; name: string };
      firstDash.name = 'Drifted Dashboard Title';

      const driftedVerify = await syncPostHogDashboards({ root: ROOT, verify: true, apiBase: mock.url, env });
      expect(driftedVerify.ok).toBe(false);
      expect(driftedVerify.drifted.length).toBeGreaterThanOrEqual(2);

      const healed = await runGraphLoop({
        root: ROOT,
        apply: true,
        verify: true,
        apiBase: mock.url,
        projectId: env.projectId,
        personalApiKey: env.personalApiKey,
        maxRounds: 2,
      });
      expect(healed.ok).toBe(true);
      expect(healed.rounds[0].driftBefore).toBeGreaterThanOrEqual(2);
      expect(healed.rounds[0].driftAfter).toBe(0);
    } finally {
      await mock.close();
    }

    const loopResult = await runGraphLoop({ root: ROOT, mock: true, maxRounds: 2 });
    expect(loopResult.ok).toBe(true);
    expect(loopResult.rounds).toHaveLength(1);
    expect(loopResult.rounds[0].driftBefore).toBeGreaterThan(0);
    expect(loopResult.rounds[0].driftAfter).toBe(0);
    expect(loopResult.verified.executedQueries).toEqual([
      'visitors-wau',
      'visitors-by-country',
      'country-world-map',
      'acquisition',
      'acquisition-fail',
      'auto-funnel-build-button',
      'ui-actions-top',
      'visitor-retention',
    ]);
  }, 20_000);
});

describe('posthog API diff, fail-closed checks, and deploy readiness', () => {

  it('normalizes PostHog REST pagination envelopes, detects removed exclusions and stale step filters, and filters deleted items', async () => {
    const { extractList, queriesMatch, resolveNextPath, verifyDashboardTileLayouts } = await import(modUrl('.agents/skills/posthog-dashboard-sync/scripts/posthog-diff.mjs'));
    expect(extractList({ results: [{ id: 1 }, { id: 2, deleted: true }] })).toEqual([{ id: 1 }]);
    expect(resolveNextPath('https://eu.posthog.com/api/environments/364167/insights/?offset=200', 'https://eu.posthog.com', '364167')).toBe('/insights/?offset=200');
    expect(resolveNextPath('https://evil.example/api/projects/364167/insights/', 'https://eu.posthog.com', '364167')).toBeNull();
    expect(queriesMatch(
      { kind: 'InsightVizNode', source: { kind: 'FunnelsQuery', series: [], funnelsFilter: { exclusions: [{ event: 'x' }] } } },
      { kind: 'InsightVizNode', source: { kind: 'FunnelsQuery', series: [], funnelsFilter: {} } },
    )).toBe(false);
    expect(queriesMatch(
      { kind: 'InsightVizNode', source: { kind: 'FunnelsQuery', series: [{ event: 'a', properties: [{ key: 'k' }] }], funnelsFilter: {} } },
      { kind: 'InsightVizNode', source: { kind: 'FunnelsQuery', series: [{ event: 'a' }], funnelsFilter: {} } },
    )).toBe(false);
    expect(verifyDashboardTileLayouts({
      tiles: [
        { id: 1, insight: { description: '[ta-id:a]' }, layouts: { sm: { x: 0, y: 0, w: 6, h: 5 } } },
        { id: 2, insight: { description: '[ta-id:b]' }, layouts: { sm: { x: 4, y: 0, w: 6, h: 5 } } },
      ],
    }, [{ id: 'a' }, { id: 'b' }, { id: 'c' }])).toEqual([
      'missing tile on dashboard: c',
      'tile 2 overlaps tile 1',
    ]);
  });

  it('fails closed without personal key, redacts secrets, and passes deploy readiness check', async () => {
    const { syncPostHogDashboards } = await import(modUrl('.agents/skills/posthog-dashboard-sync/scripts/sync-dashboards.mjs'));
    const { runGraphLoop } = await import(modUrl('.agents/skills/posthog-mcp-auditor/scripts/graph-loop.mjs'));
    const { redactSecrets } = await import(modUrl('.agents/skills/posthog-dashboard-sync/scripts/posthog-env.mjs'));
    const { checkDeployReadiness } = await import(modUrl('.agents/skills/posthog-dashboard-sync/scripts/deploy-check.mjs'));

    const missingKey = await syncPostHogDashboards({ root: ROOT, apply: true, env: { personalApiKey: '' } });
    expect(missingKey.ok).toBe(false);
    expect(missingKey.blockedReason).toBe('missing_personal_api_key');

    const missingLoopKey = await runGraphLoop({ root: ROOT, verify: true, personalApiKey: '', mcpMode: 'remote' });
    expect(missingLoopKey.ok).toBe(false);
    expect(missingLoopKey.blockedReason).toBe('missing_personal_api_key');

    const tokenSample = `${'phx'}_secret999`;
    const projSample = `${'phc'}_proj999`;
    expect(redactSecrets(`err ${tokenSample} and ${projSample}`)).toBe('err [redacted] and [redacted]');

    const deploy = checkDeployReadiness(ROOT);
    expect(deploy.ok, deploy.failures.join('; ')).toBe(true);
    expect(deploy.failures).toEqual([]);
  });
});

describe('posthog env aliases and tile grid layout', () => {
  it('loads project_api_key aliases and lays out non-overlapping 12-col tiles', async () => {
    const { loadPostHogEnv } = await import(modUrl('.agents/skills/posthog-dashboard-sync/scripts/posthog-env.mjs'));
    const { computeTileLayouts, getInsightDashboardIds, queriesMatch } = await import(modUrl('.agents/skills/posthog-dashboard-sync/scripts/posthog-diff.mjs'));

    const tmp = mkdtempSync(join(tmpdir(), 'ta-ph-env-'));
    try {
      mkdirSync(join(tmp, 'infra'), { recursive: true });
      writeFileSync(join(tmp, 'infra/.env.posthog'), `project_token=${'phc'}_abc123\nproject_api_key=${'phx'}_xyz789\nproject_id=364167\nregion=eu\n`);
      const loaded = loadPostHogEnv(tmp, {});
      expect(loaded.projectToken).toBe(`${'phc'}_abc123`);
      expect(loaded.personalApiKey).toBe(`${'phx'}_xyz789`);

      writeFileSync(join(tmp, 'infra/.env.posthog'), `project_api_key=${'phc'}_onlytoken\nproject_id=12\n`);
      const onlyToken = loadPostHogEnv(tmp, {});
      expect(onlyToken.projectToken).toBe(`${'phc'}_onlytoken`);
      expect(onlyToken.personalApiKey).toBeUndefined();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }

    expect(getInsightDashboardIds({ dashboard_tiles: [{ id: 1, dashboard_id: 99 }, { id: 2, dashboard_id: 88, deleted: true }] })).toEqual([99]);
    expect(queriesMatch(
      { kind: 'InsightVizNode', source: { kind: 'TrendsQuery', breakdownFilter: { breakdown: 'surface', breakdown_type: 'event' } } },
      { kind: 'InsightVizNode', source: { kind: 'TrendsQuery' } },
    )).toBe(false);

    const tiles = computeTileLayouts({
      tiles: [
        { id: 10, insight: { description: '[ta-id:a]' } },
        { id: 11, insight: { description: '[ta-id:b]' } },
        { id: 12, insight: { description: '[ta-id:c]' } },
      ],
    }, [
      { id: 'a', kind: 'trend', query: { source: { trendsFilter: { display: 'ActionsLineGraph' } } } },
      { id: 'b', kind: 'trend', query: { source: { trendsFilter: { display: 'WorldMap' } } } },
      { id: 'c', kind: 'funnel', query: { source: { series: [1, 2] } } },
    ]);
    expect(tiles).toEqual([
      { id: 10, layouts: { sm: { x: 0, y: 0, w: 6, h: 5 } } },
      { id: 11, layouts: { sm: { x: 0, y: 5, w: 12, h: 6 } } },
      { id: 12, layouts: { sm: { x: 0, y: 11, w: 6, h: 5 } } },
    ]);
  });
});

describe('remote exec MCP adapter and wizard hygiene', () => {
  it('adapts remote PostHog exec MCP and guards wizard/workspace MCP config safety', async () => {
    const { createMcpAdapter, unwrapExecPayload } = await import(modUrl('.agents/skills/posthog-mcp-auditor/scripts/mcp-adapter.mjs'));
    const { buildWizardArgs, buildWizardEnv, formatWizardCommand } = await import(modUrl('.agents/skills/posthog-mcp-auditor/scripts/launch-remote-mcp.mjs'));
    const { checkWorkspaceMcpSafety } = await import(modUrl('.agents/skills/posthog-dashboard-sync/scripts/deploy-check.mjs'));

    expect(unwrapExecPayload({ content: '<dashboard-reference>\n{"id":7,"tiles":[]}\n</dashboard-reference>' })).toEqual({ id: 7, tiles: [] });

    const seenCommands: string[] = [];
    const fakeMcp = {
      async callTool(_name: string, args: { command: string }) {
        seenCommands.push(args.command);
        if (args.command === 'tools') {
          return ['switch-project', 'dashboards-get-all', 'dashboard-get', 'dashboard-create', 'dashboard-update', 'insights-list', 'insight-get', 'insight-create', 'insight-update', 'insight-query', 'dashboard-insights-run'];
        }
        if (args.command.includes('switch-project')) return { content: [{ type: 'text', text: 'Switched' }] };
        if (args.command.includes('dashboards-get-all')) return { results: [{ id: 101, name: 'D1', description: '[ta-dashboard:exec]' }], next: null };
        if (args.command.includes('insights-list')) return { results: [{ id: 201, name: 'I1', description: '[ta-id:visitors-by-country]', dashboards: [101] }], next: null };
        if (args.command.includes('dashboard-get')) return { content: '<dashboard-reference>\n{"id":101,"tiles":[{"id":9,"insight":{"id":201,"query":{"kind":"InsightVizNode"}}}]}\n</dashboard-reference>' };
        if (args.command.includes('dashboard-insights-run')) return { results: [{ id: 9, insight: { id: 201, name: 'I1', result: [] } }] };
        if (args.command.includes('insight-query')) return { results: [] };
        return {};
      },
    };
    const adapter = createMcpAdapter(fakeMcp, ['exec'], '364167');
    expect((await adapter.init()).missing).toEqual([]);
    const dashes = await adapter.listDashboards();
    const ins = await adapter.listInsights({ dashboards: [{ key: 'exec', name: 'D1' }], insights: [{ id: 'visitors-by-country', name: 'I1' }] }, dashes);
    expect(ins[0].query).toEqual({ kind: 'InsightVizNode' });
    expect(await adapter.verifyQueries({ dashboards: [{ key: 'exec', name: 'D1' }], insights: [{ id: 'visitors-by-country', name: 'I1' }] }, new Map([['exec', 101]]), ins, ['visitors-by-country'])).toEqual(['visitors-by-country']);
    expect(seenCommands.some((c) => c.includes('switch-project') && c.includes('364167'))).toBe(true);
    expect(seenCommands.some((c) => c.includes('dashboard-insights-run') && c.includes('"dashboard_tile_ids":[9]'))).toBe(true);

    expect(buildWizardArgs({ projectId: '364167', personalApiKey: `${'phx'}_secret123` })).toEqual([
      '--yes', '@posthog/wizard', 'mcp', 'add',
      '--features', 'dashboards,insights,product_analytics,sql,workspace,events',
      '--project-id', '364167',
    ]);
    expect(buildWizardEnv({ projectId: '364167', personalApiKey: `${'phx'}_secret123` })).toEqual({
      POSTHOG_WIZARD_API_KEY: `${'phx'}_secret123`,
    });
    const formatted = formatWizardCommand({ projectId: '364167', personalApiKey: `${'phx'}_secret123` });
    expect(formatted).not.toContain('secret123');
    expect(formatted).toContain('--project-id 364167');
    expect(formatted).toContain('POSTHOG_WIZARD_API_KEY=');

    const mcpTmp = mkdtempSync(join(tmpdir(), 'ta-mcp-safe-'));
    try {
      mkdirSync(join(mcpTmp, '.cursor'), { recursive: true });
      mkdirSync(join(mcpTmp, '.claude'), { recursive: true });
      writeFileSync(join(mcpTmp, '.mcp.json'), JSON.stringify({ mcpServers: { posthog: { env: { k: `${'phx'}_leakedtoken123` } } } }));
      writeFileSync(join(mcpTmp, '.cursor/mcp.json'), JSON.stringify({ mcpServers: { posthog: { headers: { Authorization: `Bearer ${'phx'}_leakedcursor123` } } } }));
      writeFileSync(join(mcpTmp, '.claude/settings.local.json'), JSON.stringify({ env: { POSTHOG: `${'phx'}_leakedclaude123` } }));
      expect(checkWorkspaceMcpSafety(mcpTmp)).toEqual([
        'repo root .mcp.json violates D-41; keep MCP configs user-scoped outside git',
        'workspace MCP config contains PostHog token pattern: .mcp.json',
        'workspace MCP config contains PostHog token pattern: .cursor/mcp.json',
        'workspace MCP config contains PostHog token pattern: .claude/settings.local.json',
      ]);
    } finally {
      rmSync(mcpTmp, { recursive: true, force: true });
    }
  });
});
