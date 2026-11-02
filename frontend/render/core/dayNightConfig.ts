import * as THREE from 'three';
import type { PlanetSpec } from '../planets/PlanetSpec';
import type { ColonyViewport } from './createColonyViewport';

export interface DayNightParams {
  /** Current planetary solar time of day in hours [0, 24). 0 = midnight, 6 = dawn, 12 = noon, 18 = dusk. */
  timeOfDay: number;
  /** How many real-world hours 1 full 24h planetary day takes at timeScale = 1. */
  dayLengthHours: number;
  /** Multiplier on planetary time progression (0 = paused clock, 1 = normal, >1 = fast-forward). */
  timeScale: number;
  /** Intensity of the warm amber/crimson color shift at dawn and dusk (0..2, default 1). */
  sunWarmth: number;
  /** Color temperature of the midday sun in Kelvin (3500..8500, default 5600). */
  noonTempK: number;
  /** Orbital moonlight and night ambient fill brightness at night (0..1, default 0.35). */
  nightBrightness: number;
  /** How strongly day/night elevation & moonlight modulate shadow intensity & softness (0..1.5, default 1). */
  shadowDayFactor: number;
}

export type DayPeriod = 'DAWN' | 'DAY' | 'DUSK' | 'NIGHT';

export interface SolarCycleState {
  readonly hour: number;
  readonly phase: number;
  readonly period: DayPeriod;
  readonly clockText: string;
  readonly sunAzimuth: number;
  readonly sunElevation: number;
  readonly daylight: number;
  readonly twilight: number;
  readonly sunColor: THREE.Color;
  readonly sunColorHex: string;
  readonly sunIntensityMult: number;
  readonly shadowIntensityMult: number;
  readonly shadowSoftnessMult: number;
  readonly hemiIntensity: number;
  readonly envIntensity: number;
}

export interface ViewportPlanetBaseline {
  sunColor: number;
  sunIntensity: number;
  hemiSky: number;
  hemiGround: number;
  skyTop: number;
  skyHorizon: number;
  fogColor: number;
  fogDensity: number;
  bloomStrength: number;
}

const ON_KEY = 'terraagent.daynight.on';
const PARAMS_KEY = 'terraagent.daynight.params';
const USER_SCRUB_HOLD_MS = 450;

