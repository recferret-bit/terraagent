import { flagsFromList } from '@terra/contracts';
import { compileData, createPlanet, SIM_VERSION, SimHost, TICK_MS } from '@terra/sim';
import { describe, expect, it } from 'vitest';
import { ReplicaCore } from '../replica/ReplicaCore';
import { Predictor } from './Predictor';

const FLAGS = ['W00'];
const LAG = 300;

/** Authority + 300 ms links both ways, driven by a fake clock in 10 ms slices. */
class Net {
  t = 1000;
  readonly auth = new SimHost({ flags: FLAGS });
  readonly replica = new ReplicaCore();
  readonly predictor: Predictor;
  private q: { at: number; seq: number; fn: () => void }[] = [];
  private seq = 0;
  private nextStepAt: number;
  private lastDeltaTick = 0;
  private cmdN = 0;
  readonly rejects: { id: string; code: string }[] = [];
  constructor(opts: { enabled?: boolean; lag?: number } = {}) {
    this.lag = opts.lag ?? LAG;
    this.auth.load(createPlanet({ type: 'flat', seed: 'pred' }));
    this.predictor = new Predictor(this.replica, { now: () => this.t, enabled: opts.enabled });
    this.nextStepAt = this.t;
    this.sendWelcome();
  }
  readonly lag: number;
  private later(ms: number, fn: () => void) { this.q.push({ at: this.t + ms, seq: this.seq++, fn }); }
  private sendWelcome() {
    const state = this.auth.snapshot(), tick = this.auth.tick, serverTimeMs = this.t;
    this.lastDeltaTick = tick;
    this.later(this.lag, () => {
      const r = this.predictor.welcome({ state, tick, flags: FLAGS, dataHash: compileData(flagsFromList(FLAGS)).hash, simVersion: SIM_VERSION, serverTimeMs });
      expect(r.ok).toBe(true);
    });
  }
  /** The client sends a command (prediction learns about it at once; the server gets it `lag` later). */
  send(kind: string, args: unknown): string {
    const id = `cm_${++this.cmdN}`;
    this.predictor.submit({ id, kind, args, sentAtMs: this.t });
    this.later(this.lag, () => {
      this.auth.submit({ colonyIndex: null, source: 'dev', commandId: id, kind, args });
      this.pendingAcks.push(id);
    });
    return id;
  }
  private pendingAcks: string[] = [];
  advance(ms: number) {
    const end = this.t + ms;
    while (this.t < end) {
      this.t += 10;
      if (this.t >= this.nextStepAt + TICK_MS) this.serverStep();
      for (;;) {
        const due = this.q.filter((x) => x.at <= this.t).sort((a, b) => a.at - b.at || a.seq - b.seq)[0];
        if (!due) break;
        this.q = this.q.filter((x) => x !== due);
        due.fn();
      }
    }
  }
  private serverStep() {
    this.nextStepAt += TICK_MS;
    const ids = this.pendingAcks.splice(0);
    const res = this.auth.step(1);
    for (const o of res.outcomes) {
      if (!ids.includes(o.commandId)) continue;
      const { commandId: id, appliedAtTick, code } = o;
      this.later(this.lag, () => { if (code) { this.predictor.onReject(id, code); this.rejects.push({ id, code }); } else this.predictor.onAck(id, appliedAtTick); });
    }
    const from = this.lastDeltaTick, diff = this.auth.diffSince(from), toTick = this.auth.tick;
    this.lastDeltaTick = toTick;
    this.later(this.lag, () => { this.predictor.onDelta({ fromTick: from, toTick, diff }); });
  }
  ent(host: SimHost, id: number) { return host.view().entities.find((e) => e.id === id)!; }
}

/** Spawns a test entity and lets the client learn about it; returns its id. */
function withEntity(net: Net): number {
  net.auth.submit({ colonyIndex: null, source: 'dev', commandId: 'cm_s', kind: 'dev.spawn', args: { q: 3, r: 4 } });
  net.advance(1500);
  const e = net.auth.view().entities[0];
  expect(e).toBeDefined();
  return e.id;
}

