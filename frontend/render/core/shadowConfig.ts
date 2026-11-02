import * as THREE from 'three';
import type { ColonyViewport } from './createColonyViewport';

const KEY = 'terraagent.shadow';
const PARAMS_KEY = 'terraagent.shadow.params.v7';
const SUN_DIST = 72;

export interface ShadowParams {
  sunAzimuth: number;          // 0..360 deg
  sunElevation: number;        // 8..85 deg
  sunOrbitSpeed: number;       // 0..30 deg/s
  shadowIntensity: number;     // 0..1.6
  shadowSoftness: number;      // 0.2..4.0
  mapSize: number;             // 512 | 1024 | 2048 | 4096
  frustumSize: number;         // 18..90 m
  normalBias: number;          // 0..0.10
  shadowBias: number;          // -0.0030..0.0005
  sunIntensity: number;        // 0.2..4.5
  ambientIntensity: number;    // 0.1..1.8
  bloomStrength: number;       // 0..1.5
  weatheringIntensity: number; // 0..1.5 multiplier
  rimStrength: number;         // 0..0.8
}

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
const listeners = new Set<(on: boolean, params: ShadowParams) => void>();
const colonyUniformListeners = new Set<(weatheringMul: number, rimStrength: number) => void>();

interface TrackedViewport {
  vp: ColonyViewport;
  lastTarget: THREE.Vector3;
  baseSunColor: THREE.Color;
  lastTickMs: number;
}

const viewports = new Map<ColonyViewport, TrackedViewport>();
let shaderPatched = false;

const SOFT_SHADOW_HELPERS_GLSL = /* glsl */ `
float taTexelCompare( sampler2D shadowMap, vec2 shadowMapSize, vec2 texelSize, vec2 uv, float compare ) {
	vec2 st = uv * shadowMapSize - 0.5;
	vec2 baseUv = ( floor( st ) + 0.5 ) * texelSize;
	vec2 f = fract( st );
	f = f * f * ( 3.0 - 2.0 * f );
	float c00 = texture2DCompare( shadowMap, baseUv, compare );
	float c10 = texture2DCompare( shadowMap, baseUv + vec2( texelSize.x, 0.0 ), compare );
	float c01 = texture2DCompare( shadowMap, baseUv + vec2( 0.0, texelSize.y ), compare );
	float c11 = texture2DCompare( shadowMap, baseUv + texelSize, compare );
	return mix( mix( c00, c10, f.x ), mix( c01, c11, f.x ), f.y );
}

float taSampleShadowSoft( sampler2D shadowMap, vec2 shadowMapSize, float shadowRadius, vec3 shadowCoord ) {
	vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
	float rScale = max( 0.25, shadowRadius );
	vec2 searchStep = texelSize * ( 1.25 * rScale );
	float d0 = unpackRGBAToDepth( texture2D( shadowMap, shadowCoord.xy ) );
	float d1 = unpackRGBAToDepth( texture2D( shadowMap, shadowCoord.xy + vec2( searchStep.x, 0.0 ) ) );
	float d2 = unpackRGBAToDepth( texture2D( shadowMap, shadowCoord.xy - vec2( searchStep.x, 0.0 ) ) );
	float d3 = unpackRGBAToDepth( texture2D( shadowMap, shadowCoord.xy + vec2( 0.0, searchStep.y ) ) );
	float d4 = unpackRGBAToDepth( texture2D( shadowMap, shadowCoord.xy - vec2( 0.0, searchStep.y ) ) );
	float bSum = 0.0;
	float bCnt = 0.0;
	float g0 = shadowCoord.z - d0; if ( g0 > 0.00004 ) { bSum += g0; bCnt += 1.0; }
	float g1 = shadowCoord.z - d1; if ( g1 > 0.00008 ) { bSum += g1; bCnt += 1.0; }
	float g2 = shadowCoord.z - d2; if ( g2 > 0.00008 ) { bSum += g2; bCnt += 1.0; }
	float g3 = shadowCoord.z - d3; if ( g3 > 0.00008 ) { bSum += g3; bCnt += 1.0; }
	float g4 = shadowCoord.z - d4; if ( g4 > 0.00008 ) { bSum += g4; bCnt += 1.0; }
	float avgGap = bCnt > 0.0 ? ( bSum / bCnt ) : 0.0;
	float penumbra = mix( 0.20, 1.15, smoothstep( 0.002, 0.045, avgGap ) ) * rScale;
	float rIn = 0.48 * penumbra;
	float rOut = 0.98 * penumbra;
	float zIn = shadowCoord.z - 0.00010 * rIn;
	float zOut = shadowCoord.z - 0.00014 * rOut;
	vec2 sIn = texelSize * rIn;
	vec2 sOut = texelSize * ( rOut * 0.70710678 );
	float s = taTexelCompare( shadowMap, shadowMapSize, texelSize, shadowCoord.xy, shadowCoord.z ) * 0.34;
	s += (
		taTexelCompare( shadowMap, shadowMapSize, texelSize, shadowCoord.xy + vec2( sIn.x, 0.0 ), zIn ) +
		taTexelCompare( shadowMap, shadowMapSize, texelSize, shadowCoord.xy - vec2( sIn.x, 0.0 ), zIn ) +
		taTexelCompare( shadowMap, shadowMapSize, texelSize, shadowCoord.xy + vec2( 0.0, sIn.y ), zIn ) +
		taTexelCompare( shadowMap, shadowMapSize, texelSize, shadowCoord.xy - vec2( 0.0, sIn.y ), zIn )
	) * 0.115;
	s += (
		taTexelCompare( shadowMap, shadowMapSize, texelSize, shadowCoord.xy + vec2( sOut.x, sOut.y ), zOut ) +
		taTexelCompare( shadowMap, shadowMapSize, texelSize, shadowCoord.xy + vec2( -sOut.x, sOut.y ), zOut ) +
		taTexelCompare( shadowMap, shadowMapSize, texelSize, shadowCoord.xy + vec2( sOut.x, -sOut.y ), zOut ) +
		taTexelCompare( shadowMap, shadowMapSize, texelSize, shadowCoord.xy + vec2( -sOut.x, -sOut.y ), zOut )
	) * 0.05;
	return smoothstep( 0.08, 0.92, s );
}
`;

