import type { AlertFold, AttackFold, LossFold, PlanetEventLike } from './types';

export type DigestSignal =
  | { readonly type: 'away'; readonly planetId: string; readonly colonyId: string }
  | { readonly type: 'back'; readonly colonyId: string }
  | { readonly type: 'attack'; readonly colonyId: string; readonly attack: AttackFold }
  | { readonly type: 'loss'; readonly colonyId: string; readonly loss: LossFold }
  | { readonly type: 'alert'; readonly colonyId: string; readonly alert: AlertFold }
  | { readonly type: 'ignore' };

const ATTACKS = new Set(['raidStarted', 'underAttack', 'raidRepelled']);
const LOSSES = new Set(['buildingDestroyed', 'unitDestroyed']);
const ALERTS = new Set(['colonyCritical', 'colonyEliminated']);
const CAUSES = new Set(['fauna', 'raid', 'lightning', 'meteor', 'other']);

export function digestSignal(event: PlanetEventLike): DigestSignal {
  const colonyId = colonyIdOf(event);
  if (!colonyId) return { type: 'ignore' };
  if (event.kind === 'colonyAway') return { type: 'away', planetId: event.planetId, colonyId };
  if (event.kind === 'colonyBack') return { type: 'back', colonyId };
  if (ATTACKS.has(event.kind)) return { type: 'attack', colonyId, attack: attackOf(event) };
  if (LOSSES.has(event.kind)) return { type: 'loss', colonyId, loss: lossOf(event) };
  if (ALERTS.has(event.kind)) return { type: 'alert', colonyId, alert: alertOf(event) };
  return { type: 'ignore' };
}

function colonyIdOf(event: PlanetEventLike): string | null {
  const data = (event.data && typeof event.data === 'object' ? event.data : {}) as {
    colonyId?: unknown;
    targetColonyId?: unknown;
    attackerColonyId?: unknown;
    killerColonyId?: unknown;
  };
  if (ATTACKS.has(event.kind) && typeof data.targetColonyId === 'string' && data.targetColonyId.length > 0) {
    return data.targetColonyId;
  }
  if (typeof data.colonyId === 'string' && data.colonyId.length > 0) return data.colonyId;
  const excluded = new Set<string>();
  if (ATTACKS.has(event.kind) && typeof data.attackerColonyId === 'string' && data.attackerColonyId.length > 0) {
    excluded.add(data.attackerColonyId);
  }
  if (event.kind === 'colonyEliminated' && typeof data.killerColonyId === 'string' && data.killerColonyId.length > 0) {
    excluded.add(data.killerColonyId);
  }
  return event.colonyIds.find((id) => id.length > 0 && !excluded.has(id)) ?? null;
}

function attackOf(event: PlanetEventLike): AttackFold {
  const data = (event.data ?? {}) as {
    species?: unknown;
    attackerName?: unknown;
    byColony?: unknown;
    attackerColonyId?: unknown;
    attackerColony?: unknown;
    targetColonyId?: unknown;
    targetColony?: unknown;
    raidId?: unknown;
    q?: unknown;
    r?: unknown;
  };
  const pvp =
    data.attackerName !== undefined ||
    data.byColony !== undefined ||
    data.attackerColonyId !== undefined ||
    data.attackerColony !== undefined ||
    data.targetColonyId !== undefined ||
    data.targetColony !== undefined;
  return {
    kind: event.kind as AttackFold['kind'],
    tick: event.tick,
    ...(typeof data.species === 'string' ? { species: data.species } : {}),
    ...(typeof data.attackerName === 'string' ? { attackerName: data.attackerName } : {}),
    ...(typeof data.byColony === 'string' ? { byColony: data.byColony } : {}),
    ...(typeof data.attackerColonyId === 'string' ? { attackerColonyId: data.attackerColonyId } : {}),
    ...(pvp ? { pvp: true } : {}),
    ...(typeof data.q === 'number' ? { q: data.q } : {}),
    ...(typeof data.r === 'number' ? { r: data.r } : {}),
  };
}

function lossOf(event: PlanetEventLike): LossFold {
  const data = (event.data ?? {}) as {
    building?: unknown;
    kind?: unknown;
    tier?: unknown;
    count?: unknown;
    cause?: unknown;
    pvp?: unknown;
    attackerColonyId?: unknown;
    attackerId?: unknown;
  };
  const buildingRaw = typeof data.building === 'string' ? data.building : typeof data.kind === 'string' ? data.kind : '';
  const buildingKind = buildingRaw.trim().slice(0, 64) || 'building';
  const tier = typeof data.tier === 'number' && Number.isInteger(data.tier) && data.tier >= 0 && data.tier <= 10 ? data.tier : 1;
  const count = typeof data.count === 'number' && Number.isInteger(data.count) && data.count > 0 ? data.count : 1;
  const cause: LossFold['cause'] =
    typeof data.cause === 'string' && CAUSES.has(data.cause)
      ? (data.cause as LossFold['cause'])
      : data.pvp === true || data.attackerColonyId !== undefined || data.attackerId !== undefined
        ? 'raid'
        : 'other';
  return { kind: event.kind as LossFold['kind'], tick: event.tick, buildingKind, tier, count, cause };
}

function alertOf(event: PlanetEventLike): AlertFold {
  const data = (event.data ?? {}) as { cause?: unknown };
  return {
    kind: event.kind as AlertFold['kind'],
    tick: event.tick,
    ...(typeof data.cause === 'string' && data.cause.length > 0 ? { cause: data.cause } : {}),
  };
}
