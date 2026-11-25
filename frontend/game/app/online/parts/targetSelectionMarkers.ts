import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { HexTerrain } from '@terra/render/planets/hex';
import type { ClientView } from '../../../store/replica/viewCodec';
import type { EntityMeshRecord } from '../EntityMeshRecord';
import { is2x2BuildingKind, is3x3FootprintKind } from '../entityKinds';

const TARGET_BACKING_COLOR = 0x160507;
const TARGET_RETICLE_COLOR = 0xff2222;
const TARGET_BRACKET_COLOR = 0xff3b3b;
const TARGET_BEACON_COLOR = 0xff2b2b;

interface TargetReticleSlot {
  readonly group: THREE.Group;
  readonly ring: THREE.Mesh;
  readonly backingRing: THREE.Mesh;
  readonly brackets: THREE.Mesh;
  readonly beacon: THREE.Mesh;
}

function buildSegmentedRingGeometry(innerR = 0.88, outerR = 1.14): THREE.BufferGeometry {
  const arcs: THREE.BufferGeometry[] = [];
  const gap = 0.24;
  const span = Math.PI * 0.5 - gap * 2;
  for (let i = 0; i < 4; i++) {
    const start = i * Math.PI * 0.5 + gap;
    const seg = new THREE.RingGeometry(innerR, outerR, 14, 1, start, span);
    seg.rotateX(-Math.PI / 2);
    arcs.push(seg.index ? seg.toNonIndexed() : seg);
  }
  const merged = mergeGeometries(arcs, false)!;
  for (const a of arcs) a.dispose();
  merged.computeBoundingSphere();
  return merged;
}

function buildLockBracketsGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const ang = i * Math.PI * 0.5;
    const r = 1.3;
    const cone = new THREE.ConeGeometry(0.18, 0.42, 4);
    cone.rotateZ(Math.PI * 0.5); // point inward along -X before orbiting around Y
    cone.rotateY(ang);
    cone.translate(Math.cos(ang) * r, 0.12, -Math.sin(ang) * r);
    parts.push(cone.index ? cone.toNonIndexed() : cone);
  }
  const merged = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  merged.computeBoundingSphere();
  return merged;
}

function buildOverheadBeaconGeometry(): THREE.BufferGeometry {
  const lower = new THREE.ConeGeometry(0.24, 0.48, 4);
  lower.rotateZ(Math.PI); // tip points downward toward the target
  const cap = new THREE.ConeGeometry(0.24, 0.2, 4);
  cap.translate(0, 0.34, 0);
  const parts = [lower.index ? lower.toNonIndexed() : lower, cap.index ? cap.toNonIndexed() : cap];
  const merged = mergeGeometries(parts, false)!;
  lower.dispose();
  cap.dispose();
  for (const p of parts) p.dispose();
  merged.computeBoundingSphere();
  return merged;
}

function makeReticleMaterial(color: number, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    fog: false,
  });
}

function readTargetFromViewBlobs(view: ClientView | null, unitId: number): number | null {
  const blobs = (view as { blobs?: Record<string, unknown> } | null)?.blobs;
  if (!blobs || typeof blobs !== 'object') return null;

  const key = String(unitId);
  const stances = ((blobs.combatStances as { value?: { byEntityId?: Record<string, { targetId?: number | null; explicitTargetId?: number | null }> }; byEntityId?: Record<string, { targetId?: number | null; explicitTargetId?: number | null }> } | undefined)?.value
    ?? (blobs.combatStances as { byEntityId?: Record<string, { targetId?: number | null; explicitTargetId?: number | null }> } | undefined))?.byEntityId;
  const stanceRec = stances?.[key];
  const sTgt = stanceRec?.targetId ?? stanceRec?.explicitTargetId;
  if (typeof sTgt === 'number' && sTgt > 0) return sTgt;

  const battle = ((blobs.battle as { value?: { byEntityId?: Record<string, { targetId?: number | null }> }; byEntityId?: Record<string, { targetId?: number | null }> } | undefined)?.value
    ?? (blobs.battle as { byEntityId?: Record<string, { targetId?: number | null }> } | undefined))?.byEntityId;
  const bTgt = battle?.[key]?.targetId;
  if (typeof bTgt === 'number' && bTgt > 0) return bTgt;

  const turrets = ((blobs.combatTurrets as { value?: { byEntityId?: Record<string, { targetId?: number | null; explicitTargetId?: number | null }> }; byEntityId?: Record<string, { targetId?: number | null; explicitTargetId?: number | null }> } | undefined)?.value
    ?? (blobs.combatTurrets as { byEntityId?: Record<string, { targetId?: number | null; explicitTargetId?: number | null }> } | undefined))?.byEntityId;
  const tRec = turrets?.[key];
  const tTgt = tRec?.targetId ?? tRec?.explicitTargetId;
  if (typeof tTgt === 'number' && tTgt > 0) return tTgt;

  const units = (blobs.units as { byId?: Record<string, { current?: { kind?: string; targetId?: number } | null }> } | undefined)?.byId;
  const uCur = units?.[key]?.current;
  if (uCur?.kind === 'attack' && typeof uCur.targetId === 'number' && uCur.targetId > 0) {
    return uCur.targetId;
  }
  return null;
}

