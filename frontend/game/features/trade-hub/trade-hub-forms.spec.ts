import {
  createPlanet,
  ENTITY_KIND,
  ENTITY_STATE,
  insertRow,
  view,
  type ColonyState,
} from '@terra/sim';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeatureContext, GameView } from '../../core/registry/types';
import { installMockDocument, MockElement } from '../test-dom';
import tradeHubFeature, {
  computeTransferBounds,
  resolveTradeHubCargoView,
  TradeHubPanel,
} from './index';

const W10_FLAGS: ReadonlySet<string> = new Set(['W00', 'W01', 'W02', 'W10']);

function createTradeHubFormsFixture(overrides?: Partial<ColonyState>) {
  const state = createPlanet({ type: 'flat', seed: 'w10-21-forms', radius: 8 });
  const colony: ColonyState = {
    index: 0,
    id: 'col-0',
    name: 'Colony Alpha',
    color: 0xff6a13,
    status: 'active',
    stock: {
      'metals.t1': 900,
      'metals.t2': 120,
      'minerals.t1': 180,
      'minerals.t2': 60,
      'bio.water': 210,
      'bio.biomass': 80,
    },
    caps: { metals: 1200, minerals: 800, bio: 600 },
    cargo: {
      inOrbit: {
        'metals.t1': 300,
        'minerals.t2': 90,
        'bio.water': 150,
      },
      reservedByFamily: { metals: 80, minerals: 0, bio: 10 },
    },
    changedAt: 0,
    ...overrides,
  };
  state.colonies.push(colony);

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

  return { state, colony, hubId, hubRow };
}

describe('W10-21 Trade Hub Export & Import Forms — Acceptance & Command Dispatch', () => {
  let uninstallDom: () => void;

  beforeEach(() => {
    uninstallDom = installMockDocument();
  });

  afterEach(() => {
    uninstallDom();
  });

  it('acceptance: selecting metals.t1, setting amount to 300, and clicking Confirm sends cargo.export with { resource: "metals.t1", amount: 300 }', () => {
    const { state } = createTradeHubFormsFixture();
    const sendCommand = vi.fn().mockResolvedValue({ ok: true, appliedAtTick: 1 });
    const parentEl = new MockElement('div') as unknown as HTMLElement;
    const ctx: FeatureContext = {
      flags: W10_FLAGS,
      host: 'local',
      services: { track: () => {}, sendCommand },
    };

    const panel = new TradeHubPanel(parentEl, ctx, view(state) as unknown as GameView);
    panel.setOpen(true);

    panel.selectResource('metals.t1');
    panel.setAmount(300);

    const mockRoot = panel.root as unknown as MockElement;
    const previewEl = mockRoot.querySelector('[data-testid="trade-hub-preview"]')!;
    expect(previewEl.textContent).toContain('Export 300 Metals T1 → Orbit');
    expect(previewEl.textContent).toContain('600 remaining in stock');
    expect(previewEl.textContent).toContain('Stock 900 → 600, Orbit 300 → 600');

    const confirmBtn = mockRoot.querySelector('[data-testid="trade-hub-confirm"]')!;
    expect(confirmBtn.textContent).toBe('CONFIRM EXPORT');
    expect(confirmBtn.disabled).toBe(false);

    confirmBtn.click();

    expect(sendCommand).toHaveBeenCalledTimes(1);
    expect(sendCommand).toHaveBeenCalledWith('cargo.export', {
      resource: 'metals.t1',
      amount: 300,
    });

    panel.dispose();
  });

  it('switches to the Import tab and confirming 100 metals.t1 sends cargo.import with { resource: "metals.t1", amount: 100 }', () => {
    const { state } = createTradeHubFormsFixture();
    const sendCommand = vi.fn().mockResolvedValue({ ok: true, appliedAtTick: 2 });
    const parentEl = new MockElement('div') as unknown as HTMLElement;
    const ctx: FeatureContext = {
      flags: W10_FLAGS,
      host: 'local',
      services: { track: () => {}, sendCommand },
    };

    const instance = tradeHubFeature.hud![0].mount(parentEl, ctx);
    instance.update?.(view(state) as unknown as GameView);

    const mockParent = parentEl as unknown as MockElement;
    const panelEl = mockParent.querySelector('[data-testid="trade-hub-panel"]')!;

    const importTabBtn = panelEl.querySelector('[data-testid="trade-hub-tab-import"]')!;
    importTabBtn.click();
    expect(panelEl.getAttribute('data-tab')).toBe('import');

    const panel = ctx.services.getTradeHubPanel?.()!;
    panel.selectResource('metals.t1');
    panel.setAmount(100);

    const previewEl = panelEl.querySelector('[data-testid="trade-hub-preview"]')!;
    // familyCaps.metals = 1200, familyUsed.metals = 900 + 120 = 1020, familyReserved.metals = 80 -> familyFree.metals = 100
    expect(previewEl.textContent).toContain('Import 100 Metals T1 → Colony');
    expect(previewEl.textContent).toContain('free storage: 100');
    expect(previewEl.textContent).toContain('Stock 900 → 1000, Orbit 300 → 200');

    const confirmBtn = panelEl.querySelector('[data-testid="trade-hub-confirm"]')!;
    expect(confirmBtn.textContent).toBe('CONFIRM IMPORT');
    confirmBtn.click();

    expect(sendCommand).toHaveBeenCalledTimes(1);
    expect(sendCommand).toHaveBeenCalledWith('cargo.import', {
      resource: 'metals.t1',
      amount: 100,
    });

    instance.dispose();
  });
});

