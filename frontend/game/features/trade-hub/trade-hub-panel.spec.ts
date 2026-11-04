import { RESOURCE_KEYS } from '@terra/contracts';
import {
  createPlanet,
  ensureColonyCargoCapState,
  ENTITY_KIND,
  ENTITY_STATE,
  insertRow,
  recordCargoMint,
  view,
  type ColonyState,
} from '@terra/sim';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadFeatures } from '../../core/registry';
import type { FeatureContext, GameView } from '../../core/registry/types';
import { LandfallController } from '../landfall/selection';
import { installMockDocument, MockElement } from '../test-dom';
import tradeHubFeature, { resolveTradeHubCargoView, TradeHubPanel } from './index';

const W09_FLAGS: ReadonlySet<string> = new Set(['W00', 'W01', 'W02', 'W09']);
const W10_FLAGS: ReadonlySet<string> = new Set(['W00', 'W01', 'W02', 'W10']);

function createTradeHubPlanetFixture() {
  const state = createPlanet({ type: 'flat', seed: 'w10-20-accept', radius: 8 });
  state.colonies.push({
    index: 0,
    id: 'col-0',
    name: 'Colony Alpha',
    color: 0xff6a13,
    status: 'active',
    stock: { 'metals.t1': 900, 'minerals.t1': 400 },
    caps: { metals: 1000, minerals: 1000, bio: 1000 },
    changedAt: 0,
  });

  const hqId = state.meta.nextEntityId++;
  const hqRow = insertRow(state.entities, hqId, 0);
  state.entities.cols.kind[hqRow] = ENTITY_KIND.hq;
  state.entities.cols.owner[hqRow] = 0;
  state.entities.cols.tier[hqRow] = 1;
  state.entities.cols.q[hqRow] = 0;
  state.entities.cols.r[hqRow] = 0;
  state.entities.cols.hp[hqRow] = 900;
  state.entities.cols.hpMax[hqRow] = 900;
  state.entities.cols.state[hqRow] = ENTITY_STATE.idle;

  const hubId = state.meta.nextEntityId++;
  const hubRow = insertRow(state.entities, hubId, 0);
  state.entities.cols.kind[hubRow] = ENTITY_KIND.tradeHub;
  state.entities.cols.owner[hubRow] = 0;
  state.entities.cols.tier[hubRow] = 1;
  state.entities.cols.q[hubRow] = 2;
  state.entities.cols.r[hubRow] = 0;
  state.entities.cols.footprintW[hubRow] = 2;
  state.entities.cols.footprintD[hubRow] = 2;
  state.entities.cols.hp[hubRow] = 650;
  state.entities.cols.hpMax[hubRow] = 650;
  state.entities.cols.state[hubRow] = ENTITY_STATE.active;

  return { state, hubId, hubRow };
}

