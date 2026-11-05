import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { placeSpawnedEntity } from '../../ecs/placement';
import { insertRow } from '../../ecs/store';
import { hexIndex } from '../../grid/hex';
import { defineCommandHandler } from '../../kernel/commands';
import { commandColony, parseArgs } from '../command';

/**
 * `dev.spawnunit <builder|harvester> <q> <r> [n]` (dev console `spawn builder`): `n` idle units of the caller's colony on
 * consecutive tiles of the row starting at (q, r) (6 per row). They have a logistics row, so they add load to the supply
 * window; no cost, no supply-cap check (a dev shortcut for the W13 owner demo).
 */
export const devSpawnUnit = defineCommandHandler({
  kind: 'dev.spawnunit',
  wave: 'W13',
  handle(state, cmd, ctx) {
    const colony = commandColony(cmd);
    if (typeof colony === 'string') return colony;
    const args = parseArgs('dev.spawnunit', cmd.args);
    if (!args) return 'invalid_args';
    const hx = hexIndex(state.grid.radius);
    const count = args.count ?? 1;
    const tiles: [number, number][] = [];
    for (let i = 0; i < count; i++) {
      const q = args.q + (i % 6), r = args.r + Math.floor(i / 6);
      if (hx.indexOf(q, r) < 0) return 'invalid_args';
      tiles.push([q, r]);
    }
    const c = state.entities.cols;
    for (const [q, r] of tiles) {
      const row = insertRow(state.entities, ctx.newEntityId(), ctx.tick);
      c.kind[row] = ENTITY_KIND[args.unit]; c.owner[row] = colony; c.tier[row] = 1;
      placeSpawnedEntity(state.entities, row, q, r, ctx.tick);
      c.hp[row] = 100; c.hpMax[row] = 100; c.state[row] = ENTITY_STATE.idle;
    }
  },
});
