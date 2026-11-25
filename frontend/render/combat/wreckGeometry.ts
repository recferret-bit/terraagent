import * as THREE from 'three';
import { SCAFFOLD_CUT_FRACTIONS } from '../visuals/unified/buildScaffold';
import { partitionConnectedWreckShatter, type WreckPartRange } from './wreckClusters';

export type { WreckPartRange };

export interface BakeWreckOptions {
  seed?: number;
  kind?: 'bot' | 'building';
  buildStage?: number;
  weaponMatrices?: readonly THREE.Matrix4[] | null;
  spinTime?: number;
  tintColor?: THREE.ColorRepresentation | null;
  groundOffsetAt?: (localX: number, localZ: number) => number;
}

function makeRng(seed: number): () => number {
  let s = (Math.floor(seed * 9973) ^ 0x6d2b79f5) >>> 0;
  if (s === 0) s = 0x9e3779b9;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function rotateYPoint(x: number, y: number, z: number, px: number, py: number, pz: number, ang: number): [number, number, number] {
  const s = Math.sin(ang), c = Math.cos(ang);
  const rx = x - px, rz = z - pz;
  return [px + rx * c - rz * s, y, pz + rx * s + rz * c];
}

function bakeRigPose(
  geo: THREE.BufferGeometry,
  weaponMatrices: readonly THREE.Matrix4[] | null | undefined,
  spinTime: number,
): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!pos || pos.count === 0) return;
  const animAttr = geo.getAttribute('aPartAnim') as THREE.BufferAttribute | undefined;
  const wpnAttr = geo.getAttribute('aWeaponPart') as THREE.BufferAttribute | undefined;
  const hasWeapon = Boolean(weaponMatrices && weaponMatrices.length > 0 && wpnAttr);
  if (hasWeapon || spinTime > 0) {
    const v = new THREE.Vector3();
    const head = weaponMatrices?.[0];
    const left = weaponMatrices?.[1] ?? head;
    const right = weaponMatrices?.[2] ?? left;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const wp = wpnAttr ? wpnAttr.getX(i) : 0;
      const animRaw = animAttr ? Math.round(animAttr.getX(i)) : 0;
      const subAnim = Math.floor(animRaw / 10);
      const animType = animRaw - subAnim * 10;
      const isSpin = animType === 1 || (animType > 7 && subAnim === 1);

      if (hasWeapon && wp > 0.5) {
        if (wp < 1.5) {
          if (isSpin && animAttr && spinTime > 0) {
            const ang = spinTime * (animType > 7 ? 5.0 : 2.5);
            const [sx, sy, sz] = rotateYPoint(v.x, v.y, v.z, animAttr.getY(i), animAttr.getZ(i), animAttr.getW(i), ang);
            v.set(sx, sy, sz);
          }
          if (head) v.applyMatrix4(head);
        } else {
          const mat = wp < 2.5 ? left : right;
          if (mat) v.applyMatrix4(mat);
        }
      } else if (isSpin && animAttr && spinTime > 0) {
        const ang = spinTime * (animType > 7 ? 5.0 : 2.5);
        const [sx, sy, sz] = rotateYPoint(v.x, v.y, v.z, animAttr.getY(i), animAttr.getZ(i), animAttr.getW(i), ang);
        v.set(sx, sy, sz);
      }
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    pos.needsUpdate = true;
  }

  if (animAttr) {
    (animAttr.array as Float32Array).fill(0);
    animAttr.needsUpdate = true;
  }
  if (wpnAttr) {
    (wpnAttr.array as Float32Array).fill(0);
    wpnAttr.needsUpdate = true;
  }
}

function resolveValidRanges(srcGeo: THREE.BufferGeometry, nonIndexedCount: number): WreckPartRange[] {
  const raw = srcGeo.userData?.partRanges as WreckPartRange[] | undefined;
  if (!srcGeo.index && Array.isArray(raw) && raw.length > 0) {
    const valid = raw.filter((r) => r.count > 0 && r.start >= 0 && r.start + r.count <= nonIndexedCount);
    if (valid.length > 0) return valid;
  }
  const triCount = Math.floor(nonIndexedCount / 3);
  const chunkTris = Math.max(1, Math.ceil(triCount / 8));
  const out: WreckPartRange[] = [];
  for (let t = 0; t < triCount; t += chunkTris) {
    const count = Math.min(chunkTris, triCount - t) * 3;
    out.push({ name: `chunk_${out.length}`, start: t * 3, count });
  }
  return out;
}

