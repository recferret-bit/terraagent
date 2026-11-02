// @vitest-environment jsdom
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
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadFeatures } from '../../core/registry';
import { computeBoxTiles, mountTerraformBasic as mountRaw, terraformBasicFeature } from './index';

// Every mount is disposed after its test, also when the test fails (no window listeners leak into the next test).
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

const click = (target: EventTarget, type: string, button: number, x: number, y: number) =>
  target.dispatchEvent(new MouseEvent(type, { button, clientX: x, clientY: y, bubbles: true, cancelable: true }));
const press = (key: string, init: KeyboardEventInit = {}) =>
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
const pickXY = (x: number, y: number) => ({ q: x, r: y });

describe('W01-27: Terraform menu v1, single/area brush, skipped count, and tile-state overlay', () => {
  it('acceptance: brush a 4x4 mixed terrain -> one order covering needed ops, invalid ops skipped and counted, overlay shows progress', () => {
    const host = createMixed4x4Host();
    const state = host.state;
    const submit = vi.spyOn(host, 'submit');
    const container = document.createElement('div');

    const tf = mountTerraformBasic(container, { host });
    expect(tf.toggleOverlay(true)).toBe(true);

    const overlayEl = container.querySelector<HTMLElement>('[data-testid="tf-tile-overlay"]')!;
    expect(overlayEl.hidden).toBe(false);

    tf.setBrushMode('area');
    const stroke = tf.strokeArea({ q: 1, r: 0 }, { q: 4, r: 3 });

    // 16 tiles brushed: 12 valid (4 grade + 4 clear + 4 break), 4 skipped (Deep Water)
    expect(stroke.tiles).toHaveLength(16);
    expect(stroke.queuedCount).toBe(12);
    expect(stroke.skippedCount).toBe(4);

    // Exactly one enqueueTask command, submitted to the authoritative host only, valid per @terra/contracts
    expect(submit).toHaveBeenCalledTimes(1);
    const cmd = submit.mock.calls[0][0];
    expect(cmd.kind).toBe('enqueueTask');
    expect(cmd.colonyIndex).toBe(0);
    expect(parseCommandArgs('enqueueTask', cmd.args).success).toBe(true);
    expect(getColonyTerraformOrders(state, 0)).toHaveLength(0); // the client never writes the state itself

    host.step(1);
    const orders = getColonyTerraformOrders(state, 0);
    expect(orders).toHaveLength(1);
    expect(tf.overlay.getActiveOrder()?.orderId).toBe(orders[0].orderId); // the host names the order
    expect(orders[0].skippedCount).toBe(4);
    expect(orders[0].jobs).toHaveLength(12);
    expect(new Set(orders[0].jobs.map((j) => j.op))).toEqual(new Set(['grade', 'clear', 'break']));

    const statusEl = container.querySelector('[data-testid="tf-status"]')!;
    expect(statusEl.textContent).toContain('Queued 12 jobs · 4 skipped');

    host.step(4);
    const midState = tf.getOverlayState();
    expect(midState.activeOrder?.currentJob?.percent).toBe(50);
    expect(overlayEl.textContent).toContain('50%');

    host.step(5);
    const afterFirstTile = tf.getOverlayState();
    expect(afterFirstTile.activeOrder?.completedJobs).toBe(1);
    expect(afterFirstTile.activeOrder?.remainingJobs).toBe(11);
    expect(afterFirstTile.counts.prepared).toBe(1);
    expect(overlayEl.querySelector('[data-q="1"][data-r="0"]')!.getAttribute('data-state')).toBe('prepared');
    tf.dispose();
  });

  it('single-op strokes: Clear / Break run their op only, a multi-tile Grade prepares each tile (the host rule)', () => {
    const host = createMixed4x4Host();
    const tf = mountTerraformBasic(document.createElement('div'), { host });

    tf.selectOp('clear');
    const clearStroke = tf.strokeArea({ q: 1, r: 0 }, { q: 4, r: 3 });
    expect([clearStroke.queuedCount, clearStroke.skippedCount]).toEqual([4, 12]);
    expect(clearStroke.jobs.every((j) => j.op === 'clear')).toBe(true);

    tf.selectOp('break');
    const breakStroke = tf.strokeArea({ q: 1, r: 0 }, { q: 4, r: 3 });
    expect([breakStroke.queuedCount, breakStroke.skippedCount]).toEqual([4, 12]);

    tf.selectOp('grade');
    const gradeTile = tf.strokeTile(1, 1); // forest: a one-tile Grade is Grade only
    expect([gradeTile.queuedCount, gradeTile.skippedCount]).toEqual([0, 1]);

    host.step(1);
    const orders = getColonyTerraformOrders(host.state, 0);
    // The preview agrees with what the host queued (the Grade tile on forest is rejected as a whole command).
    expect(orders.map((o) => o.jobs.length)).toEqual([4, 4]);
    expect(orders.map((o) => o.op)).toEqual(['clear', 'break']);
    tf.dispose();
  });
});

