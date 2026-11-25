// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseWaves } from '@terra/contracts';
import {
  DEPOSIT,
  ENTITY_KIND,
  ENTITY_STATE,
  ensureColonyRecord,
  hexIndex,
  insertRow,
  placeSpawnedEntity,
  PREP,
  setBlob,
  setTileDeposit,
  setTilePrep,
  setTileTerrain,
  spawnHqUnit,
  TERRAIN,
} from '@terra/sim';
import { resetGameInputBlock, setGameInputBlocked } from '../../../core/input/gameInputBlock';
import { HudRoot } from '../../../core/hud/HudRoot';
import type { FeatureServices } from '../../../core/registry/types';
import { LocalHost } from '../../../store/local/LocalHost';
import armyFeature from '../../army';
import landfallFeature from '../../landfall';
import mouseCursorFeature, {
  MouseCursorStateMachine,
  buildCursorCssValue,
  mountMouseCursor,
  resolveMouseCursorState,
  type MouseCursorState,
} from '../index';

function freshBody(): HTMLElement {
  document.body.replaceChildren();
  return document.body;
}

function spawnEntity(
  host: LocalHost,
  opts: { kind: number; owner: number; q: number; r: number; hp?: number; hpMax?: number },
): number {
  const state = host.state;
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, state.meta.tick);
  state.entities.cols.kind[row] = opts.kind;
  state.entities.cols.owner[row] = opts.owner;
  state.entities.cols.hp[row] = opts.hp ?? 240;
  state.entities.cols.hpMax[row] = opts.hpMax ?? opts.hp ?? 240;
  state.entities.cols.state[row] = ENTITY_STATE.idle;
  placeSpawnedEntity(state.entities, row, opts.q, opts.r, state.meta.tick);
  return id;
}

describe('MouseCursorStateMachine: pure deterministic transitions', () => {
  it('resolves idle, select, move, and attack across all input and boundary combinations', () => {
    const sm = new MouseCursorStateMachine();
    const transitions: Array<[MouseCursorState, MouseCursorState]> = [];
    const off = sm.onChange((next, prev) => transitions.push([prev, next]));

    expect(sm.getState()).toBe('idle');

    // Pointer outside canvas always stays idle even if attack-move is armed
    expect(sm.transition({ pointerInside: false, attackMoveArmed: true, hasSelectedArmedUnit: true, hoverTarget: 'hostile' })).toBe('idle');
    expect(transitions).toHaveLength(0);

    // Entering canvas over selectable own unit/building -> select
    expect(sm.transition({ pointerInside: true, attackMoveArmed: false, hasSelectedArmedUnit: false, hoverTarget: 'ownSelectable' })).toBe('select');
    expect(transitions).toEqual([['idle', 'select']]);

    // Selecting movable unit and hovering passable ground (including non-terraformed dunes) -> move
    expect(sm.transition({ hasSelectedMovableUnit: true, hasSelectedArmedUnit: true, hoverTarget: 'passableGround' })).toBe('move');

    // Hovering impassable ground (mountain / deep water / building) -> prohibited
    expect(sm.transition({ hoverTarget: 'impassableGround' })).toBe('prohibited');

    // Even when attack-move [A] is armed, impassable ground stays prohibited
    expect(sm.transition({ attackMoveArmed: true, hoverTarget: 'impassableGround' })).toBe('prohibited');
    expect(sm.transition({ attackMoveArmed: false, hoverTarget: 'hostile' })).toBe('attack');

    // Hovering hostile bug / hive without an armed unit -> prohibited
    expect(sm.transition({ hasSelectedArmedUnit: false, hoverTarget: 'hostile' })).toBe('prohibited');
    expect(sm.transition({ hasSelectedArmedUnit: true, hoverTarget: 'hostile' })).toBe('attack');

    // Marquee box-drag -> select
    expect(sm.transition({ boxSelecting: true, hoverTarget: 'impassableGround' })).toBe('select');
    expect(sm.transition({ boxSelecting: false, hoverTarget: 'hostile' })).toBe('attack');

    // Attack-move armed [A] overrides empty or ownSelectable ground -> attack
    expect(sm.transition({ attackMoveArmed: true, hoverTarget: 'ownSelectable' })).toBe('attack');

    // Modal / tool input block forces idle
    expect(sm.transition({ inputBlocked: true })).toBe('idle');
    expect(sm.transition({ inputBlocked: false, attackMoveArmed: false, hoverTarget: 'ownSelectedSelf', shiftKey: false })).toBe('idle');
    expect(sm.transition({ shiftKey: true })).toBe('select');

    // Spectator mode only allows select on inspectable colony entities, never move or attack
    expect(sm.transition({ spectator: true, shiftKey: false, hoverTarget: 'hostile' })).toBe('idle');
    expect(sm.transition({ spectator: true, hoverTarget: 'passableGround' })).toBe('idle');
    expect(sm.transition({ spectator: true, hoverTarget: 'ownSelectable' })).toBe('select');

    // Deposit without unit -> select; with eligible harvester/HQ -> move
    expect(
      resolveMouseCursorState({
        pointerInside: true,
        inputBlocked: false,
        spectator: false,
        attackMoveArmed: false,
        hasSelectedMovableUnit: false,
        hasSelectedArmedUnit: false,
        shiftKey: false,
        hoverTarget: 'deposit',
      }),
    ).toBe('select');
    expect(
      resolveMouseCursorState({
        pointerInside: true,
        inputBlocked: false,
        spectator: false,
        attackMoveArmed: false,
        hasSelectedMovableUnit: true,
        hasSelectedArmedUnit: false,
        shiftKey: false,
        hoverTarget: 'deposit',
      }),
    ).toBe('move');

    expect(sm.reset()).toBe('idle');
    off();
    sm.dispose();
  });

  it('generates distinct high-contrast SVG data-URI CSS cursor values for all 5 states', () => {
    const states: MouseCursorState[] = ['idle', 'select', 'move', 'attack', 'prohibited'];
    const values = states.map((s) => buildCursorCssValue(s));
    expect(new Set(values).size).toBe(5);
    expect(values[0]).toContain('default');
    expect(decodeURIComponent(values[0]!)).toContain('#F2F4F7');
    expect(values[1]).toContain('pointer');
    expect(values[2]).toContain('crosshair');
    expect(decodeURIComponent(values[2]!)).toContain('#3DDC84');
    expect(values[3]).toContain('crosshair');
    expect(decodeURIComponent(values[3]!)).toContain('#FF3B3B');
    expect(values[4]).toContain('not-allowed');
  });
});

