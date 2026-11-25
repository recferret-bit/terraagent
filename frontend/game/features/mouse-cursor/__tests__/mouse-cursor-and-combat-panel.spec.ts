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

    // Hovering impassable ground (mountain / deep water / building) -> idle
    expect(sm.transition({ hoverTarget: 'impassableGround' })).toBe('idle');

    // Hovering hostile bug / hive with armed unit -> attack
    expect(sm.transition({ hoverTarget: 'hostile' })).toBe('attack');

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

  it('generates distinct SVG data-URI CSS cursor values for all 4 states', () => {
    const states: MouseCursorState[] = ['idle', 'select', 'move', 'attack'];
    const values = states.map((s) => buildCursorCssValue(s));
    expect(new Set(values).size).toBe(4);
    expect(values[0]).toContain('default');
    expect(values[1]).toContain('pointer');
    expect(values[2]).toContain('crosshair');
    expect(values[3]).toContain('crosshair');
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

    // Select Recon 1: dune -> 'move', mountain -> 'idle', own unit/building -> 'select', bug/hive -> 'attack'
    clickPtr(10, 10);
    movePtr(50, 10);
    expect(cursor.getState()).toBe('move');
    movePtr(60, 10);
    expect(cursor.getState()).toBe('idle');
    movePtr(20, 10);
    expect(cursor.getState()).toBe('select');
    movePtr(45, 10);
    expect(cursor.getState()).toBe('select');
    movePtr(80, 10);
    expect(cursor.getState()).toBe('attack');
    movePtr(90, 10);
    expect(cursor.getState()).toBe('attack');

    // Press [A] while hovering empty ground -> 'attack'; Escape -> 'move'
    movePtr(99, 99);
    expect(cursor.getState()).toBe('move');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', bubbles: true }));
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

    // Worker hovering deposit -> 'move'
    clickPtr(40, 10);
    movePtr(70, 10);
    expect(cursor.getState()).toBe('move');

    h.dispose();
    expect(canvas.dataset.cursorState).toBeUndefined();
  });
});
