// @vitest-environment jsdom
import * as THREE from 'three';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { parseWaves } from '@terra/contracts';
import type { ColonyViewport } from '@terra/render/core/createColonyViewport';
import { createArchetypeMesh } from '@terra/render/kitbash';
import { tileXZ } from '@terra/render/planets/hex';
import {
  ENTITY_KIND,
  ENTITY_STATE,
  ensureColonyRecord,
  insertRow,
  placeSpawnedEntity,
  setBlob,
  spawnHqUnit,
} from '@terra/sim';
import { EntityMeshes } from '../../../app/online/EntityMeshes';
import { HudRoot } from '../../../core/hud/HudRoot';
import { resetGameInputBlock } from '../../../core/input/gameInputBlock';
import type { FeatureServices } from '../../../core/registry/types';
import { LocalHost } from '../../../store/local/LocalHost';
import type { ClientView } from '../../../store/replica/viewCodec';
import landfallFeature from '../../landfall';
import mouseCursorFeature from '../../mouse-cursor';
import type { TileCoord } from '../../shared/pointer';
import armyFeature from '../index';

beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

function spawnRow(
  host: LocalHost,
  opts: { kind: number; owner: number; q: number; r: number; hp?: number },
): number {
  const state = host.state;
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, state.meta.tick);
  state.entities.cols.kind[row] = opts.kind;
  state.entities.cols.owner[row] = opts.owner;
  state.entities.cols.hp[row] = opts.hp ?? 320;
  state.entities.cols.hpMax[row] = opts.hp ?? 320;
  state.entities.cols.state[row] = ENTITY_STATE.idle;
  placeSpawnedEntity(state.entities, row, opts.q, opts.r, state.meta.tick);
  return id;
}

function seedCombatArenaEntities(host: LocalHost) {
  ensureColonyRecord(host.state, 0, 0);
  ensureColonyRecord(host.state, 1, 0);
  const hqId = spawnHqUnit(host.state, { owner: 0, q: 0, r: 0 });
  const tank1 = spawnRow(host, { kind: ENTITY_KIND.demoTank, owner: 0, q: 1, r: 0, hp: 520 });
  const recon1 = spawnRow(host, { kind: ENTITY_KIND.recon, owner: 0, q: 2, r: 0, hp: 240 });
  const turret1 = spawnRow(host, { kind: ENTITY_KIND.autocannon, owner: 0, q: -2, r: 0, hp: 420 });
  const enemyTank = spawnRow(host, { kind: ENTITY_KIND.demoTank, owner: 1, q: 5, r: 0, hp: 520 });
  const enemyHub = spawnRow(host, { kind: ENTITY_KIND.commandHub, owner: 1, q: 9, r: -1, hp: 1500 });
  const bugId = spawnRow(host, { kind: ENTITY_KIND.blackAnt, owner: -1, q: 6, r: 1, hp: 120 });
  const hiveId = spawnRow(host, { kind: ENTITY_KIND.hiveBlackAnt, owner: -1, q: 11, r: 0, hp: 1500 });
  host.sync(true);
  const ids = { hqId, tank1, recon1, turret1, enemyTank, enemyHub, bugId, hiveId };
  const picks = new Map<string, TileCoord>([
    ['10,10', { q: 1, r: 0, entityId: tank1 }],
    ['20,10', { q: 2, r: 0, entityId: recon1 }],
    ['30,10', { q: -2, r: 0, entityId: turret1 }],
    ['40,10', { q: 0, r: 0, entityId: hqId }],
    ['50,10', { q: 4, r: -1, entityId: enemyTank }],
    ['60,10', { q: 7, r: -3, entityId: enemyHub }],
    ['70,10', { q: 6, r: 1, entityId: bugId }],
    ['80,10', { q: 11, r: 0, entityId: hiveId }],
    ['90,90', { q: 4, r: 4 }],
  ]);
  return { ids, picks };
}

