import type { ResourceKey } from '@terra/contracts';
import type { CompiledDataLike } from '../../kernel/config';
import { TICK_MS, TICKS_PER_SECOND } from '../../kernel/constants';
import type { ColonyState, PlanetState } from '../../kernel/state';

/** Default per-colony per-sub-resource daily export mint cap (NEAR-53, W10-06). */
export const DEFAULT_CARGO_MINT_CAP_PER_DAY = 20_000;

/** Rolling throughput window length in seconds (60 s). */
export const CARGO_THROUGHPUT_WINDOW_S = 60;

/** Rolling throughput window length in sim ticks (300 ticks at 200 ms/tick). */
export const CARGO_THROUGHPUT_WINDOW_TICKS = CARGO_THROUGHPUT_WINDOW_S * TICKS_PER_SECOND;

/** Milliseconds in one UTC calendar day. */
export const UTC_DAY_MS = 86_400_000;

/** Seconds in one UTC calendar day. */
export const UTC_DAY_S = 86_400;

/** Sim ticks in one 24 h UTC day (at 5 ticks/s = 432,000 ticks). */
export const UTC_DAY_TICKS = UTC_DAY_S * TICKS_PER_SECOND;

/** Default Trade Hub export throughput (units/min) by building tier (W10-02, W10-06). */
export const TRADE_HUB_THROUGHPUT_PER_MIN: Readonly<Record<1 | 2 | 3, number>> = {
  1: 250,
  2: 900,
  3: 3500,
};

/** Returns the default Trade Hub throughput (units/min) for a given tier (1..3), or 0 for invalid tiers. */
export function getTradeHubTierThroughputPerMin(tier: number, data?: CompiledDataLike): number {
  if (tier === 1 || tier === 2 || tier === 3) {
    const tierId = tier === 3 ? 't3' : tier === 2 ? 't2' : 't1';
    const tradeHubTable = data?.tables?.tradeHub as Record<string, Record<string, unknown>> | undefined;
    const fromData = tradeHubTable?.[tierId]?.throughputPerMin;
    if (typeof fromData === 'number' && Number.isFinite(fromData) && fromData >= 0) {
      return fromData;
    }
    return TRADE_HUB_THROUGHPUT_PER_MIN[tier];
  }
  return 0;
}

/** One export entry in a colony's rolling 60 s throughput window. */
export interface CargoThroughputWindowEntry {
  tick: number;
  amount: number;
}

/** Per-colony cargo export cap state stored on `ColonyState.cargoCaps`. */
export interface ColonyCargoCapState {
  windowEntries: CargoThroughputWindowEntry[];
  utcDay: number;
  mintedToday: Partial<Record<ResourceKey, number>>;
  dailyCapOverride?: number;
}

export interface UtcDayClockInput {
  readonly serverTimeMs?: number;
  readonly wallTimeMs?: number;
  readonly dayIndex?: number;
  readonly tick?: number;
  readonly state?: PlanetState | Record<string, unknown>;
}

/**
 * Computes the integer UTC day index from `serverTimeMs` / `wallTimeMs` / `dayIndex`, falling back to
 * `state.clock?.wallTimeMs` or tick-based day when wall clock is unset.
 */
export function computeCargoUtcDay(input?: UtcDayClockInput | number): number {
  if (typeof input === 'number') {
    return Number.isFinite(input) ? Math.max(0, Math.floor(input)) : 0;
  }
  if (!input || typeof input !== 'object') return 0;

  if (typeof input.dayIndex === 'number' && Number.isFinite(input.dayIndex)) {
    return Math.max(0, Math.floor(input.dayIndex));
  }

  const stateObj = input.state as Record<string, unknown> | undefined;
  const clockObj = (stateObj?.clock ?? (stateObj?.blobs as Record<string, unknown> | undefined)?.clock) as
    | Record<string, unknown>
    | undefined;
  const wallMs =
    input.serverTimeMs ??
    input.wallTimeMs ??
    (typeof clockObj?.wallTimeMs === 'number' ? clockObj.wallTimeMs : undefined) ??
    (typeof (clockObj?.value as Record<string, unknown> | undefined)?.wallTimeMs === 'number'
      ? ((clockObj?.value as Record<string, unknown>).wallTimeMs as number)
      : undefined);

  if (typeof wallMs === 'number' && Number.isFinite(wallMs) && wallMs > 0) {
    return Math.max(0, Math.floor(wallMs / UTC_DAY_MS));
  }

  const metaObj = stateObj?.meta as Record<string, unknown> | undefined;
  const tick = input.tick ?? (typeof metaObj?.tick === 'number' ? metaObj.tick : 0);
  if (typeof tick === 'number' && Number.isFinite(tick) && tick > 0) {
    return Math.max(0, Math.floor((tick * TICK_MS) / UTC_DAY_MS));
  }
  return 0;
}

