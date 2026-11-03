// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { REJECT_CODES } from '@terra/contracts';
import {
  getHubFootprintTiles,
  initialCaps,
  hexIndex,
  PREP,
  setColonyStock,
  setTilePrep,
  spawnColonyLanding,
  spawnHqUnit,
  type ViewColony,
} from '@terra/sim';
import { HudRoot } from '../../core/hud/HudRoot';
import { loadFeatures } from '../../core/registry';
import { CommandBus } from '../../net/commandBus';
import { LocalHost } from '../../store/local/LocalHost';
import { mountHubPlacement } from '../hub-placement';
import type { ClientView } from '../../store/replica/viewCodec';
import { formatClock, formatRejectToast, mountMinimalHud, MinimalHud, wholeStock } from './index';
import { REJECT_TEXT } from './rejectText';

/** A clean `document.body` for each test (jsdom). */
function freshBody(): HTMLElement {
  document.body.replaceChildren();
  return document.body;
}

describe('W01-29: Minimal HUD clock & view rendering', () => {
  it('formats game clock correctly at 5 Hz from tick', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(5)).toBe('00:01');
    expect(formatClock(25)).toBe('00:05');
    expect(formatClock(325)).toBe('01:05');
    expect(formatClock(3600)).toBe('12:00');
  });

  it('renders colony name, game clock, Metals/Minerals/Bio stock, the sim family caps, and HQ cell bar (800 / 800 E) from ClientView', () => {
    const parent = freshBody();
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
      caps: { ...initialCaps() }, // what a landed colony really carries (sim data), not a hand-written fixture (XC-19)
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
    const cellBar = parent.querySelector<HTMLElement>('[data-testid="hud-hq-cell-bar"]')!;

    expect(colonyEl.textContent).toBe("Colonist's Colony");
    expect(clockEl.textContent).toBe('00:25');
    expect(metalsEl.textContent).toContain(`600 / ${initialCaps().metals}`);
    expect(mineralsEl.textContent).toContain(`350 / ${initialCaps().minerals}`);
    expect(bioEl.textContent).toContain(`400 / ${initialCaps().bio}`);
    expect(bioEl.textContent).toContain('Biomass 200');
    expect(bioEl.textContent).toContain('Water 200');
    expect(cellEl.textContent).toContain('800 / 800 E');
    expect(cellBar.style.width).toBe('100%'); // the browser (and jsdom) normalises '100.0%'

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
  it('acceptance: a Hub placed without enough resources is accepted and waits (GP-30): no reject toast, the order says what it waits for', async () => {
    const parent = freshBody();
    const host = new LocalHost({ flags: ['W00', 'W01'], radius: 16 });

    // Spawn colony landing cargo and an alive HQ drone at (0, 0)
    spawnColonyLanding(host.state, { colonyId: 0, q: 0, r: 0 });
    spawnHqUnit(host.state, { owner: 0, q: 0, r: 0 });
    setColonyStock(host.state, 0, { 'metals.t1': 0, 'minerals.t1': 350, 'bio.biomass': 200, 'bio.water': 200 });
    const idx = hexIndex(host.state.grid.radius);
    for (const t of getHubFootprintTiles(3, 0)) setTilePrep(host.state.grid, idx.indexOf(t.q, t.r), PREP.prepared); // site ready: only resources missing
    host.sync(true);

    // The command goes through the real host: it acks the placement (the sim never rejects a Hub for its cost) and
    // the open order carries the waiting reason the Hub panel shows.
    const services: Record<string, unknown> = {};
    const mounted = mountMinimalHud({ hudRoot: parent, store: host.store, transport: host, ownerColonyIndex: 0, services: services as never });
    mounted.update(host.sync(false));
    const bus = new CommandBus(host);
    const panel = document.createElement('div');
    const hub = mountHubPlacement(panel, { host, sendCommand: bus.send, services: services as never });
    expect(hub.confirmPlacement(3, 0)).toBe(true);
    host.step(1);
    await new Promise((r) => setTimeout(r, 0));

    expect(parent.querySelectorAll('[data-testid="hud-toast"]')).toHaveLength(0);
    expect(panel.querySelector('[data-testid="hub-order-status"]')!.textContent).toBe('commandHub: waiting(resources: metals.t1 0/200)');
    hub.dispose();
    bus.dispose();
    mounted.dispose();
  });
});

