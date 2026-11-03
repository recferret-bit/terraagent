import * as THREE from 'three';
import type { ColonyViewport } from './createColonyViewport';
import {
  applyDayNightAtmosphere,
  computeSolarState,
  getDayNightParams,
  hasViewportPlanetSurface,
  isDayNightOn,
  isViewportInDescent,
  onDayNightChange,
  stepStandaloneDayNight,
} from './dayNightConfig';
import { daySecondaryShadowFade, fitShadowBox, nightSunShadowFade, type ShadowFit } from './shadowFit';
import { onPerfChange, skipDaySecondaryShadow, skipNightSunShadow } from './perfConfig';
import type { ViewFocus } from './viewFocus';

const KEY = 'terraagent.shadow';
const PARAMS_KEY = 'terraagent.shadow.params.v7';
const SUN_DIST = 72;

export interface ShadowParams {
  sunAzimuth: number;            // 0..360 deg
  sunElevation: number;          // 8..85 deg
  sunOrbitSpeed: number;         // 0..30 deg/s
  shadowIntensity: number;       // 0..1.6
  shadowSoftness: number;        // 0.2..4.0
  mapSize: number;               // 512 | 1024 | 2048 | 4096
  frustumSize: number;           // 18..90 m
  normalBias: number;            // 0..0.10
  shadowBias: number;            // -0.0030..0.0005
  sunIntensity: number;          // 0.2..4.5
  ambientIntensity: number;      // 0.1..1.8
  bloomStrength: number;         // 0..1.5
  weatheringIntensity: number;   // 0..1.5 multiplier
  rimStrength: number;           // 0..0.8
  shadowSourceMode: number;      // 0=Sun+Night Moon, 1=Dual Sun+Colony Fill, 2=Night Projector Only, 3=Sun Only
  secondaryShadowEnabled: number;// 0 | 1
  nightShadowIntensity: number;  // 0..1.6 (default 0.72)
  secondaryAzimuthDeg: number;   // -180..180 deg (default -55)
  secondaryElevationDeg: number; // 8..85 deg (default 38)
  secondaryIntensity: number;    // 0..3.5 (default 1.35)
}

export type ShadowConfig = ShadowParams;

export const DEFAULT_SHADOW_PARAMS: Readonly<ShadowParams> = {
  sunAzimuth: 318,
  sunElevation: 28,
  sunOrbitSpeed: 0,
  shadowIntensity: 1.18,
  shadowSoftness: 1.15,
  mapSize: 2048,
  frustumSize: 60,
  normalBias: 0.006,
  shadowBias: -0.00005,
  sunIntensity: 2.25,
  ambientIntensity: 0.58,
  bloomStrength: 0.4,
  weatheringIntensity: 1.0,
  rimStrength: 0.28,
  shadowSourceMode: 0,
  secondaryShadowEnabled: 1,
  nightShadowIntensity: 0.72,
  secondaryAzimuthDeg: -55,
  secondaryElevationDeg: 38,
  secondaryIntensity: 1.35,
};

function readInitialShadowOn(): boolean {
  try {
    const q = new URLSearchParams(location.search).get('shadow');
    if (q === '0' || q === 'false') return false;
    if (q === '1' || q === 'true') return true;
    const saved = localStorage.getItem(KEY);
    return saved === null ? true : saved === '1';
  } catch { return true; }
}

function snapMapSize(v: number): number {
  if (v <= 768) return 512;
  if (v <= 1536) return 1024;
  if (v <= 3072) return 2048;
  return 4096;
}

function readInitialShadowParams(): ShadowParams {
  try {
    const raw = localStorage.getItem(PARAMS_KEY);
    if (!raw) return { ...DEFAULT_SHADOW_PARAMS };
    const parsed = { ...DEFAULT_SHADOW_PARAMS, ...JSON.parse(raw) } as ShadowParams;
    parsed.mapSize = snapMapSize(parsed.mapSize);
    return parsed;
  } catch { return { ...DEFAULT_SHADOW_PARAMS }; }
}

