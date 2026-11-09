import { parseWaves } from '@terra/contracts';
import { compileData, dataRow, type CompiledRow } from '@terra/sim';

/** A granted director attempt. `requestId` identifies that one in-flight plan. */
export type ReserveGrant = { ok: true; requestId: string };

/** Interval, in-flight, or daily cap blocked the attempt. The day count is unchanged. */
export type ReserveDeny = { ok: false; outcome: 'rate_limited' };

export type ReserveResult = ReserveGrant | ReserveDeny;

interface Cadence {
  normalIntervalMs: number;
  criticalIntervalMs: number;
  colonyRequestsPerDay: number;
}

interface ColonySlot {
  inFlight: boolean;
  /** `nowMs` of the last grant. `release` has no clock, so spacing uses this. */
  grantedAtMs: number | null;
  day: string;
  used: number;
}

const rateLimited = (): ReserveDeny => ({ ok: false, outcome: 'rate_limited' });

/**
 * Per-colony director attempt budget. One in-flight plan, then a critical or normal gap,
 * and at most `director.cadence.colonyRequestsPerDay` grants per UTC day.
 */
export class ColonyBudget {
  private readonly colonies = new Map<string, ColonySlot>();
  private seq = 0;

  reserve(colonyId: string, nowMs: number, critical: boolean): ReserveResult {
    const limits = readCadence();
    const slot = this.slotFor(colonyId, nowMs);
    if (slot.inFlight || !intervalOpen(slot, nowMs, critical, limits)) return rateLimited();
    if (slot.used >= limits.colonyRequestsPerDay) return rateLimited();
    slot.inFlight = true;
    slot.grantedAtMs = nowMs;
    slot.used += 1;
    this.seq += 1;
    return { ok: true, requestId: `req_${this.seq}` };
  }

  /** Drops the in-flight flag only. The daily grant count stays spent. */
  release(colonyId: string): void {
    const slot = this.colonies.get(colonyId);
    if (slot) slot.inFlight = false;
  }

  private slotFor(colonyId: string, nowMs: number): ColonySlot {
    const day = utcDay(nowMs);
    const existing = this.colonies.get(colonyId);
    if (!existing) {
      const created: ColonySlot = { inFlight: false, grantedAtMs: null, day, used: 0 };
      this.colonies.set(colonyId, created);
      return created;
    }
    if (existing.day !== day) {
      existing.day = day;
      existing.used = 0;
    }
    return existing;
  }
}

/** Gap is from the last grant. Critical may reuse the shorter cadence; normal may not. */
function intervalOpen(slot: ColonySlot, nowMs: number, critical: boolean, limits: Cadence): boolean {
  if (slot.grantedAtMs === null) return true;
  const waitMs = critical ? limits.criticalIntervalMs : limits.normalIntervalMs;
  return nowMs - slot.grantedAtMs >= waitMs;
}

/** Design seconds from `director.cadence` (the table does not tick-convert these fields). */
function readCadence(): Cadence {
  const row = dataRow(compileData(parseWaves('..16')), 'director', 'cadence');
  return {
    normalIntervalMs: numberField(row, 'normalIntervalS') * 1000,
    criticalIntervalMs: numberField(row, 'criticalIntervalS') * 1000,
    colonyRequestsPerDay: numberField(row, 'colonyRequestsPerDay'),
  };
}

function numberField(row: CompiledRow, field: string): number {
  const value = row[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`director.cadence.${field} is not a number`);
  }
  return value;
}

function utcDay(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}
