import { parseCommandArgs, parseWaves } from '@terra/contracts';
import {
  createPlanet,
  getColonyTerraformOrders,
  hexIndex,
  PREP,
  setTileTerrain,
  SimHost,
  spawnHqUnit,
  TERRAIN,
} from '@terra/sim';
import { describe, expect, it, vi } from 'vitest';
import { loadFeatures } from '../../core/registry';
import {
  computeBoxTiles,
  ensureDom,
  mountTerraformBasic,
  terraformBasicFeature,
} from './index';

function createMixed4x4Host() {
  const host = new SimHost({ flags: parseWaves('..01') });
  host.load(createPlanet({ type: 'flat', seed: 'tf-menu-4x4', radius: 12 }));
  const state = host.state;
  spawnHqUnit(state, { owner: 0, q: 0, r: 0 });
  const idx = hexIndex(state.grid.radius);

  // Set up a 4x4 patch at q: 1..4, r: 0..3 (16 tiles total):
  // r=0: 4 Flat tiles (need 'grade')
  // r=1: 4 Forest tiles (need 'clear')
  // r=2: 4 Rock tiles (need 'break')
  // r=3: 4 Deep Water tiles (invalid for S0 ops -> skipped)
  for (let q = 1; q <= 4; q++) {
    setTileTerrain(state.grid, idx.indexOf(q, 0), TERRAIN.flat);
    setTileTerrain(state.grid, idx.indexOf(q, 1), TERRAIN.forest);
    setTileTerrain(state.grid, idx.indexOf(q, 2), TERRAIN.rock);
    setTileTerrain(state.grid, idx.indexOf(q, 3), TERRAIN.deep);
  }
  return host;
}

describe('W01-27: Terraform menu v1, single/area brush, skipped count, and tile-state overlay', () => {
  it('acceptance: brush a 4x4 mixed terrain -> one order covering needed ops, invalid ops skipped and counted, overlay shows progress', () => {
    ensureDom();
    const host = createMixed4x4Host();
    const state = host.state;
    const container = document.createElement('div');
    const sendCommand = vi.fn();

    const tf = mountTerraformBasic(container, { host, sendCommand });
    expect(tf.toggleOverlay(true)).toBe(true);

    const overlayEl = container.querySelector<HTMLElement>('[data-testid="tf-tile-overlay"]')!;
    expect(overlayEl).not.toBeNull();
    expect(overlayEl.hidden).toBe(false);

    tf.setBrushMode('area');
    const stroke = tf.strokeArea({ q: 1, r: 0 }, { q: 4, r: 3 });

    // 16 tiles brushed: 12 valid (4 grade + 4 clear + 4 break), 4 skipped (Deep Water)
    expect(stroke.tiles).toHaveLength(16);
    expect(stroke.queuedCount).toBe(12);
    expect(stroke.skippedCount).toBe(4);

    // Exactly one enqueueTask command was emitted for the entire brush stroke, valid per @terra/contracts
    expect(sendCommand).toHaveBeenCalledTimes(1);
    const [cmdKind, cmdArgs] = sendCommand.mock.calls[0];
    expect(cmdKind).toBe('enqueueTask');
    expect(parseCommandArgs('enqueueTask', cmdArgs).success).toBe(true);

    // Verify one order in state.blobs.terraformTasks covering 'grade', 'clear', and 'break'
    const orders = getColonyTerraformOrders(state, 0);
    expect(orders).toHaveLength(1);
    expect(orders[0].skippedCount).toBe(4);
    expect(orders[0].jobs).toHaveLength(12);
    const opsInOrder = new Set(orders[0].jobs.map((j) => j.op));
    expect(opsInOrder).toEqual(new Set(['grade', 'clear', 'break']));

    // Status readout shows queued and skipped counts
    const statusEl = container.querySelector('[data-testid="tf-status"]')!;
    expect(statusEl.textContent).toContain('Queued 12 jobs · 4 skipped');

    // Step 5 ticks (1.0s into a 2.0s Grade job at 1.5x HQ rate -> 50% progress on first job)
    const initialProgress = tf.getOverlayState().progress;
    expect(initialProgress).toBe(0);

    host.step(5);
    const midState = tf.getOverlayState();
    expect(midState.activeOrder?.currentJob?.percent).toBe(50);
    expect(midState.progress).toBeGreaterThan(initialProgress);
    expect(overlayEl.textContent).toContain('50%');

    // Step 5 more ticks -> first tile finishes grading and becomes Prepared
    host.step(5);
    const afterFirstTile = tf.getOverlayState();
    expect(afterFirstTile.activeOrder?.completedJobs).toBe(1);
    expect(afterFirstTile.activeOrder?.remainingJobs).toBe(11);
    expect(afterFirstTile.counts.prepared).toBe(1);
    const firstTileChip = overlayEl.querySelector('[data-q="1"][data-r="0"]')!;
    expect(firstTileChip.getAttribute('data-state')).toBe('prepared');

    tf.dispose();
  });

  it('filters single-op brush strokes to valid tiles for Clear, Break, and strict Grade and counts skipped tiles', () => {
    ensureDom();
    const host = createMixed4x4Host();
    const container = document.createElement('div');
    const tf = mountTerraformBasic(container, { host });

    // Select Clear: only the 4 Forest tiles are valid; 12 tiles are skipped
    tf.selectOp('clear');
    const clearStroke = tf.strokeArea({ q: 1, r: 0 }, { q: 4, r: 3 });
    expect(clearStroke.queuedCount).toBe(4);
    expect(clearStroke.skippedCount).toBe(12);
    expect(clearStroke.jobs.every((j) => j.op === 'clear')).toBe(true);

    // Select Break: only the 4 Rock tiles are valid; 12 tiles are skipped
    tf.selectOp('break');
    const breakStroke = tf.strokeArea({ q: 1, r: 0 }, { q: 4, r: 3 });
    expect(breakStroke.queuedCount).toBe(4);
    expect(breakStroke.skippedCount).toBe(12);
    expect(breakStroke.jobs.every((j) => j.op === 'break')).toBe(true);

    // Strict Grade: only the 4 Flat tiles are valid; 12 tiles are skipped
    tf.selectOp('grade');
    const gradeStroke = tf.strokeArea({ q: 1, r: 0 }, { q: 4, r: 3 }, { strictOp: true });
    expect(gradeStroke.queuedCount).toBe(4);
    expect(gradeStroke.skippedCount).toBe(12);
    expect(gradeStroke.jobs.every((j) => j.op === 'grade')).toBe(true);

    const orders = getColonyTerraformOrders(host.state, 0);
    expect(orders).toHaveLength(3);
    tf.dispose();
  });
});