/**
 * Resolves the deduplicated list of visible, alive target entity IDs currently engaged or ordered by
 * the player's selected units/turrets (combining immediate optimistic orders with authoritative combat state).
 */
export function resolveActiveTargetIdsForSelection(
  view: ClientView | null,
  selectedIds: ReadonlySet<number>,
  ownerColonyIndex: number,
  entries: ReadonlyMap<number, EntityMeshRecord>,
  isWrecked: (id: number) => boolean,
  optimisticTargets?: ReadonlyMap<number, number>,
): number[] {
  if (selectedIds.size === 0) return [];
  const targets: number[] = [];
  const seen = new Set<number>();

  for (const unitId of selectedIds) {
    const unitRec = entries.get(unitId);
    if (!unitRec || unitRec.hp <= 0 || isWrecked(unitId) || unitRec.owner !== ownerColonyIndex) {
      continue;
    }
    const optTarget = optimisticTargets?.get(unitId);
    const targetId =
      typeof optTarget === 'number' && optTarget > 0
        ? optTarget
        : readTargetFromViewBlobs(view, unitId);
    if (typeof targetId !== 'number' || targetId <= 0 || seen.has(targetId)) continue;
    const targetRec = entries.get(targetId);
    if (!targetRec || targetRec.hp <= 0 || isWrecked(targetId) || !targetRec.mesh.visible) {
      continue;
    }
    seen.add(targetId);
    targets.push(targetId);
  }
  return targets;
}

/**
 * Pooled 3D red target-lock reticles rendered around and above enemy targets currently targeted by
 * the player's selected combat units or defense turrets.
 */
export class TargetSelectionMarkers {
  readonly group = new THREE.Group();
  private readonly ringGeo: THREE.BufferGeometry;
  private readonly backingGeo: THREE.BufferGeometry;
  private readonly bracketGeo: THREE.BufferGeometry;
  private readonly beaconGeo: THREE.BufferGeometry;
  private readonly ringMat: THREE.MeshBasicMaterial;
  private readonly backingMat: THREE.MeshBasicMaterial;
  private readonly bracketMat: THREE.MeshBasicMaterial;
  private readonly beaconMat: THREE.MeshBasicMaterial;
  private readonly slots: TargetReticleSlot[] = [];
  private activeIds: number[] = [];

  constructor(private readonly scene: THREE.Scene) {
    this.group.name = 'target-selection-markers';
    this.ringGeo = buildSegmentedRingGeometry(0.88, 1.14);
    this.backingGeo = buildSegmentedRingGeometry(0.84, 1.18);
    this.bracketGeo = buildLockBracketsGeometry();
    this.beaconGeo = buildOverheadBeaconGeometry();
    this.ringMat = makeReticleMaterial(TARGET_RETICLE_COLOR, 0.96);
    this.backingMat = makeReticleMaterial(TARGET_BACKING_COLOR, 0.72);
    this.bracketMat = makeReticleMaterial(TARGET_BRACKET_COLOR, 0.98);
    this.beaconMat = makeReticleMaterial(TARGET_BEACON_COLOR, 0.96);
    this.scene.add(this.group);
  }

  private ensureSlot(index: number): TargetReticleSlot {
    while (this.slots.length <= index) {
      const slotGroup = new THREE.Group();
      slotGroup.name = `target-selection-reticle-${this.slots.length}`;
      slotGroup.visible = false;
      const ring = new THREE.Mesh(this.ringGeo, this.ringMat);
      ring.renderOrder = 14;
      const backingRing = new THREE.Mesh(this.backingGeo, this.backingMat);
      backingRing.renderOrder = 13;
      const brackets = new THREE.Mesh(this.bracketGeo, this.bracketMat);
      brackets.renderOrder = 15;
      const beacon = new THREE.Mesh(this.beaconGeo, this.beaconMat);
      beacon.renderOrder = 16;
      // Keep ring at children[0] so layout/scale callers read the base reticle radius directly.
      slotGroup.add(ring, backingRing, brackets, beacon);
      this.group.add(slotGroup);
      this.slots.push({ group: slotGroup, ring, backingRing, brackets, beacon });
    }
    return this.slots[index]!;
  }

