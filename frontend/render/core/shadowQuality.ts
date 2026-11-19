import * as THREE from 'three';

export type ShadowQualityPreset = 'off' | 'low' | 'med' | 'high' | 'auto';
export const SHADOW_QUALITY_PRESETS: readonly ShadowQualityPreset[] = ['auto', 'high', 'med', 'low', 'off'] as const;

export interface ShadowLodState {
  readonly preset: ShadowQualityPreset;
  readonly filterLod: 0 | 1 | 2;
  readonly shadowSwayScale: number;
  readonly cullSmallCasters: boolean;
  readonly shouldRefreshShadowMap: boolean;
  readonly camDist: number;
  readonly panSpeed: number;
}

const QUALITY_KEY = 'terraagent.shadowQuality';
const LEGACY_SHADOW_KEY = 'terraagent.shadow';
const DEFAULT_CAM_DIST = 38;
const ZOOM_DOWN_DIST = 72;
const ZOOM_UP_DIST = 68;

export function parseShadowQuality(raw: string | null | undefined): ShadowQualityPreset | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (v === 'off' || v === 'low' || v === 'med' || v === 'high' || v === 'auto') return v;
  return null;
}

function readInitialShadowQuality(): ShadowQualityPreset {
  try {
    const q = new URLSearchParams(location.search);
    const fromUrl = parseShadowQuality(q.get('shadowQuality'));
    if (fromUrl) return fromUrl;
    const legacyUrl = q.get('shadow');
    if (legacyUrl === '0' || legacyUrl === 'false') return 'off';
    const saved = parseShadowQuality(localStorage.getItem(QUALITY_KEY));
    if (saved) return saved;
    if (localStorage.getItem(LEGACY_SHADOW_KEY) === '0') return 'off';
  } catch { /* ignore */ }
  return 'auto';
}

let preset: ShadowQualityPreset = readInitialShadowQuality();
let lastNonOffPreset: Exclude<ShadowQualityPreset, 'off'> = preset === 'off' ? 'auto' : preset;
let camDist = DEFAULT_CAM_DIST;
let panSpeed = 0;
let prevTargetX = NaN;
let prevTargetZ = NaN;
let zoomedOutMapDown = false;
let frameCounter = 0;

const lodState: {
  preset: ShadowQualityPreset;
  filterLod: 0 | 1 | 2;
  shadowSwayScale: number;
  cullSmallCasters: boolean;
  shouldRefreshShadowMap: boolean;
  camDist: number;
  panSpeed: number;
} = {
  preset,
  filterLod: 2,
  shadowSwayScale: 1,
  cullSmallCasters: false,
  shouldRefreshShadowMap: true,
  camDist,
  panSpeed,
};

const qualityListeners = new Set<(next: ShadowQualityPreset) => void>();
const telemetryListeners = new Set<(state: Readonly<ShadowLodState>) => void>();

function computeFilterLod(p: ShadowQualityPreset, dist: number, speed: number): 0 | 1 | 2 {
  if (p === 'off' || p === 'low') return 0;
  if (p === 'high') return 2;
  if (p === 'med') return dist > ZOOM_DOWN_DIST || speed > 70 ? 0 : 1;
  if (dist > ZOOM_DOWN_DIST || speed > 70) return 0;
  if (dist > 50 || speed > 45) return 1;
  return 2;
}

function computeShadowSwayScale(p: ShadowQualityPreset, dist: number, speed: number): number {
  if (p === 'off' || p === 'low' || speed > 75) return 0;
  if (dist <= 55) return 1;
  if (dist >= 75) return 0;
  return 1 - (dist - 55) / 20;
}

function computeShouldRefresh(p: ShadowQualityPreset, dist: number, speed: number, frame: number): boolean {
  if (p === 'off') return false;
  if (p === 'high') return true;
  if (p === 'low') return speed > 25 ? (frame & 1) === 0 : true;
  return dist > 60 && speed > 75 ? (frame & 1) === 0 : true;
}

function recomputeLodState(): ShadowLodState {
  lodState.preset = preset;
  lodState.camDist = camDist;
  lodState.panSpeed = panSpeed;
  lodState.filterLod = computeFilterLod(preset, camDist, panSpeed);
  lodState.shadowSwayScale = computeShadowSwayScale(preset, camDist, panSpeed);
  lodState.cullSmallCasters = preset === 'off' || preset === 'low' || (preset !== 'high' && camDist > 65);
  lodState.shouldRefreshShadowMap = computeShouldRefresh(preset, camDist, panSpeed, frameCounter);
  return lodState;
}

recomputeLodState();

export const getShadowQuality = (): ShadowQualityPreset => preset;

export function setShadowQuality(next: ShadowQualityPreset): ShadowQualityPreset {
  const parsed = parseShadowQuality(next);
  if (!parsed) return preset;
  if (parsed !== 'off') lastNonOffPreset = parsed;
  const changed = preset !== parsed;
  preset = parsed;
  try { localStorage.setItem(QUALITY_KEY, preset); } catch { /* private mode */ }
  recomputeLodState();
  if (changed) {
    qualityListeners.forEach((fn) => fn(preset));
    telemetryListeners.forEach((fn) => fn(lodState));
  }
  return preset;
}

export function syncPresetFromShadowFlag(shadowOn: boolean): ShadowQualityPreset {
  const next: ShadowQualityPreset = shadowOn ? lastNonOffPreset : 'off';
  if (preset === next) return preset;
  preset = next;
  try { localStorage.setItem(QUALITY_KEY, preset); } catch { /* private mode */ }
  recomputeLodState();
  qualityListeners.forEach((fn) => fn(preset));
  telemetryListeners.forEach((fn) => fn(lodState));
  return preset;
}

