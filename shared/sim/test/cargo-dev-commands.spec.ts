import { describe, expect, it } from 'vitest';
import {
  createPlanet,
  ENTITY_KIND,
  ENTITY_STATE,
  hexIndex,
  type PlanetState,
  type SimCommand,
  type StepContext,
} from '../src';
import {
  ensureColonyCargoCapState,
  getMintedToday,
  getRollingThroughputUsed,
  recordCargoMint,
} from '../src/systems/cargo/caps';
import {
  devCargoCapResetHandler,
  devCargoGrantHandler,
  devTradehubSpawnHandler,
} from '../src/systems/cargo/dev-commands';
import { getBuildingFootprintTiles } from '../src/systems/construction/placement';

function createMockContext(tick = 10): StepContext {
  let nextId = 100;
  return {
    tick,
    dt: 0.2,
    newEntityId: () => nextId++,
    emit: () => {},
    data: undefined as never,
  } as unknown as StepContext;
}

describe('W10-26 dev.tradehubSpawn command', () => {
  it('spawns an active Trade Hub T1 at a free 2x2 footprint near HQ and marks tradeHubUnlocked', () => {
    const state = createPlanet({ type: 'flat', seed: 'tradehub-dev-1', radius: 10 });
    const ctx = createMockContext(42);

    const cmd: SimCommand = {
      colonyIndex: 0,
      source: 'dev',
      commandId: 'cmd-th-1',
      kind: 'dev.tradehubSpawn',
      args: {},
    };

    const res = devTradehubSpawnHandler.handle(state, cmd, ctx);
    expect(res).toBeUndefined();

    const colony = state.colonies[0];
    expect(colony).toBeDefined();
    expect(colony.tradeHubUnlocked).toBe(true);
    expect(colony.changedAt).toBe(42);

    const e = state.entities;
    const cols = e.cols;
    let hubRow = -1;
    for (let i = 0; i < e.count; i++) {
      if (cols.kind[i] === ENTITY_KIND.tradeHub && cols.owner[i] === 0) {
        hubRow = i;
        break;
      }
    }

    expect(hubRow).toBeGreaterThanOrEqual(0);
    expect(cols.state[hubRow]).toBe(ENTITY_STATE.active);
    expect(cols.progress[hubRow]).toBe(1);
    expect(cols.hp[hubRow]).toBe(900);
    expect(cols.hpMax[hubRow]).toBe(900);
    expect(cols.tier[hubRow]).toBe(1);
    expect(cols.footprintW[hubRow]).toBe(2);
    expect(cols.footprintD[hubRow]).toBe(2);
    expect(cols.shedGroup[hubRow]).toBe(2);

    const hq = cols.q[hubRow];
    const hr = cols.r[hubRow];
    const idx = hexIndex(state.grid.radius);
    const tiles = getBuildingFootprintTiles(hq, hr, 2);
    expect(tiles).toHaveLength(4);
    for (const t of tiles) {
      const tIdx = idx.indexOf(t.q, t.r);
      expect(tIdx).toBeGreaterThanOrEqual(0);
      expect(state.grid.layers.prep[tIdx]).toBe(1);
    }
  });

  it('spawns Trade Hub at specified (q, r) when provided in args', () => {
    const state = createPlanet({ type: 'flat', seed: 'tradehub-dev-2', radius: 10 });
    const ctx = createMockContext(50);

    const cmd: SimCommand = {
      colonyIndex: 0,
      source: 'dev',
      commandId: 'cmd-th-2',
      kind: 'dev.tradehubSpawn',
      args: { q: 4, r: -3 },
    };

    devTradehubSpawnHandler.handle(state, cmd, ctx);

    const e = state.entities;
    const cols = e.cols;
    let hubRow = -1;
    for (let i = 0; i < e.count; i++) {
      if (cols.kind[i] === ENTITY_KIND.tradeHub && cols.owner[i] === 0) {
        hubRow = i;
        break;
      }
    }

    expect(hubRow).toBeGreaterThanOrEqual(0);
    expect(cols.q[hubRow]).toBe(4);
    expect(cols.r[hubRow]).toBe(-3);

    const idx = hexIndex(state.grid.radius);
    const tiles = getBuildingFootprintTiles(4, -3, 2);
    for (const t of tiles) {
      const tIdx = idx.indexOf(t.q, t.r);
      expect(tIdx).toBeGreaterThanOrEqual(0);
      expect(state.grid.layers.prep[tIdx]).toBe(1);
    }
  });
});

