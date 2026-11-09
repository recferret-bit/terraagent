/** Biological fields share anatomical UVs across pigmentation, roughness and micro-normal response. */
export const ORGANIC_DECL = /* glsl */ `
varying float vOrganic;
varying vec2 vAnatomy;
float organicField(vec2 uv, float tissue, float footprint) {
  vec2 p = uv * vec2(6.2831853, 28.0);
  float grain = sin(p.x * 11.0 + sin(p.y * 1.71)) * sin(p.y * 2.47 + sin(p.x * 7.0));
  float growth = sin(uv.y * 88.0 + sin(uv.x * 12.566) * 1.7);
  float veins = pow(max(0.0, 1.0 - abs(sin(p.x * 3.0 + sin(p.y * 0.39) * 2.0))), 7.0);
  float fineFade = 1.0 - smoothstep(0.35, 1.4, footprint);
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
if (vOrganic > 0.5) {
  float field = organicField(vAnatomy, vOrganic, organicFootprint);
  diffuseColor.rgb *= 1.0 + field * 0.16;
  if (vOrganic > 2.5 && vOrganic < 3.5) {
    float thickness = sin(vAnatomy.y * 3.14159);
    diffuseColor.rgb *= mix(vec3(1.14, 1.06, 0.76), vec3(0.67, 0.88, 0.62), thickness * 0.45);
  }
}`;
export const ORGANIC_ROUGHNESS = /* glsl */ `
if (vOrganic > 0.5) {
  roughnessFactor = clamp(roughnessFactor + organicField(vAnatomy, vOrganic, organicFootprint) * 0.07, 0.16, 0.98);
  if (vOrganic > 2.5 && vOrganic < 3.5) roughnessFactor = 0.26 + organicField(vAnatomy, vOrganic, organicFootprint) * 0.06;
}`;
export const ORGANIC_NORMAL = /* glsl */ `
float organicHeight = 0.0;
if (vOrganic > 0.5 && vOrganic < 4.5) organicHeight = organicField(vAnatomy, vOrganic, organicFootprint) * 0.00045;
// Evaluate derivatives outside tissue-dependent control flow, including at silhouette/profile edges.
vec3 organicDx = dFdx(-vViewPosition), organicDy = dFdy(-vViewPosition);
vec2 organicDh = vec2(dFdx(organicHeight), dFdy(organicHeight));
if (vOrganic > 0.5 && vOrganic < 4.5) {
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
}`;
