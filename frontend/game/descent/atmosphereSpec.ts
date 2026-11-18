import type {
  DescentAtmoLayer,
  DescentGasSample,
  DescentSolarPeriod,
} from '@terra/render/descent/types';
import {
  computeSolarState,
  formatSolarClock,
  getDayNightParams,
  isDayNightOn,
} from '@terra/render/core/dayNightConfig';
import type { PlanetKind } from '@terra/render/planets/PlanetSpec';
import { clamp, lerp, smoothstep } from './math';

export interface PlanetAtmosphereProfile {
  readonly kind: PlanetKind;
  readonly surfacePressureKpa: number;
  readonly surfaceDensityKgM3: number;
  readonly scaleHeightKm: number;
  readonly surfaceGravityG: number;
  readonly speedOfSoundMs: number;
  readonly daySurfaceTempC: number;
  readonly nightSurfaceTempC: number;
  readonly atmoSummary: string;
  readonly gases: readonly DescentGasSample[];
}

export const PLANET_ATMOSPHERES: Record<PlanetKind, PlanetAtmosphereProfile> = {
  dune: {
    kind: 'dune',
    surfacePressureKpa: 68.4,
    surfaceDensityKgM3: 0.86,
    scaleHeightKm: 9.4,
    surfaceGravityG: 0.92,
    speedOfSoundMs: 318,
    daySurfaceTempC: 43,
    nightSurfaceTempC: -9,
    atmoSummary: 'HYPOXIC · ARID SILICA',
    gases: [
      { formula: 'N₂', name: 'Nitrogen', pct: 68.2, role: 'inert' },
      { formula: 'CO₂', name: 'Carbon Dioxide', pct: 19.4, role: 'greenhouse' },
      { formula: 'O₂', name: 'Oxygen', pct: 9.8, role: 'oxidizer' },
      { formula: 'Ar', name: 'Argon', pct: 2.1, role: 'inert' },
      { formula: 'SiO₂', name: 'Silica Dust', pct: 0.5, role: 'trace' },
    ],
  },
  oceanForest: {
    kind: 'oceanForest',
    surfacePressureKpa: 124.6,
    surfaceDensityKgM3: 1.48,
    scaleHeightKm: 8.1,
    surfaceGravityG: 1.04,
    speedOfSoundMs: 349,
    daySurfaceTempC: 28,
    nightSurfaceTempC: 18,
    atmoSummary: 'BREATHABLE · HUMID O₂-RICH',
    gases: [
      { formula: 'N₂', name: 'Nitrogen', pct: 73.6, role: 'inert' },
      { formula: 'O₂', name: 'Oxygen', pct: 22.8, role: 'oxidizer' },
      { formula: 'H₂O', name: 'Water Vapor', pct: 2.6, role: 'greenhouse' },
      { formula: 'Ar', name: 'Argon', pct: 0.9, role: 'inert' },
      { formula: 'CO₂', name: 'Carbon Dioxide', pct: 0.1, role: 'trace' },
    ],
  },
  forestRock: {
    kind: 'forestRock',
    surfacePressureKpa: 101.3,
    surfaceDensityKgM3: 1.225,
    scaleHeightKm: 8.5,
    surfaceGravityG: 1.08,
    speedOfSoundMs: 338,
    daySurfaceTempC: 17,
    nightSurfaceTempC: -4,
    atmoSummary: 'BREATHABLE · TEMPERATE STD',
    gases: [
      { formula: 'N₂', name: 'Nitrogen', pct: 77.4, role: 'inert' },
      { formula: 'O₂', name: 'Oxygen', pct: 20.9, role: 'oxidizer' },
      { formula: 'Ar', name: 'Argon', pct: 1.2, role: 'inert' },
      { formula: 'CO₂', name: 'Carbon Dioxide', pct: 0.4, role: 'greenhouse' },
      { formula: 'CH₄', name: 'Methane', pct: 0.1, role: 'trace' },
    ],
  },
};

