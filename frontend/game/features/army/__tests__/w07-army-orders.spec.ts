// @vitest-environment jsdom
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { parseWaves } from '@terra/contracts';
import { ENTITY_KIND, ENTITY_STATE, insertRow, placeSpawnedEntity, rowOf, spawnHqUnit } from '@terra/sim';
import { HudRoot } from '../../../core/hud/HudRoot';
import { loadFeatures } from '../../../core/registry';
import type { FeatureServices } from '../../../core/registry/types';
import { LocalHost } from '../../../store/local/LocalHost';
import landfallFeature, { extractSelectableEntities } from '../../landfall';
import { normalizeKindCode } from '../../landfall/selectionHelpers';
import armyFeature, { mountArmy } from '../index';

function freshBody(): HTMLElement {
  document.body.replaceChildren();
  return document.body;
}

function spawnUnitInHost(
  host: LocalHost,
  opts: { kind: number; owner: number; q: number; r: number; hp?: number },
): number {
  const state = host.state;
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, state.meta.tick);
  state.entities.cols.kind[row] = opts.kind;
  state.entities.cols.owner[row] = opts.owner;
  state.entities.cols.hp[row] = opts.hp ?? 240;
  state.entities.cols.hpMax[row] = opts.hp ?? 240;
  state.entities.cols.state[row] = ENTITY_STATE.idle;
  placeSpawnedEntity(state.entities, row, opts.q, opts.r, state.meta.tick);
  return id;
}

describe('W07-19: Acceptance — shift-click 3 Recon, press A, click nest', () => {
  it('Shift-click 3 Recon units, press A, click the nest tile (q, r) -> order-feedback marker appears and units attack-move', () => {
    const body = freshBody();
    const host = new LocalHost({ flags: [...parseWaves('..07').list], radius: 16 });
    spawnHqUnit(host.state, { owner: 0, q: 0, r: 0 });
    const id1 = spawnUnitInHost(host, { kind: ENTITY_KIND.recon, owner: 0, q: 1, r: 0, hp: 240 });
    const id2 = spawnUnitInHost(host, { kind: ENTITY_KIND.recon, owner: 0, q: 2, r: 0, hp: 240 });
    const id3 = spawnUnitInHost(host, { kind: ENTITY_KIND.recon, owner: 0, q: 3, r: 0, hp: 240 });
    const hiveId = spawnUnitInHost(host, { kind: ENTITY_KIND.hiveBlackAnt, owner: -1, q: 10, r: -2, hp: 1500 });
    expect(hiveId).toBeGreaterThan(0);
    host.sync(true);

    const canvas = document.createElement('canvas');
    body.appendChild(canvas);
    const coords = new Map<string, { q: number; r: number }>([
      ['100,100', { q: 1, r: 0 }],
      ['200,100', { q: 2, r: 0 }],
      ['300,100', { q: 3, r: 0 }],
      ['500,200', { q: 10, r: -2 }],
    ]);
    const pickTile = (cx: number, cy: number) => coords.get(`${cx},${cy}`) ?? null;
    const sendCommand = vi.fn(async (kind: string, args?: unknown) => {
      host.store.sendCommand(kind, args);
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

    const hud = new HudRoot(body, [landfallFeature, armyFeature], {
      flags: new Set(parseWaves('..07').list),
      host: 'local',
      services: services as FeatureServices,
    });
    hud.update(host.store.latest!);

    const armyOrders = services.armyOrders!;
    for (const [cx, cy] of [[100, 100], [200, 100], [300, 100]] as const) {
      canvas.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: cx, clientY: cy, shiftKey: true, bubbles: true }));
      canvas.dispatchEvent(new MouseEvent('pointerup', { button: 0, clientX: cx, clientY: cy, shiftKey: true, bubbles: true }));
    }

    expect(armyOrders.getSelectedEntityIds()).toEqual([id1, id2, id3]);
    expect(body.querySelector<HTMLElement>('[data-testid="army-stance-panel"]')!.hidden).toBe(false);
    expect(body.querySelector('[data-testid="army-selected-count"]')?.textContent).toBe('3');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', bubbles: true }));
    expect(armyOrders.isAttackMoveArmed()).toBe(true);
    const atkMoveBtn = body.querySelector<HTMLButtonElement>('[data-attack-move-btn]')!;
    expect(atkMoveBtn.getAttribute('data-armed')).toBe('true');

    canvas.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 500, clientY: 200, bubbles: true }));
    canvas.dispatchEvent(new MouseEvent('pointerup', { button: 0, clientX: 500, clientY: 200, bubbles: true }));

    expect(armyOrders.isAttackMoveArmed()).toBe(false);
    expect(atkMoveBtn.getAttribute('data-armed')).toBe('false');
    expect(sendCommand).toHaveBeenCalledWith('attackMove', { unitIds: [id1, id2, id3], q: 10, r: -2 });

    const markers = armyOrders.getOrderMarkers();
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({ kind: 'attackMove', q: 10, r: -2, ttlMs: 1200 });

    const markerEl = body.querySelector<HTMLElement>('[data-order-marker]')!;
    expect(markerEl.getAttribute('data-order-marker')).toBe('attackMove');
    expect(markerEl.getAttribute('data-q')).toBe('10');
    expect(markerEl.getAttribute('data-r')).toBe('-2');

    host.step(4);
    expect(host.state.entities.cols.x[rowOf(host.state.entities, id1)]).toBeGreaterThan(1);
    expect(host.state.entities.cols.x[rowOf(host.state.entities, id2)]).toBeGreaterThan(2);
    expect(host.state.entities.cols.x[rowOf(host.state.entities, id3)]).toBeGreaterThan(3);

    hud.dispose();
  });
});