let on = readInitialShadowOn();
let params: ShadowParams = readInitialShadowParams();
let manualSunAngles = false;
const listeners = new Set<(on: boolean, params: ShadowParams) => void>();
const colonyUniformListeners = new Set<(weatheringMul: number, rimStrength: number) => void>();

interface TrackedViewport {
  vp: ColonyViewport;
  lastTarget: THREE.Vector3;
  baseSunColor: THREE.Color;
  lastTickMs: number;
  /** This viewport's view focus of the last rendered frame (null until `fitShadowToView`). */
  focus: ViewFocus | null;
  /** Shadow blur radii as tuned for the user box; scaled by box ratio so the world-space penumbra stays the same. */
  sunRadius?: number;
  secRadius?: number;
}

import { installShadowShaderPatch } from './shadowShaderPatch';
export { installShadowShaderPatch };

const viewports = new Map<ColonyViewport, TrackedViewport>();

export function computeSunOffset(out = new THREE.Vector3(), p?: Readonly<ShadowParams>): THREE.Vector3 {
  const sp = p ?? params;
  const useDayNight = p === undefined && isDayNightOn() && !manualSunAngles && sp.sunOrbitSpeed <= 0.01;
  const solar = useDayNight ? computeSolarState(getDayNightParams(), sp.sunAzimuth, sp.sunElevation) : null;
  const elevDeg = solar ? solar.sunElevation : sp.sunElevation;
  const azimDeg = solar ? solar.sunAzimuth : sp.sunAzimuth;
  const elev = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(elevDeg, 5, 88));
  const azim = THREE.MathUtils.degToRad(azimDeg);
  const horiz = Math.cos(elev) * SUN_DIST;
  return out.set(Math.cos(azim) * horiz, Math.sin(elev) * SUN_DIST, Math.sin(azim) * horiz);
}

export function computeSecondaryOffset(out = new THREE.Vector3(), p: Readonly<ShadowParams> = params): THREE.Vector3 {
  const elev = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(p.secondaryElevationDeg, 5, 88));
  const azim = THREE.MathUtils.degToRad(p.secondaryAzimuthDeg);
  const horiz = Math.cos(elev) * SUN_DIST;
  return out.set(Math.cos(azim) * horiz, Math.sin(elev) * SUN_DIST, Math.sin(azim) * horiz);
}

export function ensureSecondaryShadowLight(vp: ColonyViewport): THREE.DirectionalLight {
  if (vp.secondaryShadowLight) return vp.secondaryShadowLight;
  const existing = vp.scene.getObjectByName('secondaryShadowLight') as THREE.DirectionalLight | undefined;
  if (existing) {
    vp.secondaryShadowLight = existing;
    return existing;
  }
  const sec = new THREE.DirectionalLight(0x9cc4ff, params.secondaryIntensity);
  sec.name = 'secondaryShadowLight';
  sec.castShadow = on && params.secondaryShadowEnabled >= 0.5;
  sec.shadow.mapSize.set(1024, 1024);
  sec.shadow.camera.near = 8;
  sec.shadow.camera.far = 138;
  const d = Math.max(12, params.frustumSize);
  Object.assign(sec.shadow.camera, { left: -d, right: d, top: d, bottom: -d });
  sec.shadow.camera.updateProjectionMatrix();
  vp.scene.add(sec, sec.target);
  vp.secondaryShadowLight = sec;
  return sec;
}

const tmpOffset = new THREE.Vector3();
const tmpSecOffset = new THREE.Vector3();
const tmpDir = new THREE.Vector3();
const tmpRight = new THREE.Vector3();
const tmpUp = new THREE.Vector3();
const worldUp = new THREE.Vector3(0, 1, 0);
const warmTint = new THREE.Color(0xff8e47);

