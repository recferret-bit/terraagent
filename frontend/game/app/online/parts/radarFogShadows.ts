import * as THREE from 'three';
import type { HexTerrain } from '@terra/render/planets/hex';
import { isWorldPointInColonyFov } from '@terra/render/lighting/ColonyVisionAndLights';
import { ENTITY_KIND, isFaunaBugKind } from '@terra/sim';
import { collectActiveSensorArrays, isTileInSensorRadar } from '../../../maps/radarLayer';
import type { ClientView } from '../../../store/replica/viewCodec';
import { is2x2BuildingKind, is3x3FootprintKind } from '../entityKinds';

const SQRT3 = Math.sqrt(3);
const MAX_RADAR_SHADOWS_PER_BUCKET = 128;

export const RADAR_SHADOW_COLORS = {
  animal: 0x3deb8a,
  insect: 0xf04848,
  bot: 0x38bdf8,
} as const;

export interface RadarShadowEntitySample {
  readonly id: number;
  readonly kind: number;
  readonly owner: number;
  readonly hp: number;
  readonly mesh: { readonly visible: boolean; readonly position: { readonly x: number; readonly y: number; readonly z: number } };
}

function createBlobMesh(
  geometry: THREE.BufferGeometry,
  color: number,
  name: string,
): { mesh: THREE.InstancedMesh; material: THREE.MeshBasicMaterial } {
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, MAX_RADAR_SHADOWS_PER_BUCKET);
  mesh.name = name;
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = 2;
  return { mesh, material };
}

/**
 * Renders shapeless translucent 3D radar echo shadows through Fog of War for land animals,
 * insects, and foreign players/bots detected by active owned Sensor Arrays (ignoring birds).
 */
export class RadarFogShadows {
  private readonly group = new THREE.Group();
  private readonly geometry = new THREE.IcosahedronGeometry(0.52, 1);
  private readonly animalMesh: THREE.InstancedMesh;
  private readonly insectMesh: THREE.InstancedMesh;
  private readonly botMesh: THREE.InstancedMesh;
  private readonly materials: THREE.Material[];
  private readonly dummy = new THREE.Object3D();

  constructor(parent: THREE.Object3D) {
    this.group.name = 'radar-fog-shadows';
    const animal = createBlobMesh(this.geometry, RADAR_SHADOW_COLORS.animal, 'radar-shadow-animals');
    const insect = createBlobMesh(this.geometry, RADAR_SHADOW_COLORS.insect, 'radar-shadow-insects');
    const bot = createBlobMesh(this.geometry, RADAR_SHADOW_COLORS.bot, 'radar-shadow-bots');
    this.animalMesh = animal.mesh;
    this.insectMesh = insect.mesh;
    this.botMesh = bot.mesh;
    this.materials = [animal.material, insect.material, bot.material];
    this.group.add(this.animalMesh, this.insectMesh, this.botMesh);
    parent.add(this.group);
  }

  private pushBlob(
    mesh: THREE.InstancedMesh,
    index: number,
    wx: number,
    wy: number,
    wz: number,
    baseScale: number,
    phase: number,
    time: number,
  ): number {
    if (index >= MAX_RADAR_SHADOWS_PER_BUCKET) return index;
    const pulse = 1 + 0.08 * Math.sin(time * 2.8 + phase);
    this.dummy.position.set(wx, wy + 0.36 * baseScale, wz);
    this.dummy.rotation.set(0, time * 0.65 + phase, 0);
    this.dummy.scale.set(1.05 * baseScale * pulse, 0.72 * baseScale, 1.05 * baseScale * pulse);
    this.dummy.updateMatrix();
    mesh.setMatrixAt(index, this.dummy.matrix);
    return index + 1;
  }

  /** Updates animal, insect, and foreign bot/player echo instances inside Fog of War. */
  sync(
    entries: Iterable<RadarShadowEntitySample>,
    view: ClientView | null,
    terrain: HexTerrain | null,
    ownerColonyIndex: number,
    spectatorAllVision: boolean,
    time: number,
    isInFov: (x: number, z: number) => boolean = isWorldPointInColonyFov,
  ): { animals: number; insects: number; bots: number } {
    const radarArrays = spectatorAllVision || !view
      ? []
      : collectActiveSensorArrays({ clientView: view, ownColonySlot: ownerColonyIndex, spectatorAllVision });

    if (radarArrays.length === 0) {
      this.animalMesh.count = 0;
      this.insectMesh.count = 0;
      this.botMesh.count = 0;
      return { animals: 0, insects: 0, bots: 0 };
    }

    let nAnimals = 0;
    let nInsects = 0;
    let nBots = 0;

    // 1. Land animals (birds live in getBirdFlocks and are deliberately ignored)
    const landAnimals = terrain?.biosphere.getLandAnimals() ?? [];
    for (let i = 0; i < landAnimals.length && nAnimals < MAX_RADAR_SHADOWS_PER_BUCKET; i++) {
      const a = landAnimals[i]!;
      if (isInFov(a.x, a.z)) continue;
      const ar = a.z / SQRT3;
      const aq = a.x * 0.5 - ar * 0.5;
      if (!isTileInSensorRadar(aq, ar, radarArrays)) continue;
      const gy = terrain ? terrain.heightAt(a.x, a.z) : 0;
      nAnimals = this.pushBlob(this.animalMesh, nAnimals, a.x, gy, a.z, 0.85, i * 0.7, time);
    }

    // 2. Insects and foreign players/bots hidden inside Fog of War
    for (const rec of entries) {
      if (rec.hp <= 0 || rec.mesh.visible) continue;
      if (rec.kind === ENTITY_KIND.pod || rec.kind === ENTITY_KIND.devProbe) continue;
      const wx = rec.mesh.position.x;
      const wz = rec.mesh.position.z;
      if (isInFov(wx, wz)) continue;
      const ar = wz / SQRT3;
      const aq = wx * 0.5 - ar * 0.5;
      if (!isTileInSensorRadar(aq, ar, radarArrays)) continue;
      const gy = terrain ? terrain.heightAt(wx, wz) : rec.mesh.position.y;
      if (isFaunaBugKind(rec.kind)) {
        nInsects = this.pushBlob(this.insectMesh, nInsects, wx, gy, wz, 0.78, rec.id * 0.53, time);
      } else if (rec.owner >= 0 && rec.owner !== ownerColonyIndex) {
        const scale = is3x3FootprintKind(rec.kind) ? 1.45 : is2x2BuildingKind(rec.kind) ? 1.2 : 0.92;
        nBots = this.pushBlob(this.botMesh, nBots, wx, gy, wz, scale, rec.id * 0.41, time);
      }
    }

    this.animalMesh.count = nAnimals;
    this.insectMesh.count = nInsects;
    this.botMesh.count = nBots;
    if (nAnimals > 0) this.animalMesh.instanceMatrix.needsUpdate = true;
    if (nInsects > 0) this.insectMesh.instanceMatrix.needsUpdate = true;
    if (nBots > 0) this.botMesh.instanceMatrix.needsUpdate = true;

    return { animals: nAnimals, insects: nInsects, bots: nBots };
  }

  dispose(): void {
    this.group.removeFromParent();
    this.geometry.dispose();
    for (const mat of this.materials) mat.dispose();
  }
}
