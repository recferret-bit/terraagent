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
  if (shore > 1.65 * w + 0.25) return 0.0;
  vec2 np = p * 1.3;
  float n = anim >= 1.0 ? vnoise(np + uWindDrift * 0.08) // drifting with the wind; still off the focus
    : anim > 0.0 ? mix(vnoise(np), vnoise(np + uWindDrift * 0.08), anim) : vnoise(np);
  float edge = 1.0 - smoothstep(0.0, 0.55 * w, shore + (n - 0.5) * 0.35 * w);
  float expo = clamp(0.6 + 0.6 * onshore, 0.25, 1.4);
  float still = edge * 0.82;
  if (anim <= 0.0) return clamp(still * expo, 0.0, 1.0);
  float t = uWaterTime;
  float ws = uWindStrength;
  float warp = (vnoise(vWaterWorldPos.xz * 1.4 + vec2(t * 0.2, -t * 0.15)) - 0.5) * 0.28
    + (vnoise(vWaterWorldPos.xz * 3.8 - vec2(t * 0.35)) - 0.5) * 0.14;
  float lace = smoothstep(
    0.32,
    0.72,
    vnoise(vWaterWorldPos.xz * 6.5 + vec2(t * 0.3, -t * 0.25)) * 0.65
      + vnoise(vWaterWorldPos.xz * 13.5 - vec2(t * 0.4)) * 0.35
  );
  float shoreLip = (1.0 - smoothstep(0.0, 0.22 * w, shore + warp * 0.18)) * 0.92;
  float swash = (1.0 - smoothstep(0.0, 0.55 * w, shore + warp * 0.42)) * (0.75 + 0.25 * lace);
  float wavePhase = shore * (9.5 / w) + t * (1.8 + 0.6 * min(ws, 2.0)) + warp * 5.0;
  float breakers = pow(max(0.0, sin(wavePhase)), 5.0)
    * (1.0 - smoothstep(0.08 * w, 1.45 * w, shore))
    * (0.55 + 0.45 * lace);
  float froth = smoothstep(0.48, 0.78, lace)
    * (1.0 - smoothstep(0.0, 1.15 * w, shore + warp * 0.45))
    * 0.52;
  float moving = clamp((max(shoreLip, swash * 1.12) + breakers * 0.95 + froth) * expo, 0.0, 1.0);
  return clamp(mix(still * expo, moving, anim), 0.0, 1.0);
}

float waterCrestFoam(vec2 p, WaterWave w, float ws) {
  float crest = smoothstep(0.45, 0.1, w.jac) * smoothstep(0.0, 0.05, w.h);
  float gust = 0.55 + 0.45 * clamp(windGustAt(p), 0.0, 1.0);
  // streaks: noise stretched along the wind, drifting with it, so caps read as torn lines rather than blobs
  vec2 q = vec2(dot(p, uWindDir) * 1.4, dot(p, vec2(-uWindDir.y, uWindDir.x)) * 4.2) - vec2(uWaterTime * 0.8, 0.0);
  float br = smoothstep(0.5, 0.85, vnoise(q));
  return crest * gust * br * min(ws, 1.5) * 0.7;
}

/**
 * Procedural raindrop splash crowns & floating micro-bubble rings across 3 staggered grid layers.
 */
float waterRainBubbles(vec2 p, float time, float rain) {
  if (rain <= 0.01) return 0.0;
  float bubbles = 0.0;
  for (int layer = 0; layer < 2; layer++) {
    float fl = float(layer);
    vec2 uv = p * (2.2 + fl * 1.35) + vec2(fl * 17.3, fl * 31.1);
    vec2 cell = floor(uv);
    vec2 local = fract(uv) - 0.5;
    float rnd = tHash(cell + fl * 13.7);
    float rnd2 = tHash(cell + vec2(5.1, 9.7) + fl * 29.3);
    float life = fract(time * (1.65 + 0.35 * rnd) + rnd);
    vec2 center = (vec2(rnd, rnd2) - 0.5) * 0.44;
    float dist = length(local - center);
    float splashCore = (1.0 - smoothstep(0.0, 0.055, dist)) * (1.0 - smoothstep(0.0, 0.28, life));
    float ringRadius = life * 0.38;
    float cluster = smoothstep(0.22, 0.82, tHash(floor(uv * 8.0)));
    float bubbleRing = (1.0 - smoothstep(0.0, 0.03, abs(dist - ringRadius))) * (1.0 - life) * cluster;
    float isSplash = step(rnd2, 0.32 + rain * 0.68);
    bubbles += (splashCore * 0.95 + bubbleRing * 0.78) * isSplash;
  }
  return clamp(bubbles * (0.62 + 0.58 * rain), 0.0, 1.0);
}
`;