describe('W10-21 Trade Hub Forms — Family/Tier Picker, Slider Bounds & Preview Clamping', () => {
  let uninstallDom: () => void;

  beforeEach(() => {
    uninstallDom = installMockDocument();
  });

  afterEach(() => {
    uninstallDom();
  });

  it('switches family (metals → minerals → bio) and sub-resource tier, updating the resource picker, slider bounds, and preview line', () => {
    const { state } = createTradeHubFormsFixture();
    const parentEl = new MockElement('div') as unknown as HTMLElement;
    const panel = new TradeHubPanel(parentEl, undefined, view(state) as unknown as GameView);
    panel.setOpen(true);

    const mockRoot = panel.root as unknown as MockElement;
    const sliderEl = mockRoot.querySelector('[data-testid="trade-hub-amount-slider"]')!;
    const previewEl = mockRoot.querySelector('[data-testid="trade-hub-preview"]')!;

    // Default family is metals, resource is metals.t1 (stock 900, throughput cap 250 -> maxAmount 250)
    expect(panel.getSelectedFamily()).toBe('metals');
    expect(panel.getSelectedResource()).toBe('metals.t1');
    expect(sliderEl.getAttribute('data-stock-max')).toBe('900');
    expect(sliderEl.getAttribute('data-cap-max')).toBe('250');
    expect(sliderEl.getAttribute('data-slider-max')).toBe('250');
    expect(previewEl.textContent).toContain('Export 250 Metals T1 → Orbit');

    // Switch sub-resource within metals to metals.t2 (stock 120, cap 250 -> maxAmount 120)
    mockRoot.querySelector('[data-testid="trade-hub-resource-metals.t2"]')!.click();
    expect(panel.getSelectedResource()).toBe('metals.t2');
    expect(sliderEl.getAttribute('data-stock-max')).toBe('120');
    expect(sliderEl.getAttribute('data-slider-max')).toBe('120');
    expect(previewEl.textContent).toContain('Export 120 Metals T2 → Orbit');

    // Switch family to minerals -> selects minerals.t1 (stock 180, cap 250 -> maxAmount 180)
    mockRoot.querySelector('[data-testid="trade-hub-family-minerals"]')!.click();
    expect(panel.getSelectedFamily()).toBe('minerals');
    expect(panel.getSelectedResource()).toBe('minerals.t1');
    expect(mockRoot.querySelector('[data-testid="trade-hub-resource-minerals.t1"]')).not.toBeNull();
    expect(mockRoot.querySelector('[data-testid="trade-hub-resource-metals.t1"]')).toBeNull();
    expect(sliderEl.getAttribute('data-stock-max')).toBe('180');
    expect(sliderEl.getAttribute('data-slider-max')).toBe('180');
    expect(previewEl.textContent).toContain('Export 180 Minerals T1 → Orbit');

    // Switch tier in minerals to minerals.t2 (stock 60)
    mockRoot.querySelector('[data-testid="trade-hub-resource-minerals.t2"]')!.click();
    expect(panel.getSelectedResource()).toBe('minerals.t2');
    expect(sliderEl.getAttribute('data-slider-max')).toBe('60');
    expect(previewEl.textContent).toContain('Export 60 Minerals T2 → Orbit');

    // Switch family to bio -> selects bio.water (stock 210)
    mockRoot.querySelector('[data-testid="trade-hub-family-bio"]')!.click();
    expect(panel.getSelectedFamily()).toBe('bio');
    expect(panel.getSelectedResource()).toBe('bio.water');
    expect(mockRoot.querySelector('[data-testid="trade-hub-resource-bio.water"]')).not.toBeNull();
    expect(mockRoot.querySelector('[data-testid="trade-hub-resource-bio.biomass"]')).not.toBeNull();
    expect(sliderEl.getAttribute('data-slider-max')).toBe('210');
    expect(previewEl.textContent).toContain('Export 210 Water → Orbit');

    // Clicking an in-orbit balance row selects its family and resource
    mockRoot.querySelector('[data-testid="orbit-balance-minerals.t2"]')!.click();
    expect(panel.getSelectedFamily()).toBe('minerals');
    expect(panel.getSelectedResource()).toBe('minerals.t2');

    panel.dispose();
  });
});

