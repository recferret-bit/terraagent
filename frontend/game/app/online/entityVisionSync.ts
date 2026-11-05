import * as THREE from 'three';
import { computeSolarState, getDayNightParams, isDayNightOn } from '@terra/render/core/dayNightConfig';
import {
  applyBuildingLight,
  attachEntityProjectorRig,
  peekArchetypeLights,
  stepLightLevel,
  getColonyLightingBlend,
  isWorldPointInColonyFov,
  MAX_PROJECTOR_CANDIDATES,
  MAX_VISION_SOURCES,
  resetColonyVisionAndLights,
  setColonyLightingBlend,
  updateColonyProjectorsAndVision,
  updateColonyVisionTexture,
  type ColonyProjectorDesc,
  type ColonyVisionSourceDesc,
} from '@terra/render/lighting';
import type { HexTerrain } from '@terra/render/planets/hex';
import { ENTITY_KIND, ENTITY_STATE, entityLightLevel } from '@terra/sim';
import type { ClientTiles } from '../../store/replica/viewCodec';
import { archetypeForKind, type EntityMeshRecord } from './EntityMeshes';
import { isEntityInViewFocus } from './entityFocus';

export { isWorldPointInColonyFov, resetColonyVisionAndLights };

const _projColor = new THREE.Color();

export function lightArchetypeForKind(kind: number): string {
  if (kind === ENTITY_KIND.commandHub) return 'building.commandHub';
  if (kind === ENTITY_KIND.metalsExtractor) return 'building.mine';
  if (kind === ENTITY_KIND.solar) return 'building.solar';
  if (kind === ENTITY_KIND.tradeHub) return 'building.tradeHub';
  if (kind === ENTITY_KIND.pod) return 'ship.dropPod';
  if (kind === ENTITY_KIND.hq) return 'robot.hero';
  if (kind === ENTITY_KIND.harvester) return 'robot.miner';
  if (kind === ENTITY_KIND.devProbe) return 'robot.scout';
  return archetypeForKind(kind);
}

