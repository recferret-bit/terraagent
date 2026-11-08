import * as THREE from 'three';

const STORM_SLATE_HEX = 0x162030;
const OVERCAST_SUN_HEX = 0x6b82a8;
const OVERCAST_HEMI_HEX = 0x4a5f7a;
const FLASH_TINT_HEX = 0xdbeafe;

export interface RainAndStormLights {
  sun?: THREE.DirectionalLight;
  hemi?: THREE.HemisphereLight;
  renderer?: THREE.WebGLRenderer;
}

export interface AtmosphereBaseline {
  fogDensity: number;
  fogColor: THREE.Color;
  bgColor: THREE.Color;
  domeTopColor: THREE.Color;
  domeHorizonColor: THREE.Color;
  sunIntensity: number;
  sunColor: THREE.Color;
  hemiIntensity: number;
  hemiColor: THREE.Color;
  envIntensity: number;
  exposure: number;
  lastFogDensity: number | null;
  lastFogHex: number | null;
  lastBgHex: number | null;
  lastDomeTopHex: number | null;
  lastDomeHorizonHex: number | null;
  lastSunInt: number | null;
  lastSunHex: number | null;
  lastHemiInt: number | null;
  lastHemiHex: number | null;
  lastEnvInt: number | null;
  lastExposure: number | null;
}

export function createAtmosphereBaseline(): AtmosphereBaseline {
  return {
    fogDensity: 0.007,
    fogColor: new THREE.Color(0xb9dcef),
    bgColor: new THREE.Color(0xb9dcef),
    domeTopColor: new THREE.Color(0x6bb8e8),
    domeHorizonColor: new THREE.Color(0xb9dcef),
    sunIntensity: 2.25,
    sunColor: new THREE.Color(0xfff1d6),
    hemiIntensity: 0.58,
    hemiColor: new THREE.Color(0x9ccfff),
    envIntensity: 0.75,
    exposure: 1.1,
    lastFogDensity: null, lastFogHex: null, lastBgHex: null,
    lastDomeTopHex: null, lastDomeHorizonHex: null,
    lastSunInt: null, lastSunHex: null, lastHemiInt: null, lastHemiHex: null,
    lastEnvInt: null, lastExposure: null,
  };
}

function getSkyDomeUniforms(scene: THREE.Scene): { uTop?: THREE.IUniform<THREE.Color>; uHorizon?: THREE.IUniform<THREE.Color> } | null {
  const dome = scene.getObjectByName('planetSkyDome') as THREE.Mesh | undefined;
  const mat = dome?.material as THREE.ShaderMaterial | undefined;
  return (mat?.uniforms as { uTop?: THREE.IUniform<THREE.Color>; uHorizon?: THREE.IUniform<THREE.Color> } | undefined) ?? null;
}

const _stormColor = new THREE.Color(STORM_SLATE_HEX);
const _overcastSunColor = new THREE.Color(OVERCAST_SUN_HEX);
const _overcastHemiColor = new THREE.Color(OVERCAST_HEMI_HEX);
const _flashColor = new THREE.Color(FLASH_TINT_HEX);
const _workColor = new THREE.Color();

export function captureAtmosphereBase(
  scene: THREE.Scene,
  fog: THREE.FogExp2 | null,
  base: AtmosphereBaseline,
  lights?: RainAndStormLights,
): void {
  if (fog) {
    if (base.lastFogDensity === null || Math.abs(fog.density - base.lastFogDensity) > 1e-5) base.fogDensity = fog.density;
    if (base.lastFogHex === null || fog.color.getHex() !== base.lastFogHex) base.fogColor.copy(fog.color);
  }
  if (scene.background instanceof THREE.Color) {
    if (base.lastBgHex === null || scene.background.getHex() !== base.lastBgHex) base.bgColor.copy(scene.background);
  }
  const domeU = getSkyDomeUniforms(scene);
  if (domeU?.uTop?.value) {
    if (base.lastDomeTopHex === null || domeU.uTop.value.getHex() !== base.lastDomeTopHex) base.domeTopColor.copy(domeU.uTop.value);
  }
  if (domeU?.uHorizon?.value) {
    if (base.lastDomeHorizonHex === null || domeU.uHorizon.value.getHex() !== base.lastDomeHorizonHex) base.domeHorizonColor.copy(domeU.uHorizon.value);
  }
  if (lights?.sun) {
    if (base.lastSunInt === null || Math.abs(lights.sun.intensity - base.lastSunInt) > 1e-4) base.sunIntensity = lights.sun.intensity;
    if (base.lastSunHex === null || lights.sun.color.getHex() !== base.lastSunHex) base.sunColor.copy(lights.sun.color);
  }
  if (lights?.hemi) {
    if (base.lastHemiInt === null || Math.abs(lights.hemi.intensity - base.lastHemiInt) > 1e-4) base.hemiIntensity = lights.hemi.intensity;
    if (base.lastHemiHex === null || lights.hemi.color.getHex() !== base.lastHemiHex) base.hemiColor.copy(lights.hemi.color);
  }
  const envInt = scene.environmentIntensity ?? 0.75;
  if (base.lastEnvInt === null || Math.abs(envInt - base.lastEnvInt) > 1e-4) base.envIntensity = envInt;
  if (lights?.renderer) {
    const exp = lights.renderer.toneMappingExposure;
    if (base.lastExposure === null || Math.abs(exp - base.lastExposure) > 1e-4) base.exposure = exp;
  }
}

