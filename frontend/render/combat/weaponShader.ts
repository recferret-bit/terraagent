import { Vector2, Vector3, Vector4, type Vector3Like } from 'three';
import { ShaderPluginRegistry } from '../visuals/unified/registries';

export const WEAPON_RIG = 'weaponRig';

export function computeBarrelTipSpan(barrelLength: number): number {
  return Math.max(0.13, Math.min(0.17, Math.max(barrelLength, 0.001) * 0.19));
}

/** Exact CPU mirror of the fragment-stage barrel tip heat falloff (`0` along tube, `1` at muzzle tip). */
export function computeBarrelTipHeatMask(
  pos: Vector3Like,
  pivot: Vector3Like,
  muzzle: Vector3Like,
  offsetY = 0,
): number {
  const px = pivot.x, py = pivot.y - offsetY, pz = pivot.z;
  const mx = muzzle.x, my = muzzle.y - offsetY, mz = muzzle.z;
  const ax = mx - px, ay = my - py, az = mz - pz;
  const len = Math.max(Math.hypot(ax, ay, az), 0.001);
  const dx = ax / len, dy = ay / len, dz = az / len;
  const distFromTip = (mx - pos.x) * dx + (my - pos.y) * dy + (mz - pos.z) * dz;
  const tipSpan = computeBarrelTipSpan(len);
  const u = Math.max(0, Math.min(1, 1 - distFromTip / Math.max(tipSpan, 0.001)));
  return u * u * (3 - 2 * u);
}

const DECLARATIONS = /* glsl */ `
attribute float aWeaponPart;
uniform vec3 uWeaponPivot;
uniform vec3 uWeaponLeftPivot;
uniform vec3 uWeaponRightPivot;
uniform vec3 uWeaponLeftMuzzle;
uniform vec3 uWeaponRightMuzzle;
uniform vec3 uWeaponLeftDir;
uniform vec3 uWeaponRightDir;
uniform float uWeaponYaw;
uniform vec2 uWeaponRecoil;
uniform vec4 uWeaponRecoilBody;
uniform vec3 uWeaponBodyScale;
uniform float uWeaponChassisRecoil;
uniform float uWeaponCarrier;
uniform float uWeaponHeat;
uniform float uWeaponHeatScale;
uniform vec2 uWeaponSideHeat;
uniform float uWeaponOffsetY;
varying float vWeaponHeat;
varying float vWeaponTipDist;
varying float vWeaponTipSpan;
vec3 weaponRotate(vec3 v, vec4 q) {
  return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
}
mat4 weaponRigid(vec3 rest, vec3 anchor, mat3 rotation) {
  return mat4(vec4(rotation[0], 0.0), vec4(rotation[1], 0.0),
    vec4(rotation[2], 0.0), vec4(anchor - rotation * rest, 1.0));
}`;

/** Closed-form slewed turret steering + SpinY turret radar + unified suspension body recoil, evaluated on the GPU. */
const TRANSFORM = /* glsl */ `
vec3 weaponBodyRecoilDelta(vec3 pos) {
  float kick = uWeaponRecoilBody.w * uWeaponChassisRecoil;
  if (kick <= 0.0001) return vec3(0.0);
  float baseH = uWeaponCarrier > 8.5 ? 0.65 : 0.35;
  float minY = uWeaponCarrier > 8.5 ? 0.05 : 0.25;
  float w = clamp((pos.y + uWeaponOffsetY - minY) / baseH, 0.0, 1.0);
  vec3 horizBack = vec3(-uWeaponRecoilBody.x, 0.0, -uWeaponRecoilBody.z);
  float pushDist = uWeaponBodyScale.x * kick * w;
  float dropY = -uWeaponBodyScale.y * kick * w;
  float pitchAmt = uWeaponBodyScale.z * kick * w;
  vec3 pitchCenter = vec3(0.0, 0.72 - uWeaponOffsetY, 0.0);
  vec3 rel = pos - pitchCenter;
  float along = dot(rel, -horizBack);
  return horizBack * (pushDist + rel.y * pitchAmt) + vec3(0.0, dropY + along * pitchAmt, 0.0);
}

mat4 weaponTransform() {
  vec3 offset = vec3(0.0, uWeaponOffsetY, 0.0);
  vec3 pivot = uWeaponPivot - offset;
  vec3 mount = uWeaponPivot;
  if (uWeaponCarrier > 8.5) mount = spiderBodyTransform(mount, uTime * 5.0, uWalkWeight, uWorkWeight);
  else if (uWeaponCarrier > 7.5) mount = bipedBodyTransform(mount, uTime * 5.0, uWalkWeight, uWorkWeight);
  mount -= offset;
  vec3 headRec = weaponBodyRecoilDelta(mount);
  float c = cos(uWeaponYaw), s = sin(uWeaponYaw);
  mat3 head = mat3(vec3(c, 0.0, -s), vec3(0.0, 1.0, 0.0), vec3(s, 0.0, c));
  if (aWeaponPart < 1.5) {
    mat4 headMat = weaponRigid(pivot, mount + headRec, head);
    float rawW = floor(aPartAnim.x + 0.5);
    float subW = floor(rawW / 10.0);
    float typeW = rawW - subW * 10.0;
    if (abs(typeW - 1.0) < 0.1 || (typeW > 7.5 && abs(subW - 1.0) < 0.1)) {
      float spinAng = (typeW > 7.5) ? uTime * 5.0 * (1.0 + uWorkWeight) : uTime * (2.5 + 10.0 * uWorkWeight);
      float cs = cos(spinAng), ss = sin(spinAng);
      mat3 spinMat = mat3(vec3(cs, 0.0, -ss), vec3(0.0, 1.0, 0.0), vec3(ss, 0.0, cs));
      vec3 spinPiv = aPartAnim.yzw - offset;
      return headMat * weaponRigid(spinPiv, spinPiv, spinMat);
    }
    return headMat;
  }
  bool left = aWeaponPart < 2.5;
  vec3 rest = (left ? uWeaponLeftPivot : uWeaponRightPivot) - offset;
  vec3 anchor = mount + headRec + head * (rest - pivot);
  vec3 direction = normalize(left ? uWeaponLeftDir : uWeaponRightDir);
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
    uWeaponPivot: { value: new Vector3() },
    uWeaponLeftPivot: { value: new Vector3() },
    uWeaponRightPivot: { value: new Vector3() },
    uWeaponLeftMuzzle: { value: new Vector3(0, 0, 1) },
    uWeaponRightMuzzle: { value: new Vector3(0, 0, 1) },
    uWeaponLeftDir: { value: new Vector3(0, 0, 1) },
    uWeaponRightDir: { value: new Vector3(0, 0, 1) },
    uWeaponYaw: { value: 0 },
    uWeaponRecoil: { value: new Vector2() },
    uWeaponRecoilBody: { value: new Vector4(0, 0, 1, 0) },
    uWeaponBodyScale: { value: new Vector3(0.085, 0.055, 0.085) },
    uWeaponChassisRecoil: { value: 1 },
    uWeaponCarrier: { value: 0 },
    uWeaponHeat: { value: 0 },
    uWeaponHeatScale: { value: 1 },
    uWeaponSideHeat: { value: new Vector2(1, 1) },
    uWeaponOffsetY: { value: 0 },
  }),
  vertexDeclarations: WEAPON_VERTEX_DECLARATIONS,
  fragmentDeclarations: `varying float vWeaponHeat;
