import type {
  DescentAtmoStatus,
  DescentBeaconState,
  DescentCommsState,
  DescentGuidanceState,
  DescentPhase,
  DescentPodSystems,
  DescentTelemetry,
  DescentThermalState,
} from '@terra/render/descent/types';
import type { PlanetKind } from '@terra/render/planets/PlanetSpec';
import {
  classifyAtmoLayer,
  computeAmbientAirTempC,
  computeBarometricState,
  readDescentSolarTelemetry,
  resolveAtmosphereProfile,
  type PlanetAtmosphereProfile,
} from './atmosphereSpec';
import { clamp, lerp, makeCurve, smoother, smoothstep } from './math';
import { TL, Y0 } from './constants';

const PHASES: [number, DescentPhase][] = [
  [4, 'orbit'],
  [8, 'release'],
  [15, 'freefall'],
  [23, 'reentry'],
  [29, 'chute'],
  [32, 'approach'],
  [34, 'retro'],
  [99, 'touchdown'],
];
export const phaseOf = (t: number): DescentPhase => {
  for (const [e, p] of PHASES) if (t < e) return p;
  return 'touchdown';
};

// 3D pod altitude above ground in world units (carrier-docked until 4 s; 21 m at tn=32 retro handoff; 0 m at tn=34)
export const altCurve = makeCurve([
  [0, Y0], [4, Y0], [8, 585], [15, 470], [23, 230], [29, 72], [32, 21], [34, 0], [35, 0],
]);
export const streakSpeed = makeCurve([
  [0, 0], [8, 0], [10, 60], [15, 180], [19, 260], [23, 150], [26, 30], [29, 0],
]);

// True telemetry altitude (km): 412.6 km station -> deorbit -> ~96 km entry interface -> ~39 km Max-Q -> 14.5 km chute -> 0.021 km (21 m) at tn=32 -> 0 km at tn=34
const telemetryAltKmCurve = makeCurve([
  [0, 412.6],
  [3.6, 412.4],
  [5.5, 404.0],
  [8, 336.0],
  [12, 194.0],
  [15, 96.0],
  [19, 39.5],
  [23, 14.5],
  [26.8, 4.1],
  [29, 0.68],
  [32, 0.021],
  [34, 0],
  [35, 0],
]);

export function heatEnvelopeAt(tn: number, dens: number): number {
  return clamp(smoothstep(14.8, 19, tn) * (1 - smoothstep(22, 28, tn)) * (0.6 + 0.5 * dens));
}

function altitudeKmAt(tn: number): number {
  if (tn >= 34) return 0;
  if (tn >= 32) {
    // Match PodTouchdownFx constant-deceleration braking: y(u) = 21 m * (1 - u)^2 over tn 32..34
    const u = clamp((tn - 32) / 2, 0, 1);
    const decel = 1 - u;
    return 0.021 * decel * decel;
  }
  return Math.max(0, telemetryAltKmCurve(tn));
}

function speedKmhAt(tn: number, dens: number, gravityG: number): number {
  if (tn >= 34) return 0;
  // Steady LEO orbital velocity while docked in the carrier bay (`0..3.8s`); deorbit burn fires upon separation (`3.8..5.5s`)
  if (tn < 3.8) return lerp(27640, 27646, smoother(0, 3.8, tn));
  if (tn < 5.5) return lerp(27646, 27160, smoother(3.8, 5.5, tn));
  const entryPeak = 27160 + 1310 * gravityG; // gravity well accelerates pod during vacuum freefall
  if (tn < 13.8) return lerp(27160, entryPeak, Math.pow(clamp((tn - 5.5) / 8.3, 0, 1), 1.18));
  const shieldSepSpd = 2380 - 620 * dens;
  if (tn < 23) {
    const u = clamp((tn - 13.8) / 9.2, 0, 1);
    const brake = Math.pow(smoother(0, 1, u), 0.88 + 0.25 * dens);
    return lerp(entryPeak, shieldSepSpd, brake);
  }
  const chuteTermSpd = 385 - 180 * dens;
  if (tn < 29) return lerp(shieldSepSpd, chuteTermSpd, Math.pow(smoother(23, 29, tn), 0.72));
  // Approach burn brakes to 86.4 km/h (24.0 m/s) at 21 m (`tn = 32`), matching 2 * 21 m / 1.75 s constant-decel touchdown
  const retroEntrySpd = 86.4;
  if (tn < 32) return lerp(chuteTermSpd, retroEntrySpd, smoother(29, 32, tn));
  const uRetro = clamp((tn - 32) / 2, 0, 1);
  return retroEntrySpd * (1 - uRetro);
}

