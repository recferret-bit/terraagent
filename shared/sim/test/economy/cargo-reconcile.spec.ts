import { parseWaves } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import {
  applyEnvironmentState,
  colonyResourcePosition,
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
  insertRow,
  setPlanetTime,
  step,
  type LedgerPosting,
  type SimCommand,
} from '../../src';
import { hostLedger, postAll } from './helpers';

describe('LED-16 stock + orbit + in-flight is constant across export -> settle -> import', () => {
  it('moves 120 metals out and back with the position total unchanged at every step, journal equal to col.stock', () => {
    const state = createState({ planetId: 'p-reconcile', planetType: 'temperate', seed: 'led16-cargo', radius: 10 });
    const flags = parseWaves('..10');
    const data = compileData(flags);
    setPlanetTime(state, { timeOfDay: 12 }, 0, data);
    applyEnvironmentState(state, environmentFromPlanetTime(state, data, false, 0), 0);
    state.colonies[0] = { index: 0, id: 'col_0', name: 'A', color: 0xff6b00, status: 'active', changedAt: 0 };
    const col = ensureColonyLedger(state.colonies[0]);
    creditResource(col, 'metals.t1', 300.25, 0); // 300 whole units and a 0.25 residual
    const cols = state.entities.cols;
    const put = (kind: number, q: number, r: number, w: number, d: number, hp: number, shed: number, tier = 1): void => {
      const row = insertRow(state.entities, state.meta.nextEntityId++, 0);
      cols.kind[row] = kind; cols.owner[row] = 0; cols.tier[row] = tier; cols.q[row] = q; cols.r[row] = r;
      cols.footprintW[row] = w; cols.footprintD[row] = d; cols.shedGroup[row] = shed; cols.hp[row] = hp; cols.hpMax[row] = hp;
      cols.state[row] = ENTITY_STATE.active;
    };
    put(ENTITY_KIND.commandHub, 0, 0, 3, 3, 1500, 4);
    put(ENTITY_KIND.solar, 3, 0, 2, 2, 400, 4);
    put(ENTITY_KIND.solar, 0, 3, 2, 2, 400, 4);
    put(ENTITY_KIND.solar, 3, -3, 2, 2, 400, 4);
    put(ENTITY_KIND.tradeHub, -3, 0, 2, 2, 650, 2);

    const pipeline = createRegistryPipeline({ flags, data });
    const journal: LedgerPosting[] = [];
    const total = (): number => colonyResourcePosition(state.colonies[0]!, 'metals.t1').totalMicro;
    const run = (cmds: SimCommand[]): void => {
      const res = step(state, cmds, 1, pipeline);
      journal.push(...res.postings);
      for (const o of res.outcomes) expect(o.code).toBeUndefined();
    };
    const start = total();
    expect(start).toBe(300_250_000);

    run([{ commandId: 'x1', kind: 'cargo.export', colonyIndex: 0, source: 'player', args: { colonyId: 'col_0', resource: 'metals.t1', amount: 120 } } as SimCommand]);
    expect(getColonyStock(state, 0)['metals.t1']).toBe(180);
    expect(Object.keys(ensureColonyCargoState(state.colonies[0]!).pendingMint)).toHaveLength(1);
    expect(total()).toBe(start); // in flight to orbit

    const exportRef = Object.keys(ensureColonyCargoState(state.colonies[0]!).pendingMint)[0]!;
    run([{ commandId: 's1', kind: 'cargo.settled', colonyIndex: 0, source: 'dev', args: { ref: exportRef, ok: true, direction: 'export' } } as SimCommand]);
    expect(ensureColonyCargoState(state.colonies[0]!).inOrbit['metals.t1']).toBe(120);
    expect(total()).toBe(start); // in orbit

    run([{ commandId: 'i1', kind: 'cargo.import', colonyIndex: 0, source: 'player', args: { colonyId: 'col_0', resource: 'metals.t1', amount: 120 } } as SimCommand]);
    const importRef = Object.keys(ensureColonyCargoState(state.colonies[0]!).pendingImport)[0]!;
    expect(ensureColonyCargoState(state.colonies[0]!).inOrbit['metals.t1']).toBe(0);
    expect(total()).toBe(start); // in flight back

    run([{ commandId: 's2', kind: 'cargo.settled', colonyIndex: 0, source: 'dev', args: { ref: importRef, ok: true, direction: 'import' } } as SimCommand]);
    expect(getColonyStock(state, 0)['metals.t1']).toBe(300);
    expect(total()).toBe(start);

    // The journal of the cargo postings alone explains the change since the seed: -120 then +120.
    const ledger = hostLedger();
    postAll(ledger, [{ at: 0, reason: 'admin.correction', actor: 'system:admin', legs: [{ account: 'sys:admin', asset: 'metals.t1', delta: -300 }, { account: 'colony:0', asset: 'metals.t1', delta: 300 }] }, ...journal]);
    expect(ledger.balances('colony:0')['metals.t1']).toBe(getColonyStock(state, 0)['metals.t1']);
  });
});
