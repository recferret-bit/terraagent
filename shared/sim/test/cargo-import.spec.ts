import { describe, expect, it } from 'vitest';
import { cargoImportOpId, eventDef, parseWaves } from '@terra/contracts';
import {
  applyEnvironmentState,
  compileData,
  createRegistryPipeline,
  createState,
  creditResource,
  ensureColonyCargoState,
  ensureColonyLedger,
  ENTITY_KIND,
  ENTITY_STATE,
  environmentFromPlanetTime,
  getColonyStock,
  getColonyTradeHubStatus,
  insertRow,
  type LedgerPosting,
  type Pipeline,
  type PlanetState,
  remainingFamilyCap,
  setColonyStock,
  setField,
  setPlanetTime,
  settleCargoImport,
  type SimCommand,
  type SimEvent,
  type StepContext,
  step,
} from '../src';

function makeTestStepContext(
  state: PlanetState,
  tick: number,
  pipeline: Pipeline,
): StepContext {
  const events: SimEvent[] = [];
  const postings: LedgerPosting[] = [];
  return {
    dt: 1,
    tick,
    flags: pipeline.config.flags,
    data: pipeline.config.data,
    events,
    postings,
    record: (p) => {
      postings.push(p);
    },
    rng: (stream) => state.rng[stream],
    newEntityId: () => state.meta.nextEntityId++,
    emit: (e) => {
      events.push({ severity: 'info', colonyIds: [], data: {}, ...e, atTick: tick });
    },
  };
}

function spawnEntity(
  state: PlanetState,
  opts: {
    kind: number;
    owner: number;
    q: number;
    r: number;
    w: number;
    d: number;
    hp: number;
    shedGroup?: number;
    tier?: number;
    entityState?: number;
  },
): number {
  const id = state.meta.nextEntityId++;
  const row = insertRow(state.entities, id, 0);
  const cols = state.entities.cols;
  cols.kind[row] = opts.kind;
  cols.owner[row] = opts.owner;
  cols.tier[row] = opts.tier ?? 1;
  cols.q[row] = opts.q;
  cols.r[row] = opts.r;
  cols.footprintW[row] = opts.w;
  cols.footprintD[row] = opts.d;
  cols.shedGroup[row] = opts.shedGroup ?? 4;
  cols.hp[row] = opts.hp;
  cols.hpMax[row] = opts.hp;
  cols.state[row] = opts.entityState ?? ENTITY_STATE.active;
  return row;
}

function setupColonyWithHub(opts?: {
  withHub?: boolean;
  hubTier?: number;
  hubState?: number;
  stock?: Record<string, number>;
  inOrbit?: Record<string, number>;
  playerId?: string;
  colonyId?: string;
}): { state: PlanetState; hubRow: number } {
  const state = createState({
    planetId: 'p-cargo-import',
    planetType: 'temperate',
    seed: 'w10-12-import',
    radius: 10,
  });
  const w10 = compileData(parseWaves('..10'));
  setPlanetTime(state, { timeOfDay: 12 }, 0, w10);
  applyEnvironmentState(state, environmentFromPlanetTime(state, w10, false, 0), 0);

  const colonyId = opts?.colonyId ?? 'col_0';
  state.colonies[0] = {
    index: 0,
    id: colonyId,
    name: 'Alpha Colony',
    color: 0xff6b00,
    status: 'active',
    changedAt: 0,
    ...(opts?.playerId ? { playerId: opts.playerId } : {}),
  };
  ensureColonyLedger(state.colonies[0]);
  if (opts?.stock) {
    setColonyStock(state, 0, opts.stock);
  }
  if (opts?.inOrbit) {
    const cargoState = ensureColonyCargoState(state.colonies[0]);
    for (const [k, v] of Object.entries(opts.inOrbit)) {
      cargoState.inOrbit[k as keyof typeof cargoState.inOrbit] = v;
    }
  }

  spawnEntity(state, { kind: ENTITY_KIND.commandHub, owner: 0, q: 0, r: 0, w: 3, d: 3, hp: 1500, shedGroup: 4 });
  spawnEntity(state, { kind: ENTITY_KIND.solar, owner: 0, q: 3, r: 0, w: 2, d: 2, hp: 400 });
  spawnEntity(state, { kind: ENTITY_KIND.solar, owner: 0, q: 0, r: 3, w: 2, d: 2, hp: 400 });
  spawnEntity(state, { kind: ENTITY_KIND.solar, owner: 0, q: 3, r: -3, w: 2, d: 2, hp: 400 });

  let hubRow = -1;
  if (opts?.withHub !== false) {
    hubRow = spawnEntity(state, {
      kind: ENTITY_KIND.tradeHub,
      owner: 0,
      q: -3,
      r: 0,
      w: 2,
      d: 2,
      hp: 650,
      shedGroup: 2,
      tier: opts?.hubTier ?? 1,
      entityState: opts?.hubState ?? ENTITY_STATE.active,
    });
  }

  return { state, hubRow };
}

