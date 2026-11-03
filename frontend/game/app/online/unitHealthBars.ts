import * as THREE from 'three';
import { ENTITY_KIND } from '@terra/sim';
import { normalizeKindCode } from '../../features/landfall/selectionHelpers';
import { isEntityInViewFocus } from './entityFocus';

export interface UnitHealthRecordLike {
  id: number;
  kind: number | string;
  hp: number;
  hpMax: number;
  progress?: number;
  mesh: THREE.Object3D;
}

export function disposeObject3D(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry?.dispose?.();
      const mat = mesh.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose?.());
      else mat?.dispose?.();
    }
  });
}

function isMobileUnitKind(kind: number): boolean {
  return (
    kind === ENTITY_KIND.hq ||
    kind === ENTITY_KIND.harvester ||
    kind === ENTITY_KIND.devProbe
  );
}

function isBarSupportedKind(kind: number): boolean {
  return (
    isMobileUnitKind(kind) ||
    kind === ENTITY_KIND.commandHub ||
    kind === ENTITY_KIND.metalsExtractor ||
    kind === ENTITY_KIND.solar ||
    kind === ENTITY_KIND.pod
  );
}

function barHeightForKind(kind: number): number {
  if (kind === ENTITY_KIND.commandHub) return 2.6;
  if (kind === ENTITY_KIND.metalsExtractor || kind === ENTITY_KIND.solar) return 2.1;
  if (kind === ENTITY_KIND.hq) return 2.05;
  return 1.55;
}

function hpColorForRatio(ratio: number): number {
  if (ratio >= 0.6) return 0x39ff88;
  if (ratio >= 0.3) return 0xff9b2f;
  return 0xff3b3b;
}

interface UnitBarEntry {
  root: THREE.Group;
  hpGroup: THREE.Group;
  aboveFill: THREE.Mesh;
  aboveMat: THREE.MeshBasicMaterial;
  progressGroup: THREE.Group;
  progressFill: THREE.Mesh;
  progressMat: THREE.MeshBasicMaterial;
}

const BAR_W = 0.64;
const BAR_H = 0.08;
const ISO_YAW = Math.PI / 4;
const ISO_PITCH = -Math.atan(1 / Math.SQRT2);
export const PROGRESS_BAR_COLOR = 0x38bdf8;

/**
 * Manages 3D overhead HP bars (for mobile units and damaged buildings) and blue progress bars (`0x38bdf8`)
 * for any unit or building with active progress `0 < progress < 1`.
 */
export class UnitHealthBars {
  readonly group = new THREE.Group();
  private readonly bars = new Map<number, UnitBarEntry>();
  private readonly sharedGeos: THREE.BufferGeometry[] = [];
  private readonly sharedMats: THREE.Material[] = [];

  private readonly aboveBgGeo = new THREE.PlaneGeometry(BAR_W + 0.06, BAR_H + 0.04);
  private readonly aboveFillGeo = new THREE.PlaneGeometry(BAR_W, BAR_H);

  private readonly aboveBgMat = new THREE.MeshBasicMaterial({
    color: 0x090d14,
    transparent: true,
    opacity: 0.85,
    depthTest: false,
    depthWrite: false,
    fog: false,
  });

  constructor(private readonly scene: THREE.Scene) {
    this.group.name = 'unit-health-bars';
    this.scene.add(this.group);
    this.sharedGeos.push(this.aboveBgGeo, this.aboveFillGeo);
    this.sharedMats.push(this.aboveBgMat);
  }

  sync(records: Iterable<UnitHealthRecordLike>): void {
    const seen = new Set<number>();
    for (const rec of records) {
      const kind = normalizeKindCode(rec.kind);
      if (!isBarSupportedKind(kind) || rec.hp <= 0 || rec.hpMax <= 0) continue;
      const isUnit = isMobileUnitKind(kind);
      const isDamaged = rec.hp < rec.hpMax;
      const prog = typeof rec.progress === 'number' && Number.isFinite(rec.progress) ? rec.progress : 0;
      const hasProgress = prog > 0 && prog < 1;
      if (!isUnit && !isDamaged && !hasProgress) continue;

      seen.add(rec.id);
      let entry = this.bars.get(rec.id);
      if (!entry) {
        entry = this.createEntry(rec.id, kind);
        this.bars.set(rec.id, entry);
      }
      this.updateEntry(entry, rec, isUnit, isDamaged, prog, hasProgress);
    }

    for (const [id, entry] of [...this.bars]) {
      if (!seen.has(id)) {
        this.group.remove(entry.root);
        entry.aboveMat.dispose();
        entry.progressMat.dispose();
        this.bars.delete(id);
      }
    }
  }

