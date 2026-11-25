// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  applyDamage,
  clearWrecksAtTile,
  DEPOSIT,
  ENTITY_KIND,
  ENTITY_STATE,
  ensureColonyRecord,
  HEX_DIRS,
  hexIndex,
  insertRow,
  placeSpawnedEntity,
  recordMechanicalWreck,
  setBlob,
  setTileDeposit,
  setTileTerrain,
  spawnHqUnit,
  TERRAIN,
} from '@terra/sim';
import { resetGameInputBlock } from '../../../core/input/gameInputBlock';
import { HudRoot } from '../../../core/hud/HudRoot';
import type { FeatureServices } from '../../../core/registry/types';
import { LocalHost } from '../../../store/local/LocalHost';
import armyFeature from '../../army';
import landfallFeature from '../../landfall';
import mouseCursorFeature, { resolveMouseCursorState } from '../index';
import { classifyCursorHoverTile } from '../parts/hoverClassifier';

function spawnEntity(
  host: LocalHost,
  opts: { kind: number; owner: number; q: number; r: number; hp?: number; state?: number },
): number {
  const state = host.state;
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, state.meta.tick);
  state.entities.cols.kind[row] = opts.kind;
  state.entities.cols.owner[row] = opts.owner;
  state.entities.cols.hp[row] = opts.hp ?? 240;
  state.entities.cols.hpMax[row] = opts.hp ?? 240;
  state.entities.cols.state[row] = opts.state ?? ENTITY_STATE.idle;
  placeSpawnedEntity(state.entities, row, opts.q, opts.r, state.meta.tick);
  return id;
}

function createHarness() {
  document.body.replaceChildren();
  const host = new LocalHost({ flags: [...parseWaves('..07').list], radius: 16 });
  ensureColonyRecord(host.state, 0, 0);
  ensureColonyRecord(host.state, 1, 0);
  spawnHqUnit(host.state, { owner: 0, q: 0, r: 0 });

  const recon1 = spawnEntity(host, { kind: ENTITY_KIND.recon, owner: 0, q: 1, r: 0, state: ENTITY_STATE.moving });
  const recon2 = spawnEntity(host, { kind: ENTITY_KIND.recon, owner: 0, q: 2, r: 0 });
  const worker1 = spawnEntity(host, { kind: ENTITY_KIND.worker, owner: 0, q: -2, r: 2, hp: 160 });
  const ownHub = spawnEntity(host, { kind: ENTITY_KIND.commandHub, owner: 0, q: -5, r: 5, hp: 1500 });
  const ownPylon = spawnEntity(host, { kind: ENTITY_KIND.pylon, owner: 0, q: -2, r: 5, hp: 300 });
  spawnEntity(host, { kind: ENTITY_KIND.demoTank, owner: 1, q: 6, r: 0, hp: 520 });
  spawnEntity(host, { kind: ENTITY_KIND.commandHub, owner: 1, q: 9, r: 0, hp: 1500 });
  spawnEntity(host, { kind: ENTITY_KIND.tradeHub, owner: -1, q: -6, r: 0, hp: 900 });
  spawnEntity(host, { kind: ENTITY_KIND.pod, owner: 1, q: -3, r: 0, hp: 600 });
  const hx = hexIndex(host.state.grid.radius);
  setTileDeposit(host.state.grid, hx.indexOf(0, -6), DEPOSIT.metals, 10000, 0);
  host.sync(true);

  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);

  let ghostArmed = false;
  const setGhostArmed = (next: boolean) => {
    ghostArmed = next;
  };
  const onSwallowedKey = (e: KeyboardEvent) => {
    if (e.key === 'b') ghostArmed = true;
    else if (e.key === 'Escape' && ghostArmed) {
      ghostArmed = false;
      e.stopImmediatePropagation();
    }
  };

  const coords = new Map<string, { q: number; r: number }>([
    ['10,10', { q: 1, r: 0 }],
    ['20,10', { q: 2, r: 0 }],
    ['30,10', { q: 6, r: 0 }],
    ['40,10', { q: 10, r: 0 }],
    ['50,10', { q: -6, r: 0 }],
    ['60,10', { q: -3, r: 0 }],
    ['70,10', { q: -5, r: 5 }],
    ['71,10', { q: -4, r: 5 }],
    ['75,10', { q: -2, r: 5 }],
    ['80,10', { q: 0, r: -6 }],
    ['90,90', { q: 4, r: 4 }],
  ]);

  const services: Partial<FeatureServices> = {
    store: host.store,
    sendCommand: vi.fn(async (kind: string, args?: unknown) => {
      host.store.sendCommand(kind, args);
      return { ok: true as const, appliedAtTick: host.tick };
    }),
    canvas,
    surface: canvas,
    pickTile: (cx: number, cy: number) => coords.get(`${cx},${cy}`) ?? null,
    colonyId: 0,
    track: () => {},
    hubPlacement: { isPlacementActive: () => ghostArmed } as FeatureServices['hubPlacement'],
  };

  const flags = new Set(parseWaves('..07').list);
  const hud = new HudRoot(document.body, [landfallFeature, armyFeature, mouseCursorFeature], {
    flags,
    host: 'local',
    services: services as FeatureServices,
  });
  const cursorRenderer = mouseCursorFeature.renderers![0]!.mount({
    flags,
    host: 'local',
    services: services as FeatureServices,
  });
  window.addEventListener('keydown', onSwallowedKey, { capture: true });
  hud.update(host.store.latest!);
  cursorRenderer.update(host.store.latest!, 0.016);

  return {
    host,
    hud,
    cursorRenderer,
    recon1,
    recon2,
    worker1,
    ownHub,
    ownPylon,
    coords,
    setGhostArmed,
    canvas,
    services: services as FeatureServices,
    dispose: () => {
      window.removeEventListener('keydown', onSwallowedKey, { capture: true });
      cursorRenderer.dispose();
      hud.dispose();
    },
  };
}

