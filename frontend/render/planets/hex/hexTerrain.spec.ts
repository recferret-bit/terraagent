import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { hexCount, hexIndex } from '@terra/sim/grid/hex';
import { ProceduralTextureRegistry } from '../../visuals/ProceduralTextureRegistry';
import {
  buildChunk,
  computeEffectiveHeights,
  createHexTerrain,
  HEX_DEPOSIT,
  HEX_PREP,
  HEX_TERRAIN,
  HEX_WATER_LEVEL,
  PREP_BLEND_DURATION_S,
  scatterTileProps,
  specForPlanetType,
  tileHash01,
  tileStyle,
  tileXZ,
  type HexTiles,
  type TilePropInstance,
} from './index';
import { chunkLayout } from './chunks';

const R = 56;

function assignTemperateBands(
  order: number[],
  terrain: Uint8Array,
  height: Float32Array,
  basin: Float32Array,
  moist: Float32Array,
  elev: Float32Array,
): void {
  const count = order.length;
  const deepCount = Math.round(count * 0.04);
  const shallowCount = Math.round(count * 0.06);
  const rockCount = Math.round(count * 0.08);
  const slopeCount = Math.round(count * 0.1);
  const holeCount = Math.round(count * 0.02);
  const forestCount = Math.round(count * 0.25);
  const waterEnd = deepCount + shallowCount;
  const highStart = count - rockCount - slopeCount;
  const rockStart = count - rockCount;

  for (let k = 0; k < deepCount; k++) {
    const i = order[k]!;
    terrain[i] = HEX_TERRAIN.deep;
    height[i] = -0.6 + (0.3 * k) / Math.max(1, deepCount);
  }
  for (let k = deepCount; k < waterEnd; k++) {
    const i = order[k]!;
    terrain[i] = HEX_TERRAIN.shallow;
    height[i] = -0.25 + (0.2 * (k - deepCount)) / Math.max(1, shallowCount);
  }
  for (let k = highStart; k < rockStart; k++) {
    const i = order[k]!;
    terrain[i] = HEX_TERRAIN.slope;
    height[i] = 0.3 + (0.25 * (k - highStart)) / Math.max(1, slopeCount);
  }
  for (let k = rockStart; k < count; k++) {
    const i = order[k]!;
    terrain[i] = HEX_TERRAIN.rock;
    height[i] = 0.55 + (0.4 * (k - rockStart)) / Math.max(1, rockCount);
  }
  const mid = order.slice(waterEnd, highStart).sort((a, b) => basin[a]! - basin[b]! || a - b);
  for (let k = 0; k < holeCount; k++) {
    const i = mid[k]!;
    terrain[i] = HEX_TERRAIN.hole;
    height[i] = -0.35 + 0.08 * basin[i]!;
  }
  const land = mid.slice(holeCount).sort((a, b) => moist[b]! - moist[a]! || a - b);
  for (let k = 0; k < land.length; k++) {
    const i = land[k]!;
    terrain[i] = k < forestCount ? HEX_TERRAIN.forest : HEX_TERRAIN.flat;
    height[i] = k < forestCount ? 0.08 + 0.2 * moist[i]! : 0.02 + 0.14 * elev[i]!;
  }
}

