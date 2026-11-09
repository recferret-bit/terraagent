// @vitest-environment jsdom
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  DEPOSIT,
  ENTITY_KIND,
  ENTITY_STATE,
  hexIndex,
  insertRow,
  rowOf,
  setField,
  setHqCellEnergy,
  setTileDeposit,
  spawnColonyLanding,
  spawnWorkerUnit,
  spawnHqUnit,
} from '@terra/sim';
import { PROGRESS_BAR_COLOR, UnitHealthBars } from '../../app/online/unitHealthBars';
import { HudRoot } from '../../core/hud/HudRoot';
import { loadFeatures } from '../../core/registry';
import { LocalHost } from '../../store/local/LocalHost';
import { hubUnitsLaneTaskId, isBuildingCoveringTile, unitHasTerraformJob } from './selectionHelpers';
import landfallFeature, { extractHqFromView, extractSelectableEntities, hqJobFromStateCode, mountLandfall } from './index';

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

describe('W02: Worker Drone selection, moveUnit, empty-click deselect, and 3D unit health bars', () => {
  it('selects a Worker Drone on left-click, orders moveUnit on right-click, and hides panel when clicking empty ground', () => {
    const body = freshBody();
    const host = new LocalHost({ flags: ['W00', 'W01', 'W02'], radius: 16 });
    const hqId = spawnHqUnit(host.state, { owner: 0, q: 0, r: 0 });
    const harvId = spawnWorkerUnit(host.state, { owner: 0, q: 3, r: 0, tier: 1 });
    host.sync(true);

    const hudRoot = document.createElement('div');
    const canvas = document.createElement('canvas');
    body.appendChild(hudRoot);
    body.appendChild(canvas);

    const tileCoords = new Map<string, { q: number; r: number }>([
      ['100,100', { q: 0, r: 0 }],
      ['200,100', { q: 3, r: 0 }],
      ['300,100', { q: 6, r: 0 }],
      ['400,400', { q: 10, r: 10 }],
    ]);
    const pickTile = (cx: number, cy: number) => tileCoords.get(`${cx},${cy}`) ?? null;
    const sendSpy = vi.spyOn(host.store, 'sendCommand');

    const mounted = mountLandfall({ hudRoot, store: host.store, canvas, pickTile });
    const panel = hudRoot.querySelector<HTMLElement>('[data-testid="hq-panel"]')!;
    const titleEl = hudRoot.querySelector('[data-testid="hq-title"]')!;
    const hpEl = hudRoot.querySelector('[data-testid="hq-hp"]')!;
    const slotEl = hudRoot.querySelector('[data-testid="selection-slot"]')!;
    const countEl = hudRoot.querySelector('[data-testid="selection-count"]')!;

    expect(mounted.getSelectedEntityId()).toBe(hqId);
    expect(panel.hidden).toBe(false);
    expect(slotEl.textContent).toBe('HQ');
    expect(countEl.textContent).toBe('1');

    // Left-click Worker Drone at (3, 0) -> selects it
    mouse(canvas, 'pointerdown', 0, 200, 100);
    mouse(canvas, 'pointerup', 0, 200, 100);
    expect(mounted.getSelectedEntityId()).toBe(harvId);
    expect(panel.hidden).toBe(false);
    expect(titleEl.textContent).toBe('WORKER DRONE T1');
    expect(hpEl.textContent).toBe('160 / 160');
    expect(slotEl.textContent).toBe('WRK');

    // Right-click (6, 0) -> orders moveUnit for the Worker Drone
    const ctx = new MouseEvent('contextmenu', { button: 2, clientX: 300, clientY: 100, bubbles: true, cancelable: true });
    canvas.dispatchEvent(ctx);
    expect(sendSpy).toHaveBeenCalledWith({ type: 'moveUnit', entityId: harvId, q: 6, r: 0 });

    host.step(1);
    const harvRow = rowOf(host.state.entities, harvId);
    expect(host.state.entities.cols.x[harvRow]).toBeGreaterThan(3);

    // Left-click empty ground at (10, 10) -> resets selection & hides panel
    mouse(canvas, 'pointerdown', 0, 400, 400);
    mouse(canvas, 'pointerup', 0, 400, 400);
    expect(mounted.getSelectedEntityId()).toBeNull();
    expect(panel.hidden).toBe(true);
    expect(panel.dataset.selected).toBe('false');

    mounted.dispose();
  });
});

