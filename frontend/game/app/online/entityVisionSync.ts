import * as THREE from 'three';
import { colonyNightBlend, computeSolarState, getDayNightParams, isDayNightOn } from '@terra/render/core/dayNightConfig';
import {
  applyBuildingLight,
  attachEntityProjectorRig,
  getColonyVisionUniforms,
  peekArchetypeLights,
  projectorCosOuter,
  stepLightLevel,
  isWorldPointInColonyFov,
  MAX_PROJECTOR_CANDIDATES,
  resetColonyVisionAndLights,
  setColonyLightingBlend,
  updateColonyProjectorsAndVision,
  updateColonyVisionTexture,
  type ColonyProjectorDesc,
  type ColonyVisionSourceDesc,
} from '@terra/render/lighting';
import { TILE_M, type HexTerrain } from '@terra/render/planets/hex';
import {
  ENTITY_KIND,
  ENTITY_STATE,
  entityLightLevel,
  getEntitySpottingRadius,
  isColonyVisionSourceKind,
  isEntityContributingVision,
  type CompiledDataLike,
} from '@terra/sim';
import type { ClientTiles } from '../../store/replica/viewCodec';
import { archetypeForKind, type EntityMeshRecord } from './EntityMeshes';
import { isEntityInViewFocus } from './entityFocus';

export { isWorldPointInColonyFov, resetColonyVisionAndLights };

const _projColor = new THREE.Color();

export function lightArchetypeForKind(kind: number, tier?: number): string {
  if (kind === ENTITY_KIND.commandHub) return 'building.commandHub';
  if (kind === ENTITY_KIND.metalsExtractor) return 'building.mine';
  if (kind === ENTITY_KIND.solar) return 'building.solar';
  if (kind === ENTITY_KIND.tradeHub) return 'building.tradeHub';
  if (kind === ENTITY_KIND.pod) return 'ship.dropPod';
  if (kind === ENTITY_KIND.hq) return 'robot.hero';
  if (kind === ENTITY_KIND.worker) return archetypeForKind(kind, tier);
  if (kind === ENTITY_KIND.devProbe) return 'robot.scout';
  return archetypeForKind(kind, tier);
}

export function scaleForKind(kind: number, tier?: number): number {
  if (kind === ENTITY_KIND.commandHub) return 1.55;
  if (kind === ENTITY_KIND.metalsExtractor) return 1.3;
  if (kind === ENTITY_KIND.solar) return 1.3;
  if (kind === ENTITY_KIND.tradeHub) return 1.3;
  if (kind === ENTITY_KIND.pod) return 1.15;
  if (kind === ENTITY_KIND.hq) return 1.15;
  if (kind === ENTITY_KIND.worker) return tier === 2 || tier === 3 ? 1 : 1.05;
  if (kind === ENTITY_KIND.devProbe) return 0.95;
  return 1.0;
}

function appendArchetypeProjectors(opts: {
  projectors: ColonyProjectorDesc[];
  archetypeId: string;
  ux: number;
  uy: number;
  uz: number;
  yaw: number;
  turretYaw: number;
  meshScale: number;
  rangeScale: number;
  lightScale: number;
  stateMul: number;
}): void {
  const { projectors, archetypeId, ux, uy, uz, yaw, turretYaw, meshScale, rangeScale, lightScale, stateMul } = opts;
  const effScale = lightScale * stateMul;
  if (effScale <= 0.005) return;

  const sources = peekArchetypeLights(archetypeId);
  const cosY = Math.cos(yaw);
  const sinY = Math.sin(yaw);

  for (const src of sources) {
    if (projectors.length >= MAX_PROJECTOR_CANDIDATES) break; // the renderer uploads only the on-screen nearest
    let [px, py, pz] = src.pos;
    let [tx, ty, tz] = src.target;
    if (src.turretMounted && turretYaw !== 0) {
      const [pivX, pivZ] = src.turretPivot ?? [0, 0];
      const ct = Math.cos(turretYaw), st = Math.sin(turretYaw);
      const rpx = px - pivX, rpz = pz - pivZ;
      px = pivX + rpx * ct + rpz * st;
      pz = pivZ - rpx * st + rpz * ct;
      const rtx = tx - pivX, rtz = tz - pivZ;
      tx = pivX + rtx * ct + rtz * st;
      tz = pivZ - rtx * st + rtz * ct;
    }

    const worldPosX = ux + (px * cosY + pz * sinY) * meshScale;
    const worldPosY = uy + py * meshScale;
    const worldPosZ = uz + (-px * sinY + pz * cosY) * meshScale;

    const worldTargetX = ux + (tx * cosY + tz * sinY) * meshScale;
    const worldTargetY = uy + ty * meshScale;
    const worldTargetZ = uz + (-tx * sinY + tz * cosY) * meshScale;

    const dx = worldTargetX - worldPosX;
    const dy = worldTargetY - worldPosY;
    const dz = worldTargetZ - worldPosZ;
    const len = Math.max(1e-4, Math.hypot(dx, dy, dz));

    const cosAngle = projectorCosOuter(src); // the same cone the beam mesh draws (`projectorCone.ts`)

    _projColor.setHex(src.color);
    projectors.push({
      x: worldPosX,
      y: worldPosY,
      z: worldPosZ,
      range: src.range * rangeScale * meshScale,
      dirX: dx / len,
      dirY: dy / len,
      dirZ: dz / len,
      cosAngle,
      r: _projColor.r,
      g: _projColor.g,
      b: _projColor.b,
      intensity: src.intensity * effScale,
    });
  }
}

