import * as THREE from 'three';
import { captureWeaponSideMatrices } from '@terra/render/combat/WeaponRig';
import type { WreckageLayer } from '@terra/render/combat/WreckageLayer';
import { isBugArchetypeId } from '@terra/render/orchestrators';
import { tileXZ, type HexTerrain } from '@terra/render/planets/hex';
import type { MechanicalDeathKind } from '@terra/render/visuals/projectiles/ProjectileVfxSystem';
import { ENTITY_KIND, getWrecksMap } from '@terra/sim';
import type { CombatSyncController, EntityDestructionKind } from '../combatSync';
import { archetypeForKind, entityWorldXZ, is2x2BuildingKind, is3x3FootprintKind, isConstructibleBuilding } from '../entityKinds';
import type { EntityMeshRecord } from '../EntityMeshRecord';

const PENDING_DEATH_TTL_S = 0.45;
const MAX_PENDING_DEATHS = 256;

interface PendingDeathSnapshot {
  id: number;
  simKind: number;
  mechKind: MechanicalDeathKind;
  archetypeId: string;
  q: number;
  r: number;
  geometry: THREE.BufferGeometry | undefined;
  pos: THREE.Vector3;
  rotY: number;
  scale: THREE.Vector3;
  buildStage: number;
  groundY: number;
  weaponMatrices: THREE.Matrix4[] | null;
  spinTime: number;
  tintHex: number | null;
  expiresAt: number;
}

export function classifyMechanicalDeathKind(
  simKind: number,
  archetypeId?: string,
  eventHint?: EntityDestructionKind,
): MechanicalDeathKind | null {
  if (simKind === ENTITY_KIND.pod || archetypeId === 'ship.dropPod') return null;
  if (
    simKind === ENTITY_KIND.hiveBlackAnt ||
    simKind === ENTITY_KIND.hiveBlueBeetle ||
    simKind === ENTITY_KIND.hiveGreenSpitter
  ) {
    return null;
  }
  if (archetypeId && (isBugArchetypeId(archetypeId) || archetypeId.startsWith('fauna.'))) return null;
  if (eventHint === 'insect' || eventHint === 'hive') return null;
  if (isConstructibleBuilding(simKind) || archetypeId?.startsWith('building.') || eventHint === 'building') {
    return 'building';
  }
  return 'bot';
}

export function explosionScaleForEntity(simKind: number, mechKind: MechanicalDeathKind, archetypeId?: string): number {
  if (mechKind === 'building') {
    if (is3x3FootprintKind(simKind)) return 1.75;
    if (is2x2BuildingKind(simKind)) return 1.32;
    return 1.02;
  }
  if (archetypeId === 'robot.hero' || simKind === ENTITY_KIND.hq) return 1.35;
  if (archetypeId === 'robot.artillery' || simKind === ENTITY_KIND.demoArtillery) return 1.28;
  if (archetypeId === 'robot.tank' || simKind === ENTITY_KIND.demoTank) return 1.20;
  return 0.95;
}

export function footprintRadiusForKind(simKind: number): number {
  if (is3x3FootprintKind(simKind)) return 2.8;
  if (is2x2BuildingKind(simKind)) return 1.8;
  if (isConstructibleBuilding(simKind)) return 0.95;
  return 0.65;
}

function exactDeathHexXZ(
  id: number,
  simKind: number,
  q: number,
  r: number,
  fallbackX: number,
  fallbackZ: number,
  blobs: Record<string, unknown> | undefined,
): [number, number] {
  const wreckEntry = getWrecksMap(blobs)[String(id)];
  const hq = wreckEntry ? wreckEntry.q : q;
  const hr = wreckEntry ? wreckEntry.r : r;
  if (!Number.isFinite(hq) || !Number.isFinite(hr)) return [fallbackX, fallbackZ];
  const rq = Math.round(hq);
  const rr = Math.round(hr);
  if (isConstructibleBuilding(simKind)) return entityWorldXZ(simKind, rq, rr);
  return tileXZ(rq, rr);
}

function resolveDeathGroundY(
  wx: number,
  wz: number,
  fallbackY: number,
  mechKind: MechanicalDeathKind,
  terrain: HexTerrain | null,
): number {
  const h = terrain ? terrain.heightAt(wx, wz) : fallbackY;
  return mechKind === 'building' ? Math.max(h, fallbackY) : h;
}