describe('Predictor', () => {
  it('shows a nudge on the next view, long before the server could have answered', () => {
    const net = new Net();
    const id = withEntity(net);
    net.advance(600);
    const x0 = net.ent(net.replica.simHost, id).x;
    net.send('dev.nudge', { id, dq: 1 });
    const predictedX = net.ent(net.predictor.host(), id).x;
    expect(predictedX).toBeGreaterThan(x0 + 0.1);
    expect(net.ent(net.replica.simHost, id).x).toBe(x0);
    net.advance(500); // the command only reached the server at +300
    expect(net.ent(net.replica.simHost, id).x).toBe(x0);
    expect(net.ent(net.predictor.host(), id).x).toBeCloseTo(predictedX, 6);
  });

  it('agrees with the confirmed state after the ack and the covering delta, with nothing pending', () => {
    const net = new Net();
    const id = withEntity(net);
    net.send('dev.nudge', { id, dq: 1 });
    const predictedX = net.ent(net.predictor.host(), id).x;
    net.advance(1500);
    expect(net.predictor.pending).toHaveLength(0);
    const confirmed = net.ent(net.replica.simHost, id).x;
    expect(Math.abs(net.ent(net.predictor.host(), id).x - confirmed)).toBeLessThan(0.05);
    expect(Math.abs(predictedX - confirmed)).toBeLessThan(0.05);
    expect(confirmed).toBeGreaterThan(3.1);
  });

  it('never applies a command twice while it waits for its ack and delta', () => {
    const net = new Net();
    const id = withEntity(net);
    const x0 = net.ent(net.auth, id).x;
    net.send('dev.nudge', { id, dq: 1 });
    const seen: number[] = [];
    for (let i = 0; i < 150; i++) { net.advance(10); seen.push(net.ent(net.predictor.host(), id).x); }
    const final = net.ent(net.auth, id).x;
    expect(final).toBeGreaterThan(x0);
    expect(Math.max(...seen)).toBeLessThan(final + 0.05);
  });

  it('rolls back a rejected command and reports the reason', () => {
    const net = new Net();
    const id = withEntity(net);
    const bad = net.send('dev.nudge', { id: 9999, dq: 1 });
    const good = net.send('dev.nudge', { id, dq: 1 });
    expect(net.predictor.pending.map((p) => p.id)).toEqual([bad, good]);
    net.advance(1500);
    expect(net.rejects).toEqual([{ id: bad, code: 'unknown_entity' }]);
    expect(net.predictor.rejected).toMatchObject({ code: 'unknown_entity', cmd: { id: bad } });
    expect(net.predictor.pending).toHaveLength(0);
    expect(Math.abs(net.ent(net.predictor.host(), id).x - net.ent(net.auth, id).x)).toBeLessThan(0.05);
  });

  it('re-runs several pending commands in order on every rebase', () => {
    const net = new Net();
    const id = withEntity(net);
    const x0 = net.ent(net.auth, id).x;
    net.send('dev.nudge', { id, dq: 1 });
    net.advance(100);
    net.send('dev.teleport', { id, q: 10, r: 10 });
    net.advance(100);
    net.send('dev.nudge', { id, dq: 1 });
    expect(net.predictor.pending).toHaveLength(3);
    const step = net.ent(net.predictor.host(), id).x - 10;
    expect(step).toBeGreaterThan(0.1); // nudge, teleport, nudge: ends at 10 + one nudge, not x0 + three
    expect(x0).toBeLessThan(5);
    net.advance(2500);
    expect(net.predictor.pending).toHaveLength(0);
    const finalX = net.ent(net.auth, id).x;
    expect(finalX).toBeCloseTo(10 + step, 5);
    expect(Math.abs(net.ent(net.predictor.host(), id).x - finalX)).toBeLessThan(0.05);
  });

  it('with prediction off shows only the confirmed state', () => {
    const net = new Net({ enabled: false });
    const id = withEntity(net);
    const x0 = net.ent(net.replica.simHost, id).x;
    net.send('dev.nudge', { id, dq: 1 });
    expect(net.ent(net.predictor.host(), id).x).toBe(x0);
    net.advance(1500);
    expect(net.ent(net.predictor.host(), id).x).toBeGreaterThan(x0);
  });

  it('limits the lead to maxLeadTicks', () => {
    const net = new Net();
    withEntity(net);
    net.predictor.setServerOffset(1e7);
    net.send('dev.ping', {});
    expect(net.predictor.targetTick() - net.replica.tick).toBeLessThanOrEqual(25);
  });
});
