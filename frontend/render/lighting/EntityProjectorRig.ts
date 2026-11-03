import * as THREE from 'three';
import {
  getArchetypeLights,
  getArchetypeLightsVersion,
  type ArchetypeLightSource,
} from './archetypeLights';

export * from './archetypeLights';

const DOWN_AXIS = new THREE.Vector3(0, -1, 0);
const _tmpColor = new THREE.Color();

export interface EntityProjectorRigState {
  readonly group: THREE.Group;
  readonly beamMat: THREE.MeshBasicMaterial;
  readonly poolMat: THREE.MeshBasicMaterial;
  readonly lensMat: THREE.MeshBasicMaterial;
  readonly kind: 'robot' | 'building' | 'pod';
  readonly archetypeId: string;
  rebuild(lights?: ArchetypeLightSource[]): void;
  setPower(intensity: number, buildStage?: number): void;
  dispose(): void;
}

function normalizeArchetypeId(kindOrArchetype: string): string {
  if (kindOrArchetype === 'robot') return 'robot.hero';
  if (kindOrArchetype === 'building') return 'building.commandHub';
  if (kindOrArchetype === 'pod') return 'ship.dropPod';
  return kindOrArchetype;
}

function resolveRigKind(archetypeId: string): 'robot' | 'building' | 'pod' {
  if (archetypeId.startsWith('robot.')) return 'robot';
  if (archetypeId.startsWith('building.')) return 'building';
  return 'pod';
}

function buildVolumetricConeGeo(
  topRadius: number,
  bottomRadius: number,
  length: number,
  colorHex: number,
  intensity: number,
): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(Math.max(0.01, topRadius), Math.max(0.05, bottomRadius), length, 16, 1, true);
  geo.translate(0, -length * 0.5, 0);
  _tmpColor.setHex(colorHex);
  const mult = Math.max(0.1, Math.min(2.5, intensity / 1.25));
  const cr = Math.min(1, _tmpColor.r * mult);
  const cg = Math.min(1, _tmpColor.g * mult);
  const cb = Math.min(1, _tmpColor.b * mult);
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = Math.max(0, Math.min(1, -y / Math.max(0.01, length)));
    const fade = Math.pow(1 - t, 1.75) * (t < 0.06 ? 0.85 : 1.0);
    colors[i * 3] = cr * fade;
    colors[i * 3 + 1] = cg * fade;
    colors[i * 3 + 2] = cb * fade;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

