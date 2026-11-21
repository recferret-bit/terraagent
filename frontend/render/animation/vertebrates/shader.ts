import { Vector4 } from 'three';
import { ShaderPluginRegistry } from '../../visuals/unified/registries';

export const VERTEBRATE_ANIMATION = 'vertebrateAnimation';

const DECLARATIONS = /* glsl */ `
attribute vec4 aVertJoint;
attribute vec4 aVertTip;
uniform vec4 uVertParams;
uniform vec4 uVertMeta;
uniform float uVertRun;
uniform float uVertSleep;

vec4 vertQuat(vec3 from, vec3 to) {
  float w = 1.0 + dot(from, to);
  if (w < 0.000001) {
    vec3 axis = abs(from.x) > abs(from.z) ? vec3(-from.y, from.x, 0.0) : vec3(0.0, -from.z, from.y);
    return normalize(vec4(axis, 0.0));
  }
  return normalize(vec4(cross(from, to), w));
}

vec3 vertRotateQ(vec3 v, vec4 q) {
  return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
}

mat3 vertMatFromQ(vec4 q) {
  return mat3(vertRotateQ(vec3(1, 0, 0), q), vertRotateQ(vec3(0, 1, 0), q), vertRotateQ(vec3(0, 0, 1), q));
}

mat3 vertRpyMat(float roll, float pitch, float yaw) {
  mat3 rz = vertMatFromQ(vec4(0.0, 0.0, sin(roll * 0.5), cos(roll * 0.5)));
  mat3 rx = vertMatFromQ(vec4(sin(pitch * 0.5), 0.0, 0.0, cos(pitch * 0.5)));
  mat3 ry = vertMatFromQ(vec4(0.0, sin(yaw * 0.5), 0.0, cos(yaw * 0.5)));
  return ry * rx * rz;
}

mat4 vertRigid(vec3 rest, vec3 anchor, mat3 rot) {
  return mat4(vec4(rot[0], 0.0), vec4(rot[1], 0.0), vec4(rot[2], 0.0), vec4(anchor - rot * rest, 1.0));
}

mat4 vertPivotRpy(vec3 pivot, float roll, float pitch, float yaw) {
  return vertRigid(pivot, pivot, vertRpyMat(roll, pitch, yaw));
}

float vertBirdFlapEnv(float walk, float sz, float g) {
  float activeFlap = smoothstep(0.14, 0.42, walk) * (0.45 + 0.55 * walk);
  float smallness = clamp((0.20 - sz) / 0.20, 0.0, 1.0);
  float sprint = smoothstep(0.95, 1.0, walk);
  float burstWave = 0.82 + 0.18 * smoothstep(-0.25, 0.25, sin(g * 0.22));
  return activeFlap * (1.0 - smallness * (1.0 - sprint) * (1.0 - burstWave));
}
`;

