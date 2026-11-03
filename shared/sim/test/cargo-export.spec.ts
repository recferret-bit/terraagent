import { describe, expect, it } from 'vitest';
import { cargoExportOpId, eventDef, parseWaves } from '@terra/contracts';
import {
  applyEnvironmentState,
  CARGO_THROUGHPUT_WINDOW_TICKS,
  compileData,
  createRegistryPipeline,
  createState,
  ensureColonyCargoState,
  ensureColonyLedger,
  ENTITY_KIND,
  ENTITY_STATE,
  environmentFromPlanetTime,
  getColonyStock,
  getColonyTradeHubStatus,
  insertRow,
  type PlanetState,
  setColonyStock,
  setField,
  setPlanetTime,
  type SimCommand,
  step,
} from '../src';

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
  playerId?: string;
  colonyId?: string;
}): { state: PlanetState; hubRow: number } {
  const state = createState({
    planetId: 'p-cargo-export',
    planetType: 'temperate',
    seed: 'w10-05-export',
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

  // Command Hub + 3 Solar panels to keep even a T3 Trade Hub (42 E/s) powered across steps
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

function makeExportCmd(
  commandId: string,
  args: Record<string, unknown>,
  extra?: Partial<SimCommand> & { playerId?: string },
): SimCommand {
  return {
    commandId,
    kind: 'cargo.export',
    colonyIndex: 0,
    source: 'player',
    args,
    ...extra,
  } as SimCommand;
}

describe('W10-05 Sim: cargo.export acceptance', () => {
  it('exports 100 metals.t1 with 200 in stock -> stock becomes 100, pendingMint[ref] is recorded, and cargoExported is emitted', () => {
    const { state } = setupColonyWithHub({
      stock: { 'metals.t1': 200 },
      playerId: 'pr_01JTESTPLAYER0000000000000',
      colonyId: 'col_0',
    });
    const pipeline = createRegistryPipeline({
      flags: parseWaves('..10'),
      data: compileData(parseWaves('..10')),
    });

    const cmd = makeExportCmd(
      'cm_export_1',
      { colonyId: 'col_0', resource: 'metals.t1', amount: 100 },
      { playerId: 'pr_01JTESTPLAYER0000000000000' },
    );
    const res = step(state, [cmd], 1, pipeline);

    expect(res.outcomes).toHaveLength(1);
    expect(res.outcomes[0]?.code).toBeUndefined();

    // Stock reduced from 200 to 100
    const afterStock = getColonyStock(state, 0);
    expect(afterStock['metals.t1']).toBe(100);
    expect((state.colonies[0]?.stock as Record<string, number>)['metals.t1']).toBe(100);

    // pendingMint recorded with expected ref and exportSeq = 1
    const expectedRef = cargoExportOpId('col_0', 1);
    expect(expectedRef).toBe('cargo-export:col_0:1');
    const cargoState = ensureColonyCargoState(state.colonies[0]!);
    expect(cargoState.exportSeq).toBe(1);
    expect(cargoState.pendingMint[expectedRef]).toEqual({
      ref: expectedRef,
      exportSeq: 1,
      resource: 'metals.t1',
      amount: 100,
      atTick: 1,
    });

    // Rolling 60s meter and daily minted updated once (not double-counted)
    const hubStatus = getColonyTradeHubStatus(state, 0, pipeline.config.data, 1);
    expect(hubStatus.throughputUsedPerMin).toBe(100);
    expect(cargoState.mintedToday['metals.t1']).toBe(100);

    // Ledger posting recorded under cargo.export
    const exportPosting = res.postings.find((p) => p.reason === 'cargo.export');
    expect(exportPosting).toBeDefined();
    expect(exportPosting?.ref).toBe(expectedRef);

    // cargoExported event emitted and matches contract schema
    const exportedEvent = res.events.find((e) => e.kind === 'cargoExported');
    expect(exportedEvent).toBeDefined();
    expect(exportedEvent?.colonyIds).toEqual(['col_0']);
    const parsedData = eventDef('cargoExported').data.parse(exportedEvent?.data);
    expect(parsedData).toEqual({
      colonyId: 'col_0',
      colonyIndex: 0,
      playerId: 'pr_01JTESTPLAYER0000000000000',
      ref: expectedRef,
      exportSeq: 1,
      resource: 'metals.t1',
      amount: 100,
    });
  });
});

describe('W10-05 Sim: cargo.export colony, hub & stock rejections', () => {
  it('rejects not_own_colony when colony is missing, eliminated, or owned by another player', () => {
    const { state } = setupColonyWithHub({
      stock: { 'metals.t1': 200 },
      playerId: 'player-owner',
      colonyId: 'col_0',
    });
    const pipeline = createRegistryPipeline({
      flags: parseWaves('..10'),
      data: compileData(parseWaves('..10')),
    });

    const wrongPlayer = step(
      state,
      [makeExportCmd('cm_wrong_player', { resource: 'metals.t1', amount: 50 }, { playerId: 'other-player' })],
      1,
      pipeline,
    );
    expect(wrongPlayer.outcomes[0]?.code).toBe('not_own_colony');

    const missingColony = step(
      state,
      [makeExportCmd('cm_missing_col', { resource: 'metals.t1', amount: 50 }, { colonyIndex: 3 })],
      1,
      pipeline,
    );
    expect(missingColony.outcomes[0]?.code).toBe('not_own_colony');

    state.colonies[0]!.status = 'eliminated';
    const elimRes = step(
      state,
      [makeExportCmd('cm_elim', { resource: 'metals.t1', amount: 50 }, { playerId: 'player-owner' })],
      1,
      pipeline,
    );
    expect(elimRes.outcomes[0]?.code).toBe('not_own_colony');
    expect(getColonyStock(state, 0)['metals.t1']).toBe(200);
  });

  it('rejects no_trade_hub when no Trade Hub is built, and hub_offline when unpowered or brownout shed', () => {
    const pipeline = createRegistryPipeline({
      flags: parseWaves('..10'),
      data: compileData(parseWaves('..10')),
    });

    const { state: noHubState } = setupColonyWithHub({ withHub: false, stock: { 'metals.t1': 200 } });
    const noHubRes = step(
      noHubState,
      [makeExportCmd('cm_no_hub', { resource: 'metals.t1', amount: 50 })],
      1,
      pipeline,
    );
    expect(noHubRes.outcomes[0]?.code).toBe('no_trade_hub');
    expect(noHubRes.outcomes[0]?.detail).toContain('Build a Trade Hub');

    const { state: offlineState, hubRow } = setupColonyWithHub({
      withHub: true,
      hubState: ENTITY_STATE.offlineBrownout,
      stock: { 'metals.t1': 200 },
    });
    const brownoutRes = step(
      offlineState,
      [makeExportCmd('cm_brownout', { resource: 'metals.t1', amount: 50 })],
      1,
      pipeline,
    );
    expect(brownoutRes.outcomes[0]?.code).toBe('hub_offline');
    expect(brownoutRes.outcomes[0]?.detail).toContain('Trade Hub is unpowered');

    setField(offlineState.entities, hubRow, 'state', ENTITY_STATE.offlineUnpowered, 2);
    const unpoweredRes = step(
      offlineState,
      [makeExportCmd('cm_unpowered', { resource: 'metals.t1', amount: 50 })],
      1,
      pipeline,
    );
    expect(unpoweredRes.outcomes[0]?.code).toBe('hub_offline');
  });

  it('rejects insufficient_stock when colony stock is less than requested export amount', () => {
    const { state } = setupColonyWithHub({ stock: { 'metals.t1': 80 } });
    const pipeline = createRegistryPipeline({
      flags: parseWaves('..10'),
      data: compileData(parseWaves('..10')),
    });

    const res = step(
      state,
      [makeExportCmd('cm_low_stock', { resource: 'metals.t1', amount: 100 })],
      1,
      pipeline,
    );
    expect(res.outcomes[0]?.code).toBe('insufficient_stock');
    expect(res.outcomes[0]?.detail).toContain('Not enough in colony storage');
    expect(getColonyStock(state, 0)['metals.t1']).toBe(80);
  });
});

describe('W10-05 Sim: cargo.export mint_cap rejections', () => {
  it('rejects mint_cap when exceeding 250/min throughput or 20,000/day cap (including retryInS in detail)', () => {
    const { state, hubRow } = setupColonyWithHub({
      hubTier: 1,
      stock: { 'metals.t1': 30_000 },
    });
    const pipeline = createRegistryPipeline({
      flags: parseWaves('..10'),
      data: compileData(parseWaves('..10')),
    });

    const first = step(
      state,
      [makeExportCmd('cm_cap_1', { resource: 'metals.t1', amount: 200 })],
      1,
      pipeline,
    );
    expect(first.outcomes[0]?.code).toBeUndefined();

    const overThroughput = step(
      state,
      [makeExportCmd('cm_cap_2', { resource: 'metals.t1', amount: 100 })],
      1,
      pipeline,
    );
    expect(overThroughput.outcomes[0]?.code).toBe('mint_cap');
    expect(overThroughput.outcomes[0]?.detail).toMatch(
      /Throughput cap reached \(200\/250\/min\)\. Retry in \d+s\./,
    );

    step(state, [], CARGO_THROUGHPUT_WINDOW_TICKS, pipeline);
    state.entities.cols.tier[hubRow] = 3;

    const cargoState = ensureColonyCargoState(state.colonies[0]!);
    cargoState.mintedToday['metals.t1'] = 19_500;

    const overDaily = step(
      state,
      [makeExportCmd('cm_cap_daily', { resource: 'metals.t1', amount: 600 })],
      1,
      pipeline,
    );
    expect(overDaily.outcomes[0]?.code).toBe('mint_cap');
    expect(overDaily.outcomes[0]?.detail).toMatch(
      /Daily export cap reached \(19500\/20000 metals\.t1\)\. Retry in \d+s\./,
    );

    cargoState.currentUtcDay = '1970-01-02';
    const nextDay = step(
      state,
      [makeExportCmd('cm_cap_next_day', { resource: 'metals.t1', amount: 600 })],
      1,
      pipeline,
    );
    expect(nextDay.outcomes[0]?.code).toBeUndefined();
    expect(cargoState.mintedToday['metals.t1']).toBe(600);
  });
});
