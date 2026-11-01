// @vitest-environment jsdom
import { hexIndex, setTileTerrain, spawnHqUnit, TERRAIN } from '@terra/sim';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandBus } from '../../net/commandBus';
import { LocalHost } from '../../store/local/LocalHost';
import { WorldStore, type WorkerLike } from '../../store/WorldStore';
import type { EntityMeshes } from './EntityMeshes';
import { createUnitControl, STOP_KEY_CODE, type UnitControlDeps } from './unitControl';

const fakeEntities = () => ({
  isHqDeployed: vi.fn(() => true),
  flashTarget: vi.fn(),
  setSelectedEntityId: vi.fn(),
  discardPrediction: vi.fn(),
  onCorrection: null as ((tiles: number) => void) | null,
});

/** Unit control over a real in-process host with an HQ at (0, 0) and the tiles around (5, 0) walled in by rock. */
function rig(store?: WorldStore) {
  const host = new LocalHost({ flags: ['W00', 'W01'], radius: 16 });
  const idx = hexIndex(host.state.grid.radius);
  for (const [q, r] of [[6, 0], [4, 0], [5, 1], [5, -1], [4, 1], [6, -1]]) setTileTerrain(host.state.grid, idx.indexOf(q, r), TERRAIN.rock);
  const hqId = spawnHqUnit(host.state, { owner: 0, q: 0, r: 0 });
  host.sync(true);
  const entities = fakeEntities();
  const deps: UnitControlDeps = {
    store: store ?? host.store, commandBus: new CommandBus(host), canvas: document.createElement('canvas'),
    entities: entities as unknown as EntityMeshes, pickAt: () => null, terrain: () => null,
    toast: vi.fn(), netStats: { recordRollback: vi.fn(), recordCorrection: vi.fn() },
  };
  const control = createUnitControl(deps);
  return { host, hqId, entities, deps, control };
}

const key = (code: string, init: KeyboardEventInit = {}, target: EventTarget = window) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { code, key: code.slice(3).toLowerCase(), bubbles: true, ...init }));

afterEach(() => { document.body.replaceChildren(); });

describe('online unit control', () => {
  it('selection reaches the meshes; X stops the selected HQ (not while typing or with a modifier); dispose unbinds it', () => {
    const { host, hqId, entities, control } = rig();
    const send = vi.spyOn(host.store, 'sendCommand');
    control.landfall.deselect();
    expect(control.landfall.selectHq()).toBe(hqId);
    expect(entities.setSelectedEntityId).toHaveBeenLastCalledWith(hqId);

    const input = document.body.appendChild(document.createElement('input'));
    key(STOP_KEY_CODE, {}, input);
    key(STOP_KEY_CODE, { ctrlKey: true });
    key(STOP_KEY_CODE, { repeat: true });
    expect(send).not.toHaveBeenCalled();
    key(STOP_KEY_CODE);
    expect(send).toHaveBeenCalledWith({ type: 'stopUnit', entityId: hqId });

    control.dispose();
    key(STOP_KEY_CODE);
    expect(send).toHaveBeenCalledTimes(1);
    expect(entities.onCorrection).toBeNull();
  });

  it('a move flashes the target ring; an order the sim cannot path is toasted once', () => {
    const { host, entities, deps, control } = rig();
    expect(control.landfall.orderMove(5, 0)).toBe(true);
    expect(entities.flashTarget).toHaveBeenCalledWith(5, 0, null);
    host.step(3);
    expect(deps.toast).toHaveBeenCalledTimes(1);
    expect(deps.toast).toHaveBeenCalledWith('No path: the HQ cannot reach that tile');
    control.dispose();
  });

  it('pose corrections and rejected predictions are counted; a reject drops the predicted walk with its code', () => {
    let worker: WorkerLike | null = null;
    const store = new WorldStore({ send() {}, onMessage: () => () => {} }, () => (worker = { postMessage() {}, onmessage: null, terminate() {} }));
    store.start();
    const { entities, deps, control } = rig(store);
    entities.onCorrection?.(3);
    expect(deps.netStats.recordCorrection).toHaveBeenCalledWith(3);
    worker!.onmessage?.({ data: { t: 'cmdRejected', id: 'cm_1', kind: 'moveUnit', code: 'unknown_entity' } });
    expect(deps.netStats.recordRollback).toHaveBeenCalledTimes(1);
    expect(entities.discardPrediction).toHaveBeenCalledWith('unknown_entity');
    control.dispose();
    worker!.onmessage?.({ data: { t: 'cmdRejected', id: 'cm_2', kind: 'moveUnit', code: 'unknown_entity' } });
    expect(deps.netStats.recordRollback).toHaveBeenCalledTimes(1);
    store.dispose();
  });
});