function collectOwnedEntityVisionAndProjectors(
  rec: EntityMeshRecord,
  visionSources: ColonyVisionSourceDesc[],
  projectors: ColonyProjectorDesc[],
  lightScale: number,
  stateMul: number,
  data?: CompiledDataLike,
): void {
  const ux = rec.mesh.position.x;
  const uy = rec.mesh.position.y;
  const uz = rec.mesh.position.z;
  const yaw = rec.mesh.rotation.y;
  const projOpts = {
    projectors,
    archetypeId: lightArchetypeForKind(rec.kind, rec.tier),
    ux,
    uy,
    uz,
    yaw,
    turretYaw: (rec.mesh.userData as { turretYaw?: number } | undefined)?.turretYaw ?? 0,
    meshScale: rec.mesh.scale.x || 1,
    rangeScale: scaleForKind(rec.kind, rec.tier),
    lightScale,
    stateMul,
  };

  // Lighting cones are cosmetic. Sight is omnidirectional and uses the shared simulation radius.
  // A drop pod, a spawn marker, and any other prop do not open the fog. Buildings and units do.
  if (rec.hp > 0 && isColonyVisionSourceKind(rec.kind) && isEntityContributingVision(rec.state, rec.kind)) {
    const outerRadius = getEntitySpottingRadius(rec.kind, data) * TILE_M;
    if (outerRadius > 0) visionSources.push({ x: ux, z: uz, innerRadius: outerRadius * 0.88, outerRadius });
  }
  if (rec.mesh.visible && rec.state !== ENTITY_STATE.descending) appendArchetypeProjectors(projOpts);
}

/** Seconds the colony FoV shroud and projector cones take to ease in after the descent hands over. */
export const COLONY_FADE_IN_S = 0.8;
let lastBlendMs = -1;
/** Wall seconds (≤ 0.1) between the last two `syncColonyVisionAndProjectors` calls: the light fade step. */
let lastDtS = 0;
let fovBlend = 1;

function stepFovBlend(active: boolean): number {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const dt = lastBlendMs < 0 ? 0 : Math.min(0.1, Math.max(0, (now - lastBlendMs) / 1000));
  lastBlendMs = now;
  lastDtS = dt;
  fovBlend = active ? Math.min(1, fovBlend + dt / COLONY_FADE_IN_S) : 0;
  if (active) setColonyLightingBlend(1);
  return fovBlend;
}

/**
 * Synchronizes 3D projector rigs, directional GPU projector lights, and the restricted Field of View
 * (around user base territory, owned buildings, and owned units) for the active online colony scene.
 */
