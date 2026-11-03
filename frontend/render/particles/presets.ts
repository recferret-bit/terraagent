import { GRADING_PARTICLE_PRESETS } from './presetsGrading';
import { RESOURCE_PARTICLE_PRESETS } from './presetsResource';
import { TERRAIN_PARTICLE_PRESETS } from './presetsTerrain';
import type { ParticlePresetSpec } from './types';

export const BUILTIN_PARTICLE_PRESETS: ParticlePresetSpec[] = [
  ...TERRAIN_PARTICLE_PRESETS,
  ...GRADING_PARTICLE_PRESETS,
  ...RESOURCE_PARTICLE_PRESETS,
];
