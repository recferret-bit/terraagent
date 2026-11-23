// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { localHostOptions } from '../../app/online/localHost';
import { isSpectatorSearch, onlineMode } from '../../app/online/onlineMode';
import { createMapVisibility } from '../../maps/visibility';
import { collectEntityDots } from '../../maps/entityDots';
import { LandfallController } from '../landfall/selection';
import { SpectatorPanel } from './SpectatorPanel';
import { LocalHostCore, type LocalHostDeps } from '../../store/local/LocalHostCore';
import type { FromLocalHost } from '../../store/local/protocol';
import { memorySnapshotStore } from '../../store/local/snapshotStore';
import { hexIndex } from '@terra/sim/grid/hex';
import { ENTITY_KIND, ENTITY_STATE } from '@terra/sim';
import { QueuePanel } from '../queue-panel/QueuePanel';
import { HqPanel } from '../landfall/HqPanel';
import { MinimalHud } from '../hud-min/MinimalHud';
import { GoalsPanel } from '../goals/GoalsPanel';
import { PrioritiesPanel } from '../shared/priorities/PrioritiesPanel';
import { DiplomacyPanel } from '../diplomacy/DiplomacyPanel';
import { DirectorPanel } from '../director/DirectorPanel';
import { ConstructionMenu } from '../construction-menu/ConstructionMenu';
import { UnitsMenu } from '../units-menu/UnitsMenu';

describe('Local & backend spectator URL routing', () => {
  it('routes ?spectator=1 to local bot-only and ?spectator=1&host=server or &join= to backend WS', () => {
    expect(isSpectatorSearch('?spectator=1')).toBe(true);
    expect(isSpectatorSearch('?planet=dune')).toBe(false);
    expect(onlineMode('?spectator=1')).toBe('host');
    expect(onlineMode('?spectator=1&planet=oceanForest&bots=4')).toBe('host');
    expect(onlineMode('?spectator=1&host=server')).toBe('scenario');
    expect(onlineMode('?join=pl_abc&spectator=1')).toBe('scenario');
    expect(onlineMode('?planet=dune')).toBeNull();

    const opts = localHostOptions('?spectator=1&planet=oceanForest&bots=4&seed=77');
    expect(opts).toMatchObject({ scenario: 'spectator', spectator: true, planetType: 'oceanForest', botCount: 4, seed: '77' });
    expect(localHostOptions('?join=pl_abc&spectator=1')).toBeNull();
    expect(localHostOptions('?spectator=1&host=server')).toBeNull();
  });
});

describe('LocalHostCore zero-player spectator mode + bot feeds', () => {
  it('spawns 0 human colonies, emits backend bot inputs/decisions, and rejects player commands read-only', async () => {
    const out: FromLocalHost[] = [];
    let now = 0;
    const deps: LocalHostDeps = {
      now: () => now,
      wallMs: () => 1_700_000_000_000 + now,
      schedule: () => () => undefined,
      store: memorySnapshotStore(),
    };
    const core = await LocalHostCore.create(
      { scenario: 'spectator', spectator: true, planetType: 'temperate', botCount: 2, seed: 'spec-test' },
      deps,
      (m) => out.push(m),
    );
    core.handle({ t: 'client', msg: { t: 'join', d: { planetId: 'local', mode: 'spectator' } } });

    const servers = () => out.flatMap((m) => (m.t === 'server' ? [m.msg] : []));
    const welcome = servers().find((m) => m.t === 'welcome');
    expect(welcome?.d).toMatchObject({ mode: 'spectator', colonyId: null });
    expect(core.simHost.state.colonies.some((c) => Boolean(c && !c.isBot))).toBe(false);
    expect(core.simHost.state.colonies.filter((c) => Boolean(c?.isBot)).length).toBe(2);

    out.length = 0;
    core.advance(15);

    const inputs = servers().filter((m) => m.t === 'sim.input');
    const decisions = servers().filter((m) => m.t === 'sim.decision');
    expect(inputs.length).toBeGreaterThan(0);
    expect(decisions.length).toBeGreaterThan(0);

    core.handle({
      t: 'client',
      msg: { t: 'cmd', id: 'cm_spec_try', d: { kind: 'moveUnit', args: { entityId: 1, q: 0, r: 0 } } },
    });
    const rej = servers().find((m) => m.t === 'cmd.reject');
    expect(rej?.d).toMatchObject({ id: 'cm_spec_try', code: 'spectator_read_only' });
    core.stop();
  });
});

