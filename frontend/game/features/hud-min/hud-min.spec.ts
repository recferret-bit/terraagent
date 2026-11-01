import { describe, expect, it } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  setColonyStock,
  spawnColonyLanding,
  spawnHqUnit,
  type SimCommand,
  type ViewColony,
} from '@terra/sim';
import { HudRoot } from '../../core/hud/HudRoot';
import { loadFeatures } from '../../core/registry';
import { LocalHost } from '../../store/WorldStore';
import type { ClientView } from '../../store/replica/viewCodec';
import { formatClock, formatRejectToast, mountMinimalHud, MinimalHud, wholeStock } from './index';

class FakeElement {
  tagName: string;
  className = '';
  private _textContent = '';
  hidden = false;
  type = '';
  title = '';
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  children: FakeElement[] = [];
  parentElement: FakeElement | null = null;
  onclick: (() => void) | null = null;
  private attrs = new Map<string, string>();

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }

  get textContent(): string {
    if (this.children.length === 0) return this._textContent;
    return this.children.map((c) => c.textContent).join('');
  }

  set textContent(v: string) {
    this._textContent = v;
    this.children = [];
  }

  appendChild<T extends FakeElement>(child: T): T {
    child.remove();
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  append(...nodes: Array<FakeElement | string>): void {
    for (const n of nodes) {
      if (typeof n === 'string') {
        const span = new FakeElement('#text');
        span.textContent = n;
        this.appendChild(span);
      } else {
        this.appendChild(n);
      }
    }
  }

  replaceChildren(...nodes: Array<FakeElement | string>): void {
    for (const c of [...this.children]) c.parentElement = null;
    this.children = [];
    this.append(...nodes);
  }

  remove(): void {
    if (!this.parentElement) return;
    const idx = this.parentElement.children.indexOf(this);
    if (idx >= 0) this.parentElement.children.splice(idx, 1);
    this.parentElement = null;
  }

  setAttribute(k: string, v: string): void {
    this.attrs.set(k, v);
    if (k.startsWith('data-')) this.dataset[k.slice(5)] = v;
  }

  getAttribute(k: string): string | null {
    if (k.startsWith('data-') && this.dataset[k.slice(5)] !== undefined) return this.dataset[k.slice(5)];
    return this.attrs.get(k) ?? null;
  }

  click(): void {
    this.onclick?.();
  }

  matches(selector: string): boolean {
    const s = selector.trim();
    const testIdMatch = /^\[data-testid=["']?([^"'[\]]+)["']?\]$/.exec(s);
    if (testIdMatch) return this.dataset.testid === testIdMatch[1];
    const slotMatch = /^\[data-slot=["']?([^"'[\]]+)["']?\]$/.exec(s);
    if (slotMatch) return this.dataset.slot === slotMatch[1];
    if (s.startsWith('.')) return this.className.split(/\s+/).includes(s.slice(1));
    return this.tagName.toLowerCase() === s.toLowerCase();
  }

  querySelector(selector: string): FakeElement | null {
    for (const c of this.children) {
      if (c.matches(selector)) return c;
      const found = c.querySelector(selector);
      if (found) return found;
    }
    return null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    const out: FakeElement[] = [];
    for (const c of this.children) {
      if (c.matches(selector)) out.push(c);
      out.push(...c.querySelectorAll(selector));
    }
    return out;
  }
}

function ensureDom(): FakeElement {
  const body = new FakeElement('body');
  (globalThis as unknown as { document: unknown }).document = {
    body,
    createElement: (tag: string) => new FakeElement(tag),
  };
  return body;
}

let cmdSeq = 0;
function mkCmd(kind: string, args: unknown, colonyIndex: number | null = 0): SimCommand {
  return { colonyIndex, source: 'player', commandId: `hud_cmd_${++cmdSeq}`, kind, args };
}

