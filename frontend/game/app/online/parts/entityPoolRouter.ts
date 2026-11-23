import type * as THREE from 'three';
import { setArchetypeBuildProgress } from '@terra/render/kitbash';
import {
  isBugArchetypeId,
  isBuildingOrHiveArchetypeId,
  type BugsOrchestrator,
  type BuildingsOrchestrator,
  type UnitsOrchestrator,
} from '@terra/render/orchestrators';
import type { PoolStats } from '@terra/render/pools';
import { ENTITY_KIND, ENTITY_STATE } from '@terra/sim';
import type { CombatSyncController } from '../combatSync';
import { archetypeForKind } from '../entityKinds';
import type { EntityMeshRecord } from '../EntityMeshRecord';
import { isWorldPointInColonyFov } from '../entityVisionSync';
import type { PodTouchdownState } from '../PodTouchdownFx';

export interface EntityOrchestratorSet {
  readonly buildingsOrchestrator: BuildingsOrchestrator;
  readonly unitsOrchestrator: UnitsOrchestrator;
  readonly bugsOrchestrator: BugsOrchestrator;
}

function mapPlanetOrBiomeKey(value?: string): string | null {
  if (!value) return null;
  if (value === 'desert' || value === 'dune') return 'dune';
  if (value === 'ocean' || value === 'oceanForest') return 'oceanForest';
  if (value === 'temperate' || value === 'forestRock') return 'forestRock';
  return null;
}

export function normalizeEntityBiomeKey(raw?: string, planetType?: string, fallback = 'forestRock'): string {
  if (raw) {
    return mapPlanetOrBiomeKey(raw) ?? raw;
  }
  return mapPlanetOrBiomeKey(planetType) ?? mapPlanetOrBiomeKey(fallback) ?? fallback;
}

export function acquirePooledEntityMesh(
  orchestrators: EntityOrchestratorSet,
  id: number,
  archetypeId: string,
  biomeKey: string,
): THREE.Object3D {
  if (isBuildingOrHiveArchetypeId(archetypeId)) {
    return orchestrators.buildingsOrchestrator.acquire(id, archetypeId, biomeKey);
  }
  if (isBugArchetypeId(archetypeId)) {
    return orchestrators.bugsOrchestrator.acquire(id, archetypeId, biomeKey);
  }
  return orchestrators.unitsOrchestrator.acquire(id, archetypeId, biomeKey);
}

export function releasePooledEntityMesh(
  orchestrators: EntityOrchestratorSet,
  id: number,
  archetypeId?: string,
  expectedMesh?: THREE.Object3D,
): void {
  if (archetypeId && isBuildingOrHiveArchetypeId(archetypeId)) {
    orchestrators.buildingsOrchestrator.release(id, expectedMesh);
  } else if (archetypeId && isBugArchetypeId(archetypeId)) {
    orchestrators.bugsOrchestrator.release(id, expectedMesh);
  } else if (!orchestrators.unitsOrchestrator.release(id, expectedMesh)) {
    orchestrators.buildingsOrchestrator.release(id, expectedMesh);
    orchestrators.bugsOrchestrator.release(id, expectedMesh);
  }
}

export function resetEntitiesOnPlanetSwitch(
  orchestrators: EntityOrchestratorSet,
  entries: Map<number, EntityMeshRecord>,
  combatSync: CombatSyncController,
): void {
  combatSync.battle.insects.clear();
  for (const [id, rec] of [...entries]) {
    releasePooledEntityMesh(orchestrators, id, rec.archetypeId, rec.mesh);
  }
  entries.clear();
}

export function switchAndPrewarmEntityBiome(
  orchestrators: EntityOrchestratorSet,
  entries: Map<number, EntityMeshRecord>,
  combatSync: CombatSyncController,
  targetBiome: string,
): void {
  orchestrators.buildingsOrchestrator.setActiveBiome(targetBiome);
  orchestrators.unitsOrchestrator.setActiveBiome(targetBiome);
  orchestrators.bugsOrchestrator.setActiveBiome(targetBiome);
  combatSync.battle.insects.clearRetired();
  for (const [id, rec] of entries) {
    const meshBiome = (rec.mesh.userData as { biomeKey?: string } | undefined)?.biomeKey;
    if (meshBiome === targetBiome) continue;
    const arch = rec.archetypeId ?? archetypeForKind(rec.kind, rec.tier);
    const prevPos = rec.mesh.position.clone();
    const prevYaw = rec.mesh.rotation.y;
    const prevVis = rec.mesh.visible;
    releasePooledEntityMesh(orchestrators, id, arch, rec.mesh);
    const nextMesh = acquirePooledEntityMesh(orchestrators, id, arch, targetBiome);
    nextMesh.position.copy(prevPos);
    nextMesh.rotation.y = prevYaw;
    nextMesh.visible = prevVis;
    setArchetypeBuildProgress(nextMesh, rec.buildStage);
    rec.mesh = nextMesh;
    rec.archetypeId = arch;
    combatSync.battle.insects.track(id, nextMesh, rec.hp, rec.state === ENTITY_STATE.moving);
  }
  orchestrators.buildingsOrchestrator.prewarmForBiome(targetBiome);
  orchestrators.unitsOrchestrator.prewarmForBiome(targetBiome);
  orchestrators.bugsOrchestrator.prewarmForBiome(targetBiome);
}

export function collectEntityPoolStats(orchestrators: EntityOrchestratorSet): {
  buildings: PoolStats[];
  units: PoolStats[];
  bugs: PoolStats[];
} {
  return {
    buildings: orchestrators.buildingsOrchestrator.poolStats(),
    units: orchestrators.unitsOrchestrator.poolStats(),
    bugs: orchestrators.bugsOrchestrator.poolStats(),
  };
}

export function computeEntityMeshVisible(
  kind: number,
  owner: number,
  state: number,
  ownerColonyIndex: number,
  hasTerrain: boolean,
  w10Enabled: boolean,
  tdState: PodTouchdownState,
  wx?: number,
  wz?: number,
  spectatorAllVision = false,
): boolean {
  if ((spectatorAllVision ? owner < 0 : owner !== ownerColonyIndex) && hasTerrain && wx !== undefined && wz !== undefined) {
    if (!isWorldPointInColonyFov(wx, wz)) return false;
  }
  if (spectatorAllVision) {
    if (kind === ENTITY_KIND.hq && state === ENTITY_STATE.descending) return false;
    if (kind === ENTITY_KIND.tradeHub && (state === ENTITY_STATE.inert || !w10Enabled)) return false;
    return true;
  }
  if (kind === ENTITY_KIND.pod) {
    return owner === ownerColonyIndex ? tdState.podVisible : true;
  }
  if (kind === ENTITY_KIND.hq) {
    if (state === ENTITY_STATE.descending) return false;
    return owner === ownerColonyIndex ? tdState.hqVisible : true;
  }
  if (kind === ENTITY_KIND.commandHub && owner === ownerColonyIndex && !tdState.uiVisible) {
    return false;
  }
  if (kind === ENTITY_KIND.tradeHub && (state === ENTITY_STATE.inert || !w10Enabled)) return false;
  return true;
}
