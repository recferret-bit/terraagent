import { TICK_MS } from '@terra/sim';

/** One sim tick in seconds (`TICK_MS` is 200). Remaining time is `max(0, untilTick - tick)` times this. */
export const EFFECT_TICK_SECONDS = TICK_MS / 1000;

const HOUR_S = 3600;

/** HUD countdowns. `guild_subsidy` is a council effect but not a badge. */
const HUD_KINDS = ['meteor_shield', 'terraform_boost'] as const;

export type HudEffectKind = (typeof HUD_KINDS)[number];

const LABELS: Record<HudEffectKind, string> = {
  meteor_shield: 'SHIELD',
  terraform_boost: 'BOOST',
};

export interface EffectBadge {
  kind: HudEffectKind;
  label: string;
  /** Exact `max(0, untilTick - tick) * EFFECT_TICK_SECONDS`. Never the effect's `magnitudeBp`. */
  remainingSeconds: number;
  /** `m:ss` under an hour, `h:mm` from one hour. */
  timer: string;
}

export interface EffectBadgeQuery {
  tick: number;
  /** View blob (`blobs.treasury`) or the raw sim wrapper (`{ value }`). */
  treasury: unknown;
  /** Client wave flags. Off → no badges, even when the blob is set. */
  w22: boolean;
}

/** Active shield and boost countdowns. An effect is live only while `tick < untilTick` (the sim's rule). */
export function effectBadges(query: EffectBadgeQuery): EffectBadge[] {
  if (!query.w22 || !Number.isFinite(query.tick)) return [];
  const effects = effectsOf(query.treasury);
  if (!effects) return [];
  const out: EffectBadge[] = [];
  for (const kind of HUD_KINDS) {
    const badge = badgeOf(kind, query.tick, effects[kind]);
    if (badge) out.push(badge);
  }
  return out;
}

/** Clock face for `remainingSeconds`. A partial last second shows `0:01`, not `0:00`. */
export function formatEffectTimer(seconds: number): string {
  const whole = displaySeconds(seconds);
  if (whole >= HOUR_S) {
    const h = Math.floor(whole / HOUR_S);
    const m = Math.floor((whole % HOUR_S) / 60);
    return `${h}:${pad2(m)}`;
  }
  return `${Math.floor(whole / 60)}:${pad2(whole % 60)}`;
}

function badgeOf(kind: HudEffectKind, tick: number, row: unknown): EffectBadge | null {
  const until = untilTickOf(row);
  if (until === null || !(tick < until)) return null;
  const remainingSeconds = Math.max(0, until - tick) * EFFECT_TICK_SECONDS;
  if (!(remainingSeconds > 0)) return null;
  return { kind, label: LABELS[kind], remainingSeconds, timer: formatEffectTimer(remainingSeconds) };
}

/** `magnitudeBp` must be present (a sim row) and is ignored for the clock. */
function untilTickOf(row: unknown): number | null {
  if (!row || typeof row !== 'object') return null;
  const rec = row as { untilTick?: unknown; magnitudeBp?: unknown };
  if (typeof rec.magnitudeBp !== 'number' || !Number.isFinite(rec.magnitudeBp)) return null;
  if (typeof rec.untilTick !== 'number' || !Number.isFinite(rec.untilTick)) return null;
  return rec.untilTick;
}

function effectsOf(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as { value?: unknown; effects?: unknown };
  const value = obj.value && typeof obj.value === 'object' ? (obj.value as { effects?: unknown }) : obj;
  const effects = value.effects;
  if (!effects || typeof effects !== 'object') return null;
  return effects as Record<string, unknown>;
}

function displaySeconds(seconds: number): number {
  if (!(seconds > 0)) return 0;
  const whole = Math.floor(seconds + 1e-9);
  return whole > 0 ? whole : 1;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
