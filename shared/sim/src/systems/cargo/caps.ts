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

/** Per-colony cargo export cap state stored on `ColonyState.cargo` (aliased on `ColonyState.cargoCaps`). */
export interface ColonyCargoCapState {
  windowEntries: CargoThroughputWindowEntry[];
  utcDay: number;
  mintedToday: Partial<Record<ResourceKey, number>>;
  dailyCapOverride?: number;
  dailyCap?: number;
  currentUtcDay?: string;
}

/** Converts a `YYYY-MM-DD` string or integer day index to a non-negative integer UTC day index (days since 1970-01-01). */
export function parseCargoUtcDayInput(input?: number | string): number | undefined {
  if (typeof input === 'number') {
    return Number.isFinite(input) ? Math.max(0, Math.floor(input)) : undefined;
  }
  if (typeof input !== 'string') return undefined;
  const trimmed = input.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!m) {
    const asNum = Number(trimmed);
    return Number.isFinite(asNum) && trimmed.length > 0 ? Math.max(0, Math.floor(asNum)) : undefined;
  }
  let y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  y -= mo <= 2 ? 1 : 0;
  const era = Math.floor((y >= 0 ? y : y - 399) / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (mo + (mo > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return Math.max(0, era * 146097 + doe - 719468);
}

/** Formats a non-negative integer UTC day index (days since 1970-01-01) as `YYYY-MM-DD`. */
export function formatCargoUtcDay(dayIndex: number): string {
  const z = Math.max(0, Math.floor(dayIndex)) + 719468;
  const era = Math.floor((z >= 0 ? z : z - 146096) / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  );
  let y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  if (m <= 2) y += 1;
  const ys = String(y).padStart(4, '0');
  const ms = String(m).padStart(2, '0');
  const ds = String(d).padStart(2, '0');
  return `${ys}-${ms}-${ds}`;
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
  const override = capState?.dailyCapOverride ?? capState?.dailyCap;
  if (typeof override === 'number' && Number.isFinite(override) && override > 0) {
    return Math.floor(override);
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

function syncUtcDay(capState: ColonyCargoCapState, currentUtcDay?: number | string): void {
  const parsed = parseCargoUtcDayInput(currentUtcDay);
  if (parsed === undefined) return;
  if (parsed !== capState.utcDay) {
    capState.utcDay = parsed;
    capState.currentUtcDay =
      typeof currentUtcDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(currentUtcDay.trim())
        ? currentUtcDay.trim()
        : formatCargoUtcDay(parsed);
    capState.mintedToday = {};
  } else if (typeof currentUtcDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(currentUtcDay.trim())) {
    capState.currentUtcDay = currentUtcDay.trim();
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
 * Ensures `colony.cargo` (and `colony.cargoCaps`) is initialized as a valid `ColonyCargoCapState`.
 * If `currentUtcDay` is provided and differs from `capState.utcDay`, resets `mintedToday` and updates `utcDay`.
 */
export function ensureColonyCargoCapState(
  colony: ColonyState,
  currentUtcDay?: number | string,
): ColonyCargoCapState {
  if (colony.cargo && colony.cargoCaps && colony.cargo !== colony.cargoCaps) {
    Object.assign(colony.cargo as Record<string, unknown>, colony.cargoCaps as Record<string, unknown>);
  }
  const raw = (colony.cargo ?? colony.cargoCaps) as Record<string, unknown> | undefined;
  const parsedDay = parseCargoUtcDayInput(currentUtcDay);
  if (!raw || typeof raw !== 'object') {
    const initialDay = parsedDay ?? 0;
    const initial: ColonyCargoCapState = {
      windowEntries: [],
      utcDay: initialDay,
      currentUtcDay:
        typeof currentUtcDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(currentUtcDay.trim())
          ? currentUtcDay.trim()
          : formatCargoUtcDay(initialDay),
      mintedToday: {},
    };
    colony.cargo = initial;
    colony.cargoCaps = initial;
    return initial;
  }

  if (!Array.isArray(raw.windowEntries)) {
    raw.windowEntries = Array.isArray(raw.windowExports) ? raw.windowExports : [];
  }
  if (typeof raw.utcDay !== 'number' || !Number.isFinite(raw.utcDay)) {
    raw.utcDay =
      parsedDay ?? parseCargoUtcDayInput(raw.currentUtcDay as string | number | undefined) ?? 0;
  } else {
    raw.utcDay = Math.max(0, Math.floor(raw.utcDay));
  }
  if (typeof raw.currentUtcDay !== 'string' || raw.currentUtcDay.length === 0) {
    raw.currentUtcDay = formatCargoUtcDay(raw.utcDay as number);
  }
  if (!raw.mintedToday || typeof raw.mintedToday !== 'object') {
    raw.mintedToday =
      raw.dailyMinted && typeof raw.dailyMinted === 'object' ? raw.dailyMinted : {};
  }
  if (
    typeof raw.dailyCap === 'number' &&
    Number.isFinite(raw.dailyCap) &&
    raw.dailyCapOverride === undefined
  ) {
    raw.dailyCapOverride = raw.dailyCap;
  }

  const capState = raw as unknown as ColonyCargoCapState;
  syncUtcDay(capState, currentUtcDay);
  colony.cargo = capState;
  colony.cargoCaps = capState;
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
  currentUtcDay?: number | string,
): number {
  syncUtcDay(capState, currentUtcDay);
  const val = capState.mintedToday[resource];
  return typeof val === 'number' && Number.isFinite(val) && val > 0 ? val : 0;
}

export interface CargoMintCapCheckOptions {
  capState: ColonyCargoCapState;
  amount: number;
  resource: ResourceKey;
  currentTick?: number;
  tick?: number;
  onlineThroughputPerMin?: number;
  onlineHubThroughputPerMin?: number;
  dailyCap?: number;
  dailyCapOverride?: number;
  currentUtcDay?: number | string;
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
  const { capState, amount, resource } = opts;
  const currentTick = opts.currentTick ?? opts.tick ?? 0;
  const onlineThroughputPerMin =
    opts.onlineThroughputPerMin ?? opts.onlineHubThroughputPerMin ?? 0;
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
    opts.dailyCap ??
    opts.dailyCapOverride ??
    capState.dailyCapOverride ??
    capState.dailyCap ??
    DEFAULT_CARGO_MINT_CAP_PER_DAY;
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
  currentUtcDay?: number | string,
): void {
  pruneRollingThroughputWindow(capState, currentTick);
  syncUtcDay(capState, currentUtcDay);
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return;

  const entry: CargoThroughputWindowEntry = { tick: currentTick, amount };
  Object.defineProperty(entry, '_fromMint', { value: true, configurable: true });
  capState.windowEntries.push(entry);
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
