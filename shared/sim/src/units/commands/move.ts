import { approach } from '../approach';
import { defineUnitCommand, type MoveCommand } from '../types';

/** `move`: walk to tile `(q, r)` along a planned route; fails if the tile cannot be reached. */
export const moveCommand = defineUnitCommand<MoveCommand>({
  kind: 'move',
  key: (c) => `move:${c.q},${c.r}:${c.minDist ?? 0}-${c.maxDist ?? 0}`,
  execute(u, c) {
    const status = approach(u, { q: c.q, r: c.r, minDist: c.minDist ?? 0, maxDist: c.maxDist ?? 0 });
    if (status === 'arrived') return 'done';
    return status === 'failed' ? 'failed' : 'running';
  },
});
