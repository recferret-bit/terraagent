import type { AttackFold, PlanetEventLike } from './types';

export type DigestSignal =
  | { readonly type: 'away'; readonly planetId: string; readonly colonyId: string }
  | { readonly type: 'back'; readonly colonyId: string }
  | { readonly type: 'attack'; readonly colonyId: string; readonly attack: AttackFold }
  | { readonly type: 'ignore' };

const ATTACKS = new Set(['raidStarted', 'underAttack', 'raidRepelled']);

export function digestSignal(event: PlanetEventLike): DigestSignal {
  const colonyId = colonyIdOf(event);
  if (!colonyId) return { type: 'ignore' };
  if (event.kind === 'colonyAway') return { type: 'away', planetId: event.planetId, colonyId };
  if (event.kind === 'colonyBack') return { type: 'back', colonyId };
  if (!ATTACKS.has(event.kind)) return { type: 'ignore' };
  return { type: 'attack', colonyId, attack: attackOf(event) };
}

function colonyIdOf(event: PlanetEventLike): string | null {
  const data = event.data;
  if (data && typeof data === 'object' && 'colonyId' in data) {
    const id = (data as { colonyId?: unknown }).colonyId;
    if (typeof id === 'string' && id.length > 0) return id;
  }
  return event.colonyIds.find((id) => id.length > 0) ?? null;
}

function attackOf(event: PlanetEventLike): AttackFold {
  const data = (event.data ?? {}) as { species?: unknown; q?: unknown; r?: unknown };
  return {
    kind: event.kind as AttackFold['kind'],
    tick: event.tick,
    ...(typeof data.species === 'string' ? { species: data.species } : {}),
    ...(typeof data.q === 'number' ? { q: data.q } : {}),
    ...(typeof data.r === 'number' ? { r: data.r } : {}),
  };
}
