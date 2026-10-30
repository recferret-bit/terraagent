import { dataRow } from '../../data';
import { setField, insertRow, rowOf } from '../../ecs/store';
import { defineCommandHandler } from '../../kernel/commands';
import type { PlanetState } from '../../kernel/state';
import type { StepContext } from '../../kernel/context';
import { defineSimModule } from '../define';

/** `kind` of the W00 test entity spawned by `dev.spawn` (no gameplay meaning). */
export const DEV_ENTITY_KIND = 1;

function place(s: PlanetState, row: number, x: number, y: number, ctx: StepContext): void {
  const e = s.entities;
  setField(e, row, 'q', Math.round(x), ctx.tick);
  setField(e, row, 'r', Math.round(y), ctx.tick);
  setField(e, row, 'x', x, ctx.tick);
  setField(e, row, 'y', y, ctx.tick);
}

const ping = defineCommandHandler({
  kind: 'dev.ping', wave: 'W00',
  handle(_s, c, ctx) {
    const note = (c.args as { note?: string }).note;
    ctx.emit({ kind: 'dev.pong', data: note === undefined ? {} : { note } });
  },
});

const spawn = defineCommandHandler({
  kind: 'dev.spawn', wave: 'W00',
  handle(s, c, ctx) {
    const { q, r } = c.args as { q: number; r: number };
    const row = insertRow(s.entities, ctx.newEntityId(), ctx.tick);
    s.entities.cols.kind[row] = DEV_ENTITY_KIND;
    place(s, row, q, r, ctx);
  },
});

const nudge = defineCommandHandler({
  kind: 'dev.nudge', wave: 'W00',
  handle(s, c, ctx) {
    const { id, dq, dr } = c.args as { id: number; dq?: number; dr?: number };
    const row = rowOf(s.entities, id);
    if (row < 0) return 'unknown_entity';
    const step = Number(dataRow(ctx.data, 'dev', 'probe').nudgeTiles);
    const [a, b] = dq === undefined && dr === undefined ? [1, 0] : [dq ?? 0, dr ?? 0];
    place(s, row, s.entities.cols.x[row] + a * step, s.entities.cols.y[row] + b * step, ctx);
  },
});

const teleport = defineCommandHandler({
  kind: 'dev.teleport', wave: 'W00',
  handle(s, c, ctx) {
    const { id, q, r } = c.args as { id: number; q: number; r: number };
    const row = rowOf(s.entities, id);
    if (row < 0) return 'unknown_entity';
    place(s, row, q, r, ctx);
  },
});

export default defineSimModule({ id: 'dev', wave: 'W00', handlers: [ping, spawn, nudge, teleport] });
