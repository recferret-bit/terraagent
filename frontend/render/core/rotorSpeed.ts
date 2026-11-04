/**
 * Wind-turbine rotor speed. The wind factor (`windFactor`, shown as "Wind HIGH 150%" in the HUD) is the power
 * output multiplier; the rotor shows it on a separate, calmer scale: the old 25 % reading is now 100 % rotor speed,
 * 50 % -> 150 %, 12 % -> 25 %. Monotone piecewise-linear, flattening above 50 % so a gale is brisk, not a blur.
 */
const CURVE: ReadonlyArray<readonly [wind: number, rotor: number]> = [
  [0, 0], [0.12, 0.25], [0.25, 1], [0.5, 1.5], [1, 2], [1.5, 2.25], [5, 3],
];

/** Rotor speed as a multiple of the reference (1 = 100 %) for a wind factor (0.25 = 25 %). */
export function rotorSpeedScale(windFactor: number): number {
  const w = Number.isFinite(windFactor) ? Math.max(0, windFactor) : 0;
  for (let i = 1; i < CURVE.length; i++) {
    const [w1, r1] = CURVE[i];
    if (w <= w1) {
      const [w0, r0] = CURVE[i - 1];
      return r0 + ((r1 - r0) * (w - w0)) / (w1 - w0);
    }
  }
  return CURVE[CURVE.length - 1][1];
}

/** Rotor angular speed at 100 % (rad/s), calm enough to read blade by blade; the pre-W05 rotor ran 12.5 rad/s * wind. */
export const ROTOR_RAD_S_AT_100 = 1.5;
/** The shader turns `time * (2.5 + 10 * work)` rad; at full work that is `12.5 * time`. */
export const SHADER_ROTOR_RAD_PER_TIME = 12.5;

/** Seconds of shader clock to add per real second so the rotor turns at the rescaled speed. */
export function rotorClockRate(windFactor: number): number {
  return (ROTOR_RAD_S_AT_100 * rotorSpeedScale(windFactor)) / SHADER_ROTOR_RAD_PER_TIME;
}