export const DEFAULT_DAY_NIGHT_PARAMS: Readonly<DayNightParams> = {
  timeOfDay: 9.0,
  dayLengthHours: 0.25,
  timeScale: 1,
  sunWarmth: 1.0,
  noonTempK: 5600,
  nightBrightness: 0.35,
  shadowDayFactor: 1.0,
};

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / Math.max(1e-5, e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

export function wrapSolarHour(h: number): number {
  if (!Number.isFinite(h)) return DEFAULT_DAY_NIGHT_PARAMS.timeOfDay;
  const w = h - Math.floor(h / 24) * 24;
  return w >= 24 ? 0 : w < 0 ? w + 24 : w;
}

function readInitialOn(): boolean {
  if (typeof window === 'undefined') return true;
  const q = new URLSearchParams(window.location.search).get('daynight');
  if (q === '1') return true;
  if (q === '0') return false;
  try {
    const saved = localStorage.getItem(ON_KEY);
    if (saved === '0') return false;
    if (saved === '1') return true;
  } catch { /* ignore */ }
  return true;
}

function sanitizeDayNightParams(raw: Partial<DayNightParams>): DayNightParams {
  const num = (v: unknown, def: number) => (typeof v === 'number' && Number.isFinite(v) ? v : def);
  return {
    timeOfDay: wrapSolarHour(num(raw.timeOfDay, DEFAULT_DAY_NIGHT_PARAMS.timeOfDay)),
    dayLengthHours: clamp(num(raw.dayLengthHours, DEFAULT_DAY_NIGHT_PARAMS.dayLengthHours), 0.005, 168),
    timeScale: clamp(num(raw.timeScale, DEFAULT_DAY_NIGHT_PARAMS.timeScale), 0, 1000),
    sunWarmth: clamp(num(raw.sunWarmth, DEFAULT_DAY_NIGHT_PARAMS.sunWarmth), 0, 2),
    noonTempK: Math.round(clamp(num(raw.noonTempK, DEFAULT_DAY_NIGHT_PARAMS.noonTempK), 3500, 8500)),
    nightBrightness: clamp(num(raw.nightBrightness, DEFAULT_DAY_NIGHT_PARAMS.nightBrightness), 0, 1),
    shadowDayFactor: clamp(num(raw.shadowDayFactor, DEFAULT_DAY_NIGHT_PARAMS.shadowDayFactor), 0, 1.5),
  };
}

function readInitialParams(): DayNightParams {
  if (typeof window === 'undefined') return { ...DEFAULT_DAY_NIGHT_PARAMS };
  try {
    const raw = localStorage.getItem(PARAMS_KEY);
    if (raw) return sanitizeDayNightParams(JSON.parse(raw) as Partial<DayNightParams>);
  } catch { /* ignore */ }
  return { ...DEFAULT_DAY_NIGHT_PARAMS };
}

let enabled = readInitialOn();
let params: DayNightParams = readInitialParams();
let externalSyncActive = false;
let lastUserTimeEditMs = -Infinity;

export type DayNightChangeSource = 'user' | 'sync' | 'step';

const listeners = new Set<(on: boolean, p: Readonly<DayNightParams>, source: DayNightChangeSource) => void>();
const userEditListeners = new Set<(patch: Partial<DayNightParams>, p: Readonly<DayNightParams>) => void>();
const baselines = new WeakMap<ColonyViewport, ViewportPlanetBaseline>();

const _cNoon = new THREE.Color();
const _cGold = new THREE.Color();
const _cHorizon = new THREE.Color();
const _cNight = new THREE.Color(0x4cc9f0);
const _cTwilight = new THREE.Color(0x7c6fd6);
const _cSkyTop = new THREE.Color();
const _cSkyHor = new THREE.Color();
const _cHemiSky = new THREE.Color();
const _cHemiGnd = new THREE.Color();
const _vSunDir = new THREE.Vector3();

/** Approximates Planckian locus color for Kelvin temperature in [3500..8500]. */
export function kelvinToColor(kelvin: number, target = new THREE.Color()): THREE.Color {
  const k = clamp(kelvin, 3000, 10000) / 100;
  let r: number;
  let g: number;
  let b: number;
  if (k <= 66) {
    r = 1.0;
    g = clamp((99.4708 * Math.log(k) - 161.1195) / 255, 0, 1);
    b = k <= 19 ? 0 : clamp((138.5177 * Math.log(k - 10) - 305.0448) / 255, 0, 1);
  } else {
    r = clamp((329.6987 * Math.pow(k - 60, -0.1332)) / 255, 0, 1);
    g = clamp((288.1221 * Math.pow(k - 60, -0.0755)) / 255, 0, 1);
    b = 1.0;
  }
  return target.setRGB(r, g, b);
}

export function formatSolarClock(hour: number): string {
  const h = wrapSolarHour(hour);
  const wholeH = Math.floor(h);
  const mins = Math.floor((h - wholeH) * 60 + 1e-4) % 60;
  return `${String(wholeH).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

/** Computes the sun color, azimuth, elevation, and shadow/lighting multipliers for a given time of day. */
export function computeSolarState(
  p: Readonly<DayNightParams> = params,
  baseAzimuth = 318,
  baseElevation = 28,
  baseSunHex = 0xfff5e4,
): SolarCycleState {
  const hour = wrapSolarHour(p.timeOfDay);
  const phase = hour / 24;
  const solarAngle = (phase - 0.25) * Math.PI * 2; // 0 at 06:00, +pi/2 at 12:00, +pi at 18:00, -pi/2 at 00:00
  const rawSin = Math.sin(solarAngle);
  const isMorning = hour < 12;

  const daylight = smoothstep(-0.08, 0.68, rawSin);
  const twilight = Math.max(0, 1 - Math.abs(rawSin - 0.04) / 0.34) * smoothstep(-0.32, 0.02, rawSin);

  let period: DayPeriod = 'DAY';
  if (rawSin < -0.12) period = 'NIGHT';
  else if (rawSin < 0.28) period = isMorning ? 'DAWN' : 'DUSK';

  // Azimuth sweeps smoothly across the sky; noon aligns with baseAzimuth
  const sunAzimuth = ((baseAzimuth + (phase - 0.5) * 160) % 360 + 360) % 360;
  // Elevation arcs from 8 deg near horizon up to noon peak, and stays at shallow orbital moonlight angle at night
  const noonPeakElev = clamp(Math.max(baseElevation, 46), 18, 82);
  const sunElevation = rawSin >= 0
    ? 8 + (noonPeakElev - 8) * Math.pow(rawSin, 0.78)
    : 14 + 18 * Math.min(1, -rawSin);

  // Sun color based on time of day:
  kelvinToColor(p.noonTempK, _cNoon);
  _cGold.setHex(baseSunHex);
  _cNoon.lerp(_cGold, 0.25);

  _cGold.setHex(isMorning ? 0xffe0b2 : 0xffd296);
  _cHorizon.setHex(isMorning ? 0xff854d : 0xff5e36);
  if (p.sunWarmth !== 1) {
    _cHorizon.lerp(_cNoon, clamp(1 - p.sunWarmth * 0.65, 0, 1));
    if (p.sunWarmth > 1) _cHorizon.lerp(new THREE.Color(0xff3d2e), (p.sunWarmth - 1) * 0.45);
  }

  const sunColor = new THREE.Color();
  if (rawSin >= 0.45) {
    const t = smoothstep(0.45, 0.95, rawSin);
    sunColor.copy(_cGold).lerp(_cNoon, t);
  } else if (rawSin >= 0.0) {
    const t = smoothstep(0.0, 0.45, rawSin);
    sunColor.copy(_cHorizon).lerp(_cGold, t);
  } else if (rawSin >= -0.24) {
    const t = smoothstep(-0.24, 0.0, rawSin);
    sunColor.copy(_cNight).lerp(_cTwilight, smoothstep(-0.24, -0.1, rawSin)).lerp(_cHorizon, t);
  } else {
    sunColor.copy(_cNight);
  }

  const nightKey = 0.14 + 0.34 * p.nightBrightness;
  const sunIntensityMult = rawSin >= 0
    ? 0.42 + 0.58 * smoothstep(0.0, 0.65, rawSin)
    : nightKey + (0.42 - nightKey) * smoothstep(-0.22, 0.0, rawSin);

  // Shadows respond to solar elevation & time of day:
  const rawShadowDay = rawSin >= 0
    ? 0.38 + 0.62 * smoothstep(0.0, 0.55, rawSin)
    : (0.16 + 0.32 * p.nightBrightness) * smoothstep(-0.02, -0.25, rawSin) + 0.25 * smoothstep(-0.25, 0.0, rawSin);
  const shadowIntensityMult = clamp(1 + (rawShadowDay - 1) * p.shadowDayFactor, 0.05, 1.35);
  const shadowSoftnessMult = clamp(1 + (1 - daylight) * 0.85 * p.shadowDayFactor, 0.75, 2.5);

  const hemiIntensity = (0.14 + 0.22 * p.nightBrightness) + (0.56 - (0.14 + 0.22 * p.nightBrightness)) * daylight;
  const envIntensity = (0.24 + 0.32 * p.nightBrightness) + (1.0 - (0.24 + 0.32 * p.nightBrightness)) * daylight;

  return {
    hour,
    phase,
    period,
    clockText: formatSolarClock(hour),
    sunAzimuth,
    sunElevation,
    daylight,
    twilight,
    sunColor,
    sunColorHex: `#${sunColor.getHexString()}`,
    sunIntensityMult,
    shadowIntensityMult,
    shadowSoftnessMult,
    hemiIntensity,
    envIntensity,
  };
}