describe('W07-19: Stance bar and right-click attackTarget / move', () => {
  it('Stance buttons (hold, defend, hunt) dispatch sendCommand("setStance", { unitIds: [id1, id2, id3], stance }) and update active state', () => {
    const body = freshBody();
    const sendCommand = vi.fn();
    const mounted = mountArmy({ el: body, sendCommand, ownerColonyIndex: 0 });
    mounted.controller.onView({
      entities: [
        { id: 11, kind: ENTITY_KIND.recon, owner: 0, q: 1, r: 0, x: 1, y: 0, hp: 240, hpMax: 240, state: ENTITY_STATE.idle },
        { id: 12, kind: ENTITY_KIND.demoTank, owner: 0, q: 2, r: 0, x: 2, y: 0, hp: 520, hpMax: 520, state: ENTITY_STATE.idle },
        { id: 13, kind: ENTITY_KIND.demoArtillery, owner: 0, q: 3, r: 0, x: 3, y: 0, hp: 320, hpMax: 320, state: ENTITY_STATE.idle },
      ],
    });
    mounted.controller.selectUnits([11, 12, 13]);

    const holdBtn = body.querySelector<HTMLButtonElement>('[data-stance="hold"]')!;
    const defendBtn = body.querySelector<HTMLButtonElement>('[data-stance="defend"]')!;
    const huntBtn = body.querySelector<HTMLButtonElement>('[data-stance="hunt"]')!;

    holdBtn.click();
    expect(sendCommand).toHaveBeenLastCalledWith('setStance', { unitIds: [11, 12, 13], stance: 'hold' });
    expect(holdBtn.getAttribute('data-active')).toBe('true');

    defendBtn.click();
    expect(sendCommand).toHaveBeenLastCalledWith('setStance', { unitIds: [11, 12, 13], stance: 'defend' });
    expect(defendBtn.getAttribute('data-active')).toBe('true');

    huntBtn.click();
    expect(sendCommand).toHaveBeenLastCalledWith('setStance', { unitIds: [11, 12, 13], stance: 'hunt' });
    expect(huntBtn.getAttribute('data-active')).toBe('true');

    mounted.dispose();
  });

  it('Right-clicking a passive hive (including 3x3 footprint) or bug dispatches sendCommand("attackTarget", { unitIds, targetId }) and creates an "attackTarget" marker', () => {
    const body = freshBody();
    const sendCommand = vi.fn();
    const scene = new THREE.Scene();
    const mounted = mountArmy({
      el: body,
      sendCommand,
      ownerColonyIndex: 0,
      scene3d: {
        scene,
        tileElevation: () => 0,
        hexToWorld: (q: number, r: number) => ({ x: q * 2, z: r * 2 }),
        worldToHex: (x: number, z: number) => ({ q: Math.round(x / 2), r: Math.round(z / 2) }),
      },
    });

    mounted.controller.onView({
      entities: [
        { id: 21, kind: ENTITY_KIND.recon, owner: 0, q: 0, r: 0, x: 0, y: 0, hp: 240, hpMax: 240, state: ENTITY_STATE.idle },
        { id: 22, kind: ENTITY_KIND.demoTank, owner: 0, q: 1, r: 0, x: 1, y: 0, hp: 520, hpMax: 520, state: ENTITY_STATE.idle },
        { id: 101, kind: ENTITY_KIND.blackAnt, owner: -1, q: 5, r: 2, x: 5, y: 2, hp: 85, hpMax: 85, state: ENTITY_STATE.idle },
        { id: 202, kind: ENTITY_KIND.hiveBlueBeetle, owner: -1, q: 9, r: -3, x: 9, y: -3, hp: 2200, hpMax: 2200, state: ENTITY_STATE.idle },
      ],
    });
    mounted.controller.selectUnits([21, 22]);

    expect(mounted.controller.rightClickTile(5, 2)).toBe(true);
    expect(sendCommand).toHaveBeenLastCalledWith('attackTarget', { unitIds: [21, 22], targetId: 101 });
    expect(mounted.controller.getOrderMarkers()[0]).toMatchObject({ kind: 'attackTarget', q: 5, r: 2, targetId: 101 });

    expect(mounted.controller.rightClickTile(10, -2)).toBe(true);
    expect(sendCommand).toHaveBeenLastCalledWith('attackTarget', { unitIds: [21, 22], targetId: 202 });
    expect(mounted.controller.getOrderMarkers()[1]).toMatchObject({ kind: 'attackTarget', q: 10, r: -2, targetId: 202 });

    expect(mounted.controller.rightClickTile(4, -1)).toBe(true);
    expect(sendCommand).toHaveBeenCalledWith('moveUnit', { entityId: 21, q: 4, r: -1 });
    expect(sendCommand).toHaveBeenCalledWith('moveUnit', { entityId: 22, q: 4, r: -1 });
    expect(mounted.controller.getOrderMarkers()[2]).toMatchObject({ kind: 'move', q: 4, r: -1 });

    mounted.dispose();
  });
});