describe('W01-29: Minimal HUD clock & view rendering', () => {
  it('formats game clock correctly at 5 Hz from tick', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(5)).toBe('00:01');
    expect(formatClock(25)).toBe('00:05');
    expect(formatClock(325)).toBe('01:05');
    expect(formatClock(3600)).toBe('12:00');
  });

  it('renders colony name, game clock, Metals/Minerals/Bio stock, family caps (500), and HQ cell bar (800 / 800 E) from ClientView', () => {
    const parent = ensureDom();
    const hud = new MinimalHud(parent as unknown as HTMLElement);

    const colony: ViewColony = {
      index: 0,
      id: 'col_0',
      name: "Colonist's Colony",
      color: 0xff8800,
      status: 'active',
      stock: {
        'metals.t1': 600,
        'minerals.t1': 350,
        'bio.biomass': 200,
        'bio.water': 200,
      },
      caps: {
        metals: 500,
        minerals: 500,
        bio: 500,
      },
      hq: {
        entityId: 1,
        owner: 0,
        tier: 1,
        q: 0,
        r: 0,
        x: 0,
        y: 0,
        hp: 900,
        hpMax: 900,
        cell: 800,
        cellMax: 800,
        workRate: 1.5,
        viewRadius: 9,
        targetQ: 0,
        targetR: 0,
        currentJob: 'idle',
        queueCount: 0,
      },
    };

    const mockView: Partial<ClientView> = {
      tick: 125, // 25 seconds -> 00:25
      planet: { id: 'pl_dev', type: 'temperate', radius: 16 },
      colonies: [colony],
      entities: new Float32Array(),
      count: 0,
    };

    hud.update(mockView as ClientView);

    const colonyEl = parent.querySelector('[data-testid="hud-colony-name"]')!;
    const clockEl = parent.querySelector('[data-testid="hud-clock"]')!;
    const metalsEl = parent.querySelector('[data-testid="hud-stock-metals"]')!;
    const mineralsEl = parent.querySelector('[data-testid="hud-stock-minerals"]')!;
    const bioEl = parent.querySelector('[data-testid="hud-stock-bio"]')!;
    const cellEl = parent.querySelector('[data-testid="hud-hq-cell"]')!;
    const cellBar = parent.querySelector('[data-testid="hud-hq-cell-bar"]')!;

    expect(colonyEl.textContent).toBe("Colonist's Colony");
    expect(clockEl.textContent).toBe('00:25');
    expect(metalsEl.textContent).toContain('600 / 500');
    expect(mineralsEl.textContent).toContain('350 / 500');
    expect(bioEl.textContent).toContain('400 / 500');
    expect(bioEl.textContent).toContain('Biomass 200');
    expect(bioEl.textContent).toContain('Water 200');
    expect(cellEl.textContent).toContain('800 / 800 E');
    expect(cellBar.style.width).toBe('100.0%');

    expect(hud.el.className).toContain('plate-sm');
    expect(parent.querySelector('.ta-hud-min__stock-label')).toBeNull();
    expect(parent.querySelector('.ta-hud-min__icon--metals')).not.toBeNull();
    expect(parent.querySelector('.ta-hud-min__icon--minerals')).not.toBeNull();
    expect(parent.querySelector('.ta-hud-min__icon--bio')).not.toBeNull();
    expect(parent.querySelector('.ta-hud-min__icon--supply')).not.toBeNull();
    expect(parent.querySelector('.ta-hud-min__icon--cell')).not.toBeNull();
    expect(parent.querySelector('.ta-hud-min__icon--clock')).not.toBeNull();

    hud.dispose();
  });
});

describe('W01-29: Minimal HUD acceptance check', () => {
  it('acceptance: place Hub without enough resources → see toast "Waiting: Metals 0/200"', async () => {
    const parent = ensureDom();
    const host = new LocalHost({ flags: ['W00', 'W01'], radius: 16 });

    // Spawn colony landing cargo and an alive HQ drone at (0, 0)
    spawnColonyLanding(host.state, { colonyId: 0, q: 0, r: 0 });
    spawnHqUnit(host.state, { owner: 0, q: 0, r: 0 });

    // Explicitly zero out metals stock (acceptance scenario)
    setColonyStock(host.state, 0, {
      'metals.t1': 0,
      'minerals.t1': 350,
      'bio.biomass': 200,
      'bio.water': 200,
    });
    host.sync(true);

    const mounted = mountMinimalHud({
      hudRoot: parent as unknown as HTMLElement,
      store: host.store,
      transport: host,
      ownerColonyIndex: 0,
    });

    // Initial view syncs stock (0 metals)
    mounted.update(host.sync(false));

    // The placement goes through the authoritative handler only (D-37: no client-side affordability copy):
    // the host rejects it, cmd.reject reaches the HUD over the transport and triggers the toast.
    host.sim.submit(mkCmd('placeBuilding', { building: 'commandHub', q: 3, r: 0 }, 0));
    host.step(1);

    const toastEl = parent.querySelector('[data-testid="hud-toast"]');
    expect(toastEl).not.toBeNull();
    expect(toastEl?.textContent).toBe('Waiting: Metals 0/200');

    mounted.dispose();
  });
});

