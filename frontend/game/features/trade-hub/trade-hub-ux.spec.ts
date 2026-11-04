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
  CARGO_ERROR_MESSAGES,
  extractPendingTransfers,
  formatCargoErrorToast,
  formatCargoRefundToast,
  parseRetryInSeconds,
  resolveTradeHubCargoView,
  TradeHubPanel,
} from './index';

const W10_FLAGS: ReadonlySet<string> = new Set(['W00', 'W01', 'W02', 'W10']);

function isHidden(el: unknown): boolean {
  return Boolean((el as { hidden?: boolean })?.hidden);
}

function createUxFixture(colonyOverrides?: Partial<ColonyState>, hubState: number = ENTITY_STATE.active) {
  const state = createPlanet({ type: 'flat', seed: 'w10-22-ux', radius: 8 });
  const colony: ColonyState = {
    index: 0,
    id: 'col-0',
    name: 'Colony Alpha',
    color: 0xff6a13,
    status: 'active',
    stock: {
      'metals.t1': 900,
      'minerals.t1': 200,
    },
    caps: { metals: 1000, minerals: 1000, bio: 1000 },
    cargo: {
      inOrbit: { 'metals.t1': 300 },
      reservedByFamily: { metals: 0, minerals: 0, bio: 0 },
    },
    changedAt: 0,
    ...colonyOverrides,
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
  state.entities.cols.state[hubRow] = hubState;

  return { state, colony, hubId, hubRow };
}

describe('W10-22 Error Messages, Parsing, and Refund Formatters', () => {
  it('maps every W10-01 error code to player-facing text without blockchain jargon', () => {
    expect(CARGO_ERROR_MESSAGES.no_trade_hub).toBe('Build a Trade Hub to move cargo to orbit.');
    expect(CARGO_ERROR_MESSAGES.hub_offline).toBe('Trade Hub is unpowered.');
    expect(CARGO_ERROR_MESSAGES.insufficient_stock).toBe('Not enough in colony storage.');
    expect(CARGO_ERROR_MESSAGES.insufficient_cargo).toBe('Not enough in orbit.');
    expect(CARGO_ERROR_MESSAGES.storage_full).toBe('Storage is full — build a Supply Depot or free space.');
    expect(CARGO_ERROR_MESSAGES.mint_cap).toBe('Hub throughput or daily mint limit reached.');
  });

  it('parses retry delay in seconds from different detail formats', () => {
    expect(parseRetryInSeconds('retryInS=42')).toBe(42);
    expect(parseRetryInSeconds('Throughput cap reached (250/250/min). Retry in 42s.')).toBe(42);
    expect(parseRetryInSeconds('Throughput limit reached (250 / min) — retry in 42s')).toBe(42);
    expect(parseRetryInSeconds('Daily export cap reached (20000/20000 metals.t1). Retry in 120s.')).toBe(120);
    expect(parseRetryInSeconds('Port throughput reached, next slot in 34 s')).toBe(34);
    expect(parseRetryInSeconds('in 15s')).toBe(15);
    expect(parseRetryInSeconds('Trade Hub is unpowered.')).toBeNull();
    expect(parseRetryInSeconds(undefined)).toBeNull();
  });

  it('formats error toast messages including countdown for mint_cap', () => {
    expect(formatCargoErrorToast('hub_offline')).toBe('Trade Hub is unpowered.');
    expect(formatCargoErrorToast('no_trade_hub')).toBe('Build a Trade Hub to move cargo to orbit.');
    expect(formatCargoErrorToast('insufficient_stock')).toBe('Not enough in colony storage.');
    expect(formatCargoErrorToast('insufficient_cargo')).toBe('Not enough in orbit.');
    expect(formatCargoErrorToast('storage_full')).toBe('Storage is full — build a Supply Depot or free space.');
    expect(formatCargoErrorToast('mint_cap')).toBe('Hub throughput or daily mint limit reached.');

    expect(
      formatCargoErrorToast('mint_cap', 'Throughput limit reached (250 / min) — retry in 42s', 42),
    ).toBe('Throughput limit reached (250 / min) — retry in 42s');

    expect(
      formatCargoErrorToast('mint_cap', 'Throughput limit reached (250 / min) — retry in 42s', 41),
    ).toBe('Throughput limit reached (250 / min) — retry in 41s');

    expect(
      formatCargoErrorToast('mint_cap', 'Daily export limit reached (20,000 / day) — retry in 120s', 120),
    ).toBe('Daily export limit reached (20,000 / day) — retry in 120s');
  });

  it('formats refund toasts matching Demo Story Step 8', () => {
    expect(formatCargoRefundToast(50, 'metals.t1', 'export')).toBe(
      'Orbit transfer failed — 50 Metals T1 returned to stock',
    );
    expect(formatCargoRefundToast(100, 'metals.t1', 'import')).toBe(
      'Colony import failed — 100 Metals T1 remains in orbit',
    );
  });
});

describe('W10-22 Pending Transfers Extraction & Chips', () => {
  let uninstallDom: () => void;

  beforeEach(() => {
    uninstallDom = installMockDocument();
  });

  afterEach(() => {
    uninstallDom();
  });

  it('extracts and deduplicates pending exports and imports from cargo.status and sim state', () => {
    const resolved = resolveTradeHubCargoView({
      cargoStatus: {
        pending: [
          { ref: 'cargo-export:col-0:1', resource: 'metals.t1', amount: 200, direction: 'export' },
        ],
      },
    });

    const rawView = {
      colonies: [
        {
          id: 'col-0',
          cargo: {
            pendingMint: {
              'cargo-export:col-0:1': { ref: 'cargo-export:col-0:1', resource: 'metals.t1', amount: 200 },
              'cargo-export:col-0:2': { ref: 'cargo-export:col-0:2', resource: 'metals.t2', amount: 50 },
            },
            pendingImport: {
              'cargo-import:col-0:1': { ref: 'cargo-import:col-0:1', resource: 'minerals.t1', amount: 100 },
            },
          },
        },
      ],
    };

    const extracted = extractPendingTransfers(resolved, rawView, 0);
    expect(extracted.exports).toHaveLength(2);
    expect(extracted.imports).toHaveLength(1);
    expect(extracted.totalPendingExportsAmount).toBe(250);
    expect(extracted.totalPendingImportsAmount).toBe(100);
  });

  it('renders Loading cargo… and Unloading… chips with testids and directions', () => {
    const { state } = createUxFixture();
    const parentEl = new MockElement('div') as unknown as HTMLElement;
    const ctx: FeatureContext = {
      flags: W10_FLAGS,
      host: 'local',
      services: { track: () => {} },
    };

    const panel = new TradeHubPanel(parentEl, ctx, view(state) as unknown as GameView);
    panel.setOpen(true);

    const mockRoot = panel.root as unknown as MockElement;
    const pendingContainer = mockRoot.querySelector('[data-testid="trade-hub-pending"]')!;
    expect(isHidden(pendingContainer)).toBe(true);

    panel.setCargoStatus({
      colonyId: 'col-0',
      inOrbit: { 'metals.t1': 300 },
      pending: [
        { ref: 'cargo-export:col-0:1', resource: 'metals.t1', amount: 200, direction: 'export' },
        { ref: 'cargo-import:col-0:1', resource: 'metals.t1', amount: 100, direction: 'import' },
      ],
    });

    expect(isHidden(pendingContainer)).toBe(false);

    const exportChip = mockRoot.querySelector('[data-testid="trade-hub-chip-export"]')!;
    expect(isHidden(exportChip)).toBe(false);
    expect(exportChip.getAttribute('data-direction')).toBe('export');
    expect(exportChip.textContent).toContain('Loading cargo…');
    expect(exportChip.textContent).toContain('200 Metals T1');

    const importChip = mockRoot.querySelector('[data-testid="trade-hub-chip-import"]')!;
    expect(isHidden(importChip)).toBe(false);
    expect(importChip.getAttribute('data-direction')).toBe('import');
    expect(importChip.textContent).toContain('Unloading…');
    expect(importChip.textContent).toContain('100 Metals T1');

    panel.dispose();
  });
});

describe('W10-22 Acceptance: Refund Toast and mint_cap Countdown', () => {
  let uninstallDom: () => void;

  beforeEach(() => {
    uninstallDom = installMockDocument();
  });

  afterEach(() => {
    uninstallDom();
  });

  it('acceptance: failed export shows refund toast and stock reflects refunded amount', () => {
    const { state } = createUxFixture();
    const parentEl = new MockElement('div') as unknown as HTMLElement;
    const ctx: FeatureContext = {
      flags: W10_FLAGS,
      host: 'local',
      services: { track: () => {} },
    };

    const panel = new TradeHubPanel(parentEl, ctx, view(state) as unknown as GameView);
    panel.setOpen(true);

    const colony = state.colonies[0]!;
    (colony as Record<string, unknown>).stock = {
      'metals.t1': 900,
      'minerals.t1': 200,
    };
    colony.cargo = {
      inOrbit: { 'metals.t1': 300 },
      reservedByFamily: { metals: 0, minerals: 0, bio: 0 },
      lastEvent: {
        kind: 'refunded',
        direction: 'export',
        ref: 'cargo-export:col-0:1',
        resource: 'metals.t1',
        amount: 50,
        atTick: 120,
      },
    };

    panel.update(view(state) as unknown as GameView);

    const panelToast = panel.root.querySelector('[data-testid="trade-hub-toast"]')!;
    expect(isHidden(panelToast)).toBe(false);
    expect(panelToast.textContent).toBe('Orbit transfer failed — 50 Metals T1 returned to stock');

    const floatingToast = (parentEl as unknown as MockElement).querySelector('[data-testid="cargo-toast"]')!;
    expect(isHidden(floatingToast)).toBe(false);
    expect(floatingToast.textContent).toBe('Orbit transfer failed — 50 Metals T1 returned to stock');

    expect(panel.getResolvedCargoView().stock['metals.t1']).toBe(900);

    panel.dispose();
  });

  it('shows mint_cap rejection toast with countdown updating retryInS', () => {
    vi.useFakeTimers();
    const { state } = createUxFixture();
    const parentEl = new MockElement('div') as unknown as HTMLElement;
    const ctx: FeatureContext = {
      flags: W10_FLAGS,
      host: 'local',
      services: { track: () => {} },
    };

    const panel = new TradeHubPanel(parentEl, ctx, view(state) as unknown as GameView);
    panel.setOpen(true);

    panel.notifyError('mint_cap', 'Throughput limit reached (250 / min) — retry in 42s', 42);

    const panelToast = panel.root.querySelector('[data-testid="trade-hub-toast"]')!;
    expect(isHidden(panelToast)).toBe(false);
    expect(panelToast.getAttribute('data-code')).toBe('mint_cap');
    expect(panelToast.getAttribute('data-retry-in')).toBe('42');
    expect(panelToast.textContent).toBe('Throughput limit reached (250 / min) — retry in 42s');

    const floatingToast = (parentEl as unknown as MockElement).querySelector('[data-testid="cargo-toast"]')!;
    expect(isHidden(floatingToast)).toBe(false);
    expect(floatingToast.getAttribute('data-retry-in')).toBe('42');

    vi.advanceTimersByTime(1000);
    expect(panelToast.getAttribute('data-retry-in')).toBe('41');
    expect(panelToast.textContent).toBe('Throughput limit reached (250 / min) — retry in 41s');
    expect(floatingToast.getAttribute('data-retry-in')).toBe('41');

    vi.advanceTimersByTime(5000);
    expect(panelToast.getAttribute('data-retry-in')).toBe('36');
    expect(panelToast.textContent).toBe('Throughput limit reached (250 / min) — retry in 36s');

    panel.dispose();
    vi.useRealTimers();
  });
});

describe('W10-22 Acceptance: hub_offline and Closed Panel Toast', () => {
  let uninstallDom: () => void;

  beforeEach(() => {
    uninstallDom = installMockDocument();
  });

  afterEach(() => {
    uninstallDom();
  });

  it('hub_offline disables Export/Import form controls and shows Trade Hub is unpowered.', () => {
    const { state } = createUxFixture(undefined, ENTITY_STATE.offlineUnpowered);
    const parentEl = new MockElement('div') as unknown as HTMLElement;
    const ctx: FeatureContext = {
      flags: W10_FLAGS,
      host: 'local',
      services: { track: () => {} },
    };

    const instance = tradeHubFeature.hud![0].mount(parentEl, ctx);
    instance.update?.(view(state) as unknown as GameView);

    const mockParent = parentEl as unknown as MockElement;
    const panelEl = mockParent.querySelector('[data-testid="trade-hub-panel"]')!;
    const panel = ctx.services.getTradeHubPanel!()!;
    panel.setOpen(true);

    const offlineBanner = panelEl.querySelector('[data-testid="trade-hub-offline-banner"]')!;
    expect(isHidden(offlineBanner)).toBe(false);
    expect(offlineBanner.textContent).toBe('Trade Hub is unpowered.');

    const slider = panelEl.querySelector('[data-testid="trade-hub-amount-slider"]') as unknown as {
      disabled: boolean;
      getAttribute(k: string): string | null;
    };
    expect(slider.disabled).toBe(true);
    expect(slider.getAttribute('data-disabled-reason')).toBe('hub_offline');

    const input = panelEl.querySelector('[data-testid="trade-hub-amount-input"]') as unknown as {
      disabled: boolean;
      getAttribute(k: string): string | null;
    };
    expect(input.disabled).toBe(true);
    expect(input.getAttribute('data-disabled-reason')).toBe('hub_offline');

    const confirmBtn = panelEl.querySelector('[data-testid="trade-hub-confirm"]') as unknown as {
      disabled: boolean;
      getAttribute(k: string): string | null;
    };
    expect(confirmBtn.disabled).toBe(true);
    expect(confirmBtn.getAttribute('data-disabled-reason')).toBe('hub_offline');

    instance.dispose();
  });

  it('floating cargo-toast is visible even when the panel is closed', () => {
    const { state } = createUxFixture();
    const parentEl = new MockElement('div') as unknown as HTMLElement;
    const ctx: FeatureContext = {
      flags: W10_FLAGS,
      host: 'local',
      services: { track: () => {} },
    };

    const panel = new TradeHubPanel(parentEl, ctx, view(state) as unknown as GameView);
    panel.setOpen(false);

    expect(panel.root.getAttribute('data-open')).toBe('false');

    panel.notifyError('insufficient_stock');

    const floatingToast = (parentEl as unknown as MockElement).querySelector('[data-testid="cargo-toast"]')!;
    expect(isHidden(floatingToast)).toBe(false);
    expect(floatingToast.textContent).toBe('Not enough in colony storage.');

    floatingToast.click();
    expect(isHidden(floatingToast)).toBe(true);

    panel.dispose();
  });
});
