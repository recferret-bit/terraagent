import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const SHATTER_CHUNKS = 10;

export interface ShatterPiece {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
}

export interface TwisterVictim {
  kind: 'tree' | 'unit';
  entityId?: number;
  bodyGroup: THREE.Group;
  shatterGroup: THREE.Group;
  shatterPieces: ShatterPiece[];
  sparkFlash: THREE.Mesh;
  age: number;
  shattered: boolean;
  shatterAge: number;
  angle: number;
  height: number;
  vy: number;
  flungVx: number;
  flungVz: number;
}

export interface FunnelLayerBinding {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  radiusScale: number;
  heightScale: number;
}

export interface ActiveTwisterInstance {
  id: number;
  root: THREE.Group;
  funnelLayers: FunnelLayerBinding[];
  dustSkirtMesh: THREE.Mesh;
  dustDiscMesh: THREE.Mesh;
  dustSkirtMat: THREE.ShaderMaterial;
  vortexParticles: THREE.Mesh[];
  baseWx: number;
  baseWz: number;
  wx: number;
  wy: number;
  wz: number;
  targetWx: number;
  targetWz: number;
  dirRad: number;
  speedMps: number;
  age: number;
  elapsed: number;
  bendX: number;
  bendZ: number;
  durationS: number;
  syncedFromSim: boolean;
  dissipating: boolean;
  dissipateAge: number;
  seenTrees: Set<string>;
  seenUnits: Set<string>;
  victims: TwisterVictim[];
}

export interface SharedTwisterResources {
  geos: THREE.BufferGeometry[];
  mats: THREE.Material[];
  funnelGeo: THREE.CylinderGeometry;
  dustSkirtGeo: THREE.CylinderGeometry;
  dustDiscGeo: THREE.CylinderGeometry;
  rockGeo: THREE.DodecahedronGeometry;
  clodGeo: THREE.OctahedronGeometry;
  leafClusterGeo: THREE.DodecahedronGeometry;
  trunkGeo: THREE.CylinderGeometry;
  pineTreeGeo: THREE.BufferGeometry;
  broadleafTreeGeo: THREE.BufferGeometry;
  unitHullGeo: RoundedBoxGeometry;
  unitVisorGeo: RoundedBoxGeometry;
  splinterGeo: THREE.ConeGeometry;
  sparkGeo: THREE.OctahedronGeometry;
  rockMat: THREE.MeshStandardMaterial;
  soilClodMat: THREE.MeshStandardMaterial;
  trunkMat: THREE.MeshStandardMaterial;
  treeMat: THREE.MeshStandardMaterial;
  foliageChunkMat: THREE.MeshStandardMaterial;
  unitHullMat: THREE.MeshStandardMaterial;
  unitAccentMat: THREE.MeshStandardMaterial;
  sparkMat: THREE.MeshStandardMaterial;
}

export function createSharedTwisterResources(
  pineTreeGeo: THREE.BufferGeometry,
  broadleafTreeGeo: THREE.BufferGeometry,
  treeMat: THREE.MeshStandardMaterial,
): SharedTwisterResources {
  const funnelGeo = new THREE.CylinderGeometry(3.4, 0.48, 1.0, 48, 48, true).translate(0, 0.5, 0);
  const dustSkirtGeo = new THREE.CylinderGeometry(4.2, 1.8, 1.0, 40, 16, true).translate(0, 0.5, 0);
  const dustDiscGeo = new THREE.CylinderGeometry(5.5, 0.75, 0.38, 40, 8, true).translate(0, 0.19, 0);
  const rockGeo = new THREE.DodecahedronGeometry(0.28, 0);
  const clodGeo = new THREE.OctahedronGeometry(0.24, 0);
  const leafClusterGeo = new THREE.DodecahedronGeometry(0.22, 0).scale(1.25, 0.65, 1.1);
  const trunkGeo = new THREE.CylinderGeometry(0.14, 0.24, 0.65, 6);
  const unitHullGeo = new RoundedBoxGeometry(0.85, 0.52, 1.05, 2, 0.08);
  const unitVisorGeo = new RoundedBoxGeometry(0.55, 0.2, 0.25, 1, 0.04);
  const splinterGeo = new THREE.ConeGeometry(0.14, 0.54, 4);
  const sparkGeo = new THREE.OctahedronGeometry(0.22, 0);
  const geos: THREE.BufferGeometry[] = [
    funnelGeo, dustSkirtGeo, dustDiscGeo, rockGeo, clodGeo, leafClusterGeo,
    trunkGeo, pineTreeGeo, broadleafTreeGeo, unitHullGeo, unitVisorGeo, splinterGeo, sparkGeo,
  ];
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x4b4842, roughness: 0.88, metalness: 0.14 });
  const soilClodMat = new THREE.MeshStandardMaterial({ color: 0x3d3228, roughness: 0.92, metalness: 0.06 });
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3424, roughness: 0.88, metalness: 0.06 });
  const foliageChunkMat = new THREE.MeshStandardMaterial({ color: 0x265430, roughness: 0.86, metalness: 0.04 });
  const unitHullMat = new THREE.MeshStandardMaterial({ color: 0xd8dde6, roughness: 0.48, metalness: 0.42 });
  const unitAccentMat = new THREE.MeshStandardMaterial({ color: 0xe86a24, emissive: 0x00e5ff, emissiveIntensity: 2.2, roughness: 0.4 });
  const sparkMat = new THREE.MeshStandardMaterial({ color: 0xff922b, emissive: 0xff6a13, emissiveIntensity: 3.8, toneMapped: false });
  const mats: THREE.Material[] = [rockMat, soilClodMat, trunkMat, treeMat, foliageChunkMat, unitHullMat, unitAccentMat, sparkMat];

  return {
    geos, mats, funnelGeo, dustSkirtGeo, dustDiscGeo, rockGeo, clodGeo, leafClusterGeo,
    trunkGeo, pineTreeGeo, broadleafTreeGeo, unitHullGeo, unitVisorGeo, splinterGeo, sparkGeo,
    rockMat, soilClodMat, trunkMat, treeMat, foliageChunkMat, unitHullMat, unitAccentMat, sparkMat,
  };
}