function downrangeKmAt(tn: number): number {
  if (tn >= 32) return 0;
  if (tn < 4) return lerp(684, 642, clamp(tn / 4, 0, 1));
  return 642 * Math.pow(1 - smoother(4, 32, tn), 1.65);
}

function guidanceStateAt(tn: number): DescentGuidanceState {
  if (tn < 4) return 'ORBITAL NAV';
  if (tn < 14.6) return 'ENTRY CORRIDOR';
  if (tn < 23.0) return 'PLASMA INERTIAL';
  if (tn < 34.0) return 'RADAR ALT LOCK';
  return 'PAD CONTACT';
}

function beaconStateAt(tn: number, comms: DescentCommsState): DescentBeaconState {
  if (tn < 2.2) return 'STANDBY';
  if (comms === 'BLACKOUT') return 'BLACKOUT';
  if (tn < 23.0) return 'ORBITAL';
  if (tn < 29.0) return 'ACQUIRED';
  return 'LOCKED';
}

function podSystemsAt(tn: number): DescentPodSystems {
  return {
    clamps:
      tn < 2.2
        ? { code: 'CLMP', text: 'LOCKED', state: 'stby' }
        : tn < 3.8
          ? { code: 'CLMP', text: 'OPENING', state: 'act' }
          : { code: 'CLMP', text: 'FREE', state: 'ok' },
    shield:
      tn < 14.6
        ? { code: 'SHLD', text: 'ARMED', state: 'stby' }
        : tn < 23.0
          ? { code: 'SHLD', text: 'ABLATE', state: 'warn' }
          : { code: 'SHLD', text: 'JETT', state: 'ok' },
    chute:
      tn < 23.1
        ? { code: 'CHUT', text: 'STOWED', state: 'stby' }
        : tn < 24.4
          ? { code: 'CHUT', text: 'DEPLOY', state: 'act' }
          : tn < 29.3
            ? { code: 'CHUT', text: 'CANOPY', state: 'act' }
            : { code: 'CHUT', text: 'CUT', state: 'ok' },
    retro:
      tn < 28.9
        ? { code: 'RTRO', text: 'ARMED', state: 'stby' }
        : tn < 34.0
          ? { code: 'RTRO', text: 'FIRING', state: 'warn' }
          : { code: 'RTRO', text: 'CUTOFF', state: 'ok' },
    gear:
      tn < 24.5
        ? { code: 'GEAR', text: 'STOWED', state: 'stby' }
        : tn < 27.5
          ? { code: 'GEAR', text: 'EXTEND', state: 'act' }
          : tn < 34.0
            ? { code: 'GEAR', text: 'LOCKED', state: 'ok' }
            : { code: 'GEAR', text: 'CONTACT', state: 'ok' },
    hatch:
      tn < 34.0
        ? { code: 'HTCH', text: 'SEALED', state: 'stby' }
        : tn < 34.45
          ? { code: 'HTCH', text: 'EQUALIZE', state: 'act' }
          : { code: 'HTCH', text: 'UNLATCH', state: 'ok' },
  };
}

