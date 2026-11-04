/**
 * Fixed-point sub-unit arithmetic of the colony ledger (LED-16). `col.stock` holds whole units only; the fraction a
 * rate, a 50 % refund or a progressive payment leaves lives in `col.residual[key]` as an integer count of
 * {@link RESIDUAL_SCALE}ths of a unit. A resource's exact value in micro-units is `stock * SCALE + residual`; every
 * change adds a signed integer to it, and the new state is its floor division: `stock = floor(value / SCALE)`,
 * `residual = value mod SCALE` (`0 <= residual < SCALE`). No floats are stored, so nothing accumulates dust.
 */
export const RESIDUAL_SCALE = 1_000_000;

/** An amount in units as integer micro-units: round half away from zero (the one rounding rule of every host). */
export function toMicro(amount: number): number {
  if (!Number.isFinite(amount)) return amount > 0 ? Number.POSITIVE_INFINITY : 0;
  const m = Math.round(Math.abs(amount) * RESIDUAL_SCALE);
  return amount < 0 ? -m : m;
}

/** Micro-units as a number of units (exact to 6 decimals; only for results and display, never stored). */
export function fromMicro(micro: number): number {
  return micro / RESIDUAL_SCALE;
}

/** The exact value of a resource in micro-units. */
export function valueMicro(stock: number, residual: number): number {
  return stock * RESIDUAL_SCALE + residual;
}

export interface WholeAndResidual {
  readonly stock: number;
  readonly residual: number;
}

/** Splits a non-negative value in micro-units into whole units and residual. */
export function splitMicro(value: number): WholeAndResidual {
  const stock = Math.floor(value / RESIDUAL_SCALE);
  return { stock, residual: value - stock * RESIDUAL_SCALE };
}

/**
 * A legacy fractional balance (a save from before whole-unit stock) as whole units plus residual: `12.75` becomes
 * `{ stock: 12, residual: 750_000 }`. Value-preserving to the micro-unit (dust below it, e.g. `0.30000000000000004`,
 * rounds away).
 */
export function splitLegacyAmount(amount: number): WholeAndResidual {
  return splitMicro(Math.max(0, toMicro(amount)));
}