describe('W02: 3D unit health and blue progress bars', () => {
  it('creates one 3D unit health bar per unit for HQ and a Worker Drone', () => {
    const scene = new THREE.Scene();
    const bars = new UnitHealthBars(scene);
    const hqMesh = new THREE.Object3D();
    hqMesh.position.set(2, 0.5, 4);
    const harvMesh = new THREE.Object3D();
    harvMesh.position.set(6, 0.5, 4);

    bars.sync([
      { id: 1, kind: ENTITY_KIND.hq, hp: 450, hpMax: 900, mesh: hqMesh },
      { id: 2, kind: ENTITY_KIND.worker, hp: 160, hpMax: 160, mesh: harvMesh },
    ]);

    expect(bars.group.children.length).toBe(2);
    const hqBarRoot = bars.group.getObjectByName('unit-hp-1')!;
    expect(hqBarRoot.position.x).toBe(2);
    let aboveScaleX = 0;
    let fillCount = 0;
    hqBarRoot.traverse((c) => {
      if (c.userData.role === 'hp-above-fill') {
        aboveScaleX = c.scale.x;
        fillCount++;
      }
      if (c.userData.role === 'hp-under-fill') fillCount++;
    });
    expect(fillCount).toBe(1);
    expect(aboveScaleX).toBeCloseTo(0.5, 3);

    // Blue progress bar (0x38bdf8) appears on any unit or building with 0 < progress < 1
    const hubMesh = new THREE.Object3D();
    hubMesh.position.set(8, 0.5, 4);
    bars.sync([
      { id: 1, kind: ENTITY_KIND.hq, hp: 900, hpMax: 900, progress: 0.6, mesh: hqMesh },
      { id: 2, kind: ENTITY_KIND.worker, hp: 160, hpMax: 160, progress: 0.4, mesh: harvMesh },
      { id: 3, kind: ENTITY_KIND.commandHub, hp: 1500, hpMax: 1500, progress: 0.5, mesh: hubMesh },
    ]);
    expect(bars.group.children.length).toBe(3);
    const hubBarRoot = bars.group.getObjectByName('unit-hp-3')!;
    let progScaleX = 0;
    let progColor = 0;
    hubBarRoot.traverse((c) => {
      if (c.userData.role === 'progress-above-fill') {
        progScaleX = c.scale.x;
        progColor = ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).color.getHex();
      }
    });
    expect(progScaleX).toBeCloseTo(0.5, 3);
    expect(progColor).toBe(PROGRESS_BAR_COLOR);

    bars.dispose();
  });
});

describe('W02: Reselection while a worker works, deposit reserves inspection, and cancelTask', () => {
  it('reselects units/buildings while a worker works and dispatches cancelTask', () => {
    const body = freshBody();
    const host = new LocalHost({ flags: ['W00', 'W01', 'W02'], radius: 16 });
    const hqId = spawnHqUnit(host.state, { owner: 0, q: 0, r: 0 });
    const harvId = spawnWorkerUnit(host.state, { owner: 0, q: 2, r: 0, tier: 1 });
    const bldgId = 88;
    const bRow = insertRow(host.state.entities, bldgId, host.tick);
    setField(host.state.entities, bRow, 'kind', ENTITY_KIND.solar, host.tick);
    setField(host.state.entities, bRow, 'owner', 0, host.tick);
    setField(host.state.entities, bRow, 'q', 1, host.tick);
    setField(host.state.entities, bRow, 'r', 0, host.tick);
    setField(host.state.entities, bRow, 'x', 1, host.tick);
    setField(host.state.entities, bRow, 'y', 0, host.tick);
    setField(host.state.entities, bRow, 'hp', 300, host.tick);
    setField(host.state.entities, bRow, 'hpMax', 300, host.tick);
    setField(host.state.entities, bRow, 'state', ENTITY_STATE.constructing, host.tick);
    setField(host.state.entities, bRow, 'progress', 0.45, host.tick);
    host.sync(true);

    const hudRoot = document.createElement('div');
    body.appendChild(hudRoot);
    const sendSpy = vi.spyOn(host.store, 'sendCommand');
    const mounted = mountLandfall({ hudRoot, store: host.store });

    const harvRow = rowOf(host.state.entities, harvId);
    setField(host.state.entities, harvRow, 'state', ENTITY_STATE.harvesting, host.tick);
    setField(host.state.entities, harvRow, 'progress', 0.5, host.tick);
    mounted.update(host.sync(false));

    expect(mounted.clickTile(2, 0)).toBe(true);
    expect(mounted.getSelectedEntityId()).toBe(harvId);
    const progBar = hudRoot.querySelector<HTMLElement>('[data-testid="hq-progress-bar"]')!;
    const cancelBtn = hudRoot.querySelector<HTMLButtonElement>('[data-testid="hq-panel-cancel"]')!;
    expect(progBar.style.width).toBe('50%');
    expect(cancelBtn.hidden).toBe(false);
    cancelBtn.click();
    expect(sendSpy).toHaveBeenCalledWith({ type: 'cancelTask', taskId: `worker:${harvId}` });

    expect(mounted.clickTile(1, 0)).toBe(true);
    expect(mounted.getSelectedEntityId()).toBe(bldgId);
    expect(cancelBtn.hidden).toBe(false);
    cancelBtn.click();
    expect(sendSpy).toHaveBeenCalledWith({ type: 'cancelTask', taskId: `building:${bldgId}` });

    expect(mounted.clickTile(0, 0)).toBe(true);
    expect(mounted.getSelectedEntityId()).toBe(hqId);
    mounted.dispose();
  });
});