function makeHarness(spectator = false) {
  document.body.replaceChildren();
  const flagsList = [...parseWaves('..07').list];
  const host = new LocalHost({ flags: flagsList, radius: 16 });
  const { ids, picks } = seedCombatArenaEntities(host);
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);

  const scene = new THREE.Scene();
  const entities = new EntityMeshes(scene, (id, biome) => createArchetypeMesh(id, biome));
  entities.setFullVision(true);

  const sendCommand = vi.fn(async (kind: string, args?: unknown) => {
    host.store.sendCommand(kind, args);
    return { ok: true as const, appliedAtTick: host.tick };
  });
  const services: Partial<FeatureServices> = {
    store: host.store, sendCommand, canvas, surface: canvas,
    pickTile: (cx, cy) => picks.get(`${cx},${cy}`) ?? null,
    colonyId: 0, isSpectator: () => spectator,
    syncCombatSelection: (selIds, opts) => entities.setSelectedUnitIds(selIds, opts),
    track: () => {},
  };

  const flags = new Set(flagsList);
  const hud = new HudRoot(document.body, [landfallFeature, armyFeature, mouseCursorFeature], {
    flags, host: 'local', services: services as FeatureServices,
  });
  const cursorRenderer = mouseCursorFeature.renderers![0]!.mount({
    flags, host: 'local', services: services as FeatureServices,
  });
  const syncAll = () => {
    const v = host.sync(true);
    entities.syncView(v as ClientView, null, 'dune');
    entities.update(0.05, null);
    hud.update(v);
    cursorRenderer.update(v, 0.016);
    services.landfall?.onView(v);
    entities.setSelectedEntityId(services.landfall?.getSelectedEntityId() ?? null);
  };
  syncAll();

  const clickAt = (cx: number, cy: number, button = 0, shiftKey = false) => {
    canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: cx, clientY: cy, shiftKey, bubbles: true }));
    canvas.dispatchEvent(new MouseEvent('pointerdown', { button, clientX: cx, clientY: cy, shiftKey, bubbles: true }));
    canvas.dispatchEvent(new MouseEvent('pointerup', { button, clientX: cx, clientY: cy, shiftKey, bubbles: true }));
  };
  const hoverAt = (cx: number, cy: number) => {
    canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: cx, clientY: cy, bubbles: true }));
  };

  return {
    host, scene, entities, canvas, hud, cursorRenderer, sendCommand,
    services: services as FeatureServices, ids, syncAll, clickAt, hoverAt,
    dispose() { cursorRenderer.dispose(); hud.dispose(); entities.dispose(); },
  };
}

function setMockTargets(host: LocalHost, tick: number, byId: Record<number, { q: number; r: number; targetId: number }>) {
  const byEntityId: Record<number, unknown> = {};
  for (const [idStr, info] of Object.entries(byId)) {
    const id = Number(idStr);
    byEntityId[id] = { entityId: id, stance: 'defend', anchorQ: info.q, anchorR: info.r, targetId: info.targetId };
  }
  setBlob(host.state, 'combatStances', { byEntityId }, tick);
}

describe('Attack clicks, 3D entity picking & cursor stability', () => {
  afterEach(() => { resetGameInputBlock(); document.body.replaceChildren(); });

  it('left-click and right-click on 3D entity-picked enemies (bot, building, insect, hive) dispatch attackTarget without moving or deselecting', () => {
    const h = makeHarness();
    const army = h.services.armyOrders!;
    const cursor = h.services.mouseCursor!;

    h.clickAt(10, 10, 0);
    expect(army.getSelectedEntityIds()).toEqual([h.ids.tank1]);
    h.hoverAt(50, 10);
    expect(cursor.getState()).toBe('attack');

    h.clickAt(50, 10, 0);
    expect(h.sendCommand).toHaveBeenLastCalledWith('attackTarget', { unitIds: [h.ids.tank1], targetId: h.ids.enemyTank });
    expect(army.getSelectedEntityIds()).toEqual([h.ids.tank1]);
    expect(cursor.getState()).toBe('attack');
    expect(h.entities.targetSelection.activeTargetIds()).toEqual([h.ids.enemyTank]);

    h.hoverAt(60, 10);
    expect(cursor.getState()).toBe('attack');
    h.clickAt(60, 10, 0);
    expect(h.sendCommand).toHaveBeenLastCalledWith('attackTarget', { unitIds: [h.ids.tank1], targetId: h.ids.enemyHub });
    expect(h.entities.targetSelection.activeTargetIds()).toEqual([h.ids.enemyHub]);

    h.clickAt(80, 10, 2);
    expect(h.sendCommand).toHaveBeenLastCalledWith('attackTarget', { unitIds: [h.ids.tank1], targetId: h.ids.hiveId });
    expect(h.entities.targetSelection.activeTargetIds()).toEqual([h.ids.hiveId]);

    h.clickAt(30, 10, 0);
    h.entities.setSelectedEntityId(h.ids.turret1);
    h.hoverAt(70, 10);
    expect(cursor.getState()).toBe('attack');
    h.clickAt(70, 10, 0);
    expect(h.sendCommand).toHaveBeenLastCalledWith('attackTarget', { unitIds: [h.ids.turret1], targetId: h.ids.bugId });
    expect(h.entities.targetSelection.activeTargetIds()).toEqual([h.ids.bugId]);

    const sendCountBefore = h.sendCommand.mock.calls.length;
    h.clickAt(90, 90, 2);
    expect(h.sendCommand.mock.calls.length).toBe(sendCountBefore);
    h.dispose();
  });

  it('rejects attack clicks in read-only spectator mode', () => {
    const h = makeHarness(true);
    h.services.landfall!.selectEntity(h.ids.tank1);
    h.clickAt(50, 10, 0);
    expect(h.sendCommand).not.toHaveBeenCalled();
    expect(h.services.mouseCursor!.getState()).toBe('idle');
    h.dispose();
  });
});

