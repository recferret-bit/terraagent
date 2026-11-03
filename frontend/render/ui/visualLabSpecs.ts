import { formatSolarClock, type DayNightParams } from '../core/dayNightConfig';
import type { PixelArtParams } from '../core/pixelArtPass';
import type { ShadowParams } from '../core/shadowConfig';
import type { WindParams } from '../core/windConfig';
import { WIND_RANGES } from '../core/windConfig';
import type { WaterParams } from '../visuals/water/waterConfig';
import { WATER_RANGES } from '../visuals/water/waterConfig';
import type { CrtParams } from './crt';
import { PERF_RANGES, RENDER_SCALES, TARGET_FPS, type PerfParams } from '../core/perfConfig';

export type VisualTabId = 'crt' | 'pixel' | 'shadow' | 'daynight' | 'wind' | 'water' | 'perf';

export interface SliderSpec<K extends string = string> {
  key: K;
  label: string;
  min: number;
  max: number;
  step: number;
  fmt: (v: number) => string;
  /** Section heading drawn above the first slider of a group (consecutive sliders share it). */
  group?: string;
}

export const CRT_SLIDERS: readonly SliderSpec<keyof CrtParams>[] = [
  { key: 'scanlineIntensity', label: 'SCANLINE OPACITY', min: 0, max: 0.65, step: 0.01, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'linePitch', label: 'SCANLINE PITCH', min: 2, max: 8, step: 1, fmt: (v) => `${Math.round(v)} px` },
  { key: 'crawlSpeed', label: 'SCAN CRAWL PERIOD', min: 0.1, max: 4.0, step: 0.1, fmt: (v) => `${v.toFixed(1)} s` },
  { key: 'rollIntensity', label: 'ROLL BAND GLOW', min: 0, max: 0.25, step: 0.005, fmt: (v) => `${(v * 100).toFixed(1)}%` },
  { key: 'rollSpeed', label: 'ROLL BAND PERIOD', min: 2, max: 20, step: 0.5, fmt: (v) => `${v.toFixed(1)} s` },
  { key: 'noiseOpacity', label: 'TAPE GRAIN NOISE', min: 0, max: 0.30, step: 0.005, fmt: (v) => `${(v * 100).toFixed(1)}%` },
  { key: 'flickerStrength', label: 'FLICKER PULSE', min: 0, max: 0.25, step: 0.005, fmt: (v) => `${(v * 100).toFixed(1)}%` },
  { key: 'vignetteStrength', label: 'TUBE VIGNETTE', min: 0, max: 0.95, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'waveAmplitude', label: 'GLITCH WAVE SHIFT', min: 0, max: 40, step: 1, fmt: (v) => `${Math.round(v)} px` },
  { key: 'waveFrequency', label: 'GLITCH WAVE FREQ', min: 0.002, max: 0.050, step: 0.002, fmt: (v) => v.toFixed(3) },
  { key: 'waveInterval', label: 'GLITCH WAVE DELAY', min: 2, max: 60, step: 1, fmt: (v) => `${Math.round(v)} s` },
];

export const PIXEL_SLIDERS: readonly SliderSpec<keyof PixelArtParams>[] = [
  { key: 'pixelSize', label: 'PIXEL SIZE', min: 1, max: 12, step: 0.5, fmt: (v) => `${v.toFixed(1)} px` },
  { key: 'colorLevels', label: 'COLOR LEVELS', min: 2, max: 64, step: 1, fmt: (v) => `${Math.round(v)} steps` },
  { key: 'dither', label: 'BAYER DITHER', min: 0, max: 2, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'edgeStrength', label: 'EDGE INK / RIDGE', min: 0, max: 2, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'saturation', label: 'SATURATION', min: 0, max: 2.5, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'contrast', label: 'CONTRAST', min: 0.5, max: 2.0, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'gridStrength', label: 'PIXEL GRID BEVEL', min: 0, max: 0.35, step: 0.01, fmt: (v) => `${Math.round(v * 100)}%` },
];

const SHADOW_SOURCE_MODES = ['SUN + NIGHT MOON', 'DUAL SUN + FILL', 'NIGHT PROJECTOR', 'SUN ONLY'] as const;

