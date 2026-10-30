import * as THREE from 'three';
import { createPlanetGlobe, type PlanetGlobe } from '@terra/render/planets/PlanetGlobe';
import { createSpaceBackdrop, type SpaceBackdrop } from '@terra/render/visuals/space/SpaceBackdrop';
import { lerp, smoothstep, smoother } from '../math';
import { createCloudDeck, type CloudDeck } from '../fx/CloudDeck';
import { DECK, FOGMAX, R } from '../constants';
import type { DescentContext, FramePart, FrameState } from './FrameState';

/** Space-side lighting the descent starts from (and the menu stage converges to at the hand-off). */
export const SPACE_SUN = new THREE.Color(1.0, 0.96, 0.88);
export const SPACE_HEMI = new THREE.Color(0.45, 0.55, 0.85);
export const SPACE_HEMI_GROUND = new THREE.Color(0.04, 0.04, 0.07);
export const SPACE_SUN_INTENSITY = 3.4;

/** Makes sure the scene has a colour background + exponential fog the descent can drive. */
export function prepareSceneSky(scene: THREE.Scene, spec: DescentContext['spec']) {
  if (!(scene.background instanceof THREE.Color)) scene.background = new THREE.Color(0x000000);
  if (!(scene.fog instanceof THREE.FogExp2)) scene.fog = new THREE.FogExp2(spec.sky.fogColor, spec.sky.fogDensity);
}

/** Starfield/space → atmosphere sky, the planet globe, the cloud deck, fog and the scene lights, blended over the timeline. */
export class SkyRig implements FramePart {
  readonly globe: PlanetGlobe;
  private backdrop: SpaceBackdrop;
  private deck: CloudDeck;
  private saved: { bloom: number; envI: number };
  private bg: THREE.Color; private fog: THREE.FogExp2;
  private atmCol: THREE.Color; private cloudCol: THREE.Color; private haze: THREE.Color;
  private skyZ: THREE.Color; private skyH: THREE.Color; private fogC: THREE.Color; private sunC: THREE.Color; private hemiC: THREE.Color; private hemiG: THREE.Color;
  private tmp = new THREE.Vector3();

  constructor(private ctx: DescentContext) {
    const { spec, viewport, scene, sunDir, traj, root } = ctx, o = spec.orbital;
    this.saved = { bloom: viewport.bloom.strength, envI: scene.environmentIntensity };
    this.bg = scene.background as THREE.Color; this.fog = scene.fog as THREE.FogExp2;
    this.atmCol = new THREE.Color(o.atmosphereColor);
    this.cloudCol = new THREE.Color(o.cloudColor);
    this.skyZ = new THREE.Color(spec.sky.skyColor); this.skyH = new THREE.Color(spec.sky.horizonColor);
    this.fogC = new THREE.Color(spec.sky.fogColor); this.sunC = new THREE.Color(spec.sky.sunColor);
    this.hemiC = new THREE.Color(spec.sky.ambientSky ?? spec.sky.skyColor); this.hemiG = new THREE.Color(spec.sky.ambientGround ?? spec.sky.hemiGround);
    this.haze = new THREE.Color(spec.sky.horizonColor).lerp(this.cloudCol, 0.5);

    this.backdrop = createSpaceBackdrop({ seed: spec.seed, sunDir, nebulaA: new THREE.Color(o.atmosphereColor).lerp(new THREE.Color(0x2a3f9a), 0.55), nebulaB: 0x3a2a8a });
    root.add(this.backdrop.group);
    this.globe = createPlanetGlobe(spec, { radius: R, segments: 160, cloudScale: 1 + DECK / R, atmScale: 1.035 });
    this.globe.group.position.copy(traj.C);
    this.globe.setSunDirection(sunDir);
    this.globe.spin.rotation.set(1.0, 2.2, 0.0); // landing site (world +Y) maps to a mid-latitude point, not the polar cap
    this.globe.group.rotation.set(0, 0, 0);
    root.add(this.globe.group);
    this.deck = createCloudDeck(DECK, Math.max(o.cloudCover, 0.3), this.cloudCol);
    this.deck.u.uSun.value.copy(sunDir);
    root.add(this.deck.group);
  }

  get savedBloom() { return this.saved.bloom; }

  update(f: FrameState) {
    this.updateBackdrop(f);
    this.updateFogAndGlobe(f);
    this.updateLights(f);
  }

