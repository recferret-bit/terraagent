import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getInsectAnimator } from '../animation/insects/InsectAnimationController';
import { insectPartMatrix, type InsectPose } from '../animation/insects/pose';
import { classifyInsectPart } from '../animation/insects/rig';
import { createUnifiedColonyMaterial } from '../visuals/UnifiedColonyMaterial';

interface CorpseEntry {
  mesh: THREE.Mesh;
}

interface PartRange {
  name: string;
  start: number;
  count: number;
  animType?: number;
  pivot?: THREE.Vector3Tuple;
}

const DEFAULT_MAX_CORPSES = 72;

function clusterKeyForPart(name: string, index: number): string | null {
  const lower = name.toLowerCase();
  const leg = lower.match(/\b(front|mid|rear)\s+(left|right)\s+(femur|hinge|tibia|tarsal)/i);
  if (leg) {
    // Keep outer leg chain intact (hinge/tibia/tarsal rip off together; leave hip/femur stub attached).
    if (leg[3]!.toLowerCase() === 'femur') return null;
    return `limb:${leg[1]!.toLowerCase()}_${leg[2]!.toLowerCase()}`;
  }
  if (lower.includes('mandible') || lower.includes('horn') || lower.includes('antenna')) {
    return `headchunk:${index}`;
  }
  if (lower.includes('acid sac') || lower.includes('sac')) {
    return `sac:${index}`;
  }
  return null;
}

function pickSeveredPartMap(partRanges: readonly PartRange[], seed: number): Map<number, string> {
  const clusters = new Map<string, number[]>();
  for (let pi = 0; pi < partRanges.length; pi++) {
    const key = clusterKeyForPart(partRanges[pi]!.name, pi);
    if (!key) continue;
    const list = clusters.get(key) ?? [];
    list.push(pi);
    clusters.set(key, list);
  }
  const ordered = [...clusters.entries()].sort((a, b) => {
    const ha = Math.sin(seed * 73.1 + a[0].length * 13.7 + a[1][0]! * 19.3);
    const hb = Math.sin(seed * 73.1 + b[0].length * 13.7 + b[1][0]! * 19.3);
    return hb - ha;
  });
  const targetClusters = ordered.length === 0 ? 0 : Math.min(ordered.length, 2 + (Math.abs(Math.round(seed * 17)) % 3));
  const out = new Map<number, string>();
  for (let i = 0; i < targetClusters; i++) {
    const [key, indices] = ordered[i]!;
    for (const pi of indices) out.set(pi, key);
  }
  return out;
}

