import { adminRelocateEntity } from '../../ecs/placement';
import { rowOf } from '../../ecs/store';
import { defineCommandHandler } from '../../kernel/commands';
import { setBlob } from '../../kernel/state';
import { hexDistance, inHex } from '../../grid/hex';
import { landingBlock } from '../../world/landingPlanner';
import { relocateLanding } from '../../world/presence';
import { deployPod, getLandingPods, resolveMinLandingSeparation, spawnColonyLanding } from '../landing';

/** `dev.land` (admin): lands the colony pod now, optionally at `(q, r)` (skips the descent timer). */
export const devLand = defineCommandHandler({
  kind: 'dev.land',
  wave: 'W01',
  handle(state, cmd, ctx) {
    const args = (cmd.args ?? {}) as { q?: number; r?: number; colonyId?: number };
    const legacyColony = (cmd as { colony?: unknown }).colony;
    const targetColony =
      typeof cmd.colonyIndex === 'number'
        ? cmd.colonyIndex
        : typeof legacyColony === 'number'
          ? legacyColony
          : typeof args.colonyId === 'number'
            ? args.colonyId
            : null;

    const pods = getLandingPods(state);
    const matching = pods.filter((p) => !p.deployed && (targetColony === null || p.colonyId === targetColony));
    if (matching.length === 0) {
      if (
        args.q === undefined &&
        args.r === undefined &&
        pods.some((p) => p.deployed && (targetColony === null || p.colonyId === targetColony))
      ) {
        return;
      }
      const colIdx = targetColony ?? 0;
      const landed = spawnColonyLanding(state, { colonyId: colIdx, q: args.q, r: args.r, tick: ctx.tick, data: ctx.data }, ctx);
      if (!landed.ok) return landed.code;
      const updatedPods = getLandingPods(state);
      for (const pod of updatedPods) {
        if (!pod.deployed && pod.colonyId === colIdx) deployPod(state, pod, ctx);
      }
      setBlob(state, 'landingPods', updatedPods, ctx.tick);
      return;
    }

    const minSep = resolveMinLandingSeparation(ctx.data);
    for (const pod of matching) {
      if (typeof args.q === 'number' && typeof args.r === 'number') {
        const { q, r } = args;
        if (!inHex(q, r, state.grid.radius)) return 'invalid_args';
        if (pods.some((o) => o.colonyId !== pod.colonyId && hexDistance(o.q, o.r, q, r) < minSep)) return 'landing_site_taken';
        // Same rule as every landing (D-39): never onto / near an earlier landing, water or foreign land.
        const why = landingBlock(state, pod.colonyId, q, r, ctx.data, { relocate: true });
        if (why) return why;
      }
    }
    for (const pod of matching) {
      if (typeof args.q === 'number' && typeof args.r === 'number') {
        pod.q = args.q;
        pod.r = args.r;
        relocateLanding(state, pod.colonyId, args.q, args.r, ctx.tick);
        const row = rowOf(state.entities, pod.podEntityId);
        if (row >= 0) adminRelocateEntity(state.entities, row, Math.fround(args.q), Math.fround(args.r), ctx.tick);
      }
      deployPod(state, pod, ctx);
    }
    setBlob(state, 'landingPods', pods, ctx.tick);
  },
});