/** Deterministic `golden-1` temperate planet tile buffers (9577 tiles, §4.5 Temperate class shares + 3 deposit kinds). */
function buildGolden1TemperateTiles(radius = R): HexTiles & {
  terrain: Uint8Array;
  prep: Uint8Array;
  height: Float32Array;
  deposit: Uint8Array;
} {
  const hx = hexIndex(radius);
  const count = hx.count;
  const terrain = new Uint8Array(count);
  const prep = new Uint8Array(count);
  const height = new Float32Array(count);
  const deposit = new Uint8Array(count);
  const elev = new Float32Array(count);
  const moist = new Float32Array(count);
  const basin = new Float32Array(count);
  const order: number[] = [];
  for (let i = 0; i < count; i++) {
    const q = hx.q[i]!, r = hx.r[i]!;
    elev[i] = tileHash01(q, r, 0x676f6c64);
    moist[i] = tileHash01(q, r, 0x656e2d31);
    basin[i] = tileHash01(q, r, 0x74656d70);
    order.push(i);
  }
  order.sort((a, b) => elev[a]! - elev[b]! || a - b);
  assignTemperateBands(order, terrain, height, basin, moist, elev);

  for (let i = 0; i < count; i++) {
    prep[i] = terrain[i] === HEX_TERRAIN.flat ? HEX_PREP.flat : HEX_PREP.wild;
  }
  const depCycle = [HEX_DEPOSIT.metals, HEX_DEPOSIT.minerals, HEX_DEPOSIT.oil] as const;
  let placed = 0;
  for (let i = 0; i < count && placed < 90; i += 97) {
    const t = terrain[i]!;
    if (t === HEX_TERRAIN.flat || t === HEX_TERRAIN.rock || t === HEX_TERRAIN.slope || t === HEX_TERRAIN.forest) {
      deposit[i] = depCycle[placed % 3]!;
      placed++;
    }
  }
  return { terrain, prep, height, deposit };
}

describe('W01-20: Hex terrain class relief and vertex colours', () => {
  it('renders all 7 terrain classes with distinct height profiles and vertex colours on golden-1', () => {
    const tiles = buildGolden1TemperateTiles(R);
    const eff = computeEffectiveHeights(R, tiles);
    const hx = hexIndex(R);
    const byClass = new Map<number, { heights: number[]; colors: Array<[number, number, number]> }>();
    for (const c of Object.values(HEX_TERRAIN)) byClass.set(c, { heights: [], colors: [] });

    for (let i = 0; i < hx.count; i++) {
      if (tiles.deposit[i] !== HEX_DEPOSIT.none) continue;
      const t = tiles.terrain[i]!;
      const st = tileStyle(hx.q[i]!, hx.r[i]!, t, tiles.prep[i]!, 0);
      const entry = byClass.get(t)!;
      entry.heights.push(eff[i]!);
      entry.colors.push([st.r, st.g, st.b]);
    }

    const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const meanH = (c: number) => mean(byClass.get(c)!.heights);
    const meanRgb = (c: number): [number, number, number] => {
      const cols = byClass.get(c)!.colors;
      return [mean(cols.map((v) => v[0])), mean(cols.map((v) => v[1])), mean(cols.map((v) => v[2]))];
    };

    expect(meanH(HEX_TERRAIN.deep)).toBeLessThan(-0.48);
    expect(meanH(HEX_TERRAIN.hole)).toBeLessThanOrEqual(-0.35);
    expect(meanH(HEX_TERRAIN.deep)).toBeLessThan(meanH(HEX_TERRAIN.hole));
    expect(meanH(HEX_TERRAIN.shallow)).toBeLessThan(-0.12);
    expect(meanH(HEX_TERRAIN.hole)).toBeLessThan(meanH(HEX_TERRAIN.shallow));
    expect(meanH(HEX_TERRAIN.flat)).toBeCloseTo(0, 5);
    expect(meanH(HEX_TERRAIN.forest)).toBeGreaterThan(0.1);
    expect(meanH(HEX_TERRAIN.slope)).toBeGreaterThan(meanH(HEX_TERRAIN.forest));
    expect(meanH(HEX_TERRAIN.rock)).toBeGreaterThan(0.75);
    expect(meanH(HEX_TERRAIN.rock)).toBeGreaterThan(meanH(HEX_TERRAIN.slope));

    const classes = Object.values(HEX_TERRAIN);
    for (let a = 0; a < classes.length; a++) {
      for (let b = a + 1; b < classes.length; b++) {
        const ca = meanRgb(classes[a]!);
        const cb = meanRgb(classes[b]!);
        expect(Math.hypot(ca[0] - cb[0], ca[1] - cb[1], ca[2] - cb[2])).toBeGreaterThan(0.06);
      }
    }
  });

  it('produces sloped gradient heights between lower and higher neighbours and stamps color buffer in buildChunk', () => {
    const r = 6;
    const hx = hexIndex(r);
    const terrain = new Uint8Array(hx.count).fill(HEX_TERRAIN.flat);
    const height = new Float32Array(hx.count);
    const prep = new Uint8Array(hx.count);
    const deposit = new Uint8Array(hx.count);

    const slopeLow = hx.indexOf(-2, 0);
    const slopeHigh = hx.indexOf(2, 0);
    terrain[slopeLow] = HEX_TERRAIN.slope;
    terrain[slopeHigh] = HEX_TERRAIN.slope;
    terrain[hx.indexOf(3, 0)] = HEX_TERRAIN.rock;
    terrain[hx.indexOf(2, 1)] = HEX_TERRAIN.rock;
    terrain[hx.indexOf(1, 1)] = HEX_TERRAIN.rock;

    const eff = computeEffectiveHeights(r, { terrain, height, prep, deposit });
    expect(eff[slopeHigh]!).toBeGreaterThan(eff[slopeLow]! + 0.08);
    const chunk = buildChunk(r, chunkLayout(r)[0]!.tiles, { terrain, height, prep, deposit });
    expect(chunk.color.length).toBe(chunk.position.length);
  });
});

