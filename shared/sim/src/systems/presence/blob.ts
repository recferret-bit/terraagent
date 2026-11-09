import { setBlob, type PlanetState } from '../../kernel/state';

/** Plain blob (SIM-V-05). Keyed by colony index string. MessagePack-safe: objects, strings, booleans. */
export const PRESENCE_BLOB = 'presence';

export interface PresenceByColony {
  readonly away: boolean;
}

export interface PresenceBlobValue {
  readonly byColony: Readonly<Record<string, PresenceByColony>>;
}

export function presenceAway(state: PlanetState, index: number): boolean {
  return readByColony(state)[String(index)]?.away === true;
}

export function writePresence(state: PlanetState, index: number, away: boolean, tick: number): void {
  const byColony: Record<string, PresenceByColony> = { ...readByColony(state) };
  byColony[String(index)] = { away };
  setBlob(state, PRESENCE_BLOB, { byColony }, tick);
}

function readByColony(state: PlanetState): Record<string, PresenceByColony> {
  const value = state.blobs[PRESENCE_BLOB]?.value as Partial<PresenceBlobValue> | undefined;
  const raw = value?.byColony;
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, PresenceByColony> = {};
  for (const [key, row] of Object.entries(raw)) {
    if (row && typeof row.away === 'boolean') out[key] = { away: row.away };
  }
  return out;
}
