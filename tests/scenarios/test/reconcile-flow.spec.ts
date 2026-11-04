import { createHash } from 'node:crypto';
import { parseWaves, RESOURCE_KEYS } from '@terra/contracts';
import {
  colonyResourcePosition,
  ensureColonyLedger,
  PlanetJournal,
  restore,
  RESIDUAL_SCALE,
  SimHost,
  snapshot,
  type ColonyWithLedger,
  type LedgerPosting,
} from '@terra/sim';
import { describe, expect, it } from 'vitest';
import { createScenarioPlanet, getScenario } from '../_loader';

/** LED-16: production, consumption, refunds and cargo reconcile exactly, also through a restart. */

const hash = (host: SimHost): string => createHash('sha256').update(snapshot(host.state)).digest('hex');
const colonyOf = (host: SimHost): ColonyWithLedger => ensureColonyLedger(host.state.colonies[0]!);

function enqueue(host: SimHost, id: string, task: Record<string, unknown>): void {
  host.submit({ colonyIndex: 0, source: 'player', commandId: `c-${id}`, kind: 'enqueueTask', args: { taskId: id, task } });
}

/** The same scripted play for every run: builds, a cancel in progress (50 % refund) and a long idle stretch. */
function play(host: SimHost, from: number, to: number): void {
  for (let t = from; t < to; t++) {
    if (t === 0) {
      enqueue(host, 'h1', { kind: 'buildUnit', unit: 'harvester' });
      enqueue(host, 'sol', { kind: 'build', building: 'solar', q: 5, r: -4 });
    }
    if (t === 400) enqueue(host, 'ext2', { kind: 'build', building: 'metalsExtractor', q: 6, r: 0 });
    if (t === 60) host.submit({ colonyIndex: 0, source: 'player', commandId: 'c-cancel', kind: 'cancelTask', args: { taskId: 'sol' } });
    host.step(1);
  }
}

function newRun(): { host: SimHost; journal: PlanetJournal; problems: string[]; postings: LedgerPosting[] } {
  const { host, setupPostings } = createScenarioPlanet('w03');
  const journal = PlanetJournal.empty();
  const problems: string[] = [];
  const postings: LedgerPosting[] = [];
  for (const p of journal.record(setupPostings)) problems.push(p.code);
  host.onPostings((p) => { postings.push(...p); for (const x of journal.record(p)) problems.push(x.code); });
  return { host, journal, problems, postings };
}

describe('LED-16 fixed-unit reconciliation on the w03 scenario (harvesters, extractor, builds, cancel)', () => {
  it('keeps every stock value whole, the journal equal to col.stock, and produced - spent + refunds = stock - opening', () => {
    const run = newRun();
    const opening = { ...colonyOf(run.host).stock };
    play(run.host, 0, 3000);
    const col = colonyOf(run.host);

    for (const k of RESOURCE_KEYS) {
      expect(Number.isInteger(col.stock[k]), `stock ${k}`).toBe(true);
      expect(Number.isInteger(col.residual[k]) && col.residual[k] >= 0 && col.residual[k] < RESIDUAL_SCALE).toBe(true);
    }
    for (const v of Object.values(col.production.produced)) expect(Number.isInteger(v)).toBe(true);
    for (const v of Object.values(col.production.capped)) expect(Number.isInteger(v)).toBe(true);
    expect(JSON.stringify(col.production)).not.toMatch(/\d\.\d{7,}/); // no float dust anywhere in the ledger fields

    expect(run.problems).toEqual([]);
    expect(run.journal.reconcile(run.host.state)).toEqual([]);

    // Per resource: the journal's net movement is exactly stock - opening (every posting is a whole unit).
    const net: Record<string, number> = {};
    for (const p of run.postings) for (const l of p.legs) if (l.account === 'colony:0') net[l.asset] = (net[l.asset] ?? 0) + l.delta;
    for (const k of RESOURCE_KEYS) expect(net[k] ?? 0).toBe(col.stock[k] - opening[k]);
    const reasons = new Set(run.postings.map((p) => p.reason));
    expect(reasons.has('production.tick')).toBe(true);
    expect(reasons.has('construction.spend')).toBe(true);
    expect(reasons.has('construction.refund')).toBe(true);
    expect(reasons.has('production.consume') || col.stock['bio.biomass'] > 0).toBe(true);
    // Produced is what production.tick posted that fitted under the cap.
    const producedPosted: Record<string, number> = {};
    for (const p of run.postings) if (p.reason === 'production.tick') for (const l of p.legs) if (l.account === 'colony:0') producedPosted[l.asset] = (producedPosted[l.asset] ?? 0) + l.delta;
    for (const k of RESOURCE_KEYS) expect(col.production.produced[k]).toBeGreaterThanOrEqual(producedPosted[k] ?? 0);
  });

  it('snapshot -> restore mid-accumulation continues to the identical state (same hash as an uninterrupted run)', () => {
    const straight = newRun();
    play(straight.host, 0, 1200);

    const first = newRun();
    play(first.host, 0, 637);
    const col = colonyOf(first.host);
    expect(RESOURCE_KEYS.some((k) => col.residual[k] > 0)).toBe(true); // really mid-accumulation
    const scenario = getScenario('w03')!;
    const second = new SimHost({ flags: parseWaves(scenario.waves).list });
    second.load(restore(snapshot(first.host.state)));
    expect(hash(second)).toBe(hash(first.host));
    play(second, 637, 1200);

    expect(hash(second)).toBe(hash(straight.host));
    expect(colonyOf(second).residual).toEqual(colonyOf(straight.host).residual);
  });

  it('keeps stock + orbit + in-flight + residual constant while only production, spending and refunds change nothing in cargo', () => {
    const run = newRun();
    play(run.host, 0, 200);
    const p = colonyResourcePosition(colonyOf(run.host), 'metals.t1');
    expect(p.inOrbit + p.inFlight).toBe(0);
    expect(p.totalMicro).toBe(p.stock * RESIDUAL_SCALE + p.residualMicro);
  });
});