export function syncColonyVisionAndProjectors(opts: {
  data?: CompiledDataLike;
  records: Iterable<EntityMeshRecord>;
  ownerColonyIndex: number;
  terrain: HexTerrain | null;
  tiles: ClientTiles | null;
  /**
   * False while the descent cinematic renders (its surface, pod and sky are driven by `SkyRig`): FoV shroud and
   * colony projectors stay off, then ease in over `COLONY_FADE_IN_S` once the colony takes over without dipping `uNightFactor`.
   */
  colonyActive?: boolean;
  /** Spectator all-bots FoV mode: unites live vision, projectors, and explored memory across every active colony. */
  spectatorAllVision?: boolean;
}): void {
  const { records, ownerColonyIndex, terrain, tiles, spectatorAllVision } = opts;
  const active = opts.colonyActive ?? true;
  const blend = stepFovBlend(active);
  const dnParams = getDayNightParams();
  const solar = computeSolarState(dnParams);
  const night = isDayNightOn() ? colonyNightBlend(solar.hour, solar.daylight) : { nightFactor: 0, nightGate: 0 };
  const nightGate = night.nightGate * blend;
  const nightFactor = night.nightFactor;
  const rigIntensity = (0.22 + 0.78 * nightFactor) * dnParams.projectorIntensity * nightGate;
  const lightScale = (0.32 + 0.98 * nightFactor) * dnParams.projectorIntensity * nightGate;

  const visionSources: ColonyVisionSourceDesc[] = [];
  const projectors: ColonyProjectorDesc[] = [];

  for (const rec of records) {
    const archetypeId = archetypeForKind(rec.kind, rec.tier);
    // The building light state (power, brownout group, construction) is decided by `entityLightLevel` in the sim; the
    // renderer only eases to it and applies it through `applyBuildingLight`.
    const target = entityLightLevel({ kind: rec.kind, state: rec.state, buildStage: rec.buildStage }, nightFactor);
    rec.lightLevel = rec.lightLevel === undefined ? target : stepLightLevel(rec.lightLevel, target, lastDtS);
    const stateMul = rec.lightLevel;
    attachEntityProjectorRig(rec.mesh, archetypeId);
    if (isEntityInViewFocus(rec.mesh)) applyBuildingLight(rec.mesh, stateMul, rigIntensity, rec.buildStage);

    if (spectatorAllVision ? rec.owner >= 0 : rec.owner === ownerColonyIndex) {
      collectOwnedEntityVisionAndProjectors(rec, visionSources, projectors, lightScale, stateMul, opts.data);
    }
  }

  if (terrain && active) {
    if (spectatorAllVision && (tiles?.exploredByColony || tiles?.explored)) {
      const arrays = Object.values(tiles.exploredByColony ?? {}).filter(
        (a): a is Uint8Array => Boolean(a && a.length > 0),
      );
      const tileCount = tiles.count ?? tiles.explored?.length ?? 0;
      const bitBytes = Math.max(
        tileCount > 0 ? Math.ceil(tileCount / 8) : 0,
        arrays.reduce((m, a) => Math.max(m, a.length), 0),
      );
      const mergedBitset = bitBytes > 0 ? new Uint8Array(bitBytes) : undefined;
      if (mergedBitset) {
        for (const arr of arrays) {
          for (let b = 0; b < arr.length; b++) mergedBitset[b]! |= arr[b]!;
        }
        if (tiles.explored) {
          for (let t = 0; t < tiles.explored.length; t++) {
            if (tiles.explored[t]! !== 0) mergedBitset[t >> 3]! |= 1 << (t & 7);
          }
        }
      }
      updateColonyVisionTexture({
        radius: terrain.radius,
        colonyIndex: 0,
        exploredByColony: mergedBitset ? { 0: mergedBitset } : undefined,
        visionSources,
      });
    } else {
      updateColonyVisionTexture({
        radius: terrain.radius,
        colonyIndex: ownerColonyIndex,
        explored: tiles?.explored,
        exploredByColony: tiles?.exploredByColony,
        visionSources,
      });
    }
  }

  updateColonyProjectorsAndVision({
    projectors: lightScale <= 0.005 ? [] : projectors,
    visionSources: blend > 0 ? visionSources : [],
    fovEnabled: Boolean(terrain) && blend > 0,
    fovStrength: blend,
    fovDim: dnParams.fovDim,
    nightFactor: active ? nightFactor : undefined,
  });
}

export function syncEntitiesVisionAndForeignVisibility(opts: {
  data?: CompiledDataLike;
  entries: Map<number, EntityMeshRecord>;
  ownerColonyIndex: number;
  terrain: HexTerrain | null;
  hasTerrain: boolean;
  tiles: ClientTiles | null;
  colonyActive: boolean;
  spectatorAllVision: boolean;
  isTileVisible: ((q: number, r: number) => boolean) | null;
  isMeshVisible: (rec: EntityMeshRecord) => boolean;
}): void {
  const { entries, ownerColonyIndex, terrain, hasTerrain, tiles, colonyActive, spectatorAllVision, isTileVisible, isMeshVisible } = opts;
  syncColonyVisionAndProjectors({
    records: entries.values(), data: opts.data, ownerColonyIndex, terrain, tiles, colonyActive, spectatorAllVision,
  });
  const fogOn = (getColonyVisionUniforms().uFovEnabled.value as number) > 0.001;
  for (const rec of entries.values()) {
    const foreign = spectatorAllVision ? rec.owner < 0 : rec.owner !== ownerColonyIndex;
    const ownPod = !spectatorAllVision && !foreign && rec.kind === ENTITY_KIND.pod;
    if (!foreign && !(ownPod && fogOn)) continue;
    const spotted = !isTileVisible || isTileVisible(rec.q, rec.r);
    const inCircle = !hasTerrain || isWorldPointInColonyFov(rec.mesh.position.x, rec.mesh.position.z);
    rec.mesh.visible = spotted && inCircle && isMeshVisible(rec);
  }
}
