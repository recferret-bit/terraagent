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

export function is2x2BuildingKind(kind: number): boolean {
  return BUILDING_2X2_KINDS.has(kind);
}

export function entityGroundY(terrain: HexTerrain | null, kind: number, q: number, r: number, wx: number, wz: number): number {
  if (!terrain) return 0;
  let maxY = terrain.heightAt(wx, wz);
  if (kind === ENTITY_KIND.commandHub) {
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
