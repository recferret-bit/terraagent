/**
 * Foam GLSL (fragment): a shore band from the distance-to-dry-ground field (or a depth fallback), with wave-front
 * lines running toward the shore, broken up by noise and stronger on shores the wind blows onto; plus whitecaps where
 * the Gerstner Jacobian says a crest is about to fold. ALU only (the field is already sampled by the caller).
 */
export const WATER_FOAM_GLSL = /* glsl */ `
/**
 * How much the wind blows onto this shore, scaled by its strength (0 = along / no gradient, < 0 = offshore).
 * The shore-distance gradient comes from screen-space derivatives solved back to world xz: no extra fetch.
 */
float waterOnshore(float shore, vec2 p, float ws) {
#ifdef WATER_ONSHORE
  vec2 dpx = dFdx(p), dpy = dFdy(p);
  float dsx = dFdx(shore), dsy = dFdy(shore);
  float det = dpx.x * dpy.y - dpx.y * dpy.x;
  vec2 g = abs(det) > 1e-8 ? vec2(dsx * dpy.y - dsy * dpx.y, dpx.x * dsy - dpy.x * dsx) / det : vec2(0.0);
  float gl = length(g);
  return gl > 1e-4 ? -dot(g / gl, uWindDir) * min(ws, 1.5) : 0.0;
#else
  return 0.0;
#endif
}

/** \`anim\` (the view-focus weight) fades the moving parts (drift, wave-front lines, breakup) to a still band. */
float waterShoreFoam(vec2 p, float shore, float onshore, float anim) {
  float w = max(uFoamWidth, 0.05);
  vec2 np = p * 1.3;
  float n = anim >= 1.0 ? vnoise(np + uWindDrift * 0.08) // drifting with the wind; still off the focus
    : anim > 0.0 ? mix(vnoise(np), vnoise(np + uWindDrift * 0.08), anim) : vnoise(np);
  float edge = 1.0 - smoothstep(0.0, 0.35 * w, shore + (n - 0.5) * 0.35 * w);
  float expo = clamp(0.6 + 0.6 * onshore, 0.25, 1.4);
  float still = edge * 0.775; // the breakup at its mean (0.5)
  if (anim <= 0.0) return clamp(still * expo, 0.0, 1.0);
  float t = uWaterTime;
  // Lines of constant shore distance; the phase grows with time, so each line walks toward the shore.
  float front = 0.5 + 0.5 * sin(shore * (6.2831853 / (0.35 * w + 0.35)) + t * 2.4 + n * 3.0);
  float lines = smoothstep(0.72, 0.95, front) * (1.0 - smoothstep(0.25 * w, w, shore));
  float breakup = smoothstep(0.3, 0.7, vnoise(p * 2.7 - uWindDir * (t * 0.5) + 3.1));
  float moving = edge * (0.55 + 0.45 * breakup) + lines * breakup * 0.8;
  return clamp(mix(still, moving, anim) * expo, 0.0, 1.0);
}

float waterCrestFoam(vec2 p, WaterWave w, float ws) {
  float crest = smoothstep(0.45, 0.1, w.jac) * smoothstep(0.0, 0.05, w.h);
  float gust = 0.55 + 0.45 * clamp(windGustAt(p), 0.0, 1.0);
  // streaks: noise stretched along the wind, drifting with it, so caps read as torn lines rather than blobs
  vec2 q = vec2(dot(p, uWindDir) * 1.4, dot(p, vec2(-uWindDir.y, uWindDir.x)) * 4.2) - vec2(uWaterTime * 0.8, 0.0);
  float br = smoothstep(0.5, 0.85, vnoise(q));
  return crest * gust * br * min(ws, 1.5) * 0.7;
}
`;
