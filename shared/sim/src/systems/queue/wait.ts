import type { ResourceKey } from '@terra/contracts';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { rowOf } from '../../ecs/store';
import { DEPOSIT } from '../../grid/layers';
import { indexOf } from '../../grid/hex';
import type { ColonyState, PlanetState } from '../../kernel/state';
import { normalizeRichness } from '../production';
import type { QueueEntry } from './types';

export const RESOURCE_DISPLAY_LABELS: Readonly<Record<ResourceKey, string>> = {
  'metals.t1': 'Metals',
  'minerals.t1': 'Minerals',
  'bio.biomass': 'Biomass',
  'bio.water': 'Water',
  'metals.t2': 'Alloys',
  'minerals.t2': 'Crystals',
  'bio.t2': 'Nutrients',
  'metals.t3': 'Composites',
  'minerals.t3': 'Metamaterials',
  'bio.t3': 'Biopolymers',
};

function depositCodeToResourceKey(dep: number): ResourceKey | null {
  if (dep === DEPOSIT.metals) return 'metals.t1';
  if (dep === DEPOSIT.minerals) return 'minerals.t1';
  if (dep === DEPOSIT.organics) return 'bio.biomass';
  return null;
}

/**
 * Estimates current colony income per second (`amount/s`) for a given `ResourceKey`.
 * Uses explicit `colony.incomePerS` / `colony.production.incomePerS` if present,
 * otherwise sums active extractors (`1.0 * richness`/s) and harvesters (`0.5`/s).
 */
export function estimateResourceIncomePerS(
  state: PlanetState,
  colony: ColonyState,
  key: ResourceKey,
): number {
  const explicitColony = (colony as { incomePerS?: Partial<Record<ResourceKey, number>> }).incomePerS?.[key];
  if (typeof explicitColony === 'number' && explicitColony > 0) {
    return explicitColony;
  }
  const explicitProd = (
    colony.production as { incomePerS?: Partial<Record<ResourceKey, number>> } | undefined
  )?.incomePerS?.[key];
  if (typeof explicitProd === 'number' && explicitProd > 0) {
    return explicitProd;
  }

  let rate = 0;
  let idleOrMovingHarvesters = 0;
  const { count, cols } = state.entities;
  for (let r = 0; r < count; r++) {
    if (cols.owner[r] !== colony.index) continue;
    const kind = cols.kind[r];
    const st = cols.state[r];
    if (kind === ENTITY_KIND.metalsExtractor && st === ENTITY_STATE.active && key === 'metals.t1') {
      const tileIdx = indexOf(state.grid.radius, cols.q[r], cols.r[r]);
      const rawRich = tileIdx >= 0 ? state.grid.layers.richness[tileIdx] : 10000;
      rate += 1.0 * normalizeRichness(rawRich || 10000);
    } else if (kind === ENTITY_KIND.harvester) {
      if (st === ENTITY_STATE.harvesting) {
        const tileIdx = indexOf(state.grid.radius, cols.q[r], cols.r[r]);
        const dep = tileIdx >= 0 ? state.grid.layers.deposit[tileIdx] : DEPOSIT.none;
        const depKey = depositCodeToResourceKey(dep);
        if (depKey === key || dep === DEPOSIT.none) {
          rate += 0.5;
        }
      } else if (st === ENTITY_STATE.idle || st === ENTITY_STATE.moving) {
        idleOrMovingHarvesters++;
      }
    }
  }

  if (rate === 0 && idleOrMovingHarvesters > 0 && (key === 'metals.t1' || key === 'minerals.t1' || key === 'bio.biomass')) {
    rate = 0.5 * idleOrMovingHarvesters;
  }
  return rate;
}

export function computeResourceWaitState(
  state: PlanetState,
  colony: ColonyState,
  cost: Partial<Record<ResourceKey, number>>,
  missing: Partial<Record<ResourceKey, number>>,
): { etaSeconds: number | null; waitDetail: string } {
  const keys = Object.keys(missing) as ResourceKey[];
  if (keys.length === 0) {
    return { etaSeconds: 0, waitDetail: 'waiting: resources' };
  }

  let maxEta: number | null = 0;
  let bottleneckKey: ResourceKey = keys[0];
  let bottleneckEta = -1;

  for (const k of keys) {
    const missAmt = missing[k] ?? 0;
    if (missAmt <= 0) continue;
    const income = estimateResourceIncomePerS(state, colony, k);
    if (income <= 0) {
      maxEta = null;
      if (bottleneckEta < Number.POSITIVE_INFINITY) {
        bottleneckEta = Number.POSITIVE_INFINITY;
        bottleneckKey = k;
      }
    } else {
      const kEta = Math.ceil(missAmt / income);
      if (maxEta !== null && kEta > maxEta) {
        maxEta = kEta;
      }
      if (kEta > bottleneckEta) {
        bottleneckEta = kEta;
        bottleneckKey = k;
      }
    }
  }

  const label = RESOURCE_DISPLAY_LABELS[bottleneckKey] ?? bottleneckKey;
  const haveAmt = Math.floor(colony.stock?.[bottleneckKey] ?? 0);
  const needAmt = cost[bottleneckKey] ?? 0;
  const waitDetail =
    maxEta !== null
      ? `waiting: ${label} ${haveAmt}/${needAmt} · ~${maxEta} s`
      : `waiting: ${label} ${haveAmt}/${needAmt} (no ETA)`;

  return { etaSeconds: maxEta, waitDetail };
}

export function isBlockedByPower(state: PlanetState, colony: ColonyState, entry: QueueEntry): boolean {
  const taskAny = entry.task as { requiresPower?: boolean; producerId?: number };
  if (taskAny.requiresPower && (colony.power?.status === 'brownout' || (colony.power?.net ?? 0) < 0)) {
    return true;
  }
  if (entry.task.kind === 'buildUnit' && typeof entry.task.producerId === 'number') {
    const pRow = rowOf(state.entities, entry.task.producerId);
    if (pRow >= 0 && state.entities.cols.state[pRow] === ENTITY_STATE.offlineBrownout) {
      return true;
    }
  }
  return false;
}
