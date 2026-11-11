/**
 * Guild strategy (W15-13). `choose` returns route, stockpile goals, specialisation and risk.
 * There is no price field. `quoteColony` sets every price.
 */
export interface GuildStrategyNpc {
  readonly id: string;
}

/** Read by the LLM slot for the hourly gate. The deterministic choice ignores it. */
export interface GuildStrategyClock {
  readonly nowMs: number;
}

/** Whole units from the guild data row. Not a price. */
export interface GuildStockpileGoal {
  readonly resource: string;
  readonly target: number;
}

export interface GuildStrategyChoice {
  readonly route: string;
  readonly stockpile: readonly GuildStockpileGoal[];
  readonly specialisation: string;
  readonly risk: string;
}

export type GuildStrategyRejectCode = 'price' | 'free_price' | 'empty_stockpile' | 'bad_strategy';

export type GuildStrategyErrorCode = GuildStrategyRejectCode | 'w16_off' | 'unknown_npc';

export type GuildStrategyParse =
  | { readonly ok: true; readonly value: GuildStrategyChoice }
  | { readonly ok: false; readonly code: GuildStrategyRejectCode };

const CHOICE_KEYS = new Set(['route', 'stockpile', 'specialisation', 'risk']);

export class GuildStrategyError extends Error {
  readonly code: GuildStrategyErrorCode;

  constructor(code: GuildStrategyErrorCode, message: string) {
    super(message);
    this.name = 'GuildStrategyError';
    this.code = code;
  }
}

/** Nest token. `GuildModule` binds `DeterministicGuildStrategy`. */
export abstract class GuildStrategyPort {
  abstract choose(npc: GuildStrategyNpc, clock: GuildStrategyClock): Promise<GuildStrategyChoice>;
}

/** First `price` or `free_price` key anywhere in the payload, or null. */
export function findGuildPriceKey(raw: unknown): 'price' | 'free_price' | null {
  if (typeof raw !== 'object' || raw === null) return null;
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const hit = findGuildPriceKey(item);
      if (hit) return hit;
    }
    return null;
  }
  for (const [key, value] of Object.entries(raw)) {
    const name = key.toLowerCase();
    if (name === 'price' || name === 'free_price') return name;
    const nested = findGuildPriceKey(value);
    if (nested) return nested;
  }
  return null;
}

/**
 * Accepts a strategy object. Rejects `price` and `free_price` before any other check.
 * An empty or missing stockpile is `empty_stockpile`.
 */
export function parseGuildStrategy(raw: unknown): GuildStrategyParse {
  const priced = findGuildPriceKey(raw);
  if (priced) return { ok: false, code: priced };
  if (!isRecord(raw) || !allowedKeys(raw)) return { ok: false, code: 'bad_strategy' };
  const stockpile = readStockpile(raw.stockpile);
  if (stockpile === 'empty') return { ok: false, code: 'empty_stockpile' };
  if (stockpile === 'bad') return { ok: false, code: 'bad_strategy' };
  if (!isRoute(raw.route) || !isLabel(raw.specialisation) || !isLabel(raw.risk)) {
    return { ok: false, code: 'bad_strategy' };
  }
  return { ok: true, value: { route: raw.route, stockpile, specialisation: raw.specialisation, risk: raw.risk } };
}

function allowedKeys(raw: Record<string, unknown>): boolean {
  return Object.keys(raw).every((key) => CHOICE_KEYS.has(key));
}

function readStockpile(raw: unknown): readonly GuildStockpileGoal[] | 'empty' | 'bad' {
  if (raw === undefined || raw === null || (Array.isArray(raw) && raw.length === 0)) return 'empty';
  if (!Array.isArray(raw)) return 'bad';
  const goals: GuildStockpileGoal[] = [];
  for (const item of raw) {
    const goal = readGoal(item);
    if (!goal) return 'bad';
    goals.push(goal);
  }
  return goals;
}

function readGoal(raw: unknown): GuildStockpileGoal | null {
  if (!isRecord(raw)) return null;
  if (Object.keys(raw).some((key) => key !== 'resource' && key !== 'target')) return null;
  if (typeof raw.resource !== 'string' || !/^[a-z][a-z0-9.]{0,63}$/.test(raw.resource)) return null;
  if (typeof raw.target !== 'number' || !Number.isSafeInteger(raw.target) || raw.target < 0) return null;
  return { resource: raw.resource, target: raw.target };
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}

function isRoute(raw: unknown): raw is string {
  return typeof raw === 'string' && raw.length > 0 && raw.length <= 64;
}

function isLabel(raw: unknown): raw is string {
  return typeof raw === 'string' && /^[a-z][a-z0-9_-]{0,31}$/.test(raw);
}
