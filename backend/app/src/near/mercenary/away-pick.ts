import { hexIndex, type PlanetState } from '@terra/sim';
import { colonyIsAway } from '@terra/sim/systems/away/gate';
import { chargeAwaySpend } from '@terra/sim/systems/away/session';
import { readAwaySettings } from '@terra/sim/systems/away/store';
import { findColonyHqRow } from '@terra/sim/systems/find';
import { quoteHire, type HireQuote } from './hire-math.js';
import { mercenaryRoster } from './roster.js';

const RAID_KINDS = new Set(['raidStarted', 'underAttack']);
const AWAY_HOURS = 1;

export interface AwayRaid {
  readonly colonyId: string;
  readonly colonyIndex: number;
  readonly q: number;
  readonly r: number;
}

export interface AwaySquad {
  readonly rosterId: string;
  readonly hours: number;
  readonly total: number;
  readonly resource: string;
}

/** `raidStarted` or `underAttack`. A missing colony index is colony 0 (the console raid target). */
export function raidTarget(event: { kind: string; colonyIds?: readonly string[]; data?: unknown }): AwayRaid | null {
  if (!RAID_KINDS.has(event.kind)) return null;
  const data = record(event.data);
  const colonyId = text(data.colonyId) ?? event.colonyIds?.find((id) => id.length > 0) ?? null;
  if (!colonyId) return null;
  if (typeof data.q !== 'number' || typeof data.r !== 'number' || !Number.isInteger(data.q) || !Number.isInteger(data.r)) return null;
  const colonyIndex = typeof data.colonyIndex === 'number' && Number.isInteger(data.colonyIndex) && data.colonyIndex >= 0
    ? data.colonyIndex
    : 0;
  return { colonyId, colonyIndex, q: data.q, r: data.r };
}

/**
 * Shortest 1 h squad whose price fits `maxSpend`. Light (100) beats reserve (same price and count)
 * and heavy (200). Nothing fits a max under 100.
 */
export function pickAwaySquad(flags: { has(wave: string): boolean }, maxSpend: number): AwaySquad | null {
  if (!Number.isInteger(maxSpend) || maxSpend < 1) return null;
  const quotes = mercenaryRoster(flags)
    .map((row) => quoteHire(flags, row.id, AWAY_HOURS))
    .filter((quote): quote is HireQuote => quote !== null && quote.total <= maxSpend);
  quotes.sort(byShortest);
  const best = quotes[0];
  if (!best) return null;
  return { rosterId: best.rosterId, hours: best.hours, total: best.total, resource: best.resource };
}

/** Raid tile when the colony owns it, else the HQ, else the first owned tile. Null when nothing is owned. */
export function defendTile(state: PlanetState, colonyIndex: number, q: number, r: number): { q: number; r: number } | null {
  if (ownerAt(state, q, r) === colonyIndex) return { q, r };
  const hq = hqAt(state, colonyIndex);
  if (hq && ownerAt(state, hq.q, hq.r) === colonyIndex) return hq;
  return firstOwned(state, colonyIndex);
}

/**
 * AW-20: defense does not use the session percent. A closed session still allows the spend when
 * presence says away (the ledger is not open in live play). A present colony does not.
 */
export function defenseBudgetFits(state: PlanetState, colonyIndex: number, amount: number, tick: number): boolean {
  if (!Number.isInteger(amount) || amount < 0) return false;
  if (!colonyIsAway(state, colonyIndex)) return false;
  const settings = readAwaySettings(state, colonyIndex);
  if (!settings?.session.open) return true;
  return chargeAwaySpend(state, colonyIndex, 'metals', amount, 'defense', tick, () => undefined).allowed;
}

export function mercenaryDigestLine(rosterId: string, total: number, resource: string): string {
  return `Hired ${rosterId} squad for ${total} ${resource}`;
}

function byShortest(a: HireQuote, b: HireQuote): number {
  return a.count - b.count || a.total - b.total || (a.rosterId < b.rosterId ? -1 : a.rosterId > b.rosterId ? 1 : 0);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function ownerAt(state: PlanetState, q: number, r: number): number {
  const tile = hexIndex(state.grid.radius).indexOf(q, r);
  if (tile < 0) return -1;
  return state.grid.layers.owner?.[tile] ?? -1;
}

function hqAt(state: PlanetState, colonyIndex: number): { q: number; r: number } | null {
  const row = findColonyHqRow(state, colonyIndex);
  if (row < 0) return null;
  return { q: state.entities.cols.q[row] ?? 0, r: state.entities.cols.r[row] ?? 0 };
}

function firstOwned(state: PlanetState, colonyIndex: number): { q: number; r: number } | null {
  const owner = state.grid.layers.owner;
  if (!owner) return null;
  const hex = hexIndex(state.grid.radius);
  for (let tile = 0; tile < hex.count && tile < owner.length; tile++) {
    if (owner[tile] === colonyIndex) return { q: hex.q[tile] ?? 0, r: hex.r[tile] ?? 0 };
  }
  return null;
}
