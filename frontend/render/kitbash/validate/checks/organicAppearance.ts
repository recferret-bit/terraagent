import { labOfHex } from '../appearance';
import { triArea } from '../math';
import type { CheckStage } from '../context';

/** Organic surfaces intentionally do not inherit mechanical color-group / mounted-panel requirements. */
export const organicAppearanceStage: CheckStage = (ctx) => {
  let total = 0, lightness = 0;
  const tissues = new Set<number>();
  for (const p of ctx.parts) {
    const d = p.def, t = d.tissue ?? 0;
    tissues.add(t);
    if (t < 1 || t > 5) ctx.add('error', 'ORGANIC_TISSUE', `${p.label} has no valid anatomical surface profile.`, [d.index]);
    if ((d.metalness ?? 0) > 0.05) ctx.add('warn', 'ORGANIC_METAL', `${p.label} uses metallic tissue; chitin and soil need dielectric highlights.`, [d.index]);
    if (!Number.isFinite(d.roughness) || (d.roughness ?? 0) < 0.1 || (d.roughness ?? 1) > 1)
      ctx.add('error', 'ORGANIC_ROUGHNESS', `${p.label} has an invalid biological roughness.`, [d.index]);
    if ((d.animType === 60 || d.animType === 69) && t !== 3)
      ctx.add('error', 'ORGANIC_FLEX', `${p.label} uses a flexible sac channel on non-secretory tissue.`, [d.index]);
    let area = 0;
    for (let i = 0; i < p.n; i++) area += triArea(p.tris, i * 9);
    total += area; lightness += labOfHex(d.color ?? 0)[0] * area;
  }
  ctx.meanL = lightness / Math.max(total, 1e-8);
  if (ctx.meanL < 23) ctx.add('warn', 'ORGANIC_TOO_DARK', 'The anatomical surfaces are too dark to read; check the actual biome render.', []);
  if (tissues.size < 2) ctx.add('warn', 'ORGANIC_UNIFORM', 'Use at least two tissue responses (shell/membrane, earth/shell, or resin/soil).', []);
};