function stripUnbuiltRanges(geo: THREE.BufferGeometry, ranges: WreckPartRange[], buildStage: number): WreckPartRange[] {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  geo.computeBoundingBox();
  const maxY = Math.max(0.5, geo.boundingBox?.max.y ?? 1);
  const tier = buildStage < 0.16 ? 0 : buildStage < 0.50 ? 1 : 2;
  const cutY = maxY * (SCAFFOLD_CUT_FRACTIONS[tier] ?? 0.6);

  const kept: WreckPartRange[] = [];
  let lowest: { r: WreckPartRange; minY: number } | null = null;
  for (const r of ranges) {
    let minY = Infinity;
    for (let i = r.start; i < r.start + r.count; i++) minY = Math.min(minY, pos.getY(i));
    if (!lowest || minY < lowest.minY) lowest = { r, minY };
    if (minY <= cutY + 0.05) kept.push(r);
  }
  if (kept.length === 0 && lowest) kept.push(lowest.r);
  if (kept.length === ranges.length) return ranges;

  const totalVerts = kept.reduce((acc, r) => acc + r.count, 0);
  for (const key of Object.keys(geo.attributes)) {
    const attr = geo.getAttribute(key) as THREE.BufferAttribute;
    const itemSize = attr.itemSize;
    const srcArr = attr.array as Float32Array;
    const Ctor = srcArr.constructor as new (len: number) => Float32Array;
    const dstArr = new Ctor(totalVerts * itemSize);
    let offset = 0;
    for (const r of kept) {
      dstArr.set(srcArr.subarray(r.start * itemSize, (r.start + r.count) * itemSize), offset * itemSize);
      offset += r.count;
    }
    geo.setAttribute(key, new THREE.BufferAttribute(dstArr, itemSize, attr.normalized));
  }
  let cursor = 0;
  return kept.map((r) => {
    const updated = { ...r, start: cursor };
    cursor += r.count;
    return updated;
  });
}

function deformVerticesWelded(
  pos: THREE.BufferAttribute,
  indices: readonly number[],
  blastCenter: THREE.Vector3,
  radius: number,
  dentStrength: number,
  crushStrength: number,
  seed: number,
  twistScale = 1,
): void {
  const warpCache = new Map<string, [number, number, number]>();
  const rSafe = Math.max(0.4, radius);
  for (const vi of indices) {
    const x = pos.getX(vi), y = pos.getY(vi), z = pos.getZ(vi);
    const key = `${Math.round(x * 1000)}_${Math.round(y * 1000)}_${Math.round(z * 1000)}`;
    let warped = warpCache.get(key);
    if (!warped) {
      const dx = x - blastCenter.x, dy = y - blastCenter.y, dz = z - blastCenter.z;
      const dist = Math.hypot(dx, dy, dz);
      const invDist = dist > 1e-4 ? 1 / dist : 0;
      const falloff = Math.exp(-(dist * dist) / (rSafe * rSafe * 0.65));
      const heightW = THREE.MathUtils.smoothstep(y, 0.04, Math.max(0.28, rSafe * 0.45));
      const push = dentStrength * falloff * heightW;
      const jitter = Math.sin(x * 1.9 + z * 1.7 + seed) * 0.007 + Math.cos(y * 1.3 - z * 1.4 + seed * 1.7) * 0.005;
      const twist = (y * 0.022 + 0.02 * falloff) * twistScale * (Math.sin(seed * 3.1) >= 0 ? 1 : -1);
      const nx = x - dx * invDist * push - z * twist * 0.35 * heightW + jitter * heightW * 0.6;
      const ny = Math.max(0.0, y - dy * invDist * push * 0.55 - crushStrength * heightW * (0.5 + 0.5 * falloff) + jitter * heightW * 0.35);
      const nz = z - dz * invDist * push + x * twist * 0.35 * heightW + jitter * heightW * 0.6;
      warped = [nx, ny, nz];
      warpCache.set(key, warped);
    }
    pos.setXYZ(vi, warped[0], warped[1], warped[2]);
  }
}

