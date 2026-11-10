import {
  AutoTradeLimitsSchema,
  T1_RESOURCE_KEYS,
  type AutoTradeLimit,
  type AutoTradeLimits,
  type AutoTradePartner,
  type DirectorKeyStatusPayload,
  type T1ResourceKey,
} from '@terra/contracts';

/** Tier-1 only. T2/T3 stay out of the editor while W17/W19 are postponed. */
export const T1_TRADE_LABEL: Record<T1ResourceKey, string> = {
  'metals.t1': 'Metals T1',
  'minerals.t1': 'Minerals T1',
  'bio.water': 'Water',
  'bio.biomass': 'Biomass',
};

/** Demo step 5. The form shows these until an acked row replaces them. */
export const DEMO_AUTOTRADE: AutoTradeLimit = {
  sellAboveStoragePct: 80,
  maxPerTrade: 300,
  maxPerSession: 600,
  minStock: 200,
  partners: 'guild',
};

export interface AutoTradeRecord {
  resource: T1ResourceKey;
  limits: AutoTradeLimits;
}

export interface TradeDraft {
  resource: string;
  sellAboveStoragePct: number;
  maxPerTrade: number;
  maxPerSession: number;
  minStock: number;
  partners: string;
}

export function emptyAutoTrade(): AutoTradeRecord {
  return { resource: 'metals.t1', limits: {} };
}

export function isT1Resource(value: unknown): value is T1ResourceKey {
  return T1_RESOURCE_KEYS.some((key) => key === value);
}

/** `truce` is omitted unless W18 is on. The sim rejects that partner otherwise. */
export function autoTradePartners(w18: boolean): readonly AutoTradePartner[] {
  return w18 ? ['guild', 'truce', 'anyone'] : ['guild', 'anyone'];
}

export function tradeError(draft: TradeDraft, w18: boolean): string | null {
  if (!isT1Resource(draft.resource)) return 'resource is not tradable';
  if (
    !Number.isInteger(draft.sellAboveStoragePct) ||
    draft.sellAboveStoragePct < 0 ||
    draft.sellAboveStoragePct > 100
  ) {
    return 'sell percent must be 0–100';
  }
  if (!wholeAmount(draft.maxPerTrade) || !wholeAmount(draft.maxPerSession) || !wholeAmount(draft.minStock)) {
    return 'amounts must be whole units';
  }
  if (!autoTradePartners(w18).includes(draft.partners as AutoTradePartner)) return 'partners are unavailable';
  return null;
}

/** One Tier-1 row merged onto the last ack. T2/T3 keys are dropped, never sent. */
export function limitsForSave(prev: AutoTradeLimits, draft: TradeDraft): AutoTradeLimits {
  const next: AutoTradeLimits = {};
  for (const key of T1_RESOURCE_KEYS) {
    const row = prev[key];
    if (row) next[key] = { ...row };
  }
  next[draft.resource as T1ResourceKey] = limitFromDraft(draft);
  return next;
}

export function shownLimit(limits: AutoTradeLimits, resource: T1ResourceKey): AutoTradeLimit {
  const row = limits[resource];
  if (!row) return { ...DEMO_AUTOTRADE };
  return {
    ...DEMO_AUTOTRADE,
    ...row,
    sellAboveStoragePct: row.sellAboveStoragePct ?? DEMO_AUTOTRADE.sellAboveStoragePct,
  };
}

/** Drops a broken record and any non-Tier-1 key. */
export function normalizeAutoTradeRecord(raw: unknown): AutoTradeRecord {
  const obj = raw && typeof raw === 'object' ? (raw as { resource?: unknown; limits?: unknown }) : {};
  const resource = isT1Resource(obj.resource) ? obj.resource : 'metals.t1';
  const parsed = AutoTradeLimitsSchema.safeParse(obj.limits ?? {});
  return { resource, limits: parsed.success ? onlyT1(parsed.data) : {} };
}

/** `Revoked`, or `Allowance X · spent Y` for the selected resource. Amounts are whole units. */
export function directorAllowanceText(payload: DirectorKeyStatusPayload, resource: string): string {
  if (payload.state === 'revoked') return 'Revoked';
  if (payload.state !== 'active') return '';
  const token = payload.tokens.find((row) => row.token === resource);
  if (!token) return '';
  return `Allowance ${wholeUnits(token.allowance)} · spent ${wholeUnits(token.spent)}`;
}

function limitFromDraft(draft: TradeDraft): AutoTradeLimit {
  return {
    maxPerTrade: draft.maxPerTrade,
    maxPerSession: draft.maxPerSession,
    minStock: draft.minStock,
    partners: draft.partners as AutoTradePartner,
    sellAboveStoragePct: draft.sellAboveStoragePct,
  };
}

function onlyT1(limits: AutoTradeLimits): AutoTradeLimits {
  const next: AutoTradeLimits = {};
  for (const key of T1_RESOURCE_KEYS) {
    const row = limits[key];
    if (row) next[key] = row;
  }
  return next;
}

function wholeAmount(n: number): boolean {
  return Number.isSafeInteger(n) && n >= 0;
}

function wholeUnits(raw: string): string {
  const head = raw.split('.')[0] ?? '';
  return /^(0|[1-9]\d*)$/.test(head) ? head : '0';
}
