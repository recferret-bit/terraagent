import { rowOf, setField } from '../../ecs/store';
import { defineCommandHandler, type SimCommand } from '../../kernel/commands';
import { setBlob, type PlanetState } from '../../kernel/state';
import { applyDamage } from '../combat/damage';
import { commandColony } from '../command';
import { ensureColonyLedger } from '../economy/ledger';
import { recomputeAllColonyPower, resetThermalTracking } from '../power-core';

function ensureDevColony(state: PlanetState, colonyIndex: number, tick: number) {
  let colony = state.colonies.find((c) => c && c.index === colonyIndex);
  if (!colony) {
    colony = {
      index: colonyIndex,
      id: `col-${colonyIndex}`,
      name: `Colony ${colonyIndex + 1}`,
      color: 0x3a7bd5,
      status: 'active',
      changedAt: tick,
    };
    state.colonies[colonyIndex] = colony;
  }
  return ensureColonyLedger(colony);
}

const resolveTargetColony = (cmd: SimCommand, explicitColony?: number): number | 'not_own_colony' => {
  if (typeof explicitColony === 'number' && Number.isInteger(explicitColony) && explicitColony >= 0) {
    return explicitColony;
  }
  const fromCmd = commandColony(cmd);
  return typeof fromCmd === 'number' ? fromCmd : 0;
};

export const devSetWind = defineCommandHandler({
  kind: 'dev.setwind',
  wave: 'W03',
  handle(s, c, ctx) {
    const args = (c.args ?? {}) as { pct?: number; factor?: number; colonyIndex?: number };
    const rawPct = typeof args.pct === 'number' ? args.pct : typeof args.factor === 'number' ? args.factor * 100 : NaN;
    if (!Number.isFinite(rawPct) || rawPct < 0 || rawPct > 500) return 'invalid_args';

    const colIdx = resolveTargetColony(c, args.colonyIndex);
    if (typeof colIdx === 'string') return colIdx;
    const colony = ensureDevColony(s, colIdx, ctx.tick);
    const factor = Number((rawPct / 100).toFixed(4));
    const factorBp = Math.round(rawPct * 100);

    (colony as { windFactor?: number; windFactorOverride?: number; windFactorBp?: number }).windFactor = factor;
    (colony as { windFactor?: number; windFactorOverride?: number; windFactorBp?: number }).windFactorOverride = factor;
    (colony as { windFactor?: number; windFactorOverride?: number; windFactorBp?: number }).windFactorBp = factorBp;
    colony.changedAt = ctx.tick;

    setBlob(s, 'wind', { factor, factorBp, pct: rawPct, override: true }, ctx.tick);
    recomputeAllColonyPower(s, ctx.data, ctx.tick);
  },
});

export const devDrainFuel = defineCommandHandler({
  kind: 'dev.drainfuel',
  wave: 'W03',
  handle(s, c, ctx) {
    const args = (c.args ?? {}) as { colonyIndex?: number };
    const colIdx = resolveTargetColony(c, args.colonyIndex);
    if (typeof colIdx === 'string') return colIdx;
    const colony = ensureDevColony(s, colIdx, ctx.tick);

    colony.stock['bio.biomass'] = 0;
    colony.changedAt = ctx.tick;
    resetThermalTracking();
    recomputeAllColonyPower(s, ctx.data, ctx.tick);
  },
});

export const devAddLoad = defineCommandHandler({
  kind: 'dev.addload',
  wave: 'W03',
  handle(s, c, ctx) {
    const raw = (c.args ?? (c as { data?: unknown }).data ?? {}) as Record<string, unknown>;
    const args = raw as {
      loadPerS?: number;
      ePerS?: number;
      amount?: number;
      entityId?: number;
      pylonId?: number;
      colonyIndex?: number;
    };
    const loadPerS = Number(args.loadPerS ?? args.ePerS ?? args.amount);
    if (!Number.isFinite(loadPerS) || loadPerS < 0) return 'invalid_args';

    const colIdx = resolveTargetColony(c, args.colonyIndex);
    if (typeof colIdx === 'string') return colIdx;
    const colony = ensureDevColony(s, colIdx, ctx.tick);
    const targetEntityId = args.entityId ?? args.pylonId;

    const colExt = colony as {
      syntheticLoadPerS?: number;
      extraLoadPerS?: number;
      syntheticLoadEntityId?: number;
      syntheticLoadPylonId?: number;
    };
    colExt.syntheticLoadPerS = loadPerS;
    colExt.extraLoadPerS = loadPerS;
    if (typeof targetEntityId === 'number') {
      colExt.syntheticLoadEntityId = targetEntityId;
      colExt.syntheticLoadPylonId = targetEntityId;
    } else {
      delete colExt.syntheticLoadEntityId;
      delete colExt.syntheticLoadPylonId;
    }
    colony.changedAt = ctx.tick;
    recomputeAllColonyPower(s, ctx.data, ctx.tick, 0, ctx);
  },
});

export const devDamage = defineCommandHandler({
  kind: 'dev.damage',
  wave: 'W03',
  handle(s, c, ctx) {
    const args = (c.args ?? {}) as { entityId?: number; id?: number; pct?: number; colonyIndex?: number };
    const targetId = Number(args.entityId ?? args.id);
    const pct = Number(args.pct);
    if (!Number.isInteger(targetId) || targetId <= 0 || !Number.isFinite(pct) || pct < 0 || pct > 100) {
      return 'invalid_args';
    }

    const row = rowOf(s.entities, targetId);
    if (row < 0) return 'unknown_entity';

    const callerColony = commandColony(c);
    const owner = s.entities.cols.owner[row];
    if (typeof callerColony === 'number' && owner >= 0 && owner !== callerColony) {
      return 'not_own_colony';
    }

    const hpMax = s.entities.cols.hpMax[row] || s.entities.cols.hp[row] || 100;
    const curHp = s.entities.cols.hp[row];
    const dmg = pct >= 100 ? Math.max(curHp, hpMax) : (hpMax * pct) / 100;
    if (ctx.flags?.has('W07')) {
      applyDamage(s, targetId, dmg, { tick: ctx.tick, ctx, data: ctx.data });
      recomputeAllColonyPower(s, ctx.data, ctx.tick);
      return;
    }
    const nextHp = pct >= 100 ? 0 : Math.max(1, Math.round((curHp - dmg) * 100) / 100);
    setField(s.entities, row, 'hp', nextHp, ctx.tick);
    recomputeAllColonyPower(s, ctx.data, ctx.tick);
  },
});