describe('W10-21 Trade Hub Forms — Slider Cap Clamping, Preview & Offline State', () => {
  let uninstallDom: () => void;

  beforeEach(() => {
    uninstallDom = installMockDocument();
  });

  afterEach(() => {
    uninstallDom();
  });

  it('bounds the slider at the cap when dragged past it, shows the limit reason, and previews clamped imports', () => {
    const { state, hubRow } = createTradeHubFormsFixture();
    const sendCommand = vi.fn();
    const storeSend = vi.fn();
    const parentEl = new MockElement('div') as unknown as HTMLElement;
    const ctx: FeatureContext = {
      flags: W10_FLAGS,
      host: 'local',
      services: { track: () => {}, store: { sendCommand: storeSend } },
    };

    const panel = new TradeHubPanel(parentEl, ctx, view(state) as unknown as GameView);
    panel.setOpen(true);

    const mockRoot = panel.root as unknown as MockElement;
    const sliderEl = mockRoot.querySelector('[data-testid="trade-hub-amount-slider"]') as unknown as HTMLInputElement & MockElement;
    const inputEl = mockRoot.querySelector('[data-testid="trade-hub-amount-input"]') as unknown as HTMLInputElement & MockElement;
    const limitEl = mockRoot.querySelector('[data-testid="trade-hub-limit-reason"]')!;
    const previewEl = mockRoot.querySelector('[data-testid="trade-hub-preview"]')!;

    // Drag slider past cap (e.g. 500 when throughput cap is 250)
    sliderEl.value = '500';
    sliderEl.oninput?.(undefined as unknown as Event);

    expect(panel.getAmount()).toBe(250);
    expect(sliderEl.getAttribute('value')).toBe('250');
    expect(limitEl.textContent).toContain('Bounded by throughput cap (250 / min remaining)');

    // Quick-set 50% and MAX buttons
    mockRoot.querySelector('[data-testid="trade-hub-amount-50"]')!.click();
    expect(panel.getAmount()).toBe(125);
    mockRoot.querySelector('[data-testid="trade-hub-amount-max"]')!.click();
    expect(panel.getAmount()).toBe(250);

    // Switch to Import tab: metals.t1 has 300 in orbit, 100 free storage -> slider max is 100
    panel.setTab('import');
    expect(sliderEl.getAttribute('data-stock-max')).toBe('300');
    expect(sliderEl.getAttribute('data-cap-max')).toBe('100');
    expect(sliderEl.getAttribute('data-slider-max')).toBe('100');

    // Type 500 in number input -> preview shows clamped to 100 free storage
    inputEl.value = '500';
    inputEl.oninput?.(undefined as unknown as Event);
    expect(panel.getAmount()).toBe(500);
    expect(previewEl.textContent).toContain('Import 100 of 500 Metals T1 → Colony (clamped to 100 free storage');

    // Confirm uses store.sendCommand fallback when services.sendCommand is absent
    expect(panel.confirm()).toBe(true);
    expect(storeSend).toHaveBeenCalledWith('cargo.import', { resource: 'metals.t1', amount: 500 });

    // Offline hub disables confirm and computeTransferBounds returns maxAmount = 0
    state.entities.cols.state[hubRow] = ENTITY_STATE.offlineUnpowered;
    panel.update(view(state) as unknown as GameView);
    const resolvedOffline = resolveTradeHubCargoView(view(state));
    const offlineBounds = computeTransferBounds(resolvedOffline, 'export', 'metals.t1');
    expect(offlineBounds.maxAmount).toBe(0);
    expect(offlineBounds.limitReason).toBe('Trade Hub offline');
    expect(panel.confirm()).toBe(false);
    expect(sendCommand).not.toHaveBeenCalled();

    panel.dispose();
  });
});