describe('W10-26 dev.cargoCapReset command', () => {
  it('clears rolling 60s throughput window and daily minted counters', () => {
    const state = createPlanet({ type: 'flat', seed: 'cargo-cap-dev', radius: 10 });
    const ctx = createMockContext(100);

    const colony = state.colonies[0] ?? {
      index: 0,
      id: 'col-0',
      name: 'Colony 1',
      color: 0xff6b00,
      status: 'active',
      changedAt: 0,
    };
    state.colonies[0] = colony;

    const capState = ensureColonyCargoCapState(colony, 15);
    recordCargoMint(capState, 200, 'metals.t1', 90, 15);
    recordCargoMint(capState, 150, 'minerals.t1', 95, 15);

    expect(getRollingThroughputUsed(capState, 100)).toBe(350);
    expect(getMintedToday(capState, 'metals.t1', 15)).toBe(200);
    expect(getMintedToday(capState, 'minerals.t1', 15)).toBe(150);

    const cmd: SimCommand = {
      colonyIndex: 0,
      source: 'dev',
      commandId: 'cmd-cap-reset',
      kind: 'dev.cargoCapReset',
      args: {},
    };

    devCargoCapResetHandler.handle(state, cmd, ctx);

    expect(getRollingThroughputUsed(capState, 100)).toBe(0);
    expect(getMintedToday(capState, 'metals.t1', 15)).toBe(0);
    expect(getMintedToday(capState, 'minerals.t1', 15)).toBe(0);
    expect(capState.windowEntries).toHaveLength(0);

    const cargo = (colony as Record<string, unknown>).cargo as Record<string, unknown>;
    expect(cargo).toBeDefined();
    expect(cargo.windowExports).toEqual([]);
    expect(cargo.dailyMinted).toMatchObject({ utcDay: 15, byResource: {} });
    expect(colony.changedAt).toBe(100);
  });
});

describe('W10-26 dev.cargoGrant command', () => {
  it('credits resources to colony.cargo.inOrbit and accumulates multiple grants', () => {
    const state = createPlanet({ type: 'flat', seed: 'cargo-grant-dev', radius: 10 });
    const ctx = createMockContext(120);

    const cmd1: SimCommand = {
      colonyIndex: 0,
      source: 'dev',
      commandId: 'cmd-grant-1',
      kind: 'dev.cargoGrant',
      args: { resource: 'metals.t1', amount: 500 },
    };

    const res1 = devCargoGrantHandler.handle(state, cmd1, ctx);
    expect(res1).toBeUndefined();

    const colony = state.colonies[0] as Record<string, unknown>;
    const cargo = colony.cargo as { inOrbit: Record<string, number> };
    expect(cargo.inOrbit['metals.t1']).toBe(500);

    const cmd2: SimCommand = {
      colonyIndex: 0,
      source: 'dev',
      commandId: 'cmd-grant-2',
      kind: 'dev.cargoGrant',
      args: { resource: 'metals.t1', amount: 250 },
    };

    devCargoGrantHandler.handle(state, cmd2, ctx);
    expect(cargo.inOrbit['metals.t1']).toBe(750);

    const cmd3: SimCommand = {
      colonyIndex: 0,
      source: 'dev',
      commandId: 'cmd-grant-3',
      kind: 'dev.cargoGrant',
      args: { resource: 'bio.water', amount: 100 },
    };

    devCargoGrantHandler.handle(state, cmd3, ctx);
    expect(cargo.inOrbit['metals.t1']).toBe(750);
    expect(cargo.inOrbit['bio.water']).toBe(100);
    expect((colony as Record<string, unknown>).changedAt).toBe(120);
  });

  it('rejects invalid resource or non-positive amount with invalid_args', () => {
    const state = createPlanet({ type: 'flat', seed: 'cargo-grant-dev-err', radius: 10 });
    const ctx = createMockContext(130);

    const badRes: SimCommand = {
      colonyIndex: 0,
      source: 'dev',
      commandId: 'cmd-bad-res',
      kind: 'dev.cargoGrant',
      args: { resource: 'gold.bullion', amount: 500 },
    };
    expect(devCargoGrantHandler.handle(state, badRes, ctx)).toBe('invalid_args');

    const badAmt: SimCommand = {
      colonyIndex: 0,
      source: 'dev',
      commandId: 'cmd-bad-amt',
      kind: 'dev.cargoGrant',
      args: { resource: 'metals.t1', amount: -50 },
    };
    expect(devCargoGrantHandler.handle(state, badAmt, ctx)).toBe('invalid_args');
  });
});