  private createEntry(id: number, kind: number): UnitBarEntry {
    const root = new THREE.Group();
    root.name = `unit-hp-${id}`;
    root.userData.unitEntityId = id;

    const aboveY = barHeightForKind(kind);
    const aboveGroup = new THREE.Group();
    aboveGroup.position.set(0, aboveY, 0);
    aboveGroup.rotation.order = 'YXZ';
    aboveGroup.rotation.y = ISO_YAW;
    aboveGroup.rotation.x = ISO_PITCH;

    const hpGroup = new THREE.Group();
    hpGroup.name = 'hp-bar-group';
    const aboveBg = new THREE.Mesh(this.aboveBgGeo, this.aboveBgMat);
    aboveBg.renderOrder = 10;

    const aboveMat = new THREE.MeshBasicMaterial({
      color: 0x39ff88,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    const aboveFill = new THREE.Mesh(this.aboveFillGeo, aboveMat);
    aboveFill.position.z = 0.002;
    aboveFill.renderOrder = 11;
    aboveFill.userData.role = 'hp-above-fill';
    hpGroup.add(aboveBg, aboveFill);

    const progressGroup = new THREE.Group();
    progressGroup.name = 'progress-bar-group';
    progressGroup.position.set(0, -(BAR_H + 0.06), 0);
    progressGroup.visible = false;

    const progressBg = new THREE.Mesh(this.aboveBgGeo, this.aboveBgMat);
    progressBg.renderOrder = 10;
    const progressMat = new THREE.MeshBasicMaterial({
      color: PROGRESS_BAR_COLOR,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    const progressFill = new THREE.Mesh(this.aboveFillGeo, progressMat);
    progressFill.position.z = 0.002;
    progressFill.renderOrder = 11;
    progressFill.userData.role = 'progress-above-fill';
    progressGroup.add(progressBg, progressFill);

    aboveGroup.add(hpGroup, progressGroup);
    root.add(aboveGroup);
    this.group.add(root);

    return { root, hpGroup, aboveFill, aboveMat, progressGroup, progressFill, progressMat };
  }

  private updateEntry(
    entry: UnitBarEntry,
    rec: UnitHealthRecordLike,
    isUnit: boolean,
    isDamaged: boolean,
    prog: number,
    hasProgress: boolean,
  ): void {
    entry.root.visible = rec.mesh.visible && isEntityInViewFocus(rec.mesh); // off-screen: no layout
    if (!entry.root.visible) return;

    entry.root.position.copy(rec.mesh.position);
    const showHp = isUnit || isDamaged;
    entry.hpGroup.visible = showHp;
    if (showHp) {
      const ratio = Math.max(0, Math.min(1, rec.hp / Math.max(1, rec.hpMax)));
      const sx = Math.max(0.001, ratio);
      entry.aboveFill.scale.x = sx;
      entry.aboveFill.position.x = -0.5 * BAR_W * (1 - ratio);
      entry.aboveMat.color.setHex(hpColorForRatio(ratio));
    }

    entry.progressGroup.visible = hasProgress;
    entry.progressGroup.position.y = showHp ? -(BAR_H + 0.06) : 0;
    if (hasProgress) {
      const clamped = Math.max(0, Math.min(1, prog));
      const sx = Math.max(0.001, clamped);
      entry.progressFill.scale.x = sx;
      entry.progressFill.position.x = -0.5 * BAR_W * (1 - clamped);
      entry.progressMat.color.setHex(PROGRESS_BAR_COLOR);
    }
  }

  dispose(): void {
    for (const entry of this.bars.values()) {
      this.group.remove(entry.root);
      entry.aboveMat.dispose();
      entry.progressMat.dispose();
    }
    this.bars.clear();
    this.scene.remove(this.group);
    for (const g of this.sharedGeos) g.dispose();
    for (const m of this.sharedMats) m.dispose();
  }
}
