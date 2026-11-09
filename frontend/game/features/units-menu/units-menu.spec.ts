import { parseWaves } from '@terra/contracts';
import {
  createRegistryPipeline,
  createState,
  creditResource,
  enqueueHubUnit,
  ensureColonyLedger,
  ENTITY_KIND,
  ENTITY_STATE,
  insertRow,
  step,
  view,
} from '@terra/sim';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadFeatures } from '../../core/registry';
import type { GameView } from '../../core/registry/types';
import { buildUnitsCatalog, resolveSupply } from './catalog';
import unitsFeature from './index';
import { formatBufferItem } from './UnitsMenu';

class MockElement {
  tagName: string;
  className = '';
  textContent = '';
  type = '';
  disabled = false;
  dataset: Record<string, string> = {};
  private attrs = new Map<string, string>();
  children: MockElement[] = [];
  parentElement: MockElement | null = null;
  onclick?: (e?: unknown) => void;

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  setAttribute(k: string, v: string) {
    this.attrs.set(k, String(v));
    if (k.startsWith('data-')) {
      const prop = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      this.dataset[prop] = String(v);
    }
  }

  getAttribute(k: string): string | null {
    return this.attrs.get(k) ?? null;
  }

  appendChild(child: MockElement): MockElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  append(...items: (MockElement | string)[]) {
    for (const item of items) {
      if (typeof item === 'string') {
        const textNode = new MockElement('span');
        textNode.textContent = item;
        this.appendChild(textNode);
      } else {
        this.appendChild(item);
      }
    }
  }

  replaceChildren(...items: (MockElement | string)[]) {
    this.children = [];
    this.append(...items);
  }

