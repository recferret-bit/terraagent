import { computeSolarState, getDayNightParams, isDayNightOn } from '@terra/render/core/dayNightConfig';
import {
  attachEntityProjectorRig,
  isWorldPointInColonyFov,
  MAX_COLONY_PROJECTORS,
  MAX_VISION_SOURCES,
  resetColonyVisionAndLights,
  updateColonyProjectorsAndVision,
  updateColonyVisionTexture,
  updateEntityProjectorRig,
  type ColonyProjectorDesc,
  type ColonyVisionSourceDesc,
} from '@terra/render/lighting';
import type { HexTerrain } from '@terra/render/planets/hex';
import { ENTITY_KIND, ENTITY_STATE } from '@terra/sim';
import type { ClientTiles } from '../../store/replica/viewCodec';
import { archetypeForKind, type EntityMeshRecord } from './EntityMeshes';

export { isWorldPointInColonyFov, resetColonyVisionAndLights };

function appendBuildingProjectors(
  projectors: ColonyProjectorDesc[],
  ux: number,
  uy: number,
  uz: number,
  lightScale: number,
  buildStage: number,
): void {
  const stageMul = buildStage <= 0.01 ? 0.35 : 0.45 + 0.55 * buildStage;
  if (projectors.length < MAX_COLONY_PROJECTORS) {
    projectors.push({
      x: ux,
      y: uy + 4.2,
      z: uz,
      range: 22.0,
      dirX: 0,
      dirY: -1,
      dirZ: 0,
      cosAngle: -1,
      r: 1.0,
      g: 0.89,
      b: 0.68,
      intensity: 1.85 * lightScale * stageMul,
    });
  }
  const corners: readonly [number, number][] = [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ];
  for (const [sx, sz] of corners) {
    if (projectors.length >= MAX_COLONY_PROJECTORS) break;
    const inv = 1 / Math.hypot(sx * 0.78, 0.62, sz * 0.78);
    projectors.push({
      x: ux + sx * 2.1,
      y: uy + 1.9,
      z: uz + sz * 2.0,
      range: 14.5,
      dirX: sx * 0.78 * inv,
      dirY: -0.62 * inv,
      dirZ: sz * 0.78 * inv,
      cosAngle: 0.64,
      r: 1.0,
      g: 0.88,
      b: 0.66,
      intensity: 1.25 * lightScale * stageMul,
    });
  }
}

function appendRobotProjectors(
  projectors: ColonyProjectorDesc[],
  ux: number,
  uy: number,
  uz: number,
  fx: number,
  fz: number,
  lightScale: number,
): void {
  if (projectors.length < MAX_COLONY_PROJECTORS) {
    const inv = 1 / Math.hypot(fx * 0.95, 0.31, fz * 0.95);
    projectors.push({
      x: ux + fx * 0.25,
      y: uy + 1.45,
      z: uz + fz * 0.25,
      range: 15.5,
      dirX: fx * 0.95 * inv,
      dirY: -0.31 * inv,
      dirZ: fz * 0.95 * inv,
      cosAngle: 0.74,
      r: 0.62,
      g: 0.93,
      b: 1.0,
      intensity: 2.15 * lightScale,
    });
  }
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
}): void {
  const { records, ownerColonyIndex, terrain, tiles } = opts;
  const dnParams = getDayNightParams();
  const solar = computeSolarState(dnParams);
  const nightFactor = isDayNightOn() ? 1 - solar.daylight : 0;
  const rigIntensity = (0.22 + 0.78 * nightFactor) * dnParams.projectorIntensity;
  const lightScale = (0.32 + 0.98 * nightFactor) * dnParams.projectorIntensity;

  const baseCenters: Array<{ x: number; z: number; innerRadius: number; outerRadius: number }> = [];
  const visionSources: ColonyVisionSourceDesc[] = [];
  const projectors: ColonyProjectorDesc[] = [];

  for (const rec of records) {
    attachEntityProjectorRig(rec.mesh, archetypeForKind(rec.kind));
    updateEntityProjectorRig(rec.mesh, rigIntensity, rec.buildStage);

    if (rec.owner !== ownerColonyIndex) continue;
    const ux = rec.mesh.position.x;
    const uy = rec.mesh.position.y;
    const uz = rec.mesh.position.z;

    if (rec.kind === ENTITY_KIND.commandHub) {
      baseCenters.push({ x: rec.targetPos.x, z: rec.targetPos.z, innerRadius: 21, outerRadius: 30 });
      if (visionSources.length < MAX_VISION_SOURCES) {
        visionSources.push({ x: ux, z: uz, innerRadius: 21, outerRadius: 30 });
      }
      if (rec.mesh.visible) {
        appendBuildingProjectors(projectors, ux, uy, uz, lightScale, rec.buildStage);
      }
      continue;
    }

    if (rec.kind === ENTITY_KIND.pod) {
      baseCenters.push({ x: rec.targetPos.x, z: rec.targetPos.z, innerRadius: 17, outerRadius: 24 });
      if (visionSources.length < MAX_VISION_SOURCES) {
        visionSources.push({ x: ux, z: uz, innerRadius: 17, outerRadius: 24 });
      }
      if (rec.mesh.visible && projectors.length < MAX_COLONY_PROJECTORS) {
        projectors.push({
          x: ux,
          y: uy + 2.8,
          z: uz,
          range: 14.0,
          dirX: 0,
          dirY: -1,
          dirZ: 0,
          cosAngle: -1,
          r: 1.0,
          g: 0.84,
          b: 0.58,
          intensity: 1.45 * lightScale,
        });
      }
      continue;
    }

    if (rec.state === ENTITY_STATE.descending || !rec.mesh.visible) continue;
    const yaw = rec.mesh.rotation.y;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);

    if (visionSources.length < MAX_VISION_SOURCES) {
      visionSources.push({ x: ux + fx * 2.8, z: uz + fz * 2.8, innerRadius: 3.5, outerRadius: 6.2 });
    }
    if (visionSources.length < MAX_VISION_SOURCES) {
      visionSources.push({ x: ux + fx * 7.5, z: uz + fz * 7.5, innerRadius: 8.0, outerRadius: 13.5 });
    }
    appendRobotProjectors(projectors, ux, uy, uz, fx, fz, lightScale);
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
    projectors,
    visionSources,
    fovEnabled: Boolean(terrain),
    fovDim: dnParams.fovDim,
    nightFactor,
  });
}