describe('W01-20: Water plane and per-tile prop scatter reactivity', () => {
  it('scatters pines on Forest, boulders/spires on Rock, deposit nodes on Deposits, and water plane over Shallow/Deep', () => {
    const tiles = buildGolden1TemperateTiles(R);
    const look = specForPlanetType('temperate');
    const hexTerrain = createHexTerrain({ radius: R, tiles, look });
    const counts = hexTerrain.props.counts();
    let forestTiles = 0, rockTiles = 0, metalsTiles = 0, mineralsTiles = 0, oilTiles = 0, waterTiles = 0;
    for (let i = 0; i < tiles.terrain.length; i++) {
      const t = tiles.terrain[i]!;
      if (t === HEX_TERRAIN.forest) forestTiles++;
      else if (t === HEX_TERRAIN.rock) rockTiles++;
      else if (t === HEX_TERRAIN.shallow || t === HEX_TERRAIN.deep) waterTiles++;
      const d = tiles.deposit[i]!;
      if (d === HEX_DEPOSIT.metals) metalsTiles++;
      else if (d === HEX_DEPOSIT.minerals) mineralsTiles++;
      else if (d === HEX_DEPOSIT.oil) oilTiles++;
    }

    expect(counts.pine).toBeGreaterThanOrEqual(forestTiles * 2);
    expect(counts.pine).toBeLessThanOrEqual(forestTiles * 4);
    expect(counts.boulder + counts.spire).toBeGreaterThanOrEqual(rockTiles * 2);
    expect(counts.boulder + counts.spire).toBeLessThanOrEqual(rockTiles * 3);
    expect(counts.boulder).toBeGreaterThan(0);
    expect(counts.spire).toBeGreaterThan(0);
    expect(counts.metals).toBeGreaterThanOrEqual(metalsTiles * 2);
    expect(counts.minerals).toBeGreaterThanOrEqual(mineralsTiles * 2);
    expect(counts.oil).toBeGreaterThanOrEqual(oilTiles * 2);

    expect(hexTerrain.water.mesh.visible).toBe(true);
    expect(hexTerrain.water.mesh.position.y).toBe(HEX_WATER_LEVEL);
    expect(hexTerrain.water.waterTileCount).toBe(waterTiles);
    expect(hexTerrain.water.waterTriangleCount).toBeGreaterThan(waterTiles);
    hexTerrain.dispose();
  });

  it('drops props and levels height on a cleared Forest or broken Rock tile while keeping neighbours identical', () => {
    const r = 8;
    const count = hexCount(r);
    const hx = hexIndex(r);
    const terrain = new Uint8Array(count).fill(HEX_TERRAIN.flat);
    const prep = new Uint8Array(count).fill(HEX_PREP.flat);
    const height = new Float32Array(count);
    const deposit = new Uint8Array(count);

    const f1 = hx.indexOf(0, 0), f2 = hx.indexOf(1, 0), rk1 = hx.indexOf(0, 1), rk2 = hx.indexOf(-1, 1);
    const depTile = hx.indexOf(2, -1);
    terrain[f1] = HEX_TERRAIN.forest; prep[f1] = HEX_PREP.wild;
    terrain[f2] = HEX_TERRAIN.forest; prep[f2] = HEX_PREP.wild;
    terrain[rk1] = HEX_TERRAIN.rock; prep[rk1] = HEX_PREP.wild;
    terrain[rk2] = HEX_TERRAIN.rock; prep[rk2] = HEX_PREP.wild;
    deposit[depTile] = HEX_DEPOSIT.minerals;

    const look = specForPlanetType('temperate');
    const hexTerrain = createHexTerrain({ radius: r, tiles: { terrain, prep, height, deposit }, look });
    const f1Before = hexTerrain.props.instancesForTile(f1);
    const f2Before = hexTerrain.props.instancesForTile(f2);
    const rk1Before = hexTerrain.props.instancesForTile(rk1);
    const rk2Before = hexTerrain.props.instancesForTile(rk2);
    expect(f1Before.length).toBeGreaterThanOrEqual(2);
    expect(rk1Before.length).toBeGreaterThanOrEqual(2);
    expect(hexTerrain.heightAt(...tileXZ(0, 1))).toBeGreaterThan(0.6);

    terrain[f1] = HEX_TERRAIN.flat; prep[f1] = HEX_PREP.flat;
    terrain[rk1] = HEX_TERRAIN.flat; prep[rk1] = HEX_PREP.prepared;
    prep[depTile] = HEX_PREP.prepared;
    hexTerrain.updateTiles({ terrain, prep, height, deposit }, [f1, rk1, depTile]);

    expect(hexTerrain.props.instancesForTile(f1)).toHaveLength(0);
    expect(hexTerrain.props.instancesForTile(rk1)).toHaveLength(0);
    expect(hexTerrain.heightAt(...tileXZ(0, 0))).toBeCloseTo(0, 5);
    expect(hexTerrain.heightAt(...tileXZ(0, 1))).toBeCloseTo(0, 5);
    // Neighbours keep their placement; their height follows the ground under each prop (RN-02).
    const placement = (list: TilePropInstance[]) => list.map(({ y: _y, ...rest }) => rest);
    for (const [tile, before] of [[f2, f2Before], [rk2, rk2Before]] as const) {
      const after = hexTerrain.props.instancesForTile(tile);
      expect(placement(after)).toEqual(placement(before));
      for (const inst of after) expect(inst.y).toBe(hexTerrain.heightAt(inst.x, inst.z));
    }
    expect(hexTerrain.props.instancesForTile(depTile).length).toBeGreaterThanOrEqual(2);
    expect(scatterTileProps(2, -1, depTile, HEX_TERRAIN.flat, HEX_PREP.prepared, HEX_DEPOSIT.minerals)[0]?.kind).toBe('minerals');
    hexTerrain.dispose();
  });
});

