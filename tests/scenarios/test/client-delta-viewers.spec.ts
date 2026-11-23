import {
  bundledClientDeltaFrames, clientDeltaFrames, COLONY_OWNER_FIELDS, decodeValue, ownFramesFor, SimHost, snapshot, unpackDeltaBundle,
  type PlanetState, type SimCommand,
} from '@terra/sim';
import { describe, expect, it } from 'vitest';
import { createScenarioPlanet } from '../_loader';

/** What a socket of colony `own` (undefined: a full viewer) must hold: its colony whole, other colonies' summary. */
function clientView(state: PlanetState, own: number | undefined): unknown {
  const s = (decodeValue(snapshot(state, { forClient: true })) as { state: { colonies: Array<Record<string, unknown>>; blobs: Record<string, unknown> } }).state;
  s.colonies = s.colonies.map((c) => (own === undefined || c.index === own ? c
    : Object.fromEntries(Object.entries(c).filter(([k]) => !COLONY_OWNER_FIELDS.has(k)))));
  return s;
}

let n = 0;
const player = (colonyIndex: number, kind: string, args: unknown): SimCommand =>
  ({ colonyIndex, source: 'player', commandId: `cdv_${++n}`, kind, args });

/**
 * The W18 planet (several colonies, autopilot directors, diplomacy) driven like the server thread's `sendDelta`. The
 * reference is a replica fed the whole-record diffs (`clientDeltaFrames` without a shadow, the previous wire): the sim
 * deliberately leaves some client-invisible writes unstamped (auto unit commands in `blobs.units`), so neither wire
 * equals the authority at every tick, but both must deliver the same state.
 */
describe('client deltas per viewer on a multi-colony W18 planet', () => {
  it('own-colony and full-viewer replicas match the whole-record replica every window; prediction steps on them', () => {
    const { host } = createScenarioPlanet('w18', { planetId: 'pl_cdv' });
    const welcome = () => { const r = new SimHost(host.pipeline); r.load(host.snapshot({ forClient: true })); return r; };
    let last = host.tick;
    bundledClientDeltaFrames(host.state, last);
    const full = welcome(), own0 = welcome(), own1 = welcome(), whole = welcome();
    let ownBytes = 0, fullBytes = 0, windows = 0;
    for (let t = 0; t < 120; t++) {
      if (t === 10) host.submit(player(0, 'diplomacy.proposeTruce', { targetColonyId: 'col_1', durationHours: 6 }));
      if (t === 40) host.submit(player(1, 'setAutopilot', { mode: 'director', awayRaids: false }));
      if (t === 70) host.submit(player(1, 'diplomacy.declareWar', { targetColonyId: 'col_0' }));
      host.step(1);
      for (const f of clientDeltaFrames(host.state, last)) whole.applyDiff(f.diff);
      for (const f of bundledClientDeltaFrames(host.state, last)) {
        full.applyDiff(f.diff);
        const { diff, own } = unpackDeltaBundle(f.diff);
        own0.applyDiff(diff, ownFramesFor(own, 0));
        own1.applyDiff(diff, ownFramesFor(own, 1));
        if (t >= 20) {
          windows++;
          ownBytes += diff.byteLength + ownFramesFor(own, 0).reduce((a, b) => a + b.byteLength, 0);
          fullBytes += f.diff.byteLength;
        }
      }
      last = host.tick;
      if (t % 10 === 0 || t === 119) {
        expect(full.state).toEqual(whole.state);
        expect(clientView(own0.state, 0)).toEqual(clientView(whole.state, 0));
        expect(clientView(own1.state, 1)).toEqual(clientView(whole.state, 1));
      }
    }
    expect(full.state.colonies.length).toBeGreaterThan(1);
    expect(ownBytes).toBeLessThanOrEqual(fullBytes);
    expect(ownBytes / windows).toBeLessThan(10_000);
    // The replica of a colony socket holds foreign owner fields as of its welcome: complete records, so prediction
    // (a clone stepped with the full pipeline) still runs.
    const predicted = own0.clone();
    expect(() => predicted.step(3)).not.toThrow();
  }, 120_000);
});
