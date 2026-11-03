// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseWaves } from '@terra/contracts';
import { ENTITY_KIND, ENTITY_STATE, type QueueEntry } from '@terra/sim';
import { QueuePanel, STORAGE_HINT_BUTTON_TEXT, STORAGE_HINT_TEXT } from './QueuePanel';
import { buildUnitsCatalog, resolveSupply } from '../units-menu/catalog';
import { HqPanel } from '../landfall/HqPanel';
import { buildSelectedEntityFromRow } from '../landfall/selectionHelpers';
import { formatEntityState } from '../power-hud/PowerHud';
import type { FeatureContext } from '../../core/registry/types';
import type { LandfallController } from '../landfall/selection';

function makeCtx(wavesSpec = '..03', services: Record<string, unknown> = {}): FeatureContext {
  return {
    flags: new Set(parseWaves(wavesSpec).list),
    host: 'server',
    services: { track: () => {}, ...services } as unknown as FeatureContext['services'],
  };
}

function makeQueueEntry(overrides: Partial<QueueEntry>): QueueEntry {
  return {
    taskId: 'q_1',
    colonyIndex: 0,
    lane: 'construction',
    precedence: 'player',
    state: 'queued',
    task: { kind: 'build', building: 'solar', q: 0, r: 0 },
    cost: {},
    paid: false,
    progress: 0,
    buildTicks: 50,
    elapsedTicks: 0,
    workRate: 1,
    createdAt: 1,
    ...overrides,
  };
}

describe('W03-19: QueuePanel v2 lane tabs', () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.innerHTML = '';
    document.body.appendChild(host);
  });

  it('renders 4 lane sections and filters visibility via lane tabs', () => {
    const panel = new QueuePanel(host, makeCtx('..03'));
    panel.setEntries([
      makeQueueEntry({ taskId: 'c1', lane: 'construction', task: { kind: 'build', building: 'pylon', q: 1, r: 0 } }),
      makeQueueEntry({ taskId: 't1', lane: 'terraform', task: { kind: 'terraform', op: 'clear', q: 2, r: 0 } }),
      makeQueueEntry({ taskId: 'u1', lane: 'units', task: { kind: 'buildUnit', unit: 'builder' } }),
      makeQueueEntry({ taskId: 'g1', lane: 'hqGoals', task: { kind: 'hqGoal', goal: 'expand_grid' } }),
    ]);

    const tabs = panel.root.querySelectorAll('[data-lane-tab]');
    expect(tabs.length).toBe(5);
    expect(panel.getActiveLane()).toBe('all');

    const cSec = panel.root.querySelector('[data-lane="construction"]') as HTMLElement;
    const tSec = panel.root.querySelector('[data-lane="terraform"]') as HTMLElement;
    const uSec = panel.root.querySelector('[data-lane="units"]') as HTMLElement;
    const gSec = panel.root.querySelector('[data-lane="hqGoals"]') as HTMLElement;
    expect(cSec.hidden).toBe(false);
    expect(tSec.hidden).toBe(false);
    expect(uSec.hidden).toBe(false);
    expect(gSec.hidden).toBe(false);

    const tfTab = panel.root.querySelector('[data-lane-tab="terraform"]') as HTMLButtonElement;
    tfTab.click();
    expect(panel.getActiveLane()).toBe('terraform');
    expect(cSec.hidden).toBe(true);
    expect(tSec.hidden).toBe(false);
    expect(uSec.hidden).toBe(true);
    expect(gSec.hidden).toBe(true);
    panel.dispose();
  });
});

describe('W03-19: QueuePanel v2 earmarks and Build Depot button', () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.innerHTML = '';
    document.body.appendChild(host);
  });

  it('renders earmark bar and clickable Build Depot button on waiting(storage) when W03 is active', () => {
    const startPlacement = vi.fn();
    const panel = new QueuePanel(host, makeCtx('..03', { startPlacement }));
    panel.setEntries([
      makeQueueEntry({
        taskId: 'storage_wait',
        lane: 'construction',
        state: 'waiting',
        waitReason: 'storage',
        waitDetail: 'waiting: storage (cap 500 < cost 600)',
        task: { kind: 'build', building: 'commandHub', q: 2, r: 2 },
      }),
      makeQueueEntry({
        taskId: 'res_earmark',
        lane: 'construction',
        state: 'waiting',
        waitReason: 'resources',
        earmarked: { 'minerals.t1': 160 },
        task: { kind: 'build', building: 'thermal', q: 3, r: 2 },
      }),
    ]);

    const hintBtn = panel.root.querySelector('[data-testid="queue-storage-hint"]') as HTMLButtonElement | null;
    expect(hintBtn).not.toBeNull();
    expect(hintBtn?.tagName).toBe('BUTTON');
    expect(hintBtn?.textContent).toBe(STORAGE_HINT_BUTTON_TEXT);
    hintBtn?.click();
    expect(startPlacement).toHaveBeenCalledWith('supplyDepot');

    const earmark = panel.root.querySelector('[data-testid="queue-earmark-bar"]');
    expect(earmark).not.toBeNull();
    expect(earmark?.textContent).toContain('Earmarked: 160 Minerals');
    panel.dispose();
  });

  it('preserves greyed storage hint div when W03 flag is off (..02) and formats powerLine/repair titles', () => {
    const panelW02 = new QueuePanel(host, makeCtx('..02'));
    panelW02.setEntries([makeQueueEntry({ taskId: 'w02_wait', state: 'waiting', waitReason: 'storage' })]);
    const hintDiv = panelW02.root.querySelector('[data-testid="queue-storage-hint"]');
    expect(hintDiv?.tagName).toBe('DIV');
    expect(hintDiv?.textContent).toBe(STORAGE_HINT_TEXT);
    panelW02.dispose();

    const panelW03 = new QueuePanel(host, makeCtx('..03'));
    panelW03.setEntries([
      makeQueueEntry({ taskId: 'pl_1', task: { kind: 'powerLine', tiles: [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }] } }),
      makeQueueEntry({ taskId: 'rep_1', task: { kind: 'repair', entityId: 42 } }),
    ]);
    expect(panelW03.root.textContent).toContain('Power Line (3× Pylon)');
    expect(panelW03.root.textContent).toContain('Repair #42');
    panelW03.dispose();
  });
});