export function recordViewportPlanetBase(vp: ColonyViewport, look?: PlanetSpec): ViewportPlanetBaseline {
  const sky = vp.scene.getObjectByName('planetSkyDome') as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> | undefined;
  const fog = vp.scene.fog as THREE.FogExp2 | null;
  const s = look?.sky;
  const base: ViewportPlanetBaseline = {
    sunColor: s ? s.sunColor : vp.sun.color.getHex(),
    sunIntensity: s ? s.sunIntensity : (vp.sun.intensity || 3.2),
    hemiSky: s ? s.skyColor : vp.hemi.color.getHex(),
    hemiGround: s ? s.hemiGround : vp.hemi.groundColor.getHex(),
    skyTop: s ? s.skyColor : (sky?.material?.uniforms?.uTop?.value?.getHex?.() ?? 0x1a2736),
    skyHorizon: s ? s.horizonColor : (sky?.material?.uniforms?.uHorizon?.value?.getHex?.() ?? 0x3b4d63),
    fogColor: s ? s.fogColor : (fog?.color?.getHex?.() ?? 0x3b4d63),
    fogDensity: s ? s.fogDensity : (fog?.density ?? 0.0025),
    bloomStrength: vp.bloom?.strength ?? 0.45,
  };
  baselines.set(vp, base);
  return base;
}