describe('Combat selection & PvP/neutral hover edge cases', () => {
  afterEach(() => {
    resetGameInputBlock();
    document.body.replaceChildren();
  });

  it('shrinks squad on single reselect, hides worker CANCEL JOB, and distinguishes PvP vs neutral targets', () => {
    const h = createHarness();
    const { cursor, army, landfall } = {
      cursor: h.services.mouseCursor!,
      army: h.services.armyOrders!,
      landfall: h.services.landfall!,
    };

    army.selectUnits([h.recon1, h.recon2]);
    expect(document.body.querySelector('[data-testid="selection-count"]')?.textContent).toBe('2');
    landfall.selectEntity(h.recon1);
    expect(army.getSelectedEntityIds()).toEqual([h.recon1]);
    expect(document.body.querySelector('[data-testid="selection-count"]')?.textContent).toBe('1');
    expect(document.body.querySelector<HTMLElement>('[data-testid="hq-panel-cancel"]')?.hidden).toBe(true);

    h.canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: 30, clientY: 10, bubbles: true }));
    expect(cursor.getState()).toBe('attack');
    h.canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: 40, clientY: 10, bubbles: true }));
    expect(cursor.getState()).toBe('attack');
    h.canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: 50, clientY: 10, bubbles: true }));
    expect(cursor.getState()).toBe('prohibited');
    h.canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: 60, clientY: 10, bubbles: true }));
    expect(cursor.getState()).toBe('prohibited');
    h.dispose();
  });

  it('restores cursor state after swallowed capture-phase Escape and middle-mouse camera drag', async () => {
    const h = createHarness();
    const cursor = h.services.mouseCursor!;
    h.services.armyOrders!.selectUnits([h.recon1]);

    h.canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: 90, clientY: 90, bubbles: true }));
    expect(cursor.getState()).toBe('move');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }));
    await Promise.resolve();
    expect(cursor.getState()).toBe('idle');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await Promise.resolve();
    expect(cursor.getState()).toBe('move');

    h.canvas.dispatchEvent(new MouseEvent('pointerdown', { button: 1, buttons: 4, clientX: 90, clientY: 90, bubbles: true }));
    expect(cursor.getState()).toBe('idle');
    window.dispatchEvent(new MouseEvent('pointerup', { button: 1, buttons: 0, clientX: 90, clientY: 90, bubbles: true }));
    await Promise.resolve();
    expect(cursor.getState()).toBe('move');
    h.dispose();
  });
});