describe('Terraform brush wiring (FF-01, FF-02, FF-04, FF-09)', () => {
  it('online services without `surface`: the brush binds to `services.canvas` and an armed click sends one order', () => {
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    const sendCommand = vi.fn();
    const services = { canvas, pickTile: pickXY, sendCommand };
    const tf = mountTerraformBasic(document.createElement('div'), { services });

    press('b');
    click(canvas, 'pointerdown', 0, 2, 2);
    click(canvas, 'pointerup', 0, 2, 2);
    expect(sendCommand).toHaveBeenCalledTimes(1);
    expect(sendCommand).toHaveBeenCalledWith('enqueueTask', { terraform: { op: 'break', tiles: [{ q: 2, r: 2 }] } });
    tf.dispose();
    canvas.remove();
  });

  it('one stroke and one cancel go through exactly one channel even when the bus and the store are both given', () => {
    const bus = vi.fn();
    const storeSend = vi.fn();
    const tf = mountTerraformBasic(document.createElement('div'), { sendCommand: bus, store: { sendCommand: storeSend } });
    tf.strokeTile(1, 0);
    expect(tf.cancelOrder('tf_order_7')).toBe(true);
    expect(bus.mock.calls.map((c) => c[0])).toEqual(['enqueueTask', 'cancelTask']);
    expect(bus.mock.calls[1][1]).toEqual({ taskId: 'tf_order_7' });
    expect(storeSend).not.toHaveBeenCalled();
    tf.dispose();
  });

  it('a box larger than one command may carry is not sent; the status line says so (FF-33)', () => {
    const sendCommand = vi.fn();
    const container = document.createElement('div');
    const tf = mountTerraformBasic(container, { sendCommand });
    const stroke = tf.strokeArea({ q: 0, r: 0 }, { q: 16, r: 16 }); // 289 tiles
    expect([stroke.tooLarge, stroke.queuedCount, stroke.skippedCount]).toEqual([true, 0, 289]);
    expect(sendCommand).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="tf-status"]')!.textContent).toBe('Area too large: 289 tiles, nothing sent');
  });

  it('never writes the host state: with a command bus the in-process host sees no order and no submit', () => {
    const host = createMixed4x4Host();
    const submit = vi.spyOn(host, 'submit');
    const sendCommand = vi.fn();
    const tf = mountTerraformBasic(document.createElement('div'), { host, sendCommand });
    tf.setBrushMode('area');
    tf.strokeArea({ q: 1, r: 0 }, { q: 4, r: 3 });
    expect(sendCommand).toHaveBeenCalledTimes(1);
    expect(submit).not.toHaveBeenCalled();
    host.step(1);
    expect(getColonyTerraformOrders(host.state, 0)).toHaveLength(0);
    tf.dispose();
  });

  it('CANCEL is disabled until the host order is in the view and then cancels that order by its host id', () => {
    const host = createMixed4x4Host();
    const submit = vi.spyOn(host, 'submit');
    const container = document.createElement('div');
    const tf = mountTerraformBasic(container, { host });
    const cancelBtn = container.querySelector('[data-testid="tf-cancel"]') as HTMLButtonElement;

    tf.strokeTile(1, 0);
    expect(cancelBtn.disabled).toBe(true); // a stroke the host has not queued yet has no id to cancel
    expect(tf.cancelOrder()).toBe(false);
    expect(submit).toHaveBeenCalledTimes(1);

    host.step(1);
    tf.update(host.view() as never);
    const hostId = getColonyTerraformOrders(host.state, 0)[0].orderId;
    expect(cancelBtn.disabled).toBe(false);
    cancelBtn.click();
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit.mock.calls[1][0]).toMatchObject({ kind: 'cancelTask', args: { taskId: hostId } });
    host.step(1);
    expect(getColonyTerraformOrders(host.state, 0)).toHaveLength(0);
    tf.dispose();
  });

  it('works for the player colony from landfall, not colony 0 (FF-05)', () => {
    const host = createMixed4x4Host();
    const submit = vi.spyOn(host, 'submit');
    let owner = 0;
    const services = { host, landfall: { getOwnerColonyIndex: () => owner } } as never;
    const tf = mountTerraformBasic(document.createElement('div'), { services });
    owner = 1; // the seat arrives after mount
    tf.strokeTile(1, 0);
    expect(submit.mock.calls[0][0].colonyIndex).toBe(1);
    tf.dispose();
  });
});