export function buildVictimInstance(
  res: SharedTwisterResources,
  kind: 'tree' | 'unit',
  seedAngle: number,
  entityId?: number,
): { group: THREE.Group; victim: TwisterVictim } {
  const container = new THREE.Group();
  const bodyGroup = new THREE.Group();
  container.add(bodyGroup);
  if (kind === 'tree') {
    const useBroadleaf = Math.floor(Math.abs(seedAngle) * 10) % 3 === 2;
    const crownMesh = new THREE.Mesh(useBroadleaf ? res.broadleafTreeGeo : res.pineTreeGeo, res.treeMat);
    crownMesh.scale.set(0.45, 0.5, 0.45);
    const rootBall = new THREE.Mesh(res.trunkGeo, res.trunkMat);
    rootBall.position.y = 0.18;
    bodyGroup.add(rootBall, crownMesh);
  } else {
    const hull = new THREE.Mesh(res.unitHullGeo, res.unitHullMat);
    const visor = new THREE.Mesh(res.unitVisorGeo, res.unitAccentMat);
    visor.position.set(0, 0.14, 0.46);
    bodyGroup.add(hull, visor);
  }
  const shatterGroup = new THREE.Group();
  shatterGroup.visible = false;
  container.add(shatterGroup);
  const shatterPieces: ShatterPiece[] = [];
  for (let i = 0; i < SHATTER_CHUNKS; i++) {
    const isTreeFoliage = kind === 'tree' && i % 2 === 0;
    const mat = kind === 'tree'
      ? (isTreeFoliage ? res.foliageChunkMat : res.trunkMat)
      : (i % 3 === 0 ? res.sparkMat : i % 2 === 0 ? res.unitHullMat : res.rockMat);
    const geo = kind === 'tree' ? (isTreeFoliage ? res.leafClusterGeo : res.splinterGeo) : res.rockGeo;
    const mesh = new THREE.Mesh(geo, mat);
    shatterGroup.add(mesh);
    const ang = (i / SHATTER_CHUNKS) * Math.PI * 2;
    shatterPieces.push({
      mesh,
      pos: new THREE.Vector3(0, 0.25, 0),
      vel: new THREE.Vector3(Math.cos(ang) * (3.2 + (i % 3) * 1.4), 4.5 + (i % 4) * 1.6, Math.sin(ang) * (3.2 + (i % 3) * 1.4)),
    });
  }
  const sparkFlash = new THREE.Mesh(res.sparkGeo, res.sparkMat);
  sparkFlash.scale.setScalar(2.4);
  shatterGroup.add(sparkFlash);
  const flingDir = seedAngle + 1.2;
  return {
    group: container,
    victim: {
      kind, entityId, bodyGroup, shatterGroup, shatterPieces, sparkFlash,
      age: 0, shattered: false, shatterAge: 0, angle: seedAngle, height: 0.2, vy: 3.6,
      flungVx: Math.cos(flingDir) * 6.4, flungVz: Math.sin(flingDir) * 6.4,
    },
  };
}

export function createVortexDebrisParticle(res: SharedTwisterResources, index: number): THREE.Mesh {
  const bucket = index % 10;
  const geo = bucket < 6
    ? (index % 2 === 0 ? res.rockGeo : res.clodGeo)
    : bucket < 9 ? (index % 2 === 0 ? res.leafClusterGeo : res.splinterGeo) : res.sparkGeo;
  const mat = bucket < 6
    ? (index % 2 === 0 ? res.rockMat : res.soilClodMat)
    : bucket < 9 ? (index % 2 === 0 ? res.foliageChunkMat : res.trunkMat) : res.sparkMat;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.scale.setScalar(0.001);
  return mesh;
}
