import * as THREE from 'three';
import { hexDistance, hexIndex } from '@terra/sim/grid/hex';
import type { BiosphereAggressor, PlanetBiosphere } from '@terra/render/biosphere';
import {
  createHexTerrain,
  HEX_PREP,
  HEX_TERRAIN,
  type HexTerrain,
  type HexTiles,
} from '@terra/render/planets/hex';
import { tileXZ } from '@terra/render/planets/hex/hexMath';
import { PLANET_SPECS, type PlanetKind } from '@terra/render/planets/PlanetSpec';

const RADIUS = 12;

export interface WildlifeLevelSpec {
  readonly kind: PlanetKind;
  readonly label: string;
  readonly title: string;
  readonly summary: string;
}

export const WILDLIFE_STORYBOOK_LEVELS: readonly WildlifeLevelSpec[] = [
  {
    kind: 'forestRock',
    label: 'FOREST',
    title: 'Highland Boreal Forest',
    summary: 'Alpine granite crags, mountain tarn lake & dense conifer groves',
  },
  {
    kind: 'oceanForest',
    label: 'OCEAN',
    title: 'Tropical Coral Archipelago',
    summary: 'Turquoise reef lagoons, rainforest islands & coastal sea stacks',
  },
  {
    kind: 'dune',
    label: 'DUNE',
    title: 'Arid Desert & Oasis Wadi',
    summary: 'Spring-fed oasis waterhole, palm wadis & red sandstone mesas',
  },
] as const;

export interface WildlifeSceneStats {
  active: boolean;
  kind: PlanetKind | null;
  levelTitle: string;
  hour: number;
  paused: boolean;
  scareTimer: number;
  birdSpecies: number;
  birdsTotal: number;
  landSpecies: number;
  landAnimalsTotal: number;
  sleeping: number;
  hunting: number;
  grazing: number;
  fleeing: number;
}

export function buildEcosystemTiles(kind: PlanetKind): HexTiles {
  const hx = hexIndex(RADIUS);
  const terrain = new Uint8Array(hx.count).fill(HEX_TERRAIN.flat);
  const prep = new Uint8Array(hx.count).fill(HEX_PREP.wild);
  const height = new Float32Array(hx.count);
  const deposit = new Uint8Array(hx.count);
  const depositTier = new Uint8Array(hx.count);
  const richness = new Uint16Array(hx.count);
  const owner = new Int8Array(hx.count).fill(-1);

  for (let i = 0; i < hx.count; i++) {
    const q = hx.q[i]!;
    const r = hx.r[i]!;
    const d = hexDistance(0, 0, q, r);
    const [x, z] = tileXZ(q, r);

    if (kind === 'forestRock') {
      // Level 1 (Forest Planet): Highland mountain tarn, dense conifer groves, alpine crag ridges & meadows
      if (d <= 2) {
        terrain[i] = d <= 1 ? HEX_TERRAIN.deep : HEX_TERRAIN.shallow;
        height[i] = -0.32;
      } else if ((x > 2.2 && z < 1.5 && d >= 4 && d <= 10) || (x < -1.5 && z < -3.0 && d >= 4 && d <= 9)) {
        terrain[i] = HEX_TERRAIN.forest;
        height[i] = 0.18 + (d % 3) * 0.04;
      } else if ((x < -3.2 && z > 1.2 && d >= 5 && d <= 10) || (d >= 9 && (q - r) % 4 === 0)) {
        terrain[i] = HEX_TERRAIN.rock;
        height[i] = 0.58 + (d % 2) * 0.12;
      } else {
        height[i] = 0.06 + ((q * 3 + r * 5) & 3) * 0.03;
      }
    } else if (kind === 'oceanForest') {
      // Level 2 (Ocean Planet): Turquoise coral lagoon + tidal straits, lush canopy islands & basalt stacks
      const inLagoon = d <= 2 || (d <= 6 && Math.abs(q + r) <= 1 && z > -2);
      if (inLagoon) {
        terrain[i] = d <= 1 ? HEX_TERRAIN.deep : HEX_TERRAIN.shallow;
        height[i] = -0.35;
      } else if ((x > 1.8 && d >= 3 && d <= 9) || (x < -2.4 && z < 1.0 && d >= 4 && d <= 9)) {
        terrain[i] = HEX_TERRAIN.forest;
        height[i] = 0.14 + (d % 2) * 0.04;
      } else if (x < -2.8 && z > 2.2 && d >= 5 && d <= 9) {
        terrain[i] = HEX_TERRAIN.rock;
        height[i] = 0.48;
      } else {
        height[i] = 0.04 + ((q + r) & 1) * 0.03;
      }
    } else {
      // Level 3 (Dune Planet): Spring-fed desert oasis waterhole, palm/acacia wadi fringe, sandstone mesas & golden ergs
      if (d <= 1) {
        terrain[i] = d === 0 ? HEX_TERRAIN.deep : HEX_TERRAIN.shallow;
        height[i] = -0.26;
      } else if (d >= 2 && d <= 4 && x >= 0 && z <= 2.5) {
        terrain[i] = HEX_TERRAIN.forest;
        height[i] = 0.10;
      } else if ((x < -3.0 && z > 1.0 && d >= 5 && d <= 10) || (d >= 6 && d <= 10 && q % 3 === 0 && z < -1.5)) {
        terrain[i] = HEX_TERRAIN.rock;
        height[i] = 0.52 + (d % 3) * 0.08;
      } else {
        height[i] = 0.05 + Math.sin(q * 0.65 + r * 0.45) * 0.06;
      }
    }
  }
  return { terrain, prep, height, deposit, depositTier, richness, owner };
}