/** Branch-free C1-smooth G-load curve from microgravity -> aerobraking -> chute shock -> retro burn -> surface G. */
function gForceAt(tn: number, dens: number, surfaceG: number): number {
  const microBase = 0.01 * smoothstep(1.5, 3.5, tn) + 0.03 * smoothstep(5.0, 12.2, tn);
  const sepKick = 0.38 * Math.exp(-Math.pow((tn - 4.25) / 0.42, 2));
  const aeroPeak = 5.6 + 3.8 * dens;
  const aeroTarget = lerp(aeroPeak, 2.1, smoothstep(19.6, 23.2, tn));
  const aero = lerp(microBase, aeroTarget, smoothstep(12.2, 18.8, tn));

  const chuteRipple = 0.07 * Math.sin(tn * 5.2) * smoothstep(24.5, 25.5, tn) * (1 - smoothstep(27.5, 29.0, tn));
  const chuteSteady = surfaceG + chuteRipple;
  const baseLoad = lerp(aero, chuteSteady, smoothstep(23.2, 25.4, tn));

  const chuteShock = 3.15 * Math.exp(-Math.pow((tn - 24.15) / 0.48, 2)) * smoothstep(23.0, 23.4, tn) * (1 - smoothstep(25.8, 26.5, tn));
  const unloadDip = -0.62 * Math.exp(-Math.pow((tn - 29.45) / 0.36, 2)) * smoothstep(28.6, 29.0, tn);
  const retroBurn = (1.85 + 0.35 * surfaceG) * smoothstep(29.7, 30.8, tn) * (1 - smoothstep(33.7, 34.15, tn));
  const impactJolt = 2.4 * Math.exp(-Math.pow((tn - 34.02) / 0.16, 2)) * smoothstep(33.5, 33.85, tn);
  return Math.max(0, baseLoad + sepKick + chuteShock + unloadDip + retroBurn + impactJolt);
}

/** C0-continuous thermal protection system & hull temperature curve across 0..35 s. */
function hullTempAt(tn: number, heat: number, dens: number, surfaceTempC: number): { tempC: number; state: DescentThermalState } {
  if (tn < 4) {
    const c = lerp(18, -58, smoother(0.1, 4.0, tn));
    return { tempC: c, state: tn < 1.1 ? 'BAY STANDBY' : 'VACUUM VENT' };
  }
  if (tn < 8.2) {
    return { tempC: lerp(-58, -112, Math.pow(clamp((tn - 4.0) / 4.2, 0, 1), 0.82)), state: 'COLD SOAK' };
  }
  if (tn < 14.8) {
    const u = clamp((tn - 8.2) / 6.6, 0, 1);
    return { tempC: lerp(-112, 345, Math.pow(u, 1.45)), state: 'SLIP HEATING' };
  }
  const plasmaPeak = 1520 + 820 * dens;
  if (tn < 22.9) {
    const base = lerp(345, 420, smoothstep(14.8, 22.9, tn));
    const shimmerEnv = smoothstep(15.5, 16.5, tn) * (1 - smoothstep(21.6, 22.9, tn));
    const shimmer = 9 * Math.sin(tn * 19.3) * Math.max(0, heat) * shimmerEnv;
    return { tempC: base + plasmaPeak * Math.pow(Math.max(0, heat), 0.85) + shimmer, state: 'PLASMA ABLATION' };
  }
  if (tn < 24.6) {
    const atSep = 420 + plasmaPeak * Math.pow(Math.max(0, heatEnvelopeAt(22.9, dens)), 0.85);
    return { tempC: lerp(atSep, 365, smoother(22.9, 24.6, tn)), state: 'SHIELD SEP' };
  }
  if (tn < 28.9) {
    return { tempC: lerp(365, 48, smoother(24.6, 28.9, tn)), state: 'CONVECTIVE COOL' };
  }
  const settledHullC = surfaceTempC + 22;
  if (tn < 34.0) {
    const plume = 116 * smoothstep(28.9, 31.6, tn) * (1 - 0.45 * smoothstep(32.8, 34.0, tn));
    const base = lerp(48, settledHullC + 18, smoothstep(28.9, 34.0, tn));
    return { tempC: base + plume, state: 'RETRO WASH' };
  }
  const at34 = settledHullC + 18 + 116 * 0.55;
  return { tempC: lerp(at34, settledHullC, smoother(34.0, 35.0, tn)), state: 'AMBIENT' };
}

