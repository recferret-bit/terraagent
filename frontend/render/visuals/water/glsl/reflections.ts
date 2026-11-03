/**
 * Reflection GLSL (fragment). The sun specular, IBL and shadows stay MeshStandardMaterial's own (the wave normal is
 * fed into `normal`); these helpers add what PBR cannot: wind-driven roughness with specular anti-aliasing, a sun
 * glitter path, and the Blinn-Phong reflection of colony projectors (bots' lights at night).
 */
export const WATER_REFLECT_GLSL = /* glsl */ `
/** Calm -> mirror, windy -> broad sheen, foam -> matte; widened where the normal varies within a pixel. */
float waterRoughness(float ws, float foam, vec3 Nw) {
  float r = uWaterRoughness + 0.07 * min(ws, 2.5) + foam * 0.55;
  vec3 dn = fwidth(Nw);
  return clamp(sqrt(r * r + min(2.0 * dot(dn, dn), 0.05)), 0.02, 1.0);
}

/** Blinn-Phong exponent matching a GGX roughness (alpha = r^2), bounded for the projector loop. */
float waterSpecShininess(float r) {
  float a = r * r;
  return clamp(2.0 / max(a * a, 1e-4) - 2.0, 16.0, 768.0);
}

/**
 * Lamps sit ~1.5 m up on bots standing on the shore, so a mirror-tight lobe reflects them onto dry land only. Rippled
 * water at night stretches a light into a long glitter column toward the viewer: widen the projector lobe.
 */
float waterProjectorRoughness(float r) { return clamp(r * 2.2 + 0.22, 0.25, 0.65); }

/** Schlick Fresnel for water (F0 = 0.02), floored so reflections still read from the diorama camera. */
float waterFresnel(float ndv) {
  return max(0.02 + 0.98 * pow(1.0 - clamp(ndv, 0.0, 1.0), 5.0), 0.06);
}

/**
 * Extra sun glint (view space): a tight core plus a sparkling sun path from high-frequency noise, x uSunGlint;
 * \`anim\` scales the sparkle (the view-focus weight).
 * Not shadowed (it is emissive): keep the default modest.
 */
vec3 waterSunGlint(vec3 N, vec3 V, vec3 L, vec3 lightCol, vec2 p, float rough, float anim) {
  vec3 H = normalize(L + V);
  float ndh = max(dot(N, H), 0.0);
  float ndl = max(dot(N, L), 0.0);
  float shin = mix(900.0, 90.0, clamp(rough * 2.0, 0.0, 1.0));
  // the twinkling path fades out off the view focus (\`anim\` = its weight), leaving the steady core
  float sparkle = anim > 0.0 ? smoothstep(0.82, 0.97, vnoise(p * 7.0 + uWindDrift * 0.6 + uWaterTime * vec2(0.9, -0.7))) * anim : 0.0;
  float g = pow(ndh, shin) * 2.0 + pow(ndh, shin * 0.15) * sparkle * 0.6;
  return lightCol * (min(g, 6.0) * ndl * uSunGlint * 0.25 * (1.0 - 0.8 * clamp(uNightFactor, 0.0, 1.0)));
}
`;