function sampleTerrainSlopeQuat(
  groundOffsetAt: (lx: number, lz: number) => number,
  cx: number,
  cz: number,
  rx: number,
  rz: number,
  maxTiltRad: number,
): THREE.Quaternion {
  const sx = Math.max(0.35, rx);
  const sz = Math.max(0.35, rz);
  const gx = (groundOffsetAt(cx + sx, cz) - groundOffsetAt(cx - sx, cz)) / (2 * sx);
  const gz = (groundOffsetAt(cx, cz + sz) - groundOffsetAt(cx, cz - sz)) / (2 * sz);
  const pitch = THREE.MathUtils.clamp(-Math.atan(gz), -maxTiltRad, maxTiltRad);
  const roll = THREE.MathUtils.clamp(Math.atan(gx), -maxTiltRad, maxTiltRad);
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, 0, roll, 'XYZ'));
}

function seatAssemblyOnSlope(
  pos: THREE.BufferAttribute,
  indices: readonly number[],
  cx: number,
  cz: number,
  minYBeforeSlope: number,
  isBuilding: boolean,
  groundOffsetAt: (lx: number, lz: number) => number,
): void {
  let bMinX = Infinity, bMaxX = -Infinity, bMinZ = Infinity, bMaxZ = -Infinity;
  const baseVerts: number[] = [];
  const baseCutY = minYBeforeSlope + (isBuilding ? 0.24 : 0.16);
  for (const vi of indices) {
    const x = pos.getX(vi), y = pos.getY(vi), z = pos.getZ(vi);
    if (x < bMinX) bMinX = x; if (x > bMaxX) bMaxX = x;
    if (z < bMinZ) bMinZ = z; if (z > bMaxZ) bMaxZ = z;
    if (y <= baseCutY) baseVerts.push(vi);
  }
  const qSlope = sampleTerrainSlopeQuat(groundOffsetAt, cx, cz, (bMaxX - bMinX) * 0.42, (bMaxZ - bMinZ) * 0.42, 0.42);
  const v = new THREE.Vector3();
  for (const vi of indices) {
    v.set(pos.getX(vi) - cx, pos.getY(vi) - minYBeforeSlope, pos.getZ(vi) - cz).applyQuaternion(qSlope);
    pos.setXYZ(vi, v.x + cx, v.y, v.z + cz);
  }
  const hCenter = groundOffsetAt(cx, cz);
  const probe = baseVerts.length > 0 ? baseVerts : indices;
  const step = Math.max(1, Math.floor(probe.length / 72));
  let maxOverhang = 0;
  for (let k = 0; k < probe.length; k += step) {
    const vi = probe[k]!;
    const gap = (pos.getY(vi) + hCenter) - groundOffsetAt(pos.getX(vi), pos.getZ(vi));
    if (gap > maxOverhang) maxOverhang = gap;
  }
  const maxSink = isBuilding ? 1.35 : 0.52;
  const sink = maxOverhang > 0.02 ? Math.min(maxSink, (maxOverhang - 0.01) * 0.94) : 0;
  const dy = hCenter - sink;
  for (const vi of indices) pos.setY(vi, pos.getY(vi) + dy);
}