export function resolveAtmosphereProfile(kindOrType?: string | null): PlanetAtmosphereProfile {
  if (kindOrType === 'dune' || kindOrType === 'desert') return PLANET_ATMOSPHERES.dune;
  if (kindOrType === 'oceanForest' || kindOrType === 'ocean') return PLANET_ATMOSPHERES.oceanForest;
  return PLANET_ATMOSPHERES.forestRock;
}

export interface LiveSolarTelemetry {
  readonly hour: number;
  readonly daylight: number;
  readonly clockText: string;
  readonly period: DescentSolarPeriod;
}

/** Reads the live planetary solar clock (synced from `@terra/sim` in online/local play, or standalone `dayNightConfig`). */
export function readDescentSolarTelemetry(): LiveSolarTelemetry {
  if (!isDayNightOn()) {
    return { hour: 12, daylight: 1, clockText: formatSolarClock(12), period: 'DAY' };
  }
  const s = computeSolarState(getDayNightParams());
  return {
    hour: s.hour,
    daylight: s.daylight,
    clockText: s.clockText,
    period: s.period,
  };
}

export function classifyAtmoLayer(altKm: number): DescentAtmoLayer {
  if (altKm >= 140) return 'EXOSPHERE';
  if (altKm >= 80) return 'THERMOSPHERE';
  if (altKm >= 45) return 'MESOSPHERE';
  if (altKm >= 14) return 'STRATOSPHERE';
  if (altKm >= 1.2) return 'TROPOSPHERE';
  return 'BOUNDARY';
}

export function computeBarometricState(
  profile: PlanetAtmosphereProfile,
  altKm: number,
  speedKmh: number,
): { staticPressureKpa: number; dynamicPressureKpa: number; densityKgM3: number; ppO2Kpa: number; mach: number } {
  const z = Math.max(0, altKm);
  // Smooth cutoff above 115 km so orbital vacuum reads true 0.00 kPa
  const vacFade = 1 - smoothstep(95, 130, z);
  const expFactor = Math.exp(-z / profile.scaleHeightKm) * vacFade;
  const staticPressureKpa = profile.surfacePressureKpa * expFactor;
  const rho = profile.surfaceDensityKgM3 * expFactor;
  const o2Pct = profile.gases.find((g) => g.formula === 'O₂')?.pct ?? 0;
  const ppO2Kpa = staticPressureKpa * (o2Pct / 100);
  const speedMs = Math.max(0, speedKmh) / 3.6;
  const dynamicPressureKpa = 0.5 * rho * speedMs * speedMs * 0.001;
  // Local sound speed cools slightly in upper atmosphere (~0.82x at tropopause/mesosphere)
  const soundScale = lerp(1.0, 0.82, clamp(z / 28, 0, 1));
  const localSoundMs = Math.max(220, profile.speedOfSoundMs * soundScale);
  const mach = speedMs / localSoundMs;
  return { staticPressureKpa, dynamicPressureKpa, densityKgM3: rho, ppO2Kpa, mach };
}

/** Surface air temperature modulated by live day/night cycle, cooling through mesopause into solar-lit/umbra exosphere. */
export function computeAmbientAirTempC(
  profile: PlanetAtmosphereProfile,
  daylight: number,
  altKm: number,
): number {
  const dl = clamp(daylight, 0, 1);
  const surfC = lerp(profile.nightSurfaceTempC, profile.daySurfaceTempC, dl);
  if (altKm <= 0.05) return surfC;
  const lapseC = Math.min(altKm, 14) * 5.2;
  const mesopauseC = -92 + 8 * dl;
  const exoOrbitC = lerp(-168, -118, dl);
  const upperCold = lerp(surfC - lapseC, mesopauseC, smoothstep(14, 88, altKm));
  return lerp(upperCold, exoOrbitC, smoothstep(88, 420, altKm));
}
