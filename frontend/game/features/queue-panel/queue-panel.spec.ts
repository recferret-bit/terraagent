import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  ENTITY_KIND,
  ENTITY_STATE,
  createState,
  creditResource,
  ensureColonyLedger,
  insertRow,
} from '@terra/sim';
import type { QueueEntry } from '@terra/sim';
import type { FeatureContext, GameView } from '../../core/registry/types';
import { installMockDocument } from '../test-dom';
import { QueuePanel, STORAGE_HINT_TEXT } from './QueuePanel';

function makeContext(): { ctx: FeatureContext; commands: Array<{ kind: string; args: unknown }> } {
  const commands: Array<{ kind: string; args: unknown }> = [];
  const ctx: FeatureContext = {
    flags: new Set(parseWaves('..02').list),
    host: 'server',
    services: {
      track: () => {},
      async sendCommand(kind: string, args?: unknown) {
        commands.push({ kind, args });
        return { ok: true as const, appliedAtTick: 1 };
      },
    },
  };
  return { ctx, commands };
}

describe('W02-25 Queue panel UI — Construction & Units lanes, ETA chip, cancel, reorder, collapsed mode', () => {
  let restoreDoc: (() => void) | null = null;

  beforeEach(() => {
    restoreDoc = installMockDocument();
  });

  afterEach(() => {
    restoreDoc?.();
    restoreDoc = null;
  });

  it('queue a Solar short on Minerals -> chip shows waiting: Minerals 5/20 · ~30 s; click cancel -> removed with no cost paid', () => {
    const state = createState({ planetId: 'p1', planetType: 'temperate', seed: 'w02', radius: 8 });
    const colony = ensureColonyLedger({
      index: 0,
      id: 'col-0',
      name: 'Alpha',
      color: 0xff6b00,
      status: 'active',
      changedAt: 0,
    });
    state.colonies.push(colony);

    // 1 Worker Drone providing income
    const hRow = insertRow(state.entities, 10, 0);
    state.entities.cols.kind[hRow] = ENTITY_KIND.worker;
    state.entities.cols.tier[hRow] = 1;
    state.entities.cols.owner[hRow] = 0;
    state.entities.cols.state[hRow] = ENTITY_STATE.idle;

    // Seed colony with 100 Metals, 0 Minerals, 20 Biomass, 10 Water
    creditResource(colony, 'metals.t1', 100, 0);
    creditResource(colony, 'minerals.t1', 0, 0);
    creditResource(colony, 'bio.biomass', 20, 0);
    creditResource(colony, 'bio.water', 10, 0);

    const host = document.createElement('div');
    const { ctx, commands } = makeContext();
    const panel = new QueuePanel(host, ctx);
    panel.bindSimState(state, 0);

    // Queue Solar short on Minerals (needs 20 Minerals, has 0 -> missing 20 @ 0.5/s = 40s)
    const entry = panel.enqueue({
      taskId: 'solar-short',
      costOverride: { 'metals.t1': 60, 'minerals.t1': 20, 'bio.biomass': 10, 'bio.water': 5 },
      task: { kind: 'build', building: 'solar', q: 2, r: 1 },
    });
    expect(entry).not.toBeNull();

    const chip = host.querySelector('[data-task-id="solar-short"]') as HTMLElement | null;
    expect(chip).not.toBeNull();
    expect(chip?.dataset.state).toBe('waiting');
    const statusEl = chip?.querySelector('[data-chip-status]') as HTMLElement | null;
    expect(statusEl?.textContent).toBe('waiting: Minerals 0/20 · ~40 s');

    // Click cancel -> removed with no cost paid (stock unchanged: 100 Metals, 0 Minerals)
    const cancelBtn = chip?.querySelector('[data-cancel-task="solar-short"]') as HTMLButtonElement | null;
    expect(cancelBtn).not.toBeNull();
    cancelBtn?.click();

    expect(host.querySelector('[data-task-id="solar-short"]')).toBeNull();
    expect(colony.stock['metals.t1']).toBe(100);
    expect(colony.stock['minerals.t1']).toBe(0);
    expect(commands).toContainEqual({ kind: 'cancelTask', args: { taskId: 'solar-short', scope: 'sameKind' } });

    panel.dispose();
  });
});