export function hasViewportPlanetSurface(vp: ColonyViewport): boolean {
  return baselines.has(vp) || Boolean(vp.scene.getObjectByName('planetSkyDome'));
}

export function isViewportInDescent(vp: ColonyViewport): boolean {
  return Boolean(vp.scene.getObjectByName('descent:root'));
}

export function getViewportPlanetBase(vp: ColonyViewport): ViewportPlanetBaseline {
  return baselines.get(vp) ?? recordViewportPlanetBase(vp);
}

/** Applies the current Day/Night sun color, intensity, sky dome, fog, and hemisphere light to `vp`. */
export function applyDayNightAtmosphere(vp: ColonyViewport, baseAzimuth = 318, baseElevation = 28): SolarCycleState {
  const hasSurfaceSky = hasViewportPlanetSurface(vp);
  const base = hasSurfaceSky ? getViewportPlanetBase(vp) : null;
  const solar = computeSolarState(params, baseAzimuth, baseElevation, base ? base.sunColor : vp.sun.color.getHex());
  if (!base || isViewportInDescent(vp)) return solar;
  const sky = vp.scene.getObjectByName('planetSkyDome') as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> | undefined;
  const fog = vp.scene.fog as THREE.FogExp2 | null;

  if (!enabled) {
    vp.sun.color.setHex(base.sunColor);
    vp.sun.intensity = base.sunIntensity;
    vp.hemi.color.setHex(base.hemiSky);
    vp.hemi.groundColor.setHex(base.hemiGround);
    vp.hemi.intensity = 0.55;
    vp.scene.environmentIntensity = 1.0;
    if (vp.scene.background instanceof THREE.Color) vp.scene.background.setHex(base.skyHorizon);
    if (fog?.color) fog.color.setHex(base.fogColor);
    if (sky?.material?.uniforms) {
      sky.material.uniforms.uTop?.value?.setHex?.(base.skyTop);
      sky.material.uniforms.uHorizon?.value?.setHex?.(base.skyHorizon);
      sky.material.uniforms.uSunCol?.value?.setHex?.(base.sunColor).multiplyScalar?.(0.6);
      sky.material.uniforms.uSun?.value?.copy?.(_vSunDir.copy(vp.sun.position).sub(vp.sun.target.position));
    }
    return solar;
  }

  vp.sun.color.copy(solar.sunColor);
  vp.sun.intensity = base.sunIntensity * solar.sunIntensityMult;

  const nightFactor = 1 - solar.daylight;
  _cHemiSky.setHex(base.hemiSky)
    .lerp(_cHorizon.setHex(0xff8e53), solar.twilight * 0.48 * params.sunWarmth)
    .lerp(_cTwilight.setHex(0x18294a), nightFactor * (0.88 - 0.25 * params.nightBrightness));
  _cHemiGnd.setHex(base.hemiGround).lerp(_cTwilight.setHex(0x070b12), nightFactor * 0.82);
  vp.hemi.color.copy(_cHemiSky);
  vp.hemi.groundColor.copy(_cHemiGnd);
  vp.hemi.intensity = solar.hemiIntensity;
  vp.scene.environmentIntensity = solar.envIntensity;

  _cSkyTop.setHex(base.skyTop)
    .lerp(_cTwilight.setHex(0x221b3a), solar.twilight * 0.45)
    .lerp(_cHemiGnd.setHex(0x040711), nightFactor * (0.92 - 0.2 * params.nightBrightness));
  _cSkyHor.setHex(base.skyHorizon)
    .lerp(_cHorizon.setHex(0xd4623b), solar.twilight * 0.55 * params.sunWarmth)
    .lerp(_cHemiGnd.setHex(0x0b1426), nightFactor * (0.88 - 0.22 * params.nightBrightness));

  if (vp.scene.background instanceof THREE.Color) vp.scene.background.copy(_cSkyHor);
  if (fog?.color) fog.color.copy(_cSkyHor);
  if (sky?.material?.uniforms) {
    sky.material.uniforms.uTop?.value?.copy?.(_cSkyTop);
    sky.material.uniforms.uHorizon?.value?.copy?.(_cSkyHor);
    sky.material.uniforms.uSunCol?.value?.copy?.(solar.sunColor).multiplyScalar?.(0.25 + 0.45 * solar.daylight);
    sky.material.uniforms.uSun?.value?.copy?.(_vSunDir.copy(vp.sun.position).sub(vp.sun.target.position));
  }
  if (vp.bloom) {
    vp.bloom.strength = base.bloomStrength + nightFactor * 0.12;
  }
  return solar;
}

