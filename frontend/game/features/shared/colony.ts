import type { ViewColony } from '@terra/sim';

/** The parts of the feature services that know which colony is the player's. */
export interface OwnColonySource {
  landfall?: { getOwnerColonyIndex(): number | undefined } | null;
  colonyId?: number;
}

/**
 * The player's colony index, read on every call (the session learns it after mount): an explicit override, else the
 * landfall controller's owner index (set from the boot seat), else `services.colonyId`, else 0 (FF-05).
 */
export function ownColonyIndex(services: OwnColonySource | undefined, override?: number): number {
  return override ?? services?.landfall?.getOwnerColonyIndex() ?? services?.colonyId ?? 0;
}

/** Colony `index` of a view: matched by its `index` field, else by position. */
export function viewColony(view: unknown, index: number): ViewColony | undefined {
  const colonies = (view as { colonies?: ViewColony[] } | null | undefined)?.colonies;
  if (!Array.isArray(colonies)) return undefined;
  return colonies.find((c) => c.index === index) ?? colonies[index];
}