  private updateBackdrop(f: FrameState) {
    const tn = f.tn, { dens, camera } = this.ctx, { uniforms } = this.backdrop, atmCol = this.atmCol;
    const camAlt = Math.max(f.camPos.y, 1);
    const kSky = smoothstep(26, 31, tn);
    uniforms.uSpace.value = 1 - smoothstep(15.5, 21, tn);
    const toSky = smoothstep(17, 25, tn);
    uniforms.uZenith.value.copy(atmCol).multiplyScalar(0.22).lerp(this.skyZ, toSky).lerp(this.fogC, kSky);
    uniforms.uHorizon.value.copy(atmCol).lerp(this.skyH, toSky).lerp(this.fogC, kSky);
    uniforms.uHorizonH.value = -Math.sin(Math.acos(R / (R + camAlt))) * (1 - kSky);
    uniforms.uBandUp.value = 0.35 * smoothstep(8, 19, tn);
    uniforms.uBandI.value = 0.9 * dens * smoothstep(7, 12, tn) * (1 - smoothstep(21, 26, tn));
    uniforms.uBandColor.value.copy(atmCol);
    uniforms.uSunDisc.value = 1 - smoothstep(24, 30, tn);
    uniforms.uCloud.value = f.cb * 0.9;
    uniforms.uCloudColor.value.copy(this.haze);
    uniforms.uNebI.value = 0.3;
    this.backdrop.update(camera, tn);
  }

  private updateFogAndGlobe(f: FrameState) {
    const tn = f.tn, { spec, surface } = this.ctx, { fog, globe } = this;
    const camAlt = Math.max(f.camPos.y, 1);
    const kSky = smoothstep(26, 31, tn);
    this.bg.copy(this.fogC);
    fog.color.copy(this.haze).lerp(this.fogC, kSky);
    const dRamp = smoothstep(14, 19, tn) * FOGMAX;
    fog.density = (tn < 22 ? dRamp : lerp(FOGMAX, spec.sky.fogDensity, smoother(22, 31, tn))) * (1 + 3 * f.cb);
    if (tn >= 31) fog.density = spec.sky.fogDensity;
    surface.group.visible = tn >= 19;

    globe.setOpacity(1 - smoothstep(27, 31, tn));
    // once the surface patch is visible the globe around it must dissolve into exactly the fog colour the patch's
    // edge fades to — otherwise the patch boundary reads as a square/ring against the globe
    const toFog = smoothstep(20, 27, tn);
    globe.shared.uSkyBlend.value = Math.min(1, smoothstep(16, 24, tn) * 0.9 + 0.1 * toFog);
    globe.shared.uSkyColor.value.copy(this.backdrop.uniforms.uHorizon.value).lerp(fog.color, toFog);
    globe.shared.uHazeDist.value.set(lerp(100, 20, toFog), lerp(9000, 260, toFog));
    globe.shared.uCloudNear.value.set(40, 500);
    globe.shared.uAtmStrength.value = smoothstep(140, 420, camAlt);
    globe.shared.uTime.value = tn;

    this.deck.group.visible = tn > 14;
    this.deck.u.uVis.value = smoothstep(16, 21, tn);
    this.deck.u.uCentre.value.set(f.podCenter.x, f.podCenter.z); this.deck.u.uTime.value = tn;
  }

  private updateLights(f: FrameState) {
    const tn = f.tn, { viewport, scene, spec } = this.ctx;
    const kSky = smoothstep(26, 31, tn);
    viewport.sun.color.copy(SPACE_SUN).lerp(this.sunC, kSky);
    viewport.sun.intensity = lerp(SPACE_SUN_INTENSITY, spec.sky.sunIntensity, kSky);
    viewport.hemi.color.copy(SPACE_HEMI).lerp(this.hemiC, kSky);
    viewport.hemi.groundColor.copy(SPACE_HEMI_GROUND).lerp(this.hemiG, kSky);
    viewport.hemi.intensity = lerp(0.3, spec.sky.hemiIntensity, kSky);
    viewport.renderer.toneMappingExposure = lerp(1.0, spec.sky.exposure, kSky);
    scene.environmentIntensity = lerp(0.3, this.saved.envI, smoothstep(20, 30, tn));
    viewport.bloom.strength = this.saved.bloom + 0.08 * f.P + 0.06 * f.thr;
    viewport.followShadow(this.tmp.copy(f.podCenter));
  }

  /** Restore scene lighting/sky to the gameplay state. */
  restore() {
    const { scene, viewport, spec, traj } = this.ctx;
    scene.environmentIntensity = this.saved.envI;
    viewport.bloom.strength = this.saved.bloom;
    viewport.applySky(spec);
    viewport.followShadow(traj.L);
  }

  dispose() { this.backdrop.dispose(); this.globe.dispose(); this.deck.dispose(); }
}
