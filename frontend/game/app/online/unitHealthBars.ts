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
  owner?: number;
  selected?: boolean;
  mesh: THREE.Object3D;
}

const EK = ENTITY_KIND as Readonly<Record<string, number | undefined>>;
const DEMO_TANK_CODE = EK.demoTank ?? 52;
const DEMO_ARTILLERY_CODE = EK.demoArtillery ?? 53;

const EXTRA_KIND_BY_NAME: Readonly<Record<string, number>> = {
  recon: ENTITY_KIND.recon,
  demoTank: DEMO_TANK_CODE,
  demoArtillery: DEMO_ARTILLERY_CODE,
  blackAnt: ENTITY_KIND.blackAnt,
  blueBeetle: ENTITY_KIND.blueBeetle,
  greenSpitter: ENTITY_KIND.greenSpitter,
  hiveBlackAnt: ENTITY_KIND.hiveBlackAnt,
  blackAntHive: EK.blackAntHive ?? ENTITY_KIND.hiveBlackAnt,
  hiveBlueBeetle: ENTITY_KIND.hiveBlueBeetle,
  blueBeetleHive: EK.blueBeetleHive ?? ENTITY_KIND.hiveBlueBeetle,
  hiveGreenSpitter: ENTITY_KIND.hiveGreenSpitter,
  greenSpitterHive: EK.greenSpitterHive ?? ENTITY_KIND.hiveGreenSpitter,
  roboticsFactory: ENTITY_KIND.roboticsFactory,
  droneControlArray: ENTITY_KIND.droneControlArray,
  droneArray: ENTITY_KIND.droneArray,
  autocannon: ENTITY_KIND.autocannon,
  turret: ENTITY_KIND.turret,
  laserTower: ENTITY_KIND.laserTower,
  pulseTurret: ENTITY_KIND.pulseTurret,
};

export function resolveHealthBarKind(raw: number | string): number {
  const norm = normalizeKindCode(raw);
  if (norm !== 0) return norm;
  if (typeof raw === 'string') return EXTRA_KIND_BY_NAME[raw] ?? EK[raw] ?? 0;
  return 0;
}

const HIVE_KINDS = new Set<number>(
  [
    ENTITY_KIND.hiveBlackAnt,
    ENTITY_KIND.hiveBlueBeetle,
    ENTITY_KIND.hiveGreenSpitter,
    EK.blackAntHive,
    EK.blueBeetleHive,
    EK.greenSpitterHive,
  ].filter((k): k is number => typeof k === 'number'),
);

const BUILDING_2X2_KINDS = new Set<number>([
  ENTITY_KIND.metalsExtractor,
  ENTITY_KIND.solar,
  ENTITY_KIND.tradeHub,
  ENTITY_KIND.capacitor,
  ENTITY_KIND.wind,
  ENTITY_KIND.thermal,
  ENTITY_KIND.supplyDepot,
  ENTITY_KIND.mineralsQuarry,
  ENTITY_KIND.waterExtractor,
  ENTITY_KIND.petroleumWell,
]);

const BUILDING_1X1_KINDS = new Set<number>([
  ENTITY_KIND.pylon,
  ENTITY_KIND.droneControlArray,
  ENTITY_KIND.autocannon,
  ENTITY_KIND.laserTower,
]);

/**
 * Frees what `obj` owns on the GPU: every mesh's geometry and materials, plus its projector rig (`attachEntityProjectorRig`
 * puts it in `userData.projectorRig`; its halo is a `Sprite`, which the mesh walk below would miss).
 */