describe('MouseCursorStateMachine sky/void, own-building selection, and squad hover parity', () => {
  afterEach(() => {
    resetGameInputBlock();
    document.body.replaceChildren();
  });

  it('shows prohibited over off-planet sky/void inside canvas even when attack-move is armed, and idle when pointer leaves', () => {
    expect(
      resolveMouseCursorState({
        pointerInside: true,
        inputBlocked: false,
        spectator: false,
        attackMoveArmed: true,
        hasSelectedMovableUnit: true,
        hasSelectedArmedUnit: true,
        shiftKey: false,
        hoverTarget: 'none',
      }),
    ).toBe('prohibited');

    const h = createHarness();
    const cursor = h.services.mouseCursor!;
    h.services.armyOrders!.selectUnits([h.recon1]);
    h.services.armyOrders!.setAttackMoveArmed(true);

    h.canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: 90, clientY: 90, bubbles: true }));
    expect(cursor.getState()).toBe('attack');

    // Off-planet sky inside canvas (pickTile -> null => hoverTarget: 'none') must be 'prohibited'
    h.canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: 250, clientY: 250, bubbles: true }));
    expect(cursor.getContext().pointerInside).toBe(true);
    expect(cursor.getContext().hoverTarget).toBe('none');
    expect(cursor.getState()).toBe('prohibited');

    // Leaving canvas restores 'idle'
    h.canvas.dispatchEvent(new MouseEvent('pointerleave', { bubbles: true }));
    expect(cursor.getState()).toBe('idle');

    // Returning onto planet ground restores 'attack'
    h.canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: 90, clientY: 90, bubbles: true }));
    expect(cursor.getState()).toBe('attack');
    h.dispose();
  });
});

describe('MouseCursorStateMachine own-building selection and squad hover parity', () => {
  afterEach(() => {
    resetGameInputBlock();
    document.body.replaceChildren();
  });

  it('shows idle over an already-selected player building and agrees on multi-squad hover with or without landfall', () => {
    const h = createHarness();
    const { cursor, army, landfall } = {
      cursor: h.services.mouseCursor!,
      army: h.services.armyOrders!,
      landfall: h.services.landfall!,
    };

    // 1. Select own Command Hub (isUnit === false): hovering its center or 3x3 edge is 'idle' (ownSelectedSelf)
    landfall.selectEntity(h.ownHub);
    h.canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: 70, clientY: 10, bubbles: true }));
    expect(cursor.getContext().hoverTarget).toBe('ownSelectedSelf');
    expect(cursor.getState()).toBe('idle');
    h.canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: 71, clientY: 10, shiftKey: true, bubbles: true }));
    expect(cursor.getState()).toBe('idle');

    // Hovering a different own building (Pylon) or unit (Recon 1) while Hub is selected shows 'select'
    h.canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: 75, clientY: 10, bubbles: true }));
    expect(cursor.getState()).toBe('select');
    h.canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: 10, clientY: 10, bubbles: true }));
    expect(cursor.getState()).toBe('select');

    // 2. Multi-unit squad [recon1, recon2]: both landfall.pickEntityAt and findOwnCombatUnitsOnTile fallback yield 'ownSelectable' ('select')
    army.selectUnits([h.recon1, h.recon2]);
    h.canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: 10, clientY: 10, bubbles: true }));
    expect(cursor.getContext().hoverTarget).toBe('ownSelectable');
    expect(cursor.getState()).toBe('select');

    const fallbackMulti = classifyCursorHoverTile({
      q: 1,
      r: 0,
      view: h.host.store.latest!,
      fallbackTiles: h.host.store.latestTiles,
      ownerColonyIndex: 0,
      spectator: false,
      combatEnabled: true,
      landfall: null,
      armyOrders: army,
    });
    expect(fallbackMulti.hoverTarget).toBe('ownSelectable');

    // Single selected unit [recon1]: fallback also yields 'ownSelectedSelf' ('idle' without Shift)
    army.selectUnits([h.recon1]);
    const fallbackSingle = classifyCursorHoverTile({
      q: 1,
      r: 0,
      view: h.host.store.latest!,
      fallbackTiles: h.host.store.latestTiles,
      ownerColonyIndex: 0,
      spectator: false,
      combatEnabled: true,
      landfall: null,
      armyOrders: army,
    });
    expect(fallbackSingle.hoverTarget).toBe('ownSelectedSelf');
    h.dispose();
  });
});