function makeSpectatorSampleView() {
  const hx12 = hexIndex(12);
  const tile6 = hx12.indexOf(-4, 2);
  const tile7 = hx12.indexOf(6, -3);
  return {
    tick: 24,
    planet: { id: 'pl_s', type: 'temperate', radius: 12 },
    colonies: [
      { index: 6, id: 'col_6', name: 'Iron Guild Outpost', isBot: true, botPersona: 'trader', status: 'ACTIVE', stage: 4, foundingSectorId: 'sec_0_0', stock: { 'metals.t1': 320, 'minerals.t1': 110, 'bio.water': 80 }, caps: { metals: 2500 }, power: { netPerS: 18 }, queue: [{ taskId: 't1', colonyIndex: 6, lane: 'construction', state: 'in_progress', progress: 0.4, task: { kind: 'buildBuilding', building: 'solar' } }] },
      { index: 7, id: 'col_7', name: 'Crimson Vanguard', isBot: true, botPersona: 'warlord', status: 'ACTIVE', stage: 4, foundingSectorId: 'sec_1_0', stock: { 'metals.t1': 190, 'minerals.t1': 240, 'bio.biomass': 50 }, caps: { metals: 2500 }, power: { netPerS: 9 }, queue: [] },
    ],
    entities: [
      { id: 101, kind: ENTITY_KIND.hq, owner: 6, q: -4, r: 2, x: -4, y: 2, hp: 200, hpMax: 200, state: ENTITY_STATE.idle, progress: 0 },
      { id: 201, kind: ENTITY_KIND.hq, owner: 7, q: 6, r: -3, x: 6, y: -3, hp: 200, hpMax: 200, state: ENTITY_STATE.idle, progress: 0 },
      { id: 202, kind: ENTITY_KIND.worker, owner: 7, q: 7, r: -3, x: 7, y: -3, hp: 160, hpMax: 160, state: ENTITY_STATE.working, progress: 0.5 },
    ],
    count: 3,
    tiles: { count: 469, exploredByColony: { 6: new Uint8Array(59), 7: new Uint8Array(59) } },
    blobs: { combatVision: { byColony: { 6: [tile6], 7: [tile7] } } },
  };
}

