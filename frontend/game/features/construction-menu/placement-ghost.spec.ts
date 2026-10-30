import { DEPOSIT, PREP, TERRAIN, hexCount, hexIndex } from '@terra/sim';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConstructionMenu } from './ConstructionMenu';
import { evaluatePlacementGhost } from './PlacementGhost';

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

  removeAttribute(k: string) {
    this.attrs.delete(k);
    if (k.startsWith('data-')) {
      const prop = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      delete this.dataset[prop];
    }
  }

  appendChild(child: MockElement): MockElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  insertBefore(child: MockElement, ref: MockElement | null): MockElement {
    child.parentElement = this;
    const idx = ref ? this.children.indexOf(ref) : -1;
    if (idx >= 0) {
      this.children.splice(idx, 0, child);
    } else {
      this.children.push(child);
    }
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
      if (selector.startsWith('[') && selector.endsWith(']')) {
        const inside = selector.slice(1, -1);
        if (inside.includes('=')) {
          const [k, rawV] = inside.split('=');
          const v = rawV.replace(/^["']|["']$/g, '');
          return el.getAttribute(k) === v;
        }
        return el.getAttribute(inside) !== null;
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

  closest(selector: string): MockElement | null {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let cur: MockElement | null = this;
    while (cur) {
      if (selector.startsWith('.') && cur.className.split(/\s+/).includes(selector.slice(1))) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  click() {
    this.onclick?.({ stopPropagation: () => {} });
  }
}

function createPlanetView(radius = 3) {
  const count = hexCount(radius);
  const terrain = new Uint8Array(count);
  const prep = new Uint8Array(count);
  const deposit = new Uint8Array(count);
  const height = new Float32Array(count);
  const owner = new Int8Array(count);

  return {
    radius,
    hIndex: hexIndex(radius),
    view: {
      planet: { id: 'test', type: 'desert' as const, radius },
      tiles: { count, terrain, prep, deposit, height, owner },
    },
    setTile(q: number, r: number, patch: { terrain?: number; prep?: number; deposit?: number }) {
      const idx = hexIndex(radius).indexOf(q, r);
      if (idx >= 0) {
        if (patch.terrain !== undefined) terrain[idx] = patch.terrain;
        if (patch.prep !== undefined) prep[idx] = patch.prep;
        if (patch.deposit !== undefined) deposit[idx] = patch.deposit;
      }
    },
  };
}

const DEFAULT_FLAGS = new Set(['W00', 'W01', 'W02']);

describe('evaluatePlacementGhost - terrain & bounds', () => {
  it('detects out of bounds tiles', () => {
    const { view } = createPlanetView(2);
    const ghost = evaluatePlacementGhost({
      building: 'solar',
      q: 10,
      r: 10,
      rotation: 0,
      flags: DEFAULT_FLAGS,
      view,
    });
    expect(ghost.valid).toBe(false);
    expect(ghost.statusColor).toBe('red');
    expect(ghost.reason).toBe('out of bounds');
  });

  it('detects impassable terrain (deep water, ridge, moat)', () => {
    const { view, setTile } = createPlanetView(3);
    setTile(0, 0, { terrain: TERRAIN.deep });

    const ghostDeep = evaluatePlacementGhost({
      building: 'solar',
      q: 0,
      r: 0,
      rotation: 0,
      flags: DEFAULT_FLAGS,
      view,
    });
    expect(ghostDeep.valid).toBe(false);
    expect(ghostDeep.statusColor).toBe('red');
    expect(ghostDeep.reason).toBe('impassable terrain');

    setTile(0, 0, { terrain: TERRAIN.flat, prep: PREP.ridge });
    const ghostRidge = evaluatePlacementGhost({
      building: 'solar',
      q: 0,
      r: 0,
      rotation: 0,
      flags: DEFAULT_FLAGS,
      view,
    });
    expect(ghostRidge.valid).toBe(false);
    expect(ghostRidge.statusColor).toBe('red');
    expect(ghostRidge.reason).toBe('impassable terrain');
  });
});

describe('evaluatePlacementGhost - metals deposit coverage', () => {
  it('validates metals deposit coverage for Metals Extractor', () => {
    const { view, setTile, hIndex } = createPlanetView(3);

    const ghostOff = evaluatePlacementGhost({
      building: 'metalsExtractor',
      q: 0,
      r: 0,
      rotation: 0,
      flags: DEFAULT_FLAGS,
      view,
    });
    expect(ghostOff.valid).toBe(false);
    expect(ghostOff.statusColor).toBe('red');
    expect(ghostOff.reason).toBe('must cover a metals deposit');
    expect(ghostOff.depositCovered).toBe(false);
    expect(ghostOff.depositTileIndices).toEqual([]);

    setTile(1, 1, { deposit: DEPOSIT.metals });
    const ghostOn = evaluatePlacementGhost({
      building: 'metalsExtractor',
      q: 0,
      r: 0,
      rotation: 0,
      flags: DEFAULT_FLAGS,
      view,
    });
    expect(ghostOn.valid).toBe(true);
    expect(ghostOn.statusColor).toBe('green');
    expect(ghostOn.reason).toBe('valid site');
    expect(ghostOn.depositCovered).toBe(true);
    expect(ghostOn.depositTileIndices).toEqual([hIndex.indexOf(1, 1)]);
  });
});

describe('evaluatePlacementGhost - prep bill & rotation', () => {
  it('computes prep bill for forest, rock, slope, flat, and prepared tiles', () => {
    const { view, setTile } = createPlanetView(3);
    setTile(0, 0, { terrain: TERRAIN.forest, prep: PREP.wild });
    setTile(1, 0, { terrain: TERRAIN.rock, prep: PREP.wild });
    setTile(0, 1, { terrain: TERRAIN.slope, prep: PREP.wild });
    setTile(1, 1, { terrain: TERRAIN.flat, prep: PREP.prepared });

    const ghost = evaluatePlacementGhost({
      building: 'solar',
      q: 0,
      r: 0,
      rotation: 0,
      flags: DEFAULT_FLAGS,
      view,
    });
    expect(ghost.prepBill).toEqual({
      'clear + prepare': 1,
      'break + prepare': 1,
      'flatten + prepare': 1,
    });
    expect(ghost.prepBillText).toBe('Prep: 1× Clear + Prepare, 1× Break + Prepare, 1× Flatten + Prepare');

    setTile(0, 0, { terrain: TERRAIN.forest, prep: PREP.prepared });
    setTile(1, 0, { terrain: TERRAIN.rock, prep: PREP.living });
    setTile(0, 1, { terrain: TERRAIN.slope, prep: PREP.prepared });

    const ghostPrepared = evaluatePlacementGhost({
      building: 'solar',
      q: 0,
      r: 0,
      rotation: 0,
      flags: DEFAULT_FLAGS,
      view,
    });
    expect(ghostPrepared.prepBill).toEqual({});
    expect(ghostPrepared.prepBillText).toBe('Site prepared');
  });

  it('swaps footprint dimensions when rotation is odd', () => {
    const { view } = createPlanetView(5);
    const hubRot0 = evaluatePlacementGhost({ building: 'commandHub', q: 0, r: 0, rotation: 0, flags: DEFAULT_FLAGS, view });
    const hubRot1 = evaluatePlacementGhost({ building: 'commandHub', q: 0, r: 0, rotation: 1, flags: DEFAULT_FLAGS, view });
    expect(hubRot0.footprintW).toBe(3);
    expect(hubRot0.footprintD).toBe(3);
    expect(hubRot1.footprintW).toBe(3);
    expect(hubRot1.footprintD).toBe(3);

    const r0 = evaluatePlacementGhost({ building: 'solar', q: 0, r: 0, rotation: 0, flags: DEFAULT_FLAGS, view });
    const r1 = evaluatePlacementGhost({ building: 'solar', q: 0, r: 0, rotation: 1, flags: DEFAULT_FLAGS, view });
    expect(r0.rotation).toBe(0);
    expect(r1.rotation).toBe(1);
  });
});

function setupMockDom() {
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  const origDoc = globalThis.document;
  const origWin = globalThis.window;
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
  return {
    listeners,
    restore: () => {
      (globalThis as unknown as { document: unknown }).document = origDoc;
      (globalThis as unknown as { window: unknown }).window = origWin;
    },
  };
}

describe('PlacementGhostController - selection & placement', () => {
  let dom: ReturnType<typeof setupMockDom>;
  beforeEach(() => { dom = setupMockDom(); });
  afterEach(() => { dom.restore(); });

  it('selects Metals Extractor and displays "must cover a metals deposit" when off deposit', () => {
    const { view, setTile } = createPlanetView(3);
    setTile(1, 1, { deposit: DEPOSIT.metals });

    const parentEl = new MockElement('div') as unknown as HTMLElement;
    const sendCommand = vi.fn().mockResolvedValue({ ok: true, appliedAtTick: 1 });
    const ctx = {
      flags: DEFAULT_FLAGS,
      host: 'server' as const,
      services: { sendCommand, track: vi.fn() },
    };

    const menu = new ConstructionMenu(parentEl, ctx, view);
    const mockParent = parentEl as unknown as MockElement;

    menu.startPlacement('metalsExtractor');
    menu.setHoverTile(-1, -1);

    const ghostState = menu.getGhostState();
    expect(ghostState).not.toBeNull();
    expect(ghostState?.valid).toBe(false);
    expect(ghostState?.statusColor).toBe('red');
    expect(ghostState?.reason).toBe('must cover a metals deposit');
    expect(ghostState?.depositCovered).toBe(false);

    const ghostEl = mockParent.querySelector('.ta-placement-ghost');
    expect(ghostEl).not.toBeNull();
    expect(ghostEl?.getAttribute('data-valid')).toBe('false');
    expect(ghostEl?.getAttribute('data-color')).toBe('red');
    expect(ghostEl?.getAttribute('data-deposit-covered')).toBe('false');
    expect(ghostEl?.querySelector('.ta-placement-ghost__reason')?.textContent).toBe('must cover a metals deposit');
    expect(ghostEl?.querySelector('.ta-placement-ghost__deposit')?.textContent).toBe('must cover a metals deposit');

    const confirmResult = menu.confirm();
    expect(confirmResult).toBe(false);
    expect(sendCommand).not.toHaveBeenCalled();

    menu.setHoverTile(0, 0);
    const validGhost = menu.getGhostState();
    expect(validGhost?.valid).toBe(true);
    expect(validGhost?.statusColor).toBe('green');
    expect(validGhost?.depositCovered).toBe(true);
    expect(ghostEl?.getAttribute('data-valid')).toBe('true');
    expect(ghostEl?.getAttribute('data-color')).toBe('green');
    expect(ghostEl?.getAttribute('data-deposit-covered')).toBe('true');
    expect(ghostEl?.querySelector('.ta-placement-ghost__deposit')?.textContent).toBe('Deposit covered ✔');

    const ghostKeydown = dom.listeners['keydown']?.[1];
    ghostKeydown?.({ key: 'r', preventDefault: vi.fn() });
    expect(menu.getGhostState()?.rotation).toBe(1);
    expect(ghostEl?.querySelector('.ta-placement-ghost__footprint')?.textContent).toContain('rot 1 [R]');

    const ok = menu.confirm();
    expect(ok).toBe(true);
    expect(sendCommand).toHaveBeenCalledWith('enqueueTask', {
      task: {
        kind: 'build',
        building: 'metalsExtractor',
        q: 0,
        r: 0,
        rotation: 1,
      },
    });
    expect(menu.selectedBuilding).toBeNull();
    expect(menu.getGhostState()).toBeNull();
    expect(mockParent.querySelector('.ta-placement-ghost')).toBeNull();

    menu.dispose();
  });
});

describe('PlacementGhostController - cancellation', () => {
  let dom: ReturnType<typeof setupMockDom>;
  beforeEach(() => { dom = setupMockDom(); });
  afterEach(() => { dom.restore(); });

  it('cancels placement on Escape or right-click', () => {
    const { view } = createPlanetView(3);
    const parentEl = new MockElement('div') as unknown as HTMLElement;
    const ctx = { flags: DEFAULT_FLAGS, host: 'server' as const, services: { track: vi.fn() } };

    const menu = new ConstructionMenu(parentEl, ctx, view);
    const mockParent = parentEl as unknown as MockElement;

    menu.startPlacement('solar');
    expect(mockParent.querySelector('.ta-placement-ghost')).not.toBeNull();

    const ghostKeydown = dom.listeners['keydown']?.[1];
    ghostKeydown?.({ key: 'Escape', preventDefault: vi.fn() });
    expect(mockParent.querySelector('.ta-placement-ghost')).toBeNull();
    expect(menu.selectedBuilding).toBeNull();

    menu.startPlacement('solar');
    expect(mockParent.querySelector('.ta-placement-ghost')).not.toBeNull();
    dom.listeners['contextmenu']?.[0]?.({ preventDefault: vi.fn() });
    expect(mockParent.querySelector('.ta-placement-ghost')).toBeNull();

    menu.dispose();
  });
});
