import { setBlob, type PlanetState } from '../../kernel/state';

/** Faction stored on a mercenary contract. Units are not a colony, so this is not an entity column. */
export const MERCENARY_FACTION = 'mercenary';

/**
 * Owner column for a hired recon. `-1` is fauna / nobody; `-2` is the mercenary faction so a squad is
 * hostile to fauna but not a colony. Supply sums `owner === colonyIndex` only, so the poster pays nothing.
 */
export const MERCENARY_OWNER = -2;

export const MERCENARY_BLOB = 'mercenary';

export type MercenaryLeave = 'ended' | 'wiped';

export interface MercenaryContract {
  id: string;
  poster: number;
  rosterId: string;
  faction: typeof MERCENARY_FACTION;
  q: number;
  r: number;
  radius: number;
  endTick: number;
  entityIds: number[];
  left?: MercenaryLeave;
}

export interface MercenaryBlobValue {
  contracts: MercenaryContract[];
}

export function readMercenary(state: PlanetState): MercenaryBlobValue {
  const raw = state.blobs[MERCENARY_BLOB]?.value;
  if (!raw || typeof raw !== 'object') return { contracts: [] };
  const list = (raw as { contracts?: unknown }).contracts;
  if (!Array.isArray(list)) return { contracts: [] };
  return { contracts: list.map(readContract).filter((row): row is MercenaryContract => row !== null) };
}

export function writeMercenary(state: PlanetState, value: MercenaryBlobValue, tick: number): void {
  setBlob(state, MERCENARY_BLOB, value, tick);
}

/** Poster colony a living contract allies this entity to, or null. */
export function mercenaryAllyOf(state: PlanetState, entityId: number): number | null {
  for (const contract of readMercenary(state).contracts) {
    if (contract.left || contract.faction !== MERCENARY_FACTION) continue;
    if (contract.entityIds.includes(entityId)) return contract.poster;
  }
  return null;
}

export function mercenaryAlliedTo(state: PlanetState, entityId: number, colony: number): boolean {
  return mercenaryAllyOf(state, entityId) === colony;
}

/** Mercenaries do not shoot their poster, that poster's units, or each other. */
export function mercenariesKeepPeace(
  state: PlanetState,
  attackerId: number,
  attackerOwner: number,
  targetId: number,
  targetOwner: number,
): boolean {
  const allyA = mercenaryAllyOf(state, attackerId);
  const allyB = mercenaryAllyOf(state, targetId);
  if (allyA !== null && (allyA === targetOwner || allyA === allyB)) return true;
  if (allyB !== null && allyB === attackerOwner) return true;
  return false;
}

function readContract(raw: unknown): MercenaryContract | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== 'string' || row.faction !== MERCENARY_FACTION) return null;
  if (typeof row.poster !== 'number' || typeof row.rosterId !== 'string') return null;
  if (typeof row.q !== 'number' || typeof row.r !== 'number' || typeof row.radius !== 'number') return null;
  if (typeof row.endTick !== 'number' || !Array.isArray(row.entityIds)) return null;
  const entityIds = row.entityIds.filter((id): id is number => typeof id === 'number');
  const left = row.left === 'ended' || row.left === 'wiped' ? row.left : undefined;
  return {
    id: row.id,
    poster: row.poster,
    rosterId: row.rosterId,
    faction: MERCENARY_FACTION,
    q: row.q,
    r: row.r,
    radius: row.radius,
    endTick: row.endTick,
    entityIds,
    ...(left ? { left } : {}),
  };
}
