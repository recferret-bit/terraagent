// @vitest-environment jsdom
import { parseWaves } from '@terra/contracts';
import {
  PREP,
  SimHost,
  TERRAIN,
  createPlanet,
  getColonyTerraformOrders,
  hexCount,
  hexIndex,
  setColonyStock,
  setTilePrep,
  setTileTerrain,
  spawnHqUnit,
} from '@terra/sim';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConstructionMenu, evaluatePlacementGhost } from '../construction-menu';
import { formatGhostOps } from '../hub-placement/HubPlacementView';
import {
  hexRadiusTiles,
  mountTerraformBasic as mountRaw,
  rectTiles,
} from './index';

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

describe('W05-20: TerraformMenu W05 ops, costs, and locked Deep Reclaim chip', () => {
  it('renders all 9 W05 ops with icons/costs and locks Deep Reclaim with "needs T2 worker" until a T2 worker exists', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const tf = mountTerraformBasic(container, { flags: W05_FLAGS.list ? new Set(W05_FLAGS.list) : undefined });

    const expectedOps = ['grade', 'clear', 'break', 'level', 'fill', 'reclaim', 'deepReclaim', 'irrigate', 'seed'];
    for (const op of expectedOps) {
      const chip = container.querySelector<HTMLButtonElement>(`[data-testid="tf-op-${op}"]`);
      expect(chip, `chip tf-op-${op}`).not.toBeNull();
      expect(chip?.getAttribute('data-icon')).toBeTruthy();
      expect(chip?.getAttribute('data-energy-e')).toBeTruthy();
      expect(chip?.getAttribute('data-time-s')).toBeTruthy();
    }

    const levelChip = container.querySelector<HTMLButtonElement>('[data-testid="tf-op-level"]')!;
    expect(levelChip.disabled).toBe(false);
    expect(levelChip.textContent).toContain('Level');
    expect(levelChip.textContent).toContain('60 E');
    expect(levelChip.textContent).toContain('8s');
    expect(levelChip.textContent).toContain('2 Minerals');

    const deepChip = container.querySelector<HTMLButtonElement>('[data-testid="tf-op-deepReclaim"]')!;
    expect(deepChip.disabled).toBe(true);
    expect(deepChip.getAttribute('data-tier-locked')).toBe('true');
    expect(deepChip.getAttribute('title')).toBe('needs T2 worker');
    expect(deepChip.textContent).toContain('needs T2 worker');

    // Desert planet doubles water cost on Irrigate (15 -> 30 Water)
    tf.update({
      planet: { id: 'd', type: 'desert', radius: 6 },
      units: [{ id: 10, kind: 'terraformer', owner: 0, q: 0, r: 0, hp: 120, hpMax: 120, tier: 1 }],
    } as never);
    expect(tf.hasWorkerAvailable()).toBe(true);
    const irrigateDesert = container.querySelector<HTMLButtonElement>('[data-testid="tf-op-irrigate"]')!;
    expect(irrigateDesert.textContent).toContain('30 Water');

    // Upgrading worker to tier 2 unlocks Deep Reclaim
    tf.update({
      planet: { id: 'd', type: 'temperate', radius: 6 },
      units: [{ id: 10, kind: 'terraformer', owner: 0, q: 0, r: 0, hp: 120, hpMax: 120, tier: 2 }],
    } as never);
    const deepUnlocked = container.querySelector<HTMLButtonElement>('[data-testid="tf-op-deepReclaim"]')!;
    expect(deepUnlocked.disabled).toBe(false);
    expect(deepUnlocked.getAttribute('data-tier-locked')).toBeNull();
  });
});

describe('W05-20: Area brush (hex radius + rect) and Cancel Area', () => {
  it('strokes hex-radius and rectangular areas and cancels queued orders in an area', () => {
    expect(hexRadiusTiles(0, 0, 1)).toHaveLength(7);
    expect(hexRadiusTiles(0, 0, 2)).toHaveLength(19);
    expect(rectTiles(1, 0, 2, 1)).toEqual([
      { q: 1, r: 0 },
      { q: 2, r: 0 },
      { q: 1, r: 1 },
      { q: 2, r: 1 },
    ]);

    const host = createW05SimHost();
    const state = host.state;
    const idx = hexIndex(state.grid.radius);
    for (const pos of rectTiles(1, 0, 2, 1)) {
      setTileTerrain(state.grid, idx.indexOf(pos.q, pos.r), TERRAIN.slope);
      setTilePrep(state.grid, idx.indexOf(pos.q, pos.r), PREP.wild);
    }

    const canvas = document.createElement('canvas');
    const container = document.createElement('div');
    document.body.append(canvas, container);
    let hover = { q: 1, r: 0 };
    const tf = mountTerraformBasic(container, {
      host,
      surface: canvas,
      pickTile: () => hover,
      flags: new Set(W05_FLAGS.list),
    });

    // Click Level chip + Rect brush button, then drag (1,0) -> (2,1)
    container.querySelector<HTMLButtonElement>('[data-testid="tf-op-level"]')!.click();
    container.querySelector<HTMLButtonElement>('[data-testid="tf-brush-rect"]')!.click();
    expect(tf.getSelectedOp()).toBe('level');
    expect(tf.getBrushShape()).toBe('rect');

    hover = { q: 1, r: 0 };
    canvas.dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true, cancelable: true }));
    hover = { q: 2, r: 1 };
    canvas.dispatchEvent(new MouseEvent('pointerup', { button: 0, bubbles: true, cancelable: true }));

    expect(tf.getLastStroke()?.queuedCount).toBe(4);
    host.step(1);
    tf.update(host.view() as never);
    expect(getColonyTerraformOrders(state, 0)).toHaveLength(1);
    expect(getColonyTerraformOrders(state, 0)[0]!.jobs).toHaveLength(4);

    // Cancel area overlapping (1, 0) cancels the queued order
    expect(tf.cancelArea([{ q: 1, r: 0 }])).toBe(1);
    host.step(1);
    expect(getColonyTerraformOrders(state, 0)).toHaveLength(0);
    canvas.remove();
  });
});
