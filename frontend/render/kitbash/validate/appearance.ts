// Appearance checks for kitbashed models: colour fit, colour separation between functional groups, and surface detail.
// The pipeline has NO image textures. What a player sees is the zone colour stamped on each part (`color`), the zone's
// roughness/metalness, a ±4 % triplanar grain from UnifiedColonyMaterial, and the geometry itself. So "texture quality" here
// means: do neighbouring parts read as different things, is the palette balanced, and does every big surface carry enough
// geometry (cells, ribs, bands, vents) to say what it is. See .agents/skills/model-geometry-validator/SKILL.md.
import type { P, Issue, ValidatorOptions } from './types';
import { AppearanceContext } from './appearance/context';
import { checkRoleDetail, checkFlatSurfaces } from './appearance/detail';
import { checkInsetContrast, checkGroupContrast, checkZoneFitsName, type RoleSummary } from './appearance/colorChecks';
import { checkPalette } from './appearance/palette';

export { labOfHex, shadedLab, deltaE, roleOf, type Role } from './appearance/color';
export type { RoleSummary } from './appearance/colorChecks';

/** Runs the appearance rules in report order: A. surface detail, B. colour fit and separation, palette balance. */
export function checkAppearance(parts: P[], touching: (a: number, b: number) => boolean, opts: ValidatorOptions): { issues: Issue[]; roles: RoleSummary[]; meanL: number } {
  const ctx = new AppearanceContext(parts, touching, opts);
  checkRoleDetail(ctx);
  checkFlatSurfaces(ctx);
  checkInsetContrast(ctx);
  const roles = checkGroupContrast(ctx);
  checkZoneFitsName(ctx);
  const meanL = checkPalette(ctx);
  return { issues: ctx.issues, roles: roles.sort((a, b) => b.area - a.area), meanL };
}