export function scaleForKind(kind: number): number {
  if (kind === ENTITY_KIND.commandHub) return 1.55;
  if (kind === ENTITY_KIND.metalsExtractor) return 1.3;
  if (kind === ENTITY_KIND.solar) return 1.3;
  if (kind === ENTITY_KIND.tradeHub) return 1.3;
  if (kind === ENTITY_KIND.pod) return 1.15;
  if (kind === ENTITY_KIND.hq) return 1.15;
  if (kind === ENTITY_KIND.harvester) return 1.05;
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
  meshScale: number;
  rangeScale: number;
  lightScale: number;
  stateMul: number;
}): void {
  const { projectors, archetypeId, ux, uy, uz, yaw, meshScale, rangeScale, lightScale, stateMul } = opts;
  const effScale = lightScale * stateMul;
  if (effScale <= 0.005) return;

  const sources = peekArchetypeLights(archetypeId);
  const cosY = Math.cos(yaw);
  const sinY = Math.sin(yaw);

  for (const src of sources) {
    if (projectors.length >= MAX_PROJECTOR_CANDIDATES) break; // the renderer uploads only the on-screen nearest
    const [px, py, pz] = src.pos;
    const [tx, ty, tz] = src.target;

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

    const spread = Math.max(src.coneBottomRadius, src.poolRadius) * 1.55 * meshScale;
    const cosAngle = Math.max(0.52, Math.min(0.82, len / Math.hypot(len, spread)));

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
  baseCenters: Array<{ x: number; z: number; innerRadius: number; outerRadius: number }>,
  visionSources: ColonyVisionSourceDesc[],
  projectors: ColonyProjectorDesc[],
  lightScale: number,
  stateMul: number,
): void {
  const ux = rec.mesh.position.x;
  const uy = rec.mesh.position.y;
  const uz = rec.mesh.position.z;
  const yaw = rec.mesh.rotation.y;
  const projOpts = {
    projectors,
    archetypeId: lightArchetypeForKind(rec.kind),
    ux,
    uy,
    uz,
    yaw,
    meshScale: rec.mesh.scale.x || 1,
    rangeScale: scaleForKind(rec.kind),
    lightScale,
    stateMul,
  };

  if (rec.kind === ENTITY_KIND.commandHub || rec.kind === ENTITY_KIND.pod) {
    const innerRadius = rec.kind === ENTITY_KIND.commandHub ? 21 : 17;
    const outerRadius = rec.kind === ENTITY_KIND.commandHub ? 30 : 24;
    baseCenters.push({ x: rec.targetPos.x, z: rec.targetPos.z, innerRadius, outerRadius });
    if (visionSources.length < MAX_VISION_SOURCES) {
      visionSources.push({ x: ux, z: uz, innerRadius, outerRadius });
    }
    if (rec.mesh.visible) appendArchetypeProjectors(projOpts);
    return;
  }

  if (rec.kind === ENTITY_KIND.metalsExtractor || rec.kind === ENTITY_KIND.solar || rec.kind === ENTITY_KIND.tradeHub) {
    if (rec.state !== ENTITY_STATE.waiting && visionSources.length < MAX_VISION_SOURCES) {
      visionSources.push({ x: ux, z: uz, innerRadius: 10, outerRadius: 15 });
    }
    if (rec.mesh.visible) appendArchetypeProjectors(projOpts);
    return;
  }

  if (rec.state === ENTITY_STATE.descending || !rec.mesh.visible) return;
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  if (visionSources.length < MAX_VISION_SOURCES) {
    visionSources.push({ x: ux + fx * 2.8, z: uz + fz * 2.8, innerRadius: 3.5, outerRadius: 6.2 });
  }
  if (visionSources.length < MAX_VISION_SOURCES) {
    visionSources.push({ x: ux + fx * 7.5, z: uz + fz * 7.5, innerRadius: 8.0, outerRadius: 13.5 });
  }
  appendArchetypeProjectors(projOpts);
}

/** Seconds the colony FoV shroud / night factor / projectors take to ease in after the descent hands over. */
export const COLONY_FADE_IN_S = 0.8;
let lastBlendMs = -1;
/** Wall seconds (≤ 0.1) between the last two `syncColonyVisionAndProjectors` calls: the light fade step. */
let lastDtS = 0;

/**
 * 0 while the space phase / descent renders, then eases 0 → 1 over `COLONY_FADE_IN_S` of wall time. The value lives
 * in `setColonyLightingBlend` (starts at 1, so a session that never ran a descent, e.g. `?skip=1`, is fully on).
 */
function stepColonyBlend(active: boolean): number {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const dt = lastBlendMs < 0 ? 0 : Math.min(0.1, Math.max(0, (now - lastBlendMs) / 1000));
  lastBlendMs = now;
  lastDtS = dt;
  setColonyLightingBlend(active ? getColonyLightingBlend() + dt / COLONY_FADE_IN_S : 0);
  return getColonyLightingBlend();
}

/**
 * Synchronizes 3D projector rigs, directional GPU projector lights, and the restricted Field of View
 * (around user base territory, owned buildings, and owned units) for the active online colony scene.
 */
export function syncColonyVisionAndProjectors(opts: {
  records: Iterable<EntityMeshRecord>;
  ownerColonyIndex: number;
  terrain: HexTerrain | null;
  tiles: ClientTiles | null;
  /**
   * False while the descent cinematic renders (its surface, pod and sky are not in colony coordinates): FoV shroud,
   * night factor and projectors are held off, then eased in over `COLONY_FADE_IN_S` once the colony takes over.
   */
  colonyActive?: boolean;
}): void {
  const { records, ownerColonyIndex, terrain, tiles } = opts;
  const blend = stepColonyBlend(opts.colonyActive ?? true);
  const dnParams = getDayNightParams();
  const solar = computeSolarState(dnParams);
  const sunElevSin = Math.sin(((solar.hour / 24) - 0.25) * Math.PI * 2);
  const nightGate = !isDayNightOn() ? 0 : THREE.MathUtils.smoothstep(-sunElevSin, 0.001, 0.035) * blend;
  const nightFactor = !isDayNightOn() ? 0 : Math.max(1 - solar.daylight, nightGate * 0.88) * blend;
  const rigIntensity = (0.22 + 0.78 * nightFactor) * dnParams.projectorIntensity * nightGate;
  const lightScale = (0.32 + 0.98 * nightFactor) * dnParams.projectorIntensity * nightGate;

  const baseCenters: Array<{ x: number; z: number; innerRadius: number; outerRadius: number }> = [];
  const visionSources: ColonyVisionSourceDesc[] = [];
  const projectors: ColonyProjectorDesc[] = [];

  for (const rec of records) {
    const archetypeId = archetypeForKind(rec.kind);
    // The building light state (power, brownout group, construction) is decided by `entityLightLevel` in the sim; the
    // renderer only eases to it and applies it through `applyBuildingLight`.
    const target = entityLightLevel({ kind: rec.kind, state: rec.state, buildStage: rec.buildStage }, nightFactor);
    rec.lightLevel = rec.lightLevel === undefined ? target : stepLightLevel(rec.lightLevel, target, lastDtS);
    const stateMul = rec.lightLevel;
    attachEntityProjectorRig(rec.mesh, archetypeId);
    if (isEntityInViewFocus(rec.mesh)) applyBuildingLight(rec.mesh, stateMul, rigIntensity, rec.buildStage);

    if (rec.owner === ownerColonyIndex) {
      collectOwnedEntityVisionAndProjectors(rec, baseCenters, visionSources, projectors, lightScale, stateMul);
    }
  }

  if (terrain) {
    updateColonyVisionTexture({
      radius: terrain.radius,
      colonyIndex: ownerColonyIndex,
      owner: tiles?.owner,
      explored: tiles?.explored,
      baseCenters,
    });
  }

  updateColonyProjectorsAndVision({
    projectors: lightScale <= 0.005 ? [] : projectors,
    visionSources: blend > 0 ? visionSources : [],
    fovEnabled: Boolean(terrain) && blend > 0,
    fovStrength: blend,
    fovDim: dnParams.fovDim,
    nightFactor,
  });
}
