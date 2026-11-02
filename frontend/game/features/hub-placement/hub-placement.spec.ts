// @vitest-environment jsdom
import { parseCommandArgs, parseWaves } from '@terra/contracts';
import {
  createPlanet,
  getColonyTerraformOrders,
  getConstructionOrders,
  getHubFootprintTiles,
  hasColonyHub,
  hexIndex,
  PREP,
  setTileOwner,
  setTilePrep,
  setTileTerrain,
  SimHost,
  spawnHqUnit,
  TERRAIN,
} from '@terra/sim';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { loadFeatures } from '../../core/registry';
import { LocalHost } from '../../store/local/LocalHost';
import {
  evaluateHubGhost,
  hubPlacementFeature,
  mountHubPlacement,
} from './index';
import { GhostRig3D } from './GhostRig3D';

function createRockAndForeignHost() {
  const host = new SimHost({ flags: parseWaves('..01') });
  host.load(createPlanet({ type: 'flat', seed: 'hub-ghost-spec', radius: 12 }));
  const state = host.state;
  spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
  const idx = hexIndex(state.grid.radius);

  // 3x3 around (2, 2): 3 Rock tiles + 6 Flat tiles
  for (const pos of [
    { q: 1, r: 1 },
    { q: 2, r: 2 },
    { q: 3, r: 3 },
  ]) {
    setTileTerrain(state.grid, idx.indexOf(pos.q, pos.r), TERRAIN.rock);
  }

  // Foreign-owned tiles (owner = 1) around (-5, -5)
  for (const pos of getHubFootprintTiles(-5, -5)) {
    const tIdx = idx.indexOf(pos.q, pos.r);
    if (tIdx >= 0) setTileOwner(state.grid, tIdx, 1);
  }
  return host;
}