/**
 * Upgrades Three.js's built-in directional shadow shader chunk so that:
 * 1) `PCFSoftShadowMap` uses a 9-tap contact-hardening smooth cubic-bilinear disk kernel (`taSampleShadowSoft`)
 *    that eliminates blocky texel stair-stepping, keeps small-object contact shadows crisp, and softens tall shadows,
 * 2) Cast directional shadows also attenuate indirect hemisphere/IBL irradiance for high-contrast outdoor readability.
 */
export function installShadowShaderPatch(): void {
  if (shaderPatched) return;
  shaderPatched = true;
  const pars = THREE.ShaderChunk.shadowmap_pars_fragment;
  if (pars && !pars.includes('taSampleShadowSoft')) {
    const withHelpers = pars.replace(
      'float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowRadius, vec4 shadowCoord ) {',
      `${SOFT_SHADOW_HELPERS_GLSL}\n\tfloat getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowRadius, vec4 shadowCoord ) {`,
    ).replace(
      'float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {',
      `${SOFT_SHADOW_HELPERS_GLSL}\n\tfloat getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {`,
    );
    THREE.ShaderChunk.shadowmap_pars_fragment = withHelpers.replace(
      /#elif defined\( SHADOWMAP_TYPE_PCF_SOFT \)[\s\S]*?\* \( 1\.0 \/ 9\.0 \);/,
      `#elif defined( SHADOWMAP_TYPE_PCF_SOFT )\n\t\t\tshadow = taSampleShadowSoft( shadowMap, shadowMapSize, shadowRadius, shadowCoord.xyz );`,
    );
  }
  const begin = THREE.ShaderChunk.lights_fragment_begin;
  const end = THREE.ShaderChunk.lights_fragment_end;
  if (begin && end && !begin.includes('taDirShadow')) {
    THREE.ShaderChunk.lights_fragment_begin =
      `float taDirShadow = 1.0;\nfloat taShadowStrength = 0.0;\n` +
      begin.replace(
        'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;',
        `if ( directLight.visible && receiveShadow ) {\n\t\t\tfloat sVal = getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, 1.0, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] );\n\t\t\t#if defined( TA_TERRAIN_SHADER )\n\t\t\t\tfloat taSlope = 1.0 - normalize( vLN ).y;\n\t\t\t\tvec2 taCliffHorizN = vLN.xz / max( length( vLN.xz ), 1e-4 );\n\t\t\t\tvec3 taSunWorld = inverseTransformDirection( directLight.direction, viewMatrix );\n\t\t\t\tvec2 taSunHoriz = taSunWorld.xz / max( length( taSunWorld.xz ), 1e-4 );\n\t\t\t\tfloat taSelfLit = smoothstep( -0.22, 0.16, dot( taCliffHorizN, taSunHoriz ) );\n\t\t\t\tfloat taCliffBright = smoothstep( 0.0, 0.02, vRock ) * smoothstep( 0.02, 0.08, taSlope );\n\t\t\t\tfloat taCliffDark = smoothstep( 0.22, 0.75, vRock ) * smoothstep( 0.04, 0.14, taSlope );\n\t\t\t\tsVal = max( sVal, taSelfLit * taCliffBright );\n\t\t\t\tsVal = min( sVal, mix( 1.0, taSelfLit, taCliffDark ) );\n\t\t\t#endif\n\t\t\ttaDirShadow = min( taDirShadow, sVal );\n\t\t\ttaShadowStrength = max( taShadowStrength, directionalLightShadow.shadowIntensity );\n\t\t\tdirectLight.color *= mix( 1.0, sVal, clamp( directionalLightShadow.shadowIntensity, 0.0, 1.0 ) );\n\t\t}`,
      );
    THREE.ShaderChunk.lights_fragment_end =
      `#if defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 )\n\tfloat taAmbOcc = mix( 1.0, 0.36, clamp( ( 1.0 - taDirShadow ) * ( 0.72 * taShadowStrength ), 0.0, 1.0 ) );\n\t#if defined( RE_IndirectDiffuse )\n\t\tirradiance *= taAmbOcc;\n\t#endif\n\t#if defined( RE_IndirectSpecular )\n\t\tiblIrradiance *= taAmbOcc;\n\t\tradiance *= mix( 1.0, taAmbOcc, 0.70 );\n\t#endif\n#endif\n` +
      end;
  }
}