describe('Spectator selection, union bot vision, and SpectatorPanel HUD', () => {
  const sampleView = makeSpectatorSampleView();

  it('clicks any bot entity to switch inspected colony while blocking read-only commands', () => {
    const inspected: number[] = [];
    const sendCmd = vi.fn(async () => ({ ok: true as const, appliedAtTick: 1 }));
    const lc = new LandfallController({
      ownerColonyIndex: 6,
      spectator: true,
      onColonyInspected: (idx) => inspected.push(idx),
      sendCommand: sendCmd,
      store: { latest: sampleView as never },
    });

    expect(lc.clickTile(7, -3)).toBe(true);
    expect(lc.getSelectedEntityId()).toBe(202);
    expect(lc.getOwnerColonyIndex()).toBe(7);
    expect(inspected).toEqual([7]);
    expect(lc.orderMove(8, -3)).toBe(false);
    expect(lc.stopSelected()).toBe(false);
    expect(sendCmd).not.toHaveBeenCalled();
  });

  it('unites visibility across all bots and renders bot cards + inputs inside SpectatorPanel', () => {
    const vis = createMapVisibility({
      tiles: sampleView.tiles as never,
      radius: 12,
      ownColonySlot: 6,
      spectatorAllVision: true,
      clientView: sampleView as never,
    });
    expect(vis(-4, 2)).toBe(true);
    expect(vis(6, -3)).toBe(true);
    expect(vis(11, -11)).toBe(false);

    const singleVis = createMapVisibility({
      tiles: sampleView.tiles as never,
      radius: 12,
      ownColonySlot: 6,
      spectatorAllVision: false,
      clientView: sampleView as never,
    });
    expect(singleVis(-4, 2)).toBe(true);
    expect(singleVis(6, -3)).toBe(false);

    const dots = collectEntityDots({
      width: 120, height: 120, radius: 12,
      tiles: sampleView.tiles as never,
      clientView: sampleView as never,
      ownColonySlot: 6,
      spectatorAllVision: true,
      axialToPixel: (q, r) => ({ x: q * 5 + 60, y: r * 5 + 60 }),
      pixelToAxial: () => ({ q: 0, r: 0 }),
      tilePixelRadius: 3,
    });
    expect(dots.some((d) => d.id === 101)).toBe(true);
    expect(dots.some((d) => d.id === 202)).toBe(true);

    const host = document.createElement('div');
    const inspectSpy = vi.fn();
    let inspectedCol = 6;
    const panel = new SpectatorPanel(host, {
      flags: new Set(['W00', 'W01']),
      host: 'local',
      services: {
        track: () => undefined,
        isSpectator: () => true,
        inspectColony: (idx, focus) => { inspectedCol = idx; inspectSpy(idx, focus); },
        landfall: { getOwnerColonyIndex: () => inspectedCol } as never,
        store: {
          latest: sampleView as never,
          isSpectator: () => true,
          recentInputs: (idx?: number) => [{ id: 'i1', planetId: 'pl_s', sectorId: 'sec_1_0', colonyId: 'col_7', colonyIndex: 7, actorId: 'bot:col_7', isBot: true, source: 'bot' as const, commandId: 'cm_1', kind: 'enqueueTask', args: { lane: 'units' }, status: 'applied' as const, rejectCode: null, rejectDetail: null, atTick: 22, createdAtMs: 1 }].filter((x) => idx === undefined || x.colonyIndex === idx),
          recentDecisions: () => [],
          onFeed: () => () => undefined,
        },
      },
    });
    panel.update(sampleView as never);
    const bot7Btn = host.querySelector('[data-testid="spectator-bot-7"]') as HTMLButtonElement | null;
    expect(bot7Btn).not.toBeNull();
    bot7Btn?.click();
    expect(inspectSpy).toHaveBeenCalledWith(7, true);
    panel.update(sampleView as never);
    expect(host.textContent).toContain('enqueueTask');
    panel.dispose();
  });
});

describe('Spectator read-only QueuePanel, HqPanel, and MinimalHud', () => {
  const hx12 = hexIndex(12);
  const sampleView = {
    tick: 24,
    planet: { id: 'pl_s', type: 'temperate', radius: 12 },
    colonies: [
      { index: 6, id: 'col_6', name: 'Iron Guild Outpost', isBot: true, botPersona: 'trader', status: 'ACTIVE', stage: 4, foundingSectorId: 'sec_0_0', stock: { 'metals.t1': 320 }, caps: { metals: 2500 }, power: { netPerS: 18 }, queue: [{ taskId: 't1', colonyIndex: 6, lane: 'construction', state: 'in_progress', progress: 0.4, task: { kind: 'buildBuilding', building: 'solar' } }] },
      { index: 7, id: 'col_7', name: 'Crimson Vanguard', isBot: true, botPersona: 'warlord', status: 'ACTIVE', stage: 4, foundingSectorId: 'sec_1_0', stock: { 'metals.t1': 190 }, caps: { metals: 2500 }, power: { netPerS: 9 }, queue: [] },
    ],
    entities: [
      { id: 202, kind: ENTITY_KIND.worker, owner: 7, q: 7, r: -3, x: 7, y: -3, hp: 160, hpMax: 160, state: ENTITY_STATE.working, progress: 0.5 },
    ],
    count: 1,
    tiles: { count: hx12.count, exploredByColony: { 6: new Uint8Array(59), 7: new Uint8Array(59) } },
  };

  it('keeps QueuePanel, HqPanel read-only and displays inspected bot colony name in MinimalHud', () => {
    const host = document.createElement('div');
    const sendCmd = vi.fn(async () => ({ ok: true as const, appliedAtTick: 1 }));
    const lc = new LandfallController({
      ownerColonyIndex: 6,
      spectator: true,
      sendCommand: sendCmd,
      store: { latest: sampleView as never },
    });
    const queue = new QueuePanel(host, {
      flags: new Set(['W00', 'W01']),
      host: 'local',
      services: {
        track: () => undefined,
        isSpectator: () => true,
        landfall: lc,
        sendCommand: sendCmd as never,
      },
    });
    queue.update(sampleView as never);
    expect(queue.getEntries()).toHaveLength(1);
    const cancelAllBtn = host.querySelector('[data-testid="queue-cancel-all"]') as HTMLButtonElement | null;
    expect(cancelAllBtn).not.toBeNull();
    expect(cancelAllBtn?.hidden).toBe(true);
    queue.cancelTask('t1');
    queue.cancelAll();
    expect(queue.getEntries()).toHaveLength(1);
    expect(sendCmd).not.toHaveBeenCalled();

    const hqPanel = new HqPanel(host, lc);
    expect(lc.clickTile(7, -3)).toBe(true);
    const cancelBtn = host.querySelector('[data-testid="hq-panel-cancel"]') as HTMLButtonElement | null;
    expect(cancelBtn).not.toBeNull();
    expect(cancelBtn?.hidden).toBe(true);

    const hud = new MinimalHud(host, {
      getOwnerColonyIndex: () => lc.getOwnerColonyIndex(),
      isSpectator: () => true,
    });
    hud.update(sampleView as never);
    const colonyNameEl = host.querySelector('[data-testid="hud-colony-name"]')!;
    expect(colonyNameEl.textContent).toBe('Crimson Vanguard');
    expect(colonyNameEl.classList.contains('ta-hud-min__sr-only')).toBe(false);

    hud.dispose();
    hqPanel.dispose();
    queue.dispose();
  });
});

