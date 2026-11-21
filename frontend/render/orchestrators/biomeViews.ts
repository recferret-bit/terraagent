import * as THREE from 'three';
import type {
  BiosphereAggressor,
  BiosphereBattleHotspot,
  BiosphereHabitatIndex,
  PlanetBiosphere,
} from '../biosphere/biosphereTypes';
import { getDayNightParams, isDayNightOn, wrapSolarHour } from '../core/dayNightConfig';
import {
  scatterChunkProps,
  type ChunkPropBuckets,
  type HexPropScatter,
  type PropKind,
  type TilePropInstance,
} from '../planets/hex/chunkPropScatter';
import type { HexTileLayers } from '../planets/hex/chunkMesh';
import { GROUND_FLORA_KINDS, type GroundFloraKind, type HexFloraCounts, type HexFloraLayer } from '../planets/hex/flora/HexFloraLayer';
import { resetPropShadowLights } from '../planets/hex/propFocusCompaction';
import { MAX_AQUATIC_THREATS, type AquaticThreatZone, type WaterFauna } from '../visuals/water/fauna';
import type { AnimalsOrchestrator } from './AnimalsOrchestrator';
import type { BirdsOrchestrator } from './BirdsOrchestrator';
import type { GroundObjectsOrchestrator } from './GroundObjectsOrchestrator';
import type { ResourcesOrchestrator } from './ResourcesOrchestrator';
import type { TreesOrchestrator } from './TreesOrchestrator';

export function buildPropsView(
  propsGroup: THREE.Group,
  propTimeU: THREE.IUniform<number>,
  trees: TreesOrchestrator,
  groundObjects: GroundObjectsOrchestrator,
  resources: ResourcesOrchestrator,
): HexPropScatter {
  const meshes = {} as Record<PropKind, readonly THREE.InstancedMesh[]>;
  Object.defineProperties(meshes, {
    pine: { enumerable: true, get: () => trees.standMeshes('pine') },
    duneTree: { enumerable: true, get: () => trees.standMeshes('duneTree') },
    boulder: { enumerable: true, get: () => groundObjects.rockLayer.getMeshes('boulder') },
    spire: { enumerable: true, get: () => groundObjects.rockLayer.getMeshes('spire') },
    metals: { enumerable: true, get: () => resources.meshes('metals') },
    minerals: { enumerable: true, get: () => resources.meshes('minerals') },
    oil: { enumerable: true, get: () => resources.meshes('oil') },
  });

  return {
    group: propsGroup,
    meshes,
    timeU: propTimeU,
    setChunk(key: string, b: ChunkPropBuckets) {
      trees.setChunkTrees(key, b[trees.standKind]);
      groundObjects.setChunkRocks(key, { boulder: b.boulder, spire: b.spire });
      resources.setChunkDeposits(key, { metals: b.metals, minerals: b.minerals, oil: b.oil });
    },
    rebuildMeshes() {
      trees.rebuildDirtyStands();
      groundObjects.rebuildDirtyRocks();
      resources.rebuildDirtyDeposits();
    },
    cullToFocus() {
      trees.cullStandsToFocus();
      groundObjects.rockLayer.cullToFocus();
      resources.cullToFocus();
    },
    counts() {
      return {
        pine: trees.standCount('pine'),
        duneTree: trees.standCount('duneTree'),
        boulder: groundObjects.rockLayer.countKind('boulder'),
        spire: groundObjects.rockLayer.countKind('spire'),
        metals: resources.count('metals'),
        minerals: resources.count('minerals'),
        oil: resources.count('oil'),
      };
    },
    instancesForTile(tileIndex: number): TilePropInstance[] {
      const out: TilePropInstance[] = [];
      trees.instancesForTile(tileIndex, out);
      groundObjects.rockLayer.instancesForTile(tileIndex, out);
      resources.instancesForTile(tileIndex, out);
      return out;
    },
    pickProp(ray: THREE.Raycaster) {
      const hits = [trees.pickTree(ray), groundObjects.rockLayer.pickTileProp(ray), resources.pickResource(ray)].filter(
        (h): h is { q: number; r: number; distance: number } => h !== null,
      );
      if (hits.length === 0) return null;
      hits.sort((a, b) => a.distance - b.distance);
      return hits[0]!;
    },
    dispose() {
      resetPropShadowLights();
    },
  };
}

export function buildFloraView(
  floraGroup: THREE.Group,
  floraTimeU: THREE.IUniform<number>,
  trees: TreesOrchestrator,
  groundObjects: GroundObjectsOrchestrator,
): HexFloraLayer {
  const meshes = {} as Record<GroundFloraKind, readonly THREE.InstancedMesh[]>;
  for (const k of GROUND_FLORA_KINDS) {
    Object.defineProperty(meshes, k, {
      enumerable: true,
      get: () => (k === 'duneTree' ? trees.wadiMeshes() : groundObjects.floraLayer.getMeshes(k)),
    });
  }

  return {
    group: floraGroup,
    timeU: floraTimeU,
    meshes,
    counts(): HexFloraCounts {
      return {
        grassTuft: groundObjects.floraLayer.countKind('grassTuft'),
        wildflower: groundObjects.floraLayer.countKind('wildflower'),
        bush: groundObjects.floraLayer.countKind('bush'),
        saguaro: groundObjects.floraLayer.countKind('saguaro'),
        barrelCactus: groundObjects.floraLayer.countKind('barrelCactus'),
        reeds: groundObjects.floraLayer.countKind('reeds'),
        duneTree: trees.wadiCount(),
      };
    },
    update(layers: HexTileLayers, heightAt: (x: number, z: number) => number, changed?: ArrayLike<number>) {
      groundObjects.updateFlora(layers, heightAt, trees, changed);
    },
    cullToFocus() {
      groundObjects.floraLayer.cullToFocus();
      trees.cullWadiToFocus();
    },
    dispose() {},
  };
}