/** Routes the menu's command straight into the authoritative in-process host (same handler as server / Worker). */
function hostSend(host: SimHost) {
  let n = 0;
  return vi.fn(async (kind: string, args?: unknown) => {
    host.submit({ colonyIndex: 0, source: 'player', commandId: `t_${++n}`, kind, args });
    const code = host.step(1).outcomes[0]?.code;
    return code ? { ok: false, code } : { ok: true };
  });
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('Construction menu & placement ghost (shared placement rules)', () => {
  it('rock cluster -> red "rock: break it first"; clean Flat -> green with a Grade-only bill; foreign land -> "not your territory"', () => {
    const host = createRockAndForeignHost();
    const container = document.createElement('div');
    const sendCommand = vi.fn();
    const hub = mountHubPlacement(container, { host, sendCommand });

    const buildBtn = container.querySelector('[data-testid="build-command-hub"]') as HTMLButtonElement;
    expect(buildBtn.textContent).toContain('200 Metals · 100 Minerals · 50 Biomass · 50 Water');
    hub.startPlacement();
    expect(hub.isPlacementActive()).toBe(true);

    const rockGhost = hub.hoverTile(2, 2);
    expect(rockGhost.valid).toBe(false);
    expect(rockGhost.tint).toBe('invalid');
    expect(rockGhost.reasonCode).toBe('terrain_unbuildable');
    expect(rockGhost.block).toBe('rock');
    expect(rockGhost.reasonText).toBe('rock: break it first');
    expect(rockGhost.footprintTiles.filter((t) => !t.valid).map((t) => `${t.q},${t.r}`)).toEqual(['1,1', '2,2', '3,3']);

    const clean = hub.hoverTile(-3, 4);
    expect(clean.valid).toBe(true);
    expect(clean.bill).toEqual({
      tilesToPrepare: 9,
      totalTiles: 9,
      ops: { grade: 9, clear: 0, break: 0 },
      baseSeconds: 27,
      hqSeconds: 18,
      totalEnergyE: 180,
      yields: { 'metals.t1': 0, 'bio.biomass': 0 },
    });
    const ghostEl = container.querySelector('[data-testid="hub-placement-ghost"]') as HTMLElement;
    expect(ghostEl.hidden).toBe(false);
    expect(ghostEl.getAttribute('data-tint')).toBe('valid');
    expect(container.querySelector('[data-testid="hub-bill-tiles"]')!.textContent).toBe('9/9 tiles to prepare');
    expect(container.querySelector('[data-testid="hub-bill-time"]')!.textContent).toBe('18.0s (HQ 1.5×)');
    expect(container.querySelector('[data-testid="hub-bill-energy"]')!.textContent).toBe('180 E');

    const foreignGhost = hub.hoverTile(-5, -5);
    expect(foreignGhost.reasonCode).toBe('not_own_territory');
    expect(foreignGhost.reasonText).toBe('not your territory');
    expect(container.querySelector('[data-testid="hub-ghost-reason"]')!.textContent).toBe('not your territory');
    expect((container.querySelector('[data-testid="hub-confirm"]') as HTMLButtonElement).disabled).toBe(true);
    expect(hub.confirmPlacement()).toBe(false);
    expect(hub.confirmPlacement(2, 2)).toBe(false); // rock
    expect(sendCommand).toHaveBeenCalledTimes(0);
    hub.dispose();
  });
});

describe('Confirm goes through the authoritative handler only (no client-side world mutation)', () => {
  it('confirm sends exactly one placeBuilding; the host creates the Hub + linked Grade order; cancel sends cancelTask', async () => {
    const host = createRockAndForeignHost();
    const state = host.state;
    const container = document.createElement('div');
    const sendCommand = hostSend(host);
    const hub = mountHubPlacement(container, { host, sendCommand });

    hub.startPlacement(-3, 4);
    (container.querySelector('[data-testid="hub-cancel"]') as HTMLButtonElement).click();
    expect(hub.isPlacementActive()).toBe(false);

    hub.startPlacement();
    hub.hoverTile(-3, 4);
    expect(hub.confirmPlacement()).toBe(true);
    expect(sendCommand).toHaveBeenCalledTimes(1);
    const [kind, args] = sendCommand.mock.calls[0];
    expect(kind).toBe('placeBuilding');
    expect(args).toEqual({ building: 'commandHub', q: -3, r: 4 });
    expect(parseCommandArgs('placeBuilding', args).success).toBe(true);
    await flush();

    expect(hasColonyHub(state, 0)).toBe(true);
    expect(getConstructionOrders(state, 0)[0]).toMatchObject({ building: 'commandHub', q: -3, r: 4, status: 'waiting_site' });
    const tf = getColonyTerraformOrders(state, 0);
    expect(tf).toHaveLength(1);
    expect(tf[0].jobs.every((j) => j.op === 'grade')).toBe(true);

    hub.update(host.view() as never);
    (container.querySelector('[data-testid="hub-cancel-order"]') as HTMLButtonElement).click();
    await flush();
    expect(sendCommand).toHaveBeenCalledTimes(2);
    expect(sendCommand.mock.calls[1][0]).toBe('cancelTask');
    expect(getConstructionOrders(state, 0)).toHaveLength(0);
    expect(hasColonyHub(state, 0)).toBe(false);
    hub.dispose();
  });

  it('a host rejection the ghost did not foresee reopens the ghost red on that site with the host reason', async () => {
    const host = createRockAndForeignHost();
    const container = document.createElement('div');
    const sendCommand = vi.fn(async () => ({ ok: false, code: 'site_blocked', detail: 'another building is here' }));
    const hub = mountHubPlacement(container, { host, sendCommand });
    hub.startPlacement(-3, 4);
    expect(hub.confirmPlacement()).toBe(true);
    expect(hub.isPlacementActive()).toBe(false);
    await flush();
    const g = hub.getGhostState();
    expect(hub.isPlacementActive()).toBe(true);
    expect([g.q, g.r, g.valid, g.reasonCode, g.reasonText]).toEqual([-3, 4, false, 'site_blocked', 'another building is here']);
    expect(hub.hoverTile(-4, 4).valid).toBe(true); // moving off the rejected site clears the override
    hub.dispose();
  });
});

describe('GhostEvaluator reasons, surface pointer events, hotkeys, and feature registry', () => {
  it('reports trees, water, prepared-ground bill, hub already exists and requires HQ', () => {
    const host = createRockAndForeignHost();
    const state = host.state;
    const idx = hexIndex(state.grid.radius);
    const fp = getHubFootprintTiles(-2, 2);
    setTilePrep(state.grid, idx.indexOf(fp[2].q, fp[2].r), PREP.prepared);
    setTilePrep(state.grid, idx.indexOf(fp[3].q, fp[3].r), PREP.prepared);
    setTilePrep(state.grid, idx.indexOf(fp[4].q, fp[4].r), PREP.living);
    const mixed = evaluateHubGhost(state, 0, -2, 2);
    expect(mixed.valid).toBe(true);
    expect(mixed.bill.ops).toEqual({ grade: 6, clear: 0, break: 0 });
    expect(mixed.bill.tilesToPrepare).toBe(6);

    setTileTerrain(state.grid, idx.indexOf(fp[0].q, fp[0].r), TERRAIN.forest);
    const trees = evaluateHubGhost(state, 0, -2, 2);
    expect([trees.valid, trees.reasonCode, trees.block, trees.reasonText]).toEqual([false, 'terrain_unbuildable', 'trees', 'trees: clear them first']);

    setTileTerrain(state.grid, idx.indexOf(0, 4), TERRAIN.deep);
    const water = evaluateHubGhost(state, 0, 0, 4);
    expect([water.reasonCode, water.block]).toEqual(['terrain_unbuildable', 'water']);

    const noHq = evaluateHubGhost(state, { colonyId: 2, q: -3, r: 4, requireHq: true });
    expect([noHq.valid, noHq.reasonCode, noHq.reasonText]).toEqual([false, 'worker_tier_locked', 'requires HQ']);
  });

  it('supports surface clicks, H/Escape hotkeys, LocalHost ClientView, and W01 feature registration', () => {
    const localHost = new LocalHost({ flags: ['W00', 'W01'], radius: 12 });
    spawnHqUnit(localHost.state, { owner: 0, q: 0, r: 0 });
    localHost.sync(true);
    const container = document.createElement('div');
    const surface = document.createElement('div');
    const storeSpy = vi.spyOn(localHost.store, 'sendCommand');
    const hub = mountHubPlacement(container, { host: localHost, surface, pickTile: (cx, cy) => ({ q: cx, r: cy }) });

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h' }));
    expect(hub.isPlacementActive()).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(hub.isPlacementActive()).toBe(false);
    (container.querySelector('[data-testid="build-command-hub"]') as HTMLButtonElement).click();
    expect(hub.isPlacementActive()).toBe(true);

    // A left click confirms on the clicked tile (the hover itself comes from the 3D renderer's pick).
    surface.dispatchEvent(new MouseEvent('pointerup', { button: 0, clientX: 3, clientY: 0, bubbles: true }));
    expect(storeSpy).toHaveBeenCalledTimes(1);
    expect(storeSpy).toHaveBeenCalledWith('placeBuilding', { building: 'commandHub', q: 3, r: 0 });
    expect(hub.isPlacementActive()).toBe(false);

    localHost.step(1);
    const afterPlace = hub.startPlacement(3, 0);
    expect(afterPlace.valid).toBe(false);
    expect(afterPlace.reasonCode).toBe('site_blocked');
    expect(hub.startPlacement(-6, 6).block).toBe('hubExists');

    expect(hubPlacementFeature.id).toBe('hub-placement');
    expect(loadFeatures({ flags: new Set(['W00']), host: 'server' }).map((f) => f.id)).not.toContain('hub-placement');
    expect(loadFeatures({ flags: new Set(['W00', 'W01']), host: 'server' }).map((f) => f.id)).toContain('hub-placement');
    hub.dispose();
  });
});

describe('3D placement ghost', () => {
  it('shows a tinted 3D footprint while hovering valid and invalid sites, and hides when not placing', () => {
    const host = createRockAndForeignHost();
    const hub = mountHubPlacement(document.createElement('div'), { host, sendCommand: vi.fn() });
    const scene = new THREE.Scene();
    const rig = new GhostRig3D({ scene, tileToWorld: (q, r) => ({ x: q * 2, y: 1, z: r * 2 }), biomeKey: () => 'dune' });
    const src = { isPlacementActive: () => hub.isPlacementActive(), getGhostState: () => hub.peekGhostState() };
    const tiles = () => rig.group.children.filter((c) => (c as THREE.Mesh).geometry && c.visible) as THREE.Mesh[];

    rig.update(src, 0.016);
    expect(rig.group.visible).toBe(false);

    hub.startPlacement();
    hub.hoverTile(-3, 4);
    rig.update(src, 0.016);
    expect(rig.group.visible).toBe(true);
    const ok = tiles().filter((m) => m.geometry.type === 'CircleGeometry');
    expect(ok).toHaveLength(9);
    expect(new Set(ok.map((m) => (m.material as THREE.MeshBasicMaterial).color.getHex()))).toEqual(new Set([0x39ff88]));

    hub.hoverTile(2, 2); // rock
    rig.update(src, 0.016);
    expect(hub.peekGhostState().valid).toBe(false);
    expect(rig.group.visible).toBe(true);
    const bad = tiles().filter((m) => m.geometry.type === 'CircleGeometry');
    expect(bad.some((m) => (m.material as THREE.MeshBasicMaterial).color.getHex() === 0xff3b3b)).toBe(true);

    hub.cancelPlacement();
    rig.update(src, 0.016);
    expect(rig.group.visible).toBe(false);
    rig.dispose();
  });

  it('registers the hub-ghost-3d renderer', () => {
    expect(hubPlacementFeature.renderers?.map((r) => r.id)).toContain('hub-ghost-3d');
  });
});
