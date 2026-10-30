import {
  createPipeline, createState, defineCommandHandler, defineSystem, insertRow, nextFloat, nextInt, rowOf, setField,
  type EngineConfig, type SimCommand,
} from '../../src';

/** A wandering test system: every step moves each entity by a random amount drawn from the `misc` stream. */
export const wander = defineSystem({
  id: 'test.wander', slot: 5, wave: 'W00',
  run(state, ctx) {
    const e = state.entities, rng = ctx.rng('misc');
    for (let row = 0; row < e.count; row++) {
      setField(e, row, 'x', e.cols.x[row] + (nextFloat(rng) - 0.5) * ctx.dt, ctx.tick);
      setField(e, row, 'y', e.cols.y[row] + (nextFloat(rng) - 0.5) * ctx.dt, ctx.tick);
    }
    if (nextInt(rng, 0, 9) === 0) ctx.emit({ kind: 'test.blip', data: { n: e.count } });
  },
});

export const spawn = defineCommandHandler({
  kind: 'test.spawn', wave: 'W00',
  handle(state, cmd, ctx) {
    const { q, r } = cmd.args as { q: number; r: number };
    const row = insertRow(state.entities, ctx.newEntityId(), ctx.tick);
    state.entities.cols.q[row] = q; state.entities.cols.r[row] = r;
    state.entities.cols.x[row] = q; state.entities.cols.y[row] = r;
  },
});

export const kill = defineCommandHandler({
  kind: 'test.kill', wave: 'W00',
  handle(state, cmd) {
    if (rowOf(state.entities, (cmd.args as { id: number }).id) < 0) return 'unknown_entity';
  },
});

export const W01_ONLY = defineCommandHandler({ kind: 'test.later', wave: 'W01', handle() {} });

export const config: EngineConfig = { flags: new Set(['W00']), data: { hash: 'test', tables: {} }, systems: [wander], handlers: [spawn, kill, W01_ONLY] };
export const pipeline = createPipeline(config);
export const fresh = (seed = 'seed-1') => createState({ planetId: 'pl_test', planetType: 'temperate', seed, radius: 8 });

let n = 0;
export const cmd = (kind: string, args: unknown): SimCommand => ({ colonyIndex: null, source: 'dev', commandId: `c${++n}`, kind, args });
