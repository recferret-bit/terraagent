import { describe, expect, it } from 'vitest';
import { cargoExportOpId, cargoImportOpId, eventDef, parseWaves } from '@terra/contracts';
import {
  applyEnvironmentState,
  compileData,
  createRegistryPipeline,
  createState,
  ensureColonyCargoState,
  ensureColonyLedger,
  ENTITY_KIND,
  ENTITY_STATE,
  environmentFromPlanetTime,
  getColonyStock,
  insertRow,
  type PlanetState,
  setColonyStock,
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
  stock?: Record<string, number>;
  playerId?: string;
  colonyId?: string;
}): PlanetState {
  const state = createState({
    planetId: 'p-cargo-settled',
    planetType: 'temperate',
    seed: 'w10-07-settled',
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

  spawnEntity(state, { kind: ENTITY_KIND.commandHub, owner: 0, q: 0, r: 0, w: 3, d: 3, hp: 1500, shedGroup: 4 });
  spawnEntity(state, { kind: ENTITY_KIND.solar, owner: 0, q: 3, r: 0, w: 2, d: 2, hp: 400 });
  spawnEntity(state, { kind: ENTITY_KIND.solar, owner: 0, q: 0, r: 3, w: 2, d: 2, hp: 400 });
  spawnEntity(state, {
    kind: ENTITY_KIND.tradeHub,
    owner: 0,
    q: -3,
    r: 0,
    w: 2,
    d: 2,
    hp: 650,
    shedGroup: 2,
    tier: 1,
    entityState: ENTITY_STATE.active,
  });

  return state;
}

describe('W10-07 Sim: cargo.settled export ok:true', () => {
  it('clears pendingMint[ref] and credits inOrbit when export settles with ok: true', () => {
    const state = setupColonyWithHub({
      stock: { 'metals.t1': 200 },
      playerId: 'pr_01JTESTPLAYER0000000000000',
      colonyId: 'col_0',
    });
    const pipeline = createRegistryPipeline({
      flags: parseWaves('..10'),
      data: compileData(parseWaves('..10')),
    });

    const exportCmd: SimCommand = {
      commandId: 'cm_exp_1',
      kind: 'cargo.export',
      colonyIndex: 0,
      source: 'player',
      playerId: 'pr_01JTESTPLAYER0000000000000',
      args: { colonyId: 'col_0', resource: 'metals.t1', amount: 100 },
    } as SimCommand;

    const expRes = step(state, [exportCmd], 1, pipeline);
    expect(expRes.outcomes[0]?.code).toBeUndefined();

    const ref = cargoExportOpId('col_0', 1);
    const cargoState = ensureColonyCargoState(state.colonies[0]!);
    expect(cargoState.pendingMint[ref]).toBeDefined();
    expect(getColonyStock(state, 0)['metals.t1']).toBe(100);

    const settledCmd: SimCommand = {
      commandId: 'cm_settled_ok',
      kind: 'cargo.settled',
      colonyIndex: 0,
      source: 'near',
      args: {
        colonyId: 'col_0',
        ref,
        direction: 'export',
        resource: 'metals.t1',
        amount: 100,
        ok: true,
        txHash: 'tx_mock_123',
      },
    } as SimCommand;

    const settleRes = step(state, [settledCmd], 1, pipeline);
    expect(settleRes.outcomes[0]?.code).toBeUndefined();
    expect(cargoState.pendingMint[ref]).toBeUndefined();
    expect(cargoState.inOrbit['metals.t1']).toBe(100);
    expect(getColonyStock(state, 0)['metals.t1']).toBe(100);
    expect(settleRes.events.find((e) => e.kind === 'cargoRefunded')).toBeUndefined();
  });
});

describe('W10-07 Sim: cargo.settled export ok:false uncapped refund', () => {
  it('refunds stock even above storage cap (500/500 -> 600/500) and emits cargoRefunded when export settles with ok: false', () => {
    const state = setupColonyWithHub({
      stock: { 'metals.t1': 500 },
      playerId: 'pr_01JTESTPLAYER0000000000000',
      colonyId: 'col_0',
    });
    const pipeline = createRegistryPipeline({
      flags: parseWaves('..10'),
      data: compileData(parseWaves('..10')),
    });

    const exportCmd: SimCommand = {
      commandId: 'cm_exp_refund',
      kind: 'cargo.export',
      colonyIndex: 0,
      source: 'player',
      playerId: 'pr_01JTESTPLAYER0000000000000',
      args: { colonyId: 'col_0', resource: 'metals.t1', amount: 100 },
    } as SimCommand;
    step(state, [exportCmd], 1, pipeline);

    const ref = cargoExportOpId('col_0', 1);
    const cargoState = ensureColonyCargoState(state.colonies[0]!);
    expect(cargoState.pendingMint[ref]?.amount).toBe(100);

    // While export is in flight, colony harvests back up to full 500/500 storage cap
    setColonyStock(state, 0, { 'metals.t1': 500 });
    expect(ensureColonyLedger(state.colonies[0]!).caps.metals).toBe(500);
    expect(getColonyStock(state, 0)['metals.t1']).toBe(500);

    // Settlement fails (ok: false) -> must refund 100 ABOVE cap to 600/500
    const settledFailCmd: SimCommand = {
      commandId: 'cm_settled_fail',
      kind: 'cargo.settled',
      colonyIndex: 0,
      source: 'near',
      args: {
        colonyId: 'col_0',
        ref,
        direction: 'export',
        resource: 'metals.t1',
        amount: 100,
        ok: false,
        error: 'Panicked at FT mint',
      },
    } as SimCommand;

    const settleRes = step(state, [settledFailCmd], 1, pipeline);
    expect(settleRes.outcomes[0]?.code).toBeUndefined();
    expect(cargoState.pendingMint[ref]).toBeUndefined();
    expect(getColonyStock(state, 0)['metals.t1']).toBe(600);
    expect((state.colonies[0]?.stock as Record<string, number>)['metals.t1']).toBe(600);

    const refundPosting = settleRes.postings.find((p) => p.reason === 'cargo.refund');
    expect(refundPosting).toBeDefined();
    expect(refundPosting?.ref).toBe(ref);

    const refundEv = settleRes.events.find((e) => e.kind === 'cargoRefunded');
    expect(refundEv).toBeDefined();
    expect(refundEv?.severity).toBe('warn');
    expect(refundEv?.colonyIds).toEqual(['col_0']);
    const parsed = eventDef('cargoRefunded').data.parse(refundEv?.data);
    expect(parsed).toMatchObject({
      colonyId: 'col_0',
      colonyIndex: 0,
      ref,
      direction: 'export',
      resource: 'metals.t1',
      amount: 100,
    });
  });
});

describe('W10-07 Sim: cargo.settled import & authorization', () => {
  it('handles import settlement (ok: true credits stock & releases reservation; ok: false releases reservation & emits cargoRefunded)', () => {
    const state = setupColonyWithHub({
      stock: { 'metals.t1': 100 },
      playerId: 'pr_01JTESTPLAYER0000000000000',
      colonyId: 'col_0',
    });
    const pipeline = createRegistryPipeline({
      flags: parseWaves('..10'),
      data: compileData(parseWaves('..10')),
    });

    const cargoState = ensureColonyCargoState(state.colonies[0]!);
    const ref1 = cargoImportOpId('col_0', 1);
    cargoState.pendingImport[ref1] = {
      ref: ref1,
      importSeq: 1,
      resource: 'metals.t1',
      amount: 150,
      atTick: 1,
    };
    cargoState.reservedByFamily.metals = 150;

    const okImportCmd: SimCommand = {
      commandId: 'cm_imp_ok',
      kind: 'cargo.settled',
      colonyIndex: 0,
      source: 'near',
      args: {
        colonyId: 'col_0',
        ref: ref1,
        direction: 'import',
        resource: 'metals.t1',
        amount: 150,
        ok: true,
        txHash: 'tx_burn_1',
      },
    } as SimCommand;

    const okRes = step(state, [okImportCmd], 1, pipeline);
    expect(okRes.outcomes[0]?.code).toBeUndefined();
    expect(cargoState.pendingImport[ref1]).toBeUndefined();
    expect(cargoState.reservedByFamily.metals).toBe(0);
    expect(getColonyStock(state, 0)['metals.t1']).toBe(250);

    const impEv = okRes.events.find((e) => e.kind === 'cargoImported');
    expect(impEv).toBeDefined();
    const parsedImp = eventDef('cargoImported').data.parse(impEv?.data);
    expect(parsedImp.phase).toBe('settled');
    expect(parsedImp.amount).toBe(150);

    const ref2 = cargoImportOpId('col_0', 2);
    cargoState.pendingImport[ref2] = {
      ref: ref2,
      importSeq: 2,
      resource: 'metals.t1',
      amount: 80,
      atTick: 2,
    };
    cargoState.reservedByFamily.metals = 80;

    const failImportCmd: SimCommand = {
      commandId: 'cm_imp_fail',
      kind: 'cargo.settled',
      colonyIndex: 0,
      source: 'near',
      args: {
        colonyId: 'col_0',
        ref: ref2,
        direction: 'import',
        resource: 'metals.t1',
        amount: 80,
        ok: false,
      },
    } as SimCommand;

    const failRes = step(state, [failImportCmd], 1, pipeline);
    expect(failRes.outcomes[0]?.code).toBeUndefined();
    expect(cargoState.pendingImport[ref2]).toBeUndefined();
    expect(cargoState.reservedByFamily.metals).toBe(0);
    expect(getColonyStock(state, 0)['metals.t1']).toBe(250);

    const refundEv = failRes.events.find((e) => e.kind === 'cargoRefunded');
    expect(refundEv).toBeDefined();
    expect(eventDef('cargoRefunded').data.parse(refundEv?.data).direction).toBe('import');
  });
});

describe('W10-07 Sim: cargo.settled authorization', () => {
  it('rejects cargo.settled when source === "player"', () => {
    const state = setupColonyWithHub({ stock: { 'metals.t1': 200 } });
    const pipeline = createRegistryPipeline({
      flags: parseWaves('..10'),
      data: compileData(parseWaves('..10')),
    });

    const playerCmd: SimCommand = {
      commandId: 'cm_player_spoof',
      kind: 'cargo.settled',
      colonyIndex: 0,
      source: 'player',
      args: {
        colonyId: 'col_0',
        ref: 'cargo-export:col_0:1',
        direction: 'export',
        resource: 'metals.t1',
        amount: 100,
        ok: false,
      },
    } as SimCommand;

    const res = step(state, [playerCmd], 1, pipeline);
    expect(res.outcomes[0]?.code).toBe('not_authorized');
    expect(getColonyStock(state, 0)['metals.t1']).toBe(200);
  });
});
