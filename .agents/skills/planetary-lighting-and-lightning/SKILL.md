---
name: planetary-lighting-and-lightning
description: >-
  Implement, tune, and extend the Dynamic Planetary Lighting System (orbital
  day/night solar cycle, quantized shadow-frustum tracking, zero-stutter pooled
  PointLights, biome weather transitions) and the Procedural 3D Lightning Strike
  & Power-Grid Overload VFX System. Use this skill whenever working on scene
  lighting, solar cycles, weather hazards, or lightning effects.
---

# Planetary Lighting & Procedural Lightning VFX Skill (`planetary-lighting-and-lightning`)

This skill governs both **Dynamic Planetary Lighting** (linking Solar Energy efficiency and time-of-day to Three.js lights and shadows) and **Procedural 3D Lightning Strikes & Electrical Grid Hazards** (Section 6 of `docs/game/autonomous-colony-spec.md`).

---

## Part 1: Dynamic Planetary Lighting Rules

1. **Zero Runtime Light Allocations (`LightPool` Mandatory):**
   - Adding or removing `THREE.PointLight` or `THREE.SpotLight` at runtime forces Three.js to recompile every PBR shader in the scene, causing a `100ms–400ms` frame freeze.
   - Always pre-allocate a fixed pool of `8` dynamic `THREE.PointLight` nodes at startup (`intensity = 0`) using `PlanetaryLightingSystem` in [PlanetaryLightingSystem.ts](./examples/PlanetaryLightingSystem.ts). Lease lights from the pool for laser bursts, explosions, rocket launches, and lightning impacts.
2. **Texel-Quantized Shadow Frustum Tracking:**
   - As the player pans the RTS camera across the planet, move `sunLight.target.position` and `sunLight.position` with the camera ground target, **snapped to `1.0m` world grid steps** (`Math.round(x)`). Quantizing prevents shadow map shimmering ("shadow swimming") on static buildings.
3. **Orbital Solar Cycle Coupled to Gameplay Telemetry:**
   - Drive `sunLight` elevation, color temperature (`0xff7b47` dawn/dusk $\rightarrow$ `0xfff5e4` noon $\rightarrow$ `0x4cc9f0` orbital night), and `solarEfficiencyMultiplier` (`0.0 – 1.0`) from a single `updateSolarCycle(timeOfDay)` method.
4. **Weather Hazard State Interpolation:**
   - Smoothly interpolate fog density, directional sun attenuation, and hemisphere tint over `2.5s` when transitioning between `'clear'`, `'sandstorm'`, `'blizzard'`, `'lightningStorm'`, and `'radiationAnomaly'`.

---

## Part 2: Procedural 3D Lightning & Grid Overload Rules

1. **3D Recursive Midpoint-Displacement Bolts (Never Flat 2D Sprites):**
   - Use `LightningStrikeSystem` in [LightningStrikeSystem.ts](./examples/LightningStrikeSystem.ts) to generate jagged 3D main trunks + angled fork branches (`6` subdivision passes, displacement decaying by `0.5x` per level).
2. **HDR Plasma Core for Selective Bloom (`intensity >= 5.0`):**
   - Render lightning tubes with an unlit HDR color (`new THREE.Color(0.45, 0.88, 1.0).multiplyScalar(6.0)`) so `UnrealBloomPass` (`threshold: 1.1`) creates a natural electric corona around the bolt.
3. **Multi-Layer Strike Feedback:**
   - Every lightning strike must simultaneously trigger:
     1. The 3D jagged plasma bolt mesh (`180ms` lifetime with rapid jitter re-subdivision at `60ms`).
     2. A double-pulse sky flash on `PlanetaryLightingSystem.triggerSkyFlash()`.
     3. A leased `LightPool` point light at the impact point (`intensity: 18`, `distance: 28m`).
     4. An expanding ground plasma shockwave ring at `(hitX, hitY + 0.05, hitZ)`.
     5. Persistent **Power-Grid Overload Arcs** (`spawnOverloadArc()`) jumping across damaged energy stations until repaired by a robot.

---

## Extending Lighting & Hazard Presets

1. Add new planetary weather states or atmospheric anomalies to `WeatherPresetRegistry` in [PlanetaryLightingSystem.ts](./examples/PlanetaryLightingSystem.ts).
2. Add new electrical/plasma arc behaviors (e.g., Tesla defense towers, Ion orbital strikes, or Radiation anomaly ribbons) using the `buildJaggedBoltGeometry()` primitive in [LightningStrikeSystem.ts](./examples/LightningStrikeSystem.ts) and the parameters in [lighting-and-hazard-vfx.md](./references/lighting-and-hazard-vfx.md).
