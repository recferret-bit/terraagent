# Biome Lighting & Post-Processing Presets

This reference defines the calibrated lighting, fog, shadow, and post-processing parameters for each planet type in **TerraAgent**.

---

## 1. Planet Biome Lighting Table

| Parameter | Temperate (Baseline) | Arid / Desert | Ice / Cold | Volcanic / Anomaly (Extension) |
| :--- | :--- | :--- | :--- | :--- |
| **`sunLight.color`** | `0xfff5e4` (Warm Daylight) | `0xfffae0` (Blazing Amber-White) | `0xe8f4ff` (Crisp Polar Sun) | `0xffb788` (Ash-Filtered Sun) |
| **`sunLight.intensity`** | `3.0` | `3.6` | `2.8` | `2.4` |
| **`hemiLight.skyColor`** | `0x8ecae6` | `0xf4a261` | `0xa2d2ff` | `0x7f5539` |
| **`hemiLight.groundColor`** | `0x3b4d3b` | `0xb5654d` | `0x779be7` | `0x2b1d1d` |
| **`hemiLight.intensity`** | `0.85` | `0.90` | `1.00` | `0.70` |
| **`scene.background` / `fog`** | `0x9bbec7` | `0xe09f7d` | `0xbad7f2` | `0x2a1f2d` |
| **`FogExp2.density`** | `0.0065` | `0.0085` (Sand Haze) | `0.0090` (Ice Mist) | `0.0110` (Smog) |
| **`environmentIntensity`** | `0.75` | `0.85` | `0.90` | `0.65` |

---

## 2. Dynamic Hazard & Weather Lighting Modifiers

When planetary events occur (Section 6 of `docs/game/autonomous-colony-spec.md`), interpolate the viewport uniforms smoothly over `3.0` seconds:

- **Sandstorm (Arid Planet):**
  - Multiply `FogExp2.density` by `2.4x` (`0.020`), reduce `sunLight.intensity` to `1.4`, and increase `uWeatheringIntensity` on all `UnifiedColonyMaterial` instances to `0.85`.
- **Blizzard (Ice Planet):**
  - Shift `sunLight.color` toward `0xcce3ff`, reduce `sunLight.intensity` to `1.5`, and increase `uRimStrength` to `0.45` (icy frost rim).
- **Lightning Storm:**
  - Trigger a `120ms` exponential decay flash on `sunLight.intensity` (`+5.0` spike) synchronized with a localized plasma strike particle bolt.

---

## 3. Selective HDR Bloom & Tone Mapping Calibration

```typescript
// Standard Calibration Rules:
// 1. Albedo colors must NEVER exceed 0.90 in any RGB channel.
// 2. Emissive accents multiply RGB by 3.2 - 4.2.
// 3. UnrealBloomPass threshold sits at 1.1 so ONLY emissives bloom.

export const POST_PROCESSING_CONFIG = {
  toneMappingExposure: 1.1,
  bloom: {
    strength: 0.45,
    radius: 0.35,
    threshold: 1.1,
  },
};
```
