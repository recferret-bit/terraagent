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
    float activeFlap = smoothstep(0.10, 0.45, uWalkWeight) * uWalkWeight;
    float bob = sin(g) * 0.032 * activeFlap + sin(uTime * 1.8) * 0.010 * (1.0 - activeFlap);
    float pitch = -cos(g) * 0.045 * activeFlap;
    return vertRigid(vec3(0.0, comY, 0.0), vec3(0.0, comY + bob, 0.0), vertRpyMat(0.0, pitch, 0.0));
  }

  float up = 1.0 - uVertSleep;
  float w = uWalkWeight * up;
  float r = uVertRun * up;
  float trotW = w * (1.0 - r);
  float gallopW = max(w, r) * r;
  float wk = uWorkWeight * up;
  float breath = sin(uTime * 2.2) * 0.004 * up * (1.0 - w);

  float heave = (-cos(2.0 * g) * 0.014 - sin(2.0 * g) * 0.006) * trotW
    + sin(g * 1.35) * liftHeight * 0.42 * gallopW
    - uVertSleep * sleepDrop + breath;
  float pitch = sin(2.0 * g - 0.35) * 0.022 * trotW
    + cos(g * 1.35) * 0.075 * gallopW + wk * 0.08 * up + uVertSleep * 0.03;
  float roll = sin(g - 0.25) * 0.028 * trotW;
  float yaw = -cos(g) * 0.022 * trotW;
  float swayX = cos(g) * 0.012 * trotW;
  float surgeZ = sin(2.0 * g) * 0.012 * trotW + cos(g * 1.35 - 0.4) * strideLen * 0.16 * gallopW;

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
  float lift = liftHeight * (trotW + 1.30 * gallopW);
  float dy = pow(max(0.0, cos(tau)), 0.8) * lift;
  toe.z += sin(tau) * amp;
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
    float swingTilt = -sin(tau) * 0.03 * smoothstep(0.005, 0.04, dy);
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
  float activeFlap = smoothstep(0.10, 0.45, uWalkWeight) * uWalkWeight;
  float stroke = sin(g) - 0.16 * sin(2.0 * g);
  vec3 shoulder = aPartAnim.yzw;
  float side = shoulder.x >= 0.0 ? 1.0 : -1.0;

  float innerRoll = side * (0.09 * (1.0 - activeFlap) + uVertParams.z * activeFlap * stroke);
  float innerPitch = -0.06 * activeFlap * cos(g);
  mat4 innerMat = body * vertPivotRpy(shoulder, innerRoll, innerPitch, 0.0);
  if (role < 7.5) return innerMat;

  float upFactor = max(0.0, stroke);
  float downFactor = max(0.0, -stroke);
  float outerRoll = side * (-0.11 * (1.0 - activeFlap) - uVertParams.w * activeFlap * upFactor + 0.14 * activeFlap * downFactor);
  float outerYaw = side * (0.10 * activeFlap * upFactor);
  return innerMat * vertPivotRpy(aVertJoint.xyz, outerRoll, 0.0, outerYaw);
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
    float graze = (0.56 + 0.06 * sin(g * 2.0)) * uWorkWeight * up;
    float stabilize = (-sin(2.0 * g - 0.35) * 0.014 * uWalkWeight * (1.0 - uVertRun) - cos(g * 1.35) * 0.045 * uVertRun) * up;
    float sleepHead = uVertSleep * uVertMeta.z;
    float idleYaw = sin(uTime * 0.9) * 0.08 * (1.0 - uWalkWeight) * up;
    return body * vertPivotRpy(pivot, 0.0, graze + stabilize + sleepHead, idleYaw);
  }
  if (role < 3.5) {
    float up = 1.0 - uVertSleep;
    float yaw = (0.20 * sin(g * 1.1 + 0.6) * (0.2 + 0.8 * uWalkWeight) + 0.12 * sin(g * 2.0) * uWorkWeight) * up + uVertSleep * 0.18;
    float pitch = 0.12 * sin(g * 1.35) * uVertRun * up + uVertSleep * 0.42;
    return body * vertPivotRpy(pivot, 0.0, pitch, yaw);
  }
  if (role < 9.5) {
    float activeFlap = smoothstep(0.10, 0.45, uWalkWeight) * uWalkWeight;
    float pitch = -0.08 * activeFlap * sin(g) + 0.03 * sin(uTime * 2.0);
    return body * vertPivotRpy(pivot, 0.0, pitch, 0.0);
  }
  float activeFlap = smoothstep(0.10, 0.45, uWalkWeight) * uWalkWeight;
  float pitch = cos(g) * 0.025 * activeFlap;
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