export const SHADOW_SLIDERS: readonly SliderSpec<keyof ShadowParams>[] = [
  { key: 'shadowSourceMode', label: 'SHADOW SOURCE MODE', min: 0, max: 3, step: 1, fmt: (v) => SHADOW_SOURCE_MODES[Math.round(v)] ?? 'SUN + NIGHT MOON' },
  { key: 'secondaryShadowEnabled', label: 'SECONDARY SHADOW ON/OFF', min: 0, max: 1, step: 1, fmt: (v) => (v >= 0.5 ? 'ON' : 'OFF') },
  { key: 'nightShadowIntensity', label: 'NIGHT SHADOW STRENGTH', min: 0, max: 1.6, step: 0.04, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'secondaryAzimuthDeg', label: 'SECONDARY AZIMUTH °', min: -180, max: 180, step: 1, fmt: (v) => `${Math.round(v)}°` },
  { key: 'secondaryElevationDeg', label: 'SECONDARY ELEVATION °', min: 8, max: 85, step: 1, fmt: (v) => `${Math.round(v)}°` },
  { key: 'secondaryIntensity', label: 'SECONDARY LIGHT INTENSITY', min: 0, max: 3.5, step: 0.05, fmt: (v) => v.toFixed(2) },
  { key: 'sunAzimuth', label: 'SUN AZIMUTH', min: 0, max: 360, step: 1, fmt: (v) => `${Math.round(v)}°` },
  { key: 'sunElevation', label: 'SUN ELEVATION', min: 8, max: 85, step: 1, fmt: (v) => `${Math.round(v)}°` },
  { key: 'sunOrbitSpeed', label: 'SUN ORBIT SPEED', min: 0, max: 30, step: 0.5, fmt: (v) => `${v.toFixed(1)} °/s` },
  { key: 'shadowIntensity', label: 'SHADOW OPACITY', min: 0, max: 1.6, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'shadowSoftness', label: 'SHADOW SOFTNESS', min: 0.2, max: 4.0, step: 0.1, fmt: (v) => `${v.toFixed(1)} px` },
  { key: 'mapSize', label: 'SHADOW MAP RES', min: 512, max: 4096, step: 512, fmt: (v) => `${Math.round(v)} px` },
  { key: 'frustumSize', label: 'SHADOW FRUSTUM', min: 18, max: 90, step: 2, fmt: (v) => `±${Math.round(v)} m` },
  { key: 'normalBias', label: 'NORMAL BIAS', min: 0, max: 0.10, step: 0.002, fmt: (v) => v.toFixed(3) },
  { key: 'shadowBias', label: 'DEPTH BIAS', min: -0.0030, max: 0.0005, step: 0.0001, fmt: (v) => v.toFixed(4) },
  { key: 'sunIntensity', label: 'SUN INTENSITY', min: 0.2, max: 4.5, step: 0.05, fmt: (v) => v.toFixed(2) },
  { key: 'ambientIntensity', label: 'AMBIENT FILL', min: 0.1, max: 1.8, step: 0.05, fmt: (v) => v.toFixed(2) },
  { key: 'bloomStrength', label: 'HDR BLOOM', min: 0, max: 1.5, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'weatheringIntensity', label: 'BIOME WEATHERING', min: 0, max: 1.5, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'rimStrength', label: 'FRESNEL RIM', min: 0, max: 0.8, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
];

export const DAY_NIGHT_SLIDERS: readonly SliderSpec<keyof DayNightParams>[] = [
  { key: 'timeOfDay', label: 'TIME OF DAY', min: 0, max: 24, step: 0.1, fmt: (v) => formatSolarClock(v) },
  {
    key: 'dayLengthHours',
    label: 'DAY LENGTH (REAL)',
    min: 0.02,
    max: 24,
    step: 0.02,
    fmt: (v) => (v < 1 ? `${Math.round(v * 60)}m (${v.toFixed(2)}h)` : `${v.toFixed(2)} h`),
  },
  { key: 'timeScale', label: 'TIME SCALE', min: 0, max: 100, step: 0.5, fmt: (v) => `${v.toFixed(1)}×` },
  { key: 'sunWarmth', label: 'DAWN/DUSK WARMTH', min: 0, max: 2.0, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'noonTempK', label: 'NOON SUN TEMP', min: 3500, max: 8500, step: 100, fmt: (v) => `${Math.round(v)} K` },
  { key: 'nightBrightness', label: 'NIGHT MOONLIGHT', min: 0, max: 1.0, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'shadowDayFactor', label: 'DAY/NIGHT SHADOW', min: 0, max: 1.5, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'projectorIntensity', label: 'PROJECTOR LIGHTS', min: 0, max: 2.0, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'fovDim', label: 'FOV FOG SHROUD', min: 0, max: 1.0, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
];

const pct = (v: number) => `${Math.round(v * 100)}%`;
const mul = (v: number) => `×${v.toFixed(2)}`;
/** Slider bounds straight from a lab store's clamp ranges, so the UI can never ask for a value the store rejects. */
const span = (r: readonly [number, number]) => ({ min: r[0], max: r[1] });
const WIND_NAMES = ['CALM', 'BREEZE', 'WINDY', 'GALE'] as const;
const windName = (v: number) => WIND_NAMES[v < 0.05 ? 0 : v < 1 ? 1 : v < 1.5 ? 2 : 3];
const WATER_TIERS = ['LOW', 'MED', 'HIGH'] as const;

export const WIND_SLIDERS: readonly SliderSpec<keyof WindParams>[] = [
  { key: 'directionDeg', label: 'DIRECTION (TOWARD)', ...span(WIND_RANGES.directionDeg), step: 1, fmt: (v) => `${Math.round(v)}°` },
  { key: 'strength', label: 'STRENGTH', ...span(WIND_RANGES.strength), step: 0.05, fmt: (v) => `${v.toFixed(2)} · ${windName(v)}` },
  { key: 'gust', label: 'GUST FRONTS', ...span(WIND_RANGES.gust), step: 0.01, fmt: pct },
  { key: 'turbulence', label: 'TURBULENCE / FLUTTER', ...span(WIND_RANGES.turbulence), step: 0.01, fmt: pct },
];

export const WATER_SLIDERS: readonly SliderSpec<keyof WaterParams>[] = [
  { group: 'WAVES', key: 'waveHeight', label: 'WAVE HEIGHT', ...span(WATER_RANGES.waveHeight), step: 0.05, fmt: mul },
  { group: 'WAVES', key: 'waveSteepness', label: 'STEEPNESS / CHOP', ...span(WATER_RANGES.waveSteepness), step: 0.01, fmt: pct },
  { group: 'WAVES', key: 'waveScale', label: 'WAVELENGTH', ...span(WATER_RANGES.waveScale), step: 0.05, fmt: mul },
  { group: 'WAVES', key: 'waveSpeed', label: 'WAVE SPEED', ...span(WATER_RANGES.waveSpeed), step: 0.05, fmt: mul },
  { group: 'SURFACE', key: 'detailNormal', label: 'RIPPLE DETAIL', ...span(WATER_RANGES.detailNormal), step: 0.05, fmt: pct },
  { group: 'SURFACE', key: 'roughness', label: 'ROUGHNESS', ...span(WATER_RANGES.roughness), step: 0.01, fmt: (v) => v.toFixed(2) },
  { group: 'SURFACE', key: 'absorption', label: 'ABSORPTION / MURK', ...span(WATER_RANGES.absorption), step: 0.05, fmt: mul },
  { group: 'SURFACE', key: 'parallax', label: 'BED PARALLAX', ...span(WATER_RANGES.parallax), step: 0.05, fmt: pct },
  { group: 'SURFACE', key: 'caustics', label: 'CAUSTICS', ...span(WATER_RANGES.caustics), step: 0.05, fmt: pct },
  { group: 'FOAM', key: 'foamAmount', label: 'FOAM AMOUNT', ...span(WATER_RANGES.foamAmount), step: 0.05, fmt: pct },
  { group: 'FOAM', key: 'foamWidth', label: 'SHORE FOAM WIDTH', ...span(WATER_RANGES.foamWidth), step: 0.1, fmt: (v) => `${v.toFixed(1)} m` },
  { group: 'REFLECTIONS', key: 'sunGlint', label: 'SUN GLINT', ...span(WATER_RANGES.sunGlint), step: 0.05, fmt: pct },
  { group: 'REFLECTIONS', key: 'projectorReflect', label: 'PROJECTOR REFLECTIONS', ...span(WATER_RANGES.projectorReflect), step: 0.05, fmt: pct },
  { group: 'FAUNA & QUALITY', key: 'faunaDensity', label: 'FISH DENSITY', ...span(WATER_RANGES.faunaDensity), step: 0.05, fmt: pct },
  { group: 'FAUNA & QUALITY', key: 'quality', label: 'SHADER TIER', ...span(WATER_RANGES.quality), step: 1, fmt: (v) => WATER_TIERS[Math.round(v)] ?? 'HIGH' },
];

const onOff = (v: number) => (v >= 0.5 ? 'ON' : 'OFF');
const RING_MODES = ['OFF', 'ON', 'ON + FREEZE FOCUS'] as const;
const fpsName = (v: number) => {
  const f = TARGET_FPS[Math.round(v)] ?? 'display';
  return f === 'display' ? 'DISPLAY RATE (≤ 120)' : `${f} FPS`;
};
const scaleName = (v: number) => {
  const s = RENDER_SCALES[Math.round(v)] ?? 'auto';
  return s === 'auto' ? 'AUTO (DYNAMIC)' : `×${s.toFixed(2)} FIXED`;
};

export const PERF_SLIDERS: readonly SliderSpec<keyof PerfParams>[] = [
  { group: 'RESOLUTION', key: 'renderScale', label: 'RENDER SCALE / PIXEL RATIO', ...span(PERF_RANGES.renderScale), step: 1, fmt: scaleName },
  { group: 'RESOLUTION', key: 'targetFps', label: 'AUTO TARGET FPS', ...span(PERF_RANGES.targetFps), step: 1, fmt: fpsName },
  { group: 'VIEW FOCUS', key: 'focusMargin', label: 'FOCUS MARGIN', ...span(PERF_RANGES.focusMargin), step: 0.05, fmt: mul },
  { group: 'VIEW FOCUS', key: 'focusRing', label: 'SHOW FOCUS RING (DEBUG)', ...span(PERF_RANGES.focusRing), step: 1, fmt: (v) => RING_MODES[Math.round(v)] ?? 'OFF' },
  { group: 'SHADOWS', key: 'daySecondaryShadow', label: 'DAYTIME SECONDARY SHADOW', ...span(PERF_RANGES.daySecondaryShadow), step: 1, fmt: onOff },
  { group: 'SHADOWS', key: 'nightSunShadow', label: 'NIGHT SUN SHADOW', ...span(PERF_RANGES.nightSunShadow), step: 1, fmt: onOff },
];
