import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { hexCount, hexIndex } from '@terra/sim/grid/hex';
import { PLANET_KINDS } from '../PlanetSpec';
import {
  createTerraformingTerrainMaterial,
  resolveTerraformPalette,
} from '../../visuals/TerrainAndWaterShaders';
import {
  applyTileStatePreset,
  createHexTerrain,
  HEX_PREP,
  HEX_TERRAIN,
  specForPlanetType,
  TILE_STATE_PRESETS,
  tileStyle,
} from './index';

describe('W05-23: Irrigated and Living terrain look & playground tile-state presets', () => {
  it('produces distinct tileStyle colours for Prepared, Irrigated, and Living across all planet kinds', () => {
    for (const kind of PLANET_KINDS) {
      const prepSt = tileStyle(0, 0, HEX_TERRAIN.flat, HEX_PREP.prepared, 0, kind);
      const irrSt = tileStyle(0, 0, HEX_TERRAIN.flat, HEX_PREP.irrigated, 0, kind);
      const livSt = tileStyle(0, 0, HEX_TERRAIN.flat, HEX_PREP.living, 0, kind);

      expect(prepSt.rock).toBe(0);
      expect(irrSt.rock).toBe(0);
      expect(livSt.rock).toBe(0);

      // Even if the underlying terrain class was rock or slope, cleared prep states keep rock = 0
      expect(tileStyle(1, -1, HEX_TERRAIN.rock, HEX_PREP.irrigated, 0, kind).rock).toBe(0);
      expect(tileStyle(1, -1, HEX_TERRAIN.rock, HEX_PREP.living, 0, kind).rock).toBe(0);

      // Irrigated is darkened relative to Prepared
      const lum = (s: { r: number; g: number; b: number }) => 0.3 * s.r + 0.59 * s.g + 0.11 * s.b;
      expect(lum(irrSt)).toBeLessThan(lum(prepSt) * 0.75);

      // Pairwise Euclidean RGB distance between Prepared, Irrigated, and Living is clearly distinct
      const dist = (a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) =>
        Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
      expect(dist(prepSt, irrSt)).toBeGreaterThan(0.18);
      expect(dist(prepSt, livSt)).toBeGreaterThan(0.12);
      expect(dist(irrSt, livSt)).toBeGreaterThan(0.15);
    }
  });
});

describe('W05-23: HexTileTint uTerraformMap and shader compilation', () => {
  it('stamps uTerraformMap and uTileTint for Prepared, Irrigated, and Living tiles and compiles evalTerraformSurface', () => {
    const r = 5;
    const count = hexCount(r);
    const hx = hexIndex(r);
    const terrain = new Uint8Array(count).fill(HEX_TERRAIN.flat);
    const prep = new Uint8Array(count).fill(HEX_PREP.flat);
    const height = new Float32Array(count);

    const look = specForPlanetType('temperate');
    const hexTerrain = createHexTerrain({ radius: r, tiles: { terrain, prep, height }, look });

    const tfTex = hexTerrain.uniforms.uTerraformMap?.value as THREE.DataTexture;
    expect(tfTex).toBeInstanceOf(THREE.DataTexture);
    const lushCol = hexTerrain.uniforms.uTerraformedLush?.value as THREE.Color;
    const glowCol = hexTerrain.uniforms.uFrontierGlow?.value as THREE.Color;
    expect(lushCol).toBeInstanceOf(THREE.Color);
    expect(glowCol).toBeInstanceOf(THREE.Color);
    expect(lushCol.getHex()).toBe(resolveTerraformPalette(look.kind).terraformedLush);
    expect(glowCol.getHex()).toBe(resolveTerraformPalette(look.kind).frontierGlow);

    const n = 2 * r + 1;
    const tfTexel = (q: number, rr: number) => {
      const o = ((rr + r) * n + (q + r)) * 4;
      return Array.from((tfTex.image.data as Uint8Array).slice(o, o + 4));
    };

    hexTerrain.setTileState(0, 0, HEX_TERRAIN.flat, HEX_PREP.prepared);
    hexTerrain.setTileState(1, 0, HEX_TERRAIN.flat, HEX_PREP.irrigated);
    hexTerrain.setTileState(-1, 0, HEX_TERRAIN.flat, HEX_PREP.living);

    expect(tfTexel(0, 0)).toEqual([0, 0, 255, 255]);
    expect(tfTexel(1, 0)).toEqual([0, 255, 0, 255]);
    expect(tfTexel(-1, 0)).toEqual([255, 0, 0, 255]);
    expect(tfTexel(0, 2)).toEqual([0, 0, 0, 255]);
    expect(tfTexel(-r, -r)[3]).toBe(0);

    const sh = {
      uniforms: {},
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    } as unknown as THREE.WebGLProgramParametersWithUniforms;
    hexTerrain.material.onBeforeCompile(sh, null as unknown as THREE.WebGLRenderer);

    expect(sh.fragmentShader).toContain('uniform sampler2D uTerraformMap;');
    expect(sh.fragmentShader).toContain('uniform vec3 uTerraformedLush;');
    expect(sh.fragmentShader).toContain('uniform vec3 uFrontierGlow;');
    expect(sh.fragmentShader).toContain('void evalTerraformSurface(');
    expect(sh.fragmentShader).toContain('vec4 hexTerraformMask(vec2 axial)');
    expect(sh.fragmentShader.indexOf('uniform sampler2D uTerraformMap;')).toBeLessThan(
      sh.fragmentShader.indexOf('vec4 hexTerraformMask(vec2 axial)'),
    );
    expect(sh.fragmentShader).toContain('evalTerraformSurface(diffuseColor.rgb, gRough, gEmis, vLP.xz, tfMask, irrMask, uTime);');

    // The glowing frontier / hydro rings are off on the hex ground (they outlined every Living / Irrigated hex like a selection)
    const hexDefine = sh.fragmentShader.indexOf('#define TA_HEX_TERRAFORM');
    const ringGuard = sh.fragmentShader.indexOf('#ifndef TA_HEX_TERRAFORM');
    expect(hexDefine).toBeGreaterThan(-1);
    expect(ringGuard).toBeGreaterThan(hexDefine);
    expect(sh.fragmentShader.indexOf('float tfRing', ringGuard)).toBeGreaterThan(ringGuard);
    expect(sh.fragmentShader.indexOf('float irrRing', ringGuard)).toBeGreaterThan(ringGuard);

    // Also verify standalone createTerraformingTerrainMaterial shares the same evaluator
    const standalone = createTerraformingTerrainMaterial('temperate', 120);
    const sh2 = {
      uniforms: {},
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    } as unknown as THREE.WebGLProgramParametersWithUniforms;
    standalone.material.onBeforeCompile(sh2, null as unknown as THREE.WebGLRenderer);
    expect(sh2.fragmentShader).toContain('evalTerraformSurface(');
    standalone.material.dispose();
    standalone.terraformTexture.dispose();

    expect(hx.indexOf(0, 0)).toBeGreaterThanOrEqual(0);
    hexTerrain.dispose();
  });
});

