import {
  allModules, defineCommandHandler, defineSimModule, defineSystem, insertRow, nextFloat, nextInt, removeRow, rowOf, setBlob, setField, touchTile,
} from '@terra/sim';

/** Test-only sim module: spawn / move / kill entities and churn tiles. Authority and replica must list the same modules. */
const handlers = [
  defineCommandHandler({ kind: 't.spawn', wave: 'W00', handle(s, c, ctx) {
    const { q, r } = c.args as { q: number; r: number };
    const row = insertRow(s.entities, ctx.newEntityId(), ctx.tick);
    const k = s.entities.cols;
    k.q[row] = q; k.r[row] = r; k.x[row] = q; k.y[row] = r; k.hp[row] = k.hpMax[row] = 10; k.owner[row] = 0; k.kind[row] = 3;
  } }),
  defineCommandHandler({ kind: 't.move', wave: 'W00', handle(s, c, ctx) {
    const { id, x } = c.args as { id: number; x: number };
    const row = rowOf(s.entities, id);
    if (row < 0) return 'unknown_entity';
    setField(s.entities, row, 'x', x, ctx.tick);
  } }),
  defineCommandHandler({ kind: 't.kill', wave: 'W00', handle(s, c, ctx) {
    if (!removeRow(s.entities, (c.args as { id: number }).id, ctx.tick)) return 'unknown_entity';
  } }),
];

const churn = defineSystem({ id: 'test.churn', slot: 5, wave: 'W00', run(s, ctx) {
  const g = ctx.rng('misc');
  for (let k = 0; k < 4; k++) {
    const i = nextInt(g, 0, s.grid.count - 1);
    s.grid.layers.terrain[i] = nextInt(g, 0, 5);
    (s.grid.layers.height as Float32Array)[i] = nextFloat(g);
    touchTile(s, i, ctx.tick);
  }
  const e = s.entities;
  for (let row = 0; row < e.count; row++) if (nextInt(g, 0, 2) === 0) setField(e, row, 'progress', nextFloat(g), ctx.tick);
  if (nextInt(g, 0, 3) === 0) setBlob(s, 'lanes', { n: nextInt(g, 0, 99) }, ctx.tick);
} });

export const testModule = defineSimModule({ id: 'replica-test', wave: 'W00', systems: [churn], handlers });
export const TEST_MODULES = [...allModules(), testModule];
