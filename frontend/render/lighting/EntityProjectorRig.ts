import * as THREE from 'three';
import {
  getArchetypeLights,
  getArchetypeLightsVersion,
  peekArchetypeLights,
  type ArchetypeLightSource,
} from './archetypeLights';
import { MAX_COLONY_PROJECTORS, type ColonyProjectorDesc } from './ColonyVisionAndLights';
import { createProjectorBeamMaterial } from './projectorBeamMaterial';
import { beamFalloff, buildBeamRays, projectorConeFromSource, projectorCosOuter } from './projectorCone';

export * from './archetypeLights';
export * from './projectorCone';

const _tmpColor = new THREE.Color();
const _projPos = new THREE.Vector3();
const _projTgt = new THREE.Vector3();
const _projDir = new THREE.Vector3();
let radialHaloTex: THREE.DataTexture | null = null;

function getRadialHaloTexture(): THREE.DataTexture {
  if (radialHaloTex) return radialHaloTex;
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  const half = (size - 1) * 0.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - half) / half;
      const dy = (y - half) / half;
      const r2 = dx * dx + dy * dy;
      const alpha = r2 >= 1 ? 0 : Math.exp(-r2 * 4.2) * (1 - r2);
      const idx = (y * size + x) * 4;
      data[idx] = 255;
      data[idx + 1] = 255;
      data[idx + 2] = 255;
      data[idx + 3] = Math.round(Math.max(0, Math.min(1, alpha)) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  radialHaloTex = tex;
  return tex;
}

/** Collects GPU terrain projector light descriptors from active unit/building meshes with optional turret yaw rotation. */
export function collectEntityProjectors(
  entries: Iterable<{ archetypeId: string; mesh: THREE.Object3D }>,
  boost = 1.35,
): ColonyProjectorDesc[] {
  const projectors: ColonyProjectorDesc[] = [];
  for (const entry of entries) {
    entry.mesh.updateMatrixWorld(true);
    const lights = peekArchetypeLights(entry.archetypeId);
    const turretYaw = (entry.mesh.userData as { turretYaw?: number } | undefined)?.turretYaw ?? 0;
    for (const l of lights) {
      if (projectors.length >= MAX_COLONY_PROJECTORS) return projectors;
      let [px, py, pz] = l.pos;
      let [tx, ty, tz] = l.target;
      if (l.turretMounted && turretYaw !== 0) {
        const [pivX, pivZ] = l.turretPivot ?? [0, 0];
        const ct = Math.cos(turretYaw), st = Math.sin(turretYaw);
        const rpx = px - pivX, rpz = pz - pivZ;
        px = pivX + rpx * ct + rpz * st;
        pz = pivZ - rpx * st + rpz * ct;
        const rtx = tx - pivX, rtz = tz - pivZ;
        tx = pivX + rtx * ct + rtz * st;
        tz = pivZ - rtx * st + rtz * ct;
      }
      _projPos.set(px, py, pz).applyMatrix4(entry.mesh.matrixWorld);
      _projTgt.set(tx, ty, tz).applyMatrix4(entry.mesh.matrixWorld);
      _projDir.copy(_projTgt).sub(_projPos);
      const dist = _projDir.length();
      if (dist > 1e-4) _projDir.divideScalar(dist);
      else _projDir.set(0, -1, 0);
      _tmpColor.setHex(l.color);
      projectors.push({
        x: _projPos.x, y: _projPos.y, z: _projPos.z, range: l.range,
        dirX: _projDir.x, dirY: _projDir.y, dirZ: _projDir.z,
        cosAngle: projectorCosOuter(l),
        r: _tmpColor.r, g: _tmpColor.g, b: _tmpColor.b, intensity: l.intensity * boost,
      });
    }
  }
  return projectors;
}

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

/** Steps along each beam generator (vertex colours follow the GPU falloff `(1 - d / range)^2` per step). */
const BEAM_STEPS = 8;
/** Ground-hitting generators continue this far (model metres) below the ground plane, so the beam still reaches the
 *  terrain in dips; on flat or rising ground the depth test hides that part and the beam ends on the terrain. */
const BEAM_SINK = 1.2;
/** Brightness of the beam shell relative to the lamp colour: the cone spans the whole lit pool, so it stays faint. */
const BEAM_GAIN = 0.8;

function sourceColor(colorHex: number, intensity: number): [number, number, number] {
  _tmpColor.setHex(colorHex);
  const mult = Math.max(0.1, Math.min(2.5, intensity / 1.25));
  return [Math.min(1, _tmpColor.r * mult), Math.min(1, _tmpColor.g * mult), Math.min(1, _tmpColor.b * mult)];
}

/**
 * The visible beam of `source`: an open cone shell from the lamp along the GPU projector's axis at its half-power
 * angle (`projectorCone.ts`), each generator ending where it meets the ground (or fading out at the light's range),
 * so the beam's footprint is the lit pool from every camera angle. Built in model space; the rig group is NOT rotated.
 */