function mountOnCanvas(extra: Record<string, unknown> = {}) {
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  const sendCommand = vi.fn();
  const below = vi.fn(); // stands in for the HQ selection / order listeners bound on the same canvas
  canvas.addEventListener('pointerup', below);
  canvas.addEventListener('contextmenu', below);
  const services = { canvas, pickTile: pickXY, sendCommand, ...extra };
  const tf = mountTerraformBasic(document.createElement('div'), { services });
  return { canvas, sendCommand, below, tf, done: () => { tf.dispose(); canvas.remove(); } };
}

describe('Brush input: armed mode, one owner per click (FF-06, FF-11)', () => {
  it('an unarmed brush leaves map clicks alone; an armed one consumes them; right click and Esc disarm', () => {
    const { canvas, sendCommand, below, tf, done } = mountOnCanvas();
    expect(tf.isArmed()).toBe(false);
    click(canvas, 'pointerdown', 0, 1, 0);
    click(canvas, 'pointerup', 0, 1, 0);
    expect(sendCommand).not.toHaveBeenCalled();
    expect(below).toHaveBeenCalledTimes(1);

    press('g');
    expect(tf.isArmed()).toBe(true);
    click(canvas, 'pointerdown', 0, 1, 0);
    click(canvas, 'pointerup', 0, 1, 0);
    expect(sendCommand).toHaveBeenCalledTimes(1);
    expect(below).toHaveBeenCalledTimes(1); // the click had one owner

    // macOS order: contextmenu on press, then pointerup — both stay with the brush, no HQ order underneath
    click(canvas, 'pointerdown', 2, 3, 3);
    click(canvas, 'contextmenu', 2, 3, 3);
    click(canvas, 'pointerup', 2, 3, 3);
    expect(tf.isArmed()).toBe(false);
    expect(below).toHaveBeenCalledTimes(1);

    press('c');
    const pause = vi.fn();
    window.addEventListener('keydown', pause);
    press('Escape');
    expect(tf.isArmed()).toBe(false);
    expect(pause).not.toHaveBeenCalled(); // the session's pause handler never sees the Esc that disarmed
    press('Escape');
    expect(pause).toHaveBeenCalledTimes(1); // nothing armed: Esc goes on to pause
    window.removeEventListener('keydown', pause);
    done();
  });

  it('a press released off the canvas (pointercancel) does not swallow the next click once disarmed', () => {
    const { canvas, sendCommand, below, tf, done } = mountOnCanvas();
    press('g');
    click(canvas, 'pointerdown', 0, 1, 0);
    canvas.dispatchEvent(new MouseEvent('pointercancel', { bubbles: true }));
    tf.disarm();
    click(canvas, 'pointerdown', 0, 1, 0);
    click(canvas, 'pointerup', 0, 1, 0);
    expect(below).toHaveBeenCalledTimes(1); // the selection click reaches the HQ controller
    expect(sendCommand).not.toHaveBeenCalled();
    done();
  });

  it('area drag sends one order on release; Windows right-click order (pointerup, then contextmenu) is consumed too', () => {
    const { canvas, sendCommand, below, tf, done } = mountOnCanvas();
    tf.setBrushMode('area');
    press('g');
    click(canvas, 'pointerdown', 0, 1, 0);
    click(canvas, 'pointermove', 0, 2, 2);
    expect(sendCommand).not.toHaveBeenCalled();
    click(canvas, 'pointerup', 0, 4, 3);
    expect(sendCommand).toHaveBeenCalledTimes(1);
    expect((sendCommand.mock.calls[0][1] as { terraform: { tiles: unknown[] } }).terraform.tiles).toHaveLength(16);

    click(canvas, 'pointerdown', 2, 3, 3);
    click(canvas, 'pointerup', 2, 3, 3);
    click(canvas, 'contextmenu', 2, 3, 3);
    expect(tf.isArmed()).toBe(false);
    expect(below).not.toHaveBeenCalled();
    done();
  });

});