export function disposeObject3D(obj: THREE.Object3D): void {
  (obj.userData as { projectorRig?: { dispose?: () => void } } | undefined)?.projectorRig?.dispose?.();
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

export function isMobileUnitKind(rawKind: number | string): boolean {
  const kind = typeof rawKind === 'number' ? rawKind : resolveHealthBarKind(rawKind);
  return (
    kind === ENTITY_KIND.hq ||
    kind === ENTITY_KIND.worker ||
    kind === ENTITY_KIND.devProbe ||
    kind === ENTITY_KIND.recon ||
    kind === DEMO_TANK_CODE ||
    kind === DEMO_ARTILLERY_CODE ||
    kind === ENTITY_KIND.blackAnt ||
    kind === ENTITY_KIND.blueBeetle ||
    kind === ENTITY_KIND.greenSpitter
  );
}

export function isBarSupportedKind(rawKind: number | string): boolean {
  const kind = typeof rawKind === 'number' ? rawKind : resolveHealthBarKind(rawKind);
  return (
    isMobileUnitKind(kind) ||
    kind === ENTITY_KIND.commandHub ||
    kind === ENTITY_KIND.roboticsFactory ||
    kind === ENTITY_KIND.pod ||
    BUILDING_2X2_KINDS.has(kind) ||
    BUILDING_1X1_KINDS.has(kind) ||
    HIVE_KINDS.has(kind)
  );
}

export function barHeightForKind(rawKind: number | string): number {
  const kind = typeof rawKind === 'number' ? rawKind : resolveHealthBarKind(rawKind);
  if (kind === ENTITY_KIND.commandHub || kind === ENTITY_KIND.roboticsFactory || HIVE_KINDS.has(kind)) return 2.6;
  if (BUILDING_2X2_KINDS.has(kind)) return 2.1;
  if (kind === ENTITY_KIND.hq) return 2.05;
  if (BUILDING_1X1_KINDS.has(kind)) return 1.9;
  return 1.55;
}

export function hpColorForRatio(ratio: number, owner?: number, ownColonyIndex = 0): number {
  if (owner !== undefined && owner < 0) {
    return ratio >= 0.5 ? 0xf04848 : 0xff3b3b;
  }
  if (owner !== undefined && owner !== ownColonyIndex) {
    if (ratio >= 0.6) return 0x38bdf8;
    if (ratio >= 0.3) return 0xff9b2f;
    return 0xff3b3b;
  }
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
const camQuat = new THREE.Quaternion();

/**
 * Billboard: turns the bar group to the rendering camera right before its backing plate draws (three.js calls
 * `onBeforeRender` before it reads the object's world matrix), so bars stay readable after Q / E camera turns.
 */
function faceCameraBeforeRender(plate: THREE.Mesh, aboveGroup: THREE.Group): void {
  plate.onBeforeRender = (_renderer, _scene, camera) => {
    camera.getWorldQuaternion(camQuat);
    if (aboveGroup.quaternion.equals(camQuat)) return;
    aboveGroup.quaternion.copy(camQuat);
    aboveGroup.updateMatrixWorld(true);
  };
}
export const PROGRESS_BAR_COLOR = 0x38bdf8;

/**
 * Manages 3D overhead HP bars (for mobile units and damaged buildings) and blue progress bars (`0x38bdf8`)
 * for any unit or building with active progress `0 < progress < 1`.
 */
export class UnitHealthBars {
  readonly group = new THREE.Group();
  private readonly bars = new Map<number, UnitBarEntry>();
  private readonly selectedEntityIds = new Set<number>();
  private ownColonyIndex = 0;
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

  /** Whether bars are drawn (the session ties it to the W02 flag; live, read per sync). Default: on. */
  isEnabled: () => boolean = () => true;

  setOwnColonyIndex(colonyIndex: number): void {
    this.ownColonyIndex = colonyIndex;
  }

  setSelectedEntityId(id: number | null): void {
    this.selectedEntityIds.clear();
    if (typeof id === 'number' && Number.isFinite(id)) {
      this.selectedEntityIds.add(id);
    }
  }

  setSelectedEntityIds(ids: Iterable<number>): void {
    this.selectedEntityIds.clear();
    for (const id of ids) {
      if (typeof id === 'number' && Number.isFinite(id)) {
        this.selectedEntityIds.add(id);
      }
    }
  }

  sync(records: Iterable<UnitHealthRecordLike>): void {
    const seen = new Set<number>();
    for (const rec of this.isEnabled() ? records : []) {
      const kind = resolveHealthBarKind(rec.kind);
      if (!isBarSupportedKind(kind) || rec.hp <= 0 || rec.hpMax <= 0) continue;
      const isUnit = isMobileUnitKind(kind);
      const isDamaged = rec.hp < rec.hpMax;
      const isSelected = Boolean(rec.selected) || this.selectedEntityIds.has(rec.id);
      const prog = typeof rec.progress === 'number' && Number.isFinite(rec.progress) ? rec.progress : 0;
      // a descending drop pod's `progress` is its landing, not work: no blue bar over the touchdown cinematic
      const hasProgress = kind !== ENTITY_KIND.pod && prog > 0 && prog < 1;
      if (!isUnit && !isDamaged && !isSelected && !hasProgress) continue;

      seen.add(rec.id);
      let entry = this.bars.get(rec.id);
      if (!entry) {
        entry = this.createEntry(rec.id, kind);
        this.bars.set(rec.id, entry);
      }
      this.updateEntry(entry, rec, isUnit, isDamaged, isSelected, prog, hasProgress);
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
    faceCameraBeforeRender(aboveBg, aboveGroup);

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
    faceCameraBeforeRender(progressBg, aboveGroup);
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
    isSelected: boolean,
    prog: number,
    hasProgress: boolean,
  ): void {
    entry.root.visible = rec.mesh.visible && isEntityInViewFocus(rec.mesh); // off-screen: no layout
    if (!entry.root.visible) return;

    const ownerVal = rec.owner ?? this.ownColonyIndex;
    entry.root.userData.owner = ownerVal;
    entry.hpGroup.userData.owner = ownerVal;
    entry.aboveFill.userData.owner = ownerVal;
    entry.root.position.copy(rec.mesh.position);
    const showHp = isUnit || isDamaged || isSelected;
    entry.hpGroup.visible = showHp;
    if (showHp) {
      const ratio = Math.max(0, Math.min(1, rec.hp / Math.max(1, rec.hpMax)));
      const sx = Math.max(0.001, ratio);
      entry.aboveFill.scale.x = sx;
      entry.aboveFill.position.x = -0.5 * BAR_W * (1 - ratio);
      entry.aboveMat.color.setHex(hpColorForRatio(ratio, rec.owner, this.ownColonyIndex));
    }

    entry.progressGroup.visible = hasProgress;
    entry.progressGroup.position.y = showHp ? -(BAR_H + 0.06) : 0;
    if (hasProgress) {
      const clamped = Math.max(0, Math.min(1, prog));
      const sx = Math.max(0.001, clamped);
      entry.progressFill.scale.x = sx;
      entry.progressFill.position.x = -0.5 * BAR_W * (1 - clamped);
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
