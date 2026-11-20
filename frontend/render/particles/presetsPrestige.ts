import { BUILTIN_PARTICLE_PRESETS } from './presets';
import type { ParticlePresetSpec, ToolBeamSpec } from './types';

/** Suffix of a cyan cutter variant id: `work.tree` -> `work.tree.cyan`. */
export const CYAN_CUTTER_SUFFIX = '.cyan';

/** Tier 2+ cutter beam tint (W28-12): HDR white-cyan core, saturated cyan sheath and impact ring (Faction Plate cyan). */
export const CYAN_CUTTER_BEAM: Pick<ToolBeamSpec, 'coreColor' | 'glowColor' | 'ringColor'> = {
  coreColor: 0xc8fbff,
  glowColor: 0x00e5ff,
  ringColor: 0x00f0ff,
};

/** Id of the cyan cutter variant of a base work preset id. */
export const cyanCutterPresetId = (baseId: string): string => `${baseId}${CYAN_CUTTER_SUFFIX}`;

/**
 * A preset with a cyan tool beam. Debris layers are shared with the base on purpose (same 60/30/10 chunks, same
 * contrast): only the cutter beam and its impact ring change, so the base validation holds for the variant.
 */
export function deriveCyanCutter(base: ParticlePresetSpec): ParticlePresetSpec {
  return {
    ...base,
    id: cyanCutterPresetId(base.id),
    variantOf: base.id,
    label: `${base.label} (Cyan Cutter)`,
    notes: `${base.notes} Tier 2+ staking cosmetic: cyan cutter beam and impact ring.`,
    toolBeam: { ...base.toolBeam, ...CYAN_CUTTER_BEAM, emissiveIntensity: Math.max(base.toolBeam.emissiveIntensity, 4.6) },
  };
}

/** One cyan cutter variant per built-in work preset, registered by `ParticlePresetRegistry`. */
export const CYAN_CUTTER_PRESETS: ParticlePresetSpec[] = BUILTIN_PARTICLE_PRESETS.map(deriveCyanCutter);