/** Computes the remaining seconds until the next UTC midnight from wall clock or tick. */
export function computeSecondsUntilUtcMidnight(input?: UtcDayClockInput): number {
  if (input && typeof input === 'object') {
    const stateObj = input.state as Record<string, unknown> | undefined;
    const clockObj = (stateObj?.clock ?? (stateObj?.blobs as Record<string, unknown> | undefined)?.clock) as
      | Record<string, unknown>
      | undefined;
    const wallMs =
      input.serverTimeMs ??
      input.wallTimeMs ??
      (typeof clockObj?.wallTimeMs === 'number' ? clockObj.wallTimeMs : undefined);

    if (typeof wallMs === 'number' && Number.isFinite(wallMs) && wallMs > 0) {
      const elapsedInDayMs = Math.floor(wallMs) % UTC_DAY_MS;
      const remMs = UTC_DAY_MS - elapsedInDayMs;
      return Math.max(1, Math.ceil(remMs / 1000));
    }

    const metaObj = stateObj?.meta as Record<string, unknown> | undefined;
    const tick = input.tick ?? (typeof metaObj?.tick === 'number' ? metaObj.tick : undefined);
    if (typeof tick === 'number' && Number.isFinite(tick) && tick >= 0) {
      const tickInDay = Math.floor(tick) % UTC_DAY_TICKS;
      const remTicks = UTC_DAY_TICKS - tickInDay;
      return Math.max(1, Math.ceil(remTicks / TICKS_PER_SECOND));
    }
  }
  return UTC_DAY_S;
}

/** Resolves the effective daily per-resource mint cap from state override, compiled data, or default (`20_000`). */
export function resolveDailyCargoMintCap(
  data?: CompiledDataLike,
  capState?: ColonyCargoCapState,
): number {
  if (
    typeof capState?.dailyCapOverride === 'number' &&
    Number.isFinite(capState.dailyCapOverride) &&
    capState.dailyCapOverride > 0
  ) {
    return Math.floor(capState.dailyCapOverride);
  }
  const tradeHubTable = data?.tables?.tradeHub as Record<string, Record<string, unknown>> | undefined;
  const capsRow = tradeHubTable?.caps;
  const fromData =
    capsRow?.dailyMintCapPerResource ?? capsRow?.dailyMintCap ?? capsRow?.mintCapPerDay;
  if (typeof fromData === 'number' && Number.isFinite(fromData) && fromData > 0) {
    return Math.floor(fromData);
  }
  return DEFAULT_CARGO_MINT_CAP_PER_DAY;
}

function syncUtcDay(capState: ColonyCargoCapState, currentUtcDay?: number): void {
  if (currentUtcDay === undefined || !Number.isFinite(currentUtcDay)) return;
  const normalizedDay = Math.max(0, Math.floor(currentUtcDay));
  if (normalizedDay !== capState.utcDay) {
    capState.utcDay = normalizedDay;
    capState.mintedToday = {};
  }
}

/** Prunes entries in `capState.windowEntries` where `tick <= currentTick - CARGO_THROUGHPUT_WINDOW_TICKS`. */
export function pruneRollingThroughputWindow(
  capState: ColonyCargoCapState,
  currentTick: number,
): void {
  const cutoffTick = currentTick - CARGO_THROUGHPUT_WINDOW_TICKS;
  const entries = capState.windowEntries;
  let writeIdx = 0;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (
      entry &&
      typeof entry.tick === 'number' &&
      typeof entry.amount === 'number' &&
      entry.amount > 0 &&
      entry.tick > cutoffTick
    ) {
      entries[writeIdx++] = entry;
    }
  }
  entries.length = writeIdx;
}

/**
 * Ensures `colony.cargoCaps` is initialized as a valid `ColonyCargoCapState`.
 * If `currentUtcDay` is provided and differs from `capState.utcDay`, resets `mintedToday` and updates `utcDay`.
 */
export function ensureColonyCargoCapState(
  colony: ColonyState,
  currentUtcDay?: number,
): ColonyCargoCapState {
  const raw = colony.cargoCaps as Partial<ColonyCargoCapState> | undefined;
  if (!raw || typeof raw !== 'object') {
    const initial: ColonyCargoCapState = {
      windowEntries: [],
      utcDay:
        currentUtcDay !== undefined && Number.isFinite(currentUtcDay)
          ? Math.max(0, Math.floor(currentUtcDay))
          : 0,
      mintedToday: {},
    };
    colony.cargoCaps = initial;
    return initial;
  }

  if (!Array.isArray(raw.windowEntries)) {
    raw.windowEntries = [];
  }
  if (typeof raw.utcDay !== 'number' || !Number.isFinite(raw.utcDay)) {
    raw.utcDay =
      currentUtcDay !== undefined && Number.isFinite(currentUtcDay)
        ? Math.max(0, Math.floor(currentUtcDay))
        : 0;
  } else {
    raw.utcDay = Math.max(0, Math.floor(raw.utcDay));
  }
  if (!raw.mintedToday || typeof raw.mintedToday !== 'object') {
    raw.mintedToday = {};
  }

  const capState = raw as ColonyCargoCapState;
  syncUtcDay(capState, currentUtcDay);
  return capState;
}

