import type { RejectCode } from '@terra/contracts';
import type { CompiledRow } from '../../data';
import { ENTITY_KIND, ENTITY_STATE } from '../../ecs/columns';
import { hexDistance, hexIndex } from '../../grid/hex';
import { isTileExplored } from '../../grid/tileModel';
import type { CompiledDataLike } from '../../kernel/config';
import { TICKS_PER_SECOND } from '../../kernel/constants';
import type { PlanetState } from '../../kernel/state';
import {
  getActiveTrucesForColony,
  getLastHostilityTick,
  hasActiveTruce,
  isColonyOathbreaker,
  isValidTruceDurationHours,
  readDiplomacyBlob,
} from './store';

function getTruceRow(data?: CompiledDataLike): CompiledRow | undefined {
  const table = data?.tables?.diplomacy as Record<string, CompiledRow | undefined> | undefined;
  return table?.truce;
}

export function hostilityCooldownTicks(data?: CompiledDataLike): number {
  const row = getTruceRow(data);
  const compiled = Number(row?.hostilityWindowS);
  if (Number.isFinite(compiled) && compiled > 0) return Math.round(compiled);
  return 600 * TICKS_PER_SECOND;
}

export function offerExpiryTicks(data?: CompiledDataLike): number {
  const row = getTruceRow(data);
  const compiled = Number(row?.offerExpiryS);
  if (Number.isFinite(compiled) && compiled > 0) return Math.round(compiled);
  return 600 * TICKS_PER_SECOND;
}

export function cancelNoticeTicks(data?: CompiledDataLike): number {
  const row = getTruceRow(data);
  const compiled = Number(row?.noticeS);
  if (Number.isFinite(compiled) && compiled > 0) return Math.round(compiled);
  return 600 * TICKS_PER_SECOND;
}

export function oathbreakerDurationTicks(data?: CompiledDataLike): number {
  const row = getTruceRow(data);
  const compiled = Number(row?.oathbreakerS);
  if (Number.isFinite(compiled) && compiled > 0) return Math.round(compiled);
  return 24 * 3600 * TICKS_PER_SECOND;
}

export function maxTruceHoursForHqTier(tier: number, data?: CompiledDataLike): number {
  const map = getTruceRow(data)?.maxHoursByHqTier as Record<string, number> | undefined;
  const key = tier >= 3 ? '3' : tier === 2 ? '2' : '1';
  const fromData = Number(map?.[key]);
  if (Number.isFinite(fromData) && fromData > 0) return fromData;
  return tier >= 2 ? 72 : 24;
}

export function maxActiveTrucesForHqTier(tier: number, data?: CompiledDataLike): number {
  const map = getTruceRow(data)?.activeCapsByHqTier as Record<string, number> | undefined;
  const key = tier >= 3 ? '3' : tier === 2 ? '2' : '1';
  const fromData = Number(map?.[key]);
  if (Number.isFinite(fromData) && fromData > 0) return fromData;
  if (tier >= 3) return 4;
  if (tier === 2) return 2;
  return 1;
}

export function getColonyHqRowAndTier(
  state: PlanetState,
  colonyIndex: number,
): { alive: boolean; row: number; tier: 1 | 2 | 3 } {
  const cols = state.entities.cols;
  const col = state.colonies.find((c) => c && c.index === colonyIndex) ?? state.colonies[colonyIndex];
  const explicitTier = typeof col?.hqTier === 'number' && col.hqTier >= 1 ? Math.min(3, Math.trunc(col.hqTier)) as 1 | 2 | 3 : undefined;
  const explicitDown = col?.hqDown === true || col?.hqAlive === false;

  for (let r = 0; r < state.entities.count; r++) {
    if (cols.owner[r] !== colonyIndex || cols.kind[r] !== ENTITY_KIND.hq) continue;
    if (cols.hp[r] <= 0 || cols.state[r] === ENTITY_STATE.inert || cols.state[r] === ENTITY_STATE.descending) {
      continue;
    }
    const rawTier = explicitTier ?? (cols.tier[r] >= 1 ? Math.min(3, Math.trunc(cols.tier[r])) : 1);
    return { alive: !explicitDown, row: r, tier: (rawTier as 1 | 2 | 3) || 1 };
  }

  return { alive: false, row: -1, tier: explicitTier ?? 1 };
}

/**
 * Checks whether `fromColony` has established first contact with `toColony` (`UO-DIP-01`):
 * - False when explicitly marked no-contact (`setColonyNoContact` or `colony.noContact === true` or `colony.neighborContact === false`).
 * - True when explicitly marked in contact (`markColonyContact`, `colony.neighborContact === true`, `colony.contactFake === true`, `colony.contacts`).
 * - True when `fromColony` has explored any tile owned by `toColony` or containing an alive entity of `toColony`,
 *   or when any alive entities of `fromColony` and `toColony` are within 14 hexes of each other.
 */