describe('W10-20 Trade Hub Panel — Registration & Acceptance', () => {
  let uninstallDom: () => void;

  beforeEach(() => {
    uninstallDom = installMockDocument();
  });

  afterEach(() => {
    uninstallDom();
  });

  it('registers trade-hub under W10 and skips when W10 is disabled', () => {
    const w09 = loadFeatures({ flags: W09_FLAGS, host: 'server' });
    expect(w09.some((f) => f.id === 'trade-hub')).toBe(false);

    const w10 = loadFeatures({ flags: W10_FLAGS, host: 'server' });
    expect(w10.some((f) => f.id === 'trade-hub')).toBe(true);
  });

  it('acceptance: clicking a built Trade Hub opens the panel with tabs, in-orbit balances grouped by family, tier, throughput meter, and daily cap', () => {
    const { state } = createTradeHubPlanetFixture();
    const landfall = new LandfallController({ ownerColonyIndex: 0 });
    const simView = view(state);
    landfall.onView(simView);

    const parentEl = new MockElement('div') as unknown as HTMLElement;
    const ctx: FeatureContext = {
      flags: W10_FLAGS,
      host: 'local',
      services: { track: () => {}, landfall },
    };

    const instance = tradeHubFeature.hud![0].mount(parentEl, ctx);
    instance.update?.(simView as unknown as GameView);

    const mockParent = parentEl as unknown as MockElement;
    const panelEl = mockParent.querySelector('[data-testid="trade-hub-panel"]')!;
    expect(panelEl).not.toBeNull();
    expect(panelEl.getAttribute('data-open')).toBe('false');

    const clicked = landfall.handleLeftClick(2, 0);
    expect(clicked).toBe(true);
    expect(landfall.getSelectedEntity()?.kind).toBe(ENTITY_KIND.tradeHub);
    expect(landfall.getSelectedEntity()?.shortCode).toBe('TRD');

    expect(panelEl.getAttribute('data-open')).toBe('true');
    expect(panelEl.getAttribute('data-tab')).toBe('export');
    expect(panelEl.getAttribute('data-online')).toBe('true');

    expect(panelEl.querySelector('[data-testid="trade-hub-title"]')?.textContent).toBe('INTER-COLONY TRADE HUB');
    expect(panelEl.querySelector('[data-testid="trade-hub-tier"]')?.textContent).toBe('TIER 1');
    expect(panelEl.querySelector('[data-testid="trade-hub-status"]')?.textContent).toBe('ONLINE');
    expect(panelEl.querySelector('[data-testid="trade-hub-throughput"]')?.textContent).toBe('0 / 250 / min');
    expect(panelEl.querySelector('[data-testid="trade-hub-daily-cap"]')?.textContent).toBe('0 / 20,000 / day');

    expect(panelEl.querySelector('[data-testid="trade-hub-tab-export"]')?.textContent).toBe('EXPORT TO ORBIT');
    expect(panelEl.querySelector('[data-testid="trade-hub-tab-import"]')?.textContent).toBe('IMPORT TO COLONY');

    const orbitSection = panelEl.querySelector('[data-testid="trade-hub-orbit-balances"]')!;
    expect(orbitSection.querySelector('[data-testid="orbit-family-header-metals"]')?.textContent).toBe('Metals');
    expect(orbitSection.querySelector('[data-testid="orbit-family-header-minerals"]')?.textContent).toBe('Minerals');
    expect(orbitSection.querySelector('[data-testid="orbit-family-header-bio"]')?.textContent).toBe('Bio');

    for (const key of RESOURCE_KEYS) {
      const row = orbitSection.querySelector(`[data-testid="orbit-balance-${key}"]`);
      expect(row).not.toBeNull();
      expect(row?.getAttribute('data-resource')).toBe(key);
      expect(row?.getAttribute('data-balance')).toBe('0');
    }

    instance.dispose();
    landfall.dispose();
  });
});

describe('W10-20 Trade Hub Panel — Tabs & Live Cargo Updates', () => {
  let uninstallDom: () => void;

  beforeEach(() => {
    uninstallDom = installMockDocument();
  });

  afterEach(() => {
    uninstallDom();
  });

  it('switches between Export and Import tabs and updates data-tab', () => {
    const parentEl = new MockElement('div') as unknown as HTMLElement;
    const panel = new TradeHubPanel(parentEl);
    panel.setOpen(true);

    const mockRoot = panel.root as unknown as MockElement;
    const exportTab = mockRoot.querySelector('[data-testid="trade-hub-tab-export"]')!;
    const importTab = mockRoot.querySelector('[data-testid="trade-hub-tab-import"]')!;

    expect(mockRoot.getAttribute('data-tab')).toBe('export');
    expect(exportTab.getAttribute('data-active')).toBe('true');
    expect(importTab.getAttribute('data-active')).toBe('false');

    importTab.click();
    expect(mockRoot.getAttribute('data-tab')).toBe('import');
    expect(panel.getTab()).toBe('import');
    expect(exportTab.getAttribute('data-active')).toBe('false');
    expect(importTab.getAttribute('data-active')).toBe('true');

    exportTab.click();
    expect(mockRoot.getAttribute('data-tab')).toBe('export');
    expect(panel.getTab()).toBe('export');
    expect(exportTab.getAttribute('data-active')).toBe('true');
    expect(importTab.getAttribute('data-active')).toBe('false');

    panel.dispose();
  });
});

