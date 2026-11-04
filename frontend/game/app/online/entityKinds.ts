import * as THREE from 'three';
import type { PlanetKind } from '@terra/render/planets/PlanetSpec';
import { tileXZ, type HexTerrain } from '@terra/render/planets/hex';
import { ENTITY_KIND, ENTITY_STATE } from '@terra/sim';

const ARCHETYPE_BY_KIND: Readonly<Record<number, string>> = {
  [ENTITY_KIND.hq]: 'robot.hero',
  [ENTITY_KIND.pod]: 'ship.dropPod',
  [ENTITY_KIND.commandHub]: 'building.commandHub',
  [ENTITY_KIND.metalsExtractor]: 'building.mine',
  [ENTITY_KIND.solar]: 'building.solar',
  [ENTITY_KIND.tradeHub]: 'building.tradeHub',
  [ENTITY_KIND.pylon]: 'building.pylon',
  [ENTITY_KIND.capacitor]: 'building.capacitor',
  [ENTITY_KIND.wind]: 'building.wind',
  [ENTITY_KIND.thermal]: 'building.coalGen',
  [ENTITY_KIND.supplyDepot]: 'building.supplyDepot',
  [ENTITY_KIND.mineralsQuarry]: 'building.mine',
  [ENTITY_KIND.waterExtractor]: 'building.waterPump',
  [ENTITY_KIND.petroleumWell]: 'building.mine',
  [ENTITY_KIND.harvester]: 'robot.miner',
  [ENTITY_KIND.builder]: 'robot.builder',
  [ENTITY_KIND.roboticsFactory]: 'building.roboticsFactory',
  [ENTITY_KIND.droneControlArray]: 'building.droneControlArray',
  [ENTITY_KIND.autocannon]: 'building.turret',
  [ENTITY_KIND.laserTower]: 'building.laserTower',
  [ENTITY_KIND.recon]: 'robot.recon',
  [ENTITY_KIND.demoTank]: 'robot.tank',
  [ENTITY_KIND.demoArtillery]: 'robot.artillery',
  [ENTITY_KIND.blackAnt]: 'fauna.blackAnt',
  [ENTITY_KIND.blueBeetle]: 'fauna.blueBeetle',
  [ENTITY_KIND.greenSpitter]: 'fauna.greenSpitter',
  [ENTITY_KIND.hiveBlackAnt]: 'fauna.hive.blackAnt',
  [ENTITY_KIND.hiveBlueBeetle]: 'fauna.hive.blueBeetle',
  [ENTITY_KIND.hiveGreenSpitter]: 'fauna.hive.greenSpitter',
};

const CONSTRUCTIBLE_KINDS: ReadonlySet<number> = new Set([
  ENTITY_KIND.commandHub,
  ENTITY_KIND.tradeHub,
  ENTITY_KIND.metalsExtractor,
  ENTITY_KIND.solar,
  ENTITY_KIND.pylon,
  ENTITY_KIND.capacitor,
  ENTITY_KIND.wind,
  ENTITY_KIND.thermal,
  ENTITY_KIND.supplyDepot,
  ENTITY_KIND.mineralsQuarry,
  ENTITY_KIND.waterExtractor,
  ENTITY_KIND.petroleumWell,
  ENTITY_KIND.roboticsFactory,
  ENTITY_KIND.droneControlArray,
  ENTITY_KIND.autocannon,
  ENTITY_KIND.laserTower,
]);

const BUILDING_2X2_KINDS: ReadonlySet<number> = new Set([
  ENTITY_KIND.tradeHub,
  ENTITY_KIND.metalsExtractor,
  ENTITY_KIND.solar,
  ENTITY_KIND.capacitor,
  ENTITY_KIND.wind,
  ENTITY_KIND.thermal,
  ENTITY_KIND.supplyDepot,
  ENTITY_KIND.mineralsQuarry,
  ENTITY_KIND.waterExtractor,
  ENTITY_KIND.petroleumWell,
  ENTITY_KIND.droneControlArray,
  ENTITY_KIND.autocannon,
  ENTITY_KIND.laserTower,
]);

const FOOTPRINT_3X3_KINDS: ReadonlySet<number> = new Set([
  ENTITY_KIND.commandHub,
  ENTITY_KIND.roboticsFactory,
  ENTITY_KIND.hiveBlackAnt,
  ENTITY_KIND.hiveBlueBeetle,
  ENTITY_KIND.hiveGreenSpitter,
]);