describe('W07-19: Selection metadata and wave gating', () => {
  it('supports W07 combat units and buildings in selectionHelpers and does not load army feature when W07 is off (..06)', () => {
    const w06Features = loadFeatures({ flags: new Set(parseWaves('..06').list) });
    expect(w06Features.some((f) => f.id === 'army')).toBe(false);

    const w07Features = loadFeatures({ flags: new Set(parseWaves('..07').list) });
    expect(w07Features.some((f) => f.id === 'army')).toBe(true);

    expect(normalizeKindCode('recon')).toBe(ENTITY_KIND.recon);
    expect(normalizeKindCode('roboticsFactory')).toBe(ENTITY_KIND.roboticsFactory);
    expect(normalizeKindCode('droneControlArray')).toBe(ENTITY_KIND.droneControlArray);
    expect(normalizeKindCode('autocannon')).toBe(ENTITY_KIND.autocannon);
    expect(normalizeKindCode('laserTower')).toBe(ENTITY_KIND.laserTower);
    expect(normalizeKindCode('blackAntHive')).toBe(ENTITY_KIND.hiveBlackAnt);
    expect(normalizeKindCode('blueBeetleHive')).toBe(ENTITY_KIND.hiveBlueBeetle);
    expect(normalizeKindCode('greenSpitterHive')).toBe(ENTITY_KIND.hiveGreenSpitter);

    const selectable = extractSelectableEntities(
      {
        entities: [
          { id: 1, kind: 'recon', owner: 0, q: 1, r: 0, x: 1, y: 0, hp: 240, hpMax: 240 },
          { id: 2, kind: 'demoTank', owner: 0, q: 2, r: 0, x: 2, y: 0, hp: 520, hpMax: 520 },
          { id: 3, kind: 'demoArtillery', owner: 0, q: 3, r: 0, x: 3, y: 0, hp: 320, hpMax: 320 },
          { id: 4, kind: 'roboticsFactory', owner: 0, q: 5, r: 5, x: 5, y: 5, hp: 1100, hpMax: 1100 },
        ],
      },
      0,
    );
    expect(selectable.get(1)).toMatchObject({ isUnit: true, isMovable: true, hpMax: 240 });
    expect(selectable.get(2)).toMatchObject({ isUnit: true, isMovable: true, hpMax: 520 });
    expect(selectable.get(3)).toMatchObject({ isUnit: true, isMovable: true, hpMax: 320 });
    expect(selectable.get(4)).toMatchObject({ isUnit: false, footprintW: 3, footprintD: 3, hpMax: 1100 });
  });
});