export function isDayNightOn(): boolean {
  return enabled;
}

export function getDayNightParams(): Readonly<DayNightParams> {
  return params;
}

export function setDayNightExternalSync(active: boolean): void {
  externalSyncActive = active;
}

export function isDayNightExternalSync(): boolean {
  return externalSyncActive;
}

export function isUserScrubbingDayNight(nowMs = performance.now()): boolean {
  return nowMs - lastUserTimeEditMs < USER_SCRUB_HOLD_MS;
}

export function setDayNight(on: boolean): boolean {
  enabled = Boolean(on);
  try { localStorage.setItem(ON_KEY, enabled ? '1' : '0'); } catch { /* ignore */ }
  listeners.forEach((fn) => fn(enabled, params, 'user'));
  return enabled;
}

export function toggleDayNight(): boolean {
  return setDayNight(!enabled);
}

export function setDayNightParams(
  patch: Partial<DayNightParams>,
  source: DayNightChangeSource = 'user',
): Readonly<DayNightParams> {
  params = sanitizeDayNightParams({ ...params, ...patch });
  if (source === 'user') {
    if (patch.timeOfDay !== undefined || patch.dayLengthHours !== undefined || patch.timeScale !== undefined) {
      lastUserTimeEditMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    }
    try { localStorage.setItem(PARAMS_KEY, JSON.stringify(params)); } catch { /* ignore */ }
    userEditListeners.forEach((fn) => fn(patch, params));
  }
  listeners.forEach((fn) => fn(enabled, params, source));
  return params;
}

export function resetDayNightParams(source: 'user' | 'sync' = 'user'): Readonly<DayNightParams> {
  params = { ...DEFAULT_DAY_NIGHT_PARAMS };
  try { localStorage.removeItem(PARAMS_KEY); } catch { /* ignore */ }
  if (source === 'user') {
    lastUserTimeEditMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    userEditListeners.forEach((fn) => fn({ ...DEFAULT_DAY_NIGHT_PARAMS }, params));
  }
  listeners.forEach((fn) => fn(enabled, params, source));
  return params;
}

export function onDayNightChange(
  fn: (on: boolean, p: Readonly<DayNightParams>, source: DayNightChangeSource) => void,
): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function onDayNightUserEdit(fn: (patch: Partial<DayNightParams>, p: Readonly<DayNightParams>) => void): () => void {
  userEditListeners.add(fn);
  return () => userEditListeners.delete(fn);
}

/** Advances standalone local solar time when not externally driven by an online/local-host sim session. */
export function stepStandaloneDayNight(dtSec: number): boolean {
  if (!enabled || externalSyncActive || params.timeScale <= 0 || params.dayLengthHours <= 0) return false;
  if (dtSec <= 0 || dtSec > 1) return false;
  const deltaHours = ((dtSec / 3600) * params.timeScale / params.dayLengthHours) * 24;
  if (Math.abs(deltaHours) < 1e-6) return false;
  setDayNightParams({ timeOfDay: wrapSolarHour(params.timeOfDay + deltaHours) }, 'step');
  return true;
}