export function onShadowQualityChange(fn: (next: ShadowQualityPreset) => void): () => void {
  qualityListeners.add(fn);
  return () => { qualityListeners.delete(fn); };
}

export function onShadowLodTelemetry(fn: (state: Readonly<ShadowLodState>) => void): () => void {
  telemetryListeners.add(fn);
  fn(lodState);
  return () => { telemetryListeners.delete(fn); };
}

export function updateShadowCameraTelemetry(
  nextDist: number,
  targetX: number,
  targetZ: number,
  dt: number,
): Readonly<ShadowLodState> {
  frameCounter = (frameCounter + 1) | 0;
  camDist = Number.isFinite(nextDist) && nextDist > 0 ? nextDist : DEFAULT_CAM_DIST;
  if (Number.isFinite(prevTargetX) && Number.isFinite(prevTargetZ) && dt > 1e-4) {
    const rawSpeed = Math.hypot(targetX - prevTargetX, targetZ - prevTargetZ) / dt;
    panSpeed = panSpeed + (rawSpeed - panSpeed) * 0.45;
  } else if (dt > 1e-4) {
    panSpeed *= 0.5;
  }
  prevTargetX = targetX;
  prevTargetZ = targetZ;

  if (camDist > ZOOM_DOWN_DIST) zoomedOutMapDown = true;
  else if (camDist < ZOOM_UP_DIST) zoomedOutMapDown = false;

  recomputeLodState();
  telemetryListeners.forEach((fn) => fn(lodState));
  return lodState;
}

export function resetShadowCameraTelemetry(): void {
  camDist = DEFAULT_CAM_DIST;
  panSpeed = 0;
  prevTargetX = NaN;
  prevTargetZ = NaN;
  zoomedOutMapDown = false;
  frameCounter = 0;
  recomputeLodState();
}

export function effectiveShadowMapSize(baseMapSize: number): number {
  if (preset === 'off' || preset === 'low' || preset === 'med') return Math.min(1024, baseMapSize);
  if (preset === 'high') return baseMapSize;
  return zoomedOutMapDown ? Math.min(1024, baseMapSize) : baseMapSize;
}

export const getShadowLodState = (): Readonly<ShadowLodState> => lodState;
export const getShadowSwayScale = (): number => lodState.shadowSwayScale;
export const shouldCullSmallShadowCasters = (): boolean => lodState.cullSmallCasters;
export const shouldRefreshShadowsThisFrame = (): boolean => lodState.shouldRefreshShadowMap;

const pooledShadowMaps = new WeakMap<THREE.DirectionalLight, Map<number, THREE.WebGLRenderTarget>>();

function createShadowTarget(light: THREE.DirectionalLight, size: number): THREE.WebGLRenderTarget {
  const rt = new THREE.WebGLRenderTarget(size, size, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  });
  rt.texture.name = `${light.name || 'dirLight'}.shadowMap`;
  return rt;
}

/**
 * Swaps a directional light's shadow map to a pooled `WebGLRenderTarget` of `targetSize` without disposing
 * the old target, preventing WebGL FBO reallocation hitches when zooming across the `68..72 m` LOD threshold.
 */
export function syncPooledShadowMapSize(light: THREE.DirectionalLight, targetSize: number): void {
  const prevW = light.shadow.mapSize.x;
  const prevH = light.shadow.mapSize.y;
  if (prevW === targetSize && prevH === targetSize) return;
  let pool = pooledShadowMaps.get(light);
  if (!pool) {
    pool = new Map<number, THREE.WebGLRenderTarget>();
    pooledShadowMaps.set(light, pool);
  }
  if (light.shadow.map && prevW > 0 && prevW === prevH) {
    pool.set(prevW, light.shadow.map);
  }
  light.shadow.mapSize.set(targetSize, targetSize);
  const reused = pool.get(targetSize) ?? null;
  if (reused) pool.delete(targetSize);
  light.shadow.map = reused;
  light.shadow.needsUpdate = true;
}

/** Pre-allocates and touches pooled shadow render targets during loading warmup so zoom swaps never stall. */
export function prewarmPooledShadowTargets(
  renderer: THREE.WebGLRenderer,
  light: THREE.DirectionalLight,
  sizes: readonly number[],
): void {
  let pool = pooledShadowMaps.get(light);
  if (!pool) {
    pool = new Map<number, THREE.WebGLRenderTarget>();
    pooledShadowMaps.set(light, pool);
  }
  const activeSize = light.shadow.mapSize.x;
  const prevTarget = typeof renderer.getRenderTarget === 'function' ? renderer.getRenderTarget() : null;
  try {
    for (const size of sizes) {
      if (size === activeSize) {
        if (!light.shadow.map) {
          light.shadow.map = createShadowTarget(light, size);
          if (typeof renderer.setRenderTarget === 'function') {
            renderer.setRenderTarget(light.shadow.map);
            renderer.clear?.();
          }
        }
        continue;
      }
      if (!pool.has(size)) {
        const rt = createShadowTarget(light, size);
        if (typeof renderer.setRenderTarget === 'function') {
          renderer.setRenderTarget(rt);
          renderer.clear?.();
        }
        pool.set(size, rt);
      }
    }
  } finally {
    if (typeof renderer.setRenderTarget === 'function') {
      renderer.setRenderTarget(prevTarget);
    }
  }
}

export function disposePooledShadowMaps(light: THREE.DirectionalLight): void {
  const pool = pooledShadowMaps.get(light);
  if (!pool) return;
  for (const rt of pool.values()) {
    if (rt !== light.shadow.map) rt.dispose();
  }
  pool.clear();
  pooledShadowMaps.delete(light);
}