/**
 * Live biome ecosystem playground host (`forestRock` | `oceanForest` | `dune`):
 * mounts a natural forest/lagoon/crag hex patch and drives the real `PlanetBiosphere`
 * herd, solitary predator, circadian rest/graze, and bird-flock simulators.
 */
export class WildlifeSceneHost {
  readonly group = new THREE.Group();
  private kind: PlanetKind | null = null;
  private hour = 10;
  private paused = false;
  private wire = false;
  private scareTimer = 0;
  private terrain: HexTerrain | null = null;
  private biosphere: PlanetBiosphere | null = null;

  constructor(parent?: THREE.Object3D) {
    this.group.name = 'WildlifeSceneHost';
    this.group.visible = false;
    parent?.add(this.group);
  }

  get activeKind(): PlanetKind | null {
    return this.kind;
  }

  setScene(kind: PlanetKind | null, opts?: { hour?: number; wire?: boolean; paused?: boolean }): WildlifeSceneStats {
    this.teardown();
    this.kind = kind;
    if (opts?.hour !== undefined && Number.isFinite(opts.hour)) this.hour = ((opts.hour % 24) + 24) % 24;
    if (opts?.wire !== undefined) this.wire = opts.wire;
    if (opts?.paused !== undefined) this.paused = opts.paused;
    this.scareTimer = 0;

    if (!kind) {
      this.group.visible = false;
      return this.getStats();
    }

    const look = PLANET_SPECS[kind];
    const tiles = buildEcosystemTiles(kind);
    const terrain = createHexTerrain({ radius: RADIUS, tiles, look, colorBlindMode: false });
    this.terrain = terrain;
    this.group.add(terrain.group);

    const biosphere = terrain.biosphere;
    biosphere.setTimeOfDayOverride(this.hour / 24);
    biosphere.tick(0.05);
    this.biosphere = biosphere;

    this.applyWire(this.wire);
    this.group.visible = true;
    return this.getStats();
  }

  setHour(hour: number): WildlifeSceneStats {
    this.hour = ((hour % 24) + 24) % 24;
    this.biosphere?.setTimeOfDayOverride(this.hour / 24);
    this.biosphere?.tick(0.05);
    return this.getStats();
  }

  setPaused(paused: boolean): boolean {
    this.paused = paused;
    return this.paused;
  }

  togglePause(): boolean {
    this.paused = !this.paused;
    return this.paused;
  }

  triggerScare(): WildlifeSceneStats {
    this.scareTimer = 5.0;
    const aggressors: BiosphereAggressor[] = [{ x: 0, z: 0, radius: 14, working: true }];
    this.biosphere?.setAggressors(aggressors);
    this.biosphere?.tick(0.05);
    return this.getStats();
  }

  step(seconds = 1.0): WildlifeSceneStats {
    if (!this.biosphere) return this.getStats();
    const steps = Math.max(1, Math.round(seconds / 0.1));
    const dt = seconds / steps;
    for (let i = 0; i < steps; i++) this.advance(dt);
    return this.getStats();
  }

  update(dt: number): void {
    if (!this.kind || !this.biosphere || this.paused) return;
    this.advance(dt);
  }

  applyWire(wire: boolean): void {
    this.wire = wire;
    if (!this.biosphere) return;
    for (const m of [...this.biosphere.birdMeshes, ...this.biosphere.animalMeshes]) {
      const mat = m.material as THREE.MeshStandardMaterial;
      if (mat && 'wireframe' in mat) mat.wireframe = wire;
    }
  }

  bounds(): THREE.Box3 {
    return new THREE.Box3(new THREE.Vector3(-12, 0, -12), new THREE.Vector3(12, 11, 12));
  }

  getStats(): WildlifeSceneStats {
    const levelSpec = WILDLIFE_STORYBOOK_LEVELS.find((l) => l.kind === this.kind);
    const levelTitle = levelSpec?.title ?? 'Select a planet level';
    const empty: WildlifeSceneStats = {
      active: false, kind: this.kind, levelTitle, hour: this.hour, paused: this.paused, scareTimer: 0,
      birdSpecies: 0, birdsTotal: 0, landSpecies: 0, landAnimalsTotal: 0,
      sleeping: 0, hunting: 0, grazing: 0, fleeing: 0,
    };
    if (!this.biosphere) return empty;
    const counts = this.biosphere.counts();
    let sleeping = 0, hunting = 0, grazing = 0, fleeing = 0;
    for (const a of this.biosphere.getLandAnimals()) {
      if (a.state === 'SLEEPING') sleeping++;
      else if (a.state === 'HUNTING') hunting++;
      else if (a.state === 'EATING_GRASS' || a.state === 'BROWSING_TREES' || a.state === 'DRINKING') grazing++;
      else if (a.state === 'FLEEING_PREDATOR' || a.state === 'FLEEING_AGGRESSOR') fleeing++;
    }
    return {
      active: true,
      kind: this.kind,
      levelTitle,
      hour: this.hour,
      paused: this.paused,
      scareTimer: this.scareTimer,
      birdSpecies: counts.birdSpecies,
      birdsTotal: counts.birdsTotal,
      landSpecies: counts.landSpecies,
      landAnimalsTotal: counts.landAnimalsTotal,
      sleeping,
      hunting,
      grazing,
      fleeing,
    };
  }

  private advance(dt: number): void {
    const safeDt = Math.min(0.1, Math.max(0, dt));
    if (this.scareTimer > 0) {
      this.scareTimer = Math.max(0, this.scareTimer - safeDt);
      if (this.scareTimer === 0) this.biosphere?.setAggressors([]);
    }
    this.terrain?.tick(safeDt);
  }

  private teardown(): void {
    this.biosphere = null;
    this.terrain?.dispose();
    this.terrain = null;
  }
}