describe('W01-20: Selected planet biome look sync on HexTerrain', () => {
  it('syncs hex terrain visuals to selected planet kind: dune has zero water and zero pine trees with sandy colours', () => {
    const tiles = buildGolden1TemperateTiles(12);
    const duneLook = specForPlanetType('desert');
    expect(duneLook.kind).toBe('dune');
    const duneTerrain = createHexTerrain({ radius: 12, tiles, look: duneLook });

    expect(duneTerrain.water.mesh.visible).toBe(false);
    expect(duneTerrain.water.waterTileCount).toBe(0);
    expect(duneTerrain.water.waterTriangleCount).toBe(0);
    expect(duneTerrain.props.counts().pine).toBe(0);
    expect(duneTerrain.props.counts().boulder).toBeGreaterThan(0);
    expect(duneTerrain.props.counts().spire).toBe(0);
    for (const chunkMesh of duneTerrain.chunks) {
      expect(chunkMesh.castShadow).toBe(true);
      expect(chunkMesh.receiveShadow).toBe(true);
      expect(chunkMesh.customDepthMaterial).toBeInstanceOf(THREE.MeshDepthMaterial);
    }
    const firstChunk = duneTerrain.chunks[0]!;
    expect(duneTerrain.material.shadowSide).toBe(THREE.DoubleSide);
    const depthSh = {
      uniforms: {},
      vertexShader: '#include <common>\nvoid main() {\n#include <begin_vertex>\n}',
      fragmentShader: '#include <common>\nvoid main() {\n#include <clipping_planes_fragment>\n}',
    } as unknown as THREE.WebGLProgramParametersWithUniforms;
    (firstChunk.customDepthMaterial as THREE.MeshDepthMaterial).onBeforeCompile(depthSh, null as unknown as THREE.WebGLRenderer);
    expect(depthSh.vertexShader).toContain('transformed.y -= 0.08;');
    expect(depthSh.fragmentShader).toContain('if (vRock < 0.001) discard;');
    expect(scatterTileProps(0, 0, 0, HEX_TERRAIN.rock, HEX_PREP.wild, HEX_DEPOSIT.metals, () => 0, 'dune')).toEqual([]);
    expect(scatterTileProps(0, 0, 0, HEX_TERRAIN.rock, HEX_PREP.wild, HEX_DEPOSIT.minerals, () => 0, 'dune')).toEqual([]);
    expect(scatterTileProps(0, 0, 0, HEX_TERRAIN.rock, HEX_PREP.wild, HEX_DEPOSIT.oil, () => 0, 'dune')).toEqual([]);

    const flatStyle = tileStyle(0, 0, HEX_TERRAIN.flat, HEX_PREP.flat, HEX_DEPOSIT.none, 'dune');
    expect(flatStyle.r).toBeGreaterThan(flatStyle.g);
    expect(flatStyle.g).toBeGreaterThan(flatStyle.b);
    const slopeStyle = tileStyle(0, 0, HEX_TERRAIN.slope, HEX_PREP.wild, HEX_DEPOSIT.none, 'dune');
    expect(slopeStyle.rock).toBe(0);
    const basinStyle = tileStyle(0, 0, HEX_TERRAIN.deep, HEX_PREP.wild, HEX_DEPOSIT.none, 'dune');
    expect(basinStyle.r).toBeGreaterThan(basinStyle.b);
    duneTerrain.dispose();

    const oceanLook = specForPlanetType('ocean');
    expect(oceanLook.kind).toBe('oceanForest');
    const oceanTerrain = createHexTerrain({ radius: 12, tiles, look: oceanLook });
    expect(oceanTerrain.water.mesh.visible).toBe(true);
    expect(oceanTerrain.water.waterTileCount).toBeGreaterThan(0);
    expect(oceanTerrain.props.counts().pine).toBeGreaterThan(0);
    oceanTerrain.dispose();
  });
});

