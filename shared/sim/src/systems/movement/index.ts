import type { CompiledRow } from '../../data';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { rowOf, setField } from '../../ecs/store';
import { axialToPlane, hexDistance, hexIndex, hexRound } from '../../grid/hex';
import { PREP, TERRAIN } from '../../grid/layers';
import { defineCommandHandler } from '../../kernel/commands';
import { defineSystem } from '../../kernel/system';
import { defineSimModule } from '../define';
import { resolveHarvesterRow, syncHarvesterView } from '../harvest/unit';
import {
  getHqView,
  hqJobFromState,
  resolveHqT1Row,
  revealVision,
  spawnHqUnit,
  syncHqView,
  type HqJob,
  type HqUnitView,
  type SimState,
  type SpawnHqOpts,
} from '../hq';

export {
  getHqView,
  hqJobFromState,
  revealVision,
  spawnHqUnit,
  syncHqView,
  type HqJob,
  type HqUnitView,
  type SimState,
  type SpawnHqOpts,
};

interface MoveUnitArgs {
  entityId?: number;
  unitId?: number;
  q?: number;
  r?: number;
  to?: { q: number; r: number };
  queue?: boolean;
}

const ARRIVAL_EPS = 1e-5;

export const moveUnit = defineCommandHandler({
  kind: 'moveUnit',
  wave: 'W01',
  handle(state, cmd, ctx) {
    const args = (cmd.args ?? {}) as MoveUnitArgs;
    const rawId = args.entityId ?? args.unitId;
    const targetQ = args.to ? args.to.q : args.q;
    const targetR = args.to ? args.to.r : args.r;
    if (
      typeof rawId !== 'number' ||
      typeof targetQ !== 'number' ||
      typeof targetR !== 'number' ||
      !Number.isInteger(targetQ) ||
      !Number.isInteger(targetR)
    ) {
      return 'invalid_args';
    }

    let row = rowOf(state.entities, rawId);
    if (row < 0 && rawId === 0 && state.entities.count > 0) row = 0;
    if (row < 0) return 'unknown_entity';

    const cols = state.entities.cols;
    if (cmd.colonyIndex !== null && cmd.colonyIndex !== undefined && cols.owner[row] !== cmd.colonyIndex) {
      return 'not_own_colony';
    }
    const isMovable = cols.kind[row] === ENTITY_KIND.hq || cols.kind[row] === ENTITY_KIND.harvester;
    if (!isMovable || cols.hp[row] <= 0) {
      return 'invalid_args';
    }

    const idx = hexIndex(state.grid.radius);
    const tileIdx = idx.indexOf(targetQ, targetR);
    if (tileIdx < 0) return 'invalid_args';

    const terrain = state.grid.layers.terrain[tileIdx];
    const prep = state.grid.layers.prep[tileIdx];
    if (terrain === TERRAIN.deep || prep === PREP.ridge || prep === PREP.moat) {
      return 'site_blocked';
    }

    setField(state.entities, row, 'targetQ', targetQ, ctx.tick);
    setField(state.entities, row, 'targetR', targetR, ctx.tick);
    const dist = hexDistance(cols.x[row], cols.y[row], targetQ, targetR);
    setField(state.entities, row, 'state', dist <= ARRIVAL_EPS ? ENTITY_STATE.idle : ENTITY_STATE.moving, ctx.tick);
    setField(state.entities, row, 'progress', 0, ctx.tick);
    if (cols.kind[row] === ENTITY_KIND.hq) {
      syncHqView(state, row, ctx.tick, ctx.data);
    } else if (cols.kind[row] === ENTITY_KIND.harvester) {
      syncHarvesterView(state, row, ctx.tick, ctx.data);
    }
  },
});

export const movement = defineSystem({
  id: 'movement',
  slot: 5,
  wave: 'W01',
  run(state, ctx) {
    const e = state.entities;
    const cols = e.cols;
    let hqRow: CompiledRow | null = null;
    let harvesterRow: CompiledRow | null = null;

    for (let row = 0; row < e.count; row++) {
      if (cols.state[row] !== ENTITY_STATE.moving) continue;
      if (cols.hp[row] <= 0) continue;

      const kind = cols.kind[row];
      let speedPerTick = 0;
      let viewRadius = 0;
      if (kind === ENTITY_KIND.hq) {
        if (!hqRow) hqRow = resolveHqT1Row(ctx.data);
        speedPerTick = Math.fround(Number(hqRow.speedTilesPerS));
        viewRadius = Number(hqRow.viewRadius);
      } else if (kind === ENTITY_KIND.harvester) {
        if (!harvesterRow) harvesterRow = resolveHarvesterRow(ctx.data);
        speedPerTick = Math.fround(Number(harvesterRow.speedTilesPerS));
        viewRadius = Number(harvesterRow.viewRadius ?? 7);
      } else {
        continue;
      }
      const stepDist = Math.fround(speedPerTick * ctx.dt);

      const x = cols.x[row];
      const y = cols.y[row];
      const tx = cols.targetQ[row];
      const ty = cols.targetR[row];
      const dq = tx - x;
      const dr = ty - y;
      const dist = hexDistance(x, y, tx, ty);

      if (dist > 0) {
        const [px, py] = axialToPlane(dq, dr);
        setField(e, row, 'rot', Math.fround(Math.atan2(py, px)), ctx.tick);
      }

      const prevQ = cols.q[row];
      const prevR = cols.r[row];

      if (dist <= stepDist + ARRIVAL_EPS) {
        setField(e, row, 'x', Math.fround(tx), ctx.tick);
        setField(e, row, 'y', Math.fround(ty), ctx.tick);
        setField(e, row, 'q', tx, ctx.tick);
        setField(e, row, 'r', ty, ctx.tick);
        setField(e, row, 'state', ENTITY_STATE.idle, ctx.tick);
        setField(e, row, 'progress', 0, ctx.tick);
        if (tx !== prevQ || ty !== prevR) {
          revealVision(state, cols.owner[row], tx, ty, viewRadius, ctx.tick);
        }
      } else {
        const ratio = stepDist / dist;
        const nx = Math.fround(x + dq * ratio);
        const ny = Math.fround(y + dr * ratio);
        const [nq, nr] = hexRound(nx, ny);
        setField(e, row, 'x', nx, ctx.tick);
        setField(e, row, 'y', ny, ctx.tick);
        setField(e, row, 'q', nq, ctx.tick);
        setField(e, row, 'r', nr, ctx.tick);
        if (nq !== prevQ || nr !== prevR) {
          revealVision(state, cols.owner[row], nq, nr, viewRadius, ctx.tick);
        }
      }

      if (cols.kind[row] === ENTITY_KIND.hq) {
        syncHqView(state, row, ctx.tick, ctx.data);
      } else if (cols.kind[row] === ENTITY_KIND.harvester) {
        syncHarvesterView(state, row, ctx.tick, ctx.data);
      }
    }
  },
});

export default defineSimModule({
  id: 'movement',
  wave: 'W01',
  systems: [movement],
  handlers: [moveUnit],
});
