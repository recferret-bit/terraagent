import {
  classifySuspensionArchetype,
  SUSPENSION_PROFILES,
  type SuspensionClass,
  type SuspensionProfile,
} from './suspensionProfiles';

export { classifySuspensionArchetype, SUSPENSION_PROFILES, type SuspensionClass, type SuspensionProfile };

export interface HeightSampler {
  heightAt(wx: number, wz: number): number;
}

export type TerrainHeightSampler = HeightSampler;

export interface UnitSuspensionState {
  initialized: boolean;
  prevX: number;
  prevZ: number;
  prevYaw: number;
  prevFwdSpeed: number;
  prevSupportY: number;
  prevGroundVy: number;
  travelDistM: number;
  cornerY: [number, number, number, number];
  cornerVy: [number, number, number, number];
  y: number;
  vy: number;
  pitch: number;
  vpitch: number;
  roll: number;
  vroll: number;
  surge: number;
  vsurge: number;
  animTime: number;
}

export function createSuspensionState(): UnitSuspensionState {
  return {
    initialized: false,
    prevX: 0,
    prevZ: 0,
    prevYaw: 0,
    prevFwdSpeed: 0,
    prevSupportY: 0,
    prevGroundVy: 0,
    travelDistM: 0,
    cornerY: [0, 0, 0, 0],
    cornerVy: [0, 0, 0, 0],
    y: 0,
    vy: 0,
    pitch: 0,
    vpitch: 0,
    roll: 0,
    vroll: 0,
    surge: 0,
    vsurge: 0,
    animTime: 0,
  };
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export function wrapAngleDelta(delta: number): number {
  return Math.atan2(Math.sin(delta), Math.cos(delta));
}

function stepSpring1D(pos: number, vel: number, target: number, omega: number, zeta: number, dt: number): [number, number] {
  const k = omega * omega;
  const c = 2 * zeta * omega;
  const denom = 1 + c * dt + k * dt * dt;
  const nextVel = (vel + k * (target - pos) * dt) / denom;
  return [pos + nextVel * dt, nextVel];
}

function stepCornerStruts(
  state: UnitSuspensionState,
  groundCorners: readonly [number, number, number, number],
  profile: SuspensionProfile,
  movingBlend: number,
  h: number,
): void {
  const gravity = 9.81 * (0.45 + 0.55 * movingBlend);
  for (let c = 0; c < 4; c++) {
    const g = groundCorners[c]!;
    let cy = state.cornerY[c]!;
    let cv = state.cornerVy[c]!;
    if (cy > g + 0.004 && movingBlend > 0.05) {
      cv -= gravity * h;
      cy += cv * h;
      if (cy < g) {
        const impactSink = Math.min(profile.maxCompressionM, Math.abs(cv) * 0.032);
        cy = g - impactSink;
        cv *= 0.25;
      }
    } else {
      const compressing = g > cy || cv > 0;
      const omega = compressing ? profile.omegaCorner * 1.18 : profile.omegaCorner;
      const zeta = compressing ? profile.zetaBump : profile.zetaRebound;
      [cy, cv] = stepSpring1D(cy, cv, g, omega, zeta, h);
      const minStrutY = g - profile.maxCompressionM;
      if (cy < minStrutY) {
        cy = minStrutY;
        if (cv < 0) cv = 0;
      }
    }
    state.cornerY[c] = cy;
    state.cornerVy[c] = cv;
  }
}

export interface StepSuspensionInput {
  readonly state: UnitSuspensionState;
  readonly terrain: HeightSampler | null;
  readonly archetypeId: string;
  readonly wx: number;
  readonly wz: number;
  readonly yaw: number;
  readonly fallbackY: number;
  readonly dt: number;
}

export interface StepSuspensionOutput {
  readonly y: number;
  readonly pitch: number;
  readonly roll: number;
  readonly animTime: number;
  readonly slopeGrade: number;
  readonly surgeOffsetM: number;
  readonly surgeX: number;
  readonly surgeZ: number;
}

interface FootprintSample {
  readonly hCenter: number;
  readonly hMidBias: number;
  readonly corners: [number, number, number, number];
  readonly staticSupportY: number;
  readonly rawSlopePitch: number;
  readonly rawSlopeRoll: number;
  readonly slopeGrade: number;
  readonly crossGrade: number;
  readonly curvature: number;
  readonly fwdX: number;
  readonly fwdZ: number;
}

function sampleFootprint(terrain: TerrainHeightSampler, profile: SuspensionProfile, wx: number, wz: number, yaw: number): FootprintSample {
  const L = profile.halfLength, W = profile.halfWidth;
  const fwdX = Math.sin(yaw), fwdZ = Math.cos(yaw);
  const latX = Math.cos(yaw), latZ = -Math.sin(yaw);
  const hCenter = terrain.heightAt(wx, wz);
  const hFL = terrain.heightAt(wx + fwdX * L + latX * W, wz + fwdZ * L + latZ * W);
  const hFR = terrain.heightAt(wx + fwdX * L - latX * W, wz + fwdZ * L - latZ * W);
  const hRL = terrain.heightAt(wx - fwdX * L + latX * W, wz - fwdZ * L + latZ * W);
  const hRR = terrain.heightAt(wx - fwdX * L - latX * W, wz - fwdZ * L - latZ * W);
  const hFront = 0.5 * (hFL + hFR), hRear = 0.5 * (hRL + hRR);
  const hPlusX = 0.5 * (hFL + hRL), hMinusX = 0.5 * (hFR + hRR);
  const hCornerAvg = 0.25 * (hFL + hFR + hRL + hRR);
  let hMidBias = 0;
  if (profile.midAxleWeight > 0) {
    const hML = terrain.heightAt(wx + latX * W, wz + latZ * W);
    const hMR = terrain.heightAt(wx - latX * W, wz - latZ * W);
    hMidBias = Math.max(0, 0.5 * (hML + hMR) - hCornerAvg) * profile.midAxleWeight;
  }
  const hSupport = hCornerAvg + hMidBias;
  return {
    hCenter,
    hMidBias,
    corners: [hFL, hFR, hRL, hRR],
    staticSupportY: Math.max(hCenter - profile.bellyClearanceM, hSupport),
    rawSlopePitch: -Math.atan2(hFront - hRear, 2 * L),
    rawSlopeRoll: Math.atan2(hPlusX - hMinusX, 2 * W),
    slopeGrade: (hFront - hRear) / (2 * L),
    crossGrade: (hPlusX - hMinusX) / (2 * W),
    curvature: hCornerAvg - hCenter,
    fwdX,
    fwdZ,
  };
}

function snapSuspensionState(
  state: UnitSuspensionState,
  fp: FootprintSample,
  wx: number,
  wz: number,
  yaw: number,
  pitch: number,
  roll: number,
): void {
  state.initialized = true;
  state.prevX = wx; state.prevZ = wz; state.prevYaw = yaw; state.prevFwdSpeed = 0;
  state.prevSupportY = fp.staticSupportY; state.prevGroundVy = 0;
  state.cornerY = [...fp.corners];
  state.cornerVy = [0, 0, 0, 0];
  state.y = fp.staticSupportY; state.vy = 0;
  state.pitch = pitch; state.vpitch = 0;
  state.roll = roll; state.vroll = 0;
  state.surge = 0; state.vsurge = 0;
}

function computePostureLean(profile: SuspensionProfile, grade: number): number {
  if (grade > 0) return grade * profile.uphillForwardLean;
  if (grade < 0) return -grade * profile.downhillBrace;
  return 0;
}

function computeDynamicTerrainLoads(
  state: UnitSuspensionState,
  fp: FootprintSample,
  profile: SuspensionProfile,
  invDt: number,
  movingBlend: number,
): { groundVy: number; gLoadSquat: number; terrainRoughMask: number; joltHeave: number; joltPitch: number; joltRoll: number } {
  const groundVy = clamp((fp.staticSupportY - state.prevSupportY) * invDt, -14, 14);
  const groundAy = clamp((groundVy - state.prevGroundVy) * invDt, -28, 28);
  const gLoadSquat = clamp(
    -groundAy * profile.gLoadGain * (0.35 + 0.65 * movingBlend),
    -profile.maxCompressionM * 0.82,
    profile.maxCompressionM * 0.45,
  );
  const terrainRoughMask = clamp(
    (Math.abs(fp.slopeGrade) + Math.abs(fp.crossGrade) + Math.abs(fp.curvature) * 2.4 - 0.025) * 3.2,
    0,
    1,
  );
  const joltGain = movingBlend * terrainRoughMask;
  const phase = state.travelDistM * 5.8;
  const joltHeave = joltGain * profile.roughnessHeaveM * (0.65 * Math.sin(phase) + 0.35 * Math.sin(phase * 2.37 + 1.1));
  const joltPitch = joltGain * profile.roughnessTiltRad * Math.cos(phase * 1.43 + 0.4);
  const crossMask = clamp(Math.abs(fp.crossGrade) * 4.5, 0, 1);
  const joltRoll = joltGain * crossMask * profile.roughnessTiltRad * Math.sin(phase * 1.71 + 2.0);
  return { groundVy, gLoadSquat, terrainRoughMask, joltHeave, joltPitch, joltRoll };
}

/**
 * Advances 4-corner visual 3D terrain suspension & chassis attitude (`YXZ` Euler order: world `yaw` -> local `pitch` -> local `roll`)
 * for mobile units over uneven heightfields without touching authoritative simulation positions.
 */
export function stepUnitTerrainSuspension(input: StepSuspensionInput): StepSuspensionOutput {
  const { state, terrain, archetypeId, wx, wz, yaw, fallbackY, dt } = input;
  const cls = classifySuspensionArchetype(archetypeId);
  if (!cls || !terrain) {
    const baseY = terrain ? terrain.heightAt(wx, wz) : fallbackY;
    state.y = baseY; state.vy = 0; state.pitch = 0; state.vpitch = 0; state.roll = 0; state.vroll = 0;
    state.surge = 0; state.vsurge = 0;
    state.animTime += Math.max(0, dt);
    return { y: baseY, pitch: 0, roll: 0, animTime: state.animTime, slopeGrade: 0, surgeOffsetM: 0, surgeX: 0, surgeZ: 0 };
  }

  const profile = SUSPENSION_PROFILES[cls];
  const fp = sampleFootprint(terrain, profile, wx, wz, yaw);
  const restPitch = clamp(fp.rawSlopePitch * profile.slopePitchAlign + computePostureLean(profile, fp.slopeGrade), -profile.maxTiltRad, profile.maxTiltRad);
  const restRoll = clamp(fp.rawSlopeRoll * profile.slopeRollAlign, -profile.maxTiltRad, profile.maxTiltRad);

  if (!state.initialized || !(dt > 1e-5)) {
    if (!state.initialized) snapSuspensionState(state, fp, wx, wz, yaw, restPitch, restRoll);
    return {
      y: state.y, pitch: state.pitch, roll: state.roll, animTime: state.animTime, slopeGrade: fp.slopeGrade,
      surgeOffsetM: state.surge, surgeX: fp.fwdX * state.surge, surgeZ: fp.fwdZ * state.surge,
    };
  }

  const dx = wx - state.prevX, dz = wz - state.prevZ;
  const stepDist = Math.hypot(dx, dz);
  if (stepDist > 4.5) {
    snapSuspensionState(state, fp, wx, wz, yaw, restPitch, restRoll);
    state.animTime += dt;
    return { y: state.y, pitch: state.pitch, roll: state.roll, animTime: state.animTime, slopeGrade: fp.slopeGrade, surgeOffsetM: 0, surgeX: 0, surgeZ: 0 };
  }

  const clampedDt = Math.min(0.1, dt), invDt = 1 / clampedDt;
  state.travelDistM += stepDist;
  const fwdSpeed = clamp((dx * fp.fwdX + dz * fp.fwdZ) * invDt, -12, 12);
  const fwdAccel = clamp((fwdSpeed - state.prevFwdSpeed) * invDt, -18, 18);
  const yawRate = clamp(wrapAngleDelta(yaw - state.prevYaw) * invDt, -8, 8);
  const movingBlend = clamp(Math.abs(fwdSpeed) / 0.85, 0, 1);
  const loads = computeDynamicTerrainLoads(state, fp, profile, invDt, movingBlend);

  const inertialPitch = clamp(-fwdAccel * profile.accelSquatGain + loads.joltPitch, -0.16, 0.16);
  const inertialRoll = clamp(-yawRate * Math.abs(fwdSpeed) * profile.turnBankGain + loads.joltRoll, -0.19, 0.19);
  const targetSurge = clamp(-fp.slopeGrade * profile.slopeSurgeGainM * movingBlend, -0.14, 0.14);

  const subSteps = clampedDt > 1 / 60 ? Math.min(6, Math.ceil(clampedDt * 60)) : 1;
  const h = clampedDt / subSteps;
  const L = profile.halfLength, W = profile.halfWidth;
  for (let i = 0; i < subSteps; i++) {
    stepCornerStruts(state, fp.corners, profile, movingBlend, h);
    const cFront = 0.5 * (state.cornerY[0] + state.cornerY[1]);
    const cRear = 0.5 * (state.cornerY[2] + state.cornerY[3]);
    const cPlusX = 0.5 * (state.cornerY[0] + state.cornerY[2]);
    const cMinusX = 0.5 * (state.cornerY[1] + state.cornerY[3]);
    const dynSupportY = Math.max(fp.hCenter - profile.bellyClearanceM, 0.5 * (cFront + cRear) + fp.hMidBias + loads.gLoadSquat + loads.joltHeave);
    const targetPitch = clamp(-Math.atan2(cFront - cRear, 2 * L) * profile.slopePitchAlign + computePostureLean(profile, fp.slopeGrade) + inertialPitch, -profile.maxTiltRad, profile.maxTiltRad);
    const targetRoll = clamp(Math.atan2(cPlusX - cMinusX, 2 * W) * profile.slopeRollAlign + inertialRoll, -profile.maxTiltRad, profile.maxTiltRad);
    [state.y, state.vy] = stepSpring1D(state.y, state.vy, dynSupportY, profile.omegaHeave, profile.zetaHeave, h);
    [state.pitch, state.vpitch] = stepSpring1D(state.pitch, state.vpitch, targetPitch, profile.omegaTilt, profile.zetaTilt, h);
    [state.roll, state.vroll] = stepSpring1D(state.roll, state.vroll, targetRoll, profile.omegaTilt, profile.zetaTilt, h);
    [state.surge, state.vsurge] = stepSpring1D(state.surge, state.vsurge, targetSurge, 10.5, 0.78, h);
  }

  const effectiveMinY = Math.max(fp.hCenter - profile.bellyClearanceM, fp.staticSupportY - profile.maxCompressionM * (1 - loads.terrainRoughMask * 0.25));
  const maxAllowedY = fp.staticSupportY + profile.maxHeaveOffsetM;
  if (state.y < effectiveMinY) { state.y = effectiveMinY; if (state.vy < 0) state.vy = 0; }
  else if (state.y > maxAllowedY) { state.y = maxAllowedY; if (state.vy > 0) state.vy = 0; }

  if (Math.abs(restPitch) < 1e-4 && Math.abs(inertialPitch) < 1e-4 && Math.abs(state.pitch) < 8e-4 && Math.abs(state.vpitch) < 4e-3) { state.pitch = 0; state.vpitch = 0; }
  if (Math.abs(restRoll) < 1e-4 && Math.abs(inertialRoll) < 1e-4 && Math.abs(state.roll) < 8e-4 && Math.abs(state.vroll) < 4e-3) { state.roll = 0; state.vroll = 0; }
  if (Math.abs(targetSurge) < 1e-4 && Math.abs(state.surge) < 5e-4) { state.surge = 0; state.vsurge = 0; }

  state.animTime += Math.max(0, dt) * (movingBlend > 0.1 ? clamp(1 + fp.slopeGrade * 0.34, 0.8, 1.38) : 1);
  state.prevX = wx; state.prevZ = wz; state.prevYaw = yaw; state.prevFwdSpeed = fwdSpeed;
  state.prevSupportY = fp.staticSupportY; state.prevGroundVy = loads.groundVy;
  return {
    y: state.y, pitch: state.pitch, roll: state.roll, animTime: state.animTime, slopeGrade: fp.slopeGrade,
    surgeOffsetM: state.surge, surgeX: fp.fwdX * state.surge, surgeZ: fp.fwdZ * state.surge,
  };
}