function setupCursorAndCombatHarness() {
  const body = freshBody();
  const host = new LocalHost({ flags: [...parseWaves('..07').list], radius: 16 });
  ensureColonyRecord(host.state, 0, 0);
  const hx = hexIndex(host.state.grid.radius);

  // Non-terraformed dune at (5, 0), mountain at (6, 0), resource deposit at (-4, 0)
  setTileTerrain(host.state.grid, hx.indexOf(5, 0), TERRAIN.slope, 0);
  setTilePrep(host.state.grid, hx.indexOf(5, 0), PREP.wild, 0);
  setTileTerrain(host.state.grid, hx.indexOf(6, 0), TERRAIN.rock, 0);
  setTilePrep(host.state.grid, hx.indexOf(6, 0), PREP.wild, 0);
  setTileDeposit(host.state.grid, hx.indexOf(-4, 0), DEPOSIT.metals, 10000, 0);

  spawnHqUnit(host.state, { owner: 0, q: 0, r: 0 });
  const recon1 = spawnEntity(host, { kind: ENTITY_KIND.recon, owner: 0, q: 1, r: 0, hp: 200, hpMax: 240 });
  const recon2 = spawnEntity(host, { kind: ENTITY_KIND.recon, owner: 0, q: 2, r: 0, hp: 240, hpMax: 240 });
  const tank1 = spawnEntity(host, { kind: ENTITY_KIND.demoTank, owner: 0, q: 3, r: 0, hp: 520, hpMax: 520 });
  const workerId = spawnEntity(host, { kind: ENTITY_KIND.worker, owner: 0, q: -2, r: 0, hp: 160, hpMax: 160 });
  const hubId = spawnEntity(host, { kind: ENTITY_KIND.commandHub, owner: 0, q: -2, r: 3, hp: 1500, hpMax: 1500 });
  const bugId = spawnEntity(host, { kind: ENTITY_KIND.blackAnt, owner: -1, q: 8, r: 0, hp: 120, hpMax: 120 });
  const hiveId = spawnEntity(host, { kind: ENTITY_KIND.hiveGreenSpitter, owner: -1, q: 10, r: -2, hp: 1500, hpMax: 1500 });
  expect([recon1, recon2, tank1, workerId, hubId, bugId, hiveId].every((id) => id > 0)).toBe(true);
  host.sync(true);

  const canvas = document.createElement('canvas');
  body.appendChild(canvas);

  const tileByCoord = new Map<string, { q: number; r: number }>([
    ['10,10', { q: 1, r: 0 }],    // recon1
    ['20,10', { q: 2, r: 0 }],    // recon2
    ['30,10', { q: 3, r: 0 }],    // tank1
    ['40,10', { q: -2, r: 0 }],   // worker
    ['45,10', { q: -2, r: 3 }],   // commandHub
    ['50,10', { q: 5, r: 0 }],    // non-terraformed dune (passable!)
    ['60,10', { q: 6, r: 0 }],    // mountain (impassable!)
    ['70,10', { q: -4, r: 0 }],   // metals deposit
    ['80,10', { q: 8, r: 0 }],    // blackAnt
    ['90,10', { q: 11, r: -2 }],  // 3x3 hive edge tile
    ['99,99', { q: 4, r: 4 }],    // empty flat ground
  ]);
  const pickTile = (cx: number, cy: number) => tileByCoord.get(`${cx},${cy}`) ?? null;
  const sendCommand = vi.fn(async (kind: string, args?: unknown) => {
    host.store.sendCommand(kind, args);
    return { ok: true as const, appliedAtTick: host.tick };
  });

  const services: Partial<FeatureServices> = {
    store: host.store,
    sendCommand,
    canvas,
    surface: canvas,
    pickTile,
    colonyId: 0,
    track: () => {},
  };

  const flags = new Set(parseWaves('..07').list);
  const hud = new HudRoot(body, [landfallFeature, armyFeature, mouseCursorFeature], {
    flags,
    host: 'local',
    services: services as FeatureServices,
  });
  const cursorRenderer = mouseCursorFeature.renderers![0]!.mount({
    flags,
    host: 'local',
    services: services as FeatureServices,
  });
  hud.update(host.store.latest!);
  cursorRenderer.update(host.store.latest!, 0.016);

  const movePtr = (cx: number, cy: number, shiftKey = false) => {
    canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: cx, clientY: cy, shiftKey, bubbles: true }));
  };
  const clickPtr = (cx: number, cy: number, shiftKey = false) => {
    canvas.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: cx, clientY: cy, shiftKey, bubbles: true }));
    canvas.dispatchEvent(new MouseEvent('pointerup', { button: 0, clientX: cx, clientY: cy, shiftKey, bubbles: true }));
  };

  return {
    body,
    host,
    canvas,
    services,
    hud,
    cursorRenderer,
    cursor: services.mouseCursor!,
    tileByCoord,
    recon1,
    recon2,
    movePtr,
    clickPtr,
    dispose() {
      cursorRenderer.dispose();
      hud.dispose();
    },
  };
}

