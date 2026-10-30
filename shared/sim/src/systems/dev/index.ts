import { RESOURCE_FAMILY_OF, RESOURCE_KEYS, type ResourceKey } from '@terra/contracts';
import { dataRow } from '../../data';
import { setField, insertRow, rowOf } from '../../ecs/store';
import { defineCommandHandler } from '../../kernel/commands';
import type { PlanetState } from '../../kernel/state';
import type { StepContext } from '../../kernel/context';
import { defineSimModule } from '../define';
import { creditResource, ensureColonyLedger, remainingFamilyCap } from '../economy/ledger';
import {
  applyEnvironmentState,
  computeEnvironmentAtCycleTick,
  cycleTickForTimeSpec,
  type EnvironmentState,
} from '../environment';
import { evaluateColonyPower, recomputeAllColonyPower } from '../power-core';

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

function ensureColony(state: PlanetState, colonyIndex: number, tick: number) {
  let colony = state.colonies.find((c) => c.index === colonyIndex);
  if (!colony) {
    colony = {
      index: colonyIndex,
      id: `col-${colonyIndex}`,
      name: `Colony ${colonyIndex + 1}`,
      color: 0x3a7bd5,
      status: 'active',
      changedAt: tick,
    };
    state.colonies.push(colony);
  }
  return ensureColonyLedger(colony);
}

const fill = defineCommandHandler({
  kind: 'dev.fill', wave: 'W02',
  handle(s, c, ctx) {
    const args = (c.args ?? {}) as { res?: string; resource?: string; amount?: number; colonyIndex?: number };
    const colonyIndex = args.colonyIndex ?? c.colonyIndex ?? 0;
    const colony = ensureColony(s, colonyIndex, ctx.tick);
    const targetRes = args.res ?? args.resource ?? 'all';
    const amount = args.amount;

    if (targetRes === 'all') {
      const metalsAmt = amount ?? remainingFamilyCap(colony, 'metals');
      const mineralsAmt = amount ?? remainingFamilyCap(colony, 'minerals');
      creditResource(colony, 'metals.t1', metalsAmt, ctx.tick);
      creditResource(colony, 'minerals.t1', mineralsAmt, ctx.tick);
      if (amount !== undefined) {
        creditResource(colony, 'bio.biomass', amount, ctx.tick);
        creditResource(colony, 'bio.water', amount, ctx.tick);
      } else {
        const bioRem = remainingFamilyCap(colony, 'bio');
        const half = Math.floor(bioRem / 2);
        creditResource(colony, 'bio.biomass', half, ctx.tick);
        creditResource(colony, 'bio.water', remainingFamilyCap(colony, 'bio'), ctx.tick);
      }
    } else if (targetRes === 'metals') {
      creditResource(colony, 'metals.t1', amount ?? remainingFamilyCap(colony, 'metals'), ctx.tick);
    } else if (targetRes === 'minerals') {
      creditResource(colony, 'minerals.t1', amount ?? remainingFamilyCap(colony, 'minerals'), ctx.tick);
    } else if (targetRes === 'bio') {
      creditResource(colony, 'bio.biomass', amount ?? remainingFamilyCap(colony, 'bio'), ctx.tick);
    } else if ((RESOURCE_KEYS as readonly string[]).includes(targetRes)) {
      const resKey = targetRes as ResourceKey;
      const family = RESOURCE_FAMILY_OF[resKey];
      creditResource(colony, resKey, amount ?? remainingFamilyCap(colony, family), ctx.tick);
    } else {
      return 'invalid_args';
    }
  },
});

const time = defineCommandHandler({
  kind: 'dev.time', wave: 'W02',
  handle(s, c, ctx) {
    const args = (c.args ?? {}) as { target?: string };
    const target = args.target ?? 'day';
    const prev = s.blobs.environment?.value as Partial<EnvironmentState> | undefined;
    const prevStorm = prev?.stormActive === true;
    const targetCycleTick = cycleTickForTimeSpec(target, s.meta.planetType, ctx.data);
    const env = computeEnvironmentAtCycleTick(s.meta.planetType, targetCycleTick, ctx.data, prevStorm);
    applyEnvironmentState(s, env, ctx.tick);
    recomputeAllColonyPower(s, ctx.data, ctx.tick);
  },
});

const skipnight = defineCommandHandler({
  kind: 'dev.skipnight', wave: 'W02',
  handle(s, _c, ctx) {
    const prev = s.blobs.environment?.value as Partial<EnvironmentState> | undefined;
    const prevStorm = prev?.stormActive === true;
    const env = computeEnvironmentAtCycleTick(s.meta.planetType, 0, ctx.data, prevStorm);
    applyEnvironmentState(s, env, ctx.tick);
    recomputeAllColonyPower(s, ctx.data, ctx.tick);
  },
});

const power = defineCommandHandler({
  kind: 'dev.power', wave: 'W02',
  handle(s, c, ctx) {
    const args = (c.args ?? {}) as { colonyIndex?: number };
    const colonyIndex = args.colonyIndex ?? c.colonyIndex ?? 0;
    const summary = evaluateColonyPower(s, colonyIndex, ctx.data, ctx.tick);
    ctx.emit({ kind: 'dev.powerDump', colonyIds: [colonyIndex], data: { ...(summary as unknown as Record<string, unknown>) } });
  },
});

export default defineSimModule({
  id: 'dev',
  wave: 'W00',
  handlers: [ping, spawn, nudge, teleport, fill, time, skipnight, power],
});