describe('W02: Resource deposit inspection and right-click move', () => {
  it('inspects resource deposits on left-click, updates reserves/stage live, and allows right-click move to deposit', () => {
    const body = freshBody();
    const host = new LocalHost({ flags: ['W00', 'W01', 'W02'], radius: 16 });
    const hqId = spawnHqUnit(host.state, { owner: 0, q: 0, r: 0 });
    const hx = hexIndex(host.state.grid.radius);
    const depIdx = hx.indexOf(4, 0);
    setTileDeposit(host.state.grid, depIdx, DEPOSIT.metals);
    host.sync(true);

    const hudRoot = document.createElement('div');
    body.appendChild(hudRoot);
    const sendSpy = vi.spyOn(host.store, 'sendCommand');
    const mounted = mountLandfall({ hudRoot, store: host.store });

    expect(mounted.handleRightClick(4, 0)).toBe(true);
    expect(sendSpy).toHaveBeenCalledWith({ type: 'moveUnit', entityId: hqId, q: 4, r: 0 });

    expect(mounted.clickTile(4, 0)).toBe(true);
    expect(mounted.getSelectedEntityId()).toBeNull();
    expect(mounted.getSelectedDeposit()).toEqual({
      q: 4, r: 0, deposit: DEPOSIT.metals, tier: 1, richness: 10000, remaining: 500, maxUnits: 500, stage: 'full',
    });
    expect(hudRoot.querySelector('[data-testid="selection-slot"]')?.textContent).toBe('FE');
    expect(hudRoot.querySelector('[data-testid="hq-title"]')?.textContent).toBe('IRON DEPOSIT · T1');
    expect(hudRoot.querySelector('[data-testid="hq-hp"]')?.textContent).toBe('500 / 500');
    expect(hudRoot.querySelector('.ta-hq-panel__key')?.textContent).toBe('RESERVES');
    expect(hudRoot.querySelector<HTMLElement>('[data-testid="selection-count"]')?.hidden).toBe(true); // stage shown once, in the footer
    expect(hudRoot.querySelector('[data-testid="hq-job"]')?.textContent).toBe('FULL');
    expect(hudRoot.querySelector('[data-testid="hq-queue"]')?.textContent).toBe('(4, 0)');

    host.state.grid.layers.richness![depIdx] = 5000;
    if (host.state.grid.changedAt) host.state.grid.changedAt[depIdx] = host.state.meta.tick + 1;
    host.step();
    mounted.update(host.sync(true));
    expect(mounted.getSelectedDeposit()?.remaining).toBe(250);
    expect(mounted.getSelectedDeposit()?.stage).toBe('half');
    expect(hudRoot.querySelector('[data-testid="hq-hp"]')?.textContent).toBe('250 / 500');
    expect(hudRoot.querySelector('[data-testid="hq-job"]')?.textContent).toBe('HALF');

    const norm = extractSelectableEntities({
      units: { byId: { '55': { id: 55, q: 3, r: -1, hp: 160, hpMax: 160 } } },
      workers: { '55': { progress: 0.75, state: 'harvesting' } },
    });
    expect(norm.get(55)?.x).toBe(3);
    expect(norm.get(55)?.y).toBe(-1);
    expect(norm.get(55)?.progress).toBe(0.75);

    mounted.dispose();
  });
});