describe('Spectator multi-bot LandfallController switching & HUD read-only guards', () => {
  const hx12 = hexIndex(12);

  it('switches LandfallController selection cleanly across bots and syncs SpectatorPanel, HqPanel, GoalsPanel, PrioritiesPanel, and DirectorPanel', () => {
    const host = document.createElement('div');
    const sendCmd = vi.fn(async () => ({ ok: true as const, appliedAtTick: 1 }));
    const multiBotView = makeMultiBotView(hx12.count);

    let inspectColonyFn: ((idx: number) => void) | undefined;
    const lc = new LandfallController({
      ownerColonyIndex: 6,
      spectator: true,
      sendCommand: sendCmd,
      store: { latest: multiBotView as never },
      onColonyInspected: (idx) => inspectColonyFn?.(idx),
    });
    const hqPanel = new HqPanel(host, lc);
    expect(lc.getSelectedEntityId()).toBe(100);
    expect(host.querySelector('[data-testid="hq-panel"]')?.getAttribute('data-entity-id')).toBe('100');

    lc.setOwnerColonyIndex(7);
    expect(lc.getSelectedEntityId()).toBe(200);
    expect(host.querySelector('[data-testid="hq-panel"]')?.getAttribute('data-entity-id')).toBe('200');

    const ctx = {
      flags: new Set(['W00', 'W01', 'W07', 'W08', 'W16', 'W18', 'W22']),
      host: 'local' as const,
      services: {
        track: () => undefined,
        isSpectator: () => true,
        landfall: lc,
        sendCommand: sendCmd as never,
        inspectColony: (idx: number) => {
          lc.setOwnerColonyIndex(idx);
          specPanel.update(multiBotView as never);
          goalsPanel.update(multiBotView as never);
          prioritiesPanel.update(multiBotView as never);
        },
        store: {
          latest: multiBotView as never,
          isSpectator: () => true,
          recentInputs: () => [],
          recentDecisions: () => [],
          onFeed: () => () => undefined,
          sendCommand: sendCmd as never,
        },
      },
    };
    const specPanel = new SpectatorPanel(host, ctx);
    inspectColonyFn = (idx) => {
      lc.setOwnerColonyIndex(idx);
      specPanel.update(multiBotView as never);
    };
    const goalsPanel = new GoalsPanel(host, ctx);
    const prioritiesPanel = new PrioritiesPanel(host, ctx);
    const dirPanel = new DirectorPanel(host, { readOnly: true, onPolicyChange: vi.fn(), onToggleAutopilot: vi.fn() });

    ctx.services.inspectColony(6);
    expect(goalsPanel.getGoals()).toHaveLength(1);
    expect(prioritiesPanel.getValues().economy).toBe(80);
    dirPanel.renderPlan([{ actionId: 'act_6', state: 'applied' }], 2);
    dirPanel.syncPolicy({ colonyId: 'col_6', colonyIndex: 6, policy: { risk: 'risky', preset: 'expansion', note: 'push', pause: false, revision: 2 }, intentRevision: 2 } as never);
    expect((host.querySelector('[data-testid="director-policy-summary"]') as HTMLElement | null)?.hidden).toBe(false);

    (host.querySelector('[data-testid="spectator-tab-summary"]') as HTMLButtonElement | null)?.click();
    const specFeedText = host.querySelector('[data-testid="spectator-feed"]')?.textContent ?? '';
    expect(specFeedText).toContain('STOCK · METALS');
    expect(specFeedText).toContain('335/2500');
    expect(specFeedText).toContain('B2:12 B3:3');
    expect(specFeedText).toContain('POWER & LOGISTICS');
    expect(specFeedText).toContain('prod 24 · demand 6');
    expect(specFeedText).toContain('supply 4/10');
    expect(specFeedText).toContain('build solar @(2,-1)');
    expect(specFeedText).toContain('GOAL · grow_economy');

    const bot7View = structuredClone(multiBotView);
    delete (bot7View.colonies[1] as { priorities?: unknown }).priorities;
    lc.setOwnerColonyIndex(7);
    prioritiesPanel.update(bot7View as never);
    expect(prioritiesPanel.getValues().economy).toBe(50);
    dirPanel.syncPolicy(undefined, 'col_7');
    expect((host.querySelector('[data-testid="director-policy-summary"]') as HTMLElement | null)?.hidden).toBe(true);
    expect(host.querySelectorAll('.ta-director__row')).toHaveLength(0);

    expect(lc.clickTile(1, 0)).toBe(true);
    expect(lc.getOwnerColonyIndex()).toBe(6);
    expect(lc.getSelectedEntityId()).toBe(101);
    expect(host.querySelector('[data-testid="spectator-bot-6"]')?.getAttribute('data-selected')).toBe('true');

    dirPanel.dispose();
    prioritiesPanel.dispose();
    goalsPanel.dispose();
    specPanel.dispose();
    hqPanel.dispose();
  });
});

