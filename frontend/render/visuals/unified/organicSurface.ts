/** Biological fields share anatomical UVs across pigmentation, roughness and micro-normal response. */
export const ORGANIC_DECL = /* glsl */ `
uniform sampler2D uFurPelageMap;
uniform sampler2D uFurRoughnessMap;
uniform sampler2D uFeatherVaneMap;
uniform sampler2D uFeatherRoughnessMap;
varying float vOrganic;
varying vec2 vAnatomy;
float organicField(vec2 uv, float tissue, float footprint, float furLuma, float featherLuma) {
  vec2 p = uv * vec2(6.2831853, 28.0);
  float grain = sin(p.x * 11.0 + sin(p.y * 1.71)) * sin(p.y * 2.47 + sin(p.x * 7.0));
  float growth = sin(uv.y * 88.0 + sin(uv.x * 12.566) * 1.7);
  float veins = pow(max(0.0, 1.0 - abs(sin(p.x * 3.0 + sin(p.y * 0.39) * 2.0))), 7.0);
  float fineFade = 1.0 - smoothstep(0.35, 1.4, footprint);
  if (tissue > 5.5 && tissue < 6.5) {
    return ((furLuma - 0.75) * 0.75 + grain * 0.08) * fineFade;
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
vec2 taVertUv = vLocalPos.xz * 4.8 + vec2(vLocalPos.y * 3.2, vAnatomy.y * 2.2);
vec3 taFurTex = texture2D(uFurPelageMap, taVertUv).rgb;
vec3 taFeatherTex = texture2D(uFeatherVaneMap, vAnatomy * vec2(2.8, 3.8) + vLocalPos.xz * 2.6).rgb;
float taFurLuma = dot(taFurTex, vec3(0.3333));
float taFeatherLuma = dot(taFeatherTex, vec3(0.3333));
if (vOrganic > 0.5) {
  float field = organicField(vAnatomy, vOrganic, organicFootprint, taFurLuma, taFeatherLuma);
  diffuseColor.rgb *= 1.0 + field * 0.14;
  if (vOrganic > 2.5 && vOrganic < 3.5) {
    float thickness = sin(vAnatomy.y * 3.14159);
    diffuseColor.rgb *= mix(vec3(1.14, 1.06, 0.76), vec3(0.67, 0.88, 0.62), thickness * 0.45);
  } else if (vOrganic > 5.5 && vOrganic < 6.5) {
    float furDetail = 1.0 - smoothstep(0.45, 1.6, organicFootprint);
    diffuseColor.rgb *= mix(1.0, clamp(taFurLuma / 0.75, 0.80, 1.20), 0.30 * furDetail);
  } else if (vOrganic > 6.5) {
    float featherDetail = 1.0 - smoothstep(0.45, 1.6, organicFootprint);
    diffuseColor.rgb *= mix(1.0, clamp(taFeatherLuma / 0.77, 0.80, 1.18), 0.28 * featherDetail);
  }
}`;
export const ORGANIC_ROUGHNESS = /* glsl */ `
float taFurRough = texture2D(uFurRoughnessMap, taVertUv).r;
float taFeatherRough = texture2D(uFeatherRoughnessMap, vAnatomy * vec2(2.8, 3.8) + vLocalPos.xz * 2.6).r;
if (vOrganic > 0.5) {
  float roughField = organicField(vAnatomy, vOrganic, organicFootprint, taFurLuma, taFeatherLuma);
  roughnessFactor = clamp(roughnessFactor + roughField * 0.06, 0.16, 0.98);
  if (vOrganic > 2.5 && vOrganic < 3.5) roughnessFactor = 0.26 + roughField * 0.06;
  else if (vOrganic > 5.5 && vOrganic < 6.5) {
    roughnessFactor = clamp(mix(roughnessFactor, taFurRough, 0.34), 0.40, 0.92);
  } else if (vOrganic > 6.5) {
    roughnessFactor = clamp(mix(roughnessFactor, taFeatherRough, 0.32), 0.32, 0.86);
  }
}`;
export const ORGANIC_NORMAL = /* glsl */ `
float organicHeight = 0.0;
bool hasOrganicMicroNormal = (vOrganic > 0.5 && vOrganic < 3.5) || vOrganic > 5.5;
if (hasOrganicMicroNormal) organicHeight = organicField(vAnatomy, vOrganic, organicFootprint, taFurLuma, taFeatherLuma) * (vOrganic > 5.5 ? 0.00072 : 0.00045);
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