describe('W01-29: Minimal HUD toasts and mounting', () => {
  it('formats cmd.reject codes (no shortfall numbers: nothing is rejected for cost, GP-30), and allows click dismiss', () => {
    const parent = freshBody();
    const hud = new MinimalHud(parent as unknown as HTMLElement);

    // The code's text, whatever the stock: the old Hub-shortfall line ("Waiting: Metals 0/200") cannot happen any more
    expect(formatRejectToast('insufficient_resources')).toBe('Waiting: Insufficient resources');
    expect(formatRejectToast('insufficient_resources', undefined, 'placeBuilding')).toBe('Waiting: Insufficient resources');

    // Format common reject codes
    expect(formatRejectToast('not_own_territory')).toBe('Rejected: Not your territory');
    expect(formatRejectToast('site_blocked')).toBe('Rejected: Site blocked');
    expect(formatRejectToast('worker_tier_locked')).toBe('Rejected: No worker available');
    expect(formatRejectToast('worker_tier_locked', undefined, 'placeBuilding')).toBe('Rejected: Requires a free HQ');
    expect(formatRejectToast('invalid_args', 'bad', 'moveUnit')).toBe('Rejected: Invalid move order');
    expect(formatRejectToast('invalid_args', undefined, 'placeBuilding')).toBe('Rejected: Invalid placement');
    expect(formatRejectToast('some_new_code', 'host detail')).toBe('Rejected: host detail');
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
    const parent = freshBody();
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

describe('W02: Unified resource header', () => {
  it('mounts only a single unified resource header (.ta-resources-hud) when W02 is enabled (no duplicate header)', () => {
    const parent = freshBody();
    const flags = new Set(['W00', 'W01', 'W02']);
    const features = loadFeatures({ flags, host: 'server' });

    const root = new HudRoot(parent as unknown as HTMLElement, features, {
      flags,
      host: 'server',
      services: { track: () => {} } as never,
    });

    const resourceHeaders = parent.querySelectorAll('.ta-resources-hud');
    expect(resourceHeaders).toHaveLength(1);
    expect(resourceHeaders[0].getAttribute('data-testid')).toBe('hud-min');
    expect(parent.querySelectorAll('.ta-hud__slot[data-slot="top-center"] > .ta-hud__panel')).toHaveLength(1);

    root.dispose();
  });
});

describe('W02: Hover resource tier & flow breakdown', () => {
  it('populates hover resource tier breakdowns with current income, in-progress spending, and power flow', () => {
    const parent = freshBody();
    const hud = new MinimalHud(parent);

    const colony = {
      index: 0,
      id: 'col_0',
      name: 'Alpha',
      color: 0xff8800,
      status: 'active' as const,
      stock: {
        'metals.t1': 500,
        'metals.t2': 12,
        'metals.t3': 0,
        'minerals.t1': 250,
        'bio.water': 150,
        'bio.biomass': 150,
      },
      caps: { metals: 500, minerals: 500, bio: 500 },
      production: {
        familyIncomePerS: { metals: 2.5, minerals: 0.5, bio: 0.2 },
        incomePerS: { 'metals.t1': 2.0, 'metals.t2': 0.5, 'minerals.t1': 0.5, 'bio.water': 0.2 },
      },
      queue: [
        {
          taskId: 'q-1',
          colonyIndex: 0,
          lane: 'construction',
          state: 'in_progress',
          cost: { 'metals.t1': 60, 'minerals.t1': 30 },
          buildTicks: 75,
          workRate: 1.5, // duration = (75 / 1.5) * 0.2 = 10s -> 6.0 metals/s, 3.0 minerals/s
        },
      ],
      power: { supply: 28, demand: 5, net: 23 },
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
        currentJob: 'idle' as const,
        queueCount: 1,
      },
    };

    hud.update({ tick: 50, colonies: [colony] } as unknown as ClientView);

    const metalsEl = parent.querySelector<HTMLElement>('[data-testid="hud-stock-metals"]')!;
    expect(metalsEl.getAttribute('data-family')).toBe('metals');
    expect(metalsEl.getAttribute('data-capped')).toBe('true');
    expect(metalsEl.classList.contains('ta-res-chip--capped')).toBe(true);

    metalsEl.dispatchEvent(new MouseEvent('mouseenter'));
    expect(metalsEl.getAttribute('data-open')).toBe('true');
    metalsEl.dispatchEvent(new MouseEvent('mouseleave'));
    expect(metalsEl.getAttribute('data-open')).toBeNull();

    expect(metalsEl.querySelector('[data-testid="res-income-metals"]')?.textContent).toBe('Income: +2.5/s');
    expect(metalsEl.querySelector('[data-testid="res-spending-metals"]')?.textContent).toBe('Spending: −6.0/s');
    expect(metalsEl.querySelector('[data-testid="res-net-metals"]')?.textContent).toBe('Net: −3.5/s');

    const t1Row = metalsEl.querySelector('[data-res="metals.t1"]')!;
    expect(t1Row.getAttribute('data-locked')).toBe('false');
    expect(t1Row.querySelector('.ta-res-breakdown__name')?.textContent).toBe('Iron');
    expect(t1Row.querySelector('.ta-res-breakdown__amount')?.textContent).toBe('500');
    expect(t1Row.querySelector('.ta-res-breakdown__rate')?.textContent).toBe('+2.0 / −6.0/s');

    const t2Row = metalsEl.querySelector('[data-res="metals.t2"]')!;
    expect(t2Row.getAttribute('data-locked')).toBe('false');
    expect(t2Row.querySelector('.ta-res-breakdown__amount')?.textContent).toBe('12');

    const t3Row = metalsEl.querySelector('[data-res="metals.t3"]')!;
    expect(t3Row.getAttribute('data-locked')).toBe('true');

    const cellEl = parent.querySelector<HTMLElement>('[data-testid="hud-hq-cell"]')!;
    expect(cellEl.querySelector('[data-testid="res-income-energy"]')?.textContent).toBe('Income (Supply): +28 E/s');
    expect(cellEl.querySelector('[data-testid="res-spending-energy"]')?.textContent).toBe('Spending (Demand): −5 E/s');
    expect(cellEl.querySelector('[data-testid="res-net-energy"]')?.textContent).toBe('Net: +23 E/s');

    hud.dispose();
  });
});

describe('HUD shows whole resource units only', () => {
  it('floors any fractional stock at the read boundary (stock and toasts)', () => {
    expect(wholeStock({ 'metals.t1': 250.0000000000006, 'bio.water': 49.9, bad: Number.NaN })).toEqual({
      'metals.t1': 250,
      'bio.water': 49,
    });
    expect(wholeStock(undefined)).toEqual({});

    const parent = freshBody();
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
    hud.dispose();
  });
});

describe('Reject toasts per command kind, live costs, accessibility, placeholders (FF-12, FF-22..FF-25)', () => {
  it('every RejectCode has its own text', () => {
    for (const code of REJECT_CODES) expect(REJECT_TEXT[code]).toMatch(/\S/);
  });

  it('a reject toast uses the wording of the command it belongs to; one toast per reject cause', () => {
    const parent = freshBody();
    const hud = new MinimalHud(parent);
    hud.update({ tick: 0, colonies: [{ index: 0, id: 'c', name: 'c', color: 0, status: 'active', stock: { 'metals.t1': 120 } }] } as never);
    expect(hud.handleReject('queue_full', undefined, { kind: 'enqueueTask' }).textContent).toBe('Rejected: Terraform queue full');
    expect(hud.handleReject('queue_full', undefined, { kind: 'placeBuilding' }).textContent).toBe('Rejected: Queue full');
    expect(parent.querySelectorAll('[data-testid="hud-toast"]')).toHaveLength(1); // one toast per reject cause
    hud.dispose();
  });

  it('shows placeholders until the first view, then the view numbers; no invented 800 E cell', () => {
    const parent = freshBody();
    const hud = new MinimalHud(parent);
    expect(parent.querySelector('[data-testid="hud-hq-cell"]')!.textContent).toContain('— E');
    expect(parent.querySelector('[data-testid="hud-stock-metals"]')!.textContent).toContain('—');
    hud.update({ tick: 0, colonies: [{ index: 0, id: 'c', name: 'c', color: 0, status: 'active', stock: {} }] } as never);
    expect(parent.querySelector('[data-testid="hud-hq-cell"]')!.textContent).toContain('— E'); // no HQ in the view
    expect(parent.querySelector('[data-testid="hud-stock-metals"]')!.textContent).toContain('0 / 600');
    hud.dispose();
  });

  it('announces toasts politely, names every stock for screen readers, dismisses with the keyboard', () => {
    const parent = freshBody();
    const hud = new MinimalHud(parent);
    expect(hud.toastContainer.getAttribute('role')).toBe('status');
    expect(hud.toastContainer.getAttribute('aria-live')).toBe('polite');
    for (const [id, name] of [['hud-stock-metals', 'Metals'], ['hud-stock-minerals', 'Minerals'], ['hud-stock-bio', 'Bio'], ['hud-supply', 'Supply']]) {
      expect(parent.querySelector(`[data-testid="${id}"] .ta-hud-min__sr-only`)!.textContent).toContain(name);
    }
    const toast = hud.showToast('hello');
    expect(toast.tagName).toBe('BUTTON');
    hud.dispose();
  });

  it('dispose clears pending toast timers', () => {
    vi.useFakeTimers();
    try {
      const hud = new MinimalHud(freshBody());
      hud.showToast('a');
      hud.showToast('b', 'error');
      expect(vi.getTimerCount()).toBe(2);
      hud.dispose();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
