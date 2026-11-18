import * as THREE from 'three';
import { ensureSecondaryShadowLight, isShadowOn, setDescentSunDirection } from '@terra/render/core/shadowConfig';
import { getColonyVisionUniforms, setColonyLightingBlend } from '@terra/render/lighting/ColonyVisionAndLights';
import type { PlanetSpec } from '@terra/render/planets/PlanetSpec';
import { createPlanetGlobe, type PlanetGlobe } from '@terra/render/planets/PlanetGlobe';
import { createSpaceBackdrop, type SpaceBackdrop } from '@terra/render/visuals/space/SpaceBackdrop';
import { lerp, smoothstep, smoother } from '../math';
import { createCloudDeck, type CloudDeck } from '../fx/CloudDeck';
import { DECK, FOGMAX, R } from '../constants';
import {
  computeSpaceEntrySolar,
  createSpaceEntrySolar,
  DescentSolarEvaluator,
  SPACE_HEMI,
  SPACE_HEMI_GROUND,
  SPACE_SUN,
  SPACE_SUN_INTENSITY,
  type DescentSolarTarget,
  type SpaceEntrySolar,
} from './descentSolarSync';
import type { DescentContext, FramePart, FrameState } from './FrameState';

export { SPACE_HEMI, SPACE_HEMI_GROUND, SPACE_SUN, SPACE_SUN_INTENSITY };

/** Makes sure the scene has a colour background + exponential fog the descent can drive. */
export function prepareSceneSky(scene: THREE.Scene, spec: DescentContext['spec']) {
  if (!(scene.background instanceof THREE.Color)) scene.background = new THREE.Color(0x000000);
  if (!(scene.fog instanceof THREE.FogExp2)) scene.fog = new THREE.FogExp2(spec.sky.fogColor, spec.sky.fogDensity);
}

/** Slerps unit directions `a -> b` without collapsing through zero when nearly antipodal. */
function slerpUnitDir(a: THREE.Vector3, b: THREE.Vector3, t: number, out: THREE.Vector3): THREE.Vector3 {
  if (t <= 0) return out.copy(a);
  if (t >= 1) return out.copy(b);
  const dot = THREE.MathUtils.clamp(a.dot(b), -1, 1);
  const theta = Math.acos(dot);
  if (theta < 1e-4) return out.copy(a).lerp(b, t).normalize();
  const sinT = Math.sin(theta);
  if (sinT < 1e-4) {
    out.set(a.z || 0.7, 0, -a.x || 0.7).normalize();
    return t < 0.5
      ? out.multiplyScalar(Math.sin(t * Math.PI)).addScaledVector(a, Math.cos(t * Math.PI)).normalize()
      : out.multiplyScalar(Math.sin(t * Math.PI)).addScaledVector(b, -Math.cos(t * Math.PI)).normalize();
  }
  const wa = Math.sin((1 - t) * theta) / sinT;
  const wb = Math.sin(t * theta) / sinT;
  return out.set(a.x * wa + b.x * wb, a.y * wa + b.y * wb, a.z * wa + b.z * wb).normalize();
}

/** Starfield/space → atmosphere sky, the planet globe, the cloud deck, fog and the scene lights, synced to Day/Night. */
export class SkyRig implements FramePart {
  readonly globe: PlanetGlobe;
  readonly solarEval = new DescentSolarEvaluator();
  private backdrop: SpaceBackdrop;
  private deck: CloudDeck;
  private saved: { bloom: number; envI: number };
  private bg: THREE.Color; private fog: THREE.FogExp2;
  private atmCol: THREE.Color; private cloudCol: THREE.Color;
  private tmp = new THREE.Vector3();
  private tmpSun = new THREE.Vector3();
  private tmpKeySun = new THREE.Vector3();
  private tmpAtmBand = new THREE.Color();
  private tmpBounce = new THREE.Color();
  private spaceSolar = createSpaceEntrySolar();