export function computeSunOffset(out = new THREE.Vector3(), p: Readonly<ShadowParams> = params): THREE.Vector3 {
  const elev = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(p.sunElevation, 5, 88));
  const azim = THREE.MathUtils.degToRad(p.sunAzimuth);
  const horiz = Math.cos(elev) * SUN_DIST;
  return out.set(Math.cos(azim) * horiz, Math.sin(elev) * SUN_DIST, Math.sin(azim) * horiz);
}

const tmpOffset = new THREE.Vector3();
const tmpDir = new THREE.Vector3();
const tmpRight = new THREE.Vector3();
const tmpUp = new THREE.Vector3();
const worldUp = new THREE.Vector3(0, 1, 0);
const warmTint = new THREE.Color(0xff8e47);

/** Quantizes the shadow frustum target in light-space texel steps so panning never causes shadow swimming or 1m jumps. */
export function followShadowTarget(vp: ColonyViewport, target: THREE.Vector3): void {
  const rec = viewports.get(vp);
  if (rec) rec.lastTarget.copy(target);
  computeSunOffset(tmpOffset, params);
  tmpDir.copy(tmpOffset).normalize();
  tmpRight.crossVectors(worldUp, tmpDir);
  if (tmpRight.lengthSq() < 1e-5) tmpRight.set(1, 0, 0);
  else tmpRight.normalize();
  tmpUp.crossVectors(tmpDir, tmpRight).normalize();

  const texelWorld = (2 * Math.max(10, params.frustumSize)) / Math.max(256, params.mapSize);
  const step = Math.max(0.02, texelWorld * 2);
  const u = Math.round(target.dot(tmpRight) / step) * step;
  const v = Math.round(target.dot(tmpUp) / step) * step;
  const w = Math.round(target.dot(tmpDir) / 0.5) * 0.5;

  const tx = tmpRight.x * u + tmpUp.x * v + tmpDir.x * w;
  const ty = tmpRight.y * u + tmpUp.y * v + tmpDir.y * w;
  const tz = tmpRight.z * u + tmpUp.z * v + tmpDir.z * w;

  vp.sun.target.position.set(tx, ty, tz);
  vp.sun.position.set(tx + tmpOffset.x, ty + tmpOffset.y, tz + tmpOffset.z);
  vp.sun.target.updateMatrixWorld();
  vp.sun.updateMatrixWorld();

  const dome = vp.scene.getObjectByName('planetSkyDome') as THREE.Mesh | undefined;
  const uSun = (dome?.material as THREE.ShaderMaterial | undefined)?.uniforms?.uSun;
  if (uSun?.value) (uSun.value as THREE.Vector3).copy(tmpOffset);
}