const ANIMATED_BUILDING_KINDS: ReadonlySet<number> = new Set([
  ENTITY_KIND.commandHub,
  ENTITY_KIND.tradeHub,
  ENTITY_KIND.metalsExtractor,
  ENTITY_KIND.wind,
  ENTITY_KIND.thermal,
  ENTITY_KIND.mineralsQuarry,
  ENTITY_KIND.waterExtractor,
  ENTITY_KIND.petroleumWell,
  ENTITY_KIND.roboticsFactory,
  ENTITY_KIND.droneControlArray,
  ENTITY_KIND.autocannon,
  ENTITY_KIND.laserTower,
  ENTITY_KIND.hiveBlackAnt,
  ENTITY_KIND.hiveBlueBeetle,
  ENTITY_KIND.hiveGreenSpitter,
]);

const TRACKED_WALKING_UNIT_KINDS: ReadonlySet<number> = new Set([
  ENTITY_KIND.hq,
  ENTITY_KIND.harvester,
  ENTITY_KIND.builder,
  ENTITY_KIND.recon,
  ENTITY_KIND.demoTank,
  ENTITY_KIND.demoArtillery,
  ENTITY_KIND.blackAnt,
  ENTITY_KIND.blueBeetle,
  ENTITY_KIND.greenSpitter,
]);

export function archetypeForKind(kind: number): string {
  // devProbe (W00 test entity) and any kind without its own model: a registered unit archetype (XC-25)
  return ARCHETYPE_BY_KIND[kind] ?? 'robot.builder';
}

export function isConstructibleBuilding(kind: number): boolean {
  return CONSTRUCTIBLE_KINDS.has(kind);
}

export function isWorkerUnitKind(kind: number): boolean {
  return kind === ENTITY_KIND.hq || kind === ENTITY_KIND.harvester || kind === ENTITY_KIND.builder || kind === ENTITY_KIND.devProbe;
}

export function isTrackedWalkingUnitKind(kind: number): boolean {
  return TRACKED_WALKING_UNIT_KINDS.has(kind);
}

export function is2x2BuildingKind(kind: number): boolean {
  return BUILDING_2X2_KINDS.has(kind);
}

export function is3x3FootprintKind(kind: number): boolean {
  return FOOTPRINT_3X3_KINDS.has(kind);
}

export function entityGroundY(terrain: HexTerrain | null, kind: number, q: number, r: number, wx: number, wz: number): number {
  if (!terrain) return 0;
  let maxY = terrain.heightAt(wx, wz);
  if (is3x3FootprintKind(kind)) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dq = -1; dq <= 1; dq++) {
        const [tx, tz] = tileXZ(q + dq, r + dr);
        maxY = Math.max(maxY, terrain.heightAt(tx, tz));
      }
    }
  } else if (is2x2BuildingKind(kind)) {
    for (let dr = 0; dr < 2; dr++) {
      for (let dq = 0; dq < 2; dq++) {
        const [tx, tz] = tileXZ(q + dq, r + dr);
        maxY = Math.max(maxY, terrain.heightAt(tx, tz));
      }
    }
  }
  return maxY;
}

export function computeWorkTarget(kind: number, state: number, isDaylight: boolean): number {
  if (kind === ENTITY_KIND.solar) return state === ENTITY_STATE.active && isDaylight ? 1 : 0;
  if (ANIMATED_BUILDING_KINDS.has(kind)) {
    return state === ENTITY_STATE.active || state === ENTITY_STATE.working ? 1 : 0;
  }
  return state === ENTITY_STATE.working || state === ENTITY_STATE.constructing || state === ENTITY_STATE.harvesting || state === ENTITY_STATE.repairing ? 1 : 0;
}

export function hubBuildProgressForState(state: number, progress: number): number {
  if (state === ENTITY_STATE.waiting) return 0;
  if (state === ENTITY_STATE.constructing) return progress;
  return 1;
}

export function entityWorldXZ(kind: number, x: number, y: number): [number, number] {
  return is2x2BuildingKind(kind) ? tileXZ(x + 0.5, y + 0.5) : tileXZ(x, y);
}

export function planetKindForBiome(biomeKey: string): PlanetKind {
  if (biomeKey === 'desert' || biomeKey === 'dune') return 'dune';
  if (biomeKey === 'ocean' || biomeKey === 'oceanForest') return 'oceanForest';
  return 'forestRock';
}

export function makeGroundRing(innerR: number, outerR: number, color: number, name: string): THREE.Mesh {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(innerR, outerR, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, fog: false }),
  );
  ring.name = name;
  ring.visible = false;
  return ring;
}