describe('Unified single combat selection panel', () => {
  afterEach(() => {
    resetGameInputBlock();
    document.body.replaceChildren();
  });

  it('displays strictly ONE panel (.ta-hq-panel) for 1 or multiple combat units and preserves surviving squad members on death', () => {
    const h = setupCursorAndCombatHarness();
    const { body, host, services, hud, recon1, recon2, clickPtr } = h;

    // Click Recon 1 -> ONLY ONE visible .plate panel (.ta-hq-panel), with inline combat stance bar inside it
    clickPtr(10, 10);
    const hqPanel = body.querySelector<HTMLElement>('[data-testid="hq-panel"]')!;
    const armyPanel = body.querySelector<HTMLElement>('[data-testid="army-stance-panel"]')!;
    expect(hqPanel.hidden).toBe(false);
    expect(armyPanel.hidden).toBe(false);
    expect(hqPanel.contains(armyPanel)).toBe(true);
    expect(armyPanel.classList.contains('ta-army-panel--inline')).toBe(true);
    expect(armyPanel.classList.contains('plate')).toBe(false);
    expect([...body.querySelectorAll<HTMLElement>('.plate')].filter((el) => !el.hidden)).toEqual([hqPanel]);
    expect(body.querySelector('[data-testid="selection-count"]')?.textContent).toBe('1');
    expect(body.querySelector('[data-testid="hq-title"]')?.textContent).toBe('RECON DRONE');

    // Shift-click Recon 2 and Tank 1 -> STILL strictly ONE panel, showing mixed squad count 3 & combined HP
    clickPtr(20, 10, true);
    clickPtr(30, 10, true);
    expect([...body.querySelectorAll<HTMLElement>('.plate')].filter((el) => !el.hidden)).toEqual([hqPanel]);
    expect(body.querySelector('[data-testid="selection-count"]')?.textContent).toBe('3');
    expect(body.querySelector('[data-testid="selection-slot"]')?.textContent).toBe('SQD');
    expect(body.querySelector('[data-testid="hq-title"]')?.textContent).toBe('COMBAT SQUAD');
    expect(body.querySelector('[data-testid="hq-hp"]')?.textContent).toBe('960 / 1000');

    // Selecting Worker Drone hides combat controls inside the single panel and restores normal worker view
    clickPtr(40, 10);
    expect(hqPanel.hidden).toBe(false);
    expect(armyPanel.hidden).toBe(true);
    expect(body.querySelector('[data-testid="hq-title"]')?.textContent).toBe('WORKER DRONE T1');

    // Kill primary unit in a 2-unit combat selection -> single panel stays open for the surviving unit
    clickPtr(10, 10);
    clickPtr(20, 10, true);
    expect(services.armyOrders!.getSelectedEntityIds()).toEqual([recon1, recon2]);
    for (let r = 0; r < host.state.entities.count; r++) {
      if (host.state.entities.cols.id[r] === recon2) host.state.entities.cols.hp[r] = 0;
    }
    hud.update(host.sync(true));
    expect(services.armyOrders!.getSelectedEntityIds()).toEqual([recon1]);
    expect(hqPanel.hidden).toBe(false);
    expect(body.querySelector('[data-testid="selection-count"]')?.textContent).toBe('1');

    h.dispose();
  });
});