function commsAt(tn: number, heat: number): { state: DescentCommsState; pct: number } {
  if (heat >= 0.56 || (tn >= 16.6 && tn <= 21.6 && heat >= 0.42)) {
    return { state: 'BLACKOUT', pct: 0 };
  }
  if (heat >= 0.22) {
    const pct = Math.round(lerp(88, 14, clamp((heat - 0.22) / 0.34, 0, 1)));
    return { state: 'DEGRADED', pct };
  }
  const jitter = Math.round(2 * Math.sin(tn * 3.7));
  return { state: 'LOCKED', pct: clamp(98 + jitter, 94, 100) };
}

function caption(t: number, name: string, blackout: boolean): string {
  if (t < 2) return 'Carrier on station — drop bay arming';
  if (t < 4) return 'Bay open — umbilical vented, clamps releasing';
  if (t < 8) return 'Drop pod away — deorbit burn nominal';
  if (t < 14.5) return 'Gravity well freefall — entry corridor locked';
  if (blackout) return 'RF ionization blackout — peak plasma compression';
  if (t < 23) return 'Atmospheric interface — aerobraking active';
  if (t < 26) return 'Heat shield jettisoned — main chute deploying';
  if (t < 29) return 'Canopy stable — punching through the cloud deck';
  if (t < 32) return 'Chute jettisoned — terminal approach vector';
  if (t < 34) return 'Retro-thrusters firing — brace for touchdown';
  if (t < 34.6) return 'Touchdown confirmed — equalizing pressure';
  return `Surface contact — welcome to ${name}`;
}

const PEAK_STEP = 0.05;
const PEAK_COUNT = Math.round(TL / PEAK_STEP) + 1;

function buildPeakGTable(dens: number, surfaceG: number): Float32Array {
  const tbl = new Float32Array(PEAK_COUNT);
  let hi = 0;
  for (let i = 0; i < PEAK_COUNT; i++) {
    hi = Math.max(hi, gForceAt(i * PEAK_STEP, dens, surfaceG));
    tbl[i] = hi;
  }
  return tbl;
}

/** Pure, deterministic HUD telemetry derived from the authored timeline, atmosphere profile, and live solar clock. */
export class Telemetry {
  private profile!: PlanetAtmosphereProfile;
  private peakGTable!: Float32Array;

  constructor(
    private dens: number,
    private name: string,
    private duration: number,
    private tScale: number,
    planetKind?: PlanetKind | string,
  ) {
    this.setPlanet(dens, name, planetKind);
  }

  setPlanet(dens: number, name: string, planetKind?: PlanetKind | string): void {
    this.dens = dens;
    this.name = name;
    this.profile = resolveAtmosphereProfile(planetKind ?? (dens < 0.5 ? 'dune' : dens > 0.62 ? 'oceanForest' : 'forestRock'));
    this.peakGTable = buildPeakGTable(this.dens, this.profile.surfaceGravityG);
  }

  resetPeak(): void {
    // Kept for API compatibility; peakG is now derived purely from `peakGTable` without mutable state.
  }

  private peakGAt(tn: number, currentG: number): number {
    const idx = Math.min(PEAK_COUNT - 1, Math.max(0, Math.floor(tn / PEAK_STEP)));
    return Math.max(currentG, this.peakGTable[idx] ?? currentG);
  }