function placeQuantizedShadowLight(
  light: THREE.DirectionalLight,
  target: THREE.Vector3,
  offset: THREE.Vector3,
  frustumSize: number,
  mapSize: number,
): void {
  tmpDir.copy(offset).normalize();
  tmpRight.crossVectors(worldUp, tmpDir);
  if (tmpRight.lengthSq() < 1e-5) tmpRight.set(1, 0, 0);
  else tmpRight.normalize();
  tmpUp.crossVectors(tmpDir, tmpRight).normalize();

  const texelWorld = (2 * Math.max(10, frustumSize)) / Math.max(256, mapSize);
  const step = Math.max(0.02, texelWorld * 2);
  const u = Math.round(target.dot(tmpRight) / step) * step;
  const v = Math.round(target.dot(tmpUp) / step) * step;
  const w = Math.round(target.dot(tmpDir) / 0.5) * 0.5;

  const tx = tmpRight.x * u + tmpUp.x * v + tmpDir.x * w;
  const ty = tmpRight.y * u + tmpUp.y * v + tmpDir.y * w;
  const tz = tmpRight.z * u + tmpUp.z * v + tmpDir.z * w;

  light.target.position.set(tx, ty, tz);
  light.position.set(tx + offset.x, ty + offset.y, tz + offset.z);
  light.target.updateMatrixWorld();
  light.updateMatrixWorld();
}

/** Per viewport: the descent cinematic's sun direction (unit), used instead of the solar clock while it renders. */
const descentSunDirs = new WeakMap<ColonyViewport, THREE.Vector3>();

/**
 * The descent lights its globe, clouds and canopy from its own sun (`DescentRunner` `ctx.sunDir`); the key light must
 * come from there too, or the pod is back-lit over a sunlit planet. `null` when the descent ends (solar clock again).
 */
export function setDescentSunDirection(vp: ColonyViewport, dir: Readonly<THREE.Vector3> | null): void {
  if (!vp) return;
  if (dir) descentSunDirs.set(vp, new THREE.Vector3().copy(dir).normalize());
  else descentSunDirs.delete(vp);
}

const fit: ShadowFit = { x: 0, z: 0, half: 0 };
const tmpCentre = new THREE.Vector3();

function setShadowBox(light: THREE.DirectionalLight, d: number): void {
  const cam = light.shadow.camera;
  if (cam.left === -d && cam.right === d && cam.top === d && cam.bottom === -d) return;
  Object.assign(cam, { left: -d, right: d, top: d, bottom: -d });
  cam.updateProjectionMatrix();
}

/**
 * Quantizes the shadow frustum target in light-space texel steps so panning never causes shadow swimming or 1m jumps.
 * Once the viewport rendered a frame, the box is fitted to the visible ground (`fitShadowBox`, view focus); during
 * descent, with `?focus=0` or before the first frame it is the user `frustumSize` box around `target`.
 */
export function followShadowTarget(vp: ColonyViewport, target: THREE.Vector3): void {
  const rec = viewports.get(vp);
  if (rec) rec.lastTarget.copy(target);
  const focus = rec && !isViewportInDescent(vp) ? rec.focus : null;
  const d = Math.max(12, params.frustumSize);
  fitShadowBox(focus, target.x, target.z, d, fit);
  tmpCentre.set(fit.x, target.y, fit.z);
  const sec = ensureSecondaryShadowLight(vp);
  setShadowBox(vp.sun, fit.half);
  setShadowBox(sec, fit.half);
  const blur = d / fit.half;
  if (rec?.sunRadius !== undefined) vp.sun.shadow.radius = rec.sunRadius * blur;
  if (rec?.secRadius !== undefined) sec.shadow.radius = rec.secRadius * blur;

  const descentSun = isViewportInDescent(vp) ? descentSunDirs.get(vp) : undefined;
  if (descentSun) tmpOffset.copy(descentSun).multiplyScalar(SUN_DIST);
  else computeSunOffset(tmpOffset, hasViewportPlanetSurface(vp) ? undefined : params);
  placeQuantizedShadowLight(vp.sun, tmpCentre, tmpOffset, fit.half, params.mapSize);
  computeSecondaryOffset(tmpSecOffset, params);
  placeQuantizedShadowLight(sec, tmpCentre, tmpSecOffset, fit.half, Math.min(2048, snapMapSize(params.mapSize)));

  const dome = vp.scene.getObjectByName('planetSkyDome') as THREE.Mesh | undefined;
  const uSun = (dome?.material as THREE.ShaderMaterial | undefined)?.uniforms?.uSun;
  if (uSun?.value) (uSun.value as THREE.Vector3).copy(tmpOffset);
}

