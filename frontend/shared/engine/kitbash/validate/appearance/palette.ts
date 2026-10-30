// Palette balance for the whole model: material hierarchy, accent share and overall lightness. Returns the mean lightness (L*).
import type { AppearanceContext } from './context';

export function checkPalette(ctx: AppearanceContext): number {
  const { S, o, add, total } = ctx;
  const zoneArea = new Map<string, number>();
  for (const s of S) zoneArea.set(s.zone, (zoneArea.get(s.zone) ?? 0) + s.area);
  const share = (z: string) => (zoneArea.get(z) ?? 0) / total;
  const sorted = [...zoneArea].sort((a, b) => b[1] - a[1]);
  const major = sorted.filter(([, a]) => a / total >= 0.03);
  if (S.length >= o.minParts && (sorted[0][1] / total > o.dominantZone || major.length < 3))
    add('warn', 'PALETTE_FLAT', `${sorted[0][0]} covers ${Math.round((sorted[0][1] / total) * 100)} % of the surface and only ${major.length} zone${major.length === 1 ? '' : 's'} carry ≥ 3 %: the model has no material hierarchy (Pillar 1 asks for 60 / 30 / 10).`, [], undefined, 'Add the missing tier: primary hull (~60 %), gunmetal skeleton (~30 %), orange/emissive accents (~10 %).');
  const accent = share('hullSecondary') + ['energyCyan', 'warningAmber', 'dangerCrimson', 'terraformEmerald'].reduce((s, z) => s + share(z), 0);
  if (S.length >= o.minParts && accent < 0.02) add('warn', 'NO_ACCENT', `Accent colours (hullSecondary + emissive) cover ${(accent * 100).toFixed(1)} % of the surface (< 2 %): no faction trim or status light to read at RTS distance.`, [], undefined, 'Add faction trim (hullSecondary) and at least one emissive light.');
  const meanL = S.reduce((s, x) => s + x.lab[0] * x.area, 0) / total;
  if (S.length >= o.minParts && meanL < o.minMeanL) add('warn', 'MODEL_TOO_DARK', `The surface averages L* ${meanL.toFixed(0)} (< ${o.minMeanL}): the model reads as a dark silhouette on dark terrain.`, [], undefined, 'Move big areas from gunmetal to hullPrimary / hullSecondary.');

  return meanL;
}
