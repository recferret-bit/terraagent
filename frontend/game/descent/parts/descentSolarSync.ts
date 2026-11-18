import * as THREE from 'three';
import {
  computeSolarState,
  getDayNightParams,
  isDayNightOn,
  wrapSolarHour,
  type DayNightParams,
} from '@terra/render/core/dayNightConfig';
import { skipDaySecondaryShadow, skipNightSunShadow } from '@terra/render/core/perfConfig';
import {
  computeSunOffset,
  getShadowParams,
  isShadowOn,
  type ShadowParams,
} from '@terra/render/core/shadowConfig';
import { daySecondaryShadowFade, nightSunShadowFade } from '@terra/render/core/shadowFit';
import type { PlanetSpec } from '@terra/render/planets/PlanetSpec';
import { clamp, lerp, smoothstep } from '../math';

/** Space-side daylight baseline (and basis for orbital terminator / umbra attenuation). */
export const SPACE_SUN = new THREE.Color(1.0, 0.96, 0.88);
export const SPACE_HEMI = new THREE.Color(0.45, 0.55, 0.85);
export const SPACE_HEMI_GROUND = new THREE.Color(0.04, 0.04, 0.07);
export const SPACE_SUN_INTENSITY = 3.4;

const STATIC_SPACE_SUN_DIR = new THREE.Vector3(35, 55, 25).normalize();
const NIGHT_SPACE_HEMI = new THREE.Color(0.06, 0.1, 0.22);
const NIGHT_SPACE_GROUND = new THREE.Color(0.01, 0.015, 0.03);

export interface SpaceEntrySolar {
  readonly entrySunDir: THREE.Vector3;
  readonly spaceLit: number;
  readonly sunColor: THREE.Color;
  readonly sunIntensity: number;
  readonly hemiColor: THREE.Color;
  readonly hemiGround: THREE.Color;
  readonly hemiIntensity: number;
  readonly envIntensity: number;
  readonly exposure: number;
  readonly bloom: number;
}

export function createSpaceEntrySolar(): { -readonly [K in keyof SpaceEntrySolar]: SpaceEntrySolar[K] } {
  return {
    entrySunDir: STATIC_SPACE_SUN_DIR.clone(),
    spaceLit: 1,
    sunColor: SPACE_SUN.clone(),
    sunIntensity: SPACE_SUN_INTENSITY,
    hemiColor: SPACE_HEMI.clone(),
    hemiGround: SPACE_HEMI_GROUND.clone(),
    hemiIntensity: 0.3,
    envIntensity: 0.3,
    exposure: 1.0,
    bloom: 0.4,
  };
}

/**
 * Computes orbital entry sun direction (`tn = startAt`) and orbital umbra/terminator lighting so `OrbitalStage`
 * (`T = 0..9.6s`) and `SkyRig` (`tn >= 9`) share identical entry corridor geometry and space-side lighting.
 */
export function computeSpaceEntrySolar(
  target: DescentSolarTarget,
  savedBloom: number,
  out: { -readonly [K in keyof SpaceEntrySolar]: SpaceEntrySolar[K] } = createSpaceEntrySolar(),
): SpaceEntrySolar {
  if (!isDayNightOn()) {
    out.entrySunDir.copy(STATIC_SPACE_SUN_DIR);
    out.spaceLit = 1;
    out.sunColor.copy(SPACE_SUN);
    out.sunIntensity = SPACE_SUN_INTENSITY;
    out.hemiColor.copy(SPACE_HEMI);
    out.hemiGround.copy(SPACE_HEMI_GROUND);
    out.hemiIntensity = 0.3;
    out.envIntensity = 0.3;
    out.exposure = 1.0;
    out.bloom = savedBloom;
    return out;
  }

  const astroSin = clamp(target.astroSunDir.y, -1, 1);
  // Clamp orbital entry depression to -22° so night dives land squarely in the globe's dark umbra (`ndlg = -0.375`, `term = 0`)
  // while staying well on the camera-facing front hemisphere (`ne.z >= 0.48`) of `OrbitalStage`.
  const minEntrySin = Math.sin(THREE.MathUtils.degToRad(-22));
  const entrySin = Math.max(minEntrySin, astroSin);
  const horizLen = Math.hypot(target.astroSunDir.x, target.astroSunDir.z);
  const entryHoriz = Math.sqrt(Math.max(0, 1 - entrySin * entrySin));
  if (horizLen > 1e-6) {
    out.entrySunDir.set(
      (target.astroSunDir.x / horizLen) * entryHoriz,
      entrySin,
      (target.astroSunDir.z / horizLen) * entryHoriz,
    ).normalize();
  } else {
    out.entrySunDir.set(entryHoriz, entrySin, 0).normalize();
  }

  const spaceLit = smoothstep(-0.18, 0.22, astroSin);
  out.spaceLit = spaceLit;
  const umbraSunI = 0.22 + 0.45 * target.nightBrightness;
  out.sunIntensity = lerp(umbraSunI, SPACE_SUN_INTENSITY, spaceLit);
  out.sunColor.copy(target.sunColor).lerp(SPACE_SUN, spaceLit * (1 - 0.65 * target.twilight));
  out.hemiColor.copy(NIGHT_SPACE_HEMI).lerp(SPACE_HEMI, spaceLit).lerp(target.hemiSky, target.twilight * 0.35);
  out.hemiGround.copy(NIGHT_SPACE_GROUND).lerp(SPACE_HEMI_GROUND, spaceLit);
  out.hemiIntensity = lerp(0.14 + 0.12 * target.nightBrightness, 0.3, spaceLit);
  out.envIntensity = lerp(0.1 + 0.14 * target.nightBrightness, 0.3, spaceLit);
  out.exposure = 1.0;
  out.bloom = savedBloom + 0.06 * (1 - spaceLit);
  return out;
}

