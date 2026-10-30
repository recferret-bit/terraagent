// Stage 5: Pillar 1 / process checks (ground contact, part count, triangle budget, emissive intensity).
import type { CheckStage } from '../context';

export const processStage: CheckStage = (ctx) => {
  const { parts: P_, n: N, o, add, minY, triCount } = ctx;
  if (o.grounded) {
    const low = P_.reduce((m, p) => (p.box[1] < m.box[1] ? p : m)).def.index;
    if (minY > 0.002) add(minY > 0.05 ? 'error' : 'warn', 'GROUND_CONTACT', `The model hovers: its lowest point is y = ${minY.toFixed(3)} (must reach 0.000).`, [low]);
    else if (minY < -o.foundationDepth) add('warn', 'GROUND_CONTACT', `The model sinks to y = ${minY.toFixed(3)}; a foundation may extend at most ${o.foundationDepth.toFixed(2)} m below ground.`, [low]);
  }
  if (N < o.minParts) add('warn', 'FEW_PARTS', `Only ${N} sub-parts (Pillar 1 asks for ≥ ${o.minParts}).`, []);
  if (triCount > o.triBudget) add('warn', 'TRI_BUDGET', `${triCount.toLocaleString('en-US')} triangles (budget ${o.triBudget.toLocaleString('en-US')}).`, []);
  for (const p of P_) {
    const z = p.def.zone;
    if ((z === 'energyCyan' || z === 'warningAmber' || z === 'dangerCrimson' || z === 'terraformEmerald') && p.def.emissive < 3)
      add('warn', 'EMISSIVE_LOW', `${p.label} is an emissive zone with intensity ${p.def.emissive.toFixed(1)}; bloom only picks up ≥ 3.0.`, [p.def.index]);
  }
};
