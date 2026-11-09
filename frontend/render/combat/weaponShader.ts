import { Vector2, Vector3 } from 'three';
import { ShaderPluginRegistry } from '../visuals/unified/registries';

export const WEAPON_RIG = 'weaponRig';
const DECLARATIONS = /* glsl */ `
attribute float aWeaponPart;
uniform vec3 uWeaponPivot;
uniform vec3 uWeaponLeftPivot;
uniform vec3 uWeaponRightPivot;
uniform vec3 uWeaponTarget;
uniform vec2 uWeaponRecoil;
uniform float uWeaponCarrier;
uniform float uWeaponEnabled;
uniform float uWeaponLift;
uniform float uWeaponOffsetY;
vec3 weaponRotate(vec3 v, vec4 q) {
  return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
}
mat4 weaponRigid(vec3 rest, vec3 anchor, mat3 rotation) {
  return mat4(vec4(rotation[0], 0.0), vec4(rotation[1], 0.0),
    vec4(rotation[2], 0.0), vec4(anchor - rotation * rest, 1.0));
}`;

/** Closed-form steering, evaluated on the GPU. WeaponRig.matrices mirrors it for emission sockets. */
const TRANSFORM = /* glsl */ `
mat4 weaponTransform() {
  vec3 offset = vec3(0.0, uWeaponOffsetY, 0.0);
  vec3 pivot = uWeaponPivot - offset;
  vec3 mount = uWeaponPivot;
  if (uWeaponCarrier > 8.5) mount = spiderBodyTransform(mount, uTime * 5.0, uWalkWeight, uWorkWeight);
  else if (uWeaponCarrier > 7.5) mount = bipedBodyTransform(mount, uTime * 5.0, uWalkWeight, uWorkWeight);
  mount -= offset;
  vec3 toTarget = uWeaponTarget - mount;
  float yaw = uWeaponEnabled > 0.5 ? atan(toTarget.x, toTarget.z) : 0.0;
  float c = cos(yaw), s = sin(yaw);
  mat3 head = mat3(vec3(c, 0.0, -s), vec3(0.0, 1.0, 0.0), vec3(s, 0.0, c));
  if (aWeaponPart < 1.5) return weaponRigid(pivot, mount, head);
  bool left = aWeaponPart < 2.5;
  vec3 rest = (left ? uWeaponLeftPivot : uWeaponRightPivot) - offset;
  vec3 anchor = mount + head * (rest - pivot);
  vec3 direction = uWeaponEnabled > 0.5 ? uWeaponTarget - anchor : head * vec3(0.0, 0.0, 1.0);
  direction.y += uWeaponLift;
  direction = normalize(direction);
  float w = 1.0 + direction.z;
  vec4 q = w < 0.0000001 ? vec4(0.0, -1.0, 0.0, 0.0) : normalize(vec4(-direction.y, direction.x, 0.0, w));
  mat3 rotation = mat3(weaponRotate(vec3(1.0, 0.0, 0.0), q),
    weaponRotate(vec3(0.0, 1.0, 0.0), q), weaponRotate(vec3(0.0, 0.0, 1.0), q));
  anchor -= direction * (left ? uWeaponRecoil.x : uWeaponRecoil.y);
  return weaponRigid(rest, anchor, rotation);
}`;

export const WEAPON_VERTEX_DECLARATIONS = DECLARATIONS + TRANSFORM;

ShaderPluginRegistry.registerModifier({
  name: WEAPON_RIG,
  createUniforms: () => ({
    uWeaponPivot: { value: new Vector3() }, uWeaponLeftPivot: { value: new Vector3() },
    uWeaponRightPivot: { value: new Vector3() }, uWeaponTarget: { value: new Vector3() },
    uWeaponRecoil: { value: new Vector2() }, uWeaponCarrier: { value: 0 },
    uWeaponEnabled: { value: 0 }, uWeaponLift: { value: 0 }, uWeaponOffsetY: { value: 0 },
  }),
  vertexDeclarations: WEAPON_VERTEX_DECLARATIONS,
  vertexNormalChunk: 'if (aWeaponPart > 0.5) objectNormal = mat3(weaponTransform()) * objectNormal;',
  vertexTransformChunk: `if (aWeaponPart > 0.5) {
    transformed = (weaponTransform() * vec4(position, 1.0)).xyz;
    vObjectNormal = mat3(weaponTransform()) * normal;
  }`,
});
