// @vitest-environment jsdom
import { parseCommandArgs, parseWaves } from '@terra/contracts';
import {
  createPlanet,
  ENTITY_KIND,
  getColonyTerraformOrders,
  getEntityBaseBuildCost,
  hexIndex,
  PREP,
  setTileTerrain,
  SimHost,
  spawnHqUnit,
  TERRAIN,
} from '@terra/sim';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadFeatures } from '../../core/registry';
import {
  calculateDismantleRefund,
  calculateRepairCost,
  incomeReferenceRows,
  mountTerraformBasic as mountRaw,
  timeReferenceRows,
  terraformBasicFeature,
} from './index';

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

describe('W01-27: S0 ops (API), skipped tiles, and tile-state overlay', () => {
  it('one S0 stroke = one order; a tile the op cannot work is skipped and not sent; the overlay shows progress', () => {
    const host = createMixed4x4Host();
    const state = host.state;
    const submit = vi.spyOn(host, 'submit');
    const container = document.createElement('div');

    const tf = mountTerraformBasic(container, { host });
    expect(tf.toggleOverlay(true)).toBe(true);
    const overlayEl = container.querySelector<HTMLElement>('[data-testid="tf-tile-overlay"]')!;
    expect(overlayEl.hidden).toBe(false);

    const water = tf.strokeTile(1, 3, { op: 'grade' });
    expect([water.queuedCount, water.skippedCount]).toEqual([0, 1]);
    expect(submit).not.toHaveBeenCalled();

    const stroke = tf.strokeTile(1, 0, { op: 'grade' });
    expect([stroke.queuedCount, stroke.skippedCount]).toEqual([1, 0]);
    expect(submit).toHaveBeenCalledTimes(1);
    const cmd = submit.mock.calls[0][0];
    expect(cmd.kind).toBe('enqueueTask');
    expect(cmd.colonyIndex).toBe(0);
    expect(parseCommandArgs('enqueueTask', cmd.args).success).toBe(true);
    expect(getColonyTerraformOrders(state, 0)).toHaveLength(0);

    host.step(1);
    const orders = getColonyTerraformOrders(state, 0);
    expect(orders).toHaveLength(1);
    expect(tf.overlay.getActiveOrder()?.orderId).toBe(orders[0].orderId);
    expect(container.querySelector('[data-testid="tf-status"]')!.textContent).toContain('0 / 1 jobs');

    host.step(4);
    expect(tf.getOverlayState().activeOrder?.currentJob?.percent).toBe(50);
    expect(overlayEl.textContent).toContain('50%');

    host.step(5);
    expect(tf.getOverlayState().counts.prepared).toBe(1);
    tf.dispose();
  });

  it('single-op strokes: Clear / Break run their op only on their own terrain', () => {
    const host = createMixed4x4Host();
    const tf = mountTerraformBasic(document.createElement('div'), { host });
    expect(tf.strokeTile(1, 1, { op: 'clear' }).jobs.map((j) => j.op)).toEqual(['clear']);
    expect(tf.strokeTile(1, 2, { op: 'break' }).jobs.map((j) => j.op)).toEqual(['break']);
    expect(tf.strokeTile(2, 2, { op: 'clear' }).queuedCount).toBe(0);
    host.step(1);
    expect(getColonyTerraformOrders(host.state, 0).map((o) => o.op)).toEqual(['clear', 'break']);
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

    press('g');
    click(canvas, 'pointerdown', 0, 2, 2);
    click(canvas, 'pointerup', 0, 2, 2);
    expect(sendCommand).toHaveBeenCalledTimes(1);
    expect(sendCommand).toHaveBeenCalledWith('enqueueTask', { terraform: { op: 'work', intent: 'terraform', tiles: [{ q: 2, r: 2 }] } });
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

  it('never writes the host state: with a command bus the in-process host sees no order and no submit', () => {
    const host = createMixed4x4Host();
    const submit = vi.spyOn(host, 'submit');
    const sendCommand = vi.fn();
    const tf = mountTerraformBasic(document.createElement('div'), { host, sendCommand });
    tf.strokeTile(1, 0, { op: 'grade' });
    tf.strokeTile(1, 1);
    expect(sendCommand).toHaveBeenCalledTimes(2);
    expect(submit).not.toHaveBeenCalled();
    host.step(1);
    expect(getColonyTerraformOrders(host.state, 0)).toHaveLength(0);
    tf.dispose();
  });

  it('cancelOrder() is a no-op until the host order is in the view and then cancels that order by its host id', () => {
    const host = createMixed4x4Host();
    const submit = vi.spyOn(host, 'submit');
    const container = document.createElement('div');
    const tf = mountTerraformBasic(container, { host });
    expect(container.querySelector('[data-testid="tf-cancel"]')).toBeNull();

    tf.strokeTile(1, 0, { op: 'grade' });
    expect(tf.cancelOrder()).toBe(false);
    expect(submit).toHaveBeenCalledTimes(1);

    host.step(1);
    tf.update(host.view() as never);
    const hostId = getColonyTerraformOrders(host.state, 0)[0].orderId;
    expect(tf.cancelOrder()).toBe(true);
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
    owner = 1;
    spawnHqUnit(host.state, { owner: 1, q: 2, r: 0 });
    tf.update(host.view() as never);
    tf.strokeTile(1, 0);
    expect(submit.mock.calls[0][0].colonyIndex).toBe(1);
    tf.dispose();
  });
});

function mountOnCanvas(extra: Record<string, unknown> = {}) {
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  const sendCommand = vi.fn();
  const below = vi.fn();
  canvas.addEventListener('pointerup', below);
  canvas.addEventListener('contextmenu', below);
  const services = { canvas, pickTile: pickXY, sendCommand, ...extra };
  const tf = mountTerraformBasic(document.createElement('div'), { services });
  return { canvas, sendCommand, below, tf, done: () => { tf.dispose(); canvas.remove(); } };
}

describe('Brush input: armed mode, one owner per click (FF-06, FF-11)', () => {
  it('an unarmed brush leaves map clicks alone; an armed one consumes left clicks; right click (passed on) and Esc disarm', () => {
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
    expect(below).toHaveBeenCalledTimes(1);
    // The click that sent the order disarmed the brush: the next click selects again.
    expect(tf.isArmed()).toBe(false);
    click(canvas, 'pointerdown', 0, 1, 0);
    click(canvas, 'pointerup', 0, 1, 0);
    expect([sendCommand.mock.calls.length, below.mock.calls.length]).toEqual([1, 2]);

    // A right click disarms and still reaches the map (a unit move is not swallowed).
    press('g');
    click(canvas, 'pointerdown', 2, 3, 3);
    click(canvas, 'contextmenu', 2, 3, 3);
    click(canvas, 'pointerup', 2, 3, 3);
    expect(tf.isArmed()).toBe(false);
    expect(below).toHaveBeenCalledTimes(4);

    press('x'); // X is the unit stop key only (owner decision W02): it never arms the brush
    expect(tf.isArmed()).toBe(false);
    press('z');
    const pause = vi.fn();
    window.addEventListener('keydown', pause);
    press('Escape');
    expect(tf.isArmed()).toBe(false);
    expect(pause).not.toHaveBeenCalled();
    press('Escape');
    expect(pause).toHaveBeenCalledTimes(1);
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
    expect(below).toHaveBeenCalledTimes(1);
    expect(sendCommand).not.toHaveBeenCalled();
    done();
  });

  it('a drag is still one click (on the release tile); a right click in either browser order disarms and passes on', () => {
    const { canvas, sendCommand, below, tf, done } = mountOnCanvas();
    press('g');
    click(canvas, 'pointerdown', 0, 1, 0);
    click(canvas, 'pointermove', 0, 2, 2);
    expect(sendCommand).not.toHaveBeenCalled();
    click(canvas, 'pointerup', 0, 4, 3);
    expect(sendCommand).toHaveBeenCalledTimes(1);
    expect((sendCommand.mock.calls[0][1] as { terraform: { tiles: unknown[] } }).terraform.tiles).toEqual([{ q: 4, r: 3 }]);

    press('g');
    click(canvas, 'pointerdown', 2, 3, 3);
    click(canvas, 'pointerup', 2, 3, 3);
    click(canvas, 'contextmenu', 2, 3, 3);
    expect(below).toHaveBeenCalledTimes(2);
    expect(tf.isArmed()).toBe(false);
    done();
  });
});

describe('Brush hotkeys and the 3-button Terraform UI (FF-07)', () => {
  it('G / R / Z arm TERRAFORM / REPAIR / DISMANTLE; hotkeys ignore auto-repeat, text fields and an open placement ghost', () => {
    let placing = false;
    let ghost: object | null = null;
    const { tf, done } = mountOnCanvas({ hubPlacement: { isPlacementActive: () => placing }, getPlacementGhostState: () => ghost });
    press('g', { repeat: true });
    expect(tf.isArmed()).toBe(false);

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', bubbles: true }));
    expect(tf.isArmed()).toBe(false);
    input.remove();

    placing = true;
    press('g');
    expect(tf.isArmed()).toBe(false);
    placing = false;
    ghost = { rotation: 0 };
    press('r');
    expect(tf.isArmed()).toBe(false);
    ghost = null;

    for (const [key, op] of [['g', 'terraform'], ['r', 'repair'], ['z', 'dismantle']] as const) {
      press(key);
      expect([tf.isArmed(), tf.getSelectedOp()]).toEqual([true, op]);
    }
    tf.disarm();
    for (const key of ['b', 'c', 'w', 'v', 'x']) press(key);
    expect(tf.isArmed()).toBe(false);
    done();
  });

  it('renders TERRAFORM, REPAIR, DISMANTLE top to bottom, and the reference tables (no BRUSH/OVERLAY/CANCEL buttons)', () => {
    const container = document.createElement('div');
    const tf = mountTerraformBasic(container, {});
    const opBtns = [...container.querySelectorAll<HTMLButtonElement>('[data-op]')];
    expect(opBtns.map((b) => b.dataset.testid ?? b.getAttribute('data-testid'))).toEqual([
      'tf-op-terraform',
      'tf-op-repair',
      'tf-op-dismantle',
    ]);
    for (const id of ['tf-op-work', 'tf-cancel-tool', 'tf-brush-mode', 'tf-overlay-toggle', 'tf-cancel'])
      expect(container.querySelector(`[data-testid="${id}"]`)).toBeNull();
    const [terraformBtn, repairBtn, dismantleBtn] = opBtns as [HTMLButtonElement, HTMLButtonElement, HTMLButtonElement];
    const status = container.querySelector('[data-testid="tf-status"]')!;

    expect(terraformBtn.textContent).toBe('TERRAFORM [G]Flatten ground · continuous');
    expect(repairBtn.textContent).toBe('REPAIR [R]40% of base cost');
    expect(dismantleBtn.textContent).toBe('DISMANTLE [Z]½ build time · 50% of cost back');
    expect(status.textContent).toBe('Pick an op, then click a hex');

    repairBtn.click();
    expect([tf.isArmed(), tf.getSelectedOp(), repairBtn.getAttribute('aria-pressed')]).toEqual([true, 'repair', 'true']);
    expect(terraformBtn.getAttribute('aria-pressed')).toBe('false');
    expect(status.textContent).toBe('Tool: REPAIR · click a hex');
    repairBtn.click();
    expect([tf.isArmed(), repairBtn.getAttribute('aria-pressed')]).toEqual([false, 'false']);

    const timeTable = container.querySelector('[data-testid="tf-time-table"]')!;
    const incomeTable = container.querySelector('[data-testid="tf-income-table"]')!;
    for (const row of timeReferenceRows()) {
      expect(timeTable.textContent).toContain(row.target);
      expect(timeTable.textContent).toContain(row.detail);
    }
    expect(timeTable.textContent).toContain('Resource find1% per hex · t1 50% / t2 35% / t3 15%');
    for (const row of incomeReferenceRows()) {
      expect(incomeTable.textContent).toContain(row.target);
      expect(incomeTable.textContent).toContain(row.detail);
    }
    tf.dispose();
  });
});

/** Packed tile layers of a small flat planet: forest (8,0), deep water (9,0), level prepared Flat (10,0). */
function groundFixture() {
  const planet = createPlanet({ type: 'flat', seed: 'tf-cmds', radius: 12 });
  const idx = hexIndex(planet.grid.radius);
  const L = planet.grid.layers;
  L.height.fill(0);
  L.deposit.fill(0);
  setTileTerrain(planet.grid, idx.indexOf(8, 0), TERRAIN.forest);
  setTileTerrain(planet.grid, idx.indexOf(9, 0), TERRAIN.deep);
  setTileTerrain(planet.grid, idx.indexOf(10, 0), TERRAIN.flat);
  L.prep[idx.indexOf(10, 0)] = PREP.prepared;
  return {
    planet: { id: 'p', type: 'flat', radius: planet.grid.radius },
    tiles: { count: planet.grid.count, terrain: L.terrain, prep: L.prep, owner: L.owner, deposit: L.deposit, height: L.height },
  };
}

describe('TERRAFORM / REPAIR / DISMANTLE commands', () => {
  function mountWithEntities(workerId?: number) {
    const sendCommand = vi.fn();
    const sel = workerId === undefined ? null : { entityId: workerId, isUnit: true, kind: workerId === 4 ? ENTITY_KIND.harvester : ENTITY_KIND.hq, hp: 1 };
    const landfall = { getOwnerColonyIndex: () => 0, getSelectedEntity: () => sel };
    const tf = mountTerraformBasic(document.createElement('div'), { services: { sendCommand, landfall } as never });
    tf.update({
      ...groundFixture(),
      entities: [
        { id: 1, kind: 'commandHub', owner: 0, q: 0, r: 0, hp: 500, hpMax: 500, footprint: 2 },
        { id: 2, kind: 'hq', owner: 0, q: 2, r: 0, hp: 200, hpMax: 200 },
        { id: 3, kind: 'solar', owner: 0, q: 4, r: 4, hp: 150, hpMax: 300, footprint: 2 },
      ],
      units: [{ id: 4, kind: 'harvester', owner: 0, q: 6, r: 0, hp: 80, hpMax: 160 }],
    } as never);
    const lastTerraform = () => (sendCommand.mock.lastCall?.[1] as { terraform: unknown } | undefined)?.terraform;
    return { tf, sendCommand, lastTerraform };
  }

  it('TERRAFORM sends one `work` order with intent `terraform` and the selected unit; water and prepared hexes send nothing', () => {
    const { tf, sendCommand, lastTerraform } = mountWithEntities(2);
    expect(tf.hasWorkerAvailable()).toBe(true);
    tf.selectOp('terraform');
    tf.strokeTile(8, 0);
    expect(tf.getLastOutcome()).toMatchObject({ ok: true, op: 'terraform', yields: { 'bio.biomass': 15 } });
    expect(sendCommand).toHaveBeenLastCalledWith('enqueueTask', expect.anything());
    expect(lastTerraform()).toEqual({ op: 'work', intent: 'terraform', tiles: [{ q: 8, r: 0 }], workerId: 2 });
    expect(parseCommandArgs('enqueueTask', sendCommand.mock.lastCall?.[1]).success).toBe(true);

    tf.strokeTile(9, 0);
    expect(tf.getLastOutcome()).toMatchObject({ ok: false, reason: 'water_tile' });
    tf.strokeTile(10, 0);
    expect(tf.getLastOutcome()).toMatchObject({ ok: false, reason: 'already_prepared' });
    expect(sendCommand).toHaveBeenCalledTimes(1);
  });

  it('REPAIR targets a damaged own entity only (40% full-repair cost); elsewhere it says so and sends nothing', () => {
    const { tf, sendCommand, lastTerraform } = mountWithEntities(4);
    tf.selectOp('repair');
    tf.strokeTile(12, 12);
    expect(tf.getLastOutcome()).toMatchObject({ ok: false, reason: 'nothing_to_repair', status: 'Nothing to repair here' });
    tf.strokeTile(2, 0);
    expect(tf.getLastOutcome()).toMatchObject({ ok: false, reason: 'nothing_to_repair' });
    expect(sendCommand).not.toHaveBeenCalled();

    tf.strokeTile(4, 4);
    expect(tf.getLastOutcome()).toMatchObject({
      ok: true,
      op: 'repair',
      targetId: 3,
      status: 'Repair ordered (40% base cost for full repair)',
      // The sim's own Solar cost row, half damaged: 40% × 50% of it.
      repairCost: calculateRepairCost(getEntityBaseBuildCost(ENTITY_KIND.solar) as Record<string, number>, 150, 300),
    });
    expect((tf.getLastOutcome() as { repairCost: Record<string, number> }).repairCost['metals.t1']).toBe(12);
    expect(lastTerraform()).toEqual({ op: 'work', intent: 'repair', tiles: [{ q: 4, r: 4 }], workerId: 4 });
    expect(parseCommandArgs('enqueueTask', sendCommand.mock.lastCall?.[1]).success).toBe(true);

    // The selected damaged harvester is the target, so it is not also named as the worker.
    tf.strokeTile(6, 0);
    expect(lastTerraform()).toEqual({ op: 'work', intent: 'repair', tiles: [{ q: 6, r: 0 }] });
    expect(calculateRepairCost({ 'metals.t1': 100 }, 0, 100)).toEqual({ 'metals.t1': 40 });
  });

  it('DISMANTLE: HQ / Command Hub protected, 50% refund, no worker id', () => {
    const { tf, lastTerraform } = mountWithEntities(2);
    tf.selectOp('dismantle');
    tf.strokeTile(12, 12);
    expect(tf.getLastOutcome()).toMatchObject({ ok: false, reason: 'no_target_to_dismantle' });
    tf.strokeTile(0, 0);
    expect(tf.getLastOutcome()).toMatchObject({ ok: false, reason: 'cannot_dismantle_hq' });
    tf.strokeTile(2, 0);
    expect(tf.getLastOutcome()).toMatchObject({ ok: false, reason: 'cannot_dismantle_hq' });
    tf.strokeTile(5, 5);
    expect(tf.getLastOutcome()).toMatchObject({ ok: true, op: 'dismantle', targetId: 3, refund: calculateDismantleRefund(getEntityBaseBuildCost(ENTITY_KIND.solar) as Record<string, number>) });
    expect((tf.getLastOutcome() as { refund: Record<string, number> }).refund['metals.t1']).toBe(30);
    expect(lastTerraform()).toEqual({ op: 'dismantle', tiles: [{ q: 5, r: 5 }] });
    expect(calculateDismantleRefund({ 'metals.t1': 100 })).toEqual({ 'metals.t1': 50 });
  });

  it('the enqueueTerraform hook receives the same wire args', () => {
    const enqueueTerraform = vi.fn();
    const tf = mountTerraformBasic(document.createElement('div'), { enqueueTerraform });
    tf.strokeTile(3, 1);
    expect(enqueueTerraform).toHaveBeenCalledWith({ op: 'work', intent: 'terraform', tiles: [{ q: 3, r: 1 }] });
  });
});

describe('Tile overlay while hidden & feature registry (FF-08, W01-27)', () => {
  it('keeps the active order current while hidden, reuses chips when shown, and registers under W01', () => {
    const host = createMixed4x4Host();
    const container = document.createElement('div');
    const tf = mountTerraformBasic(container, { host });
    tf.strokeTile(1, 0, { op: 'grade' });
    tf.strokeTile(2, 0, { op: 'grade' });
    host.step(1);
    tf.update(host.view() as never);
    const jobs = container.querySelector('[data-testid="tf-overlay-jobs"]')!;
    expect(jobs.childElementCount).toBe(0);
    expect(tf.overlay.getActiveOrder()?.totalJobs).toBe(1);

    tf.toggleOverlay(true);
    const first = jobs.querySelector('[data-q="1"][data-r="0"]');
    expect(jobs.childElementCount).toBe(2);
    host.step(2);
    tf.update(host.view() as never);
    expect(jobs.querySelector('[data-q="1"][data-r="0"]')).toBe(first);
    tf.dispose();

    expect(terraformBasicFeature.id).toBe('terraform-basic');
    expect(terraformBasicFeature.wave).toBe('W01');
    expect(terraformBasicFeature.renderers ?? []).toEqual([]);
    expect(loadFeatures({ flags: new Set(['W00']), host: 'server' }).map((f) => f.id)).not.toContain('terraform-basic');
    expect(loadFeatures({ flags: new Set(['W00', 'W01']), host: 'server' }).map((f) => f.id)).toContain('terraform-basic');
    expect(PREP.prepared).toBe(2);
  });
});
