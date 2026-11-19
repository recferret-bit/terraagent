/** Biological fields share anatomical UVs across pigmentation, roughness and micro-normal response. */
export const ORGANIC_DECL = /* glsl */ `
uniform sampler2D uFurPelageMap;
uniform sampler2D uFurRoughnessMap;
uniform sampler2D uFeatherVaneMap;
uniform sampler2D uFeatherRoughnessMap;
varying float vOrganic;
varying vec2 vAnatomy;
float furValueNoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = fract(sin(dot(i, vec3(127.1, 311.7, 74.7))) * 43758.5453);
  float n100 = fract(sin(dot(i + vec3(1.0, 0.0, 0.0), vec3(127.1, 311.7, 74.7))) * 43758.5453);
  float n010 = fract(sin(dot(i + vec3(0.0, 1.0, 0.0), vec3(127.1, 311.7, 74.7))) * 43758.5453);
  float n110 = fract(sin(dot(i + vec3(1.0, 1.0, 0.0), vec3(127.1, 311.7, 74.7))) * 43758.5453);
  float n001 = fract(sin(dot(i + vec3(0.0, 0.0, 1.0), vec3(127.1, 311.7, 74.7))) * 43758.5453);
  float n101 = fract(sin(dot(i + vec3(1.0, 0.0, 1.0), vec3(127.1, 311.7, 74.7))) * 43758.5453);
  float n011 = fract(sin(dot(i + vec3(0.0, 1.0, 1.0), vec3(127.1, 311.7, 74.7))) * 43758.5453);
  float n111 = fract(sin(dot(i + vec3(1.0, 1.0, 1.0), vec3(127.1, 311.7, 74.7))) * 43758.5453);
  float nx00 = mix(n000, n100, f.x);
  float nx10 = mix(n010, n110, f.x);
  float nx01 = mix(n001, n101, f.x);
  float nx11 = mix(n011, n111, f.x);
  return mix(mix(nx00, nx10, f.y), mix(nx01, nx11, f.y), f.z);
}
// Organic non-repeating fur tuft field stretched along hair lay (caudal -z, ventral -y) — zero parallel stripes.
float furTuftField(vec3 lp) {
  vec3 q = lp * vec3(20.0, 16.0, 11.0);
  float w1 = furValueNoise3(q * 0.55 + vec3(1.7, 3.1, 5.3));
  vec3 warped = q + vec3(w1 * 1.4, -w1 * 1.1, w1 * 1.8);
  float macro = furValueNoise3(warped);
  float mid = furValueNoise3(warped * 1.9 + vec3(4.2, -2.1, 7.9));
  return clamp((macro * 0.65 + mid * 0.35 - 0.5) * 2.0, -1.0, 1.0);
}
float organicField(vec2 uv, float tissue, float footprint, float furLuma, float featherLuma, float furClump) {
  vec2 p = uv * vec2(6.2831853, 28.0);
  float grain = sin(p.x * 11.0 + sin(p.y * 1.71)) * sin(p.y * 2.47 + sin(p.x * 7.0));
  float growth = sin(uv.y * 88.0 + sin(uv.x * 12.566) * 1.7);
  float veins = pow(max(0.0, 1.0 - abs(sin(p.x * 3.0 + sin(p.y * 0.39) * 2.0))), 7.0);
  float fineFade = 1.0 - smoothstep(0.35, 1.4, footprint);
  float furMacroFade = 1.0 - smoothstep(2.0, 4.8, footprint);
  if (tissue > 5.5 && tissue < 6.5) {
    return ((furLuma - 0.74) * 1.15 + furClump * 0.34 + grain * 0.06 * fineFade) * furMacroFade;
  }
  if (tissue > 6.5) {
    return ((featherLuma - 0.77) * 0.80 + grain * 0.08) * fineFade;
  }
  if (tissue > 2.5 && tissue < 3.5) return (grain * 0.12 - veins * 0.7) * fineFade;
  if (tissue > 3.5 && tissue < 4.5) return (grain * 0.7 + growth * 0.15) * fineFade;
  return (grain * 0.18 + growth * 0.35) * fineFade;
}
float organicWeather() {
  if (vOrganic < 0.5) return 1.0;
  float underside = 1.0 - smoothstep(-0.5, 0.6, normalize(vObjectNormal).y);
  return mix(1.0, 0.20 + 0.55 * underside, step(0.5, vOrganic));
}`;
export const ORGANIC_COLOR = /* glsl */ `
float taFurClump = furTuftField(vLocalPos);
vec3 taFurW = pow(abs(normalize(vObjectNormal)), vec3(3.0));
taFurW /= max(dot(taFurW, vec3(1.0)), 0.0001);
vec2 taFurWarp = vec2(taFurClump * 0.12, -taFurClump * 0.09);
vec2 taFurUvX = vLocalPos.zy * vec2(2.2, 2.6) + taFurWarp;
vec2 taFurUvY = vLocalPos.xz * vec2(2.4, 2.2) + taFurWarp;
vec2 taFurUvZ = vLocalPos.xy * vec2(2.4, 2.6) + taFurWarp;
vec2 taFeatherUv = vAnatomy * vec2(2.8, 3.8) + vLocalPos.xz * 2.6;
float taFurLuma =
  dot(texture2D(uFurPelageMap, taFurUvX).rgb, vec3(0.3333)) * taFurW.x +
  dot(texture2D(uFurPelageMap, taFurUvY).rgb, vec3(0.3333)) * taFurW.y +
  dot(texture2D(uFurPelageMap, taFurUvZ).rgb, vec3(0.3333)) * taFurW.z;
vec3 taFeatherTex = texture2D(uFeatherVaneMap, taFeatherUv).rgb;
float taFeatherLuma = dot(taFeatherTex, vec3(0.3333));
if (vOrganic > 0.5) {
  float field = organicField(vAnatomy, vOrganic, organicFootprint, taFurLuma, taFeatherLuma, taFurClump);
  diffuseColor.rgb *= 1.0 + field * 0.14;
  if (vOrganic > 2.5 && vOrganic < 3.5) {
    float thickness = sin(vAnatomy.y * 3.14159);
    diffuseColor.rgb *= mix(vec3(1.14, 1.06, 0.76), vec3(0.67, 0.88, 0.62), thickness * 0.45);
  } else if (vOrganic > 5.5 && vOrganic < 6.5) {
    float furDetail = 1.0 - smoothstep(2.0, 4.8, organicFootprint);
    float furLockShade = clamp((taFurLuma - 0.74) * 1.15 + taFurClump * 0.16, -0.22, 0.20);
    diffuseColor.rgb *= clamp(1.0 + furLockShade * furDetail, 0.76, 1.20);
  } else if (vOrganic > 6.5) {
    float featherDetail = 1.0 - smoothstep(0.45, 1.6, organicFootprint);
    diffuseColor.rgb *= mix(1.0, clamp(taFeatherLuma / 0.77, 0.80, 1.18), 0.28 * featherDetail);
  }
}`;
export const ORGANIC_ROUGHNESS = /* glsl */ `
float taFurRough =
  texture2D(uFurRoughnessMap, taFurUvX).r * taFurW.x +
  texture2D(uFurRoughnessMap, taFurUvY).r * taFurW.y +
  texture2D(uFurRoughnessMap, taFurUvZ).r * taFurW.z;
float taFeatherRough = texture2D(uFeatherRoughnessMap, taFeatherUv).r;
if (vOrganic > 0.5) {
  float roughField = organicField(vAnatomy, vOrganic, organicFootprint, taFurLuma, taFeatherLuma, taFurClump);
  roughnessFactor = clamp(roughnessFactor + roughField * 0.06, 0.16, 0.98);
  if (vOrganic > 2.5 && vOrganic < 3.5) roughnessFactor = 0.26 + roughField * 0.06;
  else if (vOrganic > 5.5 && vOrganic < 6.5) {
    roughnessFactor = clamp(mix(roughnessFactor, taFurRough, 0.42), 0.40, 0.92);
  } else if (vOrganic > 6.5) {
    roughnessFactor = clamp(mix(roughnessFactor, taFeatherRough, 0.32), 0.32, 0.86);
  }
}`;
export const ORGANIC_NORMAL = /* glsl */ `
float organicHeight = 0.0;
bool hasOrganicMicroNormal = (vOrganic > 0.5 && vOrganic < 3.5) || vOrganic > 5.5;
if (hasOrganicMicroNormal) {
  float normGain = (vOrganic > 5.5 && vOrganic < 6.5) ? 0.00165 : (vOrganic > 5.5 ? 0.00072 : 0.00045);
  organicHeight = organicField(vAnatomy, vOrganic, organicFootprint, taFurLuma, taFeatherLuma, taFurClump) * normGain;
}
// Evaluate derivatives outside tissue-dependent control flow, including at silhouette/profile edges.
vec3 organicDx = dFdx(-vViewPosition), organicDy = dFdy(-vViewPosition);
vec2 organicDh = vec2(dFdx(organicHeight), dFdy(organicHeight));
if (hasOrganicMicroNormal) {
  vec3 rx = cross(organicDy, normal), ry = cross(normal, organicDx);
  float det = dot(organicDx, rx);
  vec3 gradient = sign(det) * (organicDh.x * rx + organicDh.y * ry);
  normal = normalize(abs(det) * normal - gradient + normal * 0.0000001);
}`;
export const ORGANIC_MOTION = /* glsl */ `
if (abs(rawAnim - 49.0) < 0.1 || abs(rawAnim - 59.0) < 0.1) {
  float side = pivot.x >= 0.0 ? 1.0 : -1.0;
  float a = abs(rawAnim - 49.0) < 0.1
    ? -side * (0.06 + 0.24 * uWorkWeight * (0.5 + 0.5 * sin(g * 2.0)))
    : side * (0.10 * sin(g + pivot.x * 9.0) + 0.04 * sin(g * 2.0));
  vec3 r = transformed - pivot;
  transformed.x = pivot.x + r.x * cos(a) - r.z * sin(a);
  transformed.z = pivot.z + r.x * sin(a) + r.z * cos(a);
}
if (abs(rawAnim - 69.0) < 0.1 || abs(rawAnim - 60.0) < 0.1) {
  float pulse = 1.0 + 0.018 * sin(g + pivot.x * 3.1);
  transformed = pivot + (transformed - pivot) * pulse;
}
if (abs(rawAnim - 78.0) < 0.1) {
  float pitch = (0.34 + 0.07 * sin(g * 2.0)) * uWorkWeight + 0.035 * sin(g * 2.0) * uWalkWeight;
  float cp = cos(pitch), sp = sin(pitch);
  vec3 r = transformed - pivot;
  transformed.y = pivot.y + r.y * cp - r.z * sp;
  transformed.z = pivot.z + r.y * sp + r.z * cp;
}
if (abs(rawAnim - 88.0) < 0.1) {
  float yaw = 0.22 * sin(g + 0.8) * (0.25 + 0.75 * uWalkWeight) + 0.10 * sin(g * 2.0) * uWorkWeight;
  float cy = cos(yaw), sy = sin(yaw);
  vec3 r = transformed - pivot;
  transformed.x = pivot.x + r.x * cy - r.z * sy;
  transformed.z = pivot.z + r.x * sy + r.z * cy;
}
if (abs(rawAnim - 92.0) < 0.1) {
  float side = pivot.x >= 0.0 ? 1.0 : -1.0;
  float flap = side * (0.48 * sin(uTime * 8.0) * uWalkWeight + 0.08 * (1.0 - uWalkWeight));
  float cf = cos(flap), sf = sin(flap);
  vec3 r = transformed - pivot;
  transformed.x = pivot.x + r.x * cf - r.y * sf;
  transformed.y = pivot.y + r.x * sf + r.y * cf;
}`;
