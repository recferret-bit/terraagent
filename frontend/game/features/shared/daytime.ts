import { readColonyPower } from './power';

/** The planet's local time of day as the HUD shows it (the sim's solar clock, `systems/environment`). */
export interface DaytimeView {
  phase: 'day' | 'night';
  /** `06:27` */
  clockText: string;
  /** Sunlight 0..1 (solar output follows it). */
  daylight: number;
}

/**
 * Colony `colonyIndex`'s time of day in a view: the power summary carries the environment's phase / clock / daylight
 * (`ColonyPowerSummary`), else `blobs.environment`; null before either arrives.
 */
export function readDaytime(view: unknown, colonyIndex: number): DaytimeView | null {
  const blobs = ((view ?? {}) as { blobs?: Record<string, unknown> }).blobs ?? {};
  const power = readColonyPower(view, colonyIndex);
  const env = (blobs.environment ?? {}) as Record<string, unknown>;
  const pick = (key: string): unknown => power?.[key] ?? env[key];
  const clock = pick('clockText');
  if (typeof clock !== 'string') return null;
  const phase = pick('phase') === 'night' ? 'night' : 'day';
  const d = pick('daylight');
  const daylight = typeof d === 'number' && Number.isFinite(d) ? Math.max(0, Math.min(1, d)) : phase === 'night' ? 0 : 1;
  return { phase, clockText: clock, daylight };
}
