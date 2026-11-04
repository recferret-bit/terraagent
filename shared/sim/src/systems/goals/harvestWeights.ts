import { RESOURCE_FAMILY_OF, type ResourceKey } from '@terra/contracts';
import type { PlanetState } from '../../kernel/state';
import type { ColonyGoalEntry } from './types';

/** Active resource goals steer automatic harvesting without overwriting the player's saved weights. */
export function goalHarvestResource(state: PlanetState, colonyIndex: number): ResourceKey | null {
  const goals = state.colonies[colonyIndex]?.goals as ColonyGoalEntry[] | undefined;
  const goal = goals?.find((g) => g.status === 'active' && g.goal === 'grow_economy');
  return goal ? (goal.params.resource ?? 'metals.t1') as ResourceKey : null;
}

export function goalHarvestWeights(state: PlanetState, colonyIndex: number) {
  const resource = goalHarvestResource(state, colonyIndex);
  if (!resource) return null;
  const family = RESOURCE_FAMILY_OF[resource];
  return { metals: family === 'metals' ? 100 : 0, minerals: family === 'minerals' ? 100 : 0, bio: family === 'bio' ? 100 : 0 };
}
