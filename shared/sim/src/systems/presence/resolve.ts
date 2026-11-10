import type { SimCommand } from '../../kernel/commands';
import type { PlanetState } from '../../kernel/state';
import { commandColony } from '../command';

/**
 * Colony for `system.presence`. A module command uses `cmd.colonyIndex` when the host knows it
 * (`commandColony`); otherwise the colony id selects the row, the same way module trade commands do.
 */
export function resolvePresenceIndex(state: PlanetState, cmd: SimCommand, colonyId: string): number | 'not_own_colony' {
  const indexed = commandColony(cmd);
  if (indexed !== 'not_own_colony') return colonyAt(state, indexed, colonyId);
  const match = state.colonies.find((colony) => colony?.id === colonyId);
  return match ? match.index : 'not_own_colony';
}

function colonyAt(state: PlanetState, index: number, colonyId: string): number | 'not_own_colony' {
  const colony = state.colonies[index];
  if (!colony) return 'not_own_colony';
  // A seated `co_` id may name a scenario row that still has its fixture id (BE-45). Two fixture ids must still match.
  if (colony.id && colony.id !== colonyId && !(colonyId.startsWith('co_') && !colony.id.startsWith('co_'))) return 'not_own_colony';
  return index;
}
