import * as THREE from 'three';

/** The three playable planet archetypes. */
export type PlanetKind = 'dune' | 'oceanForest' | 'forestRock';
export const PLANET_KINDS: PlanetKind[] = ['dune', 'oceanForest', 'forestRock'];

export interface PlanetSpec {
  kind: PlanetKind;
  name: string;
  tagline: string;
  /** Deterministic seed — same (kind, seed) => same terrain & same globe. */
  seed: number;
  /** Key registered in BiomeMaterialRegistry (visuals/biomes.ts); equals `kind`. */
  biomeKey: string;
  /** Ground palette (sRGB hex). */
  palette: {
    groundLow: number; groundHigh: number; rock: number; rockDark: number;
    accent: number;          // vegetation / sand highlight
    water?: number;          // oceanForest only
    waterDeep?: number;
  };
  /** Surface-level (diorama) sky & light look. */
  sky: {
    skyColor: number; horizonColor: number; fogColor: number; fogDensity: number;
    sunColor: number; sunIntensity: number; hemiIntensity: number; hemiGround: number;
    exposure: number;
    /** Hemisphere fill used for shadows (sky part) — cooler than the fog so shadowed rock separates from lit sand. */
    ambientSky?: number;
    /** Hemisphere bounce colour from the ground. */
    ambientGround?: number;
  };
  /** Orbital look (globe + atmosphere shell + reentry). */
  orbital: {
    atmosphereColor: number;   // rim glow seen from space
    atmosphereDensity: number; // 0..1 thickness (drives entry plasma intensity + haze)
    cloudCover: number;        // 0..1
    cloudColor: number;
    // Globe surface colours sampled by the planet shader (low → high elevation)
    land: [number, number, number];
    sea?: number;              // ocean colour, if any
    seaLevel: number;          // 0..1 height threshold
    axialTilt: number;         // radians
  };
  /** Gameplay-facing tags. */
  traits: string[];
}

export const PLANET_SPECS: Record<PlanetKind, PlanetSpec> = {
  dune: {
    kind: 'dune', name: 'Kharon Dunes', tagline: 'Wind-carved dunes, rust rocks, brutal sun. Solar-rich, water-poor.',
    seed: 1101, biomeKey: 'dune',
    palette: { groundLow: 0xc98a4b, groundHigh: 0xe8c07a, rock: 0x8a5a3c, rockDark: 0x4a3226, accent: 0xf2d28b },
    sky: { skyColor: 0xf0c89a, horizonColor: 0xf6d9b0, fogColor: 0xe9c394, fogDensity: 0.0045, sunColor: 0xffe2b8, sunIntensity: 1.9, hemiIntensity: 0.5, hemiGround: 0x8a5a3c, exposure: 0.88, ambientSky: 0x93a6cf, ambientGround: 0xc99062 },
    orbital: { atmosphereColor: 0xffb070, atmosphereDensity: 0.45, cloudCover: 0.18, cloudColor: 0xffe6c8, land: [0x6b3f26, 0xc98a4b, 0xf0cf8c], seaLevel: 0.0, axialTilt: 0.25 },
    traits: ['solar +35%', 'water scarce', 'sandstorms'],
  },
  oceanForest: {
    kind: 'oceanForest', name: 'Thalassa Verde', tagline: 'Island chains, lagoons and dense forest. Water-rich, hydro-friendly.',
    seed: 2202, biomeKey: 'oceanForest',
    palette: { groundLow: 0x4f8a3c, groundHigh: 0x86b556, rock: 0x7a7f86, rockDark: 0x3b4048, accent: 0xe9dba0, water: 0x1f9fb8, waterDeep: 0x0b3f66 },
    sky: { skyColor: 0x8fc8ee, horizonColor: 0xcfe8f5, fogColor: 0xb9dcef, fogDensity: 0.0035, sunColor: 0xfff6e2, sunIntensity: 1.8, hemiIntensity: 0.6, hemiGround: 0x3b6b3a, exposure: 0.88, ambientSky: 0x9cc4ec, ambientGround: 0x55794a },
    orbital: { atmosphereColor: 0x6fb8ff, atmosphereDensity: 0.7, cloudCover: 0.55, cloudColor: 0xffffff, land: [0x2f6b34, 0x5b9a47, 0x9cc06a], sea: 0x0f5f9a, seaLevel: 0.52, axialTilt: 0.4 },
    traits: ['hydro +', 'wood', 'storms'],
  },
  forestRock: {
    kind: 'forestRock', name: 'Granite Hollow', tagline: 'Pine highlands and cliff outcrops. Mineral-dense, temperate.',
    seed: 3303, biomeKey: 'forestRock',
    palette: { groundLow: 0x3f6a3a, groundHigh: 0x6f8f4a, rock: 0x8b8e93, rockDark: 0x40444c, accent: 0xc9d4a0 },
    sky: { skyColor: 0x9db8cf, horizonColor: 0xc6d4de, fogColor: 0xa9bccb, fogDensity: 0.0045, sunColor: 0xfff1da, sunIntensity: 1.8, hemiIntensity: 0.58, hemiGround: 0x34503a, exposure: 0.88, ambientSky: 0xa3b9d9, ambientGround: 0x5d6448 },
    orbital: { atmosphereColor: 0x8fb4d8, atmosphereDensity: 0.55, cloudCover: 0.35, cloudColor: 0xf2f6fa, land: [0x2b4d33, 0x6b7a5a, 0xa8a9a4], sea: 0x2a5a7a, seaLevel: 0.22, axialTilt: 0.3 },
    traits: ['minerals +', 'wood', 'cold nights'],
  },
};

export const hex = (n: number) => new THREE.Color(n);