export function hasFirstContact(
  state: PlanetState,
  fromColony: number,
  toColony: number,
): boolean {
  if (fromColony < 0 || toColony < 0 || fromColony === toColony) return false;
  const blob = readDiplomacyBlob(state);
  if (blob.noContactByColony[fromColony]?.includes(toColony)) return false;

  const colA = state.colonies.find((c) => c && c.index === fromColony) ?? state.colonies[fromColony];
  const colB = state.colonies.find((c) => c && c.index === toColony) ?? state.colonies[toColony];
  if (colA?.noContact === true || colA?.neighborContact === false) return false;

  if (blob.contactsByColony[fromColony]?.includes(toColony)) return true;
  if (colA?.neighborContact === true || colA?.contactFake === true) return true;
  if (Array.isArray(colA?.contacts)) {
    const contacts = colA.contacts as unknown[];
    if (contacts.includes(toColony) || (colB?.id && contacts.includes(colB.id))) return true;
  }

  const grid = state.grid;
  const ownerLayer = grid.layers.owner;
  for (let i = 0; i < grid.count; i++) {
    if (ownerLayer[i] === toColony && isTileExplored(grid, i, fromColony)) {
      return true;
    }
  }

  const idx = hexIndex(grid.radius);
  const cols = state.entities.cols;
  const count = state.entities.count;
  const fromRows: number[] = [];
  const toRows: number[] = [];
  for (let r = 0; r < count; r++) {
    if (cols.hp[r] <= 0 || cols.state[r] === ENTITY_STATE.inert) continue;
    if (cols.owner[r] === fromColony) fromRows.push(r);
    else if (cols.owner[r] === toColony) {
      toRows.push(r);
      const tIdx = idx.indexOf(cols.q[r], cols.r[r]);
      if (tIdx >= 0 && isTileExplored(grid, tIdx, fromColony)) return true;
    }
  }

  for (const ar of fromRows) {
    for (const br of toRows) {
      if (hexDistance(cols.q[ar], cols.r[ar], cols.q[br], cols.r[br]) <= 14) {
        return true;
      }
    }
  }

  return false;
}

export type TruceValidationResult =
  | { ok: true; fromHqTier: 1 | 2 | 3; toHqTier: 1 | 2 | 3 }
  | { ok: false; code: RejectCode; detail: string };

/**
 * Validates `diplomacy.proposeTruce` requirements (`UO-DIP-01`, `UO-DIP-02`, `W18-11`, `W18-12`):
 * 1. Valid distinct non-eliminated colonies.
 * 2. Both HQs alive (`hp > 0`).
 * 3. Proposer not marked Oathbreaker (`oathbreaker`).
 * 4. No hostility between the pair in the last 10 min (`recent_hostility`).
 * 5. First contact established (`no_contact`).
 * 6. No active or notice truce already between the pair (`truce_active`).
 * 7. Duration in `{2, 6, 24, 72}` and within proposer's HQ tier cap (`tier_locked`).
 * 8. Both colonies below their HQ tier's active truce cap (`truce_cap`).
 */
export function validateTruceProposal(
  state: PlanetState,
  fromColony: number,
  toColony: number,
  durationHours: number,
  tick: number = state.meta.tick,
  data?: CompiledDataLike,
): TruceValidationResult {
  if (fromColony < 0 || toColony < 0 || fromColony === toColony) {
    return { ok: false, code: 'invalid_args', detail: 'invalid target colony' };
  }
  if (!isValidTruceDurationHours(durationHours)) {
    return { ok: false, code: 'invalid_args', detail: 'invalid truce duration' };
  }

  const colA = state.colonies.find((c) => c && c.index === fromColony) ?? state.colonies[fromColony];
  const colB = state.colonies.find((c) => c && c.index === toColony) ?? state.colonies[toColony];
  if (colA?.status === 'eliminated' || colB?.status === 'eliminated') {
    return { ok: false, code: 'invalid_args', detail: 'colony eliminated' };
  }

  const fromHq = getColonyHqRowAndTier(state, fromColony);
  const toHq = getColonyHqRowAndTier(state, toColony);
  if (!fromHq.alive || !toHq.alive) {
    return { ok: false, code: 'invalid_args', detail: 'both HQs must be alive' };
  }

  if (isColonyOathbreaker(state, fromColony, tick)) {
    return { ok: false, code: 'oathbreaker', detail: 'proposer is marked Oathbreaker' };
  }

  const lastHostility = getLastHostilityTick(state, fromColony, toColony);
  if (lastHostility !== undefined && tick - lastHostility < hostilityCooldownTicks(data)) {
    return { ok: false, code: 'recent_hostility', detail: 'hostility within the last 10 minutes' };
  }

  if (!hasFirstContact(state, fromColony, toColony)) {
    return { ok: false, code: 'no_contact', detail: 'first contact required' };
  }

  if (hasActiveTruce(state, fromColony, toColony, tick)) {
    return { ok: false, code: 'truce_active', detail: 'truce already active' };
  }

  const maxHours = maxTruceHoursForHqTier(fromHq.tier, data);
  if (durationHours > maxHours) {
    return { ok: false, code: 'tier_locked', detail: `HQ T${fromHq.tier} max truce duration is ${maxHours}h` };
  }

  const fromActive = getActiveTrucesForColony(state, fromColony, tick).filter((t) => t.status === 'active').length;
  const fromCap = maxActiveTrucesForHqTier(fromHq.tier, data);
  if (fromActive >= fromCap) {
    return { ok: false, code: 'truce_cap', detail: `HQ T${fromHq.tier} active truce cap (${fromCap}) reached` };
  }

  const toActive = getActiveTrucesForColony(state, toColony, tick).filter((t) => t.status === 'active').length;
  const toCap = maxActiveTrucesForHqTier(toHq.tier, data);
  if (toActive >= toCap) {
    return { ok: false, code: 'truce_cap', detail: `target HQ T${toHq.tier} active truce cap (${toCap}) reached` };
  }

  return { ok: true, fromHqTier: fromHq.tier, toHqTier: toHq.tier };
}
