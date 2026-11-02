/**
 * Deterministic replacements for engine-dependent `Math` functions (SIM-D-06). `Math.atan2`, `sin`, `exp`, … are not
 * required to be correctly rounded, so two JS engines may disagree in the last bit; the sim lint bans them. These use
 * only + − × ÷ (exactly rounded in IEEE 754), so every host computes the same bits.
 */

const HALF_PI = Math.PI / 2;

/** atan(a) for a in [0, 1]: odd minimax polynomial, max error ≈ 1e-5 rad. */
function atanUnit(a: number): number {
  const s = a * a;
  return a * (0.999866 + s * (-0.3302995 + s * (0.180141 + s * (-0.085133 + s * 0.0208351))));
}

/** Angle of the vector (x, y) in radians, (−π, π], like `Math.atan2(y, x)` (error ≈ 1e-5 rad); 0 for (0, 0). */
export function atan2Det(y: number, x: number): number {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  if (ax === 0 && ay === 0) return 0;
  let r = ay <= ax ? atanUnit(ay / ax) : HALF_PI - atanUnit(ax / ay);
  if (x < 0) r = Math.PI - r;
  return y < 0 ? -r : r;
}