describe('W01-21: Prepared-ground pad material and 0.4s shader blend', () => {
  it('synthesizes foundationHexPad PBR textures in ProceduralTextureRegistry and extends the single terrain shader', () => {
    const bundle = ProceduralTextureRegistry.get('foundationHexPad', 128);
    expect(bundle.map).toBeDefined();
    expect(bundle.normalMap).toBeDefined();
    expect(bundle.roughnessMap).toBeDefined();
    expect(bundle.map!.wrapS).toBe(THREE.RepeatWrapping);
    expect(bundle.map!.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(bundle.normalMap!.colorSpace).toBe(THREE.NoColorSpace);
    expect(bundle.roughnessMap!.colorSpace).toBe(THREE.NoColorSpace);
    expect(ProceduralTextureRegistry.get('foundationHexPad', 128)).toBe(bundle);
    expect((bundle.map!.image as { width: number }).width).toBe(128); // the generator's size, not the registry's 512 (RN-12)

    const r = 6;
    const count = hexCount(r);
    const terrain = new Uint8Array(count).fill(HEX_TERRAIN.flat);
    const prep = new Uint8Array(count).fill(HEX_PREP.flat);
    const height = new Float32Array(count);
    const hexTerrain = createHexTerrain({ radius: r, tiles: { terrain, prep, height }, look: specForPlanetType('temperate') });

    for (const chunkMesh of hexTerrain.chunks) {
      expect(chunkMesh.material).toBe(hexTerrain.material);
    }
    expect(hexTerrain.uniforms.uPadMap?.value).toBe(bundle.map);
    expect(hexTerrain.uniforms.uPadNormal?.value).toBe(bundle.normalMap);
    expect(hexTerrain.uniforms.uPadRough?.value).toBe(bundle.roughnessMap);

    const mockShader: THREE.WebGLProgramParametersWithUniforms = {
      uniforms: {},
      vertexShader: '#include <common>\nvoid main() {\n#include <begin_vertex>\n}',
      fragmentShader:
        '#include <common>\nvoid main() {\n#include <color_fragment>\n#include <alphatest_fragment>\n#include <roughnessmap_fragment>\n#include <normal_fragment_maps>\n#include <emissivemap_fragment>\n#include <fog_fragment>\n}',
    } as unknown as THREE.WebGLProgramParametersWithUniforms;
    hexTerrain.material.onBeforeCompile(mockShader, null as unknown as THREE.WebGLRenderer);

    expect(mockShader.vertexShader).toContain('attribute float aPrepTarget;');
    expect(mockShader.vertexShader).toContain('attribute float aPrepStartTime;');
    expect(mockShader.vertexShader).toContain('float prepBlend = aPrepTarget * clamp((uTime - aPrepStartTime) / 0.4, 0.0, 1.0);');
    expect(mockShader.fragmentShader).toContain('evalFoundationPad');
    expect(mockShader.fragmentShader).toContain('frontierGlow');
    hexTerrain.dispose();
  });

  it('blends a newly graded tile from 0 -> 0.5 -> 1.0 over 0.4s while starting initially Prepared tiles at 1.0', () => {
    const r = 6;
    const count = hexCount(r);
    const hx = hexIndex(r);
    const terrain = new Uint8Array(count).fill(HEX_TERRAIN.flat);
    const prep = new Uint8Array(count).fill(HEX_PREP.flat);
    const height = new Float32Array(count);

    const preloadedIdx = hx.indexOf(-2, 1);
    const gradedIdx = hx.indexOf(1, 0);
    prep[preloadedIdx] = HEX_PREP.prepared;

    const hexTerrain = createHexTerrain({ radius: r, tiles: { terrain, prep, height }, look: specForPlanetType('temperate') });
    expect(PREP_BLEND_DURATION_S).toBe(0.4);
    expect(hexTerrain.getTilePrepBlend(-2, 1)).toBe(1.0);
    expect(hexTerrain.getTilePrepBlend(1, 0)).toBe(0.0);

    hexTerrain.tick(1.25);
    prep[gradedIdx] = HEX_PREP.prepared;
    hexTerrain.updateTiles({ terrain, prep, height }, [gradedIdx]);

    expect(hexTerrain.getTilePrepBlend(1, 0)).toBeCloseTo(0.0, 5);
    hexTerrain.tick(0.2);
    expect(hexTerrain.getTilePrepBlend(1, 0)).toBeCloseTo(0.5, 5);
    hexTerrain.tick(0.2);
    expect(hexTerrain.getTilePrepBlend(1, 0)).toBeCloseTo(1.0, 5);
    hexTerrain.tick(0.5);
    expect(hexTerrain.getTilePrepBlend(1, 0)).toBe(1.0);
    expect(hexTerrain.getTilePrepBlend(-2, 1)).toBe(1.0);
    hexTerrain.dispose();
  });
});

describe('Hexagon edge visibility on terraformed flat ground', () => {
  it('draws hexagons strictly on flat, level, buildable tiles (aHexFlat = 1) and removes them on mountains, dunes, water, and uneven borders', () => {
    const r = 6;
    const count = hexCount(r);
    const hx = hexIndex(r);
    const terrain = new Uint8Array(count).fill(HEX_TERRAIN.flat);
    const prep = new Uint8Array(count).fill(HEX_PREP.flat);
    const height = new Float32Array(count);

    const rockIdx = hx.indexOf(2, 0);
    const duneIdx = hx.indexOf(-2, 0);
    const forestIdx = hx.indexOf(0, 2);
    const holeIdx = hx.indexOf(0, -2);
    const shallowIdx = hx.indexOf(2, -2);
    const deepIdx = hx.indexOf(-2, 2);
    const ridgeIdx = hx.indexOf(1, -2);
    const unevenRampIdx = hx.indexOf(3, 0);
    const mesaRimIdx = hx.indexOf(3, -1);

    terrain[rockIdx] = HEX_TERRAIN.rock;
    height[rockIdx] = 1.4;
    terrain[duneIdx] = HEX_TERRAIN.slope;
    height[duneIdx] = 0.7;
    terrain[forestIdx] = HEX_TERRAIN.forest;
    terrain[holeIdx] = HEX_TERRAIN.hole;
    terrain[shallowIdx] = HEX_TERRAIN.shallow;
    terrain[deepIdx] = HEX_TERRAIN.deep;
    prep[ridgeIdx] = HEX_PREP.ridge;
    // Sloped ramp tile marked flat in terrain but with raw height > 0.15 m
    height[unevenRampIdx] = 0.45;
    // Raised mesa rim tile (height 1.1 m) bordering a steep cliff drop to 0.0 m
    height[mesaRimIdx] = 1.1;
    height[hx.indexOf(3, -2)] = 1.1;

    const allTiles = Array.from({ length: count }, (_, i) => i);
    const chunk = buildChunk(r, allTiles, { terrain, prep, height, kind: 'dune' });
    const flatByTile = new Map<number, number>();
    for (let v = 0; v < chunk.vertexTile.length; v++) {
      flatByTile.set(chunk.vertexTile[v]!, chunk.aHexFlat[v]!);
    }

    expect(flatByTile.get(hx.indexOf(0, 0))).toBe(1.0);
    expect(flatByTile.get(rockIdx)).toBe(0.0);
    expect(flatByTile.get(duneIdx)).toBe(0.0);
    expect(flatByTile.get(forestIdx)).toBe(0.0);
    expect(flatByTile.get(holeIdx)).toBe(0.0);
    expect(flatByTile.get(shallowIdx)).toBe(0.0);
    expect(flatByTile.get(deepIdx)).toBe(0.0);
    expect(flatByTile.get(ridgeIdx)).toBe(0.0);
    expect(flatByTile.get(unevenRampIdx)).toBe(0.0);
    expect(flatByTile.get(mesaRimIdx)).toBe(0.0);

    const hexTerrain = createHexTerrain({ radius: r, tiles: { terrain, prep, height }, look: specForPlanetType('desert') });
    const mockShader: THREE.WebGLProgramParametersWithUniforms = {
      uniforms: {},
      vertexShader: '#include <common>\nvoid main() {\n#include <begin_vertex>\n}',
      fragmentShader:
        '#include <common>\nvoid main() {\n#include <color_fragment>\n#include <alphatest_fragment>\n#include <roughnessmap_fragment>\n#include <normal_fragment_maps>\n#include <emissivemap_fragment>\n#include <fog_fragment>\n}',
    } as unknown as THREE.WebGLProgramParametersWithUniforms;
    hexTerrain.material.onBeforeCompile(mockShader, null as unknown as THREE.WebGLRenderer);
    expect(mockShader.vertexShader).toContain('attribute float aHexFlat;');
    expect(mockShader.vertexShader).toContain('vFlatPos = aHexFlat *');
    expect(mockShader.fragmentShader).toContain('hexFlatMask');
    expect(mockShader.fragmentShader).not.toContain('duneSlopeFade');
    hexTerrain.dispose();
  });
});