export interface DescentSolarTarget {
  readonly hour: number;
  readonly daylight: number;
  readonly twilight: number;
  readonly nightFactor: number;
  /** Matches `entityVisionSync` (`max(1 - daylight, nightGateRaw * 0.88)`) so `uNightFactor` never steps at tn=32. */
  readonly shaderNightFactor: number;
  readonly nightBrightness: number;
  readonly skyTop: THREE.Color;
  readonly skyHorizon: THREE.Color;
  readonly hemiSky: THREE.Color;
  readonly hemiGround: THREE.Color;
  readonly sunColor: THREE.Color;
  readonly sunIntensity: number;
  readonly secondaryIntensity: number;
  readonly primaryShadowIntensity: number;
  readonly secondaryShadowIntensity: number;
  readonly sunShadowRadius: number;
  readonly hemiIntensity: number;
  readonly envIntensity: number;
  readonly bloomStrength: number;
  readonly exposure: number;
  readonly cloudColor: THREE.Color;
  readonly hazeColor: THREE.Color;
  /** Surface directional light direction (matches `shadowConfig.computeSunOffset`). */
  readonly keySunDir: THREE.Vector3;
  /** True astronomical sun direction at landing site (`y < 0` below horizon at night so globe terminator matches). */
  readonly astroSunDir: THREE.Vector3;
}

const _tmpColor = new THREE.Color();
const _tmpNight = new THREE.Color();
const _tmpOffset = new THREE.Vector3();
const _tmpParams: DayNightParams = { ...getDayNightParams() };

/** Maximum slew speed (solar hours per real second) when catching up to a delayed server `welcome` clock jump. */
const SLEW_HOURS_PER_SEC = 9.6;

function createMutableTarget(): {
  -readonly [K in keyof DescentSolarTarget]: DescentSolarTarget[K];
} {
  return {
    hour: 12,
    daylight: 1,
    twilight: 0,
    nightFactor: 0,
    shaderNightFactor: 0,
    nightBrightness: 0.12,
    skyTop: new THREE.Color(),
    skyHorizon: new THREE.Color(),
    hemiSky: new THREE.Color(),
    hemiGround: new THREE.Color(),
    sunColor: new THREE.Color(),
    sunIntensity: 2.25,
    secondaryIntensity: 0,
    primaryShadowIntensity: 1.18,
    secondaryShadowIntensity: 0,
    sunShadowRadius: 1.15,
    hemiIntensity: 0.58,
    envIntensity: 0.67,
    bloomStrength: 0.4,
    exposure: 0.88,
    cloudColor: new THREE.Color(),
    hazeColor: new THREE.Color(),
    keySunDir: new THREE.Vector3(0, 1, 0),
    astroSunDir: new THREE.Vector3(0, 1, 0),
  };
}