function makeImportCmd(
  commandId: string,
  args: Record<string, unknown>,
  extra?: Partial<SimCommand> & { playerId?: string },
): SimCommand {
  return {
    commandId,
    kind: 'cargo.import',
    colonyIndex: 0,
    source: 'player',
    args,
    ...extra,
  } as SimCommand;
}

describe('W10-12 Sim: cargo.import clamping and ok:true settlement', () => {
  it('with 420/500 metals full, importing 500 metals.t1 clamps to 80, reserves 80 while pending, and settles to 500/500 on ok:true', () => {
    const { state } = setupColonyWithHub({
      stock: { 'metals.t1': 420 },
      inOrbit: { 'metals.t1': 500 },
      playerId: 'pr_01JTESTPLAYER0000000000000',
      colonyId: 'col_0',
    });
    const flags = parseWaves('..10');
    const data = compileData(flags);
    const pipeline = createRegistryPipeline({ flags, data });

    const cmd = makeImportCmd(
      'cm_import_1',
      { colonyId: 'col_0', resource: 'metals.t1', amount: 500 },
      { playerId: 'pr_01JTESTPLAYER0000000000000' },
    );
    const res = step(state, [cmd], 1, pipeline);
    expect(res.outcomes).toHaveLength(1);
    expect(res.outcomes[0]?.code).toBeUndefined();

    const colony = state.colonies[0]!;
    const cargoState = ensureColonyCargoState(colony);
    const expectedRef = cargoImportOpId('col_0', 1);
    expect(expectedRef).toBe('cargo-import:col_0:1');

    expect(getColonyStock(state, 0)['metals.t1']).toBe(420);
    expect(cargoState.reservedByFamily.metals).toBe(80);
    expect(remainingFamilyCap(colony, 'metals')).toBe(0);
    expect(cargoState.inOrbit['metals.t1']).toBe(420);
    expect(cargoState.pendingImport[expectedRef]).toEqual({
      ref: expectedRef,
      importSeq: 1,
      resource: 'metals.t1',
      amount: 80,
      requestedAmount: 500,
      debitedInOrbit: true,
      atTick: 1,
    });

    const prodRes = creditResource(colony, 'metals.t1', 10, 1);
    expect(prodRes).toEqual({ credited: 0, capped: 10 });
    expect(getColonyStock(state, 0)['metals.t1']).toBe(420);

    const hubStatus = getColonyTradeHubStatus(state, 0, data, 1);
    expect(hubStatus.throughputUsedPerMin).toBe(0);
    expect(cargoState.mintedToday).toEqual({});

    const reqEvent = res.events.find((e) => e.kind === 'cargoImported');
    expect(eventDef('cargoImported').data.parse(reqEvent?.data)).toEqual({
      colonyId: 'col_0',
      colonyIndex: 0,
      playerId: 'pr_01JTESTPLAYER0000000000000',
      ref: expectedRef,
      importSeq: 1,
      resource: 'metals.t1',
      amount: 80,
      phase: 'requested',
    });

    const settleCtx = makeTestStepContext(state, 2, pipeline);
    expect(settleCargoImport(state, 0, expectedRef, true, settleCtx, undefined, 'tx_burn_1')).toBe(true);

    expect(getColonyStock(state, 0)['metals.t1']).toBe(500);
    expect((colony.stock as Record<string, number>)['metals.t1']).toBe(500);
    expect(cargoState.reservedByFamily.metals).toBe(0);
    expect(cargoState.pendingImport[expectedRef]).toBeUndefined();
    expect(remainingFamilyCap(colony, 'metals')).toBe(0);

    const importPosting = settleCtx.postings.find((p) => p.reason === 'cargo.import');
    expect(importPosting?.ref).toBe(expectedRef);

    const settledEvent = settleCtx.events.find((e) => e.kind === 'cargoImported');
    expect(eventDef('cargoImported').data.parse(settledEvent?.data)).toEqual({
      colonyId: 'col_0',
      colonyIndex: 0,
      playerId: 'pr_01JTESTPLAYER0000000000000',
      ref: expectedRef,
      importSeq: 1,
      resource: 'metals.t1',
      amount: 80,
      phase: 'settled',
      txHash: 'tx_burn_1',
    });
  });
});

