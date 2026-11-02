import { adminRelocateEntity } from '../../ecs/placement';
import { rowOf } from '../../ecs/store';
import { inHex } from '../../grid/hex';
import { defineCommandHandler } from '../../kernel/commands';
import { setBlob } from '../../kernel/state';
import { landingBlock } from '../../world/landingPlanner';
import { relocateLanding } from '../../world/presence';
import { commandColony, parseArgs } from '../command';
import { deployPod, getLandingPods, spawnColonyLanding } from '../landing';

/**
 * `dev.land` (admin) for the caller's colony (GP-26): lands its pod now, optionally at `(q, r)` (skips the descent
 * timer). A colony without a pod gets one (with its cargo, credited by the landing like any other); a descending pod
 * opens now, moved to `(q, r)` first when given (same landing rules as every landing, D-39). A colony whose pod has
 * already opened is refused `already_landed`.
 */
export const devLand = defineCommandHandler({
  kind: 'dev.land',
  wave: 'W01',
  handle(state, cmd, ctx) {
    const colony = commandColony(cmd);
    if (typeof colony === 'string') return colony;
    const args = parseArgs('dev.land', cmd.args);
    if (!args) return 'invalid_args';
    const { q, r } = args;
    const at = typeof q === 'number' && typeof r === 'number' ? { q, r } : null;
    const pods = getLandingPods(state);
    const own = pods.find((p) => p.colonyId === colony);
    if (own?.deployed) return 'already_landed';

    if (!own) {
      const landed = spawnColonyLanding(state, { colonyId: colony, ...(at ?? {}), tick: ctx.tick, data: ctx.data }, ctx);
      if (!landed.ok) return landed.code;
      const updated = getLandingPods(state);
      const pod = updated.find((p) => p.colonyId === colony && !p.deployed);
      if (pod) deployPod(state, pod, ctx);
      setBlob(state, 'landingPods', updated, ctx.tick);
      return;
    }

    if (at) {
      if (!inHex(at.q, at.r, state.grid.radius)) return 'invalid_args';
      // Same rule as every landing (D-39): never onto / near an earlier landing, water or foreign land.
      const why = landingBlock(state, colony, at.q, at.r, ctx.data, { relocate: true });
      if (why) return why;
      own.q = at.q;
      own.r = at.r;
      relocateLanding(state, colony, at.q, at.r, ctx.tick);
      const row = rowOf(state.entities, own.podEntityId);
      if (row >= 0) adminRelocateEntity(state.entities, row, Math.fround(at.q), Math.fround(at.r), ctx.tick);
    }
    deployPod(state, own, ctx);
    setBlob(state, 'landingPods', pods, ctx.tick);
  },
});
