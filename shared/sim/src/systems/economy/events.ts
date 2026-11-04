import { RESOURCE_FAMILIES, type ResourceFamily } from '@terra/contracts';
import { dataRow } from '../../data';
import { TICK_MS } from '../../kernel/constants';
import { setBlob } from '../../kernel/state';
import { defineSystem } from '../../kernel/system';
import { ensureColonyLedger, familyStock } from './ledger';

export interface FamilyShortageTracker {
  windowStartTick: number;
  windowStartStock: number;
  lowAndNegativeTicks: number;
  lastStock: number;
  lastEmittedTick: number;
}

export type ColonyShortageTrackers = Record<ResourceFamily, FamilyShortageTracker>;

function createColonyTrackers(tick: number, stocks: Record<ResourceFamily, number>): ColonyShortageTrackers {
  return {
    metals: { windowStartTick: tick, windowStartStock: stocks.metals, lowAndNegativeTicks: 0, lastStock: stocks.metals, lastEmittedTick: -Infinity },
    minerals: { windowStartTick: tick, windowStartStock: stocks.minerals, lowAndNegativeTicks: 0, lastStock: stocks.minerals, lastEmittedTick: -Infinity },
    bio: { windowStartTick: tick, windowStartStock: stocks.bio, lowAndNegativeTicks: 0, lastStock: stocks.bio, lastEmittedTick: -Infinity },
  };
}

/**
 * Monitors colony resource families for `resourceShortage` (`colony-economy-and-buildings-spec.md` §1 rule 5):
 * Emits `resourceShortage` when a family's stock is `< 5 %` of its family cap AND has a negative net over a 60 s
 * (`300` ticks) window, debounced per family.
 */
export const resourceShortageSystem = defineSystem({
  id: 'economy.shortageEvents',
  slot: 8,
  wave: 'W02',
  run(state, ctx) {
    const dayCycle = dataRow(ctx.data, 'economyT1Basic', 'dayCycle');
    const windowTicks = Number(dayCycle.resourceShortageWindowS ?? 300); // 60 s = 300 ticks
    const capRatio = Number(dayCycle.resourceShortageCapRatio ?? 0.05);

    const prevMap = (state.blobs.economyEvents?.value as { byColony?: Record<number, ColonyShortageTrackers> } | undefined)?.byColony ?? {};
    const nextMap: Record<number, ColonyShortageTrackers> = {};

    for (const colony of state.colonies) {
      if (!colony) continue;
      const explicitColonyNet = (colony as { familyNetPerS?: Partial<Record<ResourceFamily, number>> }).familyNetPerS;
      const explicitProdNet = (colony.production as { familyNetPerS?: Partial<Record<ResourceFamily, number>> } | undefined)?.familyNetPerS;
      const c = ensureColonyLedger(colony);
      const currentStocks: Record<ResourceFamily, number> = {
        metals: familyStock(c, 'metals'),
        minerals: familyStock(c, 'minerals'),
        bio: familyStock(c, 'bio'),
      };
      const prev = prevMap[c.index] ?? createColonyTrackers(ctx.tick - ctx.dt, currentStocks);
      const trackers: ColonyShortageTrackers = {
        metals: { ...prev.metals },
        minerals: { ...prev.minerals },
        bio: { ...prev.bio },
      };

      for (const fam of RESOURCE_FAMILIES) {
        const t = trackers[fam];
        const stock = currentStocks[fam];
        const cap = Math.max(1, c.caps[fam] ?? 500);
        const threshold = cap * capRatio; // 5% of cap (25 for cap 500)
        const explicitNet = explicitColonyNet?.[fam] ?? explicitProdNet?.[fam];
        const stepDelta = stock - t.lastStock;
        const windowDelta = stock - t.windowStartStock;
        const elapsedS = Math.max(1, ((ctx.tick - t.windowStartTick) * TICK_MS) / 1000);
        const computedNetPerS = typeof explicitNet === 'number' ? explicitNet : Number((windowDelta / elapsedS).toFixed(4));

        const isBelowThreshold = stock < threshold - 1e-6;
        const isNegativeTrend = computedNetPerS < -1e-6 || stepDelta < -1e-6 || windowDelta < -1e-6;

        if (isBelowThreshold && isNegativeTrend) {
          t.lowAndNegativeTicks += ctx.dt;
        } else if (!isBelowThreshold || computedNetPerS > 1e-6) {
          t.lowAndNegativeTicks = 0;
          t.windowStartTick = ctx.tick;
          t.windowStartStock = stock;
        }

        t.lastStock = stock;

        if (t.lowAndNegativeTicks >= windowTicks && ctx.tick - t.lastEmittedTick >= windowTicks) {
          ctx.emit({
            kind: 'resourceShortage',
            severity: 'warn',
            colonyIds: [c.index],
            data: {
              family: fam,
              stock: Number(stock.toFixed(2)),
              cap,
              netPerS: computedNetPerS < 0 ? computedNetPerS : -0.1,
            },
          });
          t.lastEmittedTick = ctx.tick;
        }
      }

      nextMap[c.index] = trackers;
    }

    let shortageChanged = !state.blobs.economyEvents;
    if (!shortageChanged) {
      for (const [idxStr, nextCol] of Object.entries(nextMap)) {
        const prevCol = prevMap[Number(idxStr)];
        if (!prevCol) {
          shortageChanged = true;
          break;
        }
        for (const fam of RESOURCE_FAMILIES) {
          if (
            prevCol[fam].lowAndNegativeTicks !== nextCol[fam].lowAndNegativeTicks ||
            prevCol[fam].lastEmittedTick !== nextCol[fam].lastEmittedTick ||
            prevCol[fam].lastStock !== nextCol[fam].lastStock
          ) {
            shortageChanged = true;
            break;
          }
        }
      }
    }
    if (shortageChanged || !state.blobs.economyEvents) {
      setBlob(state, 'economyEvents', { byColony: nextMap }, ctx.tick);
    }
  },
});
