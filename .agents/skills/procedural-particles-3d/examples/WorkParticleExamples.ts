import * as THREE from 'three';
import {
  ParticlePresetRegistry,
  WorkParticleSystem,
  validateParticlePreset,
  type ParticlePresetSpec,
} from '../../../frontend/render/particles/index.js';

/**
 * Reference example: Registering a custom object-of-interaction 3D particle preset
 * that satisfies the 60/30/10 role hierarchy, CIE Lab contrast (ΔE76 >= 15),
 * ground bounce physics, and HDR bloom accent rules.
 */
export const CRYSTAL_GEODE_PRESET: ParticlePresetSpec = {
  id: 'work.crystalGeode',
  label: 'Geode Excavation (Amethyst Prisms + Basalt Shell + Piezo Arcs)',
  targetKind: 'minerals',
  notes: '60% amethyst crystal prisms, 30% dark basalt geode rind, 10% piezoelectric discharge sparks.',
  toolBeam: {
    coreColor: 0xffd6ff,
    glowColor: 0xc74bff,
    emissiveIntensity: 4.8,
    beamRadius: 0.036,
    sweepRadius: 0.24,
    sweepFreq: 6.5,
    pulseFreq: 16,
    ringColor: 0xe066ff,
  },
  layers: [
    {
      name: 'amethyst crystal prisms',
      role: 'primary',
      geometry: 'crystalShard',
      count: 42, // 56% of 75 total instances
      color: 0xb968ff,
      colorAlt: 0xd896ff,
      roughness: 0.35,
      metalness: 0.25,
      emissiveIntensity: 0.35,
      sizeRange: [0.06, 0.14],
      speedRange: [1.1, 2.8],
      upwardBias: [1.6, 3.5],
      spreadCone: 1.0,
      gravity: 11.2,
      drag: 0.65,
      bounce: 0.48,
      spinSpeed: 11.0,
      lifetimeRange: [0.65, 1.25],
      swirl: 0.3,
    },
    {
      name: 'dark basalt geode rind',
      role: 'secondary',
      geometry: 'rockShard',
      count: 23, // 30.7% of 75 total instances
      color: 0x2c323d,
      colorAlt: 0x3b424f,
      roughness: 0.84,
      metalness: 0.18,
      emissiveIntensity: 0,
      sizeRange: [0.05, 0.12],
      speedRange: [0.9, 2.3],
      upwardBias: [1.2, 2.6],
      spreadCone: 0.95,
      gravity: 12.4,
      drag: 0.55,
      bounce: 0.36,
      spinSpeed: 9.0,
      lifetimeRange: [0.6, 1.15],
      swirl: 0.1,
    },
    {
      name: 'piezoelectric discharge sparks',
      role: 'accent',
      geometry: 'weldSpark',
      count: 10, // 13.3% of 75 total instances
      color: 0xffe0ff,
      colorAlt: 0xe066ff,
      roughness: 0.15,
      metalness: 0.1,
      emissiveIntensity: 4.8,
      sizeRange: [0.04, 0.085],
      speedRange: [2.2, 4.6],
      upwardBias: [1.8, 3.8],
      spreadCone: 0.85,
      gravity: 5.5,
      drag: 1.6,
      bounce: 0.25,
      spinSpeed: 14.0,
      lifetimeRange: [0.22, 0.48],
      swirl: 0.9,
      stretchByVelocity: 2.6,
    },
  ],
};

/** Example: validate, register, and step a WorkParticleSystem in a Three.js scene. */
export function setupCustomWorkParticleDemo(scene: THREE.Scene): WorkParticleSystem {
  const report = validateParticlePreset(CRYSTAL_GEODE_PRESET);
  if (!report.pass) {
    throw new Error(`Invalid particle preset ${report.id}: ${report.issues.map((i) => i.message).join('; ')}`);
  }
  ParticlePresetRegistry.register(CRYSTAL_GEODE_PRESET);

  const system = new WorkParticleSystem(scene);
  system.syncSites([
    {
      workerId: 'demo-miner-1',
      targetKind: 'minerals',
      presetId: 'work.crystalGeode',
      botOrigin: [0, 0, -0.8],
      toolOrigins: [[0, 0.55, -0.45]],
      targetPos: [0, 0, 0.65],
      groundY: 0,
      intensity: 1.0,
    },
  ]);
  return system;
}
