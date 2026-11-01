// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { ENTITY_STATE, rowOf, setField, setHqCellEnergy, spawnColonyLanding, spawnHqUnit } from '@terra/sim';
import { HudRoot } from '../../core/hud/HudRoot';
import { loadFeatures } from '../../core/registry';
import { LocalHost } from '../../store/local/LocalHost';
import landfallFeature, { extractHqFromView, hqJobFromStateCode, mountLandfall } from './index';

/** A clean `document.body` for each test (jsdom). */
function freshBody(): HTMLElement {
  document.body.replaceChildren();
  return document.body;
}

const mouse = (target: EventTarget, type: string, button: number, clientX: number, clientY: number) =>
  target.dispatchEvent(new MouseEvent(type, { button, clientX, clientY, bubbles: true, cancelable: true }));

describe('W01-26: HQ selection and right-click moveUnit acceptance', () => {
  it('selects HQ, orders move to (5, 0) via right-click/orderMove, updates HQ panel to moving and back to idle on arrival', () => {
    const body = freshBody();
    const host = new LocalHost({ flags: ['W00', 'W01'], radius: 16 });
    const hqId = spawnHqUnit(host.state, { owner: 0, q: 0, r: 0 });
    host.sync(true);

    const hudRoot = document.createElement('div');
    const canvas = document.createElement('canvas');
    body.appendChild(hudRoot);
    body.appendChild(canvas);

    const tileCoords = new Map<string, { q: number; r: number }>([
      ['100,100', { q: 0, r: 0 }],
      ['250,100', { q: 5, r: 0 }],
    ]);
    const pickTile = (cx: number, cy: number) => tileCoords.get(`${cx},${cy}`) ?? null;
    const sendSpy = vi.spyOn(host.store, 'sendCommand');

    const mounted = mountLandfall({
      hudRoot,
      store: host.store,
      canvas,
      pickTile,
    });

    const panel = hudRoot.querySelector<HTMLElement>('[data-testid="hq-panel"]')!;
    const titleEl = hudRoot.querySelector('[data-testid="hq-title"]')!;
    const hpEl = hudRoot.querySelector('[data-testid="hq-hp"]')!;
    const cellEl = hudRoot.querySelector('[data-testid="hq-cell"]')!;
    const jobEl = hudRoot.querySelector('[data-testid="hq-job"]')!;
    const queueEl = hudRoot.querySelector('[data-testid="hq-queue"]')!;

    expect(panel.hidden).toBe(false);
    expect(mounted.getSelectedEntityId()).toBe(hqId);
    expect(titleEl.textContent).toBe('HQ T1 · COMMANDER DRONE');
    expect(hpEl.textContent).toBe('900 / 900');
    expect(cellEl.textContent).toBe('800 / 800 E');
    expect(jobEl.textContent).toBe('idle');
    expect(queueEl.textContent).toBe('Queue: 0');

    mounted.deselect();
    expect(mounted.getSelectedEntityId()).toBeNull();
    mouse(canvas, 'pointerdown', 0, 100, 100);
    mouse(canvas, 'pointerup', 0, 100, 100);
    expect(mounted.getSelectedEntityId()).toBe(hqId);
    expect(hudRoot.querySelector('[data-testid="hq-select-btn"]')!.getAttribute('aria-pressed')).toBe('true');

    const ctx = new MouseEvent('contextmenu', { button: 2, clientX: 250, clientY: 100, bubbles: true, cancelable: true });
    canvas.dispatchEvent(ctx);
    expect(ctx.defaultPrevented).toBe(true);
    expect(sendSpy).toHaveBeenCalledWith({ type: 'moveUnit', entityId: hqId, q: 5, r: 0 });

    host.step(1);
    const hqRow = rowOf(host.state.entities, hqId);
    expect(host.state.entities.cols.x[hqRow]).toBeGreaterThan(0);
    expect(host.state.entities.cols.x[hqRow]).toBeLessThan(5);
    expect(jobEl.textContent).toBe('moving');
    expect(hpEl.textContent).toBe('900 / 900');
    expect(cellEl.textContent).toBe('800 / 800 E');
    expect(queueEl.textContent).toBe('Queue: 1');

    host.step(20);
    expect(host.state.entities.cols.q[hqRow]).toBe(5);
    expect(host.state.entities.cols.r[hqRow]).toBe(0);
    expect(jobEl.textContent).toBe('idle');
    expect(queueEl.textContent).toBe('Queue: 0');

    mounted.dispose();
  });
});