/** Per frame, after `updateViewFocus`: refits this viewport's sun + secondary shadow boxes to what its camera sees. */
export function fitShadowToView(vp: ColonyViewport, focus: Readonly<ViewFocus>): void {
  const rec = viewports.get(vp);
  if (!rec) return;
  rec.focus = { ...focus };
  followShadowTarget(vp, rec.lastTarget);
}

function syncDirectionalShadowFrustum(light: THREE.DirectionalLight, mapSz: number, d: number): void {
  light.shadow.normalBias = params.normalBias;
  light.shadow.bias = params.shadowBias;
  if (light.shadow.mapSize.x !== mapSz || light.shadow.mapSize.y !== mapSz) {
    light.shadow.mapSize.set(mapSz, mapSz);
    if (light.shadow.map) {
      light.shadow.map.dispose();
      light.shadow.map = null;
    }
  }
  const cam = light.shadow.camera;
  if (cam.left !== -d || cam.right !== d || cam.top !== d || cam.bottom !== -d || cam.near !== 8 || cam.far !== 138) {
    cam.left = -d;
    cam.right = d;
    cam.top = d;
    cam.bottom = -d;
    cam.near = 8;
    cam.far = 138;
    cam.updateProjectionMatrix();
  }
}

function applyShadowSourceMode(
  sun: THREE.DirectionalLight,
  sec: THREE.DirectionalLight,
  moon: Readonly<MoonBlend>,
  primaryShadowInt: number,
): void {
  const mode = Math.round(THREE.MathUtils.clamp(params.shadowSourceMode, 0, 3));
  const secActive = on && params.secondaryShadowEnabled >= 0.5 && mode !== 3;
  sec.color.setHex(0x9cc4ff);
  sec.shadow.autoUpdate = true;
  sun.shadow.autoUpdate = true;
  sec.shadow.radius = params.shadowSoftness;

  if (mode === 3 || !secActive) {
    sun.castShadow = on;
    sun.shadow.intensity = on ? primaryShadowInt : 0;
    sec.castShadow = false;
    sec.intensity = 0;
    sec.shadow.intensity = 0;
    return;
  }
  if (mode === 2) {
    sun.castShadow = false;
    sun.shadow.intensity = 0;
    sec.castShadow = true;
    sec.intensity = params.secondaryIntensity;
    sec.shadow.intensity = THREE.MathUtils.clamp(params.nightShadowIntensity, 0, 1.6);
    return;
  }
  if (mode === 1) {
    sun.castShadow = on;
    sun.shadow.intensity = on ? Math.max(primaryShadowInt, params.nightShadowIntensity * 0.5) : 0;
    sec.castShadow = true;
    sec.intensity = params.secondaryIntensity;
    sec.shadow.intensity = THREE.MathUtils.clamp(Math.max(params.nightShadowIntensity, params.shadowIntensity * 0.65), 0, 1.6);
    return;
  }
  // Mode 0: Sun + Night Moon. By day the secondary is a faint cool fill (18% light, 15% shadow); toward night it
  // blends continuously (by 1 - daylight, no threshold pop at the horizon) to the dim moon that NIGHT MOONLIGHT
  // sets. It used to jump to the full secondaryIntensity + nightShadowIntensity at night: a second sun with
  // daytime-crisp shadows. castShadow stays constant across the day so dawn/dusk never recompile shaders.
  const t = THREE.MathUtils.clamp(moon.night, 0, 1);
  sun.castShadow = on;
  // F8 → PERF: at night the sun's faint shadow fades out and its map stops rendering, so only the moon casts
  // (two soft-shadow filters per pixel for a ~6 % darkening was 20 % of a night frame at 4K).
  sun.shadow.intensity = on ? primaryShadowInt * nightSunShadowFade(t, skipNightSunShadow()) : 0;
  sun.shadow.autoUpdate = sun.shadow.intensity > 0 || sun.shadow.map === null;
  sec.castShadow = true;
  sec.intensity = params.secondaryIntensity * THREE.MathUtils.lerp(0.18, moon.intensityMult, t);
  // F8 → PERF: the faint daytime secondary shadow fades out by day and its map stops rendering (map kept once made).
  sec.shadow.intensity = THREE.MathUtils.clamp(params.nightShadowIntensity * THREE.MathUtils.lerp(0.15, moon.shadowMult, t)
    * daySecondaryShadowFade(t, skipDaySecondaryShadow()), 0, 1.6);
  sec.shadow.autoUpdate = sec.shadow.intensity > 0 || sec.shadow.map === null;
}