describe('W02-25 Queue panel UI — lanes, progress, reorder, and collapsed mode', () => {
  let restoreDoc: (() => void) | null = null;

  beforeEach(() => {
    restoreDoc = installMockDocument();
  });

  afterEach(() => {
    restoreDoc?.();
    restoreDoc = null;
  });

  it('renders Construction and Units lanes, progress %, reorder buttons, and collapsed mode', () => {
    const state = createState({ planetId: 'p1', planetType: 'temperate', seed: 'w02', radius: 8 });
    const colony = ensureColonyLedger({
      index: 0,
      id: 'col-0',
      name: 'Alpha',
      color: 0xff6b00,
      status: 'active',
      changedAt: 0,
    });
    state.colonies.push(colony);

    // Give enough stock for 1 Solar to start in_progress, second Solar waiting, plus 1 Worker Drone in the units lane
    creditResource(colony, 'metals.t1', 60, 0);
    creditResource(colony, 'minerals.t1', 75, 0);
    creditResource(colony, 'bio.biomass', 10, 0);
    creditResource(colony, 'bio.water', 5, 0);

    const host = document.createElement('div');
    const { ctx, commands } = makeContext();
    const panel = new QueuePanel(host, ctx);
    panel.bindSimState(state, 0);

    panel.enqueue({ taskId: 'c-1', task: { kind: 'build', building: 'solar', q: 2, r: 1 } });
    // a second Solar (an Extractor needs a metals deposit under its footprint, which this blank planet has none of)
    panel.enqueue({ taskId: 'c-2', task: { kind: 'build', building: 'solar', q: 4, r: 1 } });
    panel.enqueue({ taskId: 'u-1', task: { kind: 'buildUnit', unit: 'worker', tier: 1 } });

    const cLane = host.querySelector('[data-lane="construction"]');
    const uLane = host.querySelector('[data-lane="units"]');
    const cChips = cLane?.querySelectorAll('.ta-queue-chip') ?? [];
    const uChips = uLane?.querySelectorAll('.ta-queue-chip') ?? [];
    expect(cChips.length).toBe(2);
    expect(uChips.length).toBe(1);
    expect((cChips[0] as HTMLElement).dataset.state).toBe('in_progress');

    // Reorder c-2 up to index 0
    const upBtn = cChips[1].querySelector('[data-reorder-up="c-2"]') as HTMLButtonElement | null;
    expect(upBtn).not.toBeNull();
    upBtn?.click();
    expect(commands).toContainEqual({ kind: 'reorderTask', args: { taskId: 'c-2', toIndex: 0 } });
    expect(panel.getEntries('construction').map((e) => e.taskId)).toEqual(['c-2', 'c-1']);

    // Collapsed mode toggle
    const collapseBtn = host.querySelector('[data-queue-collapse]') as HTMLButtonElement | null;
    collapseBtn?.click();
    expect(panel.isCollapsed()).toBe(true);
    expect(collapseBtn?.textContent).toBe('+3 more');

    // Cancel all button is visible when queue has entries and sends cancelTask({ taskId: 'all' })
    const cancelAllBtn = host.querySelector('[data-testid="queue-cancel-all"]') as HTMLButtonElement | null;
    expect(cancelAllBtn).not.toBeNull();
    expect(cancelAllBtn?.hidden).toBe(false);
    expect(cancelAllBtn?.textContent).toBe('CANCEL ALL (50% REFUND)');
    cancelAllBtn?.click();
    expect(commands).toContainEqual({ kind: 'cancelTask', args: { taskId: 'all' } });
    expect(panel.getEntries().length).toBe(0);
    expect(cancelAllBtn?.hidden).toBe(true);

    panel.dispose();
  });
});

describe('W02 demo step 7: waiting(storage) shows a greyed "build a Supply Depot" hint; the panel reads the own colony', () => {
  let restoreDoc: (() => void) | null = null;
  beforeEach(() => {
    restoreDoc = installMockDocument();
  });
  afterEach(() => {
    restoreDoc?.();
    restoreDoc = null;
  });

  const entry = (over: Partial<QueueEntry>): QueueEntry => ({
    taskId: 'sol-cap', colonyIndex: 1, lane: 'construction', precedence: 'player', state: 'waiting',
    task: { kind: 'build', building: 'solar', q: 6, r: 0 } as QueueEntry['task'], cost: { 'metals.t1': 600 }, paid: false,
    progress: 0, buildTicks: 90, elapsedTicks: 0, workRate: 1, createdAt: 0, ...over,
  });

  it('greyed hint on a storage wait only; it goes once the entry waits for something else; seat 1 is read, not colony 0', () => {
    const { ctx } = makeContext();
    (ctx.services as unknown as Record<string, unknown>).landfall = { getOwnerColonyIndex: () => 1 };
    const host = document.createElement('div');
    const panel = new QueuePanel(host, ctx);
    const viewWith = (e: QueueEntry) =>
      ({ colonies: [{ index: 0, queue: [] }, { index: 1, queue: [e] }] }) as unknown as GameView;

    panel.update(viewWith(entry({ waitReason: 'storage', waitDetail: 'waiting: storage (no ETA)' })));
    const chip = host.querySelector('[data-task-id="sol-cap"]') as HTMLElement | null;
    expect(chip).not.toBeNull();
    const hint = chip!.querySelector('[data-testid="queue-storage-hint"]') as HTMLElement | null;
    expect(hint?.textContent).toBe(STORAGE_HINT_TEXT);
    expect(hint?.getAttribute('aria-disabled')).toBe('true');

    panel.update(viewWith(entry({ waitReason: 'resources', waitDetail: 'waiting: Metals 5/600 (no ETA)' })));
    const same = host.querySelector('[data-task-id="sol-cap"]') as HTMLElement;
    expect(same.querySelector('[data-testid="queue-storage-hint"]')).toBeNull();
    panel.dispose();
  });
});
