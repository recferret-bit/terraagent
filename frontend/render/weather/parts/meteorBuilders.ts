import * as THREE from 'three';
import { tileXZ } from '../../planets/hex';
import { makeBoulderGeo } from '../../visuals/terrain/Scatter';
import {
  buildDrapedReticleRing,
  createBlastCarpetMaterial,
  createEclipseShadowMaterial,
  createFireballPlumeMaterial,
  createMeteoriteCoreMaterial,
} from '../meteorCraterShaders';

export const DEBRIS_COUNT = 74;
export const WAKE_CHUNK_COUNT = 20;

export interface MeteorDebrisParticle {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rotVel: THREE.Vector3;
  baseScale: number;
  bounces: number;
  buoyant: boolean;
}

export interface MeteorStrikePalette {
  shadowMat: THREE.ShaderMaterial;
  basaltMat: THREE.MeshStandardMaterial;
  slateMat: THREE.MeshStandardMaterial;
  ashCinderMat: THREE.MeshStandardMaterial;
  magmaMat: THREE.MeshStandardMaterial;
  emberMat: THREE.MeshStandardMaterial;
  reticleMat: THREE.MeshStandardMaterial;
  meteorVeinMat: THREE.ShaderMaterial;
  meteorComaMat: THREE.ShaderMaterial;
  blastCarpetMat: THREE.ShaderMaterial;
  fireballDomeMat: THREE.ShaderMaterial;
}

export interface ActiveMeteorStrike {
  root: THREE.Group;
  target: THREE.Vector3;
  shadowWorldPos: THREE.Vector3;
  q?: number;
  r?: number;
  age: number;
  impacted: boolean;
  lastShadowRadius: number;
  heightAt?: (x: number, z: number) => number;
  shadowDisk: THREE.Mesh;
  shadowMat: THREE.ShaderMaterial;
  reticleGroup: THREE.Group;
  reticleMat: THREE.MeshStandardMaterial;
  meteorGroup: THREE.Group;
  meteorVeinMat: THREE.ShaderMaterial;
  meteorComaMat: THREE.ShaderMaterial;
  wakeChunks: THREE.Mesh[];
  blastCarpet: THREE.Mesh;
  blastCarpetMat: THREE.ShaderMaterial;
  fireballDome: THREE.Mesh;
  fireballDomeMat: THREE.ShaderMaterial;
  debris: MeteorDebrisParticle[];
}

export function createMeteorPalette(mats: THREE.Material[]): MeteorStrikePalette {
  const shadowMat = createEclipseShadowMaterial();
  const basaltMat = new THREE.MeshStandardMaterial({ vertexColors: true, color: 0x35312e, roughness: 0.84, metalness: 0.18, flatShading: true });
  const slateMat = new THREE.MeshStandardMaterial({ color: 0x5c626e, roughness: 0.72, metalness: 0.24, flatShading: true });
  const ashCinderMat = new THREE.MeshStandardMaterial({ color: 0x241e1c, emissive: 0xaa2804, emissiveIntensity: 1.4, roughness: 0.9 });
  const magmaMat = new THREE.MeshStandardMaterial({ color: 0xff6218, emissive: 0xff4500, emissiveIntensity: 4.5, roughness: 0.35, toneMapped: false });
  const emberMat = new THREE.MeshStandardMaterial({ color: 0xffaa2b, emissive: 0xff7711, emissiveIntensity: 3.8, roughness: 0.3, toneMapped: false });
  const reticleMat = new THREE.MeshStandardMaterial({ color: 0xff8a22, emissive: 0xff6a13, emissiveIntensity: 3.6, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false });
  const meteorVeinMat = createMeteoriteCoreMaterial();
  const meteorComaMat = createFireballPlumeMaterial();
  const blastCarpetMat = createBlastCarpetMaterial();
  const fireballDomeMat = createFireballPlumeMaterial();
  const reflectMats = [basaltMat, slateMat, ashCinderMat, magmaMat, emberMat, meteorVeinMat, meteorComaMat, blastCarpetMat, fireballDomeMat];
  for (const m of reflectMats) m.userData.waterReflect = true;
  mats.push(shadowMat, reticleMat, ...reflectMats);
  return { shadowMat, basaltMat, slateMat, ashCinderMat, magmaMat, emberMat, reticleMat, meteorVeinMat, meteorComaMat, blastCarpetMat, fireballDomeMat };
}

