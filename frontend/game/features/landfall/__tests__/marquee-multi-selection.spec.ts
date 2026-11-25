// @vitest-environment jsdom
import * as THREE from 'three';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  ENTITY_KIND,
  ENTITY_STATE,
  ensureColonyRecord,
  hexIndex,
  insertRow,
  placeSpawnedEntity,
  setTileTerrain,
  TERRAIN,
} from '@terra/sim';
import { resetGameInputBlock } from '../../../core/input/gameInputBlock';
import { HudRoot } from '../../../core/hud/HudRoot';
import type { FeatureServices } from '../../../core/registry/types';
import { LocalHost } from '../../../store/local/LocalHost';
import { packEntities, type ClientView } from '../../../store/replica/viewCodec';
import { EntityMeshes } from '../../../app/online/EntityMeshes';
import { pickEntityAtViewport } from '../../../app/online/parts/entityPicking';
import type { EntityMeshRecord } from '../../../app/online/EntityMeshRecord';
import armyFeature from '../../army';
import mouseCursorFeature from '../../mouse-cursor';
import landfallFeature from '../index';

beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

function spawnEntity(
  host: LocalHost,
  opts: { kind: number; owner: number; q: number; r: number; hp?: number },
): number {
  const state = host.state;
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, state.meta.tick);
  state.entities.cols.kind[row] = opts.kind;
  state.entities.cols.owner[row] = opts.owner;
  state.entities.cols.hp[row] = opts.hp ?? 200;
  state.entities.cols.hpMax[row] = opts.hp ?? 200;
  state.entities.cols.state[row] = ENTITY_STATE.idle;
  placeSpawnedEntity(state.entities, row, opts.q, opts.r, state.meta.tick);
  return id;
}

function setupMarqueeHarness() {
  document.body.replaceChildren();
  const host = new LocalHost({ flags: [...parseWaves('..07').list], radius: 14 });
  ensureColonyRecord(host.state, 0, 0);
  host.state.grid.layers.terrain.fill(TERRAIN.flat);
  const hx = hexIndex(host.state.grid.radius);
  setTileTerrain(host.state.grid, hx.indexOf(6, 0), TERRAIN.rock, 0);

  const worker1 = spawnEntity(host, { kind: ENTITY_KIND.worker, owner: 0, q: 1, r: 0, hp: 160 });
  const worker2 = spawnEntity(host, { kind: ENTITY_KIND.worker, owner: 0, q: 2, r: 0, hp: 160 });
  const recon1 = spawnEntity(host, { kind: ENTITY_KIND.recon, owner: 0, q: 1, r: 1, hp: 240 });
  const tank1 = spawnEntity(host, { kind: ENTITY_KIND.demoTank, owner: 0, q: 2, r: 1, hp: 520 });
  const hub1 = spawnEntity(host, { kind: ENTITY_KIND.commandHub, owner: 0, q: 1, r: 2, hp: 1500 });
  const solar1 = spawnEntity(host, { kind: ENTITY_KIND.solar, owner: 0, q: -4, r: 0, hp: 450 });
  host.sync(true);

  const canvas = document.createElement('canvas');
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
    left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect);
  document.body.appendChild(canvas);

  // Map screen coordinates deterministically: q = floor(cx / 40) - 5, r = floor(cy / 40) - 2
  const pickTile = (cx: number, cy: number) => ({
    q: Math.floor(cx / 40) - 5,
    r: Math.floor(cy / 40) - 2,
  });

  const sentCommands: Array<unknown> = [];
  const origSend = host.store.sendCommand.bind(host.store);
  vi.spyOn(host.store, 'sendCommand').mockImplementation((cmd: unknown, args?: unknown) => {
    sentCommands.push(args !== undefined ? { type: cmd, ...(args as object) } : cmd);
    return origSend(cmd as string, args);
  });
  const sendCommand = vi.fn(async (kind: string, args?: unknown) => {
    sentCommands.push({ type: kind, ...(args as object) });
    origSend(kind, args);
    return { ok: true as const, appliedAtTick: host.tick };
  });

  const services: Partial<FeatureServices> = {
    store: host.store,
    sendCommand,
    canvas,
    surface: canvas,
    pickTile,
    colonyId: 0,
    track: () => {},
  };

  const flags = new Set(parseWaves('..07').list);
  const hud = new HudRoot(document.body, [landfallFeature, armyFeature, mouseCursorFeature], {
    flags,
    host: 'local',
    services: services as FeatureServices,
  });
  const cursorRenderer = mouseCursorFeature.renderers![0]!.mount({
    flags,
    host: 'local',
    services: services as FeatureServices,
  });
  hud.update(host.store.latest!);
  cursorRenderer.update(host.store.latest!, 0.016);

  return {
    host, canvas, hud, cursorRenderer, services: services as FeatureServices,
    sentCommands,
    worker1, worker2, recon1, tank1, hub1, solar1,
    dispose: () => {
      cursorRenderer.dispose();
      hud.dispose();
    },
  };
}