describe('W03-19: Units menu Builder card and Selection panel #id + W03 kinds', () => {
  it('includes builder card in buildUnitsCatalog under W03 and counts builders in resolveSupply', () => {
    expect(buildUnitsCatalog(parseWaves('..02')).map((c) => c.unit)).toEqual(['harvester']);

    const w03Cards = buildUnitsCatalog(parseWaves('..03'));
    expect(w03Cards.map((c) => c.unit)).toEqual(['harvester', 'builder']);
    const builder = w03Cards.find((c) => c.unit === 'builder')!;
    expect(builder.label).toBe('Builder Drone');
    expect(builder.buildS).toBe(12);
    expect(builder.supply).toBe(1);
    expect(builder.powerDrainPerS).toBe(3);
    expect(builder.powerText).toBe('−3 E/s');
    expect(builder.costSummary).toBe('45 Metals · 25 Minerals · 10 Biomass');

    const supply = resolveSupply({
      entities: [
        { kind: ENTITY_KIND.harvester, hp: 160 },
        { kind: ENTITY_KIND.builder, hp: 150 },
      ],
    });
    expect(supply).toEqual({ used: 2, cap: 10 });
  });

  it('displays #<entityId> on HqPanel and resolves W03 unit and building kinds', () => {
    const parent = document.createElement('div');
    const mockController = {
      getHq: () => null,
      getSelectedEntity: () => null,
      getSelectedDeposit: () => null,
      isHqSelected: () => false,
      getSelectedEntityId: () => null,
      selectHq: () => null,
      selectEntity: () => null,
      selectDepositAt: () => null,
      clearSelection: () => {},
      toggleSelectHq: () => null,
      moveHqTo: () => {},
      stopHq: () => {},
      cancelSelected: () => false,
      onChange: () => () => {},
    } as unknown as LandfallController;
    const hqPanel = new HqPanel(parent, mockController);

    const builderSel = buildSelectedEntityFromRow(
      { id: 17, kind: ENTITY_KIND.builder, owner: 0, q: 2, r: 3, x: 2, y: 3, rot: 0, hp: 140, hpMax: 150, state: ENTITY_STATE.repairing, progress: 0.4 },
      {}, {}, {},
    );
    expect(builderSel?.kindLabel).toBe('BUILDER DRONE');
    expect(builderSel?.shortCode).toBe('BLD');
    expect(builderSel?.currentJob).toBe('repairing');

    hqPanel.render(null, true, builderSel);
    const idBadge = hqPanel.el.querySelector('[data-testid="selection-entity-id"]') as HTMLElement | null;
    expect(idBadge?.hidden).toBe(false);
    expect(idBadge?.textContent).toBe('#17');
    expect(hqPanel.el.dataset.entityId).toBe('17');

    const thermalSel = buildSelectedEntityFromRow(
      { id: 23, kind: ENTITY_KIND.thermal, owner: 0, q: 4, r: 1, x: 4, y: 1, rot: 0, hp: 550, hpMax: 550, state: ENTITY_STATE.offlineNoFuel, progress: 0 },
      {}, {}, {},
    );
    expect(thermalSel?.kindLabel).toBe('THERMAL PLANT');
    expect(thermalSel?.currentJob).toBe('offline: no fuel');
    expect(formatEntityState(ENTITY_STATE.offlineNoFuel)).toBe('offline: no fuel');
    expect(formatEntityState(ENTITY_STATE.offlineNoGrid)).toBe('offline: no grid');
    expect(formatEntityState(ENTITY_STATE.offlineOverload)).toBe('offline: overload');
    hqPanel.dispose();
  });
});