/** Prunes expired entries and returns the rolling 60 s export amount used at `currentTick`. */
export function getRollingThroughputUsed(
  capState: ColonyCargoCapState,
  currentTick: number,
): number {
  pruneRollingThroughputWindow(capState, currentTick);
  let sum = 0;
  for (const entry of capState.windowEntries) {
    sum += entry.amount;
  }
  return sum;
}

/** Syncs `utcDay` if provided and returns the units of `resource` minted today by the colony. */
export function getMintedToday(
  capState: ColonyCargoCapState,
  resource: ResourceKey,
  currentUtcDay?: number,
): number {
  syncUtcDay(capState, currentUtcDay);
  const val = capState.mintedToday[resource];
  return typeof val === 'number' && Number.isFinite(val) && val > 0 ? val : 0;
}

export interface CargoMintCapCheckOptions {
  capState: ColonyCargoCapState;
  amount: number;
  resource: ResourceKey;
  currentTick: number;
  onlineThroughputPerMin: number;
  dailyCap?: number;
  currentUtcDay?: number;
  secondsUntilUtcMidnight?: number;
}

export type CargoMintCapCheckResult =
  | { ok: true }
  | {
      ok: false;
      code: 'mint_cap';
      reason: 'throughput' | 'daily';
      retryInS: number;
      detail: string;
    };

/**
 * Checks whether exporting `amount` of `resource` at `currentTick` fits within:
 * 1. The colony's rolling 60 s (`300` ticks) online Trade Hub throughput (`onlineThroughputPerMin`).
 * 2. The colony's per-sub-resource UTC-day cap (`dailyCap`, default `20_000`).
 */
export function checkCargoMintCaps(opts: CargoMintCapCheckOptions): CargoMintCapCheckResult {
  const { capState, amount, resource, currentTick, onlineThroughputPerMin } = opts;
  const used = getRollingThroughputUsed(capState, currentTick);

  if (used + amount > onlineThroughputPerMin) {
    let remainingUsed = used;
    let targetTick = currentTick + CARGO_THROUGHPUT_WINDOW_TICKS;
    const sorted = [...capState.windowEntries].sort((a, b) => a.tick - b.tick);
    for (const entry of sorted) {
      remainingUsed -= entry.amount;
      targetTick = entry.tick + CARGO_THROUGHPUT_WINDOW_TICKS;
      if (remainingUsed + amount <= onlineThroughputPerMin) {
        break;
      }
    }
    const retryInS = Math.max(1, Math.ceil((targetTick - currentTick) / TICKS_PER_SECOND));
    return {
      ok: false,
      code: 'mint_cap',
      reason: 'throughput',
      retryInS,
      detail: `Throughput cap reached (${used}/${onlineThroughputPerMin}/min). Retry in ${retryInS}s.`,
    };
  }

  const dailyCap =
    opts.dailyCap ?? capState.dailyCapOverride ?? DEFAULT_CARGO_MINT_CAP_PER_DAY;
  const mintedToday = getMintedToday(capState, resource, opts.currentUtcDay);

  if (mintedToday + amount > dailyCap) {
    const retryInS = Math.max(1, Math.ceil(opts.secondsUntilUtcMidnight ?? UTC_DAY_S));
    return {
      ok: false,
      code: 'mint_cap',
      reason: 'daily',
      retryInS,
      detail: `Daily export cap reached (${mintedToday}/${dailyCap} ${resource}). Retry in ${retryInS}s.`,
    };
  }

  return { ok: true };
}

/** Records a newly accepted cargo export into the rolling 60 s window and the UTC-day counter. */
export function recordCargoMint(
  capState: ColonyCargoCapState,
  amount: number,
  resource: ResourceKey,
  currentTick: number,
  currentUtcDay?: number,
): void {
  pruneRollingThroughputWindow(capState, currentTick);
  syncUtcDay(capState, currentUtcDay);
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return;

  capState.windowEntries.push({ tick: currentTick, amount });
  capState.mintedToday[resource] = (capState.mintedToday[resource] ?? 0) + amount;
}

/** Clears both the rolling 60 s throughput window and the UTC-day minted counters (used by `cargo.cap.reset`, W10-26). */
export function resetColonyCargoCaps(target: ColonyCargoCapState | ColonyState): void {
  if ('windowEntries' in target && Array.isArray(target.windowEntries)) {
    target.windowEntries.length = 0;
    target.mintedToday = {};
    return;
  }
  const capState = ensureColonyCargoCapState(target as ColonyState);
  capState.windowEntries.length = 0;
  capState.mintedToday = {};
}
