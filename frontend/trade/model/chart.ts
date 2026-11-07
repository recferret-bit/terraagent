import type { PriceBoardRow } from '@terra/contracts';

type Candle = PriceBoardRow['candles1h'][number];

export interface ChartGeometry {
  readonly width: number;
  readonly height: number;
  readonly candles: ReadonlyArray<{ x: number; w: number; yHigh: number; yLow: number; yOpen: number; yClose: number; up: boolean; vol: number; volH: number; t: number }>;
  readonly lo: number;
  readonly hi: number;
}

/** Candle prices are quote atomic per unit (strings); only the chart *scale* is computed in Number, never money. */
export function buildChart(candles: readonly Candle[], width = 640, height = 180, volBand = 36): ChartGeometry | null {
  if (candles.length === 0) return null;
  const rows = [...candles].sort((a, b) => a.t - b.t);
  const nums = rows.map((c) => ({ o: Number(c.o), h: Number(c.h), l: Number(c.l), c: Number(c.c), v: c.v, t: c.t }));
  const lo = Math.min(...nums.map((n) => n.l));
  const hi = Math.max(...nums.map((n) => n.h));
  const span = hi - lo || Math.max(hi, 1) * 0.02;
  const plotH = height - volBand - 8;
  const y = (p: number): number => 4 + plotH - ((p - lo) / span) * plotH;
  const maxV = Math.max(...nums.map((n) => n.v), 1);
  const slot = width / rows.length;
  return {
    width, height, lo, hi,
    candles: nums.map((n, i) => ({
      x: i * slot + slot / 2, w: Math.max(2, Math.min(18, slot * 0.6)),
      yHigh: y(n.h), yLow: y(n.l), yOpen: y(n.o), yClose: y(n.c), up: n.c >= n.o,
      vol: n.v, volH: (n.v / maxV) * volBand, t: n.t,
    })),
  };
}