describe('W01-27: Terraform menu pointer events, hotkeys, cancel, and feature registry', () => {
  it('supports pointer drag area brushing, single-tile clicking, hotkeys, and order cancellation', () => {
    ensureDom();
    const host = createMixed4x4Host();
    const container = document.createElement('div');
    const surface = document.createElement('div');
    const storeSend = vi.fn();
    const tf = mountTerraformBasic(container, {
      host,
      surface,
      store: { sendCommand: storeSend },
      pickTile: (x, y) => ({ q: x, r: y }),
    });

    // Click brush mode button to switch from 'single' to 'area'
    const modeBtn = container.querySelector('[data-testid="tf-brush-mode"]') as HTMLButtonElement;
    expect(tf.getBrushMode()).toBe('single');
    modeBtn.click();
    expect(tf.getBrushMode()).toBe('area');

    // Drag from (1, 0) to (4, 3) on surface -> sends exactly 1 order on pointerup
    surface.dispatchEvent({ type: 'pointerdown', button: 0, clientX: 1, clientY: 0 } as unknown as Event);
    surface.dispatchEvent({ type: 'pointermove', button: 0, clientX: 2, clientY: 2 } as unknown as Event);
    expect(storeSend).toHaveBeenCalledTimes(0);
    surface.dispatchEvent({ type: 'pointerup', button: 0, clientX: 4, clientY: 3 } as unknown as Event);
    expect(storeSend).toHaveBeenCalledTimes(1);
    expect(getColonyTerraformOrders(host.state, 0)).toHaveLength(1);

    // Hotkeys: C -> clear, B -> break, G -> grade, V -> toggle overlay
    window.dispatchEvent({ type: 'keydown', key: 'c' } as unknown as Event);
    expect(tf.getSelectedOp()).toBe('clear');
    window.dispatchEvent({ type: 'keydown', key: 'b' } as unknown as Event);
    expect(tf.getSelectedOp()).toBe('break');
    window.dispatchEvent({ type: 'keydown', key: 'g' } as unknown as Event);
    expect(tf.getSelectedOp()).toBe('grade');
    window.dispatchEvent({ type: 'keydown', key: 'v' } as unknown as Event);
    expect(tf.getOverlayState().visible).toBe(true);

    // Cancel button cancels the active order
    const cancelBtn = container.querySelector('[data-testid="tf-cancel"]') as HTMLButtonElement;
    cancelBtn.click();
    expect(getColonyTerraformOrders(host.state, 0)).toHaveLength(0);
    tf.dispose();
  });

  it('registers terraform-basic under wave W01 and computes deterministic box tiles', () => {
    expect(terraformBasicFeature.id).toBe('terraform-basic');
    expect(terraformBasicFeature.wave).toBe('W01');
    expect(loadFeatures({ flags: new Set(['W00']), host: 'server' }).map((f) => f.id)).not.toContain('terraform-basic');
    expect(loadFeatures({ flags: new Set(['W00', 'W01']), host: 'server' }).map((f) => f.id)).toContain(
      'terraform-basic',
    );
    expect(computeBoxTiles({ q: 4, r: 3 }, { q: 1, r: 0 })).toHaveLength(16);
    expect(PREP.prepared).toBe(2);
  });
});
