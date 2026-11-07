import { ACID_IMPACT_PRESET, ACID_TRAIL_PRESET } from './presetsLiquid';
import type { BurstPresetSpec, ParticleLayerSpec } from './types';

function layer(name: string, role: ParticleLayerSpec['role'], geometry: ParticleLayerSpec['geometry'],
  count: number, color: number, options: Partial<ParticleLayerSpec> = {}): ParticleLayerSpec {
  return { name, role, geometry, count, color, sizeRange: [0.05, 0.12], speedRange: [1.5, 4],
    upwardBias: [0.4, 1.3], spreadCone: 1.15, gravity: 9.8, drag: 1.5, bounce: 0.3,
    spinSpeed: 7, lifetimeRange: [0.35, 0.65], roughness: 0.85, ...options };
}
function preset(id: string, label: string, notes: string, layers: ParticleLayerSpec[]): BurstPresetSpec {
  return { id: `combat.${id}`, targetKind: 'combat', delivery: 'burst', label, notes, layers };
}
const smoke = { gravity: -0.6, drag: 2.5, spinSpeed: 1.2, bounce: 0.2, speedRange: [0.6, 2.1] as [number, number] };
const glow = { emissiveIntensity: 4.5, roughness: 0.6, stretchByVelocity: 1.7 };
const impact = [
  layer('Chitin / armor chips', 'primary', 'slateChunk', 12, 0xd4b583),
  layer('Dark fractures', 'secondary', 'rockShard', 4, 0x383d48, { sizeRange: [0.035, 0.075] }),
  layer('Surface dust', 'secondary', 'dustCloud', 2, 0x525967, { ...smoke, sizeRange: [0.08, 0.14] }),
  layer('Hot sparks', 'accent', 'weldSpark', 2, 0xffb45a, { ...glow, speedRange: [3, 6] }),
];

export const COMBAT_PARTICLE_PRESETS: BurstPresetSpec[] = [
  preset('impact', 'Ballistic surface hit', 'Outward chips, dark fractures and hot sparks.', impact),
  preset('laserHit', 'Laser ablation', 'Brief cyan flare with pale vapor and scorched flakes.', impact.map(l => ({ ...l,
    color: l.role === 'primary' ? 0xc0d7dc : l.role === 'accent' ? 0x67e4ff : 0x334453,
    lifetimeRange: [0.18, 0.38], sizeRange: [l.sizeRange[0] * 0.8, l.sizeRange[1] * 0.8],
  }))),
  ACID_IMPACT_PRESET,
  ACID_TRAIL_PRESET,
  preset('rocket', 'Rocket fuel detonation', 'Rolling orange fire lobes, rising charcoal smoke and radial fragments.', [
    layer('Warm billows', 'primary', 'dustCloud', 12, 0xbba887, { ...smoke,
      sizeRange: [0.24, 0.48], lifetimeRange: [0.65, 1.2], upwardBias: [0.6, 1.8] }),
    layer('Casing shards', 'primary', 'slateChunk', 12, 0xba9d72, {
      sizeRange: [0.06, 0.13], speedRange: [3, 7], lifetimeRange: [0.65, 1.15] }),
    layer('Charcoal lobes', 'secondary', 'dustCloud', 12, 0x343943, { ...smoke,
      sizeRange: [0.32, 0.58], lifetimeRange: [0.85, 1.6], upwardBias: [1, 2.4] }),
    layer('Fuel fireballs', 'accent', 'energyOrb', 3, 0xff500b, { ...glow, emissiveIntensity: 3.6, stretchByVelocity: 1,
      sizeRange: [0.55, 0.8], speedRange: [1.5, 3], upwardBias: [0.4, 1.2], gravity: -1,
      drag: 3, lifetimeRange: [0.3, 0.5], spreadCone: 1.4 }),
    layer('Ignited fragments', 'accent', 'weldSpark', 1, 0xffdf90, { ...glow,
      sizeRange: [0.12, 0.2], speedRange: [6, 10], lifetimeRange: [0.45, 0.7] }),
  ]),
  preset('artillery', 'Artillery high explosive', 'Sharp white flash, tall soil fountain and heavy tumbling shrapnel.', [
    layer('Heavy ejecta', 'primary', 'soilClod', 18, 0xb18b57, {
      sizeRange: [0.09, 0.19], speedRange: [2, 5], upwardBias: [3, 6], lifetimeRange: [0.7, 1.3] }),
    layer('Grit jets', 'primary', 'sandGrain', 12, 0xd0b482, { sizeRange: [0.06, 0.13],
      speedRange: [3, 7], upwardBias: [3, 5], lifetimeRange: [0.5, 1.1], stretchByVelocity: 1.8 }),
    layer('Blast dust', 'secondary', 'dustCloud', 15, 0x4d4b46, { ...smoke,
      sizeRange: [0.25, 0.5], upwardBias: [1.5, 3], lifetimeRange: [0.6, 1.15] }),
    layer('Steel streaks', 'accent', 'weldSpark', 3, 0xffd091, { ...glow,
      sizeRange: [0.09, 0.18], speedRange: [6, 11], lifetimeRange: [0.25, 0.5] }),
    layer('White detonation', 'accent', 'energyOrb', 2, 0xffefce, { ...glow, stretchByVelocity: 1,
      sizeRange: [0.5, 0.75], speedRange: [1, 2], gravity: 0, lifetimeRange: [0.09, 0.16] }),
  ]),
  preset('muzzle', 'Gun muzzle discharge', 'Axial gas plume, powder flecks and a short HDR flame at the socket.', [
    layer('Propellant gas', 'primary', 'dustCloud', 6, 0xb9c1ca, { ...smoke, sizeRange: [0.05, 0.1],
      upwardBias: [0, 0.1], spreadCone: 0.2, lifetimeRange: [0.1, 0.18], speedRange: [1, 2] }),
    layer('Powder flecks', 'secondary', 'slateChunk', 3, 0x414955, { sizeRange: [0.02, 0.04],
      upwardBias: [0, 0.1], spreadCone: 0.35, speedRange: [2, 4], lifetimeRange: [0.09, 0.16] }),
    layer('Muzzle flame', 'accent', 'weldSpark', 1, 0xffd99b, { ...glow, emissiveIntensity: 6,
      sizeRange: [0.12, 0.16], speedRange: [0.3, 0.4], upwardBias: [0, 0], spreadCone: 0.08,
      gravity: 0, drag: 0, lifetimeRange: [0.065, 0.085], stretchByVelocity: 1.8 }),
  ]),
];
