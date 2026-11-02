# Planetary Lighting & Lightning Hazard VFX Reference

---

## 1. Orbital Solar Cycle Curve (Gameplay + Visual Synchronization)

Let `phase` $\in [0, 1)$ represent the planetary rotation cycle (`0.0 = Dawn (06:00)`, `0.25 = Solar Noon (12:00)`, `0.50 = Dusk (18:00)`, `0.75 = Midnight (00:00)`), related to 24-hour solar time `hour` $\in [0, 24)$ by $\text{phase} = ((\text{hour} - 6) / 24) \bmod 1$:

$$\text{elevation} = \sin(\text{phase} \cdot 2\pi)$$

| Orbital Phase | `elevation` | Sun Color (`computeSolarState`) | Sun Intensity Mult | Shadow Intensity / Softness Mult | Sky Hemi Intensity | Solar Station Output |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Noon (`10:00 – 14:00`)** | `+0.80` to `+1.0` | Kelvin (`noonTempK`, default `5800K` $\approx$ `0xfff5e4`) | `1.05×` | `1.0×` intensity, `0.95×` radius (crisp) | `0.85` | `100%` (`1.3x` on Desert) |
| **Golden Hour (`05:30 – 08:00`, `16:00 – 18:30`)** | `0.0` to `+0.55` | Dawn `0xff8a3d` / Dusk `0xff5e2b` (`sunWarmth`) | `0.65× – 0.90×` | `0.75×` intensity, `1.35×` radius (long soft penumbra) | `0.55 – 0.70` | `35% – 80%` |
| **Orbital Night (`19:00 – 05:00`)** | `< 0.0` | Cool orbital moonlight `0x6498e8` (`nightBrightness`) | `0.20× – 0.38×` | `0.22× – 0.38×` intensity, `1.75×` radius (diffused) | `0.25 – 0.42` | `0%` (Batteries / Wind / Nuclear active) |

Authoritative planetary time (`shared/sim/src/systems/time/index.ts`, `shared/sim/src/data/time.ts`) advances by:
$$\Delta\text{days} = \frac{\Delta\text{ticks} \cdot (\text{tickMs} / 3{,}600{,}000) \cdot \text{timeScale}}{\text{realHoursPerDay}}$$
with default `realHoursPerDay = 0.25` (15 real minutes per planetary day), `timeScale = 1.0`, and `initialTimeOfDay = 9.0` (09:00 morning sun).

---

## 2. Midpoint-Displacement 3D Lightning Algorithm

Given `start` (sky origin) and `end` (power station or ground target):
1. Initialize segment list `[(start, end)]` and initial perpendicular jitter amplitude `sway = distance(start, end) * 0.18`.
2. For each generation $g \in \{1 \dots 6\}$:
   - For each segment $(A, B)$:
     - Compute midpoint $M = \frac{A + B}{2} + \text{randomPerpendicularOffset}(\text{sway})$.
     - Replace $(A, B)$ with $(A, M)$ and $(M, B)$.
     - With probability `0.28` (when $g \le 3$), spawn a secondary fork branch $(M, F)$ angled `30°` outward with length $0.45 \cdot \|B - A\|$.
   - Decay `sway *= 0.52`.
3. Extrude the main trunk (`radius = 0.09m`) and forks (`radius = 0.035m`) or render as camera-facing ribbon quads with HDR cyan-white vertex colors (`RGB = [2.4, 5.2, 6.0]`).

---

## 3. Double-Pulse Sky Flash Envelope

Real lightning strikes exhibit a multi-stroke return flash rather than a single linear fade:

```typescript
// Normalized age t in [0, 1] over 240ms
export function evaluateLightningFlashEnvelope(t: number): number {
  if (t < 0 || t > 1) return 0;
  // Primary stroke at t=0.05, secondary restrike at t=0.38
  const stroke1 = Math.exp(-Math.pow((t - 0.05) / 0.08, 2));
  const stroke2 = 0.65 * Math.exp(-Math.pow((t - 0.38) / 0.12, 2));
  return Math.min(1.0, stroke1 + stroke2);
}
```
