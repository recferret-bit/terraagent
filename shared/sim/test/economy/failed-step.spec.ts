import { describe, expect, it } from 'vitest';
import {
  allModules,
  createPlanet,
  defineSimModule,
  defineSystem,
  getColonyStock,
  SimHost,
  StepError,
  systemActor,
  treasury,
  type CommandOutcome,
  type LedgerPosting,
} from '../../src';
import { ensureColonyRecord } from '../../src/kernel/colonies';

/** A module that credits colony 0 in slot 1 and then throws in slot 3: a step that fails after a treasury change. */
const broken = defineSimModule({
  id: 'zz-broken',
  wave: 'W00',
  systems: [
    defineSystem({ id: 'zzCredit', slot: 1, wave: 'W00', run: (s, ctx) => void treasury(s, ctx).add({ colony: 0, amounts: { 'metals.t1': 7 }, reason: 'admin.correction', actor: systemActor('test') }) }),
    defineSystem({ id: 'zzThrow', slot: 3, wave: 'W00', run: () => { throw new Error('boom'); } }),
  ],
});

describe('LED-09: a step that throws still hands its postings (and outcomes) to the host', () => {
  it('SimHost.step rethrows a StepError after publishing the postings that already changed col.stock', () => {
    const host = new SimHost({ flags: ['W00', 'W01'], modules: [...allModules(), broken] });
    const state = createPlanet({ type: 'flat', seed: 'failed-step', radius: 4 });
    ensureColonyRecord(state, 0, 0);
    host.load(state);
    const heard: LedgerPosting[] = [];
    const answered: CommandOutcome[] = [];
    host.onPostings((p) => void heard.push(...p));
    host.onOutcomes((o) => void answered.push(...o));
    host.submit({ colonyIndex: 0, source: 'dev', commandId: 'ping_1', kind: 'dev.ping', args: {} });

    let err: unknown;
    try {
      host.step(1);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(StepError);
    expect((err as StepError).tick).toBe(1);
    expect(getColonyStock(host.state, 0)['metals.t1']).toBe(7);
    expect(heard).toHaveLength(1);
    expect(heard[0]).toMatchObject({ reason: 'admin.correction', at: 1 });
    expect(answered).toEqual([{ commandId: 'ping_1', kind: 'dev.ping', appliedAtTick: 1 }]);
    expect(host.pending).toBe(0); // the applied command is never re-applied
  });
});