  constructor(private ctx: DescentContext) {
    const { spec, viewport, scene, sunDir, traj, root } = ctx, o = spec.orbital;
    this.saved = { bloom: viewport.bloom.strength, envI: scene.environmentIntensity };
    this.bg = scene.background as THREE.Color; this.fog = scene.fog as THREE.FogExp2;
    this.atmCol = new THREE.Color(o.atmosphereColor);
    this.cloudCol = new THREE.Color(o.cloudColor);

    this.backdrop = createSpaceBackdrop({
      seed: spec.seed,
      sunDir,
      nebulaA: new THREE.Color(o.atmosphereColor).lerp(new THREE.Color(0x2a3f9a), 0.55),
      nebulaB: 0x3a2a8a,
    });
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

  reset() { this.solarEval.reset(); }

  syncEntrySun(sunDir: THREE.Vector3) {
    this.globe.setSunDirection(sunDir);
    this.deck.u.uSun.value.copy(sunDir);
    this.backdrop.uniforms.uSunDir.value.copy(sunDir);
  }

  setPlanetSpec(spec: PlanetSpec) {
    this.ctx.spec = spec;
    this.ctx.dens = spec.orbital.atmosphereDensity;
    this.atmCol.set(spec.orbital.atmosphereColor);
    this.cloudCol.set(spec.orbital.cloudColor);
  }

  update(f: FrameState) {
    const target = f.solar ?? this.solarEval.evaluate(this.ctx.spec);
    const space = computeSpaceEntrySolar(target, this.saved.bloom, this.spaceSolar);
    if (!this.ctx.globeAligned) {
      this.ctx.sunDir.copy(space.entrySunDir);
    }
    const kTerm = smoother(9.1, 14.8, f.tn);
    slerpUnitDir(this.ctx.sunDir, target.astroSunDir, kTerm, this.tmpSun);
    this.updateBackdrop(f, target, space);
    this.updateFogAndGlobe(f, target, space, kTerm);
    this.updateLights(f, target, space);
  }

  private updateBackdrop(f: FrameState, target: DescentSolarTarget, space: SpaceEntrySolar) {
    const tn = f.tn, { dens, camera } = this.ctx, { uniforms } = this.backdrop;
    const camAlt = Math.max(f.camPos.y, 1);
    const kSky = smoothstep(24.5, 30.5, tn);
    const spaceStars = 1 - smoothstep(15.5, 21.5, tn);
    const nightStars = 0.28 * target.nightFactor * (1 - f.cb) * (1 - kSky);
    uniforms.uSpace.value = Math.max(spaceStars, nightStars);

    const nightUmbra = 1 - 0.88 * target.nightFactor;
    this.tmpAtmBand.copy(this.atmCol).multiplyScalar(nightUmbra);
    const toSky = smoothstep(14.0, 21.5, tn);
    uniforms.uZenith.value.copy(this.tmpAtmBand).multiplyScalar(0.22).lerp(target.skyTop, toSky).lerp(target.skyHorizon, kSky);
    uniforms.uHorizon.value.copy(this.tmpAtmBand).lerp(target.skyHorizon, toSky);
    uniforms.uHorizonH.value = -Math.sin(Math.acos(R / (R + camAlt))) * (1 - kSky);
    uniforms.uBandUp.value = 0.35 * smoothstep(8, 19, tn);
    const bandDay = 0.16 + 0.84 * Math.max(target.daylight, target.twilight * 0.9);
    uniforms.uBandI.value = 0.9 * dens * bandDay * smoothstep(7, 12, tn) * (1 - smoothstep(20, 25, tn));
    uniforms.uBandColor.value.copy(this.tmpAtmBand);
    uniforms.uSunDir.value.copy(this.tmpSun);
    uniforms.uSunColor.value.copy(space.sunColor).lerp(target.sunColor, smoothstep(9.0, 16.0, tn));
    uniforms.uSunDisc.value = (1 - smoothstep(22, 28, tn)) * lerp(space.spaceLit, target.daylight, smoothstep(9.0, 15.0, tn));
    uniforms.uCloud.value = f.cb * 0.9;
    uniforms.uCloudColor.value.copy(target.hazeColor);
    uniforms.uNebI.value = 0.3;
    this.backdrop.update(camera, tn);
  }

  private updateFogAndGlobe(f: FrameState, target: DescentSolarTarget, space: SpaceEntrySolar, kTerm: number) {
    const tn = f.tn, { spec, surface } = this.ctx, { fog, globe } = this;
    const camAlt = Math.max(f.camPos.y, 1);
    const kSky = smoothstep(24.5, 30.5, tn);
    globe.setSunDirection(this.tmpSun);

    this.bg.copy(target.skyHorizon);
    fog.color.copy(target.hazeColor).lerp(target.skyHorizon, kSky);
    const dRamp = smoothstep(14, 19, tn) * FOGMAX;
    fog.density = (tn < 22 ? dRamp : lerp(FOGMAX, spec.sky.fogDensity, smoother(22, 30.5, tn))) * (1 + 3 * f.cb);
    if (tn >= 30.5) fog.density = spec.sky.fogDensity;
    surface.group.visible = tn >= 19;

    globe.setOpacity(1 - smoothstep(27, 30.5, tn));
    const toFog = smoothstep(19, 26.5, tn);
    globe.shared.uSkyBlend.value = Math.min(1, smoothstep(15, 23, tn) * 0.9 + 0.1 * toFog);
    globe.shared.uSkyColor.value.copy(this.backdrop.uniforms.uHorizon.value).lerp(fog.color, toFog);
    globe.shared.uHazeDist.value.set(lerp(100, 20, toFog), lerp(9000, 260, toFog));
    globe.shared.uCloudNear.value.set(40, 500);
    globe.shared.uAtmStrength.value = smoothstep(140, 420, camAlt) * (1 - 0.65 * target.nightFactor * Math.max(1 - space.spaceLit, kTerm));
    globe.shared.uTime.value = tn;

    this.deck.group.visible = tn > 14;
    this.deck.u.uVis.value = smoothstep(16, 21, tn);
    this.deck.u.uSun.value.copy(this.tmpSun);
    this.deck.u.uColor.value.copy(this.cloudCol).lerp(target.cloudColor, smoother(13.5, 19.0, tn));
    this.deck.u.uCentre.value.set(f.podCenter.x, f.podCenter.z);
    this.deck.u.uTime.value = tn;
  }

  private updateLights(f: FrameState, target: DescentSolarTarget, space: SpaceEntrySolar) {
    const tn = f.tn, { viewport, scene, sunDir } = this.ctx;
    const kAtmo = smoother(12.5, 18.8, tn);
    slerpUnitDir(sunDir, target.keySunDir, kAtmo, this.tmpKeySun);
    setDescentSunDirection(viewport, this.tmpKeySun);

    viewport.sun.color.copy(space.sunColor).lerp(target.sunColor, kAtmo);
    viewport.sun.intensity = lerp(space.sunIntensity, target.sunIntensity, kAtmo);
    const sec = ensureSecondaryShadowLight(viewport);
    sec.color.setHex(0x9cc4ff);
    sec.intensity = lerp(0, target.secondaryIntensity, kAtmo);

    const shadowOn = isShadowOn();
    viewport.sun.shadow.intensity = shadowOn ? lerp(1.05 * space.spaceLit, target.primaryShadowIntensity, kAtmo) : 0;
    viewport.sun.shadow.radius = lerp(1.3, target.sunShadowRadius, kAtmo);
    viewport.sun.shadow.autoUpdate = viewport.sun.shadow.intensity > 0 || viewport.sun.shadow.map === null;
    sec.shadow.intensity = shadowOn ? lerp(0, target.secondaryShadowIntensity, kAtmo) : 0;
    sec.shadow.autoUpdate = sec.shadow.intensity > 0 || sec.shadow.map === null;

    // High-altitude plasma sheath bounce onto pod belly (fades before ground fills the frame; local retro uses GroundFx.light)
    const pyreGlow = 1.15 * f.plasmaI * (1 - smoothstep(18.5, 22.5, tn));
    this.tmpBounce.copy(space.hemiGround).lerp(target.hemiGround, kAtmo);
    if (pyreGlow > 0.005) {
      this.tmpBounce.r += 0.85 * pyreGlow;
      this.tmpBounce.g += 0.34 * pyreGlow;
      this.tmpBounce.b += 0.08 * pyreGlow;
    }
    viewport.hemi.color.copy(space.hemiColor).lerp(target.hemiSky, kAtmo);
    viewport.hemi.groundColor.copy(this.tmpBounce);
    viewport.hemi.intensity = lerp(space.hemiIntensity, target.hemiIntensity, kAtmo) + 0.35 * pyreGlow;
    viewport.renderer.toneMappingExposure = lerp(space.exposure, target.exposure, smoother(18, 28, tn));
    scene.environmentIntensity = lerp(space.envIntensity, target.envIntensity, kAtmo);
    const retroBloom = 0.05 * f.thr * (1 - smoothstep(30.2, 31.8, tn));
    viewport.bloom.strength = lerp(space.bloom, target.bloomStrength, kAtmo) + 0.08 * f.P + retroBloom;

    const kNight = smoother(13.5, 19.0, tn);
    setColonyLightingBlend(kNight);
    getColonyVisionUniforms().uNightFactor.value = target.shaderNightFactor * kNight;

    viewport.followShadow(this.tmp.copy(f.podCenter));
  }

  /** Restore scene lighting/sky to the gameplay state. */
  restore() {
    const { scene, viewport, spec, traj } = this.ctx;
    setColonyLightingBlend(1);
    scene.environmentIntensity = this.saved.envI;
    viewport.bloom.strength = this.saved.bloom;
    viewport.applySky(spec);
    viewport.followShadow(traj.L);
  }

  dispose() { this.backdrop.dispose(); this.globe.dispose(); this.deck.dispose(); }
}
