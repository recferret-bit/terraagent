import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadFeatures } from '../../core/registry';
import { buildConstructionCatalog, type BuildingCardModel } from './catalog';
import constructionFeature from './index';

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

  click() {
    this.onclick?.();
  }
}

describe('buildConstructionCatalog - enabled waves', () => {
  it('has commandHub, metalsExtractor, and solar with correct data when W01 and W02 are on', () => {
    const flags = new Set(['W00', 'W01', 'W02']);
    const catalog = buildConstructionCatalog(flags);

    expect(catalog).toHaveLength(3);
    const [hub, extractor, solar] = catalog;

    expect(hub.building).toBe('commandHub');
    expect(hub.label).toBe('Command Hub');
    expect(hub.footprintText).toBe('3×3');
    expect(hub.designBuildS).toBe(30);
    expect(hub.hqBuildS).toBe(20);
    expect(hub.powerText).toBe('+16 / −7 E/s');
    expect(hub.cost).toEqual({ 'metals.t1': 200, 'minerals.t1': 100, 'bio.biomass': 50, 'bio.water': 50 });
    expect(hub.disabled).toBe(false);

    expect(extractor.building).toBe('metalsExtractor');
    expect(extractor.label).toBe('Resource Extractor');
    expect(extractor.footprintText).toBe('2×2');
    expect(extractor.designBuildS).toBe(14);
    expect(extractor.hqBuildS).toBe(9.3);
    expect(extractor.powerText).toBe('−8 E/s');
    expect(extractor.cost).toEqual({ 'metals.t1': 65, 'minerals.t1': 20, 'bio.biomass': 0, 'bio.water': 10 });
    expect(extractor.disabled).toBe(false);

    expect(solar.building).toBe('solar');
    expect(solar.label).toBe('Solar Collector Array');
    expect(solar.footprintText).toBe('2×2');
    expect(solar.designBuildS).toBe(18);
    expect(solar.hqBuildS).toBe(12);
    expect(solar.powerText).toBe('+13 E/s');
    expect(solar.cost).toEqual({ 'metals.t1': 60, 'minerals.t1': 75, 'bio.biomass': 10, 'bio.water': 5 });
    expect(solar.disabled).toBe(false);
  });
});

describe('buildConstructionCatalog - hubBuilt state', () => {
  it('greys out commandHub with reason Already built while others remain enabled', () => {
    const flags = new Set(['W00', 'W01', 'W02']);

    const catColony = buildConstructionCatalog(flags, { colonies: [{ hubBuilt: true }] });
    expect(catColony[0].disabled).toBe(true);
    expect(catColony[0].disabledReason).toBe('Already built');
    expect(catColony[1].disabled).toBe(false);
    expect(catColony[2].disabled).toBe(false);

    const catShorthand = buildConstructionCatalog(flags, { hubBuilt: true });
    expect(catShorthand[0].disabled).toBe(true);
    expect(catShorthand[0].disabledReason).toBe('Already built');

    const entityBuf = new Float32Array(24);
    entityBuf[1] = 3; // entity 0 is hq
    entityBuf[13] = 4; // entity 1 is commandHub
    const catBuf = buildConstructionCatalog(flags, { entities: entityBuf });
    expect(catBuf[0].disabled).toBe(true);
    expect(catBuf[0].disabledReason).toBe('Already built');
    expect(catBuf[1].disabled).toBe(false);
    expect(catBuf[2].disabled).toBe(false);
  });
});

