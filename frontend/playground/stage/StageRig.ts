import * as THREE from 'three';
import type { ColonyViewport } from '@terra/render/core/createColonyViewport';
import { COLONY_VISION_AND_LIGHTS_GLSL, getColonyVisionUniforms } from '@terra/render/lighting/ColonyVisionAndLights';
import { PLANET_SPECS, type PlanetKind } from '@terra/render/planets/PlanetSpec';
import { PEDESTAL_R, buildGrid } from './grid';
import { buildHuman, buildRuler } from './props';

function applyPedestalProjectorShader(mat: THREE.MeshStandardMaterial) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, getColonyVisionUniforms());
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPedW; varying vec3 vPedN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPedW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvPedN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vPedW; varying vec3 vPedN;\n${COLONY_VISION_AND_LIGHTS_GLSL}`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n{ vec3 taProj = evalColonyProjectorLight(vPedW, vPedN); totalEmissiveRadiance += diffuseColor.rgb * taProj + taProj * 0.08; }');
  };
}

/** Pedestal + square calibration grid + hidden ruler + human reference; rebuilt when the biome changes. */
export class StageRig {
  readonly group = new THREE.Group();
  grid = new THREE.Group();
  ruler = new THREE.Group();
  human = new THREE.Group();
  /** Pedestal top disc (target of the double-click refocus ray). */
  top!: THREE.Mesh;

  constructor(private getMinX: () => number) {}

  build(kind: PlanetKind, opts: { human: boolean }) {
    this.group.clear();
    const spec = PLANET_SPECS[kind];
    const slabMat = new THREE.MeshStandardMaterial({ color: spec.palette.rockDark, roughness: 0.75, metalness: 0.2 });
    applyPedestalProjectorShader(slabMat);
    const slab = new THREE.Mesh(new THREE.CylinderGeometry(PEDESTAL_R, PEDESTAL_R + 0.25, 0.5, 64), slabMat);
    slab.position.y = -0.5 - 0.002; slab.receiveShadow = true; slab.name = 'pedestal';
    const topMat = new THREE.MeshStandardMaterial({ color: spec.palette.groundLow, roughness: 0.85, metalness: 0.05 });
    applyPedestalProjectorShader(topMat);
    const top = new THREE.Mesh(new THREE.CircleGeometry(PEDESTAL_R, 64).rotateX(-Math.PI / 2), topMat);
    top.position.y = -0.002; top.receiveShadow = true; top.name = 'pedestal';
    const rim = new THREE.Mesh(new THREE.TorusGeometry(PEDESTAL_R, 0.05, 8, 96).rotateX(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x1e5bff, emissive: 0x1e5bff, emissiveIntensity: 1.6 }));
    this.top = top;
    this.group.add(slab, top, rim);

    this.grid = buildGrid(false); this.group.add(this.grid);
    this.ruler = buildRuler(); this.ruler.visible = false; this.group.add(this.ruler);
    this.human = buildHuman(); this.human.visible = opts.human; this.group.add(this.human);
    this.grid.visible = true;
    this.placeHuman();
  }

  /** The planet-surface view replaces the pedestal. */
  hidePedestal() { this.group.children.forEach((c) => { if (c.name === 'pedestal') c.visible = false; }); }

  placeHuman() { this.human.position.set(Math.max(-5, this.getMinX() - 1.2), 0, 0.6); }

  syncLighting(vp: ColonyViewport, kind: PlanetKind, isNightPreview: boolean) {
    if (isNightPreview) {
      vp.sun.color.setHex(0x4cc9f0);
      vp.sun.intensity = 0.22;
      vp.hemi.color.setHex(0x162844);
      vp.hemi.groundColor.setHex(0x050811);
      vp.hemi.intensity = 0.14;
      vp.scene.environmentIntensity = 0.16;
      if (vp.scene.background instanceof THREE.Color) vp.scene.background.setHex(0x060a14);
      if (vp.scene.fog instanceof THREE.FogExp2) vp.scene.fog.color.setHex(0x060a14);
    } else {
      vp.applySky(PLANET_SPECS[kind]);
    }
  }
}