function buildVolumetricBeamGeo(source: Readonly<ArchetypeLightSource>, colorHex: number): THREE.BufferGeometry {
  const cone = projectorConeFromSource(source);
  const rays = buildBeamRays(cone, {
    groundY: source.target[1],
    sink: BEAM_SINK,
    aperture: Math.max(0.01, source.coneTopRadius),
    segments: 24,
  });
  const [cr, cg, cb] = sourceColor(colorHex, source.intensity);
  const n = rays.length;
  const positions = new Float32Array(n * (BEAM_STEPS + 1) * 3);
  const colors = new Float32Array(positions.length);
  for (let i = 0; i < n; i++) {
    const ray = rays[i]!;
    for (let k = 0; k <= BEAM_STEPS; k++) {
      const d = (ray.length * k) / BEAM_STEPS;
      const o = (i * (BEAM_STEPS + 1) + k) * 3;
      positions[o] = ray.origin.x + ray.dir.x * d;
      positions[o + 1] = ray.origin.y + ray.dir.y * d;
      positions[o + 2] = ray.origin.z + ray.dir.z * d;
      const fade = BEAM_GAIN * beamFalloff(d, cone.range) * (k === 0 ? 0.85 : 1);
      colors[o] = cr * fade;
      colors[o + 1] = cg * fade;
      colors[o + 2] = cb * fade;
    }
  }
  const index: number[] = [];
  for (let i = 0; i < n; i++) {
    const a0 = i * (BEAM_STEPS + 1);
    const b0 = ((i + 1) % n) * (BEAM_STEPS + 1);
    for (let k = 0; k < BEAM_STEPS; k++) index.push(a0 + k, b0 + k, a0 + k + 1, b0 + k, b0 + k + 1, a0 + k + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(index);
  geo.computeVertexNormals(); // the view-facing fade of `createProjectorBeamMaterial` reads them
  geo.computeBoundingSphere();
  return geo;
}

function buildGroundPoolGeo(radius: number, colorHex: number, intensity: number): THREE.BufferGeometry {
  const safeR = Math.max(0.05, radius);
  const geo = new THREE.CircleGeometry(safeR, 24);
  geo.rotateX(-Math.PI / 2);
  const [cr, cg, cb] = sourceColor(colorHex, intensity);
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
  private readonly turretGroups: THREE.Group[] = [];
  lightsVersion = -1;

  constructor(kindOrArchetype: string, colorHex?: number) {
    this.archetypeId = normalizeArchetypeId(kindOrArchetype);
    this.kind = resolveRigKind(this.archetypeId);
    this.colorOverride = colorHex;
    this.group.name = 'entity-projector-rig';

    const defaultLensColor = colorHex ?? (this.kind === 'robot' ? 0xb8f4ff : 0xfff0c8);

    this.beamMat = createProjectorBeamMaterial();

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
      map: getRadialHaloTexture(),
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
    this.turretGroups.length = 0;
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      child.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry?.dispose?.();
        }
      });
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
      const [pivX, pivZ] = source.turretMounted ? (source.turretPivot ?? [0, 0]) : [0, 0];

      const lensRadius = Math.max(0.055, source.coneTopRadius * 0.62);
      const lens = new THREE.Mesh(new THREE.SphereGeometry(lensRadius, 8, 6), this.lensMat);
      lens.name = 'projector-lamp-lens';
      lens.position.set(px - pivX, py, pz - pivZ);
      lens.castShadow = false;

      const halo = new THREE.Sprite(this.haloMat);
      halo.name = 'projector-lamp-halo';
      halo.position.set(px - pivX, py, pz - pivZ);
      halo.scale.setScalar(Math.max(0.24, source.coneTopRadius * 2.4));

      const beamGeo = buildVolumetricBeamGeo(source, color);
      if (pivX !== 0 || pivZ !== 0) beamGeo.translate(-pivX, 0, -pivZ);
      const cone = new THREE.Mesh(beamGeo, this.beamMat);
      cone.name = 'projector-beam-cone';
      cone.castShadow = false;
      cone.renderOrder = 2;

      const poolGeo = buildGroundPoolGeo(source.poolRadius, color, source.intensity);
      const pool = new THREE.Mesh(poolGeo, this.poolMat);
      pool.name = 'projector-ground-pool';
      pool.position.set(tx - pivX, Math.max(0.02, ty), tz - pivZ);
      pool.castShadow = false;
      pool.renderOrder = 1;

      if (source.turretMounted) {
        const pivotGroup = new THREE.Group();
        pivotGroup.name = 'projector-turret-pivot';
        pivotGroup.position.set(pivX, 0, pivZ);
        pivotGroup.add(lens, halo, cone, pool);
        this.group.add(pivotGroup);
        this.turretGroups.push(pivotGroup);
      } else {
        this.group.add(lens, halo, cone, pool);
      }
    }
  }

  setTurretYaw(yaw: number): void {
    for (const g of this.turretGroups) g.rotation.y = yaw;
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
  const turretYaw = (mesh.userData as { turretYaw?: number } | undefined)?.turretYaw ?? 0;
  rig.setTurretYaw(turretYaw);
  rig.setPower(nightFactor, buildStage);
}