export function syncViewportShadow(vp: ColonyViewport, baseSunColor?: number): void {
  const rec = viewports.get(vp);
  if (rec && baseSunColor !== undefined) rec.baseSunColor.setHex(baseSunColor);
  const sun = vp.sun;
  const mapSz = snapMapSize(params.mapSize);
  vp.renderer.shadowMap.enabled = on;
  sun.castShadow = on;
  sun.shadow.intensity = on ? params.shadowIntensity : 0;
  sun.shadow.radius = params.shadowSoftness;
  sun.shadow.normalBias = params.normalBias;
  sun.shadow.bias = params.shadowBias;

  if (sun.shadow.mapSize.x !== mapSz || sun.shadow.mapSize.y !== mapSz) {
    sun.shadow.mapSize.set(mapSz, mapSz);
    if (sun.shadow.map) {
      sun.shadow.map.dispose();
      sun.shadow.map = null;
    }
  }

  const d = Math.max(12, params.frustumSize);
  const cam = sun.shadow.camera;
  if (cam.left !== -d || cam.right !== d || cam.top !== d || cam.bottom !== -d || cam.near !== 8 || cam.far !== 138) {
    cam.left = -d;
    cam.right = d;
    cam.top = d;
    cam.bottom = -d;
    cam.near = 8;
    cam.far = 138;
    cam.updateProjectionMatrix();
  }

  const elevFactor = THREE.MathUtils.smoothstep(params.sunElevation, 8, 34);
  if (rec) {
    sun.color.copy(rec.baseSunColor).lerp(warmTint, (1 - elevFactor) * 0.55);
  }
  sun.intensity = params.sunIntensity * (0.72 + 0.28 * elevFactor);
  vp.hemi.intensity = params.ambientIntensity;
  vp.scene.environmentIntensity = params.ambientIntensity * 1.15;
  vp.bloom.strength = params.bloomStrength;

  followShadowTarget(vp, rec ? rec.lastTarget : sun.target.position);
}

export function registerShadowViewport(vp: ColonyViewport): () => void {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  viewports.set(vp, {
    vp,
    lastTarget: new THREE.Vector3(),
    baseSunColor: vp.sun.color.clone(),
    lastTickMs: now,
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
  const merged = { ...params, ...next };
  if (next.mapSize !== undefined) merged.mapSize = snapMapSize(next.mapSize);
  params = merged;
  try { localStorage.setItem(PARAMS_KEY, JSON.stringify(params)); } catch { /* private mode */ }
  notifyAll();
  return params;
}

export const resetShadowParams = (): ShadowParams => setShadowParams({ ...DEFAULT_SHADOW_PARAMS });