function evalShadowTargets(
  sp: Readonly<ShadowParams>,
  shadowOn: boolean,
  nightFactor: number,
  moonIntensityMult: number,
  moonShadowMult: number,
  basePrimaryShadow: number,
): { secIntensity: number; primShadow: number; secShadow: number } {
  const mode = Math.round(clamp(sp.shadowSourceMode, 0, 3));
  const secActive = shadowOn && sp.secondaryShadowEnabled >= 0.5 && mode !== 3;
  if (mode === 3 || !secActive) {
    return { secIntensity: 0, primShadow: shadowOn ? basePrimaryShadow : 0, secShadow: 0 };
  }
  if (mode === 2) {
    return {
      secIntensity: sp.secondaryIntensity,
      primShadow: 0,
      secShadow: clamp(sp.nightShadowIntensity, 0, 1.6),
    };
  }
  if (mode === 1) {
    return {
      secIntensity: sp.secondaryIntensity,
      primShadow: shadowOn ? Math.max(basePrimaryShadow, sp.nightShadowIntensity * 0.5) : 0,
      secShadow: clamp(Math.max(sp.nightShadowIntensity, sp.shadowIntensity * 0.65), 0, 1.6),
    };
  }
  const t = clamp(nightFactor, 0, 1);
  const primShadow = shadowOn ? basePrimaryShadow * nightSunShadowFade(t, skipNightSunShadow()) : 0;
  const secIntensity = sp.secondaryIntensity * lerp(0.18, moonIntensityMult, t);
  const secShadow = clamp(
    sp.nightShadowIntensity * lerp(0.15, moonShadowMult, t) * daySecondaryShadowFade(t, skipDaySecondaryShadow()),
    0,
    1.6,
  );
  return { secIntensity, primShadow, secShadow };
}

function evalStaticSunTarget(
  o: { -readonly [K in keyof DescentSolarTarget]: DescentSolarTarget[K] },
  spec: PlanetSpec,
  sp: Readonly<ShadowParams>,
  shadowOn: boolean,
): DescentSolarTarget {
  const s = spec.sky;
  const elevFactor = THREE.MathUtils.smoothstep(sp.sunElevation, 8, 34);
  o.hour = 12;
  o.daylight = 1;
  o.twilight = 0;
  o.nightFactor = 0;
  o.shaderNightFactor = 0;
  o.nightBrightness = 0.12;
  o.skyTop.setHex(s.skyColor);
  o.skyHorizon.setHex(s.fogColor);
  o.hemiSky.setHex(s.ambientSky ?? s.skyColor);
  o.hemiGround.setHex(s.ambientGround ?? s.hemiGround);
  o.sunColor.setHex(s.sunColor).lerp(_tmpColor.setHex(0xff8e47), (1 - elevFactor) * 0.55);
  o.sunIntensity = sp.sunIntensity * (0.72 + 0.28 * elevFactor);
  const sh = evalShadowTargets(sp, shadowOn, 0, 0.18, 0.15, sp.shadowIntensity);
  o.secondaryIntensity = sh.secIntensity;
  o.primaryShadowIntensity = sh.primShadow;
  o.secondaryShadowIntensity = sh.secShadow;
  o.sunShadowRadius = sp.shadowSoftness;
  o.hemiIntensity = sp.ambientIntensity;
  o.envIntensity = sp.ambientIntensity * 1.15;
  o.bloomStrength = sp.bloomStrength;
  o.cloudColor.setHex(spec.orbital.cloudColor);
  o.hazeColor.setHex(s.horizonColor).lerp(o.cloudColor, 0.5);
  computeSunOffset(_tmpOffset, sp);
  o.keySunDir.copy(_tmpOffset).normalize();
  o.astroSunDir.copy(o.keySunDir);
  return o;
}

export class DescentSolarEvaluator {
  private readonly out = createMutableTarget();
  private displayHour: number | null = null;
  private slewing = false;

  reset(): void {
    this.displayHour = null;
    this.slewing = false;
  }

  private stepDisplayHour(targetHour: number, dtSec: number): number {
    const wrappedTarget = wrapSolarHour(targetHour);
    if (this.displayHour === null || (dtSec <= 0 && !this.slewing)) {
      this.displayHour = wrappedTarget;
      this.slewing = false;
      return wrappedTarget;
    }
    if (dtSec <= 0) {
      return this.displayHour;
    }
    let diff = wrapSolarHour(wrappedTarget - this.displayHour);
    if (diff > 12) diff -= 24;
    if (!this.slewing && Math.abs(diff) < 0.25) {
      this.displayHour = wrappedTarget;
      return wrappedTarget;
    }
    this.slewing = true;
    const maxStep = SLEW_HOURS_PER_SEC * Math.min(dtSec, 0.1);
    if (Math.abs(diff) <= maxStep) {
      this.displayHour = wrappedTarget;
      this.slewing = false;
    } else {
      this.displayHour = wrapSolarHour(this.displayHour + Math.sign(diff) * maxStep);
    }
    return this.displayHour;
  }

