// The one ground-contact rule the playground panel and the docs share (RN-18).
import { DEFAULT_OPTIONS, type ModelInput } from './ModelValidator';

export interface GroundContact {
  /** Lowest vertex of the model (m). */
  minY: number;
  /** Lowest vertex of everything that is not a `plinth` part (m). */
  bodyMinY: number;
  /** True when the model touches the ground: flush, or a building whose sunk `plinth` skirt is the only part below. */
  ok: boolean;
  /** True when the lowest point is a sunk foundation skirt (a `plinth` part, at most `foundationDepth` deep). */
  skirt: boolean;
}

const partMinY = (tris: Float32Array) => { let y = Infinity; for (let i = 1; i < tris.length; i += 3) y = Math.min(y, tris[i]!); return y; };

/**
 * Ground contact: `minY` within ±`groundTol` of 0, or a foundation skirt: only parts with role `plinth` reach below
 * −`groundTol`, no deeper than `foundationDepth` (the validator's GROUND_CONTACT limit). The plinth's own top is
 * where the rest of the building stands.
 */
export function groundContact(model: ModelInput, tol = DEFAULT_OPTIONS.groundTol, depth = DEFAULT_OPTIONS.foundationDepth): GroundContact {
  let minY = Infinity, bodyMinY = Infinity;
  for (const p of model.parts) {
    const y = partMinY(p.tris);
    minY = Math.min(minY, y);
    if (p.role !== 'plinth') bodyMinY = Math.min(bodyMinY, y);
  }
  if (!Number.isFinite(bodyMinY)) bodyMinY = minY;
  const flush = Math.abs(minY) <= tol;
  const skirt = !flush && minY >= -depth && minY < -tol && bodyMinY >= -tol;
  return { minY, bodyMinY, ok: flush || skirt, skirt };
}