describe('Brush hotkeys and op buttons (FF-07)', () => {
  it('hotkeys ignore auto-repeat, text fields and an open Hub ghost; V toggles the overlay', () => {
    let placing = false;
    const { tf, done } = mountOnCanvas({ hubPlacement: { isPlacementActive: () => placing } });
    press('b', { repeat: true });
    expect(tf.isArmed()).toBe(false);

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }));
    expect(tf.isArmed()).toBe(false);
    input.remove();

    placing = true;
    press('b');
    expect(tf.isArmed()).toBe(false);
    placing = false;
    press('b');
    expect([tf.isArmed(), tf.getSelectedOp()]).toEqual([true, 'break']);

    press('v');
    expect(tf.getOverlayState().visible).toBe(true);
    press('o');
    expect(tf.getOverlayState().visible).toBe(true); // O is not a second overlay key
    done();
  });

  it('clicking the armed op button again disarms; the status line says how to start', () => {
    const container = document.createElement('div');
    const tf = mountTerraformBasic(container, {});
    const breakBtn = container.querySelector('[data-testid="tf-op-break"]') as HTMLButtonElement;
    const status = container.querySelector('[data-testid="tf-status"]')!;
    expect(status.textContent).toBe('Pick an op to paint the map');
    breakBtn.click();
    expect([tf.isArmed(), breakBtn.getAttribute('aria-pressed')]).toEqual([true, 'true']);
    expect(status.textContent).toBe('Tool: BREAK · SINGLE');
    breakBtn.click();
    expect([tf.isArmed(), breakBtn.getAttribute('aria-pressed')]).toEqual([false, 'false']);
    tf.dispose();
  });
});

describe('Tile overlay while hidden (FF-08)', () => {
  it('keeps the active order current but builds no chips until shown; chips are reused between views', () => {
    const host = createMixed4x4Host();
    const container = document.createElement('div');
    const tf = mountTerraformBasic(container, { host });
    tf.strokeArea({ q: 1, r: 0 }, { q: 4, r: 0 });
    host.step(1);
    tf.update(host.view() as never);
    const jobs = container.querySelector('[data-testid="tf-overlay-jobs"]')!;
    expect(jobs.childElementCount).toBe(0);
    expect(tf.overlay.getActiveOrder()?.totalJobs).toBe(4);

    tf.toggleOverlay(true);
    const first = jobs.querySelector('[data-q="1"][data-r="0"]');
    expect(jobs.childElementCount).toBe(4);
    host.step(2);
    tf.update(host.view() as never);
    expect(jobs.querySelector('[data-q="1"][data-r="0"]')).toBe(first);
    tf.dispose();
  });
});

describe('W01-27: feature registry', () => {
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
