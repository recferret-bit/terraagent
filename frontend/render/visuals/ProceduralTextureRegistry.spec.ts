import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ArchetypeCatalog } from '../kitbash';
import { PLANET_SPECS } from '../planets/PlanetSpec';
import { ProceduralTextureRegistry, type ProceduralPBRBundle } from './ProceduralTextureRegistry';
import { createFoliageMaterial } from './terrain/Scatter';
import { makeWildflowerGeo } from './terrain/groundFloraGeos';
import { terrainUniforms } from './terrain/terrainMaterial';
import { buildTreeBreedGeo } from './terrain/treeBreeds';
import { createUnifiedColonyMaterial } from './UnifiedColonyMaterial';

describe('ProceduralTextureRegistry cache (RN-13) and botanical/organic PBR presets', () => {
  it('re-registering a preset drops every cached size, so the new generator is used', () => {
    const first: ProceduralPBRBundle = {};
    const second: ProceduralPBRBundle = {};
    ProceduralTextureRegistry.register('rn13Preset', () => first);
    expect(ProceduralTextureRegistry.get('rn13Preset', 16)).toBe(first);
    expect(ProceduralTextureRegistry.get('rn13Preset', 32)).toBe(first);
    ProceduralTextureRegistry.register('rn13Preset', () => second);
    expect(ProceduralTextureRegistry.get('rn13Preset', 16)).toBe(second);
    expect(ProceduralTextureRegistry.get('rn13Preset', 32)).toBe(second);
  });

  it('keeps the cache of another preset whose name starts with the same text', () => {
    const other: ProceduralPBRBundle = {};
    ProceduralTextureRegistry.register('rn13Preset_b', () => other);
    expect(ProceduralTextureRegistry.get('rn13Preset_b', 16)).toBe(other);
    ProceduralTextureRegistry.register('rn13Preset', () => ({}));
    expect(ProceduralTextureRegistry.get('rn13Preset_b', 16)).toBe(other);
  });

  it('synthesizes seamless botanical and pelage PBR bundles with correct color spaces and linear mipmap filtering', () => {
    for (const preset of ['treeBarkFissures', 'meadowGrassClover', 'desertPebbleCrust', 'warmFurPelage', 'avianFeatherVane']) {
      const bundle = ProceduralTextureRegistry.get(preset, 32);
      expect(bundle.map).toBeDefined();
      expect(bundle.normalMap).toBeDefined();
      expect(bundle.roughnessMap).toBeDefined();
      expect(bundle.map!.colorSpace).toBe(THREE.SRGBColorSpace);
      expect(bundle.normalMap!.colorSpace).toBe(THREE.NoColorSpace);
      expect(bundle.roughnessMap!.colorSpace).toBe(THREE.NoColorSpace);
      expect(bundle.normalMap!.wrapS).toBe(THREE.RepeatWrapping);
      expect(bundle.normalMap!.wrapT).toBe(THREE.RepeatWrapping);
      expect(bundle.map!.magFilter).toBe(THREE.LinearFilter);
      expect(bundle.map!.minFilter).toBe(THREE.LinearMipmapLinearFilter);
      expect(bundle.map!.generateMipmaps).toBe(true);
      expect(bundle.roughnessMap!.minFilter).toBe(THREE.LinearMipmapLinearFilter);
      expect(bundle.roughnessMap!.generateMipmaps).toBe(true);
    }
  });

  it('wires all 5 biosphere PBR presets and fur/plumage tissues into runtime materials and meshes', () => {
    const { material: uniMat, uniforms: uniU } = createUnifiedColonyMaterial({ biome: 'temperate' });
    expect(uniU.uFurPelageMap?.value).toBe(ProceduralTextureRegistry.get('warmFurPelage', 128).map);
    expect(uniU.uFurRoughnessMap?.value).toBe(ProceduralTextureRegistry.get('warmFurPelage', 128).roughnessMap);
    expect(uniU.uFeatherVaneMap?.value).toBe(ProceduralTextureRegistry.get('avianFeatherVane', 128).map);
    expect(uniU.uFeatherRoughnessMap?.value).toBe(ProceduralTextureRegistry.get('avianFeatherVane', 128).roughnessMap);

    const foliageMat = createFoliageMaterial({ value: 0 }, 0.75, false, true);
    const mockFolSh = {
      uniforms: {} as Record<string, THREE.IUniform>,
      vertexShader: '#include <common>\nvoid main() {\n#include <color_vertex>\n#include <begin_vertex>\n}',
      fragmentShader:
        '#include <common>\nvoid main() {\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <emissivemap_fragment>\n#include <fog_fragment>\n}',
    } as unknown as THREE.WebGLProgramParametersWithUniforms;
    foliageMat.onBeforeCompile(mockFolSh, null as unknown as THREE.WebGLRenderer);
    expect(mockFolSh.uniforms.uBarkMap?.value).toBe(ProceduralTextureRegistry.get('treeBarkFissures', 128).map);
    expect(mockFolSh.uniforms.uBarkRoughMap?.value).toBe(ProceduralTextureRegistry.get('treeBarkFissures', 128).roughnessMap);
    expect(mockFolSh.fragmentShader).not.toContain('atan(');

    // Trees are stemless canopy clusters (aBark = 0 across crowns) and wildflowers remain bark-free (0)
    const birch = buildTreeBreedGeo('silverBirch', 17);
    const coral = buildTreeBreedGeo('coralBlossom', 17);
    const flower = makeWildflowerGeo('oceanForest', 17);
    const birchBark = birch.getAttribute('aBark');
    const coralBark = coral.getAttribute('aBark');
    const coralCol = coral.getAttribute('color');
    expect(birchBark).toBeDefined();
    let maxBirchBark = 0;
    for (let i = 0; i < birchBark.count; i++) maxBirchBark = Math.max(maxBirchBark, birchBark.getX(i));
    expect(maxBirchBark).toBe(0);
    for (let i = 0; i < coralBark.count; i++) {
      if (coralCol.getX(i) - coralCol.getY(i) > 0.22) expect(coralBark.getX(i)).toBe(0);
    }
    const flowerBark = flower.getAttribute('aBark');
    for (let i = 0; i < flowerBark.count; i++) expect(flowerBark.getX(i)).toBe(0);
    birch.dispose();
    coral.dispose();
    flower.dispose();

    const terrU = terrainUniforms(PLANET_SPECS.forestRock, 0, 128, [1, 0]);
    expect(terrU.uMeadowDetailMap?.value).toBe(ProceduralTextureRegistry.get('meadowGrassClover', 128).map);
    expect(terrU.uDesertCrustMap?.value).toBe(ProceduralTextureRegistry.get('desertPebbleCrust', 128).map);
    (terrU.uTerraformMap.value as THREE.Texture).dispose();

    // Warm-blooded mammals stamp tissue = 6 (pelage); birds stamp tissue = 7 (plumage)
    const wolfOrg = ArchetypeCatalog.getGeometry('fauna.timberWolf').getAttribute('aOrganic');
    const hawkOrg = ArchetypeCatalog.getGeometry('fauna.bird.highlandHawk').getAttribute('aOrganic');
    let hasFur = false;
    let hasPlumage = false;
    for (let i = 0; i < wolfOrg.count; i++) if (Math.abs(wolfOrg.getX(i) - 6) < 0.1) hasFur = true;
    for (let i = 0; i < hawkOrg.count; i++) if (Math.abs(hawkOrg.getX(i) - 7) < 0.1) hasPlumage = true;
    expect(hasFur).toBe(true);
    expect(hasPlumage).toBe(true);

    foliageMat.dispose();
    uniMat.dispose();
  });
});