describe('Spectator read-only guards across colony command panels', () => {
  const hx12 = hexIndex(12);

  it('blocks optimistic and interactive writes across Goals, Priorities, Diplomacy, Director, Build, and Units in spectator mode', () => {
    const host = document.createElement('div');
    const sendCmd = vi.fn(async () => ({ ok: true as const, appliedAtTick: 1 }));
    const multiBotView = makeMultiBotView(hx12.count);
    const lc = new LandfallController({ ownerColonyIndex: 6, spectator: true, sendCommand: sendCmd, store: { latest: multiBotView as never } });
    const ctx = {
      flags: new Set(['W00', 'W01', 'W07', 'W08', 'W16', 'W18', 'W22']),
      host: 'local' as const,
      services: {
        track: () => undefined,
        isSpectator: () => true,
        landfall: lc,
        sendCommand: sendCmd as never,
        store: { latest: multiBotView as never, isSpectator: () => true, sendCommand: sendCmd as never },
      },
    };
    const goalsPanel = new GoalsPanel(host, ctx);
    const prioritiesPanel = new PrioritiesPanel(host, ctx);
    const dipActions = { onProposeTruce: vi.fn(), onRespondTruce: vi.fn(), onCancelTruce: vi.fn(), onDeclareWar: vi.fn(), onCancelWar: vi.fn() };
    const dipPanel = new DiplomacyPanel(host, {
      actions: dipActions,
      ownColonyIndex: 7,
      getOwnColonyIndex: () => lc.getOwnerColonyIndex() ?? 7,
      readOnly: true,
      getReadOnly: () => true,
    });
    dipPanel.update({
      colonyIndex: 7,
      currentTick: 30,
      oathbreakerUntil: null,
      incomingOffers: [{ offerId: 'of1', fromColony: 6, toColony: 7, hours: 6, offeredAtTick: 10, expiresAtTick: 500 }],
      outgoingOffers: [],
      truces: [],
      wars: [],
      contacts: [6],
    });
    const dirPolicySpy = vi.fn();
    const dirAutoSpy = vi.fn();
    const dirPanel = new DirectorPanel(host, { readOnly: true, onPolicyChange: dirPolicySpy, onToggleAutopilot: dirAutoSpy });
    const buildMenu = new ConstructionMenu(host, ctx, multiBotView as never);
    const unitsMenu = new UnitsMenu(host, ctx, multiBotView as never);

    goalsPanel.addGoal({ goal: 'secure_power' });
    goalsPanel.cancelGoal('g6');
    expect(goalsPanel.getGoals()).toHaveLength(1);
    (host.querySelector('[data-action="accept-truce"]') as HTMLButtonElement | null)?.click();
    (host.querySelector('[data-action="propose-truce"]') as HTMLButtonElement | null)?.click();
    expect(dipActions.onRespondTruce).not.toHaveBeenCalled();
    expect(dipActions.onProposeTruce).not.toHaveBeenCalled();
    (host.querySelector('[data-testid="director-autopilot-toggle"]') as HTMLButtonElement | null)?.click();
    expect(dirAutoSpy).not.toHaveBeenCalled();
    expect(dirPolicySpy).not.toHaveBeenCalled();
    buildMenu.startPlacement('solar');
    expect(buildMenu.getGhostState()).toBeNull();
    expect(sendCmd).not.toHaveBeenCalled();

    unitsMenu.dispose();
    buildMenu.dispose();
    dirPanel.dispose();
    dipPanel.dispose();
    prioritiesPanel.dispose();
    goalsPanel.dispose();
  });
});

