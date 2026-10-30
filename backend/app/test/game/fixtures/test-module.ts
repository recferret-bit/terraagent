import { defineCommandHandler, defineSimModule, insertRow, rowOf, setField } from '@terra/sim';

/** Test-only sim module: `test.spawn {x,y}` creates an entity, `test.move {id,x,y}` moves it, `test.pong` emits `dev.pong`. */
export default defineSimModule({
  id: 'test-delta',
  wave: 'W00',
  handlers: [
    defineCommandHandler({
      kind: 'test.spawn', wave: 'W00',
      handle(state, cmd, ctx) {
        const a = cmd.args as { x: number; y: number };
        const id = ctx.newEntityId();
        const row = insertRow(state.entities, id, ctx.tick);
        setField(state.entities, row, 'x', a.x, ctx.tick);
        setField(state.entities, row, 'y', a.y, ctx.tick);
      },
    }),
    defineCommandHandler({
      kind: 'test.move', wave: 'W00',
      handle(state, cmd, ctx) {
        const a = cmd.args as { id: number; x: number; y: number };
        const row = rowOf(state.entities, a.id);
        if (row < 0) return 'not_found';
        setField(state.entities, row, 'x', a.x, ctx.tick);
        setField(state.entities, row, 'y', a.y, ctx.tick);
      },
    }),
    defineCommandHandler({
      kind: 'test.pong', wave: 'W00',
      handle(_s, _c, ctx) { ctx.emit({ kind: 'dev.pong', data: { note: 'hi' } }); },
    }),
  ],
});