describe('CANCEL on a unit doing a terraform job', () => {
  it('unitHasTerraformJob reads the unit command (current/queued) and open work jobs, nothing else', () => {
    const view = (units: unknown, workJobs?: unknown) => ({ blobs: { units: { byId: units }, workJobs } });
    const tf = { kind: 'terraform', source: 'auto', orderId: 'o1', q: 1, r: 0 };
    expect(unitHasTerraformJob(view({ 7: { current: tf, queue: [] } }), 7)).toBe(true);
    expect(unitHasTerraformJob(view({ 7: { current: null, queue: [tf] } }), 7)).toBe(true);
    expect(unitHasTerraformJob(view({ 7: { current: { kind: 'move' }, queue: [] } }), 7)).toBe(false);
    expect(unitHasTerraformJob(view({ 8: { current: tf, queue: [] } }), 7)).toBe(false);
    expect(unitHasTerraformJob(view({}, { byId: { j: { workerEntityId: 7 } } }), 7)).toBe(true);
    expect(unitHasTerraformJob(null, 7)).toBe(false);
  });

  it('an otherwise idle-looking HQ with a terraform command shows CANCEL JOB and cancels via its unit id', () => {
    const body = freshBody();
    const host = new LocalHost({ flags: ['W00', 'W01', 'W02'], radius: 16 });
    const hqId = spawnHqUnit(host.state, { owner: 0, q: 0, r: 0 });
    host.sync(true);
    const hudRoot = document.createElement('div');
    body.appendChild(hudRoot);
    const sendSpy = vi.spyOn(host.store, 'sendCommand');
    const mounted = mountLandfall({ hudRoot, store: host.store });
    expect(mounted.clickTile(0, 0)).toBe(true);
    const cancelBtn = hudRoot.querySelector<HTMLButtonElement>('[data-testid="hq-panel-cancel"]')!;
    expect(cancelBtn.hidden).toBe(true);
    const view = host.sync(false) as { blobs: Record<string, unknown> };
    view.blobs = { ...view.blobs, units: { byId: { [hqId]: { current: { kind: 'terraform', source: 'auto', orderId: 'tf1', q: 1, r: 0 }, queue: [] } } } };
    mounted.update(view as never);
    expect(cancelBtn.hidden).toBe(false);
    expect(cancelBtn.textContent).toBe('CANCEL JOB');
    cancelBtn.click();
    expect(sendSpy).toHaveBeenCalledWith({ type: 'cancelTask', taskId: `worker:${hqId}` });
    mounted.dispose();
  });
});

describe('CANCEL JOB: one command per click; the Command Hub cancels only its running Units-lane job', () => {
  it('store and bus both set (the online wiring) -> exactly one cancelTask, through the store', () => {
    freshBody();
    const host = new LocalHost({ flags: ['W00', 'W01', 'W02'], radius: 16 });
    const harvId = spawnWorkerUnit(host.state, { owner: 0, q: 2, r: 0, tier: 1 });
    host.sync(true);
    const storeSpy = vi.spyOn(host.store, 'sendCommand');
    const busSpy = vi.fn(async () => ({ ok: true as const, appliedAtTick: 1 }));
    const mounted = mountLandfall({ hudRoot: document.createElement('div'), store: host.store, sendCommand: busSpy });
    mounted.update(host.sync(false));
    expect(mounted.clickTile(2, 0)).toBe(true);
    expect(mounted.getSelectedEntityId()).toBe(harvId);
    mounted.controller.cancelSelected();
    expect(storeSpy.mock.calls.filter(([c]) => (c as { type?: string }).type === 'cancelTask')).toHaveLength(1);
    expect(busSpy).not.toHaveBeenCalled();
    mounted.dispose();
  });

  it('hubUnitsLaneTaskId names the own colony\'s running (else next) Units entry, never "all"', () => {
    const view = {
      colonies: [
        { index: 0, queue: [{ taskId: 'b-1', lane: 'construction', state: 'in_progress' }, { taskId: 'u-2', lane: 'units', state: 'waiting' }] },
        { index: 1, queue: [{ taskId: 'u-9', lane: 'units', state: 'in_progress' }] },
      ],
    };
    expect(hubUnitsLaneTaskId(view, 0)).toBe('u-2'); // nothing running: the next queued Units entry, never construction
    expect(hubUnitsLaneTaskId({ colonies: [{ index: 0, queue: [] }] }, 0)).toBeNull();
    expect(hubUnitsLaneTaskId(view, 1)).toBe('u-9');
  });
});

describe('building hit test matches the sim footprint (getBuildingFootprintTiles)', () => {
  it('a 2x2 Extractor at (3, 0) covers exactly (3..4, 0..1): the deposit west / north of it stays clickable', () => {
    const ext = { kind: ENTITY_KIND.metalsExtractor, q: 3, r: 0, x: 3.5, y: 0.5, footprintW: 2, footprintD: 2 } as unknown as Parameters<typeof isBuildingCoveringTile>[0];
    const covered: string[] = [];
    for (let r = -2; r <= 3; r++) for (let q = 1; q <= 6; q++) if (isBuildingCoveringTile(ext, q, r)) covered.push(`${q},${r}`);
    expect(covered.sort()).toEqual(['3,0', '3,1', '4,0', '4,1']);
  });
});