describe('Mechanical wreckage passability & stationary click refresh', () => {
  afterEach(() => {
    resetGameInputBlock();
    document.body.replaceChildren();
  });

  it('treats mechanical wreckage tiles and wreck-ringed deposits as impassable (idle, never move)', () => {
    const h = createHarness();
    const { cursor, army, landfall } = {
      cursor: h.services.mouseCursor!,
      army: h.services.armyOrders!,
      landfall: h.services.landfall!,
    };
    const hx = hexIndex(h.host.state.grid.radius);

    // 1. Wreck on empty ground (4, 4) blocks movement cursor
    army.selectUnits([h.recon1]);
    h.canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: 90, clientY: 90, bubbles: true }));
    expect(cursor.getState()).toBe('move');

    const groundWreckIdx = hx.indexOf(4, 4);
    recordMechanicalWreck(h.host.state, { id: 501, kind: ENTITY_KIND.demoTank, owner: 1, q: 4, r: 4, tiles: [groundWreckIdx] }, 1);
    const v1 = h.host.sync(true);
    h.hud.update(v1);
    h.cursorRenderer.update(v1, 0.016);
    expect(cursor.getState()).toBe('prohibited');

    // 2. Deposit at (0, -6) surrounded on all 6 neighbors by mechanical wrecks -> 'prohibited' for selected worker
    landfall.selectEntity(h.worker1);
    h.canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: 80, clientY: 10, bubbles: true }));
    expect(cursor.getState()).toBe('move');

    const ringIndices = HEX_DIRS.map(([dq, dr]) => hx.indexOf(dq, -6 + dr));
    recordMechanicalWreck(h.host.state, { id: 502, kind: ENTITY_KIND.commandHub, owner: 1, q: 1, r: -6, tiles: ringIndices }, 2);
    const v2 = h.host.sync(true);
    h.hud.update(v2);
    h.cursorRenderer.update(v2, 0.016);
    expect(cursor.getContext().hoverTarget).toBe('impassableGround');
    expect(cursor.getState()).toBe('prohibited');

    // Clearing the wreck ring restores deposit approach -> 'move'
    clearWrecksAtTile(h.host.state, ringIndices[0]!, 3);
    const v3 = h.host.sync(true);
    h.hud.update(v3);
    h.cursorRenderer.update(v3, 0.016);
    expect(cursor.getState()).toBe('move');
    h.dispose();
  });

  it('refreshes cursor state after click handlers mutate tool or selection state while pointer stays stationary', async () => {
    const h = createHarness();
    const cursor = h.services.mouseCursor!;
    h.services.armyOrders!.selectUnits([h.recon1]);

    h.canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: 90, clientY: 90, bubbles: true }));
    expect(cursor.getState()).toBe('move');

    const toolBtn = document.createElement('button');
    document.body.appendChild(toolBtn);
    let armed = false;
    toolBtn.addEventListener('click', () => {
      armed = !armed;
      h.setGhostArmed(armed);
    });

    // Click-only (no pointerdown/pointerup/pointermove) arms ghost -> cursor immediately becomes 'idle'
    toolBtn.click();
    await Promise.resolve();
    expect(cursor.getState()).toBe('idle');

    // Second click-only disarms ghost while pointer never moved -> cursor returns to 'move'
    toolBtn.click();
    await Promise.resolve();
    expect(cursor.getState()).toBe('move');
    h.dispose();
  });
});

