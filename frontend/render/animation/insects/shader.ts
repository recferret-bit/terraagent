import { INSECT_SCALE } from './rig';
import { Vector4 } from 'three';
import { ShaderPluginRegistry } from '../../visuals/unified/registries';

export const INSECT_ANIMATION = 'insectAnimation';
const DECLARATIONS = /* glsl */ `
attribute float aInsectPart;
uniform vec4 uInsectAction;
uniform float uInsectSpecies;
uniform float uInsectWalk;
uniform float uInsectSacSide;
uniform float uInsectDeathSeed;
float insectScale() { return uInsectSpecies < 0.5 ? ${INSECT_SCALE[0]} : 1.0; }
vec4 insectQuat(vec3 from, vec3 to) {
  float w = 1.0 + dot(from, to);
  if (w < 0.0000001) {
    vec3 axis = abs(from.x) > abs(from.z) ? vec3(-from.y, from.x, 0.0) : vec3(0.0, -from.z, from.y);
    return vec4(normalize(axis), 0.0);
  }
  return normalize(vec4(cross(from, to), w));
}
vec3 insectRotate(vec3 v, vec4 q) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
mat3 insectRotation(vec4 q) {
  return mat3(insectRotate(vec3(1,0,0), q), insectRotate(vec3(0,1,0), q), insectRotate(vec3(0,0,1), q));
}
mat4 insectRigid(vec3 rest, vec3 anchor, mat3 rotation) {
  return mat4(vec4(rotation[0], 0), vec4(rotation[1], 0), vec4(rotation[2], 0), vec4(anchor - rotation * rest, 1));
}
mat4 insectPivot(vec3 pivot, vec3 axis, float angle) {
  return insectRigid(pivot, pivot, insectRotation(vec4(axis * sin(angle * 0.5), cos(angle * 0.5))));
}
`;
const BODY = /* glsl */ `
vec4 insectDeathRand() {
  if (uInsectDeathSeed <= 0.001) return vec4(0.0);
  return vec4(1.0, sin(uInsectDeathSeed * 43.17), cos(uInsectDeathSeed * 71.33), sin(uInsectDeathSeed * 119.71));
}
mat3 insectBodyRot(out float outPitch, out float outRoll, out float outYaw, out float outDeathRoll, out float outDeathPitch) {
  float death = uInsectAction.w, alive = 1.0 - death, g = uTime * 5.0;
  float w = uInsectWalk * alive * (1.0 - max(uInsectAction.x, uInsectAction.y)), c = uInsectAction.x * alive, a = uInsectAction.y * alive, h = uInsectAction.z * alive;
  bool beetle = uInsectSpecies > 0.5 && uInsectSpecies < 1.5;
  vec4 dr = insectDeathRand();
  float rollSign = dr.y >= 0.0 ? 1.0 : -1.0;
  outDeathRoll = dr.x * rollSign * (0.26 + 0.28 * abs(dr.y)) * death;
  outDeathPitch = dr.x * dr.w * 0.16 * death;
  outYaw = dr.x * dr.z * 1.85 * death;
  outPitch = sin(g * 2.0 - 0.45) * 0.036 * w + (beetle ? 0.075 * c + 0.04 * a : -0.045 * c + 0.06 * a) + outDeathPitch;
  outRoll = sin(g - 0.25) * 0.045 * w + sin(g * 4.0) * 0.045 * h + outDeathRoll;
  mat3 ry = insectRotation(vec4(0, sin(outYaw * 0.5), 0, cos(outYaw * 0.5)));
  mat3 rx = insectRotation(vec4(sin(outPitch * 0.5), 0, 0, cos(outPitch * 0.5)));
  mat3 rz = insectRotation(vec4(0, 0, sin(outRoll * 0.5), cos(outRoll * 0.5)));
  return ry * rx * rz;
}
mat4 insectBody() {
  float death = uInsectAction.w, alive = 1.0 - death, g = uTime * 5.0;
  float w = uInsectWalk * alive * (1.0 - max(uInsectAction.x, uInsectAction.y)), c = uInsectAction.x * alive, a = uInsectAction.y * alive, h = uInsectAction.z * alive;
  bool beetle = uInsectSpecies > 0.5 && uInsectSpecies < 1.5;
  bool spitter = uInsectSpecies > 1.5;
  vec4 dr = insectDeathRand();
  float outPitch, outRoll, outYaw, deathRoll, deathPitch;
  mat3 rot = insectBodyRot(outPitch, outRoll, outYaw, deathRoll, deathPitch);
  float flipLift = dr.x * ((spitter ? 0.32 : beetle ? 0.45 : 0.22) * abs(sin(deathRoll))
    + (spitter ? 0.28 : beetle ? 0.30 : 0.18) * 0.5 * (1.0 - cos(deathRoll)) + 0.28 * abs(sin(deathPitch))) * death;
  float bounceJump = dr.x * sin(min(1.0, death) * 3.14159265) * 0.18;
  float knockBack = dr.x * 0.34 * death;
  vec3 anchor = vec3(cos(g) * 0.022 * w + dr.y * knockBack,
    0.76 + (-cos(g * 2.0) * 0.02 - sin(g * 2.0) * 0.01) * w - 0.025 * c - (beetle ? 0.385 : 0.43) * death * death + flipLift + bounceJump,
    sin(g * 2.0) * 0.018 * w - 0.035 * c + (beetle ? 0.16 : 0.26) * a - 0.05 * h + dr.z * knockBack);
  return insectRigid(vec3(0,0.76,0), anchor, rot);
}
mat4 insectHead() {
  bool beetle = uInsectSpecies > 0.5 && uInsectSpecies < 1.5;
  vec4 dr = insectDeathRand();
  float angle = beetle ? 0.13 * uInsectAction.x + 0.30 * uInsectAction.y : -0.07 * uInsectAction.x + 0.10 * uInsectAction.y;
  vec3 pivot = uInsectSpecies < 0.5 ? vec3(0,0.66,0.43) : beetle ? vec3(0,0.65,0.59) : vec3(0,0.65,0.35);
  return insectPivot(pivot, vec3(1,0,0), angle * (1.0 - uInsectAction.w) + (0.08 + dr.x * dr.w * 0.14) * uInsectAction.w);
}
mat4 insectAbdomen() {
  vec4 dr = insectDeathRand();
  float angle = uInsectSpecies > 1.5 ? 0.34 * uInsectAction.x - 0.14 * uInsectAction.y : sin(uTime * 2.1) * 0.012;
  vec3 pivot = uInsectSpecies < 0.5 ? vec3(0,0.66,-0.48) : uInsectSpecies < 1.5 ? vec3(0,0.63,0.1) : vec3(0,0.77,-0.42);
  return insectPivot(pivot, vec3(1,0,0), angle * (1.0 - uInsectAction.w) + dr.x * dr.y * 0.14 * uInsectAction.w);
}
`;
const LEGS = /* glsl */ `
mat4 insectLeg(mat4 body) {
  vec3 hip0 = aPartAnim.yzw / insectScale();
  float side = sign(hip0.x), death = uInsectAction.w;
  vec3 knee0 = vec3(hip0.x * 2.0, hip0.y + 0.24, hip0.z * 1.5);
  vec3 toe0 = vec3(hip0.x * 2.0 + side * 0.12, 0.027, hip0.z * 1.75);
  vec3 hip = (body * vec4(hip0, 1)).xyz;
  if (death > 0.0) {
    vec4 dr = insectDeathRand();
    float outPitch, outRoll, outYaw, deathRoll, deathPitch;
    insectBodyRot(outPitch, outRoll, outYaw, deathRoll, deathPitch);
    float legHash = sin(uInsectDeathSeed * 97.1 + hip0.x * 5.7 + hip0.z * 11.3);
    float uAng = side * (-0.10 - dr.x * 0.08 * abs(legHash)) * death - deathRoll * 0.18;
    float lAng = side * (1.15 + dr.x * 0.06 * abs(legHash)) * death - deathRoll * 0.16;
    mat3 frameR = insectRotation(vec4(0, sin(outYaw * 0.5), 0, cos(outYaw * 0.5)))
      * insectRotation(vec4(sin(deathPitch * 0.5), 0, 0, cos(deathPitch * 0.5)));
    mat3 upper = frameR * insectRotation(vec4(0, 0, sin(uAng * 0.5), cos(uAng * 0.5)));
    vec3 knee = hip + upper * (knee0 - hip0);
    if (aInsectPart < 7.5) return insectRigid(hip0, hip, upper);
    mat3 lower = frameR * insectRotation(vec4(0, 0, sin(lAng * 0.5), cos(lAng * 0.5)));
    return insectRigid(knee0, knee, lower);
  }
  float phase = uTime * 5.0 + (side > 0.0 ? 0.0 : 3.14159265359) + (abs(hip0.z) > 0.1 ? 3.14159265359 : 0.0);
  float walk = uInsectWalk * (1.0 - death) * (1.0 - max(uInsectAction.x, uInsectAction.y));
  vec3 toe = toe0;
  toe.z += sin(phase) * 0.13 * walk;
  toe.y += 0.025 * walk + (uInsectSpecies > 0.5 && uInsectSpecies < 1.5 ? 0.015 : 0.035) * uInsectAction.y;
  toe.y += pow(max(0.0, cos(phase)), 0.8) * 0.085 * walk;
  float l1 = distance(hip0, knee0), l2 = distance(knee0, toe0);
  vec3 axis = normalize(toe - hip);
  float dist = clamp(distance(hip, toe), abs(l2 - l1) + 0.0001, l1 + l2 - 0.0001);
  toe = hip + axis * dist;
  vec3 bend = knee0 - hip0;
  bend = normalize(bend - axis * dot(bend, axis));
  float along = (l1 * l1 - l2 * l2 + dist * dist) / (2.0 * dist);
  vec3 knee = hip + axis * along + bend * sqrt(max(0.0, l1 * l1 - along * along));
  bool upper = aInsectPart < 7.5;
  vec3 rest = upper ? hip0 : knee0, origin = upper ? hip : knee;
  vec3 oldAxis = normalize(upper ? knee0 - hip0 : toe0 - knee0);
  vec3 newAxis = normalize(upper ? knee - hip : toe - knee);
  return insectRigid(rest, origin, insectRotation(insectQuat(oldAxis, newAxis)));
}
`;
const POSE = /* glsl */ `
mat4 insectAuthoredTransform() {
  mat4 body = insectBody();
  float part = aInsectPart;
  if (part > 6.5) return insectLeg(body);
  vec3 pivot = aPartAnim.yzw / insectScale();
  float side = pivot.x >= 0.0 ? 1.0 : -1.0;
  if ((part > 2.5 && part < 3.5) || (part > 5.5 && part < 6.5)) {
    body *= insectAbdomen();
    if (part > 5.5) {
      float selectedSac = sign(pivot.x) == uInsectSacSide ? 1.0 : 0.0;
      float pulse = (0.025 * sin(uTime * 5.0 + pivot.x * 3.0)
        + 0.18 * uInsectAction.x * (0.3 + 0.7 * selectedSac) - 0.10 * uInsectAction.y * selectedSac) * (1.0 - uInsectAction.w);
      body *= insectRigid(pivot, pivot, mat3(1.0 + pulse));
    }
  } else if (part > 1.5 && part < 5.5) {
    body *= insectHead();
    if (part > 3.5 && part < 4.5) body *= insectPivot(pivot, vec3(0,1,0), side * (0.04 + 0.34 * uInsectAction.x - 0.04 * uInsectAction.y) * (1.0 - uInsectAction.w));
    if (part > 4.5) body *= insectPivot(pivot, vec3(0,1,0), side * (0.09 * sin(uTime * 4.0 + pivot.x * 9.0) + 0.03 * sin(uTime * 9.0) - 0.12 * uInsectAction.x) * (1.0 - uInsectAction.w));
  }
  return body;
}
`;
const SCALE = /* glsl */ `
mat4 insectTransform() {
  mat4 pose = insectAuthoredTransform();
  pose[3].xyz *= insectScale();
  return pose;
}
`;
export const INSECT_VERTEX_DECLARATIONS = DECLARATIONS + BODY + LEGS + POSE + SCALE;
ShaderPluginRegistry.registerModifier({
  name: INSECT_ANIMATION,
  createUniforms: () => ({ uInsectAction: { value: new Vector4() }, uInsectSpecies: { value: 0 }, uInsectWalk: { value: 0 }, uInsectSacSide: { value: -1 }, uInsectDeathSeed: { value: 0 } }),
  vertexDeclarations: INSECT_VERTEX_DECLARATIONS,
  vertexNormalChunk: 'objectNormal = normalize(mat3(insectTransform()) * normal);',
  vertexTransformChunk: `transformed = (insectTransform() * vec4(position, 1.0)).xyz;
    vObjectNormal = normalize(mat3(insectTransform()) * normal);`,
});