describe('Live MouseCursorOrchestrator integration', () => {
  afterEach(() => {
    resetGameInputBlock();
    document.body.replaceChildren();
  });

  it('switches cursor across idle, select, move, and attack across terrain, units, hotkeys, and input blocks', () => {
    const h = setupCursorAndCombatHarness();
    const { canvas, services, cursor, movePtr, clickPtr } = h;
    expect(mountMouseCursor({ services: services as FeatureServices })).toBe(cursor);

    services.landfall!.deselect();
    movePtr(99, 99);
    expect(cursor.getState()).toBe('idle');
    expect(canvas.dataset.cursorState).toBe('idle');

    // Hovering own unit, own building, and resource deposit with nothing selected -> 'select'
    movePtr(10, 10);
    expect(cursor.getState()).toBe('select');
    movePtr(45, 10);
    expect(cursor.getState()).toBe('select');
    movePtr(70, 10);
    expect(cursor.getState()).toBe('select');

    // Select Recon 1: dune -> 'move', mountain -> 'prohibited', own unit/building -> 'select', bug/hive -> 'attack'
    clickPtr(10, 10);
    movePtr(50, 10);
    expect(cursor.getState()).toBe('move');
    movePtr(60, 10);
    expect(cursor.getState()).toBe('prohibited');
    movePtr(20, 10);
    expect(cursor.getState()).toBe('select');
    movePtr(45, 10);
    expect(cursor.getState()).toBe('select');
    movePtr(80, 10);
    expect(cursor.getState()).toBe('attack');
    movePtr(90, 10);
    expect(cursor.getState()).toBe('attack');

    // Press [A] while hovering empty ground -> 'attack'; over mountain or own building -> 'prohibited'; Escape -> 'move'
    movePtr(99, 99);
    expect(cursor.getState()).toBe('move');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', bubbles: true }));
    expect(cursor.getState()).toBe('attack');
    movePtr(60, 10);
    expect(cursor.getState()).toBe('prohibited');
    movePtr(45, 10);
    expect(cursor.getState()).toBe('prohibited');
    movePtr(99, 99);
    expect(cursor.getState()).toBe('attack');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    expect(cursor.getState()).toBe('move');

    // Modal input block & pointerleave force 'idle' automatically without manual refresh()
    setGameInputBlocked('test-modal', true);
    expect(cursor.getState()).toBe('idle');
    setGameInputBlocked('test-modal', false);
    expect(cursor.getState()).toBe('move');
    canvas.dispatchEvent(new MouseEvent('pointerleave', { bubbles: true }));
    expect(cursor.getState()).toBe('idle');

    // Unarmed Worker hovering deposit -> 'move', hovering hostile bug -> 'prohibited'
    clickPtr(40, 10);
    movePtr(70, 10);
    expect(cursor.getState()).toBe('move');
    movePtr(80, 10);
    expect(cursor.getState()).toBe('prohibited');

    // Build ghost & terraform brush cursor feedback ('select' when valid, 'prohibited' when blocked or off-grid)
    let ghost: { q: number; r: number; valid: boolean } | null = { q: 4, r: 4, valid: true };
    services.getPlacementGhostState = () => ghost as never;
    movePtr(99, 99);
    expect(cursor.getState()).toBe('select');
    ghost = { q: 6, r: 0, valid: false };
    movePtr(60, 10);
    expect(cursor.getState()).toBe('prohibited');
    movePtr(220, 220);
    expect(cursor.getState()).toBe('prohibited');
    ghost = null;

    let tfArmed = true;
    services.terraform = {
      isArmed: () => tfArmed,
      canStrokeTile: (q: number) => q === 4,
    } as never;
    movePtr(99, 99);
    expect(cursor.getState()).toBe('select');
    movePtr(60, 10);
    expect(cursor.getState()).toBe('prohibited');
    tfArmed = false;

    h.dispose();
    expect(canvas.dataset.cursorState).toBeUndefined();
  });
});