function collapseCoreAssembly(
  pos: THREE.BufferAttribute,
  indices: readonly number[],
  blastCenter: THREE.Vector3,
  radius: number,
  isBuilding: boolean,
  opts: BakeWreckOptions,
  rand: () => number,
): void {
  if (indices.length === 0) return;
  deformVerticesWelded(pos, indices, blastCenter, radius, isBuilding ? 0.08 : 0.065, isBuilding ? 0.055 : 0.045, rand() * 50, 1);

  const dirX = -Math.sign(blastCenter.x || (rand() - 0.5));
  const dirZ = -Math.sign(blastCenter.z || (rand() - 0.5));
  const squashY = isBuilding ? 0.87 - rand() * 0.06 : 0.84 - rand() * 0.07;
  const shearX = dirX * (isBuilding ? 0.06 + rand() * 0.04 : 0.07 + rand() * 0.05);
  const shearZ = dirZ * (isBuilding ? 0.06 + rand() * 0.04 : 0.07 + rand() * 0.05);
  const tiltAmp = opts.groundOffsetAt ? 0.45 : 1;
  const tiltX = dirZ * (isBuilding ? 0.08 + rand() * 0.07 : 0.11 + rand() * 0.11) * tiltAmp;
  const tiltZ = dirX * (isBuilding ? 0.08 + rand() * 0.07 : 0.11 + rand() * 0.11) * tiltAmp;
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(tiltX, (rand() - 0.5) * 0.18, tiltZ));
  const v = new THREE.Vector3();
  let minY = Infinity, sumX = 0, sumZ = 0, preSumX = 0, preSumZ = 0;
  for (const vi of indices) {
    preSumX += pos.getX(vi);
    preSumZ += pos.getZ(vi);
  }
  const preCx = preSumX / indices.length, preCz = preSumZ / indices.length;
  for (const vi of indices) {
    v.fromBufferAttribute(pos, vi);
    v.x += v.y * shearX;
    v.z += v.y * shearZ;
    v.y *= squashY;
    v.applyQuaternion(q);
    pos.setXYZ(vi, v.x, v.y, v.z);
    if (v.y < minY) minY = v.y;
    sumX += v.x; sumZ += v.z;
  }
  // Keep collapsed core anchored over the exact pre-death hex center; only peripheral shards scatter outward.
  const cx = sumX / indices.length, cz = sumZ / indices.length;
  const shiftX = (preCx - cx) * 0.9;
  const shiftZ = (preCz - cz) * 0.9;
  for (const vi of indices) {
    pos.setX(vi, pos.getX(vi) + shiftX);
    pos.setZ(vi, pos.getZ(vi) + shiftZ);
  }
  if (opts.groundOffsetAt) {
    seatAssemblyOnSlope(pos, indices, preCx, preCz, minY, isBuilding, opts.groundOffsetAt);
    return;
  }
  const shiftY = -minY;
  for (const vi of indices) pos.setY(vi, Math.max(0, pos.getY(vi) + shiftY));
}