const BODY = /* glsl */ `
mat4 vertBody() {
  float comY = uVertParams.x;
  float sleepDrop = uVertParams.y;
  float strideLen = uVertParams.z;
  float liftHeight = uVertParams.w;
  float gaitFreq = uVertMeta.x;
  float isBird = uVertMeta.y;
  float g = uTime * gaitFreq;

  if (isBird > 0.5) {
    float sz = clamp(uVertMeta.w, 0.0, 1.0);
    float flapEnv = vertBirdFlapEnv(uWalkWeight, sz, g);
    float bobAmp = 0.036 + 0.042 * sz;
    float glideBob = (0.010 + 0.012 * sz) * sin(uTime * (2.4 - 0.8 * sz));
    float bob = -sin(g - 0.35 - 0.18 * sz) * bobAmp * flapEnv + glideBob * (1.0 - flapEnv);
    float pitch = cos(g - 0.35 - 0.18 * sz) * (0.056 + 0.036 * sz) * flapEnv;
    float roll = sin(uTime * 1.9) * (0.018 + 0.016 * sz) * (1.0 - flapEnv * 0.5);
    return vertRigid(vec3(0.0, comY, 0.0), vec3(0.0, comY + bob, 0.0), vertRpyMat(roll, pitch, 0.0));
  }

  float up = 1.0 - uVertSleep;
  float w = uWalkWeight * up;
  float r = uVertRun * up;
  float trotW = w * (1.0 - r);
  float gallopW = max(w, r) * r;
  float wk = uWorkWeight * up;
  float idleW = up * (1.0 - w);
  float breath = sin(uTime * 2.6) * 0.014 * idleW;

  float u = g * 1.35;
  float heave = liftHeight * (-0.21 + 0.25 * cos(2.0 * g - 0.18)) * trotW
    + liftHeight * (-0.04 + 0.26 * cos(2.0 * u - 0.85) - 0.22 * sin(u - 0.65)) * gallopW
    - uVertSleep * sleepDrop + breath;
  float pitch = sin(2.0 * g - 0.35) * 0.064 * trotW
    + cos(g * 1.35) * 0.100 * gallopW + sin(uTime * 2.6) * 0.018 * idleW + wk * 0.10 * up + uVertSleep * 0.03;
  float roll = sin(g - 0.25) * 0.062 * trotW + sin(g * 1.35 - 0.2) * 0.025 * gallopW + sin(uTime * 1.3) * 0.018 * idleW;
  float yaw = -cos(g) * 0.048 * trotW - cos(g * 1.35) * 0.018 * gallopW;
  float swayX = cos(g) * (strideLen * 0.12) * trotW + sin(uTime * 1.3) * 0.010 * idleW;
  float surgeZ = sin(2.0 * g) * (strideLen * 0.15) * trotW + cos(g * 1.35 - 0.4) * (strideLen * 0.22) * gallopW;

  return vertRigid(vec3(0.0, comY, 0.0), vec3(swayX, comY + heave, surgeZ), vertRpyMat(roll, pitch, yaw));
}
`;