  sync(targetRecords: readonly EntityMeshRecord[], terrain: HexTerrain | null, time: number): void {
    const nextIds: number[] = [];
    const pulse = 1 + 0.07 * Math.sin(time * 5.5);
    this.ringMat.opacity = 0.84 + 0.14 * Math.sin(time * 5.5);
    this.bracketMat.opacity = 0.88 + 0.12 * Math.sin(time * 5.5);
    this.beaconMat.opacity = 0.86 + 0.14 * Math.sin(time * 5.5);

    for (let i = 0; i < targetRecords.length; i++) {
      const rec = targetRecords[i]!;
      if (!rec.mesh.visible || rec.hp <= 0) continue;
      const idx = nextIds.length;
      nextIds.push(rec.id);
      const slot = this.ensureSlot(idx);

      const geometry = (rec.mesh as THREE.Mesh).geometry;
      if (geometry && !geometry.boundingBox) geometry.computeBoundingBox();
      const box = geometry?.boundingBox;
      const baseRadius = box
        ? Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * rec.mesh.scale.x * 0.72
        : 1.22;
      const radius = Math.max(1.22, baseRadius);

      const wx = rec.mesh.position.x;
      const wz = rec.mesh.position.z;
      let gy = rec.mesh.position.y;
      if (terrain) {
        const baseY =
          is2x2BuildingKind(rec.kind) || is3x3FootprintKind(rec.kind)
            ? rec.mesh.position.y
            : terrain.heightAt(wx, wz);
        gy = Math.max(
          baseY,
          terrain.heightAt(wx + radius, wz),
          terrain.heightAt(wx - radius, wz),
          terrain.heightAt(wx, wz + radius),
          terrain.heightAt(wx, wz - radius),
        );
      }

      const entityHeight = box ? Math.max(1.1, (box.max.y - box.min.y) * rec.mesh.scale.y) : 1.3;
      const topOffset = entityHeight + 0.65 + 0.14 * Math.sin(time * 5.5);
      const beaconScale = Math.min(1.65, Math.max(0.95, radius * 0.65));

      slot.group.visible = true;
      slot.group.userData.targetEntityId = rec.id;
      slot.group.position.set(wx, gy + 0.08, wz);
      slot.ring.rotation.y = time * 0.45;
      slot.ring.scale.setScalar(radius);
      slot.backingRing.rotation.y = time * 0.45;
      slot.backingRing.scale.setScalar(radius);
      slot.brackets.rotation.y = time * 0.45;
      slot.brackets.scale.setScalar(radius * pulse);
      slot.beacon.position.set(0, rec.mesh.position.y - (gy + 0.08) + topOffset, 0);
      slot.beacon.rotation.y = time * 1.4;
      slot.beacon.scale.setScalar(beaconScale);
    }

    for (let i = nextIds.length; i < this.slots.length; i++) {
      this.slots[i]!.group.visible = false;
    }
    this.activeIds = nextIds;
  }

  activeTargetIds(): readonly number[] {
    return this.activeIds;
  }

  dispose(): void {
    this.activeIds = [];
    for (const s of this.slots) this.group.remove(s.group);
    this.slots.length = 0;
    this.group.removeFromParent();
    this.ringGeo.dispose();
    this.backingGeo.dispose();
    this.bracketGeo.dispose();
    this.beaconGeo.dispose();
    this.ringMat.dispose();
    this.backingMat.dispose();
    this.bracketMat.dispose();
    this.beaconMat.dispose();
  }
}

/** Resolves and syncs 3D red target-selection reticles for all currently selected player units/turrets. */
export function syncEntityTargetSelection(
  markers: TargetSelectionMarkers,
  view: ClientView | null,
  selectedEntityId: number | null,
  selectedUnitIds: readonly number[],
  ownerColonyIndex: number,
  entries: ReadonlyMap<number, EntityMeshRecord>,
  isWrecked: (id: number) => boolean,
  optimisticTargets: ReadonlyMap<number, number> | undefined,
  terrain: HexTerrain | null,
  time: number,
): void {
  const sel = new Set<number>(selectedUnitIds);
  if (selectedEntityId !== null) sel.add(selectedEntityId);
  const targetIds = resolveActiveTargetIdsForSelection(
    view,
    sel,
    ownerColonyIndex,
    entries,
    isWrecked,
    optimisticTargets,
  );
  const records: EntityMeshRecord[] = [];
  for (const tid of targetIds) {
    const rec = entries.get(tid);
    if (rec) records.push(rec);
  }
  markers.sync(records, terrain, time);
}
