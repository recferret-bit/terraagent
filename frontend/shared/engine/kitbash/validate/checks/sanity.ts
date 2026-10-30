// Stage 0: data sanity (NaN vertices, degenerate triangles).
import { triArea } from '../math';
import { at, type CheckStage } from '../context';

export const sanityStage: CheckStage = (ctx) => {
  const { parts: P_, add } = ctx;
  for (const p of P_) {
    let bad = 0, deg = 0;
    for (let i = 0; i < p.tris.length; i++) if (!Number.isFinite(p.tris[i])) { bad++; break; }
    for (let i = 0; i < p.n; i++) if (triArea(p.tris, i * 9) < 1e-9) deg++;
    if (bad) add('error', 'NAN_VERTEX', `${p.label} has NaN/Infinity vertices (usually a zero-length strut or a bad scale).`, [p.def.index]);
    else if (deg > Math.max(2, p.n * 0.05)) add('info', 'DEGENERATE_TRIS', `${p.label} has ${deg} zero-area triangles of ${p.n}.`, [p.def.index], at(p.box), 'Remove the collapsed segment/cap (e.g. a cylinder with a zero radius end, or a strut whose two points coincide).');
  }
};
