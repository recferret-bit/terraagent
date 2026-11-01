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
import { LocalHost } from '../../store/WorldStore';
import {
  ensureDom,
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

describe('W01-28: Construction menu v0 and 3x3 placement ghost acceptance', () => {
  it('acceptance: hover over a rock cluster -> bill updates live; hover over foreign land -> ghost turns red with "not your territory"', () => {
    ensureDom();
    const host = createRockAndForeignHost();
    const container = document.createElement('div');
    const sendCommand = vi.fn();

    const hub = mountHubPlacement(container, { host, sendCommand });

    const menuEl = container.querySelector('[data-testid="construction-menu"]')!;
    const buildBtn = container.querySelector('[data-testid="build-command-hub"]') as HTMLButtonElement;
    expect(menuEl).not.toBeNull();
    expect(buildBtn.textContent).toContain('Command Hub');
    expect(buildBtn.textContent).toContain('200 Metals · 100 Minerals · 50 Biomass · 50 Water');

    hub.startPlacement();
    expect(hub.isPlacementActive()).toBe(true);

    const rockGhost = hub.hoverTile(2, 2);
    expect(rockGhost.active).toBe(true);
    expect(rockGhost.valid).toBe(true);
    expect(rockGhost.tint).toBe('valid');
    expect(rockGhost.bill).toEqual({
      tilesToPrepare: 9,
      totalTiles: 9,
      ops: { break: 3, grade: 9, clear: 0 },
      baseSeconds: 45,
      hqSeconds: 30,
      totalEnergyE: 360,
      yields: { 'metals.t1': 30, 'bio.biomass': 0 },
    });
    expect(hub.getGhostState().bill).toEqual(rockGhost.bill);

    const ghostEl = container.querySelector('[data-testid="hub-placement-ghost"]') as HTMLElement;
    const billEl = container.querySelector('[data-testid="hub-prep-bill"]')!;
    const tilesEl = container.querySelector('[data-testid="hub-bill-tiles"]')!;
    const timeEl = container.querySelector('[data-testid="hub-bill-time"]')!;
    const energyEl = container.querySelector('[data-testid="hub-bill-energy"]')!;
    const yieldsEl = container.querySelector('[data-testid="hub-bill-yields"]')!;

    expect(ghostEl.hidden).toBe(false);
    expect(ghostEl.getAttribute('data-tint')).toBe('valid');
    expect(ghostEl.classList.contains('ghost-valid')).toBe(true);
    expect(tilesEl.textContent).toBe('9/9 tiles to prepare');
    expect(timeEl.textContent).toBe('30.0s (HQ 1.5×)');
    expect(energyEl.textContent).toBe('360 E');
    expect(yieldsEl.textContent).toBe('+30 Metals');
    expect(billEl.textContent).toContain('360 E');
    expect(billEl.textContent).toContain('+30 Metals');

    const foreignGhost = hub.hoverTile(-5, -5);
    expect(foreignGhost.valid).toBe(false);
    expect(foreignGhost.tint).toBe('invalid');
    expect(foreignGhost.reasonCode).toBe('not_own_territory');
    expect(foreignGhost.reasonText).toBe('not your territory');

    const reasonEl = container.querySelector('[data-testid="hub-ghost-reason"]')!;
    const confirmBtn = container.querySelector('[data-testid="hub-confirm"]') as HTMLButtonElement;
    expect(ghostEl.getAttribute('data-tint')).toBe('invalid');
    expect(ghostEl.classList.contains('ghost-invalid')).toBe(true);
    expect(reasonEl.textContent).toBe('not your territory');
    expect(confirmBtn.disabled).toBe(true);

    expect(hub.confirmPlacement()).toBe(false);
    expect(sendCommand).toHaveBeenCalledTimes(0);

    hub.dispose();
  });
});

describe('W01-28: Confirm placement, linked site prep order, and cancel flows', () => {
  it('confirms placement on (2, 2) to dispatch placeBuilding and start linked prep + Hub order, and supports cancelPlacement and cancelOrder', () => {
    ensureDom();
    const host = createRockAndForeignHost();
    const state = host.state;
    const container = document.createElement('div');
    const sendCommand = vi.fn();

    const hub = mountHubPlacement(container, { host, sendCommand });

    hub.startPlacement(2, 2);
    expect(hub.isPlacementActive()).toBe(true);
    const cancelBtn = container.querySelector('[data-testid="hub-cancel"]') as HTMLButtonElement;
    cancelBtn.click();
    expect(hub.isPlacementActive()).toBe(false);
    expect((container.querySelector('[data-testid="hub-placement-ghost"]') as HTMLElement).hidden).toBe(true);

    hub.startPlacement();
    hub.hoverTile(2, 2);
    const confirmed = hub.confirmPlacement();
    expect(confirmed).toBe(true);
    expect(hub.isPlacementActive()).toBe(false);

    expect(sendCommand).toHaveBeenCalledTimes(1);
    const [cmdKind, cmdArgs] = sendCommand.mock.calls[0];
    expect(cmdKind).toBe('placeBuilding');
    expect(cmdArgs).toEqual({ building: 'commandHub', q: 2, r: 2 });
    expect(parseCommandArgs('placeBuilding', cmdArgs).success).toBe(true);

    expect(hasColonyHub(state, 0)).toBe(true);
    const buildOrders = getConstructionOrders(state, 0);
    expect(buildOrders).toHaveLength(1);
    expect(buildOrders[0]).toMatchObject({
      building: 'commandHub',
      q: 2,
      r: 2,
      status: 'waiting_site',
      statusText: 'waiting(site: 0/9)',
    });
    const tfOrders = getColonyTerraformOrders(state, 0);
    expect(tfOrders).toHaveLength(1);
    expect(tfOrders[0].isLinkedPrep).toBe(true);
    expect(tfOrders[0].jobs).toHaveLength(12);

    const cancelOrderBtn = container.querySelector('[data-testid="hub-cancel-order"]') as HTMLButtonElement;
    expect(cancelOrderBtn.disabled).toBe(false);
    cancelOrderBtn.click();

    expect(sendCommand).toHaveBeenCalledTimes(2);
    expect(sendCommand.mock.calls[1][0]).toBe('cancelTask');
    expect(parseCommandArgs('cancelTask', sendCommand.mock.calls[1][1]).success).toBe(true);
    expect(getConstructionOrders(state, 0)).toHaveLength(0);
    expect(getColonyTerraformOrders(state, 0)).toHaveLength(0);
    expect(hasColonyHub(state, 0)).toBe(false);

    hub.dispose();
  });
});

describe('W01-28: GhostEvaluator edge cases, surface pointer events, hotkeys, and feature registry', () => {
  it('computes Forest + Prepared bills and reports site blocked, hub already exists, and requires HQ reasons', () => {
    const host = createRockAndForeignHost();
    const state = host.state;
    const idx = hexIndex(state.grid.radius);

    const fp = getHubFootprintTiles(-2, 2);
    setTileTerrain(state.grid, idx.indexOf(fp[0].q, fp[0].r), TERRAIN.forest);
    setTileTerrain(state.grid, idx.indexOf(fp[1].q, fp[1].r), TERRAIN.forest);
    setTilePrep(state.grid, idx.indexOf(fp[2].q, fp[2].r), PREP.prepared);
    setTilePrep(state.grid, idx.indexOf(fp[3].q, fp[3].r), PREP.prepared);
    setTilePrep(state.grid, idx.indexOf(fp[4].q, fp[4].r), PREP.living);

    const mixed = evaluateHubGhost(state, 0, -2, 2);
    expect(mixed.valid).toBe(true);
    expect(mixed.bill).toEqual({
      tilesToPrepare: 6,
      totalTiles: 9,
      ops: { clear: 2, break: 0, grade: 6 },
      baseSeconds: 2 * 5 + 6 * 3,
      hqSeconds: 28 / 1.5,
      totalEnergyE: 2 * 30 + 6 * 20,
      yields: { 'metals.t1': 0, 'bio.biomass': 10 },
    });

    setTileTerrain(state.grid, idx.indexOf(0, 4), TERRAIN.deep);
    const blocked = evaluateHubGhost(state, 0, 0, 4);
    expect(blocked.valid).toBe(false);
    expect(blocked.reasonCode).toBe('site_blocked');
    expect(blocked.reasonText).toBe('site blocked');

    const noHq = evaluateHubGhost(state, { colonyId: 2, q: -2, r: 2, requireHq: true });
    expect(noHq.valid).toBe(false);
    expect(noHq.reasonCode).toBe('worker_tier_locked');
    expect(noHq.reasonText).toBe('requires HQ');
  });

  it('supports surface pointer hover/click, H/Escape hotkeys, LocalHost ClientView, and W01 feature registration', () => {
    ensureDom();
    const localHost = new LocalHost({ flags: ['W00', 'W01'], radius: 12 });
    spawnHqUnit(localHost.state, { owner: 0, q: 0, r: 0 });
    localHost.sync(true);

    const container = document.createElement('div');
    const surface = document.createElement('div');
    const storeSpy = vi.spyOn(localHost.store, 'sendCommand');

    const hub = mountHubPlacement(container, {
      host: localHost,
      surface,
      pickTile: (cx, cy) => ({ q: cx, r: cy }),
    });

    window.dispatchEvent({ type: 'keydown', key: 'h' } as unknown as Event);
    expect(hub.isPlacementActive()).toBe(true);

    window.dispatchEvent({ type: 'keydown', key: 'Escape' } as unknown as Event);
    expect(hub.isPlacementActive()).toBe(false);

    const buildBtn = container.querySelector('[data-testid="build-command-hub"]') as HTMLButtonElement;
    buildBtn.click();
    expect(hub.isPlacementActive()).toBe(true);

    surface.dispatchEvent({ type: 'pointermove', clientX: 3, clientY: 0 } as unknown as Event);
    expect(hub.getGhostState().q).toBe(3);
    expect(hub.getGhostState().r).toBe(0);
    expect(hub.getGhostState().valid).toBe(true);

    surface.dispatchEvent({ type: 'pointerup', button: 0, clientX: 3, clientY: 0 } as unknown as Event);
    expect(storeSpy).toHaveBeenCalledTimes(1);
    expect(hub.isPlacementActive()).toBe(false);

    localHost.step(1);
    const afterPlace = hub.startPlacement(3, 0);
    expect(afterPlace.valid).toBe(false);
    expect(afterPlace.reasonCode).toBe('already_exists');
    expect(afterPlace.reasonText).toBe('hub already exists');

    expect(hubPlacementFeature.id).toBe('hub-placement');
    expect(hubPlacementFeature.wave).toBe('W01');
    expect(loadFeatures({ flags: new Set(['W00']), host: 'server' }).map((f) => f.id)).not.toContain('hub-placement');
    expect(loadFeatures({ flags: new Set(['W00', 'W01']), host: 'server' }).map((f) => f.id)).toContain('hub-placement');

    hub.dispose();
  });
});

describe('3D placement ghost', () => {
  it('shows a tinted 3D footprint while hovering valid and invalid sites, and hides when not placing', () => {
    ensureDom();
    const host = createRockAndForeignHost();
    const hub = mountHubPlacement(document.createElement('div'), { host, sendCommand: vi.fn() });
    const scene = new THREE.Scene();
    const rig = new GhostRig3D({ scene, tileToWorld: (q, r) => ({ x: q * 2, y: 1, z: r * 2 }), biomeKey: () => 'dune' });
    const src = { isPlacementActive: () => hub.isPlacementActive(), getGhostState: () => hub.peekGhostState() };
    const tiles = () => rig.group.children.filter((c) => (c as THREE.Mesh).geometry && c.visible) as THREE.Mesh[];

    rig.update(src, 0.016);
    expect(rig.group.visible).toBe(false);

    hub.startPlacement();
    hub.hoverTile(2, 2);
    rig.update(src, 0.016);
    expect(rig.group.visible).toBe(true);
    const ok = tiles().filter((m) => m.geometry.type === 'CircleGeometry');
    expect(ok).toHaveLength(9);
    expect(new Set(ok.map((m) => (m.material as THREE.MeshBasicMaterial).color.getHex()))).toEqual(new Set([0x39ff88]));

    hub.hoverTile(-5, -5);
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