describe('Real unit death (removeRow), cross-sector hover, and stationary camera repick', () => {
  afterEach(() => {
    resetGameInputBlock();
    document.body.replaceChildren();
  });

  it('prunes removed dead squad members and recovers surviving primary across real applyDamage (removeRow)', () => {
    const h = createHarness();
    const { army, hud } = { army: h.services.armyOrders!, hud: h.hud };

    // 1. Non-primary unit dies via removeRow -> pruned from squad count (2 -> 1)
    army.selectUnits([h.recon1, h.recon2]);
    expect(document.body.querySelector('[data-testid="selection-count"]')?.textContent).toBe('2');
    applyDamage(h.host.state, h.recon1, 9999, { attackerOwner: 1, tick: 1 });
    const vAfterNonPrimary = h.host.sync(true);
    army.onView(vAfterNonPrimary);
    hud.update(vAfterNonPrimary);
    expect(army.getSelectedEntityIds()).toEqual([h.recon2]);
    expect(document.body.querySelector('[data-testid="selection-count"]')?.textContent).toBe('1');

    // 2. Primary unit dies via removeRow when army.onView runs before landfall.onView -> surviving member stays open
    const recon3 = spawnEntity(h.host, { kind: ENTITY_KIND.recon, owner: 0, q: 3, r: 0 });
    const vWith3 = h.host.sync(true);
    hud.update(vWith3);
    army.selectUnits([h.recon2, recon3]);
    expect(document.body.querySelector('[data-testid="selection-count"]')?.textContent).toBe('2');

    applyDamage(h.host.state, recon3, 9999, { attackerOwner: 1, tick: 2 });
    const vAfterPrimary = h.host.sync(true);
    army.onView(vAfterPrimary);
    hud.update(vAfterPrimary);
    expect(army.getSelectedEntityIds()).toEqual([h.recon2]);
    expect(document.body.querySelector<HTMLElement>('[data-testid="hq-panel"]')?.hidden).toBe(false);
    expect(document.body.querySelector('[data-testid="selection-count"]')?.textContent).toBe('1');
    h.dispose();
  });

  it('enforces cross-sector partition boundaries in hoverClassifier and repicks stationary pointer on wheel/view & captured pointerdown', async () => {
    const h = createHarness();
    const { cursor, army, landfall } = {
      cursor: h.services.mouseCursor!,
      army: h.services.armyOrders!,
      landfall: h.services.landfall!,
    };
    const hx = hexIndex(h.host.state.grid.radius);
    setBlob(h.host.state, 'atlas', { sectorRadius: 4 }, 1);
    setTileDeposit(h.host.state.grid, hx.indexOf(12, 0), DEPOSIT.metals, 10000, 1);
    setTileTerrain(h.host.state.grid, hx.indexOf(3, 3), TERRAIN.rock, 1);
    h.coords.set('120,10', { q: 12, r: 0 });
    h.coords.set('130,10', { q: 11, r: 0 });
    const vAtlas = h.host.sync(true);
    h.hud.update(vAtlas);
    h.cursorRenderer.update(vAtlas, 0.016);

    army.selectUnits([h.recon1]);
    // Same sector (4, 4) vs locked adjacent sector (11, 0)
    h.canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: 130, clientY: 10, bubbles: true }));
    expect(cursor.getState()).toBe('prohibited');
    landfall.selectEntity(h.worker1);
    h.canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: 120, clientY: 10, bubbles: true }));
    expect(cursor.getState()).toBe('prohibited');

    // Stationary pointer repicks when camera zoom/pan shifts (90,90) from passable (2,0) -> hostile (6,0) -> mountain (3,3) -> sky
    army.selectUnits([h.recon1]);
    h.coords.set('90,90', { q: 3, r: 0 });
    h.canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: 90, clientY: 90, bubbles: true }));
    expect(cursor.getState()).toBe('move');

    h.coords.set('90,90', { q: 6, r: 0 });
    h.canvas.dispatchEvent(new MouseEvent('wheel', { clientX: 90, clientY: 90, bubbles: true }));
    await Promise.resolve();
    expect(cursor.getState()).toBe('attack');

    h.coords.set('90,90', { q: 3, r: 3 });
    h.cursorRenderer.update(vAtlas, 0.016);
    expect(cursor.getState()).toBe('prohibited');

    // Capture-consumed pointerdown disarming ghost records pointer sample without needing pointermove
    h.coords.set('90,90', { q: 3, r: 0 });
    h.setGhostArmed(true);
    h.canvas.addEventListener('pointerdown', (ev) => {
      ev.stopImmediatePropagation();
      h.setGhostArmed(false);
    }, { capture: true, once: true });
    h.canvas.dispatchEvent(new MouseEvent('pointerdown', { button: 2, clientX: 90, clientY: 90, bubbles: true }));
    await Promise.resolve();
    expect(cursor.getState()).toBe('move');
    h.dispose();
  });
});
