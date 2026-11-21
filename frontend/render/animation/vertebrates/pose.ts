import * as THREE from 'three';
import type { VertebratePartInput, VertebratePose } from './types';

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const ONE = new THREE.Vector3(1, 1, 1);

function rigid(rest: THREE.Vector3, anchor: THREE.Vector3, q: THREE.Quaternion): THREE.Matrix4 {
  return new THREE.Matrix4()
    .compose(anchor, q, ONE)
    .multiply(new THREE.Matrix4().makeTranslation(-rest.x, -rest.y, -rest.z));
}

function rotateRollPitchYawQuat(roll: number, pitch: number, yaw: number): THREE.Quaternion {
  const qz = new THREE.Quaternion().setFromAxisAngle(Z, roll);
  const qx = new THREE.Quaternion().setFromAxisAngle(X, pitch);
  const qy = new THREE.Quaternion().setFromAxisAngle(Y, yaw);
  return qy.multiply(qx).multiply(qz);
}

function pivotRotate(pivot: THREE.Vector3Tuple, roll: number, pitch: number, yaw: number): THREE.Matrix4 {
  const p = new THREE.Vector3(...pivot);
  return rigid(p, p, rotateRollPitchYawQuat(roll, pitch, yaw));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function computeBirdFlapEnv(walk: number, sz: number, g: number): number {
  const activeFlap = smoothstep(0.14, 0.42, walk) * (0.45 + 0.55 * walk);
  const smallness = Math.max(0, Math.min(1, (0.20 - sz) / 0.20));
  const sprint = smoothstep(0.95, 1.0, walk);
  const burstWave = 0.82 + 0.18 * smoothstep(-0.25, 0.25, Math.sin(g * 0.22));
  return activeFlap * (1 - smallness * (1 - sprint) * (1 - burstWave));
}

export function vertebrateBodyMatrix(p: VertebratePose): THREE.Matrix4 {
  const { comY, sleepDrop, strideLen, liftHeight, gaitFreq, isBird } = p.config;
  const g = p.time * gaitFreq;
  if (isBird > 0.5) {
    const sz = Math.max(0, Math.min(1, p.config.birdSize ?? 0));
    const flapEnv = computeBirdFlapEnv(p.walk, sz, g);
    const bobAmp = 0.036 + 0.042 * sz;
    const glideBob = (0.010 + 0.012 * sz) * Math.sin(p.time * (2.4 - 0.8 * sz));
    const bob = -Math.sin(g - 0.35 - 0.18 * sz) * bobAmp * flapEnv + glideBob * (1 - flapEnv);
    const pitch = Math.cos(g - 0.35 - 0.18 * sz) * (0.056 + 0.036 * sz) * flapEnv;
    const roll = Math.sin(p.time * 1.9) * (0.018 + 0.016 * sz) * (1 - flapEnv * 0.5);
    const anchor = new THREE.Vector3(0, comY + bob, 0);
    return rigid(new THREE.Vector3(0, comY, 0), anchor, rotateRollPitchYawQuat(roll, pitch, 0));
  }

  const up = 1 - p.sleep;
  const w = p.walk * up;
  const r = p.run * up;
  const trotW = w * (1 - r);
  const gallopW = Math.max(w, r) * r;
  const wk = p.work * up;
  const idleW = up * (1 - w);
  const breath = Math.sin(p.time * 2.6) * 0.014 * idleW;

  const u = g * 1.35;
  const heave =
    liftHeight * (-0.21 + 0.25 * Math.cos(2 * g - 0.18)) * trotW +
    liftHeight * (-0.04 + 0.26 * Math.cos(2 * u - 0.85) - 0.22 * Math.sin(u - 0.65)) * gallopW -
    p.sleep * sleepDrop +
    breath;
  const pitch =
    Math.sin(2 * g - 0.35) * 0.064 * trotW +
    Math.cos(g * 1.35) * 0.100 * gallopW +
    Math.sin(p.time * 2.6) * 0.018 * idleW +
    wk * 0.10 * up +
    p.sleep * 0.03;
  const roll =
    Math.sin(g - 0.25) * 0.062 * trotW +
    Math.sin(g * 1.35 - 0.2) * 0.025 * gallopW +
    Math.sin(p.time * 1.3) * 0.018 * idleW;
  const yaw = -Math.cos(g) * 0.048 * trotW - Math.cos(g * 1.35) * 0.018 * gallopW;
  const swayX =
    Math.cos(g) * (strideLen * 0.12) * trotW +
    Math.sin(p.time * 1.3) * 0.010 * idleW;
  const surgeZ =
    Math.sin(2 * g) * (strideLen * 0.15) * trotW +
    Math.cos(g * 1.35 - 0.4) * (strideLen * 0.22) * gallopW;

  const anchor = new THREE.Vector3(swayX, comY + heave, surgeZ);
  return rigid(new THREE.Vector3(0, comY, 0), anchor, rotateRollPitchYawQuat(roll, pitch, yaw));
}

function mammalLegMatrix(part: VertebratePartInput, p: VertebratePose, body: THREE.Matrix4): THREE.Matrix4 {
  const { strideLen, liftHeight, gaitFreq } = p.config;
  const hip0 = new THREE.Vector3(...part.pivot);
  const mid0 = new THREE.Vector3(...part.joint);
  const toe0 = new THREE.Vector3(...part.tip);
  const hip = hip0.clone().applyMatrix4(body);
  const side = hip0.x >= 0 ? 1 : -1;

  const up = 1 - p.sleep;
  const w = p.walk * up;
  const r = p.run * up;
  const trotW = w * (1 - r);
  const gallopW = Math.max(w, r) * r;
  const g = p.time * gaitFreq;
  const tau = g * (1 + 0.35 * r) + part.meta * (1 - 0.65 * r) + (hip0.z < 0 ? r * 2.2 : 0);

  const toe = toe0.clone();
  const amp = strideLen * (trotW + 1.35 * gallopW);
  const lift = liftHeight * (1.18 * trotW + 1.32 * gallopW);
  const swing = Math.max(0, Math.cos(tau));
  const dy = Math.pow(swing, 0.70) * lift;
  const tuck = 0.22 * trotW + 0.06 * gallopW;
  toe.z += (Math.sin(tau) - tuck * swing * swing) * amp;
  toe.y += dy;

  // Tuck elbows low & back beside chest with forearms resting forward on the ground; fold hindlimbs beside flanks.
  const isFore = hip0.z >= 0;
  const l1 = hip0.distanceTo(mid0);
  const l2 = mid0.distanceTo(toe0);
  if (isFore) {
    const fullSlpHipY = hip0.y - p.config.sleepDrop;
    const elbowY = THREE.MathUtils.clamp(toe0.y + 0.032, toe0.y + 0.014, Math.max(toe0.y + 0.014, fullSlpHipY - 0.014));
    const dy1 = Math.min(l1 * 0.94, Math.max(0, fullSlpHipY - elbowY));
    const dy2 = Math.min(l2 * 0.94, Math.max(0, elbowY - toe0.y));
    const backZ = Math.sqrt(Math.max(0, l1 * l1 - dy1 * dy1));
    const fwdZ = Math.sqrt(Math.max(0, l2 * l2 - dy2 * dy2));
    const dz = Math.max(0.04, (hip0.z - backZ + fwdZ) - toe0.z);
    toe.z += p.sleep * dz;
    toe.x += p.sleep * side * Math.min(0.008, l1 * 0.035);
  } else {
    toe.z -= p.sleep * Math.min(0.20, l1 * 0.45);
    toe.x += p.sleep * side * Math.min(0.014, l1 * 0.08);
  }

  const rawVec = toe.clone().sub(hip);
  const rawLen = Math.max(1e-5, rawVec.length());
  const axis = rawVec.divideScalar(rawLen);
  const minD = Math.abs(l2 - l1) + 0.002;
  const maxD = l1 + l2 - 0.002;
  const dist = THREE.MathUtils.clamp(rawLen, minD, maxD);
  toe.copy(hip).addScaledVector(axis, dist);

  const oldRef = mid0.clone().sub(hip0).normalize();
  const sleepRef = new THREE.Vector3(isFore ? 0 : side * 0.02, isFore ? -0.35 : 0.16, isFore ? -0.94 : 0.985).normalize();
  const bendRef = oldRef.lerp(sleepRef, p.sleep);
  bendRef.addScaledVector(axis, -bendRef.dot(axis));
  if (bendRef.lengthSq() < 1e-6) bendRef.set(0, 0, isFore ? -1 : 1);
  bendRef.normalize();
  const along = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const perp = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  const mid = hip.clone().addScaledVector(axis, along).addScaledVector(bendRef, perp);

  if (part.role === 6) {
    // Foot tracks moving ankle while remaining level at stance/sleep; flexes wrist/pastern cleanly while airborne.
    const swingTilt = (0.22 * swing - 0.16 * Math.sin(tau)) * smoothstep(0.014, 0.050, dy);
    return rigid(toe0, toe, rotateRollPitchYawQuat(0, swingTilt, 0));
  }

  const isUpper = part.role === 4;
  const rest = isUpper ? hip0 : mid0;
  const origin = isUpper ? hip : mid;
  const oldAxis = (isUpper ? mid0.clone().sub(hip0) : toe0.clone().sub(mid0)).normalize();
  const newAxis = (isUpper ? mid.clone().sub(hip) : toe.clone().sub(mid)).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(oldAxis, newAxis);
  return rigid(rest, origin, q);
}

function birdWingMatrix(part: VertebratePartInput, p: VertebratePose, body: THREE.Matrix4): THREE.Matrix4 {
  const g = p.time * p.config.gaitFreq;
  const sz = Math.max(0, Math.min(1, p.config.birdSize ?? 0));
  const flapEnv = computeBirdFlapEnv(p.walk, sz, g);
  const armAsym = 0.18 + 0.10 * sz;
  const armStroke = Math.sin(g) - armAsym * Math.sin(2 * g) + 0.10;
  const wristPhase = g - (0.68 + 0.42 * sz);
  const side = part.pivot[0] >= 0 ? 1 : -1;

  const glideDihedral = 0.06 + 0.12 * sz + 0.026 * sz * Math.sin(p.time * 2.2);
  const innerRoll = side * (glideDihedral * (1 - flapEnv) + p.config.strideLen * 1.48 * flapEnv * armStroke);
  const innerPitch = -(0.14 + 0.08 * (1 - sz)) * flapEnv * Math.cos(g - 0.15);
  const innerYaw = side * (0.11 + 0.07 * (1 - sz)) * flapEnv * Math.cos(g - 0.25);
  const innerMat = body.clone().multiply(pivotRotate(part.pivot, innerRoll, innerPitch, innerYaw));
  if (part.role === 7) return innerMat;

  const upstrokeFold = Math.pow(Math.max(0, Math.cos(g - 0.18)), 0.85);
  const whipWave = Math.sin(wristPhase) - 0.22 * Math.sin(2 * wristPhase);
  const downWhip = Math.min(0.22, whipWave * 0.42);
  const glideWrist = -(0.05 + 0.10 * sz) + 0.022 * sz * Math.cos(p.time * 2.2);
  const outerRoll =
    side *
    (glideWrist * (1 - flapEnv) +
      flapEnv * p.config.liftHeight * (downWhip - 1.38 * upstrokeFold));
  const outerPitch = -(0.20 + 0.10 * (1 - sz)) * flapEnv * Math.cos(wristPhase);
  const outerYaw = side * flapEnv * ((0.16 + 0.10 * sz) * upstrokeFold - 0.07 * Math.max(0, -whipWave));
  return innerMat.multiply(pivotRotate(part.joint, outerRoll, outerPitch, outerYaw));
}

export function vertebratePartMatrix(part: VertebratePartInput, p: VertebratePose): THREE.Matrix4 {
  const body = vertebrateBodyMatrix(p);
  if (part.role === 1) return body;

  if (part.role === 4 || part.role === 5 || part.role === 6) {
    return mammalLegMatrix(part, p, body);
  }
  if (part.role === 7 || part.role === 8) {
    return birdWingMatrix(part, p, body);
  }

  const g = p.time * p.config.gaitFreq;
  if (part.role === 2) {
    const up = 1 - p.sleep;
    const w = p.walk * up;
    const r = p.run * up;
    const trotW = w * (1 - r);
    const gallopW = Math.max(w, r) * r;
    const graze = (0.50 + 0.075 * Math.sin(p.time * 4.6)) * p.work * up;
    const stabilize =
      (-Math.sin(2 * g - 0.35) * 0.080 * trotW -
        Math.cos(g * 1.35 - 0.15) * 0.145 * gallopW +
        Math.sin(p.time * 2.6) * 0.024 * (1 - w) * (1 - p.work)) *
      up;
    const sleepHead = p.sleep * p.config.headSleepPitch;
    const headYaw =
      (Math.sin(p.time * 1.15) * 0.15 * (1 - w) * (1 - p.work) +
        Math.sin(p.time * 2.1) * 0.070 * p.work +
        Math.cos(g) * 0.058 * trotW) *
      up;
    return body.multiply(pivotRotate(part.pivot, 0, graze + stabilize + sleepHead, headYaw));
  }
  if (part.role === 3) {
    const up = 1 - p.sleep;
    const w = p.walk * up;
    const r = p.run * up;
    const trotW = w * (1 - r);
    const gallopW = Math.max(w, r) * r;
    const yaw =
      (0.45 * Math.sin(g * 1.1 + 0.6) * (0.28 + 0.72 * p.walk) + 0.25 * Math.sin(g * 2) * p.work) * up +
      p.sleep * 0.18;
    const pitch =
      (0.16 * w +
        0.13 * r +
        0.14 * Math.cos(2 * g - 0.3) * trotW +
        0.28 * Math.sin(g * 1.35) * gallopW +
        0.05 * Math.sin(p.time * 2.2) * (1 - w)) *
        up +
      p.sleep * 0.42;
    return body.multiply(pivotRotate(part.pivot, 0, pitch, yaw));
  }
  const sz = Math.max(0, Math.min(1, p.config.birdSize ?? 0));
  const flapEnv = computeBirdFlapEnv(p.walk, sz, g);
  if (part.role === 9) {
    const pitch = -(0.13 + 0.09 * (1 - sz)) * flapEnv * Math.sin(g - 0.4 * sz) + 0.038 * Math.sin(p.time * 2.2);
    return body.multiply(pivotRotate(part.pivot, 0, pitch, 0));
  }
  if (part.role === 10) {
    const pitch = -Math.cos(g - 0.35 - 0.18 * sz) * (0.048 + 0.030 * sz) * flapEnv;
    return body.multiply(pivotRotate(part.pivot, 0, pitch, 0));
  }
  return body;
}