function buildBloodPuddleGeometry(
  seed: number,
  bodyCenterX: number,
  bodyCenterZ: number,
  splatSpots: readonly THREE.Vector2[],
  template: THREE.BufferGeometry,
  groundOffsetAt?: (localX: number, localZ: number) => number,
): THREE.BufferGeometry | null {
  const tmplColor = template.getAttribute('color');
  const cSize = tmplColor?.itemSize ?? 3;
  const cNorm = tmplColor?.normalized ?? false;
  const cIsUint8 = tmplColor?.array instanceof Uint8Array;
  const drops: THREE.BufferGeometry[] = [];
  const addDroplet = (cx: number, cz: number, rx: number, rz: number, yaw: number, bright: number) => {
    // Tiny 3D hemolymph droplet bead (~2 cm, never a flat cylinder disk)
    const g = new THREE.OctahedronGeometry(1, 0);
    const nonIdx = g.index ? g.toNonIndexed() : g;
    nonIdx.scale(rx, 0.006, rz);
    nonIdx.rotateY(yaw);
    const dy = groundOffsetAt ? groundOffsetAt(cx, cz) : 0;
    nonIdx.translate(cx, 0.009 + dy, cz);
    const count = nonIdx.getAttribute('position').count;
    const scale = cIsUint8 ? 255 : 1;
    const colors = cIsUint8 ? new Uint8Array(count * cSize) : new Float32Array(count * cSize);
    for (let i = 0; i < count; i++) {
      colors[i * cSize] = (0.14 + bright * 0.14) * scale;
      colors[i * cSize + 1] = (0.58 + bright * 0.16) * scale;
      colors[i * cSize + 2] = (0.08 + bright * 0.08) * scale;
      if (cSize >= 4) colors[i * cSize + 3] = scale;
    }
    nonIdx.setAttribute('color', new THREE.BufferAttribute(colors, cSize, cNorm));
    drops.push(nonIdx);
  };

  for (let i = 0; i < 4; i++) {
    const ang = seed * 11.7 + i * 1.57;
    const r = 0.04 + 0.06 * Math.abs(Math.sin(seed * 41 + i * 3.1));
    addDroplet(
      bodyCenterX + Math.cos(ang) * r,
      bodyCenterZ + Math.sin(ang) * r,
      0.022 + 0.008 * Math.abs(Math.sin(seed * 53 + i)),
      0.018 + 0.007 * Math.abs(Math.cos(seed * 37 + i)),
      ang,
      0.35 + 0.35 * (i / 3),
    );
  }
  for (let i = 0; i < Math.min(2, splatSpots.length); i++) {
    const sp = splatSpots[i]!;
    addDroplet(sp.x, sp.y, 0.02, 0.016, seed * 7 + i * 1.4, 0.55);
  }

  const merged = mergeGeometries(drops, false);
  for (const d of drops) d.dispose();
  if (!merged) return null;

  const vCount = merged.getAttribute('position').count;
  for (const name of Object.keys(template.attributes)) {
    if (merged.getAttribute(name)) continue;
    const tmplAttr = template.getAttribute(name)!;
    const itemSize = tmplAttr.itemSize;
    const ArrCtor = tmplAttr.array.constructor as new (len: number) => THREE.TypedArray;
    const data = new ArrCtor(vCount * itemSize);
    if (name === 'aMaterialZone') data.fill(1);
    merged.setAttribute(name, new THREE.BufferAttribute(data, itemSize, tmplAttr.normalized));
  }
  return merged;
}

function scatterSeveredClusters(
  clusterSpans: Map<string, Array<{ start: number; end: number }>>,
  posAttr: THREE.BufferAttribute,
  normAttr: THREE.BufferAttribute | undefined,
  seed: number,
  groundOffsetAt?: (localX: number, localZ: number) => number,
): THREE.Vector2[] {
  const pos = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const splatSpots: THREE.Vector2[] = [];
  let clusterIdx = 0;
  for (const [, spans] of clusterSpans) {
    clusterIdx++;
    const center = new THREE.Vector3();
    let count = 0;
    for (const s of spans) {
      for (let i = s.start; i < s.end; i++) {
        center.x += posAttr.getX(i);
        center.y += posAttr.getY(i);
        center.z += posAttr.getZ(i);
        count++;
      }
    }
    if (count === 0) continue;
    center.divideScalar(count);
    const ang = seed * 29.3 + clusterIdx * 2.09 + Math.sin(seed * 13 + clusterIdx) * 0.6;
    const dist = 0.44 + 0.56 * Math.abs(Math.cos(seed * 57.3 + clusterIdx * 4.1));
    const tumble = new THREE.Matrix4().makeRotationFromEuler(
      new THREE.Euler(1.15 + Math.sin(seed * 19 + clusterIdx) * 0.45, ang, Math.cos(seed * 23 + clusterIdx) * 0.8),
    );
    const rotNormal = new THREE.Matrix3().getNormalMatrix(tumble);
    let minY = Infinity;
    const shiftX = Math.cos(ang) * dist;
    const shiftZ = Math.sin(ang) * dist;
    for (const s of spans) {
      for (let i = s.start; i < s.end; i++) {
        pos.fromBufferAttribute(posAttr, i).sub(center).applyMatrix4(tumble).add(center);
        pos.x += shiftX;
        pos.z += shiftZ;
        if (pos.y < minY) minY = pos.y;
        posAttr.setXYZ(i, pos.x, pos.y, pos.z);
        if (normAttr) {
          nrm.fromBufferAttribute(normAttr, i).applyMatrix3(rotNormal).normalize();
          normAttr.setXYZ(i, nrm.x, nrm.y, nrm.z);
        }
      }
    }
    const landX = center.x + shiftX;
    const landZ = center.z + shiftZ;
    const terrainOffset = groundOffsetAt ? groundOffsetAt(landX, landZ) : 0;
    const drop = Number.isFinite(minY) ? -minY + 0.002 + terrainOffset : terrainOffset;
    for (const s of spans) {
      for (let i = s.start; i < s.end; i++) posAttr.setY(i, posAttr.getY(i) + drop);
    }
    splatSpots.push(new THREE.Vector2(landX, landZ));
  }
  return splatSpots;
}