function scatterBrokenShards(
  pos: THREE.BufferAttribute,
  shards: readonly number[][],
  radius: number,
  isBuilding: boolean,
  opts: BakeWreckOptions,
  rand: () => number,
): void {
  const baseAng = rand() * Math.PI * 2;
  const golden = 2.39996;
  const v = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const euler = new THREE.Euler();
  shards.forEach((indices, idx) => {
    let minX = Infinity, minY0 = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY0 = -Infinity, maxZ = -Infinity;
    let sx = 0, sy = 0, sz = 0;
    for (const vi of indices) {
      const x = pos.getX(vi), y = pos.getY(vi), z = pos.getZ(vi);
      sx += x; sy += y; sz += z;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY0) minY0 = y; if (y > maxY0) maxY0 = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    const cx0 = sx / indices.length, cy0 = sy / indices.length, cz0 = sz / indices.length;
    const shardRadius = Math.max(0.45, Math.hypot(maxX - minX, maxY0 - minY0, maxZ - minZ) * 0.5);
    const localBlast = new THREE.Vector3(cx0 + (rand() - 0.5) * 0.2, cy0, cz0 + (rand() - 0.5) * 0.2);
    deformVerticesWelded(pos, indices, localBlast, shardRadius, 0.055, 0.02, idx * 17 + rand() * 10, 0);

    sx = 0; sy = 0; sz = 0;
    for (const vi of indices) { sx += pos.getX(vi); sy += pos.getY(vi); sz += pos.getZ(vi); }
    const cx = sx / indices.length, cy = sy / indices.length, cz = sz / indices.length;

    const ang = baseAng + idx * golden + (rand() - 0.5) * 0.45;
    const throwR = Math.max(isBuilding ? 1.15 : 0.65, radius * (isBuilding ? 0.65 + rand() * 0.45 : 0.72 + rand() * 0.52));
    const tx = cx * 0.45 + Math.cos(ang) * throwR;
    const tz = cz * 0.45 + Math.sin(ang) * throwR;
    const isTall = (maxY0 - minY0) > Math.max(maxX - minX, maxZ - minZ) * 1.45;
    const isWide = Math.max(maxX - minX, maxZ - minZ) > (maxY0 - minY0) * 2.2;
    const pitch = isTall ? (rand() < 0.5 ? 1 : -1) * (1.05 + rand() * 0.42) : isWide ? (rand() - 0.5) * 0.26 : (rand() - 0.5) * 1.65;
    euler.set(pitch, rand() * Math.PI * 2, isWide ? (rand() - 0.5) * 0.24 : (rand() - 0.5) * 1.55);
    q.setFromEuler(euler);
    if (opts.groundOffsetAt) {
      const span = Math.max(0.35, Math.hypot(maxX - minX, maxZ - minZ) * 0.35);
      q.premultiply(sampleTerrainSlopeQuat(opts.groundOffsetAt, tx, tz, span, span, 0.45));
    }

    let minY = Infinity;
    for (const vi of indices) {
      v.set(pos.getX(vi) - cx, pos.getY(vi) - cy, pos.getZ(vi) - cz).applyQuaternion(q);
      v.x += tx; v.z += tz;
      pos.setXYZ(vi, v.x, v.y, v.z);
      if (v.y < minY) minY = v.y;
    }
    if (opts.groundOffsetAt) {
      let maxGap = 0;
      const hCenter = opts.groundOffsetAt(tx, tz);
      const step = Math.max(1, Math.floor(indices.length / 24));
      for (let k = 0; k < indices.length; k += step) {
        const vi = indices[k]!;
        if (pos.getY(vi) > minY + 0.18) continue;
        const gap = (pos.getY(vi) - minY + hCenter) - opts.groundOffsetAt(pos.getX(vi), pos.getZ(vi));
        if (gap > maxGap) maxGap = gap;
      }
      const dy = hCenter - minY - Math.min(0.55, Math.max(0, maxGap - 0.01) * 0.92);
      for (const vi of indices) pos.setY(vi, pos.getY(vi) + dy);
      return;
    }
    for (const vi of indices) pos.setY(vi, pos.getY(vi) - minY);
  });
}