describe('W10-12 Sim: cargo.import ok:false failure settlement', () => {
  it('settling with ok: false releases the 80 reservation without crediting colony.stock (stays 420/500)', () => {
    const { state } = setupColonyWithHub({
      stock: { 'metals.t1': 420 },
      inOrbit: { 'metals.t1': 200 },
      playerId: 'pr_01JTESTPLAYER0000000000000',
      colonyId: 'col_0',
    });
    const flags = parseWaves('..10');
    const data = compileData(flags);
    const pipeline = createRegistryPipeline({ flags, data });

    const res = step(
      state,
      [makeImportCmd('cm_import_fail', { colonyId: 'col_0', resource: 'metals.t1', amount: 500 })],
      1,
      pipeline,
    );
    expect(res.outcomes[0]?.code).toBeUndefined();

    const colony = state.colonies[0]!;
    const cargoState = ensureColonyCargoState(colony);
    const ref = cargoImportOpId('col_0', 1);

    expect(cargoState.reservedByFamily.metals).toBe(80);
    expect(remainingFamilyCap(colony, 'metals')).toBe(0);
    expect(cargoState.inOrbit['metals.t1']).toBe(120);

    const settleCtx = makeTestStepContext(state, 2, pipeline);
    expect(settleCargoImport(state, 0, ref, false, settleCtx, 'burn failed')).toBe(true);

    expect(getColonyStock(state, 0)['metals.t1']).toBe(420);
    expect(cargoState.reservedByFamily.metals).toBe(0);
    expect(remainingFamilyCap(colony, 'metals')).toBe(80);
    expect(cargoState.pendingImport[ref]).toBeUndefined();
    expect(cargoState.inOrbit['metals.t1']).toBe(200);
    expect(settleCtx.postings).toHaveLength(0);
    expect(settleCtx.events.find((e) => e.kind === 'cargoImported')).toBeUndefined();

    const refundEvent = settleCtx.events.find((e) => e.kind === 'cargoRefunded');
    expect(eventDef('cargoRefunded').data.parse(refundEvent?.data)).toEqual({
      colonyId: 'col_0',
      colonyIndex: 0,
      playerId: 'pr_01JTESTPLAYER0000000000000',
      ref,
      direction: 'import',
      resource: 'metals.t1',
      amount: 80,
    });
  });
});

