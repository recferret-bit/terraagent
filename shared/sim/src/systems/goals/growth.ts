import { RESOURCE_FAMILY_OF, type ResourceKey } from '@terra/contracts';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import type { CompiledDataLike } from '../../kernel/config';
import type { PlanetState } from '../../kernel/state';
import { getColonyPower } from '../power-core';
import { familyStock, ensureColonyLedger } from '../economy/ledger';
import { resolveBuildingRow } from '../economy/buildingRows';
import { getColonyQueue, type QueueTaskPayload } from '../queue';
import { findExtractorSiteForGoal, findGeneratorSiteForGoal } from './sites';

interface GrowthPlan { task?: QueueTaskPayload; detail: string }

/** Plan real available work; an optional, unavailable storage upgrade must never swallow production work. */
export function planGrowth(
  state: PlanetState, colonyIndex: number, resource: ResourceKey, tick: number, data?: CompiledDataLike,
): GrowthPlan {
  const colony = ensureColonyLedger(state.colonies[colonyIndex]);
  const family = RESOURCE_FAMILY_OF[resource];
  const full = familyStock(colony, family) >= colony.caps[family];
  if (full && resolveBuildingRow('depot', data)) {
    const site = findGeneratorSiteForGoal(state, colonyIndex, data, 'depot');
    if (site) return { task: { kind: 'build', building: 'depot', ...site }, detail: 'Building storage.' };
  }
  const queue = getColonyQueue(state, colonyIndex, 'construction');
  const hasSolarOrder = queue.some((e) => e.task.kind === 'build' && e.task.building === 'solar' && e.state !== 'done' && e.state !== 'cancelled');
  const power = getColonyPower(state, colonyIndex, data);
  if (power.brownout && power.phase !== 'night' && !hasSolarOrder) {
    const site = findGeneratorSiteForGoal(state, colonyIndex, data, 'solar');
    if (site) return { task: { kind: 'build', building: 'solar', ...site }, detail: 'Adding power for production.' };
  }
  if (resource === 'metals.t1') {
    const site = findExtractorSiteForGoal(state, colonyIndex, data);
    if (site) return { task: { kind: 'build', building: 'metalsExtractor', ...site }, detail: 'Building a metals extractor.' };
  }
  const { count, cols } = state.entities;
  let hasHub = false;
  let workers = 0;
  for (let row = 0; row < count; row++) {
    if (cols.owner[row] !== colonyIndex || cols.hp[row] <= 0) continue;
    if (cols.kind[row] === ENTITY_KIND.worker) workers++;
    if (cols.kind[row] === ENTITY_KIND.commandHub && cols.state[row] === ENTITY_STATE.active) hasHub = true;
  }
  // Give a newly built worker time to walk to its target; do not fill supply with idle workers each tick.
  const lastWorker = getColonyQueue(state, colonyIndex, 'units').filter((e) => e.task.kind === 'buildUnit').at(-1);
  if (hasHub && !full && (workers === 0 || (lastWorker && tick - lastWorker.createdAt > 300))) {
    return { task: { kind: 'buildUnit', unit: 'worker', count: 1 }, detail: 'Building a Worker Drone T1 for the target resource.' };
  }
  return { detail: full ? 'Storage full: spend resources to resume production; storage expansion needs W03.'
    : !hasHub ? 'Build the Command Hub first (Establish Colony).'
    : power.phase === 'night' && power.brownout ? 'Waiting for daylight / night power.'
    : 'Waiting for workers or a free, reachable deposit. Check harvest priorities and clear nearby ground.' };
}
