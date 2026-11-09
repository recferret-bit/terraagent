// @vitest-environment jsdom
import { parseWaves } from '@terra/contracts';
import {
  PREP,
  SimHost,
  TERRAIN,
  createPlanet,
  getColonyTerraformOrders,
  getWorkJobsMap,
  hexCount,
  hexIndex,
  setColonyStock,
  setTilePrep,
  setTileTerrain,
  spawnHqUnit,
} from '@terra/sim';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConstructionMenu, evaluatePlacementGhost } from '../construction-menu';
import { formatGhostOps } from '../hub-placement/HubPlacementView';
import { mountTerraformBasic as mountRaw } from './index';

const mounted: Array<{ dispose(): void }> = [];
const mountTerraformBasic: typeof mountRaw = (...args) => {
  const h = mountRaw(...args);
  mounted.push(h);
  return h;
};

afterEach(() => {
  for (const h of mounted.splice(0)) h.dispose();
  document.body.replaceChildren();
});

const W05_FLAGS = parseWaves('..05');

function createW05SimHost(seed = 'w05-tf-menu-spec') {
  const host = new SimHost({ flags: W05_FLAGS });
  const state = createPlanet({ type: 'flat', seed, radius: 12 });
  host.load(state);
  spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
  setColonyStock(state, 0, {
    'metals.t1': 500,
    'minerals.t1': 500,
    'bio.biomass': 500,
    'bio.water': 500,
  });
  return host;
}

function createW05PlanetView(radius = 4) {
  const count = hexCount(radius);
  const terrain = new Uint8Array(count);
  const prep = new Uint8Array(count);
  const deposit = new Uint8Array(count);
  const height = new Float32Array(count);
  const owner = new Int8Array(count);
  const hIndex = hexIndex(radius);
  return {
    radius,
    hIndex,
    view: {
      planet: { id: 'w05-view', type: 'temperate' as const, radius },
      tiles: { count, terrain, prep, deposit, height, owner },
    },
    setTile(q: number, r: number, patch: { terrain?: number; prep?: number; deposit?: number }) {
      const idx = hIndex.indexOf(q, r);
      if (idx >= 0) {
        if (patch.terrain !== undefined) terrain[idx] = patch.terrain;
        if (patch.prep !== undefined) prep[idx] = patch.prep;
        if (patch.deposit !== undefined) deposit[idx] = patch.deposit;
      }
    },
  };
}

describe('W05-20: Construction ghost prep bill on sloped ground', () => {
  it('hovering a sloped 2×2 ghost lists Level ×2 + Grade, total E (200 E), and time (28s)', () => {
    const { view, setTile } = createW05PlanetView(4);
    // 2x2 footprint at (0, 0) covers (0,0), (1,0), (0,1), (1,1): set 2 slope + 2 flat (wild)
    setTile(0, 0, { terrain: TERRAIN.slope, prep: PREP.wild });
    setTile(1, 0, { terrain: TERRAIN.slope, prep: PREP.wild });
    setTile(0, 1, { terrain: TERRAIN.flat, prep: PREP.wild });
    setTile(1, 1, { terrain: TERRAIN.flat, prep: PREP.wild });

    const ghost = evaluatePlacementGhost({
      building: 'solar',
      q: 0,
      r: 0,
      rotation: 0,
      flags: new Set(['W00', 'W01', 'W02', 'W05']),
      view,
    });

    expect(ghost.valid).toBe(true);
    expect(ghost.prepBill).toEqual({ level: 2, grade: 4 });
    expect(ghost.prepEnergyE).toBe(200);
    expect(ghost.prepTimeS).toBe(28);
    expect(ghost.prepCost).toEqual({ 'minerals.t1': 4 });
    expect(ghost.prepBillText).toContain('Level ×2 + Grade');
    expect(ghost.prepBillText).toContain('200 E');
    expect(ghost.prepBillText).toContain('28s');
    expect(ghost.prepBillText).toContain('4 Minerals');

    // Also verify DOM readout in ConstructionMenu ghost element
    const container = document.createElement('div');
    document.body.appendChild(container);
    const menu = new ConstructionMenu(
      container,
      { flags: new Set(['W00', 'W01', 'W02', 'W05']), host: 'server', services: { track: vi.fn() } },
      view,
    );
    mounted.push(menu);
    menu.startPlacement('solar');
    menu.setHoverTile(0, 0);
    const prepEl = container.querySelector('.ta-placement-ghost__prep');
    expect(prepEl?.textContent).toContain('Level ×2 + Grade');
    expect(prepEl?.textContent).toContain('200 E');
    expect(prepEl?.textContent).toContain('28s');

    // Also verify HubPlacementView formatGhostOps for W05 ops
    expect(formatGhostOps({ level: 2, grade: 9, clear: 0, break: 0 })).toBe('Level ×2 + Grade ×9');
  });
});