function readMeshSpinTime(mesh: THREE.Object3D): number {
  return (mesh.userData as { uniforms?: { uTime?: { value: number } } } | undefined)?.uniforms?.uTime?.value ?? 0;
}

function readMeshTintHex(mesh: THREE.Object3D): number | null {
  const col = (mesh as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
  const c = col?.color;
  if (!c) return null;
  if (Math.abs(c.r - 1) < 1e-3 && Math.abs(c.g - 1) < 1e-3 && Math.abs(c.b - 1) < 1e-3) return null;
  return c.getHex();
}

/**
 * Coordinates bot & building explosion VFX and shattered/distorted wrecks across both
 * WorldStore (event before snapshot removal) and LocalHost (snapshot removal before event).
 */
interface PendingOrganicSite {
  x: number;
  z: number;
  groundY: number;
  radiusM: number;
  isHive: boolean;
  expiresAt: number;
}

export class EntityDeathCoordinator {
  private readonly pending = new Map<number, PendingDeathSnapshot>();
  private readonly pendingOrganic = new Map<number, PendingOrganicSite>();
  private readonly explodedIds = new Set<number>();
  private readonly wreckedIds = new Set<number>();
  private readonly seenInSimWrecks = new Set<number>();
  private readonly wreckFootprints = new Map<number, { x: number; z: number; r: number }>();
  private latestBlobs: Record<string, unknown> | undefined;

  constructor(
    private readonly wrecks: WreckageLayer,
    private readonly combatSync: CombatSyncController,
    private readonly entries: Map<number, EntityMeshRecord>,
  ) {}

  isWrecked(id: number): boolean {
    return this.wreckedIds.has(id);
  }

  onMeshRemovedFromView(rec: EntityMeshRecord, terrain: HexTerrain | null, time: number): void {
    const mechKind = classifyMechanicalDeathKind(rec.kind, rec.archetypeId);
    if (!mechKind) {
      if (rec.kind !== ENTITY_KIND.pod && !this.explodedIds.has(rec.id)) {
        const ox = rec.mesh.position.x, oz = rec.mesh.position.z;
        const oGroundY = terrain ? terrain.heightAt(ox, oz) : rec.mesh.position.y;
        const oRad = footprintRadiusForKind(rec.kind) + 1.1;
        const isHive = is3x3FootprintKind(rec.kind);
        if (rec.hp <= 0 || this.combatSync.explicitDeaths.has(rec.id)) {
          this.explodedIds.add(rec.id);
          this.combatSync.projectiles.clearCratersInRadius(ox, oz, oRad);
          if (isHive) this.combatSync.projectiles.emitInsectDeath({ at: { x: ox, y: oGroundY + 0.55, z: oz }, groundY: oGroundY, scale: 1.85 });
        } else {
          this.pendingOrganic.set(rec.id, { x: ox, z: oz, groundY: oGroundY, radiusM: oRad, isHive, expiresAt: time + PENDING_DEATH_TTL_S });
        }
      }
      return;
    }
    if (this.explodedIds.has(rec.id) || !rec.mesh.visible) return;
    const [wx, wz] = exactDeathHexXZ(rec.id, rec.kind, rec.q, rec.r, rec.mesh.position.x, rec.mesh.position.z, this.latestBlobs);
    const groundY = resolveDeathGroundY(wx, wz, rec.mesh.position.y, mechKind, terrain);
    const explicit = rec.hp <= 0 || this.combatSync.explicitDeaths.has(rec.id);
    if (explicit) {
      this.triggerLiveDeath(rec, mechKind, groundY, terrain);
      return;
    }
    this.pending.set(rec.id, {
      id: rec.id,
      simKind: rec.kind,
      mechKind,
      archetypeId: rec.archetypeId ?? archetypeForKind(rec.kind, rec.tier),
      q: Math.round(rec.q),
      r: Math.round(rec.r),
      geometry: (rec.mesh as THREE.Mesh).geometry,
      pos: rec.mesh.position.clone(),
      rotY: rec.mesh.rotation.y,
      scale: rec.mesh.scale.clone(),
      buildStage: rec.buildStage,
      groundY,
      weaponMatrices: captureWeaponSideMatrices(rec.mesh),
      spinTime: readMeshSpinTime(rec.mesh),
      tintHex: readMeshTintHex(rec.mesh),
      expiresAt: time + PENDING_DEATH_TTL_S,
    });
    if (this.pending.size > MAX_PENDING_DEATHS) {
      const oldest = this.pending.keys().next().value!;
      this.pending.delete(oldest);
    }
  }

  onConfirmedDestruction(id: number, eventKind: EntityDestructionKind, terrain: HexTerrain | null): void {
    if (this.explodedIds.has(id)) return;
    const rec = this.entries.get(id);
    if (rec) {
      const mechKind = classifyMechanicalDeathKind(rec.kind, rec.archetypeId, eventKind);
      if (!mechKind) {
        this.explodedIds.add(id);
        this.pendingOrganic.delete(id);
        const ox = rec.mesh.position.x, oz = rec.mesh.position.z;
        const oGroundY = terrain ? terrain.heightAt(ox, oz) : rec.mesh.position.y;
        this.combatSync.projectiles.clearCratersInRadius(ox, oz, footprintRadiusForKind(rec.kind) + 1.1);
        if (eventKind === 'hive' || is3x3FootprintKind(rec.kind)) {
          this.combatSync.projectiles.emitInsectDeath({ at: { x: ox, y: oGroundY + 0.55, z: oz }, groundY: oGroundY, scale: 1.85 });
        }
        return;
      }
      if (!rec.mesh.visible) return;
      const [wx, wz] = exactDeathHexXZ(rec.id, rec.kind, rec.q, rec.r, rec.mesh.position.x, rec.mesh.position.z, this.latestBlobs);
      const groundY = resolveDeathGroundY(wx, wz, rec.mesh.position.y, mechKind, terrain);
      this.triggerLiveDeath(rec, mechKind, groundY, terrain);
      rec.mesh.visible = false;
      return;
    }
    const org = this.pendingOrganic.get(id);
    if (org && (eventKind === 'insect' || eventKind === 'hive')) {
      this.pendingOrganic.delete(id);
      this.explodedIds.add(id);
      this.combatSync.projectiles.clearCratersInRadius(org.x, org.z, org.radiusM);
      if (org.isHive || eventKind === 'hive') {
        this.combatSync.projectiles.emitInsectDeath({ at: { x: org.x, y: org.groundY + 0.55, z: org.z }, groundY: org.groundY, scale: 1.85 });
      }
      return;
    }
    const snap = this.pending.get(id);
    if (!snap) return;
    this.pending.delete(id);
    const mechKind = classifyMechanicalDeathKind(snap.simKind, snap.archetypeId, eventKind);
    if (!mechKind) return;
    this.emitAndWreckFromSnapshot({ ...snap, mechKind }, terrain);
  }

  onRevived(id: number): void {
    this.explodedIds.delete(id);
    this.wreckedIds.delete(id);
    this.seenInSimWrecks.delete(id);
    this.wreckFootprints.delete(id);
    this.pending.delete(id);
    this.combatSync.projectiles.releaseNoCraterZone(id);
    this.wrecks.remove(id);
    const rec = this.entries.get(id);
    if (rec) rec.mesh.visible = true;
  }

  onEntitySpawned(id: number, wx: number, wz: number, simKind: number): void {
    this.pending.delete(id);
    if (isConstructibleBuilding(simKind)) {
      this.wrecks.clearInRadius(wx, wz, footprintRadiusForKind(simKind), this.seenInSimWrecks);
    }
  }

  syncViewWrecks(blobs: Record<string, unknown> | undefined): void {
    this.latestBlobs = blobs;
    if (!blobs || !('wrecks' in blobs) || !blobs.wrecks) return;
    const byId = getWrecksMap(blobs);
    for (const key of Object.keys(byId)) {
      const id = Number(key);
      if (Number.isFinite(id)) this.seenInSimWrecks.add(id);
    }
    for (const id of this.wrecks.activeIds()) {
      if (String(id) in byId) {
        this.seenInSimWrecks.add(id);
      } else if (this.seenInSimWrecks.has(id)) {
        this.wrecks.remove(id);
        this.seenInSimWrecks.delete(id);
        this.combatSync.projectiles.releaseNoCraterZone(id);
        const fp = this.wreckFootprints.get(id);
        if (fp) {
          this.combatSync.projectiles.clearCratersInRadius(fp.x, fp.z, fp.r);
          this.wreckFootprints.delete(id);
        }
      }
    }
  }

  pruneExpired(time: number): void {
    for (const [id, snap] of this.pending) {
      if (snap.expiresAt <= time) this.pending.delete(id);
    }
    for (const [id, org] of this.pendingOrganic) {
      if (org.expiresAt <= time) this.pendingOrganic.delete(id);
    }
  }

  clear(): void {
    this.pending.clear();
    this.pendingOrganic.clear();
    this.explodedIds.clear();
    this.wreckedIds.clear();
    this.seenInSimWrecks.clear();
    this.wreckFootprints.clear();
    this.latestBlobs = undefined;
  }

  private markExploded(id: number): void {
    this.explodedIds.add(id);
    this.wreckedIds.add(id);
    if (this.explodedIds.size > 2048) {
      const oldest = this.explodedIds.keys().next().value!;
      this.explodedIds.delete(oldest);
      this.wreckedIds.delete(oldest);
      this.wreckFootprints.delete(oldest);
    }
  }

  private triggerLiveDeath(
    rec: EntityMeshRecord,
    mechKind: MechanicalDeathKind,
    groundY: number,
    terrain: HexTerrain | null,
  ): void {
    this.pending.delete(rec.id);
    this.markExploded(rec.id);
    const archetypeId = rec.archetypeId ?? archetypeForKind(rec.kind, rec.tier);
    const scale = explosionScaleForEntity(rec.kind, mechKind, archetypeId);
    const blastY = groundY + (mechKind === 'building' ? 0.72 * scale : 0.48 * scale);
    const [exactX, exactZ] = exactDeathHexXZ(rec.id, rec.kind, rec.q, rec.r, rec.mesh.position.x, rec.mesh.position.z, this.latestBlobs);
    this.combatSync.projectiles.emitMechanicalDeath({
      kind: mechKind,
      at: { x: exactX, y: blastY, z: exactZ },
      groundY,
      scale,
    });
    const fpRadius = footprintRadiusForKind(rec.kind);
    this.combatSync.projectiles.clearCratersInRadius(exactX, exactZ, fpRadius + 1.35, rec.id);
    this.wreckFootprints.set(rec.id, { x: exactX, z: exactZ, r: fpRadius + 1.35 });
    this.wrecks.preserve(rec.id, rec.mesh, {
      kind: mechKind,
      archetypeId,
      buildStage: rec.buildStage,
      position: { x: exactX, y: groundY, z: exactZ },
      groundY,
      groundHeightAt: terrain ? (x, z) => terrain.heightAt(x, z) : undefined,
      footprintRadius: fpRadius,
    });
  }

  private emitAndWreckFromSnapshot(snap: PendingDeathSnapshot, terrain: HexTerrain | null): void {
    this.markExploded(snap.id);
    const scale = explosionScaleForEntity(snap.simKind, snap.mechKind, snap.archetypeId);
    const [exactX, exactZ] = exactDeathHexXZ(snap.id, snap.simKind, snap.q, snap.r, snap.pos.x, snap.pos.z, this.latestBlobs);
    const groundY = resolveDeathGroundY(exactX, exactZ, snap.groundY, snap.mechKind, terrain);
    const blastY = groundY + (snap.mechKind === 'building' ? 0.72 * scale : 0.48 * scale);
    this.combatSync.projectiles.emitMechanicalDeath({
      kind: snap.mechKind,
      at: { x: exactX, y: blastY, z: exactZ },
      groundY,
      scale,
    });
    const fpRadius = footprintRadiusForKind(snap.simKind);
    this.combatSync.projectiles.clearCratersInRadius(exactX, exactZ, fpRadius + 1.35, snap.id);
    this.wreckFootprints.set(snap.id, { x: exactX, z: exactZ, r: fpRadius + 1.35 });
    if (!snap.geometry) return;
    this.wrecks.preserveFromGeometry(snap.id, snap.geometry, {
      kind: snap.mechKind,
      archetypeId: snap.archetypeId,
      position: { x: exactX, y: groundY, z: exactZ },
      rotationY: snap.rotY,
      scale: { x: snap.scale.x, y: snap.scale.y, z: snap.scale.z },
      buildStage: snap.buildStage,
      groundY,
      groundHeightAt: terrain ? (x, z) => terrain.heightAt(x, z) : undefined,
      footprintRadius: fpRadius,
      weaponMatrices: snap.weaponMatrices,
      spinTime: snap.spinTime,
      tintColor: snap.tintHex,
    });
  }
}
