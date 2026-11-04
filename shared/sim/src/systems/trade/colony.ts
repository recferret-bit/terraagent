import type { CommandReject, SimCommand } from '../../kernel/commands';
import type { ColonyState, PlanetState } from '../../kernel/state';

/** Player market commands act on the commanding colony (`cmd.colonyIndex`, default 0 like cargo); `args.colonyId` must match. */
export function resolvePlayerColony(
  state: PlanetState,
  cmd: SimCommand,
  argColonyId: string | undefined,
): { colony: ColonyState; index: number } | CommandReject {
  const index = typeof cmd.colonyIndex === 'number' && Number.isInteger(cmd.colonyIndex) ? cmd.colonyIndex : 0;
  const colony = index >= 0 ? state.colonies[index] : undefined;
  const cmdPlayerId = (cmd as { playerId?: string }).playerId;
  if (
    !colony || colony.status === 'eliminated' ||
    (argColonyId && colony.id && argColonyId !== colony.id) ||
    (cmdPlayerId && colony.playerId && cmdPlayerId !== colony.playerId)
  ) {
    return { code: 'not_own_colony', detail: 'Market commands act on your own colony.' };
  }
  return { colony, index };
}

/** Module commands resolve like `cargo.settled`: `colonyIndex`, else `colonyId`, else the command's colony. */
export function resolveModuleColonyIndex(
  state: PlanetState,
  cmd: SimCommand,
  args: { colonyId?: string; colonyIndex?: number },
): number {
  if (typeof args.colonyIndex === 'number' && Number.isInteger(args.colonyIndex)) return args.colonyIndex;
  if (typeof args.colonyId === 'string' && args.colonyId.length > 0) {
    const match = state.colonies.find((c) => c && c.id === args.colonyId);
    if (match) return match.index;
  }
  if (typeof cmd.colonyIndex === 'number' && Number.isInteger(cmd.colonyIndex)) return cmd.colonyIndex;
  return -1;
}

export const colonyIdOf = (colony: ColonyState, index: number): string => colony.id || `col-${index}`;