function makeMultiBotView(tileCount: number) {
  return {
    tick: 30,
    planet: { id: 'pl_s', type: 'temperate', radius: 12 },
    colonies: [
      {
        index: 6,
        id: 'col_6',
        name: 'Iron Guild Outpost',
        isBot: true,
        botPersona: 'trader',
        status: 'ACTIVE',
        stage: 4,
        aiEnabled: true,
        foundingSectorId: 'sec_0_0',
        stock: { 'metals.t1': 320, 'metals.t2': 15, 'minerals.t1': 110, 'bio.water': 80, 'bio.biomass': 60, 'bio.t2': 12, 'bio.t3': 3 },
        caps: { metals: 2500, minerals: 1500, bio: 1000, energy: 0, item: 0 },
        power: { supply: 24, demand: 6, rawDemand: 6, generationPerS: 24, net: 18 },
        supply: { used: 4, cap: 10, units: 4, reserved: 0, available: 6, max: 10, sources: [] },
        priorities: { economy: 80, expansion: 40, defense: 30, power: 50, terraform: 20 },
        goals: [{ id: 'g6', goal: 'grow_economy', status: 'active', params: { targetRatePerMin: 20 }, progress: 0.5, stepsCompleted: 1, stepsTotal: 2, budgetBp: 5000, spent: {}, childTaskIds: [], createdAtTick: 1 }],
        queue: [{ taskId: 't6', colonyIndex: 6, lane: 'construction', state: 'in_progress', progress: 0.4, task: { kind: 'build', building: 'solar', q: 2, r: -1 } }],
      },
      {
        index: 7,
        id: 'col_7',
        name: 'Crimson Vanguard',
        isBot: true,
        botPersona: 'warlord',
        status: 'ACTIVE',
        stage: 3,
        aiEnabled: false,
        foundingSectorId: 'sec_1_0',
        stock: { 'metals.t1': 190, 'minerals.t1': 90, 'bio.water': 50 },
        caps: { metals: 1500, minerals: 1000, bio: 800, energy: 0, item: 0 },
        power: { supply: 15, demand: 6, rawDemand: 6, generationPerS: 15, net: 9 },
        priorities: { economy: 20, expansion: 70, defense: 90, power: 40, terraform: 10 },
        goals: [],
        queue: [],
      },
    ],
    entities: [
      { id: 100, kind: ENTITY_KIND.hq, owner: 6, q: 0, r: 0, x: 0, y: 0, hp: 500, hpMax: 500, state: ENTITY_STATE.idle, progress: 0 },
      { id: 101, kind: ENTITY_KIND.worker, owner: 6, q: 1, r: 0, x: 1, y: 0, hp: 100, hpMax: 100, state: ENTITY_STATE.idle, progress: 0 },
      { id: 200, kind: ENTITY_KIND.hq, owner: 7, q: 6, r: 0, x: 6, y: 0, hp: 500, hpMax: 500, state: ENTITY_STATE.idle, progress: 0 },
    ],
    count: 3,
    tiles: { count: tileCount, exploredByColony: { 6: new Uint8Array(59), 7: new Uint8Array(59) } },
  };
}