  /** Evaluates the exact surface sky/light/shadow target for the live `dayNightConfig` + `shadowConfig` state. */
  evaluate(spec: PlanetSpec, dtSec = 0): DescentSolarTarget {
    const o = this.out;
    const sp = getShadowParams();
    const shadowOn = isShadowOn();
    const s = spec.sky;
    o.exposure = s.exposure;

    if (!isDayNightOn()) {
      this.reset();
      return evalStaticSunTarget(o, spec, sp, shadowOn);
    }

    const dn = getDayNightParams();
    const effHour = this.stepDisplayHour(dn.timeOfDay, dtSec);
    Object.assign(_tmpParams, dn, { timeOfDay: effHour });
    const solar = computeSolarState(_tmpParams, sp.sunAzimuth, sp.sunElevation, s.sunColor);
    const nightFactor = 1 - solar.daylight;
    const rawSin = Math.sin(((solar.hour / 24) - 0.25) * Math.PI * 2);
    const nightGateRaw = THREE.MathUtils.smoothstep(-rawSin, 0.001, 0.035);

    o.hour = solar.hour;
    o.daylight = solar.daylight;
    o.twilight = solar.twilight;
    o.nightFactor = nightFactor;
    o.shaderNightFactor = Math.max(nightFactor, nightGateRaw * 0.88);
    o.nightBrightness = dn.nightBrightness;

    o.skyTop
      .setHex(s.skyColor)
      .lerp(_tmpColor.setHex(0x161128), solar.twilight * 0.45)
      .lerp(_tmpNight.setHex(0x010308), nightFactor * (0.97 - 0.14 * dn.nightBrightness));
    o.skyHorizon
      .setHex(s.fogColor)
      .lerp(_tmpColor.setHex(0xd4623b), solar.twilight * 0.55 * dn.sunWarmth)
      .lerp(_tmpNight.setHex(0x030712), nightFactor * (0.96 - 0.14 * dn.nightBrightness));

    o.hemiSky
      .setHex(s.ambientSky ?? s.skyColor)
      .lerp(_tmpColor.setHex(0xff8e53), solar.twilight * 0.48 * dn.sunWarmth)
      .lerp(_tmpNight.setHex(0x050b18), nightFactor * (0.96 - 0.16 * dn.nightBrightness));
    o.hemiGround.setHex(s.ambientGround ?? s.hemiGround).lerp(_tmpNight.setHex(0x010205), nightFactor * 0.96);

    o.sunColor.copy(solar.sunColor);
    o.sunIntensity = sp.sunIntensity * solar.sunIntensityMult;
    const basePrimShadow = clamp(sp.shadowIntensity * solar.shadowIntensityMult, 0, 1.6);
    const sh = evalShadowTargets(sp, shadowOn, nightFactor, solar.moonIntensityMult, solar.moonShadowMult, basePrimShadow);
    o.secondaryIntensity = sh.secIntensity;
    o.primaryShadowIntensity = sh.primShadow;
    o.secondaryShadowIntensity = sh.secShadow;
    o.sunShadowRadius = sp.shadowSoftness * solar.shadowSoftnessMult;
    o.hemiIntensity = sp.ambientIntensity * (solar.hemiIntensity / 0.56);
    o.envIntensity = sp.ambientIntensity * 1.15 * solar.envIntensity;
    o.bloomStrength = sp.bloomStrength + nightFactor * 0.12;

    o.cloudColor
      .setHex(spec.orbital.cloudColor)
      .lerp(_tmpColor.setHex(0xff8a4d), solar.twilight * 0.55 * dn.sunWarmth)
      .lerp(_tmpNight.setHex(0x0d1628), nightFactor * (0.9 - 0.22 * dn.nightBrightness));
    o.hazeColor.copy(o.skyHorizon).lerp(o.cloudColor, 0.45);

    if (!this.slewing) {
      computeSunOffset(_tmpOffset);
      o.keySunDir.copy(_tmpOffset).normalize();
    } else {
      const kElev = THREE.MathUtils.degToRad(clamp(solar.sunElevation, 5, 88));
      const kAzim = THREE.MathUtils.degToRad(solar.sunAzimuth);
      o.keySunDir.set(Math.cos(kAzim) * Math.cos(kElev), Math.sin(kElev), Math.sin(kAzim) * Math.cos(kElev)).normalize();
    }

    const noonPeakRad = THREE.MathUtils.degToRad(clamp(Math.max(sp.sunElevation, 46), 18, 82));
    const minDayRad = THREE.MathUtils.degToRad(8);
    const astroElev = rawSin >= 0
      ? minDayRad + (noonPeakRad - minDayRad) * Math.pow(rawSin, 0.78)
      : rawSin * THREE.MathUtils.degToRad(48);
    const azim = THREE.MathUtils.degToRad(solar.sunAzimuth);
    const horiz = Math.cos(astroElev);
    o.astroSunDir.set(Math.cos(azim) * horiz, Math.sin(astroElev), Math.sin(azim) * horiz).normalize();
    return o;
  }
}