const LIMBS_AND_WINGS = /* glsl */ `
mat4 vertQuadLeg(mat4 body, float role) {
  float strideLen = uVertParams.z;
  float liftHeight = uVertParams.w;
  float gaitFreq = uVertMeta.x;
  vec3 hip0 = aPartAnim.yzw;
  vec3 mid0 = aVertJoint.xyz;
  vec3 toe0 = aVertTip.xyz;
  float phaseOff = aVertTip.w;
  vec3 hip = (body * vec4(hip0, 1.0)).xyz;
  float side = hip0.x >= 0.0 ? 1.0 : -1.0;

  float up = 1.0 - uVertSleep;
  float w = uWalkWeight * up;
  float r = uVertRun * up;
  float trotW = w * (1.0 - r);
  float gallopW = max(w, r) * r;
  float g = uTime * gaitFreq;
  float tau = g * (1.0 + 0.35 * r) + phaseOff * (1.0 - 0.65 * r) + (hip0.z < 0.0 ? r * 2.2 : 0.0);

  vec3 toe = toe0;
  float amp = strideLen * (trotW + 1.35 * gallopW);
  float lift = liftHeight * (1.18 * trotW + 1.32 * gallopW);
  float swing = max(0.0, cos(tau));
  float dy = pow(swing, 0.70) * lift;
  float tuck = 0.22 * trotW + 0.06 * gallopW;
  toe.z += (sin(tau) - tuck * swing * swing) * amp;
  toe.y += dy;

  bool isFore = hip0.z >= 0.0;
  float l1 = distance(hip0, mid0);
  float l2 = distance(mid0, toe0);
  if (isFore) {
    float fullSlpHipY = hip0.y - uVertParams.y;
    float elbowY = clamp(toe0.y + 0.032, toe0.y + 0.014, max(toe0.y + 0.014, fullSlpHipY - 0.014));
    float dy1 = min(l1 * 0.94, max(0.0, fullSlpHipY - elbowY));
    float dy2 = min(l2 * 0.94, max(0.0, elbowY - toe0.y));
    float backZ = sqrt(max(0.0, l1 * l1 - dy1 * dy1));
    float fwdZ = sqrt(max(0.0, l2 * l2 - dy2 * dy2));
    float dz = max(0.04, (hip0.z - backZ + fwdZ) - toe0.z);
    toe.z += uVertSleep * dz;
    toe.x += uVertSleep * side * min(0.008, l1 * 0.035);
  } else {
    toe.z -= uVertSleep * min(0.20, l1 * 0.45);
    toe.x += uVertSleep * side * min(0.014, l1 * 0.08);
  }

  vec3 rawVec = toe - hip;
  float rawLen = max(0.00001, length(rawVec));
  vec3 axis = rawVec / rawLen;
  float minD = abs(l2 - l1) + 0.002;
  float maxD = l1 + l2 - 0.002;
  float dist = clamp(rawLen, minD, maxD);
  toe = hip + axis * dist;

  vec3 oldRef = normalize(mid0 - hip0);
  vec3 sleepRef = normalize(vec3(isFore ? 0.0 : side * 0.02, isFore ? -0.35 : 0.16, isFore ? -0.94 : 0.985));
  vec3 bendRef = mix(oldRef, sleepRef, uVertSleep);
  bendRef = bendRef - axis * dot(bendRef, axis);
  if (dot(bendRef, bendRef) < 0.000001) bendRef = vec3(0.0, 0.0, isFore ? -1.0 : 1.0);
  bendRef = normalize(bendRef);
  float along = (l1 * l1 - l2 * l2 + dist * dist) / (2.0 * dist);
  float perp = sqrt(max(0.0, l1 * l1 - along * along));
  vec3 mid = hip + axis * along + bendRef * perp;

  if (role > 5.5) {
    float swingTilt = (0.22 * swing - 0.16 * sin(tau)) * smoothstep(0.014, 0.050, dy);
    return vertRigid(toe0, toe, vertRpyMat(0.0, swingTilt, 0.0));
  }

  bool isUpper = role < 4.5;
  vec3 rest = isUpper ? hip0 : mid0;
  vec3 origin = isUpper ? hip : mid;
  vec3 oldAxis = normalize(isUpper ? mid0 - hip0 : toe0 - mid0);
  vec3 newAxis = normalize(isUpper ? mid - hip : toe - mid);
  return vertRigid(rest, origin, vertMatFromQ(vertQuat(oldAxis, newAxis)));
}

mat4 vertBirdWing(mat4 body, float role) {
  float g = uTime * uVertMeta.x;
  float sz = clamp(uVertMeta.w, 0.0, 1.0);
  float flapEnv = vertBirdFlapEnv(uWalkWeight, sz, g);
  float armAsym = 0.18 + 0.10 * sz;
  float armStroke = sin(g) - armAsym * sin(2.0 * g) + 0.10;
  float wristPhase = g - (0.68 + 0.42 * sz);
  vec3 shoulder = aPartAnim.yzw;
  float side = shoulder.x >= 0.0 ? 1.0 : -1.0;

  float glideDihedral = 0.06 + 0.12 * sz + 0.026 * sz * sin(uTime * 2.2);
  float innerRoll = side * (glideDihedral * (1.0 - flapEnv) + uVertParams.z * 1.48 * flapEnv * armStroke);
  float innerPitch = -(0.14 + 0.08 * (1.0 - sz)) * flapEnv * cos(g - 0.15);
  float innerYaw = side * (0.11 + 0.07 * (1.0 - sz)) * flapEnv * cos(g - 0.25);
  mat4 innerMat = body * vertPivotRpy(shoulder, innerRoll, innerPitch, innerYaw);
  if (role < 7.5) return innerMat;

  float upstrokeFold = pow(max(0.0, cos(g - 0.18)), 0.85);
  float whipWave = sin(wristPhase) - 0.22 * sin(2.0 * wristPhase);
  float downWhip = min(0.22, whipWave * 0.42);
  float glideWrist = -(0.05 + 0.10 * sz) + 0.022 * sz * cos(uTime * 2.2);
  float outerRoll = side * (glideWrist * (1.0 - flapEnv) + flapEnv * uVertParams.w * (downWhip - 1.38 * upstrokeFold));
  float outerPitch = -(0.20 + 0.10 * (1.0 - sz)) * flapEnv * cos(wristPhase);
  float outerYaw = side * flapEnv * ((0.16 + 0.10 * sz) * upstrokeFold - 0.07 * max(0.0, -whipWave));
  return innerMat * vertPivotRpy(aVertJoint.xyz, outerRoll, outerPitch, outerYaw);
}
`;

