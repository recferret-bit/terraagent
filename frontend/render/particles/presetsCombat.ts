import { ACID_IMPACT_PRESET, ACID_TRAIL_PRESET, INSECT_DEATH_PRESET } from './presetsLiquid';
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
  INSECT_DEATH_PRESET,
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
  preset('muzzle', 'Gun muzzle discharge', 'Axial gas plume, powder flecks and a bright HDR flame at the socket.', [
    layer('Propellant gas', 'primary', 'dustCloud', 7, 0xb9c1ca, { ...smoke, sizeRange: [0.06, 0.13],
      upwardBias: [0, 0.12], spreadCone: 0.24, lifetimeRange: [0.11, 0.2], speedRange: [1.1, 2.4] }),
    layer('Hot muzzle blast', 'primary', 'sandGrain', 5, 0xd8c8af, { sizeRange: [0.035, 0.075],
      upwardBias: [0, 0.1], spreadCone: 0.26, speedRange: [2.4, 4.6], lifetimeRange: [0.1, 0.17] }),
    layer('Powder flecks', 'secondary', 'slateChunk', 6, 0x414955, { sizeRange: [0.025, 0.05],
      upwardBias: [0, 0.12], spreadCone: 0.38, speedRange: [2.2, 4.4], lifetimeRange: [0.1, 0.18] }),
    layer('Muzzle flame', 'accent', 'weldSpark', 2, 0xffd99b, { ...glow, emissiveIntensity: 6,
      sizeRange: [0.15, 0.22], speedRange: [0.35, 0.5], upwardBias: [0, 0], spreadCone: 0.1,
      gravity: 0, drag: 0, lifetimeRange: [0.075, 0.1], stretchByVelocity: 2 }),
  ]),
  preset('dustBurst', 'Impact dust burst', 'Expanding soil cloud, grit spray and bouncing dirt clods scaled by ordnance caliber.', [
    layer('Billowing impact dust', 'primary', 'dustCloud', 10, 0xd8c39e, {
      gravity: -0.35, drag: 2.3, bounce: 0.2, spinSpeed: 1.3,
      sizeRange: [0.22, 0.44], speedRange: [1.6, 3.8], upwardBias: [0.35, 1.1], spreadCone: 1.45, lifetimeRange: [0.55, 1.05],
    }),
    layer('Kick-up grit spray', 'primary', 'sandGrain', 4, 0xe4d2b2, {
      gravity: 9.8, drag: 1.4, bounce: 0.35, spinSpeed: 8,
      sizeRange: [0.045, 0.09], speedRange: [2.4, 5.2], upwardBias: [0.8, 2.2], spreadCone: 1.35, lifetimeRange: [0.4, 0.75],
    }),
    layer('Dense earth shadow plume', 'secondary', 'dustCloud', 5, 0x4c4338, {
      gravity: -0.25, drag: 2.6, bounce: 0.2, spinSpeed: 1.1,
      sizeRange: [0.26, 0.48], speedRange: [0.9, 2.3], upwardBias: [0.6, 1.6], spreadCone: 1.35, lifetimeRange: [0.7, 1.25],
    }),
    layer('Tossed dirt clods', 'secondary', 'soilClod', 3, 0x544535, {
      gravity: 11.0, drag: 1.2, bounce: 0.32, spinSpeed: 9,
      sizeRange: [0.06, 0.12], speedRange: [1.8, 4.2], upwardBias: [1.6, 3.4], spreadCone: 1.3, lifetimeRange: [0.55, 0.95],
    }),
    layer('Shock dust glint', 'accent', 'weldSpark', 2, 0xffd699, {
      ...glow, emissiveIntensity: 3.8, stretchByVelocity: 1.6,
      sizeRange: [0.05, 0.10], speedRange: [3.2, 5.8], upwardBias: [0.7, 1.8], spreadCone: 1.25,
      gravity: 8.5, drag: 1.6, bounce: 0.25, lifetimeRange: [0.22, 0.42],
    }),
  ]),
  preset('botDeath', 'Bot destruction detonation', 'Fiery reactor fireball, billowing ash & soot smoke, and bouncing hull shrapnel.', [
    layer('Blast ash smoke', 'primary', 'dustCloud', 16, 0xb5a38c, {
      colorAlt: 0xd0bfa4, gravity: -1.35, drag: 2.05, bounce: 0.2, spinSpeed: 1.4,
      sizeRange: [0.28, 0.54], speedRange: [0.9, 2.7], upwardBias: [0.85, 2.3], spreadCone: 1.5, lifetimeRange: [0.95, 1.85],
    }),
    layer('Shattered hull plates', 'primary', 'slateChunk', 14, 0xd4dce6, {
      colorAlt: 0xa4b2c4, metalness: 0.65, roughness: 0.45,
      sizeRange: [0.09, 0.19], speedRange: [2.8, 6.8], upwardBias: [1.6, 4.2], spreadCone: 1.45,
      gravity: 11.0, drag: 1.3, bounce: 0.38, spinSpeed: 13, lifetimeRange: [1.0, 1.9],
    }),
    layer('Charcoal smoke plume', 'secondary', 'dustCloud', 11, 0x2a2f38, {
      colorAlt: 0x3b414d, gravity: -1.75, drag: 1.95, bounce: 0.2, spinSpeed: 1.2,
      sizeRange: [0.36, 0.66], speedRange: [0.8, 2.3], upwardBias: [1.35, 3.1], spreadCone: 1.45, lifetimeRange: [1.25, 2.45],
    }),
    layer('Scorched frame shards', 'secondary', 'rockShard', 4, 0x303642, {
      metalness: 0.72, roughness: 0.55,
      sizeRange: [0.08, 0.16], speedRange: [2.5, 6.0], upwardBias: [1.5, 3.8], spreadCone: 1.45,
      gravity: 11.0, drag: 1.3, bounce: 0.35, spinSpeed: 14, lifetimeRange: [1.0, 1.8],
    }),
    layer('Fireball blooms', 'accent', 'energyOrb', 4, 0xff5a12, {
      ...glow, colorAlt: 0xff9428, emissiveIntensity: 4.6, stretchByVelocity: 1,
      sizeRange: [0.46, 0.74], speedRange: [0.9, 2.4], upwardBias: [0.8, 2.2], spreadCone: 1.45,
      gravity: -1.8, drag: 2.5, bounce: 0.15, lifetimeRange: [0.28, 0.58],
    }),
    layer('Detonation core flash', 'accent', 'energyOrb', 1, 0xffe9b0, {
      ...glow, emissiveIntensity: 5.8, stretchByVelocity: 1,
      sizeRange: [0.62, 0.78], speedRange: [0.3, 0.9], upwardBias: [0.2, 0.5],
      gravity: 0, drag: 3.0, bounce: 0, lifetimeRange: [0.10, 0.20],
    }),
    layer('Hot shrapnel sparks', 'accent', 'weldSpark', 2, 0xffca68, {
      ...glow, emissiveIntensity: 4.8, stretchByVelocity: 2.0,
      sizeRange: [0.11, 0.19], speedRange: [5.5, 10.5], upwardBias: [1.8, 4.4], spreadCone: 1.45,
      gravity: 8.5, drag: 1.4, bounce: 0.32, lifetimeRange: [0.35, 0.72],
    }),
  ]),
  preset('buildingDeath', 'Building structural collapse explosion', 'Heavy roaring fireballs, towering smoke column, flying steel plates and sparks.', [
    layer('Structure blast smoke', 'primary', 'dustCloud', 22, 0xb8a58e, {
      colorAlt: 0xd4c2a8, gravity: -1.45, drag: 1.85, bounce: 0.2, spinSpeed: 1.3,
      sizeRange: [0.38, 0.72], speedRange: [1.1, 3.2], upwardBias: [1.2, 3.2], spreadCone: 1.5, lifetimeRange: [1.3, 2.5],
    }),
    layer('Hull plate wreckage', 'primary', 'slateChunk', 18, 0xd6dee8, {
      colorAlt: 0xaab7c8, metalness: 0.62, roughness: 0.48,
      sizeRange: [0.12, 0.26], speedRange: [3.2, 7.6], upwardBias: [2.0, 5.2], spreadCone: 1.5,
      gravity: 11.5, drag: 1.25, bounce: 0.36, spinSpeed: 12, lifetimeRange: [1.2, 2.2],
    }),
    layer('Dark soot column', 'secondary', 'dustCloud', 14, 0x242830, {
      colorAlt: 0x353b46, gravity: -1.9, drag: 1.8, bounce: 0.2, spinSpeed: 1.1,
      sizeRange: [0.46, 0.78], speedRange: [1.0, 2.8], upwardBias: [1.8, 4.2], spreadCone: 1.45, lifetimeRange: [1.6, 3.1],
    }),
    layer('Twisted steel chunks', 'secondary', 'oreNugget', 6, 0x333944, {
      metalness: 0.75, roughness: 0.55,
      sizeRange: [0.11, 0.22], speedRange: [2.6, 6.4], upwardBias: [1.6, 4.4], spreadCone: 1.45,
      gravity: 11.5, drag: 1.3, bounce: 0.34, spinSpeed: 13, lifetimeRange: [1.2, 2.1],
    }),
    layer('Roaring blast fireballs', 'accent', 'energyOrb', 6, 0xff520a, {
      ...glow, colorAlt: 0xff8f24, emissiveIntensity: 4.8, stretchByVelocity: 1,
      sizeRange: [0.54, 0.80], speedRange: [1.2, 3.2], upwardBias: [1.0, 3.0], spreadCone: 1.45,
      gravity: -2.1, drag: 2.3, bounce: 0.15, lifetimeRange: [0.35, 0.75],
    }),
    layer('White-hot blast core', 'accent', 'energyOrb', 1, 0xfff1c4, {
      ...glow, emissiveIntensity: 6.0, stretchByVelocity: 1,
      sizeRange: [0.68, 0.80], speedRange: [0.4, 1.0], upwardBias: [0.2, 0.6],
      gravity: 0, drag: 3.0, bounce: 0, lifetimeRange: [0.12, 0.24],
    }),
    layer('Flying molten sparks', 'accent', 'weldSpark', 3, 0xffcf72, {
      ...glow, emissiveIntensity: 4.8, stretchByVelocity: 2.1,
      sizeRange: [0.13, 0.22], speedRange: [6.0, 12.0], upwardBias: [2.2, 5.2], spreadCone: 1.45,
      gravity: 9.0, drag: 1.35, bounce: 0.32, lifetimeRange: [0.45, 0.92],
    }),
  ]),
];