describe('W10-20 Trade Hub Panel — Live Cargo Updates & Offline State', () => {
  let uninstallDom: () => void;

  beforeEach(() => {
    uninstallDom = installMockDocument();
  });

  afterEach(() => {
    uninstallDom();
  });

  it('merges cargo.status pushes and colony cargo state, updating orbital balances, throughput meter, and daily cap', () => {
    const state = createPlanet({ type: 'flat', seed: 'w10-20-cargo', radius: 8 });
    const colony: ColonyState = {
      index: 0,
      id: 'col-0',
      name: 'Colony Alpha',
      color: 0xff6a13,
      status: 'active',
      stock: { 'metals.t1': 600 },
      cargo: { inOrbit: { 'metals.t1': 300, 'bio.water': 120 } },
      changedAt: 10,
    };
    state.colonies.push(colony);
    const capState = ensureColonyCargoCapState(colony, 0);
    recordCargoMint(capState, 200, 'metals.t1', 5, 0);
    state.meta.tick = 20;

    const hubRow = insertRow(state.entities, state.meta.nextEntityId++, 0);
    state.entities.cols.kind[hubRow] = ENTITY_KIND.tradeHub;
    state.entities.cols.owner[hubRow] = 0;
    state.entities.cols.tier[hubRow] = 1;
    state.entities.cols.hp[hubRow] = 650;
    state.entities.cols.hpMax[hubRow] = 650;
    state.entities.cols.state[hubRow] = ENTITY_STATE.active;

    const parentEl = new MockElement('div') as unknown as HTMLElement;
    const ctx: FeatureContext = { flags: W10_FLAGS, host: 'server', services: { track: () => {} } };
    const instance = tradeHubFeature.hud![0].mount(parentEl, ctx);
    instance.update?.(view(state) as unknown as GameView);

    const mockParent = parentEl as unknown as MockElement;
    const panelEl = mockParent.querySelector('[data-testid="trade-hub-panel"]')!;

    expect(panelEl.querySelector('[data-testid="orbit-value-metals.t1"]')?.textContent).toBe('300');
    expect(panelEl.querySelector('[data-testid="orbit-value-bio.water"]')?.textContent).toBe('120');
    expect(panelEl.querySelector('[data-testid="trade-hub-throughput"]')?.textContent).toBe('200 / 250 / min');
    expect(panelEl.querySelector('[data-testid="trade-hub-daily-cap"]')?.textContent).toBe('200 / 20,000 / day');

    ctx.services.setCargoStatus?.({
      colonyId: 'col-0',
      inOrbit: { 'metals.t1': 450, 'minerals.t2': 75 },
      todayMinted: { 'metals.t1': 450 },
      dailyCap: 20000,
      throughputUsedPerMin: 250,
      throughputCapPerMin: 250,
    });

    expect(panelEl.querySelector('[data-testid="orbit-value-metals.t1"]')?.textContent).toBe('450');
    expect(panelEl.querySelector('[data-testid="orbit-value-minerals.t2"]')?.textContent).toBe('75');
    expect(panelEl.querySelector('[data-testid="trade-hub-throughput"]')?.textContent).toBe('200 / 250 / min');
    expect(panelEl.querySelector('[data-testid="trade-hub-daily-cap"]')?.textContent).toBe('450 / 20,000 / day');

    state.meta.tick = 305;
    instance.update?.(view(state) as unknown as GameView);
    expect(panelEl.querySelector('[data-testid="trade-hub-throughput"]')?.textContent).toBe('0 / 250 / min');

    state.entities.cols.state[hubRow] = ENTITY_STATE.offlineBrownout;
    instance.update?.(view(state) as unknown as GameView);
    expect(panelEl.getAttribute('data-online')).toBe('false');
    expect(panelEl.querySelector('[data-testid="trade-hub-status"]')?.textContent).toBe('OFFLINE — UNPOWERED');

    ctx.services.openTradeHubPanel?.(true, 'import');
    expect(panelEl.getAttribute('data-open')).toBe('true');
    expect(panelEl.getAttribute('data-tab')).toBe('import');

    panelEl.querySelector('[data-testid="trade-hub-close"]')?.click();
    expect(panelEl.getAttribute('data-open')).toBe('false');

    const resolved = resolveTradeHubCargoView(view(state), ctx.services.cargoStatus);
    expect(resolved.inOrbit['metals.t1']).toBe(450);
    expect(resolved.hubOnline).toBe(false);

    instance.dispose();
  });
});
