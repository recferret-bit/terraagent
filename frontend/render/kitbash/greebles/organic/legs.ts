import { KitbashRegistry, type KitbashBuilder } from '../../KitbashRegistry';
import type { V3 } from '../unitParts';
import { organ, tendril } from './shapes';

export interface InsectLegs { hx: number; hy: number; z: [number, number, number]; thickness: number }
function addLeg(b: KitbashBuilder, p: InsectLegs, side: number, z: number, pair: number): void {
  const hip: V3 = [p.hx * side, p.hy, z];
  const knee: V3 = [2 * hip[0], p.hy + 0.24, 1.5 * z];
  const toe: V3 = [knee[0] + 0.12 * side, 0.027, z * 1.75];
  const r = p.thickness;
  const upper = { animType: 6 as const, animPivot: hip };
  const lower = { animType: 16 as const, animPivot: hip };
  const name = `${side > 0 ? 'right' : 'left'} leg ${pair}`;
  b.addPart(organ([r * 1.6, r * 1.5, r * 1.7], 2, 0, 0, 6), 'frameGunmetal', { name: `${name} coxa`, position: hip, ...upper });
  b.addPart(tendril([[hip[0] + r * 0.85 * side, hip[1] + r * 0.65, hip[2]], [hip[0] * 1.5, p.hy + 0.20, z * 1.15], knee], [r, r * 1.15, r * 0.68], 1, 5, 5), 'hullPrimary', { name: `${name} femur`, ...upper });
  b.addPart(organ([r, r, r], 2, 0, 0, 6), 'frameGunmetal', { name: `${name} hinge`, position: knee, ...lower });
  b.addPart(tendril([[knee[0] + r * 0.20 * side, knee[1] - r * 0.55, knee[2]], [toe[0] * 1.02, 0.28, toe[2] * 0.96], toe], [r * 0.77, r * 0.54, 0.018], 1, 5, 5), 'hullPrimary', { name: `${name} tibia`, ...lower });
  b.addPart(tendril([toe, [toe[0] + 0.055 * side, 0.018, toe[2] + 0.08], [toe[0] + 0.075 * side, 0.012, toe[2] + 0.13]], [0.027, 0.017, 0.005], 1, 4, 5), 'hullSecondary', { name: `${name} tarsal hook`, ...lower });
}
KitbashRegistry.registerGreeble('organicSixLegs', (p: InsectLegs, b) => {
  for (const side of [-1, 1]) p.z.forEach((z, i) => addLeg(b, p, side, z, i + 1));
});