const TRANSFORM = /* glsl */ `
mat4 vertebrateTransform() {
  mat4 body = vertBody();
  float role = aVertJoint.w;
  if (role < 1.5) return body;
  if (role > 3.5 && role < 6.5) return vertQuadLeg(body, role);
  if (role > 6.5 && role < 8.5) return vertBirdWing(body, role);

  float g = uTime * uVertMeta.x;
  vec3 pivot = aPartAnim.yzw;
  if (role < 2.5) {
    float up = 1.0 - uVertSleep;
    float w = uWalkWeight * up;
    float r = uVertRun * up;
    float trotW = w * (1.0 - r);
    float gallopW = max(w, r) * r;
    float graze = (0.50 + 0.075 * sin(uTime * 4.6)) * uWorkWeight * up;
    float stabilize = (-sin(2.0 * g - 0.35) * 0.080 * trotW - cos(g * 1.35 - 0.15) * 0.145 * gallopW + sin(uTime * 2.6) * 0.024 * (1.0 - w) * (1.0 - uWorkWeight)) * up;
    float sleepHead = uVertSleep * uVertMeta.z;
    float headYaw = (sin(uTime * 1.15) * 0.15 * (1.0 - w) * (1.0 - uWorkWeight) + sin(uTime * 2.1) * 0.070 * uWorkWeight + cos(g) * 0.058 * trotW) * up;
    return body * vertPivotRpy(pivot, 0.0, graze + stabilize + sleepHead, headYaw);
  }
  if (role < 3.5) {
    float up = 1.0 - uVertSleep;
    float w = uWalkWeight * up;
    float r = uVertRun * up;
    float trotW = w * (1.0 - r);
    float gallopW = max(w, r) * r;
    float yaw = (0.45 * sin(g * 1.1 + 0.6) * (0.28 + 0.72 * uWalkWeight) + 0.25 * sin(g * 2.0) * uWorkWeight) * up + uVertSleep * 0.18;
    float pitch = (0.16 * w + 0.13 * r + 0.14 * cos(2.0 * g - 0.3) * trotW + 0.28 * sin(g * 1.35) * gallopW + 0.05 * sin(uTime * 2.2) * (1.0 - w)) * up + uVertSleep * 0.42;
    return body * vertPivotRpy(pivot, 0.0, pitch, yaw);
  }
  float sz = clamp(uVertMeta.w, 0.0, 1.0);
  float flapEnv = vertBirdFlapEnv(uWalkWeight, sz, g);
  if (role < 9.5) {
    float pitch = -(0.13 + 0.09 * (1.0 - sz)) * flapEnv * sin(g - 0.4 * sz) + 0.038 * sin(uTime * 2.2);
    return body * vertPivotRpy(pivot, 0.0, pitch, 0.0);
  }
  float pitch = -cos(g - 0.35 - 0.18 * sz) * (0.048 + 0.030 * sz) * flapEnv;
  return body * vertPivotRpy(pivot, 0.0, pitch, 0.0);
}
`;

export const VERTEBRATE_VERTEX_DECLARATIONS = DECLARATIONS + BODY + LIMBS_AND_WINGS + TRANSFORM;

ShaderPluginRegistry.registerModifier({
  name: VERTEBRATE_ANIMATION,
  createUniforms: () => ({
    uVertParams: { value: new Vector4(0.45, 0.22, 0.14, 0.065) },
    uVertMeta: { value: new Vector4(5.2, 0, 0.18, 0) },
    uVertRun: { value: 0 },
    uVertSleep: { value: 0 },
  }),
  vertexDeclarations: VERTEBRATE_VERTEX_DECLARATIONS,
  vertexNormalChunk: 'objectNormal = normalize(mat3(vertebrateTransform()) * normal);',
  vertexTransformChunk: `transformed = (vertebrateTransform() * vec4(position, 1.0)).xyz;
    vObjectNormal = normalize(mat3(vertebrateTransform()) * normal);`,
});