describe('W01-29: Minimal HUD toasts and mounting', () => {
  it('formats rejections for minerals deficit, other cmd.reject codes, and allows click dismiss', () => {
    const parent = ensureDom();
    const hud = new MinimalHud(parent as unknown as HTMLElement);

    // Format minerals shortage
    const mineralsShort = formatRejectToast('insufficient_resources', undefined, {
      'metals.t1': 200,
      'minerals.t1': 30,
      'bio.biomass': 50,
      'bio.water': 50,
    });
    expect(mineralsShort).toBe('Waiting: Minerals 30/100');
    // Same order as the sim's waiting reason (findShortfall): biomass before water.
    expect(formatRejectToast('insufficient_resources', undefined, { 'metals.t1': 200, 'minerals.t1': 100 })).toBe('Waiting: Biomass 0/50');

    // Format common reject codes
    expect(formatRejectToast('not_own_territory')).toBe('Rejected: Not your territory');
    expect(formatRejectToast('site_blocked')).toBe('Rejected: Site blocked');
    expect(formatRejectToast('worker_tier_locked')).toBe('Rejected: Requires HQ');
    expect(formatRejectToast('unknown_entity')).toBe('Rejected: Unknown entity');
    expect(formatRejectToast('already_landed')).toBe('Rejected: Colony already landed');
    expect(formatRejectToast('landing_site_taken')).toBe('Rejected: Landing site taken or too close to another colony');

    // Show toast and test click dismiss
    const toast = hud.showToast('Test Toast Notification', 'warning', 10000);
    expect(parent.querySelector('[data-testid="hud-toast"]')?.textContent).toBe('Test Toast Notification');
    toast.click();
    expect(parent.querySelector('[data-testid="hud-toast"]')).toBeNull();

    hud.dispose();
  });

  it('mounts automatically in HudRoot when wave W01 is enabled', () => {
    const parent = ensureDom();
    const flags = new Set(['W00', 'W01']);
    const features = loadFeatures({ flags, host: 'server' });

    expect(features.some((f) => f.id === 'hud-min')).toBe(true);

    const root = new HudRoot(parent as unknown as HTMLElement, features, {
      flags,
      host: 'server',
      services: { track: () => {} } as never,
    });

    const minBar = parent.querySelector('[data-testid="hud-min"]');
    expect(minBar).not.toBeNull();

    root.dispose();
    expect(parent.querySelector('[data-testid="hud-min"]')).toBeNull();
  });
});

describe('HUD shows whole resource units only', () => {
  it('floors any fractional stock at the read boundary (stock and toasts)', () => {
    expect(wholeStock({ 'metals.t1': 250.0000000000006, 'bio.water': 49.9, bad: Number.NaN })).toEqual({
      'metals.t1': 250,
      'bio.water': 49,
    });
    expect(wholeStock(undefined)).toEqual({});

    const parent = ensureDom();
    const hud = new MinimalHud(parent as unknown as HTMLElement);
    const colony: ViewColony = {
      index: 0,
      id: 'col_0',
      name: 'Fractions',
      color: 0xff8800,
      status: 'active',
      stock: { 'metals.t1': 199.99, 'minerals.t1': 100.5, 'bio.biomass': 50.0000000001, 'bio.water': 50 },
    };
    hud.update({ tick: 0, colonies: [colony] } as unknown as ClientView);
    // No caps in the view: the sim's INITIAL_CAPS (metals 600, minerals 500, bio 500), not a HUD constant.
    expect(parent.querySelector('[data-testid="hud-stock-metals"]')!.textContent).toContain('199 / 600');
    expect(parent.querySelector('[data-testid="hud-stock-minerals"]')!.textContent).toContain('100 / 500');
    expect(parent.querySelector('[data-testid="hud-stock-bio"]')!.textContent).toContain('100 / 500');
    expect(hud.getColonyStock()['metals.t1']).toBe(199);
    expect(hud.handleReject('insufficient_resources').textContent).toBe('Waiting: Metals 199/200');
    hud.dispose();
  });
});