export function restoreAtmosphereBase(
  scene: THREE.Scene,
  fog: THREE.FogExp2 | null,
  base: AtmosphereBaseline,
  lights?: RainAndStormLights,
): void {
  if (base.lastFogDensity !== null && fog) { fog.density = base.fogDensity; fog.color.copy(base.fogColor); }
  if (base.lastBgHex !== null && scene.background instanceof THREE.Color) scene.background.copy(base.bgColor);
  const domeU = getSkyDomeUniforms(scene);
  if (base.lastDomeTopHex !== null && domeU?.uTop?.value) domeU.uTop.value.copy(base.domeTopColor);
  if (base.lastDomeHorizonHex !== null && domeU?.uHorizon?.value) domeU.uHorizon.value.copy(base.domeHorizonColor);
  if (base.lastSunInt !== null && lights?.sun) { lights.sun.intensity = base.sunIntensity; lights.sun.color.copy(base.sunColor); }
  if (base.lastHemiInt !== null && lights?.hemi) { lights.hemi.intensity = base.hemiIntensity; lights.hemi.color.copy(base.hemiColor); }
  if (base.lastEnvInt !== null) scene.environmentIntensity = base.envIntensity;
  if (base.lastExposure !== null && lights?.renderer) lights.renderer.toneMappingExposure = base.exposure;
  base.lastFogDensity = null; base.lastFogHex = null; base.lastBgHex = null;
  base.lastDomeTopHex = null; base.lastDomeHorizonHex = null;
  base.lastSunInt = null; base.lastSunHex = null; base.lastHemiInt = null; base.lastHemiHex = null;
  base.lastEnvInt = null; base.lastExposure = null;
}

export function applyStormAtmosphere(
  scene: THREE.Scene,
  base: AtmosphereBaseline,
  overcast: number,
  flashEnv: number,
  lights?: RainAndStormLights,
): void {
  if (!scene.fog && (overcast > 0.001 || flashEnv > 0.001)) {
    const bgHex = scene.background instanceof THREE.Color ? scene.background.getHex() : 0xb9dcef;
    scene.fog = new THREE.FogExp2(bgHex, 0.006);
  }
  const fog = scene.fog instanceof THREE.FogExp2 ? scene.fog : null;
  captureAtmosphereBase(scene, fog, base, lights);

  if (overcast <= 0.001 && flashEnv <= 0.001) {
    restoreAtmosphereBase(scene, fog, base, lights);
    return;
  }

  if (fog) {
    fog.density = base.fogDensity * (1 + overcast * 2.4);
    _workColor.copy(base.fogColor).lerp(_stormColor, overcast * 0.82);
    if (flashEnv > 0.001) _workColor.lerp(_flashColor, Math.min(0.85, flashEnv * 0.55));
    fog.color.copy(_workColor);
    base.lastFogDensity = fog.density;
    base.lastFogHex = fog.color.getHex();
  }
  if (scene.background instanceof THREE.Color) {
    _workColor.copy(base.bgColor).lerp(_stormColor, overcast * 0.82);
    if (flashEnv > 0.001) _workColor.lerp(_flashColor, Math.min(0.85, flashEnv * 0.55));
    scene.background.copy(_workColor);
    base.lastBgHex = scene.background.getHex();
  }
  const domeU = getSkyDomeUniforms(scene);
  if (domeU?.uTop?.value && domeU?.uHorizon?.value) {
    _workColor.copy(base.domeTopColor).lerp(_stormColor, overcast * 0.78);
    if (flashEnv > 0.001) _workColor.lerp(_flashColor, Math.min(0.85, flashEnv * 0.55));
    domeU.uTop.value.copy(_workColor);
    base.lastDomeTopHex = domeU.uTop.value.getHex();
    _workColor.copy(base.domeHorizonColor).lerp(_stormColor, overcast * 0.82);
    if (flashEnv > 0.001) _workColor.lerp(_flashColor, Math.min(0.85, flashEnv * 0.55));
    domeU.uHorizon.value.copy(_workColor);
    base.lastDomeHorizonHex = domeU.uHorizon.value.getHex();
  }
  if (lights?.sun) {
    lights.sun.intensity = base.sunIntensity * Math.max(0.15, 1 - overcast * 0.78) + flashEnv * 1.4;
    _workColor.copy(base.sunColor).lerp(_overcastSunColor, overcast * 0.75);
    if (flashEnv > 0.001) _workColor.lerp(_flashColor, Math.min(0.9, flashEnv * 0.65));
    lights.sun.color.copy(_workColor);
    base.lastSunInt = lights.sun.intensity;
    base.lastSunHex = lights.sun.color.getHex();
  }
  if (lights?.hemi) {
    lights.hemi.intensity = base.hemiIntensity * Math.max(0.22, 1 - overcast * 0.50) + flashEnv * 0.9;
    _workColor.copy(base.hemiColor).lerp(_overcastHemiColor, overcast * 0.78);
    if (flashEnv > 0.001) _workColor.lerp(_flashColor, Math.min(0.85, flashEnv * 0.5));
    lights.hemi.color.copy(_workColor);
    base.lastHemiInt = lights.hemi.intensity;
    base.lastHemiHex = lights.hemi.color.getHex();
  }
  scene.environmentIntensity = base.envIntensity * (1 - overcast * 0.62);
  base.lastEnvInt = scene.environmentIntensity;

  if (lights?.renderer) {
    lights.renderer.toneMappingExposure = base.exposure * (1 - overcast * 0.24) + flashEnv * 0.16;
    base.lastExposure = lights.renderer.toneMappingExposure;
  }
}
