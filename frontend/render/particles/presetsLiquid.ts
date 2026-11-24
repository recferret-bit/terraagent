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
    liquid('Acid beads', 'primary', 'liquidGlob', 12, 0x73b934, { sizeRange: [0.10, 0.20], speedRange: [1.5, 3.6] }),
    liquid('Heavy drops', 'primary', 'liquidDrop', 5, 0x82c43c, {
      sizeRange: [0.14, 0.24], speedRange: [1.1, 2.8], stretchByVelocity: 1.5 }),
    liquid('Contact crown', 'primary', 'liquidCrown', 1, 0x78ac32, { behavior: 'splash',
      sizeRange: [0.68, 0.8], speedRange: [0.01, 0.02], upwardBias: [0, 0],
      gravity: 0, drag: 0, spinSpeed: 0, lifetimeRange: [0.95, 1.25] }),
    liquid('Viscous strands', 'secondary', 'liquidFilament', 6, 0x264a1b, {
      sizeRange: [0.15, 0.28], speedRange: [2.1, 4.3], stretchByVelocity: 1.8 }),
    liquid('Dark gel droplets', 'secondary', 'liquidGlob', 3, 0x325a20, {
      sizeRange: [0.11, 0.19], speedRange: [0.8, 1.7], lifetimeRange: [0.85, 1.3] }),
    liquid('Luminous sap beads', 'accent', 'liquidDrop', 3, 0xb5ee53, {
      emissiveIntensity: 3.3, sizeRange: [0.035, 0.07], speedRange: [2.3, 3.8], lifetimeRange: [0.32, 0.55] }),
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

export const INSECT_DEATH_PRESET: BurstPresetSpec = {
  id: 'combat.insectDeath', targetKind: 'combat', delivery: 'burst', label: 'Insect rupture & green blood splatter',
  notes: 'Explosive hemolymph gush, tumbling ripped chitin plates, severed limbs, and luminous ichor droplets.',
  layers: [
    liquid('Green hemolymph burst', 'primary', 'liquidGlob', 15, 0x63d62e, {
      sizeRange: [0.13, 0.26], speedRange: [2.2, 6.0], upwardBias: [1.4, 4.2],
      spreadCone: 1.55, gravity: 9.2, drag: 1.45, bounce: 0.24, lifetimeRange: [1.6, 3.0],
    }),
    liquid('Blood spray droplets', 'primary', 'liquidDrop', 14, 0x7be23e, {
      sizeRange: [0.10, 0.20], speedRange: [2.6, 6.6], upwardBias: [1.5, 4.5],
      spreadCone: 1.45, gravity: 9.2, drag: 1.35, bounce: 0.25, stretchByVelocity: 1.65, lifetimeRange: [1.4, 2.7],
    }),
    liquid('Ground blood crown', 'primary', 'liquidCrown', 1, 0x59bf25, {
      behavior: 'splash', sizeRange: [0.72, 0.8], speedRange: [0.01, 0.02],
      upwardBias: [0, 0], gravity: 0, drag: 0, spinSpeed: 0, lifetimeRange: [2.8, 4.2],
    }),
    {
      name: 'Ripped chitin plates', role: 'secondary', geometry: 'slateChunk', count: 7, color: 0x1e2630,
      roughness: 0.55, metalness: 0.15, sizeRange: [0.12, 0.25], speedRange: [2.6, 6.5], upwardBias: [2.2, 5.2],
      spreadCone: 1.5, gravity: 10.5, drag: 1.25, bounce: 0.4, spinSpeed: 13, lifetimeRange: [2.8, 4.8],
    },
    {
      name: 'Severed insect limbs', role: 'secondary', geometry: 'woodSplinter', count: 6, color: 0x242e38,
      roughness: 0.62, metalness: 0.05, sizeRange: [0.15, 0.3], speedRange: [3.0, 7.2], upwardBias: [2.4, 5.5],
      spreadCone: 1.55, gravity: 10.5, drag: 1.2, bounce: 0.42, spinSpeed: 16, lifetimeRange: [2.8, 5.0],
    },
    {
      name: 'Organ spore haze', role: 'secondary', geometry: 'dustCloud', count: 2, color: 0x32452b,
      roughness: 0.9, metalness: 0, sizeRange: [0.26, 0.46], speedRange: [0.9, 2.4], upwardBias: [0.9, 2.1],
      spreadCone: 1.35, gravity: -0.6, drag: 2.3, bounce: 0.2, spinSpeed: 1.5, lifetimeRange: [0.65, 1.3],
    },
    {
      name: 'Bioluminescent core burst', role: 'accent', geometry: 'energyOrb', count: 3, color: 0xb6ff4a,
      emissiveIntensity: 4.2, roughness: 0.4, metalness: 0, sizeRange: [0.24, 0.4], speedRange: [1.3, 3.4],
      upwardBias: [0.7, 2.0], spreadCone: 1.4, gravity: 2.0, drag: 2.2, bounce: 0.15, spinSpeed: 4, lifetimeRange: [0.24, 0.42],
    },
    {
      name: 'Luminous ichor sparks', role: 'accent', geometry: 'weldSpark', count: 2, color: 0xa4ff3c,
      emissiveIntensity: 3.9, roughness: 0.45, metalness: 0, sizeRange: [0.065, 0.12], speedRange: [4.8, 9.0],
      upwardBias: [1.6, 4.0], spreadCone: 1.45, gravity: 6.5, drag: 1.6, bounce: 0.25, spinSpeed: 9,
      stretchByVelocity: 1.85, lifetimeRange: [0.34, 0.62],
    },
  ],
};