describe('Newcomer raid-shield & armed combat-test spawner cursor feedback', () => {
  afterEach(() => {
    resetGameInputBlock();
    document.body.replaceChildren();
  });

  it('shows prohibited over raid-protected foreign colonies and switches combat-test armed spawner between select and prohibited', () => {
    const h = setupCursorAndCombatHarness();
    const { host, hud, services, cursor, movePtr, clickPtr } = h;
    ensureColonyRecord(host.state, 1, 0);
    spawnEntity(host, { kind: ENTITY_KIND.demoTank, owner: 1, q: 4, r: 4, hp: 500 });
    setBlob(host.state, 'pvp', {
      byColony: { '1': { colonyIndex: 1, raidProtectedUntil: 5000, shieldDropped: false } },
      raidProtectedUntilByColony: { '1': 5000 },
    }, 1);
    const vShield = host.sync(true);
    hud.update(vShield);
    cursor.onView(vShield);

    // Select Recon 1 at (10,10); foreign colony 1 tank at (99,99 -> q=4,r=4) is raid-protected -> 'prohibited'
    clickPtr(10, 10);
    movePtr(99, 99);
    expect(cursor.getState()).toBe('prohibited');

    // Dropping the newcomer shield restores 'attack'
    setBlob(host.state, 'pvp', {
      byColony: { '1': { colonyIndex: 1, raidProtectedUntil: 0, shieldDropped: true } },
      raidProtectedUntilByColony: { '1': 0 },
    }, 2);
    const vUnshield = host.sync(true);
    hud.update(vUnshield);
    cursor.onView(vUnshield);
    expect(cursor.getState()).toBe('attack');

    // Armed combat-test spawner ('combat-test-spawn' + getSpawnCursorProbe) -> 'select' on valid, 'prohibited' on invalid & off-grid, 'idle' outside canvas
    let spawnValid: boolean | null = true;
    services.getSpawnCursorProbe = () => (spawnValid === null ? null : { valid: spawnValid });
    setGameInputBlocked('combat-test-spawn', true);
    movePtr(50, 10);
    expect(cursor.getState()).toBe('select');
    spawnValid = false;
    cursor.refresh();
    expect(cursor.getState()).toBe('prohibited');
    movePtr(220, 220);
    expect(cursor.getState()).toBe('prohibited');
    h.canvas.dispatchEvent(new MouseEvent('pointerleave', { bubbles: true }));
    expect(cursor.getState()).toBe('idle');
    setGameInputBlocked('combat-test-spawn', false);
    services.getSpawnCursorProbe = undefined;

    // Shallow water & unrevealed FoW with no selection -> 'prohibited'; with Recon selected -> FoW 'move', shallow water 'prohibited'
    const hx = hexIndex(host.state.grid.radius);
    setTileTerrain(host.state.grid, hx.indexOf(0, 5), TERRAIN.shallow, 3);
    host.state.grid.layers.explored.fill(0);
    const expByCol = host.state.grid.layers.exploredByColony as unknown as Record<number, Uint8Array> | undefined;
    expByCol?.[0]?.fill(0);
    host.state.grid.layers.explored[hx.indexOf(0, 5)] = 1;
    if (expByCol?.[0]) {
      const idx = hx.indexOf(0, 5);
      expByCol[0][idx >> 3] = (expByCol[0][idx >> 3] ?? 0) | (1 << (idx & 7));
    }
    h.tileByCoord.set('140,10', { q: 0, r: 5 });
    h.tileByCoord.set('150,10', { q: -12, r: 12 });
    const vFog = host.sync(true);
    hud.update(vFog);
    cursor.onView(vFog);

    services.landfall!.deselect();
    movePtr(140, 10);
    expect(cursor.getState()).toBe('prohibited');
    movePtr(150, 10);
    expect(cursor.getState()).toBe('prohibited');

    services.armyOrders!.selectUnits([h.recon1]);
    movePtr(140, 10);
    expect(cursor.getState()).toBe('prohibited');
    movePtr(150, 10);
    expect(cursor.getState()).toBe('move');
    h.dispose();
  });
});
