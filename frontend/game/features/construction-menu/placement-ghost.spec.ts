import { DEPOSIT, ENTITY_KIND, PREP, TERRAIN, hexCount, hexIndex } from '@terra/sim';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConstructionMenu } from './ConstructionMenu';
import { evaluatePlacementGhost } from './PlacementGhost';
import { E, ENTITY_STRIDE } from '../../store/replica/viewCodec';

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
    const ghost = evaluatePlacementGhost({ building: 'solar', q: 10, r: 10, rotation: 0, flags: DEFAULT_FLAGS, view });
    expect(ghost.valid).toBe(false);
    expect(ghost.statusColor).toBe('red');
    expect(ghost.reason).toBe('outside the map'); // the shared sim text (D-37)
  });

  it('detects impassable terrain (deep water, ridge, moat)', () => {
    const { view, setTile } = createPlanetView(3);
    setTile(0, 0, { terrain: TERRAIN.deep });

    const ghostDeep = evaluatePlacementGhost({ building: 'solar', q: 0, r: 0, rotation: 0, flags: DEFAULT_FLAGS, view });
    expect(ghostDeep.valid).toBe(false);
    expect(ghostDeep.statusColor).toBe('red');
    expect(ghostDeep.reason).toBe('water');

    setTile(0, 0, { terrain: TERRAIN.flat, prep: PREP.ridge });
    const ghostRidge = evaluatePlacementGhost({ building: 'solar', q: 0, r: 0, rotation: 0, flags: DEFAULT_FLAGS, view });
    expect(ghostRidge.valid).toBe(false);
    expect(ghostRidge.statusColor).toBe('red');
    expect(ghostRidge.reason).toBe('ridge / moat');
  });
});

