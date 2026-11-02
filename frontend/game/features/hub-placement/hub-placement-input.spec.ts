// @vitest-environment jsdom
import { parseWaves } from '@terra/contracts';
import {
  buildPipeline,
  createPlanet,
  getHubFootprintTiles,
  hexIndex,
  setTileTerrain,
  SimHost,
  spawnHqUnit,
  TERRAIN,
  type BalanceOverrides,
} from '@terra/sim';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHubGhostRenderer, GHOST_IDLE_PICK_MS } from './ghostRenderer';
import { mountHubPlacement as mountRaw, type HubPlacementFeatureHandle } from './index';

const mounted: Array<{ dispose(): void }> = [];
const mountHubPlacement: typeof mountRaw = (...args) => {
  const h = mountRaw(...args);
  mounted.push(h);
  return h;
};
afterEach(() => {
  for (const h of mounted.splice(0)) h.dispose();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function flatHost(overrides: BalanceOverrides = {}): SimHost {
  const host = new SimHost(buildPipeline(parseWaves('..01').list, overrides));
  host.load(createPlanet({ id: 'p', seed: 'hub-input', type: 'flat', radius: 12 }));
  spawnHqUnit(host.state, { owner: 0, q: 0, r: 0 });
  return host;
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const mouse = (target: EventTarget, type: string, button: number, x = 0, y = 0) =>
  target.dispatchEvent(new MouseEvent(type, { button, clientX: x, clientY: y, bubbles: true, cancelable: true }));

describe('Placement owns the map input while the ghost is open (FF-10, FF-11, FF-15)', () => {
  function placingOnCanvas() {
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    const below = vi.fn(); // the HQ selection / move-order listeners bound on the same canvas (bubble phase)
    canvas.addEventListener('pointerup', below);
    canvas.addEventListener('contextmenu', below);
    const sendCommand = vi.fn();
    const hub = mountHubPlacement(document.createElement('div'), {
      host: flatHost(),
      sendCommand,
      services: { canvas, pickTile: (x: number, y: number) => ({ q: x, r: y }) },
    });
    hub.startPlacement(-3, 4);
    return { canvas, below, sendCommand, hub };
  }

  it('a right click cancels the ghost and never reaches the HQ order listener, in either browser event order', () => {
    const { canvas, below, sendCommand, hub } = placingOnCanvas();
    // macOS: contextmenu on press, pointerup after the ghost is already closed
    mouse(canvas, 'pointerdown', 2);
    mouse(canvas, 'contextmenu', 2);
    mouse(canvas, 'pointerup', 2);
    expect(hub.isPlacementActive()).toBe(false);
    expect(below).not.toHaveBeenCalled();

    // Windows: pointerup first, contextmenu after
    hub.startPlacement(-3, 4);
    mouse(canvas, 'pointerdown', 2);
    mouse(canvas, 'pointerup', 2);
    mouse(canvas, 'contextmenu', 2);
    expect(hub.isPlacementActive()).toBe(false);
    expect(below).not.toHaveBeenCalled();
    expect(sendCommand).not.toHaveBeenCalled();

    // Not placing: clicks are the HQ controller's again
    mouse(canvas, 'pointerdown', 2);
    mouse(canvas, 'pointerup', 2);
    expect(below).toHaveBeenCalledTimes(1);
  });

  it('a left click confirms once and is not also a selection click', () => {
    const { canvas, below, sendCommand } = placingOnCanvas();
    mouse(canvas, 'pointerdown', 0, -3, 4);
    mouse(canvas, 'pointerup', 0, -3, 4);
    expect(sendCommand).toHaveBeenCalledTimes(1);
    expect(below).not.toHaveBeenCalled();
  });

  it('Esc closes the ghost without also pausing, whatever the listener order; H ignores auto-repeat', () => {
    const pause = vi.fn();
    window.addEventListener('keydown', pause); // registered before the ghost: the order that used to pause too
    const { hub } = placingOnCanvas();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(hub.isPlacementActive()).toBe(false);
    expect(pause).not.toHaveBeenCalled();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', repeat: true }));
    expect(hub.isPlacementActive()).toBe(false);
    window.removeEventListener('keydown', pause);
  });
});

describe('Labels follow the live balance data (FF-12)', () => {
  it('the button cost and the HQ speed come from the tuned hub.t1 / hq.t1 rows', () => {
    const overrides: BalanceOverrides = { hub: { t1: { cost: { 'metals.t1': 300, 'minerals.t1': 120 } } }, hq: { t1: { workRate: 2 } } };
    const host = flatHost(overrides);
    const container = document.createElement('div');
    const store = { latest: null, latestTiles: null, simData: () => host.pipeline.config.data };
    const hub = mountHubPlacement(container, { host, store, sendCommand: vi.fn() });
    hub.startPlacement(-3, 4);
    expect(container.querySelector('[data-testid="hub-build-cost"]')!.textContent).toBe('300 Metals · 120 Minerals');
    expect(container.querySelector('[data-testid="hub-bill-time"]')!.textContent).toBe('13.5s (HQ 2×)');
  });
});

describe('Hub order cancel and host rejects (FF-13, FF-17)', () => {
  it('after a host reject there is no order to cancel: the button is disabled and no wildcard is sent', async () => {
    const container = document.createElement('div');
    const sendCommand = vi.fn(async () => ({ ok: false, code: 'site_blocked' })); // placement rejects only on the site: an unaffordable Hub is accepted and waits (GP-30)
    const hub = mountHubPlacement(container, { host: flatHost(), sendCommand });
    hub.startPlacement(-3, 4);
    hub.confirmPlacement();
    await flush();
    expect((container.querySelector('[data-testid="hub-cancel-order"]') as HTMLButtonElement).disabled).toBe(true);
    expect(hub.cancelOrder()).toBe(false);
    expect(sendCommand.mock.calls.map((c) => (c as unknown[])[0])).toEqual(['placeBuilding']);
  });

  it('a completed Hub order is history: no status line, CANCEL ORDER disabled', () => {
    const container = document.createElement('div');
    const latest = {
      blobs: { constructionQueue: { orders: [{ orderId: 'build#9', colonyId: 0, building: 'commandHub', status: 'completed', q: 0, r: 0 }] } },
    };
    mountHubPlacement(container, { store: { latest: latest as never }, sendCommand: vi.fn() });
    expect(container.querySelector('[data-testid="hub-order-status"]')!.textContent).toBe('No active Hub order');
    expect((container.querySelector('[data-testid="hub-cancel-order"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('a bare host code is replaced by the ghost block text once the newer view shows the same cause', async () => {
    const host = flatHost();
    let resolve!: (r: { ok: boolean; code: string }) => void;
    const sendCommand = vi.fn(() => new Promise<{ ok: boolean; code: string }>((r) => { resolve = r; }));
    const hub = mountHubPlacement(document.createElement('div'), { host, sendCommand });
    hub.startPlacement(-3, 4);
    expect(hub.confirmPlacement()).toBe(true);
    const idx = hexIndex(host.state.grid.radius);
    const fp = getHubFootprintTiles(-3, 4);
    setTileTerrain(host.state.grid, idx.indexOf(fp[0].q, fp[0].r), TERRAIN.rock); // another player's view was newer
    resolve({ ok: false, code: 'terrain_unbuildable' });
    await flush();
    const g = hub.getGhostState();
    expect([g.valid, g.reasonCode, g.reasonText]).toEqual([false, 'terrain_unbuildable', 'rock: break it first']);
  });
});

describe('3D ghost hover path (FF-15, XC-17 caller)', () => {
  it('picks the tile under the pointer when it moves (not every frame) and re-evaluates only on a new tile', () => {
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    const pickTile = vi.fn((x: number, y: number) => ({ q: x, r: y }));
    const services: Record<string, unknown> = {
      canvas,
      pickTile,
      scene3d: { scene: new THREE.Scene(), tileToWorld: (q: number, r: number) => ({ x: q, y: 0, z: r }), biomeKey: () => 'dune' },
    };
    const hub: HubPlacementFeatureHandle = mountHubPlacement(document.createElement('div'), { host: flatHost(), sendCommand: vi.fn(), services });
    const hover = vi.spyOn(hub, 'hoverTile');
    let t = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => t);
    const renderer = createHubGhostRenderer({ flags: new Set(), host: 'server', services } as never);

    hub.startPlacement(0, 0);
    mouse(canvas, 'pointermove', 0, -3, 4);
    renderer.update({}, 0.016);
    renderer.update({}, 0.016);
    renderer.update({}, 0.016);
    expect(pickTile).toHaveBeenCalledTimes(1);
    expect(hover).toHaveBeenCalledWith(-3, 4);
    expect([hub.peekGhostState().q, hub.peekGhostState().r]).toEqual([-3, 4]);

    t += GHOST_IDLE_PICK_MS; // resting pointer: one re-pick per idle period (the camera may have panned)
    renderer.update({}, 0.016);
    expect(pickTile).toHaveBeenCalledTimes(2);
    expect(hover).toHaveBeenCalledTimes(1); // same tile: no re-evaluation
    renderer.dispose();
  });
});