/** A scene service with a flat 1-unit-per-hex mapping (the real one adds terrain height). */
function fakeScene3d() {
  return { scene: new THREE.Scene(), tileToWorld: (x: number, y: number) => ({ x: x * 1.7, y: 0, z: y * 1.5 }), biomeKey: () => 'test' };
}

function mountOnW05Planet() {
  const host = createW05SimHost();
  const idx = hexIndex(host.state.grid.radius);
  const set = (q: number, r: number, terrain: number) => {
    setTileTerrain(host.state.grid, idx.indexOf(q, r), terrain);
    setTilePrep(host.state.grid, idx.indexOf(q, r), PREP.wild);
  };
  set(1, 0, TERRAIN.slope);
  set(2, 0, TERRAIN.forest);
  set(3, 0, TERRAIN.rock);
  set(1, 1, TERRAIN.shallow);
  set(2, 1, TERRAIN.hole);
  const canvas = document.createElement('canvas');
  const container = document.createElement('div');
  document.body.append(canvas, container);
  let hover = { q: 1, r: 0 };
  const scene3d = fakeScene3d();
  const tf = mountTerraformBasic(container, {
    services: { host, scene3d, canvas, pickTile: () => hover } as never,
    flags: new Set(W05_FLAGS.list),
  });
  const click = (q: number, r: number, init: MouseEventInit = {}) => {
    hover = { q, r };
    canvas.dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true, cancelable: true, ...init }));
    canvas.dispatchEvent(new MouseEvent('pointerup', { button: 0, bubbles: true, cancelable: true, ...init }));
  };
  return { host, tf, click, container, scene3d };
}

describe('Terraform: one button does every ground job', () => {
  it('slope, trees, rock, water and a crater each queue a work job (the chain picks the op)', () => {
    const { host, tf } = mountOnW05Planet();
    tf.selectOp('terraform');
    const ops = [[1, 0], [2, 0], [3, 0], [1, 1], [2, 1]].map(([q, r]) => tf.strokeTile(q!, r!).jobs[0]?.op);
    expect(ops).toEqual(['work', 'work', 'work', 'work', 'work']);
    host.step(1);
    const keys = Object.values(getWorkJobsMap(host.state)).map((j) => j.terrainKey).sort();
    expect(keys).toEqual(['forest', 'hole', 'rock', 'shallow', 'slope']);
    expect(getColonyTerraformOrders(host.state, 0)).toEqual([]);
  });

  it('the menu offers exactly Terraform, Repair, Dismantle', () => {
    const { container } = mountOnW05Planet();
    expect([...container.querySelectorAll('button')].map((b) => b.dataset.testid ?? b.getAttribute('data-testid'))).toEqual([
      'tf-op-terraform',
      'tf-op-repair',
      'tf-op-dismantle',
    ]);
  });
});