describe('buildConstructionCatalog - wave filtering', () => {
  it('drops W02 buildings when W02 flag is disabled and loadFeatures skips construction-menu', () => {
    const flagsWithoutW02 = new Set(['W00', 'W01']);
    const catalog = buildConstructionCatalog(flagsWithoutW02);
    expect(catalog.map((c: BuildingCardModel) => c.building)).toEqual(['commandHub']);

    const loaded = loadFeatures({ flags: flagsWithoutW02, host: 'server' });
    expect(loaded.some((f) => f.id === 'construction-menu')).toBe(false);

    const loadedWithW02 = loadFeatures({ flags: new Set(['W00', 'W01', 'W02']), host: 'server' });
    expect(loadedWithW02.some((f) => f.id === 'construction-menu')).toBe(true);
  });

  it('handles stage locking and insufficient resources', () => {
    const flags = new Set(['W00', 'W01', 'W02']);

    const lockedCatalog = buildConstructionCatalog(flags, { colonies: [{ stage: 0 }] });
    expect(lockedCatalog[1].disabled).toBe(true);
    expect(lockedCatalog[1].disabledReason).toBe('Locked');
    expect(lockedCatalog[2].disabled).toBe(true);
    expect(lockedCatalog[2].disabledReason).toBe('Locked');

    const lowStockCatalog = buildConstructionCatalog(flags, {
      colonies: [{ stage: 1, stock: { 'metals.t1': 100, 'minerals.t1': 50, 'bio.biomass': 50, 'bio.water': 50 } }],
    });
    expect(lowStockCatalog[1].disabled).toBe(false);
    expect(lowStockCatalog[2].disabled).toBe(true);
    expect(lowStockCatalog[2].disabledReason).toBe('Insufficient resources');
  });
});

describe('ConstructionMenu DOM HUD Component', () => {
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

  it('mounts into el, displays cards with badges and cost pills, and dispatches startPlacement', () => {
    const parentEl = new MockElement('div') as unknown as HTMLElement;
    const startPlacement = vi.fn();
    const track = vi.fn();
    const ctx = { flags: new Set(['W00', 'W01', 'W02']), host: 'server' as const, services: { startPlacement, track } };

    const instance = constructionFeature.hud![0].mount(parentEl, ctx);
    const mockParent = parentEl as unknown as MockElement;

    expect(mockParent.querySelector('.ta-construction')).not.toBeNull();
    const cardsContainer = mockParent.querySelector('[data-cards]');
    expect(cardsContainer?.children).toHaveLength(3);

    const extractorBtn = mockParent.querySelector('[data-building="metalsExtractor"]');
    expect(extractorBtn?.getAttribute('data-disabled')).toBe('false');
    expect(extractorBtn?.querySelector('.ta-construction__title')?.textContent).toBe('Resource Extractor');
    expect(extractorBtn?.querySelector('.ta-construction__footprint')?.textContent).toBe('2×2');
    expect(extractorBtn?.querySelector('.ta-construction__time')?.textContent).toBe('14s (9.3s HQ)');
    expect(extractorBtn?.querySelector('.ta-construction__power')?.textContent).toBe('−8 E/s');

    const pills = extractorBtn?.querySelectorAll('.ta-construction__cost-pill').map((p) => p.textContent);
    expect(pills).toEqual(['65 Metals', '20 Minerals', '10 Water']);

    extractorBtn?.click();
    expect(startPlacement).toHaveBeenCalledWith('metalsExtractor');

    const hubBtnBefore = mockParent.querySelector('[data-building="commandHub"]');
    const solarBtnBefore = mockParent.querySelector('[data-building="solar"]');
    instance.update?.({ colonies: [{ hubBuilt: true }] });
    const hubBtn = mockParent.querySelector('[data-building="commandHub"]');
    const solarBtnAfter = mockParent.querySelector('[data-building="solar"]');
    expect(hubBtn).toBe(hubBtnBefore);
    expect(solarBtnAfter).toBe(solarBtnBefore);
    expect(hubBtn?.getAttribute('data-disabled')).toBe('true');
    expect(hubBtn?.querySelector('.ta-construction__reason')?.textContent).toBe('Already built');

    const toggleBtn = mockParent.querySelector('.ta-construction__toggle');
    toggleBtn?.click();
    expect(mockParent.querySelector('.ta-construction')?.dataset.open).toBe('false');

    constructionFeature.menus?.[0].open(ctx);
    expect(mockParent.querySelector('.ta-construction')?.dataset.open).toBe('true');

    listeners['keydown']?.[0]?.({ key: 'b' });
    expect(mockParent.querySelector('.ta-construction')?.dataset.open).toBe('false');

    instance.dispose();
    expect(mockParent.children).toHaveLength(0);
  });
});