describe('W01-26: HudRoot integration and HQ panel states', () => {
  it('mounts via HudRoot when W01 wave flag is enabled and updates HP, cell bar, working/constructing states', () => {
    const body = freshBody();
    const features = loadFeatures({ flags: new Set(['W00', 'W01']), host: 'server' });
    expect(features.some((f) => f.id === 'landfall')).toBe(true);

    const host = new LocalHost({ flags: ['W00', 'W01'], radius: 16 });
    spawnColonyLanding(host.state, { colonyId: 0, q: 2, r: -1 });
    host.step(35);

    const hud = new HudRoot(body, [landfallFeature], {
      flags: new Set(['W00', 'W01']),
      host: 'server',
      services: { store: host.store, track: () => {} },
    });
    hud.update(host.store.latest!);

    const jobEl = body.querySelector('[data-testid="hq-job"]')!;
    const cellEl = body.querySelector('[data-testid="hq-cell"]')!;
    const cellBar = body.querySelector<HTMLElement>('[data-testid="hq-cell-bar"]')!;
    const selectBtn = body.querySelector<HTMLButtonElement>('[data-testid="hq-select-btn"]')!;
    expect(jobEl.textContent).toBe('idle');
    expect(cellEl.textContent).toBe('800 / 800 E');
    expect(cellBar.style.width).toBe('100%'); // the browser (and jsdom) normalises '100.0%'

    const hq = extractHqFromView(host.store.latest!)!;
    const row = rowOf(host.state.entities, hq.entityId);
    setHqCellEnergy(host.state, row, 400);
    setField(host.state.entities, row, 'state', ENTITY_STATE.working, host.tick);
    hud.update(host.sync(false));
    expect(jobEl.textContent).toBe('working');
    expect(cellEl.textContent).toBe('400 / 800 E');
    expect(cellBar.style.width).toBe('50%');

    setField(host.state.entities, row, 'state', ENTITY_STATE.constructing, host.tick);
    hud.update(host.sync(false));
    expect(jobEl.textContent).toBe('constructing');

    expect(body.querySelector<HTMLElement>('[data-testid="hq-panel"]')!.dataset.selected).toBe('true');
    selectBtn.click();
    expect(body.querySelector<HTMLElement>('[data-testid="hq-panel"]')!.dataset.selected).toBe('false');
    selectBtn.click();
    expect(body.querySelector<HTMLElement>('[data-testid="hq-panel"]')!.dataset.selected).toBe('true');

    hud.dispose();
  });
});

describe('HQ view reading: no invented ids, live maxima, state mapping (FF-23, FF-27)', () => {
  it('a view with HQ metadata but no entity id names no HQ (no `moveUnit { entityId: 1 }`)', () => {
    expect(extractHqFromView({ colonies: [{ index: 0, hq: { cell: 10, cellMax: 800 } }] }, 0)).toBeNull();
    const hq = extractHqFromView({ colonies: [{ index: 0, hq: { entityId: 7 } }] }, 0)!;
    expect([hq.entityId, hq.hpMax, hq.cellMax, hq.tier]).toEqual([7, 900, 800, 1]); // maxima from the hq.t1 row
  });

  it('maps every entity state the panel can see; descending is not "constructing"', () => {
    expect(hqJobFromStateCode(ENTITY_STATE.moving)).toBe('moving');
    expect(hqJobFromStateCode(ENTITY_STATE.working)).toBe('working');
    expect(hqJobFromStateCode(ENTITY_STATE.constructing)).toBe('constructing');
    expect(hqJobFromStateCode(ENTITY_STATE.waiting)).toBe('waiting');
    expect(hqJobFromStateCode(ENTITY_STATE.descending)).toBe('idle');
    expect(hqJobFromStateCode(ENTITY_STATE.idle)).toBe('idle');
  });
});
