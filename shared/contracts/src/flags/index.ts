import { z } from 'zod';

/** A wave flag id, `W00` … `W99` (PRODUCT_WAVES §3). */
export const WaveId = z.string().regex(/^W\d{2}$/, 'expected a wave id like W07');
export type WaveId = string;

/** The highest wave of the plan (docs/plan/waves/W25-*). `all` means W00 … LAST_WAVE. */
export const LAST_WAVE = 25;

export const waveId = (n: number): WaveId => `W${String(n).padStart(2, '0')}`;

/** An immutable set of enabled waves. `W00` is always on. */
export interface FlagSet {
  has(wave: WaveId): boolean;
  readonly list: readonly WaveId[];
  /** The canonical spec string (`all`, `..07`, or `00,01,07`). */
  readonly spec: string;
}

export class FlagSpecError extends Error {}

function fromNumbers(nums: Iterable<number>): FlagSet {
  const set = new Set<number>([0, ...nums]);
  const list = [...set].sort((a, b) => a - b).map(waveId);
  const sorted = [...set].sort((a, b) => a - b);
  const contiguous = sorted.every((n, i) => n === i);
  const spec = contiguous && sorted.length === LAST_WAVE + 1 ? 'all' : contiguous ? `..${String(sorted.at(-1)).padStart(2, '0')}` : sorted.map((n) => String(n).padStart(2, '0')).join(',');
  const ids = new Set(list);
  return { has: (w) => ids.has(w), list, spec };
}

/**
 * Parses `TA_WAVES` / `?waves=` (PRODUCT_WAVES §3): `all` (default when empty), `..07` (W00–W07), or an explicit list
 * `00,01,07` (a `W` prefix is accepted: `W00,W07`). Throws `FlagSpecError` on anything else, so a typo never turns
 * waves on silently.
 */
export function parseWaves(spec: string | undefined | null): FlagSet {
  const s = (spec ?? '').trim();
  if (s === '' || s === 'all') return fromNumbers(Array.from({ length: LAST_WAVE + 1 }, (_, i) => i));
  const upTo = /^\.\.W?(\d{1,2})$/i.exec(s);
  if (upTo) {
    const n = Number(upTo[1]);
    if (n > LAST_WAVE) throw new FlagSpecError(`waves "${s}": W${n} is past the last wave W${LAST_WAVE}`);
    return fromNumbers(Array.from({ length: n + 1 }, (_, i) => i));
  }
  const parts = s.split(',').map((p) => p.trim());
  const nums = parts.map((p) => {
    const m = /^W?(\d{1,2})$/i.exec(p);
    if (!m || Number(m[1]) > LAST_WAVE) throw new FlagSpecError(`waves "${s}": "${p}" is not a wave number 00..${LAST_WAVE}`);
    return Number(m[1]);
  });
  return fromNumbers(nums);
}

/** A flag set from an explicit list of wave ids (e.g. `welcome.flags`). */
export const flagsFromList = (ids: readonly string[]): FlagSet =>
  fromNumbers(ids.filter((w) => WaveId.safeParse(w).success).map((w) => Number(w.slice(1))));