  remove() {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx >= 0) this.parentElement.children.splice(idx, 1);
      this.parentElement = null;
    }
  }

  querySelector(selector: string): MockElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): MockElement[] {
    const res: MockElement[] = [];
    const match = (el: MockElement): boolean => {
      if (selector.startsWith('.')) return el.className.split(/\s+/).includes(selector.slice(1));
      if (selector.startsWith('[')) {
        const attrs = [...selector.matchAll(/\[([^\]=\s]+)(?:=(["']?)([^"'\]]*)\2)?\]/g)];
        const rest = selector.replace(/\[[^\]]*\]/g, '');
        if (attrs.length > 0 && rest === '') {
          return attrs.every((part) => {
            const name = part[1] ?? '';
            if (part[3] === undefined) return el.getAttribute(name) !== null;
            return el.getAttribute(name) === part[3];
          });
        }
      }
      return el.tagName.toLowerCase() === selector.toLowerCase();
    };

    const walk = (el: MockElement) => {
      for (const child of el.children) {
        if (match(child)) res.push(child);
        walk(child);
      }
    };
    walk(this);
    return res;
  }

  click() {
    this.onclick?.();
  }
}

describe('Units Catalog & Helpers', () => {
  it('returns empty catalog when W02 flag is disabled and skips feature', () => {
    const flagsWithoutW02 = new Set(['W00', 'W01']);
    const catalog = buildUnitsCatalog(flagsWithoutW02);
    expect(catalog).toEqual([]);

    const loaded = loadFeatures({ flags: flagsWithoutW02, host: 'server' });
    expect(loaded.some((f) => f.id === 'units-menu')).toBe(false);
  });

  it('reads the T1 worker row when W02 is enabled with correct stats and costs', () => {
    const flags = new Set(['W00', 'W01', 'W02']);
    const catalog = buildUnitsCatalog(flags);

    expect(catalog).toHaveLength(1);
    const [worker] = catalog;
    expect(worker.unit).toBe('worker');
    expect(worker.archetype).toBe('robot.miner');
    expect(worker.label).toBe('Worker Drone T1');
    expect(worker.tier).toBe(1);
    expect(worker.buildS).toBe(10);
    expect(worker.supply).toBe(1);
    expect(worker.powerText).toBe('−2 E/s');
    expect(worker.cost).toEqual({
      'metals.t1': 40,
      'minerals.t1': 15,
      'bio.biomass': 5,
      'bio.water': 0,
    });
    expect(worker.costSummary).toBe('40 Metals · 15 Minerals · 5 Biomass');

    const loaded = loadFeatures({ flags, host: 'server' });
    expect(loaded.some((f) => f.id === 'units-menu')).toBe(true);
  });

  it('formats buffer items correctly for in_progress and waiting states', () => {
    const inProg = formatBufferItem({
      unit: 'worker',
      tier: 1,
      count: 3,
      remainingCount: 3,
      repeat: true,
      state: 'in_progress',
      progress: 0.4,
    });
    expect(inProg).toBe('Worker Drone T1 ×3 ↻ · in_progress 40%');

    const waiting = formatBufferItem({
      unit: 'worker',
      tier: 1,
      count: 1,
      remainingCount: 1,
      repeat: false,
      state: 'waiting',
      waitReason: 'supply',
      waitDetail: 'waiting(supply)',
    });
    expect(waiting).toBe('Worker Drone T1 ×1 · waiting(supply)');
  });

  it('reads the own colony supply the host computed (never counts units itself)', () => {
    expect(resolveSupply(undefined)).toBeNull();
    expect(resolveSupply({ colonies: [{ index: 0 }] } as GameView)).toBeNull();
    const colonies = [
      { index: 0, supply: { used: 3, cap: 10 } },
      { index: 1, supply: { used: 7, units: 6, reserved: 1, cap: 18, available: 11, max: 200, sources: [] } },
    ];
    expect(resolveSupply({ colonies } as GameView)).toMatchObject({ used: 3, cap: 10, units: 3, reserved: 0, available: 7 });
    expect(resolveSupply({ colonies } as GameView, 1)).toMatchObject({ used: 7, units: 6, reserved: 1, cap: 18 });
  });
});

describe('UnitsMenu DOM Component', () => {
  const origDoc = globalThis.document;
  const origWin = globalThis.window;
  const listeners: Record<string, ((e: unknown) => void)[]> = {};

  beforeEach(() => {
    (globalThis as unknown as { document: unknown }).document = { createElement: (tag: string) => new MockElement(tag) };
    (globalThis as unknown as { window: unknown }).window = {
      addEventListener: (type: string, fn: (e: unknown) => void) => {
        listeners[type] = listeners[type] ?? [];
        listeners[type].push(fn);
      },
      removeEventListener: (type: string, fn: (e: unknown) => void) => {
        if (!listeners[type]) return;
        listeners[type] = listeners[type].filter((cb) => cb !== fn);
      },
    };
  });

  afterEach(() => {
    (globalThis as unknown as { document: unknown }).document = origDoc;
    (globalThis as unknown as { window: unknown }).window = origWin;
  });

  it('mounts into el, supports stepper, repeat toggle, keydown shortcut, and menu open', () => {
    const parentEl = new MockElement('div') as unknown as HTMLElement;
    const sendCommand = vi.fn();
    const track = vi.fn();
    const ctx = { flags: new Set(['W00', 'W01', 'W02']), host: 'server' as const, services: { sendCommand, track } };

    const instance = unitsFeature.hud![0].mount(parentEl, ctx);
    const mockParent = parentEl as unknown as MockElement;

    const root = mockParent.querySelector('.ta-units');
    expect(root).not.toBeNull();
    expect(root?.dataset.open).toBe('true');

    const supplyReadout = mockParent.querySelector('[data-supply]');
    expect(supplyReadout?.textContent).toBe('— / —'); // no view yet
    expect(supplyReadout?.getAttribute('data-warning')).toBe('false');

    const workerCard = mockParent.querySelector('[data-unit="worker"][data-tier="1"]');
    expect(workerCard).not.toBeNull();
    const face = workerCard?.querySelector('.ta-card-face');
    expect(face?.querySelector('.ta-units__title')?.textContent).toBe('Worker Drone T1');
    expect(face?.querySelector('.ta-card-tier')?.textContent).toBe('T1');
    expect(face?.querySelector('.ta-card-price')?.textContent).toBe('40 Metals · 15 Minerals');
    expect(face?.querySelector('.ta-card-time')?.textContent).toBe('10s');
    expect(face?.querySelector('.ta-units__time')).toBeNull();
    expect(face?.querySelector('.ta-units__power')).toBeNull();
    expect(face?.querySelector('.ta-card-supply')).toBeNull();
    expect(mockParent.querySelector('[data-testid="prod-tier-t1"]')?.getAttribute('aria-selected')).toBe('true');
    expect(mockParent.querySelector('[data-testid="prod-tier-t2"]')).toBeNull();

    const tip = workerCard?.querySelector('.ta-card-tip');
    expect(tip?.querySelector('.ta-units__time')?.textContent).toBe('10s');
    expect(tip?.querySelector('.ta-units__power')?.textContent).toBe('−2 E/s');
    expect(tip?.querySelector('.ta-card-supply')?.textContent).toBe('Supply 1');
    expect(tip?.querySelector('.ta-card-role')?.textContent).toBe('Harvest, build, and terraform');
    const pills = tip?.querySelectorAll('.ta-units__cost-pill').map((p) => p.textContent);
    expect(pills).toEqual(['40 Metals', '15 Minerals', '5 Biomass']);

    const countReadout = mockParent.querySelector('[data-count]');
    const decBtn = mockParent.querySelector('[data-count-dec]');
    const incBtn = mockParent.querySelector('[data-count-inc]');
    const repeatBtn = mockParent.querySelector('[data-repeat]');

    expect(countReadout?.textContent).toBe('1');
    decBtn?.click();
    expect(countReadout?.textContent).toBe('1');
    incBtn?.click();
    expect(countReadout?.textContent).toBe('2');
    incBtn?.click();
    expect(countReadout?.textContent).toBe('3');

    expect(repeatBtn?.getAttribute('data-repeat')).toBe('false');
    repeatBtn?.click();
    expect(repeatBtn?.getAttribute('data-repeat')).toBe('true');

    const toggleBtn = mockParent.querySelector('.ta-units__toggle');
    toggleBtn?.click();
    expect(root?.dataset.open).toBe('false');
    unitsFeature.menus?.[0].open(ctx);
    expect(root?.dataset.open).toBe('true');

    listeners['keydown']?.[0]?.({ key: 'u' });
    expect(root?.dataset.open).toBe('false');
    listeners['keydown']?.[0]?.({ key: 'U' });
    expect(root?.dataset.open).toBe('true');

    instance.dispose();
    expect(mockParent.children).toHaveLength(0);
  });
});

describe('W08-11: UnitsMenu stage filtering', () => {
  const origDoc = globalThis.document;
  const origWin = globalThis.window;

  beforeEach(() => {
    (globalThis as unknown as { document: unknown }).document = { createElement: (tag: string) => new MockElement(tag) };
    (globalThis as unknown as { window: unknown }).window = { addEventListener: () => {}, removeEventListener: () => {} };
  });

  afterEach(() => {
    (globalThis as unknown as { document: unknown }).document = origDoc;
    (globalThis as unknown as { window: unknown }).window = origWin;
  });

  it('filters units by unlockStage and shows next-stage units greyed out with unlock condition', () => {
    const parentEl = new MockElement('div') as unknown as HTMLElement;
    const sendCommand = vi.fn();
    const track = vi.fn();
    const ctx = {
      flags: new Set(['W00', 'W01', 'W02', 'W08']),
      host: 'server' as const,
      services: { sendCommand, track },
    };

    const instance = unitsFeature.hud![0].mount(parentEl, ctx);
    const mockParent = parentEl as unknown as MockElement;

    instance.update?.({ colonies: [{ stage: 1, unlockStage: 1 }] });
    const workerCard = mockParent.querySelector('[data-unit="worker"][data-tier="1"]');
    expect(workerCard?.getAttribute('data-disabled')).toBe('false');
    expect(mockParent.querySelector('[data-unit="scout"]')).toBeNull();
    expect(mockParent.querySelector('[data-unit="guard"]')).toBeNull();

    // Advance to S2: Scout and Guard appear greyed out with the S3 condition. A locked card does not queue.
    instance.update?.({ colonies: [{ stage: 2, unlockStage: 2 }] });
    for (const s3Unit of ['scout', 'guard']) {
      const card = mockParent.querySelector(`[data-unit="${s3Unit}"]`);
      expect(card).not.toBeNull();
      expect(card?.getAttribute('data-disabled')).toBe('true');
      expect(card?.querySelector('.ta-units__reason')?.textContent).toBe(
        'Unlocks at S3: 6 buildings + 2nd extractor · 3 min',
      );
    }
    mockParent.querySelector('[data-unit="scout"]')?.click();
    expect(sendCommand).not.toHaveBeenCalled();

    instance.dispose();
  });
});

function setupColonyState(): { state: ReturnType<typeof createState>; colony: ReturnType<typeof ensureColonyLedger> } {
  const state = createState({ planetId: 'p1', planetType: 'temperate', seed: 'w02', radius: 8 });
  const colony = ensureColonyLedger({
    index: 0,
    id: 'col-0',
    name: 'Colony 1',
    color: 0xff6b00,
    status: 'active',
    changedAt: 0,
  });
  state.colonies.push(colony);

  const hubRow = insertRow(state.entities, state.meta.nextEntityId++, 0);
  state.entities.cols.kind[hubRow] = ENTITY_KIND.commandHub;
  state.entities.cols.owner[hubRow] = 0;
  state.entities.cols.q[hubRow] = 0;
  state.entities.cols.r[hubRow] = 0;
  state.entities.cols.footprintW[hubRow] = 3;
  state.entities.cols.footprintD[hubRow] = 3;
  state.entities.cols.hp[hubRow] = 1500;
  state.entities.cols.state[hubRow] = ENTITY_STATE.active;

  creditResource(colony, 'metals.t1', 500, 0);
  creditResource(colony, 'minerals.t1', 500, 0);
  creditResource(colony, 'bio.biomass', 500, 0);

  return { state, colony };
}

function queueThreeWorkers(mockParent: MockElement, sendCommand: ReturnType<typeof vi.fn>): void {
  const incBtn = mockParent.querySelector('[data-count-inc]');
  incBtn?.click();
  incBtn?.click();
  const countReadout = mockParent.querySelector('[data-count]');
  expect(countReadout?.textContent).toBe('3');

  const repeatBtn = mockParent.querySelector('[data-repeat]');
  repeatBtn?.click();
  expect(repeatBtn?.getAttribute('data-repeat')).toBe('true');

  const queueBtn = mockParent.querySelector('[data-queue-tier="1"]');
  queueBtn?.click();

  expect(sendCommand).toHaveBeenCalledWith('enqueueTask', {
    task: { kind: 'buildUnit', unit: 'worker', tier: 1, count: 3, repeat: true },
  });
}

function verifyLoopCycle(
  state: ReturnType<typeof createState>,
  pipeline: ReturnType<typeof createRegistryPipeline>,
  instance: { update?: (v: any) => void },
  mockParent: MockElement,
): void {
  const supplyReadout = mockParent.querySelector('[data-supply]');

  // Advance 50 ticks (10s): 1st Worker Drone spawns, 2 remaining
  step(state, [], 50, pipeline);
  instance.update?.(view(state) as unknown as GameView);
  expect(mockParent.querySelector('.ta-units__buffer-item')?.textContent).toBe('Worker Drone T1 ×2 ↻ · in_progress 0%');
  expect(supplyReadout?.textContent).toBe('2 / 10');

  // Advance another 50 ticks (20s): 2nd Worker Drone spawns, 1 remaining
  step(state, [], 50, pipeline);
  instance.update?.(view(state) as unknown as GameView);
  expect(mockParent.querySelector('.ta-units__buffer-item')?.textContent).toBe('Worker Drone T1 ×1 ↻ · in_progress 0%');
  expect(supplyReadout?.textContent).toBe('3 / 10');

  // Advance 50 more ticks (30s): 3rd Worker Drone spawns and loops!
  step(state, [], 50, pipeline);
  instance.update?.(view(state) as unknown as GameView);
  expect(mockParent.querySelector('.ta-units__buffer-item')?.textContent).toBe('Worker Drone T1 ×3 ↻ · in_progress 0%');
  expect(supplyReadout?.textContent).toBe('4 / 10');
}

describe('W02-24 Acceptance Check', () => {
  const origDoc = globalThis.document;
  const origWin = globalThis.window;

  beforeEach(() => {
    (globalThis as unknown as { document: unknown }).document = { createElement: (tag: string) => new MockElement(tag) };
    (globalThis as unknown as { window: unknown }).window = { addEventListener: () => {}, removeEventListener: () => {} };
  });

  afterEach(() => {
    (globalThis as unknown as { document: unknown }).document = origDoc;
    (globalThis as unknown as { window: unknown }).window = origWin;
  });

  it('queue 3 Worker Drones with repeat -> Hub produces them and loops', () => {
    const { state, colony } = setupColonyState();
    const pipeline = createRegistryPipeline({ flags: parseWaves('..02') });

    const parentEl = new MockElement('div') as unknown as HTMLElement;
    const sendCommand = vi.fn();
    const track = vi.fn();
    const ctx = {
      flags: new Set(['W00', 'W01', 'W02']),
      host: 'server' as const,
      services: {
        sendCommand,
        track,
        enqueueHubUnit: (opts: { unit?: string; tier?: number; count?: number; repeat?: boolean }) => {
          const tier = opts.tier === 2 || opts.tier === 3 ? opts.tier : opts.tier === 1 ? 1 : undefined;
          enqueueHubUnit(state, { colonyIndex: 0, unit: opts.unit, tier, count: opts.count, repeat: opts.repeat });
        },
      },
    };

    const instance = unitsFeature.hud![0].mount(parentEl, ctx);
    const mockParent = parentEl as unknown as MockElement;
    const supplyReadout = mockParent.querySelector('[data-supply]');
    expect(supplyReadout?.textContent).toBe('— / —');
    step(state, [], 1, pipeline); // the supply system writes colony.supply (the Hub's share)
    instance.update?.(view(state) as unknown as GameView);
    expect(supplyReadout?.textContent).toBe('0 / 10');

    queueThreeWorkers(mockParent, sendCommand);
    expect(colony.stock['metals.t1']).toBe(500);
    expect(colony.stock['minerals.t1']).toBe(500);
    expect(colony.stock['bio.biomass']).toBe(500);

    instance.update?.(view(state) as unknown as GameView);
    expect(mockParent.querySelector('.ta-units__buffer-item')?.textContent).toBe('Worker Drone T1 ×3 ↻ · in_progress 0%');
    expect(supplyReadout?.textContent).toBe('1 / 10');

    verifyLoopCycle(state, pipeline, instance, mockParent);
    expect(colony.stock['metals.t1']).toBe(380);

    for (let i = 0; i < 6; i++) {
      const r = insertRow(state.entities, state.meta.nextEntityId++, state.meta.tick);
      state.entities.cols.kind[r] = ENTITY_KIND.worker;
      state.entities.cols.tier[r] = 1;
      state.entities.cols.owner[r] = 0;
      state.entities.cols.hp[r] = 160;
      state.entities.cols.state[r] = ENTITY_STATE.idle;
    }

    step(state, [], 50, pipeline);
    instance.update?.(view(state) as unknown as GameView);
    expect(supplyReadout?.textContent).toBe('10 / 10');
    expect(supplyReadout?.getAttribute('data-warning')).toBe('true');
    expect(supplyReadout?.getAttribute('data-level')).toBe('full');
    expect(mockParent.querySelector('.ta-units__buffer-item')?.textContent).toBe('Worker Drone T1 ×2 ↻ · waiting(supply)');

    // At the cap the QUEUE button is disabled with the reason (the host would reject with supply_cap).
    const card = mockParent.querySelector('[data-unit="worker"][data-tier="1"]');
    expect(card?.getAttribute('data-queue-unit')).toBe('worker');
    expect(card?.getAttribute('data-queue-tier')).toBe('1');
    expect(card?.getAttribute('data-supply-blocked')).toBe('true');
    expect((card as { disabled?: boolean } | null)?.disabled).toBe(true);
    expect(card?.querySelector('[data-supply-reason]')?.textContent).toBe('Supply cap reached — build a Supply Depot');

    instance.dispose();
  });
});