export function buildMeteorBodyGroup(
  pal: MeteorStrikePalette,
  geos: THREE.BufferGeometry[],
): { meteorGroup: THREE.Group; wakeChunks: THREE.Mesh[] } {
  const meteorGroup = new THREE.Group();
  meteorGroup.name = 'meteor-projectile';

  const coreGeo = makeBoulderGeo(77, new THREE.Color(0x2d2624)).scale(2.25, 1.95, 2.1);
  const veinGeo = new THREE.IcosahedronGeometry(2.34, 2);
  const comaGeo = new THREE.IcosahedronGeometry(2.68, 2);
  const lobeGeo = new THREE.DodecahedronGeometry(1.15, 0);
  const wakeGeo = new THREE.OctahedronGeometry(0.48, 0);
  geos.push(coreGeo, veinGeo, comaGeo, lobeGeo, wakeGeo);

  const coreMesh = new THREE.Mesh(coreGeo, pal.basaltMat);
  const veinMesh = new THREE.Mesh(veinGeo, pal.meteorVeinMat);
  const comaMesh = new THREE.Mesh(comaGeo, pal.meteorComaMat);
  comaMesh.scale.set(1.08, 1.24, 1.08);
  coreMesh.userData.waterReflect = true;
  veinMesh.userData.waterReflect = true;
  comaMesh.userData.waterReflect = true;
  meteorGroup.add(coreMesh, veinMesh, comaMesh);

  const offsets: [number, number, number][] = [
    [1.3, 0.4, 0.5], [-1.2, -0.3, 0.8], [0.3, -0.9, -1.2], [-0.7, 0.9, -0.9],
  ];
  for (let i = 0; i < offsets.length; i++) {
    const lobe = new THREE.Mesh(lobeGeo, i % 2 === 0 ? pal.meteorVeinMat : pal.magmaMat);
    lobe.position.set(...offsets[i]!);
    lobe.rotation.set(i * 1.1, i * 0.7, i * 1.5);
    lobe.userData.waterReflect = true;
    meteorGroup.add(lobe);
  }

  const wakeChunks: THREE.Mesh[] = [];
  for (let i = 0; i < WAKE_CHUNK_COUNT; i++) {
    const mat = i % 4 === 0 ? pal.magmaMat : i % 3 === 0 ? pal.ashCinderMat : pal.emberMat;
    const chunk = new THREE.Mesh(wakeGeo, mat);
    chunk.userData.waterReflect = true;
    meteorGroup.add(chunk);
    wakeChunks.push(chunk);
  }
  return { meteorGroup, wakeChunks };
}

export function buildReticleGroup(
  target: THREE.Vector3,
  tiles: ReadonlyArray<{ q: number; r: number }> | undefined,
  heightAt: ((x: number, z: number) => number) | undefined,
  pal: MeteorStrikePalette,
  geos: THREE.BufferGeometry[],
): THREE.Group {
  const reticleGroup = new THREE.Group();
  reticleGroup.name = 'meteor-target-reticle';
  const outerRingGeo = buildDrapedReticleRing(6.5, 0.12, 36, target, heightAt);
  const innerRingGeo = buildDrapedReticleRing(3.2, 0.09, 24, target, heightAt);
  const hexRingGeo = new THREE.TorusGeometry(0.95, 0.06, 5, 6).rotateX(Math.PI / 2);
  geos.push(outerRingGeo, innerRingGeo, hexRingGeo);

  reticleGroup.add(new THREE.Mesh(outerRingGeo, pal.reticleMat), new THREE.Mesh(innerRingGeo, pal.reticleMat));
  for (const t of tiles ?? []) {
    const [tx, tz] = tileXZ(t.q, t.r);
    const ty = heightAt ? heightAt(tx, tz) - target.y : 0;
    const m = new THREE.Mesh(hexRingGeo, pal.reticleMat);
    m.position.set(tx - target.x, ty + 0.16, tz - target.z);
    reticleGroup.add(m);
  }
  return reticleGroup;
}

export function buildDebrisParticles(
  debrisGroup: THREE.Group,
  pal: MeteorStrikePalette,
  geos: THREE.BufferGeometry[],
): MeteorDebrisParticle[] {
  const primaryBoulderGeo = makeBoulderGeo(911, new THREE.Color(0x332b28)).scale(0.42, 0.36, 0.4);
  const secondaryShardGeo = new THREE.OctahedronGeometry(0.36, 0);
  const accentMagmaGeo = new THREE.IcosahedronGeometry(0.3, 0);
  const cinderSmokeGeo = new THREE.DodecahedronGeometry(0.44, 0);
  geos.push(primaryBoulderGeo, secondaryShardGeo, accentMagmaGeo, cinderSmokeGeo);

  const particles: MeteorDebrisParticle[] = [];
  for (let i = 0; i < DEBRIS_COUNT; i++) {
    const buoyant = i >= DEBRIS_COUNT - 16;
    const isAccent = !buoyant && i % 6 === 0;
    const isSecondary = !buoyant && !isAccent && i % 3 === 1;
    const geo = buoyant ? cinderSmokeGeo : isAccent ? accentMagmaGeo : isSecondary ? secondaryShardGeo : primaryBoulderGeo;
    const mat = buoyant
      ? (i % 2 === 0 ? pal.ashCinderMat : pal.emberMat)
      : isAccent ? pal.magmaMat : isSecondary ? pal.slateMat : pal.basaltMat;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.waterReflect = true;
    mesh.visible = false;
    debrisGroup.add(mesh);

    const ang = (i / DEBRIS_COUNT) * Math.PI * 2 + (i % 5) * 0.19;
    const speed = buoyant ? 1.8 + (i % 5) * 0.9 : 5.2 + (i % 8) * 1.65;
    const vy = buoyant ? 4.5 + (i % 4) * 1.4 : 8.5 + (i % 7) * 2.05;
    const r0 = 0.65 + (i % 5) * 0.45;
    particles.push({
      mesh,
      pos: new THREE.Vector3(Math.cos(ang) * r0, 0.35, Math.sin(ang) * r0),
      vel: new THREE.Vector3(Math.cos(ang) * speed, vy, Math.sin(ang) * speed),
      rotVel: new THREE.Vector3(3 + (i % 5), 4 + (i % 7), 2 + (i % 4)),
      baseScale: buoyant ? 0.95 + (i % 3) * 0.35 : 0.72 + (i % 4) * 0.28,
      bounces: 0,
      buoyant,
    });
  }
  return particles;
}