function upsertHotspot(list: BiosphereBattleHotspot[], x: number, z: number, radius: number, ttl: number): void {
  const existing = list.find((h) => Math.hypot(h.x - x, h.z - z) < 8);
  if (existing) {
    existing.radius = Math.max(existing.radius, radius);
    existing.ttl = Math.max(existing.ttl, ttl);
  } else {
    list.push({ x, z, radius, ttl });
  }
}

function decayHotspots(list: BiosphereBattleHotspot[], dt: number): void {
  for (let i = list.length - 1; i >= 0; i--) {
    list[i]!.ttl -= dt;
    if (list[i]!.ttl <= 0) list.splice(i, 1);
  }
}

function buildAquaticThreats(
  aggressors: readonly BiosphereAggressor[],
  battles: readonly BiosphereBattleHotspot[],
  disturbances: readonly BiosphereBattleHotspot[],
  habitat: BiosphereHabitatIndex,
): AquaticThreatZone[] {
  const zones: AquaticThreatZone[] = [];
  for (const bat of battles) zones.push({ x: bat.x, z: bat.z, radius: bat.radius + 10, strength: 1.35 });
  for (const ds of disturbances) zones.push({ x: ds.x, z: ds.z, radius: ds.radius + 8, strength: 1.15 });
  for (const ag of aggressors) {
    zones.push({ x: ag.x, z: ag.z, radius: (ag.radius ?? 11) + (ag.working ? 5 : 2), strength: ag.working ? 1.15 : 0.85 });
  }
  for (let i = 0; i < habitat.colonizedAnchors.length && zones.length < MAX_AQUATIC_THREATS; i += 4) {
    const col = habitat.colonizedAnchors[i]!;
    zones.push({ x: col.x, z: col.z, radius: 9, strength: 0.65 });
  }
  zones.sort((a, b) => b.strength - a.strength);
  return zones.slice(0, MAX_AQUATIC_THREATS);
}

export function buildBiosphereView(
  bioGroup: THREE.Group,
  bioTimeU: THREE.IUniform<number>,
  birds: BirdsOrchestrator,
  animals: AnimalsOrchestrator,
  initialHabitat: BiosphereHabitatIndex,
  waterFauna: WaterFauna | null,
): PlanetBiosphere {
  let habitat = initialHabitat;
  let aggressors: readonly BiosphereAggressor[] = [];
  const battles: BiosphereBattleHotspot[] = [];
  const disturbances: BiosphereBattleHotspot[] = [];
  let timeOverride01: number | null = null;
  let elapsed = 0;

  return {
    group: bioGroup,
    birdMeshes: birds.meshes,
    animalMeshes: animals.meshes,
    counts: () => ({ ...birds.counts(), ...animals.counts() }),
    getBirdFlocks: () => birds.flocks,
    getLandAnimals: () => animals.agents,
    setAggressors(next) { aggressors = next; },
    noteBattleAt: (x, z, r = 14, ttl = 6.0) => upsertHotspot(battles, x, z, r, ttl),
    noteHabitatDisturbance: (x, z, r = 14, ttl = 7.0) => upsertHotspot(disturbances, x, z, r, ttl),
    setTimeOfDayOverride(t01) { timeOverride01 = t01; },
    onHabitatChanged(next) { habitat = next; },
    tick(dt: number) {
      const safeDt = Math.max(0, dt);
      elapsed += safeDt;
      bioTimeU.value = elapsed;
      decayHotspots(battles, safeDt);
      decayHotspots(disturbances, safeDt);
      const solarHour24 =
        timeOverride01 !== null
          ? (((timeOverride01 % 1) + 1) % 1) * 24
          : isDayNightOn()
            ? wrapSolarHour(getDayNightParams().timeOfDay)
            : wrapSolarHour(getDayNightParams().timeOfDay + elapsed * 0.08);
      birds.step(safeDt, habitat, aggressors, battles, disturbances);
      animals.step(safeDt, solarHour24, habitat, aggressors, battles, disturbances);
      waterFauna?.setThreats(buildAquaticThreats(aggressors, battles, disturbances, habitat));
    },
    dispose() {
      battles.length = 0;
      disturbances.length = 0;
    },
  };
}

export function resyncChunkSubOrchestrators(
  radius: number,
  chunkKey: string,
  chunkTiles: ArrayLike<number>,
  layers: HexTileLayers,
  heightAt: (x: number, z: number) => number,
  trees: TreesOrchestrator,
  groundObjects: GroundObjectsOrchestrator,
  resources: ResourcesOrchestrator,
): void {
  const b = scatterChunkProps(radius, chunkTiles, layers, heightAt);
  trees.setChunkTrees(chunkKey, b[trees.standKind]);
  groundObjects.setChunkRocks(chunkKey, { boulder: b.boulder, spire: b.spire });
  resources.setChunkDeposits(chunkKey, { metals: b.metals, minerals: b.minerals, oil: b.oil });
}