describe('Left-drag marquee multi-unit selection & unit-over-building priority', () => {
  afterEach(() => {
    resetGameInputBlock();
    document.body.replaceChildren();
  });

  it('draws marquee box on left-drag, prioritizes units over buildings, and ignores trailing synthetic click', () => {
    const h = setupMarqueeHarness();
    const { canvas, services, worker1, worker2, recon1, tank1, hub1 } = h;

    // Drag across q=[0..3], r=[-1..3] (cx: 220..340, cy: 60..220), covering workers, combat units, AND commandHub
    canvas.dispatchEvent(new MouseEvent('pointerdown', { button: 0, buttons: 1, clientX: 220, clientY: 60, bubbles: true }));
    canvas.dispatchEvent(new MouseEvent('pointermove', { button: 0, buttons: 1, clientX: 340, clientY: 220, bubbles: true }));

    const marqueeEl = document.body.querySelector<HTMLElement>('[data-testid="marquee-selection-box"]')!;
    expect(marqueeEl).toBeTruthy();
    expect(marqueeEl.parentElement).toBe(document.body);
    expect(marqueeEl.style.left).toBe('220px');
    expect(marqueeEl.style.top).toBe('60px');
    expect(marqueeEl.style.width).toBe('120px');
    expect(marqueeEl.style.height).toBe('160px');
    expect(marqueeEl.hidden).toBe(false);
    expect(services.mouseCursor!.getState()).toBe('select');

    window.dispatchEvent(new MouseEvent('pointerup', { button: 0, buttons: 0, clientX: 340, clientY: 220, bubbles: true }));
    // Synthetic click immediately following pointerup on empty corner tile must be suppressed
    canvas.dispatchEvent(new MouseEvent('click', { button: 0, clientX: 340, clientY: 220, bubbles: true }));
    expect(marqueeEl.hidden).toBe(true);

    const selected = services.landfall!.getSelectedEntityIds();
    expect(selected).toEqual(expect.arrayContaining([worker1, worker2, recon1, tank1]));
    expect(selected).not.toContain(hub1);
    expect(services.armyOrders!.getSelectedEntityIds()).toEqual(expect.arrayContaining([recon1, tank1]));
    expect(document.body.querySelector('[data-testid="selection-count"]')?.textContent).toBe('4');

    h.dispose();
  });

  it('selects closest building when drag contains only buildings, supports Shift-additive unit drag, and deselects on empty drag', () => {
    const h = setupMarqueeHarness();
    const { canvas, services, worker1, recon1, solar1, hub1 } = h;

    // 1. Drag over ONLY solar1 at q=-4, r=0 (cx around 40..75, cy around 70..110) -> selects solar1 building
    canvas.dispatchEvent(new MouseEvent('pointerdown', { button: 0, buttons: 1, clientX: 35, clientY: 70, bubbles: true }));
    canvas.dispatchEvent(new MouseEvent('pointermove', { button: 0, buttons: 1, clientX: 75, clientY: 110, bubbles: true }));
    window.dispatchEvent(new MouseEvent('pointerup', { button: 0, buttons: 0, clientX: 75, clientY: 110, bubbles: true }));
    expect(services.landfall!.getSelectedEntityIds()).toEqual([solar1]);

    // 2. Select worker1, then Shift-drag over recon1 + hub1 -> adds recon1, drops building hub1, keeps worker1
    services.landfall!.selectEntity(worker1);
    canvas.dispatchEvent(new MouseEvent('pointerdown', { button: 0, buttons: 1, clientX: 235, clientY: 115, shiftKey: true, bubbles: true }));
    canvas.dispatchEvent(new MouseEvent('pointermove', { button: 0, buttons: 1, clientX: 270, clientY: 185, shiftKey: true, bubbles: true }));
    window.dispatchEvent(new MouseEvent('pointerup', { button: 0, buttons: 0, clientX: 270, clientY: 185, shiftKey: true, bubbles: true }));
    expect(services.landfall!.getSelectedEntityIds()).toEqual([worker1, recon1]);
    expect(services.landfall!.getSelectedEntityIds()).not.toContain(hub1);

    // 3. Empty drag without Shift deselects all
    canvas.dispatchEvent(new MouseEvent('pointerdown', { button: 0, buttons: 1, clientX: 5, clientY: 5, bubbles: true }));
    canvas.dispatchEvent(new MouseEvent('pointermove', { button: 0, buttons: 1, clientX: 25, clientY: 25, bubbles: true }));
    window.dispatchEvent(new MouseEvent('pointerup', { button: 0, buttons: 0, clientX: 25, clientY: 25, bubbles: true }));
    expect(services.landfall!.getSelectedEntityIds()).toEqual([]);

    h.dispose();
  });
});

