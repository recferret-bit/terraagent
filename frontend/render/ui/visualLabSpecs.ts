import { formatSolarClock, type DayNightParams } from '../core/dayNightConfig';
import type { PixelArtParams } from '../core/pixelArtPass';
import type { ShadowParams } from '../core/shadowConfig';
import type { CrtParams } from './crt';

export type VisualTabId = 'crt' | 'pixel' | 'shadow' | 'daynight';

export interface SliderSpec<K extends string = string> {
  key: K;
  label: string;
  min: number;
  max: number;
  step: number;
  fmt: (v: number) => string;
}

export const VISUAL_TABS: readonly { id: VisualTabId; label: string; statusTitle: string }[] = [
  { id: 'crt', label: 'CRT', statusTitle: 'CRT OVERLAY STATUS (F9)' },
  { id: 'pixel', label: 'PIXEL', statusTitle: 'PIXEL SHADER STATUS (F10)' },
  { id: 'shadow', label: 'SHADOW', statusTitle: 'SUN & SHADOW STATUS (F7)' },
  { id: 'daynight', label: 'DAY/NIGHT', statusTitle: 'PLANETARY SOLAR CYCLE' },
];

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

export const SHADOW_SLIDERS: readonly SliderSpec<keyof ShadowParams>[] = [
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
];

export const SLIDERS_BY_TAB: Record<VisualTabId, readonly SliderSpec[]> = {
  crt: CRT_SLIDERS,
  pixel: PIXEL_SLIDERS,
  shadow: SHADOW_SLIDERS,
  daynight: DAY_NIGHT_SLIDERS,
};
