import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ParticleGeometryKind } from './types';

const geometryCache = new Map<ParticleGeometryKind, THREE.BufferGeometry>();

function finalizeGeo(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const nonIndexed = geo.index ? geo.toNonIndexed() : geo;
  nonIndexed.computeVertexNormals();
  nonIndexed.computeBoundingSphere();
  return nonIndexed;
}

function perturbVertices(
  geo: THREE.BufferGeometry,
  scaleX: number,
  scaleY: number,
  scaleZ: number,
  jitter: number,
  seed: number,
): THREE.BufferGeometry {
  const nonIndexed = geo.index ? geo.toNonIndexed() : geo.clone();
  const pos = nonIndexed.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i);
    const vy = pos.getY(i);
    const vz = pos.getZ(i);
    // Deterministic hash by vertex coordinates so shared vertices stay welded before normal computation!
    const key = Math.round(vx * 100) * 73856093 ^ Math.round(vy * 100) * 19349663 ^ Math.round(vz * 100) * 83492791 ^ seed;
    const h1 = ((Math.sin(key * 0.0013) * 43758.5453) % 1 + 1) % 1;
    const h2 = ((Math.sin(key * 0.0029 + 1.7) * 43758.5453) % 1 + 1) % 1;
    const h3 = ((Math.sin(key * 0.0047 + 3.1) * 43758.5453) % 1 + 1) % 1;
    pos.setXYZ(
      i,
      vx * scaleX * (1 + (h1 - 0.5) * jitter),
      vy * scaleY * (1 + (h2 - 0.5) * jitter),
      vz * scaleZ * (1 + (h3 - 0.5) * jitter),
    );
  }
  return finalizeGeo(nonIndexed);
}

function nonIdx(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  return geo.index ? geo.toNonIndexed() : geo;
}

function buildLeafCluster(): THREE.BufferGeometry {
  const bladeA = new THREE.OctahedronGeometry(0.45, 0);
  bladeA.scale(1.1, 0.22, 0.65);
  bladeA.rotateZ(0.35);
  const bladeB = new THREE.OctahedronGeometry(0.42, 0);
  bladeB.scale(0.65, 0.22, 1.15);
  bladeB.rotateX(-0.4);
  bladeB.translate(0.06, 0.05, -0.04);
  return finalizeGeo(mergeGeometries([nonIdx(bladeA), nonIdx(bladeB)], false));
}

function buildPineNeedle(): THREE.BufferGeometry {
  const sprigA = new THREE.ConeGeometry(0.16, 0.95, 4);
  sprigA.rotateZ(0.28);
  const sprigB = new THREE.ConeGeometry(0.15, 0.88, 4);
  sprigB.rotateZ(-0.32);
  sprigB.rotateX(0.25);
  return finalizeGeo(mergeGeometries([nonIdx(sprigA), nonIdx(sprigB)], false));
}

function buildBarkSlab(): THREE.BufferGeometry {
  const base = new THREE.BoxGeometry(0.52, 0.16, 0.92);
  const ridge = new THREE.ConeGeometry(0.22, 0.86, 4);
  ridge.rotateX(Math.PI / 2);
  ridge.scale(1.0, 0.45, 1.0);
  ridge.translate(0, 0.08, 0);
  return perturbVertices(
    mergeGeometries([nonIdx(base), nonIdx(ridge)], false),
    1.0,
    1.0,
    1.0,
    0.22,
    101,
  );
}

function buildWoodSplinter(): THREE.BufferGeometry {
  const wedge = new THREE.ConeGeometry(0.18, 1.05, 4);
  wedge.rotateX(Math.PI / 2);
  return perturbVertices(wedge, 0.75, 0.55, 1.15, 0.25, 202);
}

function buildCrystalShard(): THREE.BufferGeometry {
  const shaft = new THREE.CylinderGeometry(0.18, 0.22, 0.62, 6, 1, true);
  const tipTop = new THREE.ConeGeometry(0.18, 0.34, 6, 1, true);
  tipTop.translate(0, 0.48, 0);
  const tipBot = new THREE.ConeGeometry(0.22, 0.24, 6, 1, true);
  tipBot.rotateX(Math.PI);
  tipBot.translate(0, -0.43, 0);
  return finalizeGeo(
    mergeGeometries([nonIdx(shaft), nonIdx(tipTop), nonIdx(tipBot)], false),
  );
}

function buildShockRing(): THREE.BufferGeometry {
  const torus = new THREE.TorusGeometry(0.42, 0.045, 3, 8);
  torus.rotateX(-Math.PI / 2);
  torus.scale(1, 0.45, 1);
  return finalizeGeo(torus);
}

function createGeometryByKind(kind: ParticleGeometryKind): THREE.BufferGeometry {
  switch (kind) {
    case 'leafCluster':
      return buildLeafCluster();
    case 'pineNeedle':
      return buildPineNeedle();
    case 'barkSlab':
      return buildBarkSlab();
    case 'woodSplinter':
      return buildWoodSplinter();
    case 'rockShard':
      return perturbVertices(new THREE.IcosahedronGeometry(0.48, 0), 1.12, 0.82, 1.05, 0.34, 303);
    case 'slateChunk':
      return perturbVertices(new THREE.OctahedronGeometry(0.52, 0), 1.25, 0.38, 1.1, 0.28, 404);
    case 'sandGrain':
      return perturbVertices(new THREE.OctahedronGeometry(0.42, 0), 0.85, 0.65, 1.35, 0.18, 505);
    case 'dustCloud':
      return perturbVertices(new THREE.DodecahedronGeometry(0.5, 0), 1.15, 0.88, 1.15, 0.16, 606);
    case 'soilClod':
      return perturbVertices(new THREE.IcosahedronGeometry(0.46, 0), 1.08, 0.92, 1.04, 0.38, 707);
    case 'crystalShard':
      return buildCrystalShard();
    case 'oreNugget':
      return perturbVertices(new THREE.DodecahedronGeometry(0.46, 0), 1.1, 0.85, 0.98, 0.26, 808);
    case 'oilDroplet':
      return perturbVertices(new THREE.OctahedronGeometry(0.44, 0), 0.78, 1.32, 0.78, 0.12, 909);
    case 'weldSpark': {
      const dart = new THREE.OctahedronGeometry(0.42, 0);
      dart.scale(0.28, 0.28, 1.65);
      return finalizeGeo(dart);
    }
    case 'energyOrb':
      return finalizeGeo(new THREE.IcosahedronGeometry(0.42, 0));
    case 'shockRing':
      return buildShockRing();
  }
}

export function getParticleGeometry(kind: ParticleGeometryKind): THREE.BufferGeometry {
  let cached = geometryCache.get(kind);
  if (!cached) {
    cached = createGeometryByKind(kind);
    geometryCache.set(kind, cached);
  }
  return cached;
}

export function getParticleGeometryTriCount(kind: ParticleGeometryKind): number {
  const geo = getParticleGeometry(kind);
  const pos = geo.getAttribute('position');
  return pos ? Math.floor(pos.count / 3) : 0;
}