function buildGroundPoolGeo(radius: number, colorHex: number, intensity: number): THREE.BufferGeometry {
  const safeR = Math.max(0.05, radius);
  const geo = new THREE.CircleGeometry(safeR, 24);
  geo.rotateX(-Math.PI / 2);
  _tmpColor.setHex(colorHex);
  const mult = Math.max(0.1, Math.min(2.5, intensity / 1.25));
  const cr = Math.min(1, _tmpColor.r * mult);
  const cg = Math.min(1, _tmpColor.g * mult);
  const cb = Math.min(1, _tmpColor.b * mult);
  const pos = geo.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const r = Math.min(1, Math.hypot(x, z) / safeR);
    const fade = Math.pow(1 - r * r, 1.8);
    colors[i * 3] = cr * fade;
    colors[i * 3 + 1] = cg * fade;
    colors[i * 3 + 2] = cb * fade;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

export class EntityProjectorRig implements EntityProjectorRigState {
  readonly group = new THREE.Group();
  readonly beamMat: THREE.MeshBasicMaterial;
  readonly poolMat: THREE.MeshBasicMaterial;
  readonly lensMat: THREE.MeshBasicMaterial;
  readonly haloMat: THREE.SpriteMaterial;
  readonly kind: 'robot' | 'building' | 'pod';
  readonly archetypeId: string;
  private readonly colorOverride?: number;
  lightsVersion = -1;

  constructor(kindOrArchetype: string, colorHex?: number) {
    this.archetypeId = normalizeArchetypeId(kindOrArchetype);
    this.kind = resolveRigKind(this.archetypeId);
    this.colorOverride = colorHex;
    this.group.name = 'entity-projector-rig';

    const defaultLensColor = colorHex ?? (this.kind === 'robot' ? 0xb8f4ff : 0xfff0c8);

    this.beamMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      transparent: true,
      opacity: 0.14,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });

    this.poolMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      transparent: true,
      opacity: 0.12,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });

    this.lensMat = new THREE.MeshBasicMaterial({
      color: defaultLensColor,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });

    this.haloMat = new THREE.SpriteMaterial({
      color: defaultLensColor,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });

    this.rebuild();
  }

  private clearParts(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry?.dispose?.();
      }
    }
  }

  rebuild(lights?: ArchetypeLightSource[]): void {
    this.clearParts();
    const sources = lights ?? getArchetypeLights(this.archetypeId);
    this.lightsVersion = getArchetypeLightsVersion(this.archetypeId);

    const firstColor = this.colorOverride ?? sources[0]?.color ?? (this.kind === 'robot' ? 0x9ee6ff : 0xffe4b5);
    _tmpColor.setHex(firstColor).lerp(new THREE.Color(0xffffff), 0.35);
    this.lensMat.color.copy(_tmpColor);
    this.haloMat.color.copy(_tmpColor);

    for (const source of sources) {
      const color = this.colorOverride ?? source.color;
      const [px, py, pz] = source.pos;
      const [tx, ty, tz] = source.target;

      const lensRadius = Math.max(0.055, source.coneTopRadius * 0.62);
      const lens = new THREE.Mesh(new THREE.SphereGeometry(lensRadius, 8, 6), this.lensMat);
      lens.name = 'projector-lamp-lens';
      lens.position.set(px, py, pz);
      lens.castShadow = false;

      const halo = new THREE.Sprite(this.haloMat);
      halo.name = 'projector-lamp-halo';
      halo.position.set(px, py, pz);
      halo.scale.setScalar(Math.max(0.24, source.coneTopRadius * 2.4));

      const v = new THREE.Vector3(tx - px, ty - py, tz - pz);
      const len = Math.max(0.2, v.length());
      const dir = v.clone().normalize();

      const coneGeo = buildVolumetricConeGeo(
        source.coneTopRadius,
        source.coneBottomRadius,
        len,
        color,
        source.intensity,
      );
      const cone = new THREE.Mesh(coneGeo, this.beamMat);
      cone.name = 'projector-beam-cone';
      cone.position.set(px, py, pz);
      cone.quaternion.setFromUnitVectors(DOWN_AXIS, dir);
      cone.castShadow = false;
      cone.renderOrder = 2;

      const poolGeo = buildGroundPoolGeo(source.poolRadius, color, source.intensity);
      const pool = new THREE.Mesh(poolGeo, this.poolMat);
      pool.name = 'projector-ground-pool';
      pool.position.set(tx, Math.max(0.02, ty), tz);
      pool.castShadow = false;
      pool.renderOrder = 1;

      this.group.add(lens, halo, cone, pool);
    }
  }

  setPower(intensity: number, buildStage = 1): void {
    if (intensity <= 0.005) {
      this.beamMat.opacity = 0;
      this.poolMat.opacity = 0;
      this.lensMat.opacity = 0;
      this.haloMat.opacity = 0;
      this.group.visible = false;
      return;
    }
    const stageScale = this.kind === 'building' ? (buildStage <= 0.01 ? 0.18 : 0.35 + 0.65 * buildStage) : 1.0;
    const nightBoost = Math.max(0, Math.min(2.0, intensity));
    const active = Math.min(1.5, nightBoost) * stageScale;
    if (active <= 0.005) {
      this.beamMat.opacity = 0;
      this.poolMat.opacity = 0;
      this.lensMat.opacity = 0;
      this.haloMat.opacity = 0;
      this.group.visible = false;
      return;
    }

    this.beamMat.opacity = Math.min(0.62, 0.36 * active);
    this.poolMat.opacity = Math.min(0.54, 0.30 * active);
    this.lensMat.opacity = Math.min(1.0, 0.45 + 0.55 * active);
    this.haloMat.opacity = Math.min(0.65, 0.35 * active);
    this.group.visible = true;
  }

  dispose(): void {
    this.clearParts();
    this.beamMat.dispose();
    this.poolMat.dispose();
    this.lensMat.dispose();
    this.haloMat.dispose();
  }
}

/**
 * Attaches a 3D volumetric projector rig (lamp lens, volumetric spotlight cones, and ground illumination discs)
 * to a robot, building, or drop-pod mesh. Idempotent if already attached.
 */
export function attachEntityProjectorRig(mesh: THREE.Object3D, archetypeId: string): EntityProjectorRigState | null {
  const existing = (mesh.userData as { projectorRig?: EntityProjectorRigState } | undefined)?.projectorRig;
  if (existing) return existing;

  const isRobot = archetypeId.startsWith('robot.');
  const isBuilding = archetypeId.startsWith('building.');
  const isPod = archetypeId === 'ship.dropPod';
  if (!isRobot && !isBuilding && !isPod) return null;

  const rig = new EntityProjectorRig(archetypeId);
  mesh.add(rig.group);
  mesh.userData = { ...(mesh.userData ?? {}), projectorRig: rig };
  return rig;
}

/** Modulates a mesh's projector rig intensity according to `nightFactor` [0..2] and construction `buildStage` [0..1]. */
export function updateEntityProjectorRig(mesh: THREE.Object3D, nightFactor: number, buildStage = 1): void {
  const rig = (mesh.userData as { projectorRig?: EntityProjectorRig } | undefined)?.projectorRig;
  if (!rig) return;
  if (rig.lightsVersion !== getArchetypeLightsVersion(rig.archetypeId)) {
    rig.rebuild();
  }
  rig.setPower(nightFactor, buildStage);
}