describe('3D Red Target Selection Marker & 3D Viewport Raycast', () => {
  afterEach(() => { resetGameInputBlock(); document.body.replaceChildren(); });

  it('tracks battle/stance targets on selection, scales to footprint, and deduplicates squad targets', () => {
    const h = makeHarness();
    const army = h.services.armyOrders!;
    expect(h.entities.targetSelection.activeTargetIds()).toEqual([]);

    army.selectUnits([h.ids.tank1, h.ids.recon1]);
    setMockTargets(h.host, 2, {
      [h.ids.tank1]: { q: 1, r: 0, targetId: h.ids.enemyHub },
      [h.ids.recon1]: { q: 2, r: 0, targetId: h.ids.bugId },
    });
    h.syncAll();
    expect(h.entities.targetSelection.activeTargetIds()).toEqual([h.ids.enemyHub, h.ids.bugId]);
    const hubSlotScale = h.entities.targetSelection.group.children[0]!.children[0]!.scale.x;
    const bugSlotScale = h.entities.targetSelection.group.children[1]!.children[0]!.scale.x;
    expect(hubSlotScale).toBeGreaterThan(bugSlotScale);

    setMockTargets(h.host, 3, {
      [h.ids.tank1]: { q: 1, r: 0, targetId: h.ids.enemyTank },
      [h.ids.recon1]: { q: 2, r: 0, targetId: h.ids.enemyTank },
    });
    h.syncAll();
    expect(h.entities.targetSelection.activeTargetIds()).toEqual([h.ids.enemyTank]);
    h.dispose();
  });

  it('clears red target reticle on move order, target death, or deselection', () => {
    const h = makeHarness();
    const army = h.services.armyOrders!;

    army.selectUnits([h.ids.tank1]);
    h.clickAt(50, 10, 0);
    expect(h.entities.targetSelection.activeTargetIds()).toEqual([h.ids.enemyTank]);

    h.clickAt(90, 90, 2);
    expect(h.sendCommand).toHaveBeenCalledWith('moveUnit', { entityId: h.ids.tank1, q: 4, r: 4 });
    expect(h.entities.targetSelection.activeTargetIds()).toEqual([]);

    setMockTargets(h.host, 4, { [h.ids.tank1]: { q: 1, r: 0, targetId: h.ids.enemyTank } });
    for (let r = 0; r < h.host.state.entities.count; r++) {
      if (h.host.state.entities.cols.id[r] === h.ids.enemyTank) h.host.state.entities.cols.hp[r] = 0;
    }
    h.syncAll();
    expect(h.entities.targetSelection.activeTargetIds()).toEqual([]);

    h.clickAt(60, 10, 0);
    expect(h.entities.targetSelection.activeTargetIds()).toEqual([h.ids.enemyHub]);
    army.selectUnits([]);
    h.syncAll();
    expect(h.entities.targetSelection.activeTargetIds()).toEqual([]);
    h.dispose();
  });

  it('pickAtViewport raycasts onto elevated 3D enemy silhouette even above empty ground behind it', () => {
    const h = makeHarness();
    const rec = h.entities.getRecord(h.ids.enemyHub)!;
    const [wx, wz] = tileXZ(9, -1);
    rec.mesh.position.set(wx, 0, wz);
    rec.mesh.updateMatrixWorld(true);

    const dom = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 600, right: 1000, bottom: 600 }) };
    const cam = new THREE.PerspectiveCamera(28, 1000 / 600, 0.1, 300);
    cam.position.set(wx + 12, 16, wz + 22);
    cam.lookAt(wx, 1.5, wz);
    cam.updateMatrixWorld(true);

    const topWorld = new THREE.Vector3(wx, 2.2, wz).project(cam);
    const picked = h.entities.pickAtViewport(
      { camera: cam, renderer: { domElement: dom } } as unknown as ColonyViewport,
      null,
      ((topWorld.x + 1) / 2) * 1000,
      ((1 - topWorld.y) / 2) * 600,
    );
    expect(picked?.entityId).toBe(h.ids.enemyHub);
    expect(picked?.q).toBe(9);
    expect(picked?.r).toBe(-1);

    expect(
      h.entities.pickAtViewport({ camera: cam, renderer: { domElement: dom } } as unknown as ColonyViewport, null, 10, 10),
    ).toBeNull();
    h.dispose();
  });
});