describe('Terraform targets: highlighted hexes and Ctrl+click queueing', () => {
  it('a plain click orders one hex and disarms; Ctrl+click orders it and stays armed for the next', () => {
    const { host, tf, click } = mountOnW05Planet();
    tf.selectOp('terraform');
    click(2, 0);
    expect(tf.isArmed()).toBe(false);

    tf.selectOp('terraform');
    click(3, 0, { ctrlKey: true });
    click(1, 0, { ctrlKey: true });
    expect(tf.isArmed()).toBe(true);
    host.step(1);
    const tiles = Object.values(getWorkJobsMap(host.state)).map((j) => `${j.q},${j.r}`).sort();
    expect(tiles).toEqual(['1,0', '2,0', '3,0']);
  });

  it('every queued hex is highlighted in the 3D scene until its job is gone', () => {
    const { host, tf, click, scene3d } = mountOnW05Planet();
    tf.selectOp('terraform');
    click(2, 0, { ctrlKey: true });
    click(3, 0, { ctrlKey: true });
    host.step(1);
    tf.update(host.view() as never);
    const key = (t: { q: number; r: number }) => `${t.q},${t.r}`;
    expect(tf.getTargetTiles().map(key).sort()).toEqual(['2,0', '3,0']);
    const group = scene3d.scene.getObjectByName('terraform-targets')!;
    expect(group.visible).toBe(true);
    expect(group.children).toHaveLength(2);

    for (const j of Object.values(getWorkJobsMap(host.state))) tf.cancelOrder(j.jobId);
    host.step(1);
    tf.update(host.view() as never);
    expect(tf.getTargetTiles()).toEqual([]);
    expect(group.visible).toBe(false);
  });

  it('Ctrl+click on a queued hex takes it out of the queue again (toggle) and the highlight goes', () => {
    const { host, tf, click } = mountOnW05Planet();
    tf.selectOp('terraform');
    click(2, 0, { ctrlKey: true });
    click(3, 0, { ctrlKey: true });
    host.step(1);
    tf.update(host.view() as never);
    expect(tf.getTargetTiles()).toHaveLength(2);

    click(2, 0, { ctrlKey: true }); // already queued: cancel, not a second order
    expect(tf.getLastStroke()?.statusText).toBe('Terraform cancelled (2,0)');
    host.step(1);
    tf.update(host.view() as never);
    expect(Object.values(getWorkJobsMap(host.state)).map((j) => `${j.q},${j.r}`)).toEqual(['3,0']);
    expect(tf.getTargetTiles().map((t) => `${t.q},${t.r}`)).toEqual(['3,0']);
    expect(tf.isArmed()).toBe(true);
  });

  it('a macOS Ctrl+click (a contextmenu right after the press) neither disarms nor reaches the map below', () => {
    const { tf, click } = mountOnW05Planet();
    const canvas = document.body.querySelector('canvas')!;
    const below = vi.fn();
    canvas.addEventListener('contextmenu', below);
    tf.selectOp('terraform');
    click(2, 0, { ctrlKey: true });
    const ev = new MouseEvent('contextmenu', { button: 0, ctrlKey: true, bubbles: true, cancelable: true });
    canvas.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(below).not.toHaveBeenCalled();
    expect(tf.isArmed()).toBe(true);
  });
});

describe('Terraform on ground that is already clear', () => {
  it('level flat (flat, prepared, irrigated, living) queues nothing', () => {
    const { host, tf } = mountOnW05Planet();
    const idx = hexIndex(host.state.grid.radius);
    const i = idx.indexOf(-1, 1);
    tf.selectOp('terraform');
    for (const prep of [PREP.flat, PREP.prepared, PREP.irrigated, PREP.living]) {
      setTileTerrain(host.state.grid, i, TERRAIN.flat);
      setTilePrep(host.state.grid, i, prep);
      host.state.grid.layers.height[i] = 0;
      tf.update(host.view() as never);
      const stroke = tf.strokeTile(-1, 1);
      expect(stroke.queuedCount).toBe(0);
      expect(stroke.outcome?.reason).toBe('already_terraformed');
      expect(stroke.statusText).toBe('Already terraformed');
    }
  });
});
