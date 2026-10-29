import { BiomeMaterialRegistry } from './UnifiedColonyMaterial';

// Ground-up weathering presets for the 4 TerraAgent planets (keys == PlanetKind).
BiomeMaterialRegistry.registerBiome('dune',        { dustColor: 0xc9955a, rimTint: 0xf4b073, weatheringHeight: 1.15, weatheringIntensity: 0.65 });
BiomeMaterialRegistry.registerBiome('oceanForest', { dustColor: 0x4b6b3a, rimTint: 0x8fd0ff, weatheringHeight: 0.7,  weatheringIntensity: 0.35 });
BiomeMaterialRegistry.registerBiome('forestRock',  { dustColor: 0x59624a, rimTint: 0xa9c4dc, weatheringHeight: 0.8,  weatheringIntensity: 0.40 });