describe('W10-12 Sim: cargo.import storage and orbit rejections', () => {
  it('rejects storage_full when family storage is at 500/500 or when remaining 80 is already reserved', () => {
    const flags = parseWaves('..10');
    const data = compileData(flags);
    const pipeline = createRegistryPipeline({ flags, data });

    const { state: fullState } = setupColonyWithHub({
      stock: { 'metals.t1': 500 },
      inOrbit: { 'metals.t1': 100 },
    });
    const fullRes = step(
      fullState,
      [makeImportCmd('cm_full_1', { resource: 'metals.t1', amount: 50 })],
      1,
      pipeline,
    );
    expect(fullRes.outcomes[0]?.code).toBe('storage_full');
    expect(fullRes.outcomes[0]?.detail).toContain('Storage is full');

    const { state: reservedState } = setupColonyWithHub({
      stock: { 'metals.t1': 420 },
      inOrbit: { 'metals.t1': 300 },
    });
    const first = step(
      reservedState,
      [makeImportCmd('cm_res_1', { resource: 'metals.t1', amount: 100 })],
      1,
      pipeline,
    );
    expect(first.outcomes[0]?.code).toBeUndefined();
    expect(ensureColonyCargoState(reservedState.colonies[0]!).reservedByFamily.metals).toBe(80);

    const second = step(
      reservedState,
      [makeImportCmd('cm_res_2', { resource: 'metals.t1', amount: 50 })],
      1,
      pipeline,
    );
    expect(second.outcomes[0]?.code).toBe('storage_full');
  });

  it('rejects insufficient_cargo when inOrbit balance is less than the clamped import amount', () => {
    const flags = parseWaves('..10');
    const data = compileData(flags);
    const pipeline = createRegistryPipeline({ flags, data });

    const { state } = setupColonyWithHub({
      stock: { 'metals.t1': 420 },
      inOrbit: { 'metals.t1': 50 },
    });
    const res = step(
      state,
      [makeImportCmd('cm_low_orbit', { resource: 'metals.t1', amount: 80 })],
      1,
      pipeline,
    );
    expect(res.outcomes[0]?.code).toBe('insufficient_cargo');
    expect(res.outcomes[0]?.detail).toContain('Not enough in orbit');
    expect(ensureColonyCargoState(state.colonies[0]!).reservedByFamily.metals).toBe(0);
    expect(ensureColonyCargoState(state.colonies[0]!).inOrbit['metals.t1']).toBe(50);
  });
});

describe('W10-12 Sim: cargo.import hub and ownership rejections', () => {
  it('rejects no_trade_hub, hub_offline, and not_own_colony', () => {
    const flags = parseWaves('..10');
    const data = compileData(flags);
    const pipeline = createRegistryPipeline({ flags, data });

    const { state: noHubState } = setupColonyWithHub({ withHub: false, stock: { 'metals.t1': 100 } });
    const noHubRes = step(
      noHubState,
      [makeImportCmd('cm_no_hub', { resource: 'metals.t1', amount: 50 })],
      1,
      pipeline,
    );
    expect(noHubRes.outcomes[0]?.code).toBe('no_trade_hub');

    const { state: offlineState, hubRow } = setupColonyWithHub({
      withHub: true,
      hubState: ENTITY_STATE.offlineBrownout,
      stock: { 'metals.t1': 100 },
      playerId: 'owner-player',
    });
    const brownoutRes = step(
      offlineState,
      [makeImportCmd('cm_brownout', { resource: 'metals.t1', amount: 50 }, { playerId: 'owner-player' })],
      1,
      pipeline,
    );
    expect(brownoutRes.outcomes[0]?.code).toBe('hub_offline');

    setField(offlineState.entities, hubRow, 'state', ENTITY_STATE.active, 2);
    const wrongOwnerRes = step(
      offlineState,
      [makeImportCmd('cm_wrong_owner', { resource: 'metals.t1', amount: 50 }, { playerId: 'other-player' })],
      1,
      pipeline,
    );
    expect(wrongOwnerRes.outcomes[0]?.code).toBe('not_own_colony');
  });
});