  /** Writes the telemetry for authored second `tn` (with the live plasma `heat` envelope) into `out`. */
  fill(out: DescentTelemetry, tn: number, heat?: number): DescentTelemetry {
    const clampedTn = clamp(tn, 0, TL);
    const effHeat = heat ?? heatEnvelopeAt(clampedTn, this.dens);
    const solar = readDescentSolarTelemetry();
    const surfaceTempC = lerp(this.profile.nightSurfaceTempC, this.profile.daySurfaceTempC, solar.daylight);
    const altKm = altitudeKmAt(clampedTn);
    const speedKmh = speedKmhAt(clampedTn, this.dens, this.profile.surfaceGravityG);
    const gForce = gForceAt(clampedTn, this.dens, this.profile.surfaceGravityG);
    const peakG = this.peakGAt(clampedTn, gForce);

    const baro = computeBarometricState(this.profile, altKm, speedKmh);
    const thermal = hullTempAt(clampedTn, effHeat, this.dens, surfaceTempC);
    const dtEps = 0.04;
    const tPrev = Math.max(0, clampedTn - dtEps);
    const tNext = Math.min(TL, clampedTn + dtEps);
    const tempPrev = hullTempAt(tPrev, heatEnvelopeAt(tPrev, this.dens), this.dens, surfaceTempC).tempC;
    const tempNext = hullTempAt(tNext, heatEnvelopeAt(tNext, this.dens), this.dens, surfaceTempC).tempC;
    const hullTempRateCs = ((tempNext - tempPrev) / Math.max(1e-4, tNext - tPrev)) * this.tScale;

    const comms = commsAt(clampedTn, effHeat);
    const intake = clamp(smoothstep(10.8, 18.2, clampedTn), 0, 1);
    const atmoStatus: DescentAtmoStatus =
      intake < 0.05 ? 'VACUUM TRACE' : intake < 0.96 ? 'IONIZED INTAKE' : 'ANALYSIS LOCKED';

    const vertFrac = 0.00015 + 0.99985 * smoothstep(3.8, 25.0, clampedTn);
    const verticalSpeedMs = (speedKmh / 3.6) * vertFrac;

    out.t = clampedTn / this.tScale;
    out.duration = this.duration;
    out.progress = clamp(clampedTn / TL);
    out.phase = phaseOf(clampedTn);
    out.altitudeKm = altKm;
    out.speedKmh = speedKmh;
    out.gForce = gForce;
    out.peakG = peakG;
    out.heatPct = effHeat * 100;
    out.hullTempC = thermal.tempC;
    out.hullTempRateCs = hullTempRateCs;
    out.thermalState = thermal.state;
    out.mach = baro.mach;
    out.verticalSpeedMs = verticalSpeedMs;
    out.staticPressureKpa = baro.staticPressureKpa;
    out.dynamicPressureKpa = baro.dynamicPressureKpa;
    out.atmoDensityKgM3 = baro.densityKgM3;
    out.ppO2Kpa = baro.ppO2Kpa;
    out.downrangeKm = downrangeKmAt(clampedTn);
    out.guidanceState = guidanceStateAt(clampedTn);
    out.beaconState = beaconStateAt(clampedTn, comms.state);
    out.radarAltM = clampedTn >= 23.0 ? altKm * 1000 : null;
    out.podSystems = podSystemsAt(clampedTn);
    out.isMaxQ = clampedTn >= 16.5 && clampedTn <= 20.2 && baro.dynamicPressureKpa > 12;
    out.atmoLayer = classifyAtmoLayer(altKm);
    out.commsState = comms.state;
    out.commsSignalPct = comms.pct;
    out.surfaceGravityG = this.profile.surfaceGravityG;
    out.ambientTempC = computeAmbientAirTempC(this.profile, solar.daylight, altKm);
    out.localSolarClock = solar.clockText;
    out.localDayPeriod = solar.period;
    out.intakeProgress = intake;
    out.atmoStatus = atmoStatus;
    out.atmoSummary = this.profile.atmoSummary;
    out.atmoGases = this.profile.gases;
    out.caption = caption(clampedTn, this.name, comms.state === 'BLACKOUT');
    return out;
  }

  /** Fresh telemetry for any authored second (computes exact heat envelope for `tn`). */
  at = (tn: number): DescentTelemetry =>
    this.fill(
      {
        t: 0,
        duration: this.duration,
        progress: 0,
        phase: 'orbit',
        altitudeKm: 0,
        speedKmh: 0,
        gForce: 0,
        heatPct: 0,
        hullTempC: 18,
        caption: '',
      },
      tn,
      heatEnvelopeAt(tn, this.dens),
    );
}