function bakeCorpseGeometry(
  srcGeo: THREE.BufferGeometry,
  finalPose: InsectPose,
  partRanges: readonly PartRange[],
  groundOffsetAt?: (localX: number, localZ: number) => number,
): THREE.BufferGeometry {
  const baseClone = srcGeo.index ? srcGeo.toNonIndexed() : srcGeo.clone();
  const posAttr = baseClone.getAttribute('position') as THREE.BufferAttribute;
  const normAttr = baseClone.getAttribute('normal') as THREE.BufferAttribute | undefined;
  const animAttr = baseClone.getAttribute('aPartAnim') as THREE.BufferAttribute | undefined;
  const pos = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const normalMat = new THREE.Matrix3();
  const vCount = posAttr.count;
  let bodyMinY = Infinity;
  let bodySumX = 0;
  let bodySumZ = 0;
  let bodyCount = 0;
  const bodyVertexMask = new Uint8Array(vCount);
  const clusterSpans = new Map<string, Array<{ start: number; end: number }>>();

  const seed = finalPose.deathSeed ?? 0.37;
  const severedMap = pickSeveredPartMap(partRanges, seed);

  for (let pi = 0; pi < partRanges.length; pi++) {
    const range = partRanges[pi]!;
    const start = Math.max(0, Math.min(vCount, range.start));
    const end = Math.min(vCount, start + range.count);
    const animType = typeof range.animType === 'number'
      ? range.animType
      : (animAttr && start < animAttr.count ? Math.round(animAttr.getX(start)) : 0);
    const pivot: THREE.Vector3Tuple = range.pivot
      ?? (animAttr && start < animAttr.count
        ? [animAttr.getY(start), animAttr.getZ(start), animAttr.getW(start)]
        : [0, 0, 0]);
    const rig = classifyInsectPart(range.name, animType, pivot);
    const mat = insectPartMatrix(rig, finalPose).clone();
    const clusterKey = severedMap.get(pi);
    normalMat.getNormalMatrix(mat);
    for (let i = start; i < end; i++) {
      pos.fromBufferAttribute(posAttr, i).applyMatrix4(mat);
      if (!clusterKey) {
        bodyVertexMask[i] = 1;
        bodySumX += pos.x;
        bodySumZ += pos.z;
        bodyCount++;
        if (pos.y < bodyMinY) bodyMinY = pos.y;
      }
      posAttr.setXYZ(i, pos.x, pos.y, pos.z);
      if (normAttr) {
        nrm.fromBufferAttribute(normAttr, i).applyMatrix3(normalMat).normalize();
        normAttr.setXYZ(i, nrm.x, nrm.y, nrm.z);
      }
    }
    if (clusterKey) {
      const list = clusterSpans.get(clusterKey) ?? [];
      list.push({ start, end });
      clusterSpans.set(clusterKey, list);
    }
  }

  if (Number.isFinite(bodyMinY) && bodyMinY < 0.002) {
    const lift = -bodyMinY + 0.002;
    for (let i = 0; i < vCount; i++) if (bodyVertexMask[i]) posAttr.setY(i, posAttr.getY(i) + lift);
  }

  const splatSpots = scatterSeveredClusters(clusterSpans, posAttr, normAttr, seed, groundOffsetAt);

  if (animAttr) {
    (animAttr.array as Float32Array).fill(0);
    animAttr.needsUpdate = true;
  }
  posAttr.needsUpdate = true;
  if (normAttr) normAttr.needsUpdate = true;

  const cx = bodyCount > 0 ? bodySumX / bodyCount : 0;
  const cz = bodyCount > 0 ? bodySumZ / bodyCount : 0;
  const blood = buildBloodPuddleGeometry(seed, cx, cz, splatSpots, baseClone, groundOffsetAt);
  let finalGeo = baseClone;
  if (blood) {
    const combined = mergeGeometries([baseClone, blood], false);
    blood.dispose();
    if (combined) {
      baseClone.dispose();
      finalGeo = combined;
    }
  }
  finalGeo.computeBoundingBox();
  finalGeo.computeBoundingSphere();
  return finalGeo;
}

