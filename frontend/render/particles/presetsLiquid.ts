import type { BurstPresetSpec, ParticleLayerSpec } from './types';

function liquid(name: string, role: ParticleLayerSpec['role'], geometry: ParticleLayerSpec['geometry'],
  count: number, color: number, options: Partial<ParticleLayerSpec> = {}): ParticleLayerSpec {
  return { name, role, geometry, count, color, behavior: 'liquid', roughness: 0.28, metalness: 0,
    sizeRange: [0.08, 0.16], speedRange: [1.4, 3.2], upwardBias: [0.3, 1.3], spreadCone: 1.4,
    gravity: 7.5, drag: 1.9, bounce: 0.18, spinSpeed: 0.7, lifetimeRange: [0.6, 0.95], ...options };
}

export const ACID_IMPACT_PRESET: BurstPresetSpec = {
  id: 'combat.acidHit', targetKind: 'combat', delivery: 'burst', label: 'Viscous acid splash',
  notes: 'Glossy green droplets, elastic dark strands and bright sap beads around a collapsing 3D splash crown.',
  layers: [
    liquid('Acid beads', 'primary', 'liquidGlob', 11, 0x73b934),
    liquid('Heavy drops', 'primary', 'liquidDrop', 6, 0x82c43c, {
      sizeRange: [0.12, 0.2], speedRange: [1, 2.6], stretchByVelocity: 1.4 }),
    liquid('Contact crown', 'primary', 'liquidCrown', 1, 0x78ac32, { behavior: 'splash',
      sizeRange: [0.65, 0.8], speedRange: [0.01, 0.02], upwardBias: [0, 0],
      gravity: 0, drag: 0, spinSpeed: 0, lifetimeRange: [0.85, 1.1] }),
    liquid('Viscous strands', 'secondary', 'liquidFilament', 6, 0x264a1b, {
      sizeRange: [0.13, 0.24], speedRange: [2, 4], stretchByVelocity: 1.7 }),
    liquid('Dark gel droplets', 'secondary', 'liquidGlob', 3, 0x325a20, {
      sizeRange: [0.09, 0.16], speedRange: [0.7, 1.5], lifetimeRange: [0.8, 1.2] }),
    liquid('Luminous sap beads', 'accent', 'liquidDrop', 3, 0xb5ee53, {
      emissiveIntensity: 3.2, sizeRange: [0.025, 0.055], speedRange: [2.2, 3.5], lifetimeRange: [0.3, 0.5] }),
  ],
};

export const ACID_TRAIL_PRESET: BurstPresetSpec = {
  id: 'combat.acidTrail', targetKind: 'combat', delivery: 'burst', label: 'Acid glob wake',
  notes: 'A short falling wake of shed gel beads and tapering viscous threads.',
  layers: [
    liquid('Shed liquid', 'primary', 'liquidGlob', 6, 0x79bd37, { sizeRange: [0.035, 0.075],
      speedRange: [0.1, 0.5], upwardBias: [0, 0], spreadCone: 0.3, gravity: 3.5, lifetimeRange: [0.18, 0.3] }),
    liquid('Trailing strings', 'secondary', 'liquidFilament', 3, 0x2d4d18, {
      sizeRange: [0.04, 0.07], speedRange: [0.4, 0.7], upwardBias: [0, 0], spreadCone: 0.15,
      gravity: 2.5, stretchByVelocity: 2.2, lifetimeRange: [0.14, 0.22] }),
    liquid('Sap glint', 'accent', 'liquidDrop', 1, 0xc6f86a, {
      emissiveIntensity: 3.1, sizeRange: [0.018, 0.025], speedRange: [0.3, 0.5],
      upwardBias: [0, 0], gravity: 3, lifetimeRange: [0.12, 0.2] }),
  ],
};