describe('Multi-unit movement orders, stop hotkey, and selection rings', () => {
  afterEach(() => {
    resetGameInputBlock();
    document.body.replaceChildren();
  });

  it('dispatches moveGroup for multi-worker right-click, blocks impassable rock right-click, and stops all selected units on X', () => {
    const h = setupMarqueeHarness();
    const { canvas, services, sentCommands, worker1, worker2 } = h;

    services.landfall!.selectEntities([worker1, worker2]);
    expect(document.body.querySelector('[data-testid="hq-title"]')?.textContent).toBe('WORKER CREW');

    // Right-click impassable rock at q=6, r=0 (cx = 445, cy = 90) -> rejected cleanly with zero move commands
    canvas.dispatchEvent(new MouseEvent('contextmenu', { clientX: 445, clientY: 90, bubbles: true }));
    expect(sentCommands).toHaveLength(0);

    // Right-click passable ground at q=3, r=0 (cx = 330, cy = 90) -> dispatches moveGroup
    canvas.dispatchEvent(new MouseEvent('contextmenu', { clientX: 330, clientY: 90, bubbles: true }));
    expect(sentCommands).toContainEqual({
      type: 'moveGroup',
      entityIds: [worker1, worker2],
      q: 3,
      r: 0,
    });

    // Press X -> stops every selected unit
    sentCommands.length = 0;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', code: 'KeyX', bubbles: true }));
    expect(sentCommands).toEqual([
      { type: 'stopUnit', entityId: worker1 },
      { type: 'stopUnit', entityId: worker2 },
    ]);

    // Single-unit right-click directly onto another friendly unit's hex routes to nearest free adjacent hex
    sentCommands.length = 0;
    services.landfall!.selectEntity(worker1);
    // worker2 sits on q=2, r=0 -> cx = 290, cy = 90 -> floor(290/40)-5 = 2, floor(90/40)-2 = 0
    canvas.dispatchEvent(new MouseEvent('contextmenu', { clientX: 290, clientY: 90, bubbles: true }));
    expect(sentCommands).toHaveLength(1);
    const redirected = sentCommands[0] as { type: string; entityId: number; q: number; r: number };
    expect(redirected.type).toBe('moveUnit');
    expect(redirected.entityId).toBe(worker1);
    expect(`${redirected.q},${redirected.r}`).not.toBe('2,0');

    h.dispose();
  });

  it('renders ground selection rings for all selected units in EntityMeshes', () => {
    const scene = new THREE.Scene();
    const entities = new EntityMeshes(scene);
    const rows = [
      { id: 1, kind: ENTITY_KIND.worker, owner: 0, q: 0, r: 0, x: 0, y: 0, rot: 0, hp: 160, hpMax: 160, state: ENTITY_STATE.idle, progress: 1, tier: 1 },
      { id: 2, kind: ENTITY_KIND.recon, owner: 0, q: 2, r: 0, x: 2, y: 0, rot: 0, hp: 240, hpMax: 240, state: ENTITY_STATE.idle, progress: 1, tier: 1 },
      { id: 3, kind: ENTITY_KIND.demoTank, owner: 0, q: 3, r: 1, x: 3, y: 1, rot: 0, hp: 520, hpMax: 520, state: ENTITY_STATE.idle, progress: 1, tier: 1 },
    ];
    const view = {
      tick: 1,
      planet: { id: 'pl_rings', type: 'temperate', radius: 12, seed: 'ring-seed' },
      count: rows.length,
      entities: packEntities(rows as unknown as Parameters<typeof packEntities>[0]),
      colonies: [{ index: 0, id: 'col_0', status: 'active' }],
    } as unknown as ClientView;

    const mockTerrain = { radius: 12, heightAt: () => 0, tileHeightAt: () => 0 } as unknown as Parameters<EntityMeshes['syncView']>[1];
    entities.syncView(view, mockTerrain, 'forestRock');
    entities.setSelectedEntityIds([1, 2, 3]);

    const visibleRings = scene.children.filter(
      (c) => c.visible && c.name.startsWith('selection-ring'),
    );
    expect(visibleRings).toHaveLength(3);

    entities.setSelectedEntityIds([]);
    const afterClear = scene.children.filter(
      (c) => c.visible && c.name.startsWith('selection-ring'),
    );
    expect(afterClear).toHaveLength(0);
    entities.dispose();
  });
});

