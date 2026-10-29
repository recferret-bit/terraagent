# Planetary Lighting & Lightning Hazard VFX Reference

---

## 1. Orbital Solar Cycle Curve (Gameplay + Visual Synchronization)

Let `phase` $\in [0, 1)$ represent the planetary rotation cycle (`0.0 = Dawn`, `0.25 = Solar Noon`, `0.50 = Dusk`, `0.75 = Midnight`):

$$\text{elevation} = \sin(\text{phase} \cdot 2\pi)$$

| Orbital Phase | `elevation` | Sun Color | Sun Intensity | Sky Hemi Intensity | Solar Station Output |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Noon (`0.15 – 0.35`)** | `+0.80` to `+1.0` | `0xfff5e4` | `3.2` | `0.85` | `100%` (`1.3x` on Desert) |
| **Golden Hour (`0.0 – 0.15`, `0.35 – 0.50`)** | `0.0` to `+0.80` | `0xff7b47` | `1.8` | `0.60` | `35% – 80%` |
| **Orbital Night (`0.50 – 1.00`)** | `< 0.0` | `0x4cc9f0` (Moon/Ring) | `0.65` | `0.35` | `0%` (Batteries / Wind / Nuclear active) |

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
