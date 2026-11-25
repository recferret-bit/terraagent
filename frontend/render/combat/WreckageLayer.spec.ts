import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createArchetypeMesh, stripBuildingPlinth } from '../kitbash';
import { ProceduralTextureRegistry } from '../visuals/ProceduralTextureRegistry';
import { captureWeaponSideMatrices } from './WeaponRig';
import { bakeWreckGeometry } from './wreckGeometry';
import { WreckageLayer } from './WreckageLayer';

describe('bakeWreckGeometry across bots & plinth-stripped buildings', () => {
  it('distorts, chars, extinguishes lights, freezes anims and shatters bots & buildings cleanly', () => {
    for (const [id, kind] of [
      ['robot.recon', 'bot'],
      ['robot.tank', 'bot'],
      ['robot.artillery', 'bot'],
      ['robot.miner', 'bot'],
      ['robot.builder', 'bot'],
      ['robot.hero', 'bot'],
      ['building.turret', 'building'],
      ['building.solar', 'building'],
      ['building.commandHub', 'building'],
    ] as const) {
      const mesh = createArchetypeMesh(id, 'desert');
      if (kind === 'building') stripBuildingPlinth(mesh);
      const srcGeo = (mesh as THREE.Mesh).geometry;
      srcGeo.computeBoundingBox();
      const origBox = srcGeo.boundingBox!.clone();
      const origSpanX = origBox.max.x - origBox.min.x;
      const origSpanZ = origBox.max.z - origBox.min.z;

      const srcPos = srcGeo.getAttribute('position') as THREE.BufferAttribute;
      const srcCol = srcGeo.getAttribute('color') as THREE.BufferAttribute;
      // Record duplicate vertices sharing exact starting coordinates to verify welded deformation (zero cracks)
      const dupGroups = new Map<string, number[]>();
      let origLumaSum = 0;
      for (let i = 0; i < srcPos.count; i++) {
        const key = `${Math.round(srcPos.getX(i) * 1000)}_${Math.round(srcPos.getY(i) * 1000)}_${Math.round(srcPos.getZ(i) * 1000)}`;
        const arr = dupGroups.get(key) ?? [];
        arr.push(i);
        dupGroups.set(key, arr);
        origLumaSum += srcCol.getX(i) + srcCol.getY(i) + srcCol.getZ(i);
      }

      const baked = bakeWreckGeometry(srcGeo, { seed: 7.25, kind, buildStage: 1 });
      baked.computeBoundingBox();
      const box = baked.boundingBox!;

      expect(box.min.y, `${id} ground contact`).toBeGreaterThanOrEqual(-0.001);
      const bakedSpanX = box.max.x - box.min.x;
      const bakedSpanZ = box.max.z - box.min.z;
      expect(Math.max(bakedSpanX, bakedSpanZ), `${id} shattered scatter`).toBeGreaterThan(
        Math.max(origSpanX, origSpanZ) + 0.25,
      );

      const pos = baked.getAttribute('position') as THREE.BufferAttribute;
      const pbr = baked.getAttribute('aSurfacePBR') as THREE.BufferAttribute;
      const anim = baked.getAttribute('aPartAnim') as THREE.BufferAttribute;
      const col = baked.getAttribute('color') as THREE.BufferAttribute;
      expect(Array.from(anim.array).every((v) => v === 0), `${id} anim zeroed`).toBe(true);
      let anyEmissiveRemaining = false;
      let bakedLumaSum = 0;
      let movedVerts = 0;
      for (let i = 0; i < pos.count; i++) {
        if (pbr.getY(i) > 0.01) anyEmissiveRemaining = true;
        bakedLumaSum += col.getX(i) + col.getY(i) + col.getZ(i);
        const dx = pos.getX(i) - srcPos.getX(i);
        const dy = pos.getY(i) - srcPos.getY(i);
        const dz = pos.getZ(i) - srcPos.getZ(i);
        if (dx * dx + dy * dy + dz * dz > 1e-4) movedVerts++;
      }
      expect(anyEmissiveRemaining, `${id} dead emissives`).toBe(false);
      expect(bakedLumaSum, `${id} charred darkening`).toBeLessThan(origLumaSum * 0.92);
      expect(movedVerts, `${id} distorted geometry`).toBeGreaterThan(pos.count * 0.2);

      // Same starting seam vertices remain welded (excluding detached chunk boundary cuts handled at whole-part level)
      let checkedPairs = 0;
      for (const indices of dupGroups.values()) {
        if (indices.length < 2) continue;
        const first = indices[0]!;
        let identical = true;
        for (let k = 1; k < indices.length; k++) {
          const idx = indices[k]!;
          if (
            Math.hypot(
              pos.getX(idx) - pos.getX(first),
              pos.getY(idx) - pos.getY(first),
              pos.getZ(idx) - pos.getZ(first),
            ) > 1e-4
          ) {
            identical = false;
            break;
          }
        }
        if (identical) checkedPairs++;
      }
      expect(checkedPairs, `${id} seam vertices stay welded`).toBeGreaterThan(0);

      baked.dispose();
      srcGeo.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  });
});

describe('bakeWreckGeometry rig baking, partial build stages & primitive fallbacks', () => {
  it('bakes posed weapon rig transforms, partial build stages, and raw primitive fallbacks safely', () => {
    const turret = createArchetypeMesh('building.turret');
    const rigMats = captureWeaponSideMatrices(turret);
    const rotHead = new THREE.Matrix4().makeRotationY(Math.PI * 0.5);
    const rotated = bakeWreckGeometry((turret as THREE.Mesh).geometry, {
      kind: 'building',
      weaponMatrices: rigMats ? [rotHead, rotHead, rotHead] : [rotHead, rotHead, rotHead],
      seed: 3,
    });
    expect(Array.from((rotated.getAttribute('aWeaponPart') as THREE.BufferAttribute).array).every((v) => v === 0)).toBe(true);
    rotated.dispose();

    const hub = createArchetypeMesh('building.commandHub');
    stripBuildingPlinth(hub);
    const fullVerts = (hub as THREE.Mesh).geometry.getAttribute('position').count;
    const earlyScaffoldWreck = bakeWreckGeometry((hub as THREE.Mesh).geometry, {
      kind: 'building',
      buildStage: 0,
      seed: 2,
    });
    expect(earlyScaffoldWreck.getAttribute('position').count).toBeLessThan(fullVerts);
    earlyScaffoldWreck.dispose();

    // Indexed raw primitive without partRanges or custom attributes
    const rawBox = new THREE.BoxGeometry(1, 2, 1, 2, 2, 2);
    const rawWreck = bakeWreckGeometry(rawBox, {
      kind: 'bot',
      seed: 5,
      groundOffsetAt: (lx) => lx * 0.2,
    });
    expect(rawWreck.getAttribute('position').count).toBeGreaterThan(0);
    expect(rawWreck.getAttribute('color')).toBeDefined();
    rawWreck.dispose();
    rawBox.dispose();

    // Degenerate empty geometry does not throw
    const empty = new THREE.BufferGeometry();
    const emptyOut = bakeWreckGeometry(empty);
    expect(emptyOut).toBeDefined();
    emptyOut.dispose();
    empty.dispose();
  });
});

describe('WreckageLayer management, deduplication, FIFO & footprint clearing', () => {
  it('preserves grounded wrecks on slopes, deduplicates IDs, enforces FIFO capacity & clears overlapping rubble', () => {
    const parent = new THREE.Group();
    const layer = new WreckageLayer(parent, 'desert', 2);

    const reconA = createArchetypeMesh('robot.recon', 'desert');
    reconA.position.set(4, 2, -2);
    reconA.rotation.y = 0.7;

    const ok1 = layer.preserve(10, reconA, {
      kind: 'bot',
      groundY: 2,
      groundHeightAt: (wx, wz) => 2 + (wx - 4) * 0.25 + (wz + 2) * 0.1,
      footprintRadius: 0.7,
    });
    expect(ok1).toBe(true);
    expect(layer.has(10)).toBe(true);
    expect(layer.count).toBe(1);

    // Duplicate ID is idempotent
    expect(layer.preserve(10, reconA, { kind: 'bot', groundY: 2 })).toBe(false);
    expect(layer.count).toBe(1);

    const reconB = createArchetypeMesh('robot.recon', 'desert');
    reconB.position.set(16, 0, 16);
    layer.preserve(11, reconB, { kind: 'bot', groundY: 0, footprintRadius: 0.7 });
    expect(layer.count).toBe(2);

    // Clear rubble in build footprint around (4, -2) leaves distant wreck at (16, 16) intact
    const cleared = layer.clearInRadius(4, -2, 1.0);
    expect(cleared).toBe(1);
    expect(layer.has(10)).toBe(false);
    expect(layer.has(11)).toBe(true);
    expect(layer.count).toBe(1);

    // FIFO cap evicts oldest when exceeding maxWrecks = 2
    const tank = createArchetypeMesh('robot.tank', 'desert');
    tank.position.set(1, 0, 1);
    const hub = createArchetypeMesh('building.solar', 'desert');
    stripBuildingPlinth(hub);
    hub.position.set(-5, 0, 4);
    layer.preserve(12, tank, { kind: 'bot', groundY: 0 });
    layer.preserve(13, hub, { kind: 'building', groundY: 0 });
    expect(layer.count).toBe(2);
    expect(layer.has(11)).toBe(false);
    expect(layer.has(12)).toBe(true);
    expect(layer.has(13)).toBe(true);

    layer.setBiome('oceanForest');
    expect(layer.count).toBe(2);
    expect(layer.remove(12)).toBe(true);
    expect(layer.count).toBe(1);

    layer.clear();
    expect(layer.count).toBe(0);
    layer.dispose();
  });
});

describe('WreckageLayer burned fire textures, optic extinction & uniform state', () => {
  it('extinguishes HDR emissives & glossy optics, chars painted vertices while retaining readable 3D part contrast, and binds charredBurnedWreck PBR textures', () => {
    const texBundle = ProceduralTextureRegistry.get('charredBurnedWreck', 64);
    expect(texBundle.map).toBeDefined();
    expect(texBundle.normalMap).toBeDefined();
    expect(texBundle.roughnessMap).toBeDefined();
    const mapData = (texBundle.map as THREE.DataTexture).image.data as Uint8Array;
    let minLuma = 255;
    let maxLuma = 0;
    for (let i = 0; i < mapData.length; i += 4) {
      const l = (mapData[i]! + mapData[i + 1]! + mapData[i + 2]!) / 3;
      if (l < minLuma) minLuma = l;
      if (l > maxLuma) maxLuma = l;
    }
    expect(maxLuma - minLuma).toBeGreaterThan(30);
    expect(minLuma).toBeGreaterThanOrEqual(45);
    expect(maxLuma).toBeLessThan(145);

    const mesh = createArchetypeMesh('robot.artillery', 'desert');
    const baked = bakeWreckGeometry((mesh as THREE.Mesh).geometry, { kind: 'bot', tintColor: 0xff6a13 });
    const col = baked.getAttribute('color') as THREE.BufferAttribute;
    const pbr = baked.getAttribute('aSurfacePBR') as THREE.BufferAttribute;
    const inv = col.normalized ? 1 / (col.array instanceof Uint16Array ? 65535 : 255) : 1;
    let maxChannel = 0;
    let minPaintedLuma = 1;
    let maxPaintedLuma = 0;
    let maxSaturation = 0;
    for (let i = 0; i < col.count; i++) {
      const r = col.getX(i) * (col.normalized ? 1 : inv);
      const g = col.getY(i) * (col.normalized ? 1 : inv);
      const b = col.getZ(i) * (col.normalized ? 1 : inv);
      const a = col.itemSize >= 4 ? col.array[i * col.itemSize + 3]! * inv : 0;
      expect(a).toBe(0);
      expect(pbr.getX(i)).toBeGreaterThanOrEqual(0.90);
      expect(pbr.getY(i)).toBe(0);
      maxChannel = Math.max(maxChannel, r, g, b);
      maxSaturation = Math.max(maxSaturation, Math.max(r, g, b) - Math.min(r, g, b));
      if (pbr.getX(i) < 0.945) {
        const lum = r * 0.299 + g * 0.587 + b * 0.114;
        minPaintedLuma = Math.min(minPaintedLuma, lum);
        maxPaintedLuma = Math.max(maxPaintedLuma, lum);
      }
    }
    expect(maxChannel).toBeLessThan(0.30);
    expect(minPaintedLuma).toBeGreaterThanOrEqual(0.06);
    expect(maxPaintedLuma - minPaintedLuma).toBeGreaterThan(0.05);
    expect(maxSaturation).toBeLessThan(0.05);

    const parent = new THREE.Group();
    const layer = new WreckageLayer(parent, 'desert', 4);
    layer.preserve(99, mesh, { kind: 'bot', groundY: 0 });
    const wreckMesh = layer.group.children[0] as THREE.Mesh;
    const mat = wreckMesh.material as THREE.MeshStandardMaterial;
    const mockShader = {
      uniforms: {},
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    } as unknown as THREE.WebGLProgramParametersWithUniforms;
    mat.onBeforeCompile(mockShader, null as unknown as THREE.WebGLRenderer);
    expect((mockShader.uniforms.uRuin as { value?: number })?.value).toBe(1);
    const rim = Number((mockShader.uniforms.uRimStrength as { value?: number })?.value ?? 1);
    expect(rim).toBeGreaterThanOrEqual(0.10);
    expect(rim).toBeLessThanOrEqual(0.22);
    expect(mockShader.uniforms.uRuinBurnMap?.value).toBeDefined();
    expect(mockShader.uniforms.uRuinBurnNormalMap?.value).toBeDefined();
    expect(mockShader.fragmentShader).toContain('uRuinBurnMap');
    expect(mockShader.fragmentShader).toContain('uRuinBurnNormalMap');
    layer.dispose();
  });
});

describe('WreckageLayer steep dune slope & ridge seating', () => {
  it('tilts and seats 3x3 building wrecks onto steep/convex slopes without downhill base overhang', () => {
    const factory = createArchetypeMesh('building.roboticsFactory', 'desert');
    stripBuildingPlinth(factory);
    // Steep downhill slope + convex ridge drop: z > 0 drops by -0.35 * z - 0.08 * z^2
    const slopeOffsetAt = (lx: number, lz: number) => -0.32 * lz - 0.12 * lx - 0.06 * (lx * lx + lz * lz);
    const baked = bakeWreckGeometry((factory as THREE.Mesh).geometry, {
      kind: 'building',
      seed: 4.2,
      buildStage: 1,
      groundOffsetAt: slopeOffsetAt,
    });
    const pos = baked.getAttribute('position') as THREE.BufferAttribute;
    let downhillMinY = Infinity;
    let uphillMinY = Infinity;
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i);
      const y = pos.getY(i);
      if (z > 1.2 && z < 2.6 && y < downhillMinY) downhillMinY = y;
      if (z < -1.2 && z > -2.6 && y < uphillMinY) uphillMinY = y;
    }
    // Downhill base tilts below uphill base and seats near the downhill slope rather than floating at y >= 0
    expect(downhillMinY).toBeLessThan(uphillMinY - 0.4);
    expect(downhillMinY).toBeLessThan(-0.35);
    baked.dispose();
    (factory as THREE.Mesh).geometry.dispose();
    ((factory as THREE.Mesh).material as THREE.Material).dispose();
  });
});