/** How far toward night the secondary moon is (`1 - daylight`) and its deep-night targets (`computeMoonMults`). */
interface MoonBlend {
  night: number;
  intensityMult: number;
  shadowMult: number;
}

const DAY_MOON: Readonly<MoonBlend> = { night: 0, intensityMult: 0.18, shadowMult: 0.15 };

export function syncViewportShadow(vp: ColonyViewport, baseSunColor?: number): void {
  const rec = viewports.get(vp);
  if (rec && baseSunColor !== undefined) rec.baseSunColor.setHex(baseSunColor);
  if (isViewportInDescent(vp)) return;
  const sun = vp.sun;
  const sec = ensureSecondaryShadowLight(vp);
  const mapSz = snapMapSize(params.mapSize);
  const d = Math.max(12, params.frustumSize);
  vp.renderer.shadowMap.enabled = on;
  syncDirectionalShadowFrustum(sun, mapSz, d);
  syncDirectionalShadowFrustum(sec, Math.min(2048, mapSz), d);

  followShadowTarget(vp, rec ? rec.lastTarget : sun.target.position);
  const hasPlanetSurface = hasViewportPlanetSurface(vp);
  let moon: Readonly<MoonBlend> = DAY_MOON;
  let primaryShadowInt: number;

  if (isDayNightOn() && hasPlanetSurface) {
    const solar = applyDayNightAtmosphere(vp, params.sunAzimuth, params.sunElevation);
    moon = { night: 1 - solar.daylight, intensityMult: solar.moonIntensityMult, shadowMult: solar.moonShadowMult };
    sun.color.copy(solar.sunColor);
    sun.intensity = params.sunIntensity * solar.sunIntensityMult;
    vp.hemi.intensity = params.ambientIntensity * (solar.hemiIntensity / 0.56);
    vp.scene.environmentIntensity = params.ambientIntensity * 1.15 * solar.envIntensity;
    vp.bloom.strength = params.bloomStrength + (1 - solar.daylight) * 0.12;
    primaryShadowInt = THREE.MathUtils.clamp(params.shadowIntensity * solar.shadowIntensityMult, 0, 1.6);
    sun.shadow.radius = params.shadowSoftness * solar.shadowSoftnessMult;
  } else {
    if (hasPlanetSurface) applyDayNightAtmosphere(vp, params.sunAzimuth, params.sunElevation);
    const elevFactor = THREE.MathUtils.smoothstep(params.sunElevation, 8, 34);
    if (rec) {
      sun.color.copy(rec.baseSunColor).lerp(warmTint, (1 - elevFactor) * 0.55);
    }
    sun.intensity = params.sunIntensity * (0.72 + 0.28 * elevFactor);
    vp.hemi.intensity = params.ambientIntensity;
    vp.scene.environmentIntensity = params.ambientIntensity * 1.15;
    vp.bloom.strength = params.bloomStrength;
    primaryShadowInt = params.shadowIntensity;
    sun.shadow.radius = params.shadowSoftness;
  }
  applyShadowSourceMode(sun, sec, moon, primaryShadowInt);
  if (rec) {
    rec.sunRadius = sun.shadow.radius;
    rec.secRadius = sec.shadow.radius;
    followShadowTarget(vp, rec.lastTarget);
  }
}