describe('Viewport 3D unit-over-building raycast priority and Shift+click additive selection', () => {
  it('strictly prioritizes unit meshes over closer tall building roofs in pickEntityAtViewport and supports Shift+click worker selection', () => {
    const cam = new THREE.PerspectiveCamera(28, 1, 0.1, 200);
    cam.position.set(0, 12, 12);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld(true);
    const dom = document.createElement('canvas');
    vi.spyOn(dom, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, right: 200, bottom: 200, width: 200, height: 200, x: 0, y: 0, toJSON: () => ({}),
    });

    const roofMesh = new THREE.Mesh(new THREE.BoxGeometry(2.4, 3.6, 2.4), new THREE.MeshBasicMaterial());
    roofMesh.position.set(0, 1.8, 1.8);
    roofMesh.updateMatrixWorld(true);
    const unitMesh = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), new THREE.MeshBasicMaterial());
    unitMesh.position.set(0, 0.45, 0);
    unitMesh.updateMatrixWorld(true);

    const records = [
      { id: 100, kind: ENTITY_KIND.commandHub, owner: 0, q: 0, r: 1, x: 0, y: 1, hp: 1500, state: ENTITY_STATE.active, mesh: roofMesh },
      { id: 200, kind: ENTITY_KIND.worker, owner: 0, q: 0, r: 0, x: 0, y: 0, hp: 160, state: ENTITY_STATE.idle, mesh: unitMesh },
    ] as unknown as EntityMeshRecord[];

    const picked = pickEntityAtViewport(
      records,
      () => false,
      null,
      { camera: cam, renderer: { domElement: dom } } as never,
      100,
      100,
    );
    expect(picked?.entityId).toBe(200);

    // Shift+left-click toggles second worker into multi-selection instead of issuing a move onto the worker's hex
    const host = new LocalHost({ flags: [...parseWaves('..07').list], radius: 12 });
    ensureColonyRecord(host.state, 0, 0);
    const w1 = spawnEntity(host, { kind: ENTITY_KIND.worker, owner: 0, q: 1, r: 0, hp: 160 });
    const w2 = spawnEntity(host, { kind: ENTITY_KIND.worker, owner: 0, q: 2, r: 0, hp: 160 });
    const v = host.sync(true);
    const services: Partial<FeatureServices> = { store: host.store, colonyId: 0, track: () => {} };
    const hud = new HudRoot(document.body, [landfallFeature, armyFeature], {
      flags: new Set(parseWaves('..07').list),
      host: 'local',
      services: services as FeatureServices,
    });
    hud.update(v);
    services.landfall!.clickTile(1, 0, false);
    expect(services.landfall!.getSelectedEntityIds()).toEqual([w1]);
    services.landfall!.clickTile(2, 0, true);
    expect(services.landfall!.getSelectedEntityIds()).toEqual([w1, w2]);
    services.landfall!.clickTile(1, 0, true);
    expect(services.landfall!.getSelectedEntityIds()).toEqual([w2]);
    hud.dispose();
  });
});