function bakeScorchAndColors(
  geo: THREE.BufferGeometry,
  blastCenter: THREE.Vector3,
  radius: number,
  tintColor?: THREE.ColorRepresentation | null,
): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const pbr = geo.getAttribute('aSurfacePBR') as THREE.BufferAttribute | undefined;
  let colorAttr = geo.getAttribute('color') as THREE.BufferAttribute | undefined;
  if (!colorAttr) {
    const arr = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) { arr[i * 3] = 0.72; arr[i * 3 + 1] = 0.75; arr[i * 3 + 2] = 0.80; }
    colorAttr = new THREE.BufferAttribute(arr, 3, false);
    geo.setAttribute('color', colorAttr);
  }
  const tint = tintColor !== null && tintColor !== undefined ? new THREE.Color(tintColor) : null;
  const cSize = colorAttr.itemSize;
  const scale = colorAttr.array instanceof Uint8Array ? 255 : 1;
  const invScale = 1 / scale;
  const arr = colorAttr.array as Float32Array | Uint8Array;
  const rSafe = Math.max(0.45, radius);

  for (let i = 0; i < pos.count; i++) {
    let r = arr[i * cSize]! * invScale;
    let g = arr[i * cSize + 1]! * invScale;
    let b = arr[i * cSize + 2]! * invScale;
    const a = cSize >= 4 ? arr[i * cSize + 3]! * invScale : 0;
    const wasEmissive = a > 0.5 || Math.max(r, g, b) > 1.05;
    const wasGlossOptic = Boolean(pbr && pbr.getX(i) < 0.25 && pbr.getY(i) >= 0.50);
    if (cSize >= 4) arr[i * cSize + 3] = 0;
    if (pbr) {
      pbr.setY(i, 0);
      pbr.setX(i, wasEmissive || wasGlossOptic ? 0.95 : Math.max(0.91, pbr.getX(i)));
    }
    const isUint8 = colorAttr.array instanceof Uint8Array;
    if (wasEmissive || wasGlossOptic) {
      arr[i * cSize] = isUint8 ? Math.round(0.046 * scale) : 0.046;
      arr[i * cSize + 1] = isUint8 ? Math.round(0.048 * scale) : 0.048;
      arr[i * cSize + 2] = isUint8 ? Math.round(0.052 * scale) : 0.052;
      continue;
    }
    const baseLum = Math.min(1, r * 0.299 + g * 0.587 + b * 0.114);
    if (tint) { r *= tint.r; g *= tint.g; b *= tint.b; }
    const tintedLum = Math.min(1, r * 0.299 + g * 0.587 + b * 0.114);
    const zoneLum = baseLum * 0.72 + tintedLum * 0.28;
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const d = Math.hypot(x - blastCenter.x, y - blastCenter.y, z - blastCenter.z);
    const blastScorch = Math.exp(-(d * d) / (rSafe * rSafe * 0.68)) * 0.52;
    const groundSoot = (1 - THREE.MathUtils.smoothstep(y, 0, Math.max(0.45, rSafe * 0.65))) * 0.38;
    const flameStreak = 0.5 + 0.5 * Math.sin(x * 7.3 + y * 5.1 + z * 6.7);
    const soot = Math.min(0.68, Math.max(0.24, Math.max(blastScorch, groundSoot) * 0.75 + 0.18 + flameStreak * 0.12));
    const charVal = 0.062 + zoneLum * 0.145;
    const sootTone = 0.054 + flameStreak * 0.02;
    const baseChar = charVal * (1 - soot * 0.5) + sootTone * (soot * 0.5);
    const nr = Math.min(0.176, baseChar * 1.03 + soot * 0.004);
    const ng = Math.min(0.172, baseChar * 0.99);
    const nb = Math.min(0.168, baseChar * 0.96);
    arr[i * cSize] = isUint8 ? Math.round(nr * scale) : nr;
    arr[i * cSize + 1] = isUint8 ? Math.round(ng * scale) : ng;
    arr[i * cSize + 2] = isUint8 ? Math.round(nb * scale) : nb;
  }
  colorAttr.needsUpdate = true;
  if (pbr) pbr.needsUpdate = true;
}

/** Bakes pose, shatters sub-assemblies, warps hull seams cleanly, extinguishes lights & chars surfaces. */
export function bakeWreckGeometry(srcGeo: THREE.BufferGeometry, opts: BakeWreckOptions = {}): THREE.BufferGeometry {
  const geo = srcGeo.index ? srcGeo.toNonIndexed() : srcGeo.clone();
  geo.userData = {};
  const posAttr = geo.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!posAttr || posAttr.count < 3) {
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    return geo;
  }
  const isBuilding = opts.kind === 'building';
  const rand = makeRng(opts.seed ?? 1.37);
  let ranges = resolveValidRanges(srcGeo, posAttr.count);
  bakeRigPose(geo, opts.weaponMatrices, opts.spinTime ?? 0);
  if (opts.buildStage !== undefined && opts.buildStage < 0.999) {
    ranges = stripUnbuiltRanges(geo, ranges, opts.buildStage);
  }

  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  geo.computeBoundingBox();
  const box = geo.boundingBox ?? new THREE.Box3();
  const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(0.5, Math.hypot(size.x, size.z) * 0.5);
  const blastCenter = new THREE.Vector3(
    (rand() - 0.5) * size.x * 0.55,
    box.min.y + Math.max(0.18, size.y * (0.35 + rand() * 0.35)),
    (rand() - 0.5) * size.z * 0.55,
  );

  const { coreIndices, shards } = partitionConnectedWreckShatter(pos, ranges, isBuilding, rand);
  collapseCoreAssembly(pos, coreIndices, blastCenter, radius, isBuilding, opts, rand);
  scatterBrokenShards(pos, shards, radius, isBuilding, opts, rand);
  pos.needsUpdate = true;

  bakeScorchAndColors(geo, blastCenter, radius, opts.tintColor);
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}
