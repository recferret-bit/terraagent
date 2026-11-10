import { AWAY_FAMILIES, defaultAwaySettings, isMercenarySpend, isSessionPct, type AwaySettings } from './model';

/** Last acked away settings. A reload shows these before any snapshot echo. */
export const AWAY_STORAGE_KEY = 'ta.away.autopilot';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function browserStore(): Store | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Reads `ta.away.autopilot`. A missing or broken record is the sim default (raids off, session 60). */
export function loadAwaySettings(storage: Store | null = browserStore()): AwaySettings {
  const base = defaultAwaySettings();
  if (!storage) return base;
  try {
    const raw = storage.getItem(AWAY_STORAGE_KEY);
    if (!raw) return base;
    return normalize(JSON.parse(raw) as Partial<AwaySettings>, base);
  } catch {
    return base;
  }
}

/** Writes only after the server acks. A throw (quota, private mode) leaves the panel's memory as-is. */
export function saveAwaySettings(settings: AwaySettings, storage: Store | null = browserStore()): void {
  try {
    storage?.setItem(AWAY_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // The panel still shows the ack; the next reload falls back to the previous record or the defaults.
  }
}

function normalize(raw: Partial<AwaySettings>, base: AwaySettings): AwaySettings {
  const mode = raw.mode === 'rules_only' || raw.mode === 'director' ? raw.mode : base.mode;
  const awayRaids = typeof raw.awayRaids === 'boolean' ? raw.awayRaids : base.awayRaids;
  const hireMercenaries = typeof raw.hireMercenaries === 'boolean' ? raw.hireMercenaries : base.hireMercenaries;
  const spend = raw.mercenaryMaxSpend;
  const mercenaryMaxSpend = typeof spend === 'number' && isMercenarySpend(spend) ? spend : base.mercenaryMaxSpend;
  const session = { ...base.session };
  for (const family of AWAY_FAMILIES) {
    const pct = raw.session?.[family];
    if (typeof pct === 'number' && isSessionPct(pct)) session[family] = pct;
  }
  return { mode, awayRaids, hireMercenaries, mercenaryMaxSpend, session };
}