export const applyShadowConfig = syncViewportShadow;

export function registerShadowViewport(vp: ColonyViewport): () => void {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  viewports.set(vp, {
    vp,
    lastTarget: new THREE.Vector3(),
    baseSunColor: vp.sun.color.clone(),
    lastTickMs: now,
    focus: null,
  });
  syncViewportShadow(vp);
  return () => { viewports.delete(vp); };
}

export function stepSunOrbit(vp: ColonyViewport): void {
  const rec = viewports.get(vp);
  if (!rec) return;
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const dt = Math.min(0.1, Math.max(0, (now - rec.lastTickMs) / 1000));
  rec.lastTickMs = now;
  if (hasViewportPlanetSurface(vp) && !isViewportInDescent(vp)) {
    stepStandaloneDayNight(dt);
  }
  if (params.sunOrbitSpeed > 0.01 && dt > 0) {
    params = { ...params, sunAzimuth: (params.sunAzimuth + dt * params.sunOrbitSpeed) % 360 };
    followShadowTarget(vp, rec.lastTarget);
    listeners.forEach((l) => l(on, params));
  }
}

export function onColonyShaderTune(fn: (weatheringMul: number, rimStrength: number) => void): () => void {
  colonyUniformListeners.add(fn);
  fn(params.weatheringIntensity, params.rimStrength);
  return () => { colonyUniformListeners.delete(fn); };
}

function notifyAll(): void {
  colonyUniformListeners.forEach((fn) => fn(params.weatheringIntensity, params.rimStrength));
  for (const { vp } of viewports.values()) {
    syncViewportShadow(vp);
    try { vp.composer.render(); } catch { /* headless fallback */ }
  }
  listeners.forEach((l) => l(on, params));
}

onPerfChange(() => notifyAll());

onDayNightChange((_on, _p, source) => {
  if (source === 'user') {
    manualSunAngles = false;
    notifyAll();
    return;
  }
  for (const { vp } of viewports.values()) {
    if (hasViewportPlanetSurface(vp) && !isViewportInDescent(vp)) {
      syncViewportShadow(vp);
    }
  }
});

export const isShadowOn = (): boolean => on;
export const getShadowParams = (): Readonly<ShadowParams> => params;
export const onShadowChange = (fn: (on: boolean, params: ShadowParams) => void): (() => void) => {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
};

export function setShadow(v: boolean): boolean {
  on = Boolean(v);
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* private mode */ }
  for (const { vp } of viewports.values()) {
    vp.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.needsUpdate = true;
    });
  }
  notifyAll();
  return on;
}

export const toggleShadow = (): boolean => setShadow(!on);

export function setShadowParams(next: Partial<ShadowParams>): ShadowParams {
  if (next.sunAzimuth !== undefined || next.sunElevation !== undefined) {
    manualSunAngles = true;
  }
  const merged = { ...params, ...next };
  if (next.mapSize !== undefined) merged.mapSize = snapMapSize(next.mapSize);
  params = merged;
  try { localStorage.setItem(PARAMS_KEY, JSON.stringify(params)); } catch { /* private mode */ }
  notifyAll();
  return params;
}

export const resetShadowParams = (): ShadowParams => {
  const res = setShadowParams({ ...DEFAULT_SHADOW_PARAMS });
  manualSunAngles = false;
  return res;
};
