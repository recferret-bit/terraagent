# TSL (Three.js Shading Language) & GLSL Shader Recipes

This reference provides modular shader building blocks for `shader-texture-tuning`. All snippets are designed to work either as `Three.js Shading Language (TSL)` nodes (`three/tsl`) for `WebGPURenderer` or as `onBeforeCompile` GLSL chunks for `WebGLRenderer`.

---

## 1. Triplanar Procedural Grain (No UV Coordinates Required)

Fixes distorted/missing UVs on AI-generated `.glb` models and procedural extrusions:

```glsl
// GLSL Function: Triplanar 3D hash/noise grain
float hash31(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float triplanarGrain(vec3 objPos, vec3 objNormal, float scale) {
  vec3 blend = pow(abs(normalize(objNormal)), vec3(4.0));
  blend /= max(dot(blend, vec3(1.0)), 0.0001);

  float gx = hash31(floor(objPos.yzx * scale * 24.0));
  float gy = hash31(floor(objPos.xzy * scale * 24.0));
  float gz = hash31(floor(objPos.xyz * scale * 24.0));
  return gx * blend.x + gy * blend.y + gz * blend.z;
}
```

---

## 2. Vertical Ground-Up Biome Weathering (Dust / Frost / Moss)

Anchors every building and unit into the planet terrain by tinting its lower hull and increasing roughness near `Y = 0`:

```glsl
// Fragment Shader Chunk
float heightMask = 1.0 - smoothstep(0.0, uWeatheringHeight, max(vLocalPos.y, 0.0));
// Break up the straight horizontal line with procedural noise
float weatheringFactor = clamp(heightMask * uWeatheringIntensity * (0.75 + 0.5 * grain), 0.0, 1.0);

diffuseColor.rgb = mix(diffuseColor.rgb, uBiomeDustColor, weatheringFactor);
roughnessFactor = mix(roughnessFactor, 0.92, weatheringFactor);
```

---

## 3. GPU Vertex-Driven Part Animation (`aPartAnim`)

Animates rotating wind turbines/radar dishes (`animType = 1`), hover-bobbing drones (`animType = 2`), and recoiling turrets (`animType = 3`) inside the vertex shader:

```glsl
// Vertex Shader Chunk (attribute vec4 aPartAnim: [animType, pivotX, pivotY, pivotZ])
float animType = aPartAnim.x;
vec3 pivot = aPartAnim.yzw;

if (animType > 0.5 && animType < 1.5) {
  // Type 1: Continuous Y-axis rotation around part pivot
  float angle = uTime * 2.5;
  float s = sin(angle);
  float c = cos(angle);
  vec3 rel = transformed - pivot;
  transformed.x = pivot.x + rel.x * c - rel.z * s;
  transformed.z = pivot.z + rel.x * s + rel.z * c;
} else if (animType >= 1.5 && animType < 2.5) {
  // Type 2: Hover / hydraulic vertical oscillation
  transformed.y += sin(uTime * 4.0 + pivot.x * 3.1) * 0.06;
} else if (animType >= 2.5) {
  // Type 3: Recoil / mining drill pulse along Z
  transformed.z -= abs(sin(uTime * 10.0)) * 0.08;
}
```

---

## 4. Holographic Task-Queue / Placement Ghost Shader

Used when the player or AI Orchestrator queues a new building on the hex grid before a builder robot constructs it:

```glsl
// Hologram Fragment Recipe
float scanline = sin(vWorldPos.y * 28.0 - uTime * 6.0) * 0.5 + 0.5;
float fresnel = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 2.2);
vec3 holoColor = mix(vec3(0.0, 0.94, 1.0), vec3(0.06, 0.72, 0.50), fresnel);
float alpha = clamp(0.22 + fresnel * 0.65 + scanline * 0.15, 0.15, 0.9);
gl_FragColor = vec4(holoColor * 2.4, alpha); // >1.0 luminance triggers subtle bloom
```

---

## 5. Terraforming Frontier Ring & Terrain Splatmap Blend

Blends barren planet rock/sand/ice into lush terraformed terrain using a single dynamic `DataTexture` (`uTerraformMap`):

```glsl
vec4 tfSample = texture2D(uTerraformMap, vMapUv);
float tfProgress = tfSample.r; // 0.0 = Barren, 1.0 = Terraformed

// Glowing emerald frontier wave at the edge of terraformed territory
float frontierRing = smoothstep(0.42, 0.50, tfProgress) * (1.0 - smoothstep(0.50, 0.58, tfProgress));

vec3 terrainAlbedo = mix(barrenBiomeColor, lushTerraformedColor, smoothstep(0.45, 0.55, tfProgress));
terrainAlbedo += vec3(0.06, 0.95, 0.55) * frontierRing * 3.5; // HDR Emerald glow on frontier
```