describe('W05-23: Playground tile-state preset switching', () => {
  it('toggles playground tile-state presets (prepared, irrigated, living, mixed) and updates hex terrain prep & uTerraformMap', () => {
    expect(TILE_STATE_PRESETS).toEqual(['prepared', 'irrigated', 'living', 'mixed']);
    const r = 8;
    const hx = hexIndex(r);
    const terrain = new Uint8Array(hx.count).fill(HEX_TERRAIN.flat);
    const prep = new Uint8Array(hx.count).fill(HEX_PREP.flat);
    const height = new Float32Array(hx.count);
    const hexTerrain = createHexTerrain({
      radius: r,
      tiles: { terrain, prep, height },
      look: specForPlanetType('desert'),
    });
    const tfData = () => (hexTerrain.uniforms.uTerraformMap!.value as THREE.DataTexture).image.data as Uint8Array;
    const n = 2 * r + 1;
    const centerOffset = (r * n + r) * 4;

    const changedPrep = applyTileStatePreset(r, prep, terrain, 'prepared', 4);
    hexTerrain.updateTiles({ terrain, prep, height }, changedPrep);
    expect(prep[hx.indexOf(0, 0)]).toBe(HEX_PREP.prepared);
    expect(Array.from(tfData().slice(centerOffset, centerOffset + 3))).toEqual([0, 0, 255]);

    const changedIrr = applyTileStatePreset(r, prep, terrain, 'irrigated', 4);
    expect(changedIrr.length).toBeGreaterThan(0);
    hexTerrain.updateTiles({ terrain, prep, height }, changedIrr);
    expect(prep[hx.indexOf(0, 0)]).toBe(HEX_PREP.irrigated);
    expect(Array.from(tfData().slice(centerOffset, centerOffset + 3))).toEqual([0, 255, 0]);

    const changedLiv = applyTileStatePreset(r, prep, terrain, 'living', 4);
    expect(changedLiv.length).toBeGreaterThan(0);
    hexTerrain.updateTiles({ terrain, prep, height }, changedLiv);
    expect(prep[hx.indexOf(0, 0)]).toBe(HEX_PREP.living);
    expect(Array.from(tfData().slice(centerOffset, centerOffset + 3))).toEqual([255, 0, 0]);

    const changedMix = applyTileStatePreset(r, prep, terrain, 'mixed', 4);
    expect(changedMix.length).toBeGreaterThan(0);
    hexTerrain.updateTiles({ terrain, prep, height }, changedMix);
    expect(prep[hx.indexOf(-1, 0)]).toBe(HEX_PREP.living);
    expect(prep[hx.indexOf(1, 0)]).toBe(HEX_PREP.irrigated);
    expect(prep[hx.indexOf(1, -1)]).toBe(HEX_PREP.prepared);

    hexTerrain.dispose();
  });
});
