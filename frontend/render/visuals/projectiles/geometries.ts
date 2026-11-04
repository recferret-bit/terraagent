import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type ProjectileGeometryKey =
  | 'bullet'
  | 'shell'
  | 'rocket'
  | 'acid'
  | 'laserCore'
  | 'laserSheath'
  | 'smokePuff'
  | 'impactFlash'
  | 'impactDebris'
  | 'aoeRing'
  | 'aoeDecal';

const geoCache = new Map<ProjectileGeometryKey, THREE.BufferGeometry>();

function nonIdx(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  return geo.index ? geo.toNonIndexed() : geo;
}

function finalizeGeo(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = nonIdx(geo);
  out.computeVertexNormals();
  out.computeBoundingSphere();
  return out;
}

function buildBulletTracerGeo(): THREE.BufferGeometry {
  const core = new THREE.OctahedronGeometry(0.11, 0);
  core.scale(0.65, 0.65, 3.8);
  return finalizeGeo(core);
}

function buildArtilleryShellGeo(): THREE.BufferGeometry {
  const body = new THREE.CylinderGeometry(0.12, 0.14, 0.42, 6);
  body.rotateX(Math.PI / 2);
  const nose = new THREE.ConeGeometry(0.12, 0.26, 6);
  nose.rotateX(Math.PI / 2);
  nose.translate(0, 0, 0.34);
  const tail = new THREE.CylinderGeometry(0.16, 0.09, 0.14, 6);
  tail.rotateX(Math.PI / 2);
  tail.translate(0, 0, -0.26);
  return finalizeGeo(mergeGeometries([nonIdx(body), nonIdx(nose), nonIdx(tail)], false));
}

function buildRocketBodyGeo(): THREE.BufferGeometry {
  const tube = new THREE.CylinderGeometry(0.09, 0.1, 0.48, 6);
  tube.rotateX(Math.PI / 2);
  const warhead = new THREE.ConeGeometry(0.105, 0.24, 6);
  warhead.rotateX(Math.PI / 2);
  warhead.translate(0, 0, 0.36);
  const finH = new THREE.BoxGeometry(0.34, 0.03, 0.16);
  finH.translate(0, 0, -0.18);
  const finV = new THREE.BoxGeometry(0.03, 0.34, 0.16);
  finV.translate(0, 0, -0.18);
  return finalizeGeo(
    mergeGeometries([nonIdx(tube), nonIdx(warhead), nonIdx(finH), nonIdx(finV)], false),
  );
}

function buildAcidGlobGeo(): THREE.BufferGeometry {
  const main = new THREE.IcosahedronGeometry(0.19, 0);
  main.scale(0.92, 0.88, 1.35);
  const lobe = new THREE.OctahedronGeometry(0.13, 0);
  lobe.translate(0, 0.03, -0.18);
  return finalizeGeo(mergeGeometries([nonIdx(main), nonIdx(lobe)], false));
}

function buildLaserCylinderGeo(radius: number): THREE.BufferGeometry {
  // Unit-length cylinder along +Z from z = 0 to z = 1
  const cyl = new THREE.CylinderGeometry(radius, radius, 1, 6, 1, false);
  cyl.rotateX(Math.PI / 2);
  cyl.translate(0, 0, 0.5);
  return finalizeGeo(cyl);
}

function buildSmokePuffGeo(): THREE.BufferGeometry {
  const puff = new THREE.DodecahedronGeometry(0.24, 0);
  puff.scale(1.1, 0.9, 1.1);
  return finalizeGeo(puff);
}

function buildImpactFlashGeo(): THREE.BufferGeometry {
  const core = new THREE.IcosahedronGeometry(0.32, 0);
  const spike = new THREE.OctahedronGeometry(0.42, 0);
  spike.scale(1.25, 0.55, 1.25);
  return finalizeGeo(mergeGeometries([nonIdx(core), nonIdx(spike)], false));
}

function buildImpactDebrisGeo(): THREE.BufferGeometry {
  const shard = new THREE.OctahedronGeometry(0.12, 0);
  shard.scale(1.2, 0.65, 0.9);
  return finalizeGeo(shard);
}

function buildAoeRingGeo(): THREE.BufferGeometry {
  const torus = new THREE.TorusGeometry(1.0, 0.065, 4, 18);
  torus.rotateX(-Math.PI / 2);
  torus.scale(1, 0.45, 1);
  return finalizeGeo(torus);
}

function buildAoeDecalGeo(): THREE.BufferGeometry {
  // Low-poly 3D bevelled scorch/crater disc on XZ plane (unit radius)
  const rim = new THREE.CylinderGeometry(0.96, 1.0, 0.05, 14, 1, false);
  rim.translate(0, 0.025, 0);
  return finalizeGeo(rim);
}

export function getProjectileVfxGeometry(key: ProjectileGeometryKey): THREE.BufferGeometry {
  const cached = geoCache.get(key);
  if (cached) return cached;
  let geo: THREE.BufferGeometry;
  switch (key) {
    case 'bullet':
      geo = buildBulletTracerGeo();
      break;
    case 'shell':
      geo = buildArtilleryShellGeo();
      break;
    case 'rocket':
      geo = buildRocketBodyGeo();
      break;
    case 'acid':
      geo = buildAcidGlobGeo();
      break;
    case 'laserCore':
      geo = buildLaserCylinderGeo(0.055);
      break;
    case 'laserSheath':
      geo = buildLaserCylinderGeo(0.13);
      break;
    case 'smokePuff':
      geo = buildSmokePuffGeo();
      break;
    case 'impactFlash':
      geo = buildImpactFlashGeo();
      break;
    case 'impactDebris':
      geo = buildImpactDebrisGeo();
      break;
    case 'aoeRing':
      geo = buildAoeRingGeo();
      break;
    case 'aoeDecal':
      geo = buildAoeDecalGeo();
      break;
  }
  geoCache.set(key, geo);
  return geo;
}

export interface EmissivePoolSpec {
  key: ProjectileGeometryKey;
  count: number;
  color: number;
  emissive: number;
  emissiveIntensity: number;
  roughness?: number;
  metalness?: number;
  additive?: boolean;
  opacity?: number;
}

const ZERO_DUMMY = new THREE.Object3D();

export function createPooledInstancedMesh(
  spec: EmissivePoolSpec,
  parent: THREE.Group,
): { mesh: THREE.InstancedMesh; material: THREE.Material } {
  const geo = getProjectileVfxGeometry(spec.key);
  const material = spec.additive
    ? new THREE.MeshBasicMaterial({
        color: spec.color,
        transparent: true,
        opacity: spec.opacity ?? 0.48,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    : new THREE.MeshStandardMaterial({
        color: spec.color,
        emissive: new THREE.Color(spec.emissive),
        emissiveIntensity: spec.emissiveIntensity,
        roughness: spec.roughness ?? 0.3,
        metalness: spec.metalness ?? 0.1,
        flatShading: true,
      });

  const mesh = new THREE.InstancedMesh(geo, material, spec.count);
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;

  ZERO_DUMMY.scale.setScalar(0);
  ZERO_DUMMY.updateMatrix();
  const baseColor = new THREE.Color(0xffffff);
  for (let i = 0; i < spec.count; i++) {
    mesh.setMatrixAt(i, ZERO_DUMMY.matrix);
    mesh.setColorAt(i, baseColor);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  parent.add(mesh);
  return { mesh, material };
}