/**
 * Preserves collapsed, uniquely posed insect carcasses, ripped limbs, and persistent
 * green hemolymph blood pools on the ground without holding pooled live insect slots.
 */
export class InsectCorpseLayer {
  readonly group = new THREE.Group();
  private readonly entries: CorpseEntry[] = [];
  private materialBundle: ReturnType<typeof createUnifiedColonyMaterial> | null = null;
  private biome: string;

  constructor(
    parent?: THREE.Object3D,
    biome = 'desert',
    private readonly maxCorpses = DEFAULT_MAX_CORPSES,
  ) {
    this.biome = biome;
    this.group.name = 'insect-corpses';
    parent?.add(this.group);
  }

  private getMaterialBundle(): ReturnType<typeof createUnifiedColonyMaterial> {
    if (!this.materialBundle) {
      this.materialBundle = createUnifiedColonyMaterial({ biome: this.biome });
      this.materialBundle.uniforms.uWalkWeight.value = 0;
      this.materialBundle.uniforms.uWorkWeight.value = 0;
    }
    return this.materialBundle;
  }

  setBiome(biome: string): void {
    if (biome === this.biome) return;
    this.biome = biome;
    if (this.materialBundle) {
      const next = createUnifiedColonyMaterial({ biome });
      next.uniforms.uWalkWeight.value = 0;
      next.uniforms.uWorkWeight.value = 0;
      for (const entry of this.entries) {
        entry.mesh.material = next.material;
        entry.mesh.customDepthMaterial = next.depthMaterial;
      }
      this.materialBundle.material.dispose();
      this.materialBundle = next;
    }
  }

  preserve(
    sourceMesh: THREE.Object3D,
    groundY?: number,
    groundOffsetAt?: (localX: number, localZ: number) => number,
  ): boolean {
    const animator = getInsectAnimator(sourceMesh);
    const srcGeo = (sourceMesh as THREE.Mesh).geometry;
    const partRanges = srcGeo?.userData?.partRanges as PartRange[] | undefined;
    if (!animator || !srcGeo || !partRanges || partRanges.length === 0) return false;
    if (animator.state !== 'dying' && animator.state !== 'dead') return false;

    const finalPose: InsectPose = {
      ...animator.pose,
      walk: 0,
      charge: 0,
      strike: 0,
      hurt: 0,
      death: 1,
    };
    const baked = bakeCorpseGeometry(srcGeo, finalPose, partRanges, groundOffsetAt);
    const bundle = this.getMaterialBundle();

    const corpse = new THREE.Mesh(baked, bundle.material);
    corpse.customDepthMaterial = bundle.depthMaterial;
    corpse.name = `corpse:${(sourceMesh.userData as { archetypeId?: string } | undefined)?.archetypeId ?? 'insect'}`;
    corpse.position.copy(sourceMesh.position);
    if (groundY !== undefined) corpse.position.y = groundY;
    // Severed parts & droplets are baked in local ground offsets relative to yaw; avoid double-tilting on slopes.
    if (groundOffsetAt) corpse.rotation.set(0, sourceMesh.rotation.y, 0);
    else corpse.rotation.copy(sourceMesh.rotation);
    corpse.scale.copy(sourceMesh.scale);
    corpse.castShadow = true;
    corpse.receiveShadow = true;

    this.group.add(corpse);
    this.entries.push({ mesh: corpse });
    while (this.entries.length > this.maxCorpses) {
      const oldest = this.entries.shift()!;
      this.group.remove(oldest.mesh);
      oldest.mesh.geometry.dispose();
    }
    return true;
  }

  get count(): number {
    return this.entries.length;
  }

  clear(): void {
    for (const entry of this.entries) {
      this.group.remove(entry.mesh);
      entry.mesh.geometry.dispose();
    }
    this.entries.length = 0;
  }

  dispose(): void {
    this.clear();
    if (this.materialBundle) {
      this.materialBundle.material.dispose();
      this.materialBundle = null;
    }
    this.group.removeFromParent();
  }
}