describe('evaluatePlacementGhost - the host rule decides (D-37, evaluatePlacement)', () => {
  it('a Solar on a deposit tile and a site in foreign territory are red, as the server rejects them', () => {
    const { view, setTile, hIndex } = createPlanetView(3);
    setTile(1, 0, { deposit: DEPOSIT.metals });
    const onDeposit = evaluatePlacementGhost({ building: 'solar', q: 0, r: 0, rotation: 0, flags: DEFAULT_FLAGS, view });
    expect([onDeposit.valid, onDeposit.statusColor]).toEqual([false, 'red']);

    setTile(1, 0, { deposit: DEPOSIT.none });
    for (const [q, r] of [[0, 0], [1, 0], [0, 1], [1, 1]]) view.tiles.owner[hIndex.indexOf(q, r)] = 1; // colony 1's ground
    const foreign = evaluatePlacementGhost({ building: 'solar', q: 0, r: 0, rotation: 0, flags: DEFAULT_FLAGS, view, colonyId: 0 });
    expect([foreign.valid, foreign.reason]).toEqual([false, 'not your territory']);
    const own = evaluatePlacementGhost({ building: 'solar', q: 0, r: 0, rotation: 0, flags: DEFAULT_FLAGS, view, colonyId: 1 });
    expect([own.valid, own.reason]).toEqual([true, 'valid site']);
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
    expect(ghostOff.reason).toBe('must cover a metals or minerals deposit');
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
  it('refuses un-terraformed ground (trees, rock, slope, hole, water): red, with the reason, never a prep bill', () => {
    const cases: Array<[number, string]> = [
      [TERRAIN.forest, 'trees: clear them first'],
      [TERRAIN.rock, 'rock: break it first'],
      [TERRAIN.slope, 'slope'],
      [TERRAIN.hole, 'hole'],
      [TERRAIN.shallow, 'water'],
    ];
    for (const [terrain, reason] of cases) {
      const { view, setTile } = createPlanetView(3);
      setTile(1, 1, { terrain, prep: PREP.wild });
      const ghost = evaluatePlacementGhost({ building: 'solar', q: 0, r: 0, rotation: 0, flags: DEFAULT_FLAGS, view });
      expect(ghost.valid, `terrain ${terrain}`).toBe(false);
      expect(ghost.statusColor).toBe('red');
      expect(ghost.reason).toBe(reason);
      expect(Object.keys(ghost.prepBill)).toEqual(['prepare']);
    }
  });

  it('bills a plain Grade for flat ground and nothing for prepared ground', () => {
    const { view, setTile } = createPlanetView(3);
    setTile(0, 0, { terrain: TERRAIN.flat, prep: PREP.wild });
    setTile(1, 1, { terrain: TERRAIN.flat, prep: PREP.prepared });
    const ghost = evaluatePlacementGhost({ building: 'solar', q: 0, r: 0, rotation: 0, flags: DEFAULT_FLAGS, view });
    expect(ghost.valid).toBe(true);
    expect(ghost.prepBill).toEqual({ prepare: 3 });

    setTile(0, 0, { terrain: TERRAIN.flat, prep: PREP.prepared });
    setTile(1, 0, { terrain: TERRAIN.flat, prep: PREP.living });
    setTile(0, 1, { terrain: TERRAIN.flat, prep: PREP.prepared });
    const ghostPrepared = evaluatePlacementGhost({ building: 'solar', q: 0, r: 0, rotation: 0, flags: DEFAULT_FLAGS, view });
    expect(ghostPrepared.valid).toBe(true);
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

  it('selects Metals Extractor and displays "must cover a metals or minerals deposit" when off deposit', () => {
    const { view, setTile } = createPlanetView(3);
    setTile(1, 1, { deposit: DEPOSIT.metals });

    const parentEl = new MockElement('div') as unknown as HTMLElement;
    const sendCommand = vi.fn().mockResolvedValue({ ok: true, appliedAtTick: 1 });
    const showToast = vi.fn();
    const ctx = {
      flags: DEFAULT_FLAGS,
      host: 'server' as const,
      services: { sendCommand, track: vi.fn(), hudMin: { showToast } as any },
    };

    const menu = new ConstructionMenu(parentEl, ctx, view);
    const mockParent = parentEl as unknown as MockElement;

    menu.startPlacement('metalsExtractor');
    menu.setHoverTile(-1, -1);

    const ghostState = menu.getGhostState();
    expect(ghostState).not.toBeNull();
    expect(ghostState?.valid).toBe(false);
    expect(ghostState?.statusColor).toBe('red');
    expect(ghostState?.reason).toBe('must cover a metals or minerals deposit');
    expect(ghostState?.depositCovered).toBe(false);

    const ghostEl = mockParent.querySelector('.ta-placement-ghost');
    expect(ghostEl).not.toBeNull();
    expect(ghostEl?.getAttribute('data-valid')).toBe('false');
    expect(ghostEl?.getAttribute('data-color')).toBe('red');
    expect(ghostEl?.getAttribute('data-deposit-covered')).toBe('false');
    expect(ghostEl?.querySelector('.ta-placement-ghost__reason')?.textContent).toBe('must cover a metals or minerals deposit');
    expect(ghostEl?.querySelector('.ta-placement-ghost__deposit')?.textContent).toBe('must cover a metals or minerals deposit');

    const confirmResult = menu.confirm();
    expect(confirmResult).toBe(false);
    expect(showToast).toHaveBeenCalledWith('Cannot build here: must cover a metals or minerals deposit', 'warning', 5000, 'placement-invalid');
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

  it('rejects occupied tiles and snaps initial Solar and Metals Extractor ghosts to valid sites', () => {
    const { view, setTile } = createPlanetView(5);
    setTile(3, 0, { deposit: DEPOSIT.metals });
    const entities = new Float32Array(ENTITY_STRIDE);
    entities[E.id] = 1;
    entities[E.kind] = ENTITY_KIND.commandHub;
    entities[E.hp] = 500;
    entities[E.hpMax] = 500;
    const viewWithHub = { ...view, entities, count: 1 };

    const blockedAtHub = evaluatePlacementGhost({
      building: 'solar',
      q: 0,
      r: 0,
      rotation: 0,
      flags: DEFAULT_FLAGS,
      view: viewWithHub,
    });
    expect(blockedAtHub.valid).toBe(false);
    expect(blockedAtHub.reason).toBe('tile occupied');

    const parentEl = new MockElement('div') as unknown as HTMLElement;
    const sendCommand = vi.fn().mockResolvedValue({ ok: true, appliedAtTick: 1 });
    const ctx = { flags: DEFAULT_FLAGS, host: 'server' as const, services: { sendCommand, track: vi.fn() } };
    const menu = new ConstructionMenu(parentEl, ctx, viewWithHub);

    menu.startPlacement('solar');
    const solarGhost = menu.getGhostState();
    expect(solarGhost?.valid).toBe(true);
    expect(solarGhost?.q === 0 && solarGhost?.r === 0).toBe(false);
    expect(menu.confirm()).toBe(true);

    menu.startPlacement('metalsExtractor');
    const extGhost = menu.getGhostState();
    expect(extGhost?.valid).toBe(true);
    expect(extGhost?.depositCovered).toBe(true);
    expect([extGhost?.q, extGhost?.r]).toEqual([3, 0]);

    menu.dispose();
  });
});

describe('PlacementGhostController - tradeHub', () => {
  let dom: ReturnType<typeof setupMockDom>;
  beforeEach(() => { dom = setupMockDom(); });
  afterEach(() => { dom.restore(); });

  it('activates a 2x2 ghost footprint with prep bill when placing tradeHub', () => {
    const { view, setTile } = createPlanetView(4);
    setTile(0, 0, { terrain: TERRAIN.flat, prep: PREP.prepared });
    setTile(1, 0, { terrain: TERRAIN.flat, prep: PREP.wild });
    setTile(0, 1, { terrain: TERRAIN.flat, prep: PREP.wild });
    setTile(1, 1, { terrain: TERRAIN.flat, prep: PREP.wild });

    const flagsW10 = new Set(['W00', 'W01', 'W02', 'W10']);
    const parentEl = new MockElement('div') as unknown as HTMLElement;
    const sendCommand = vi.fn().mockResolvedValue({ ok: true, appliedAtTick: 1 });
    const ctx = { flags: flagsW10, host: 'server' as const, services: { sendCommand, track: vi.fn() } };
    const menu = new ConstructionMenu(parentEl, ctx, view);

    menu.startPlacement('tradeHub');
    menu.setHoverTile(0, 0);
    const ghost = menu.getGhostState();
    expect(ghost?.building).toBe('tradeHub');
    expect(ghost?.label).toBe('Inter-Colony Trade Hub');
    expect(ghost?.footprintText).toBe('2×2');
    expect(ghost?.tiles).toHaveLength(4);
    expect(ghost?.valid).toBe(true);
    expect(ghost?.prepBill).toEqual({ prepare: 3 });
    expect(ghost?.prepBillText).toBe('Prep: 3× Prepare');

    expect(menu.confirm()).toBe(true);
    expect(sendCommand).toHaveBeenCalledWith('enqueueTask', {
      task: { kind: 'build', building: 'tradeHub', q: 0, r: 0, rotation: 0 },
    });

    menu.dispose();
  });
});