varying float vWeaponTipDist;
varying float vWeaponTipSpan;`,
  vertexNormalChunk: 'if (aWeaponPart > 0.5) objectNormal = mat3(weaponTransform()) * objectNormal;',
  vertexTransformChunk: `if (aWeaponPart > 0.5) {
    transformed = (weaponTransform() * vec4(position, 1.0)).xyz;
    vObjectNormal = mat3(weaponTransform()) * normal;
    if (aWeaponPart > 1.5 && uWeaponHeat > 0.001) {
      bool taWpnLeft = aWeaponPart < 2.5;
      float taWpnSideHeat = taWpnLeft ? uWeaponSideHeat.x : uWeaponSideHeat.y;
      vec3 taWpnOffset = vec3(0.0, uWeaponOffsetY, 0.0);
      vec3 taWpnPivot = (taWpnLeft ? uWeaponLeftPivot : uWeaponRightPivot) - taWpnOffset;
      vec3 taWpnMuzzle = (taWpnLeft ? uWeaponLeftMuzzle : uWeaponRightMuzzle) - taWpnOffset;
      vec3 taWpnAxis = taWpnMuzzle - taWpnPivot;
      float taWpnLen = max(length(taWpnAxis), 0.001);
      vec3 taWpnDir = taWpnAxis / taWpnLen;
      vWeaponTipDist = dot(taWpnMuzzle - position, taWpnDir);
      vWeaponTipSpan = clamp(taWpnLen * 0.19, 0.13, 0.17);
      vWeaponHeat = uWeaponHeat * taWpnSideHeat * uWeaponHeatScale;
    } else {
      vWeaponHeat = 0.0;
      vWeaponTipDist = 10.0;
      vWeaponTipSpan = 0.15;
    }
  } else {
    if (uWeaponChassisRecoil > 0.5) {
      float raw0 = floor(aPartAnim.x + 0.5);
      float type0 = raw0 - floor(raw0 / 10.0) * 10.0;
      if (abs(type0 - 7.0) > 0.1) {
        transformed += weaponBodyRecoilDelta(position);
      }
    }
    vWeaponHeat = 0.0;
    vWeaponTipDist = 10.0;
    vWeaponTipSpan = 0.15;
  }`,
  fragmentEmissiveChunk: `if (vWeaponHeat > 0.002) {
    float taWpnTip = smoothstep(0.0, 1.0, clamp(1.0 - vWeaponTipDist / max(vWeaponTipSpan, 0.001), 0.0, 1.0));
    float taWpnLocalHeat = vWeaponHeat * taWpnTip;
    if (taWpnLocalHeat > 0.002) {
      vec3 taHeatColor = mix(vec3(1.0, 0.18, 0.02), vec3(1.8, 0.88, 0.32), smoothstep(0.35, 1.0, taWpnLocalHeat));
      totalEmissiveRadiance += taHeatColor * taWpnLocalHeat * 2.4;
    }
  }`,
});
