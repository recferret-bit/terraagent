# Modular Hard-Surface Greeble Catalog

This catalog defines the standard parameterized sub-assemblies ("greebles") used by `procedural-kitbash-3d` to construct robots, colony buildings, energy stations, and rockets.

---

## 1. Structural & Foundation Primitives

| Greeble ID | Parameters | Geometry Recipe | Default Material Zone |
| :--- | :--- | :--- | :--- |
| `foundationPlinth` | `{ width, depth, height = 0.25, skirtDepth = 0.12 }` | Chamfered octagonal base (`CylinderGeometry(rTop, rBot, h, 8)` or `RoundedBoxGeometry`) with `minY = -skirtDepth` so buildings never float on uneven terrain. | `frameGunmetal` + `hullSecondary` hazard stripes |
| `chamferedHull` | `{ width, height, depth, radius = 0.08, segments = 3 }` | `RoundedBoxGeometry(width, height, depth, segments, radius)`. Primary armor block. | `hullPrimary` |
| `hexModule` | `{ radius, height, bevel = 0.05, hasCore = true }` | 6-sided extruded prism with top/bottom bevel + optional recessed glowing core band around the equator. | `hullPrimary` + `energyCyan` |
| `trussGirder` | `{ length, width = 0.2,CrossBraces = 4 }` | 4 corner `CylinderGeometry` rails joined by diagonal struts; ideal for rocket launch towers, cranes, and wind masts. | `frameGunmetal` |

---

## 2. Mechanical & Industrial Greebles

| Greeble ID | Parameters | Geometry Recipe | Default Material Zone |
| :--- | :--- | :--- | :--- |
| `coolingVentArray` | `{ width, height, slats = 5, tilt = 0.4 }` | Recessed `frameGunmetal` frame populated with angled `RoundedBoxGeometry` louver blades. | `frameGunmetal` |
| `hydraulicStrut` | `{ start: Vector3, end: Vector3, radius = 0.05 }` | Two coaxial cylinders oriented along `end - start`: thicker painted outer sleeve (`60%` length) + thinner chrome inner piston rod (`40%` length). | `hullSecondary` + `frameGunmetal` |
| `saggingCable` | `{ p1: Vector3, p2: Vector3, slack = 0.18, radius = 0.03 }` | `CatmullRomCurve3([p1, midPointDown, p2])` swept with `TubeGeometry(curve, 12, radius, 6)`. Breaks rigid box silhouettes immediately. | `frameGunmetal` |
| `pressureTankCluster` | `{ count = 3, radius = 0.22, height = 0.9 }` | Pill-shaped capsule tanks (`CapsuleGeometry`) bound together by two horizontal retaining bands and a manifold pipe. | `hullPrimary` + `hullSecondary` bands |

---

## 3. Energy, Propulsion & Telemetry Greebles

| Greeble ID | Parameters | Geometry Recipe | Default Material Zone |
| :--- | :--- | :--- | :--- |
| `solarWing` | `{ width, length, panelCols = 2, panelRows = 4, tiltRad }` | Thin `frameGunmetal` backing plate + slightly raised `solarCell` photovoltaic tiles separated by `0.02m` gaps. | `solarCell` + `frameGunmetal` |
| `turbineRotor` | `{ bladeCount = 3, bladeLength = 1.6, hubRadius = 0.2 }` | Aerodynamic tapered blades attached to a nose cone; tagged with `animType = 1` (continuous GPU vertex rotation). | `hullPrimary` + `hullSecondary` tips |
| `radarDish` | `{ radius = 0.45, depth = 0.15, tilt = 0.5 }` | Parabolic `LatheGeometry` reflector + central tripod feed horn with an HDR `energyCyan` tip beacon; tagged with `animType = 1`. | `hullPrimary` + `energyCyan` |
| `plasmaEmitter` | `{ length = 0.7, caliber = 0.08, glowColor = 'warningAmber' }` | Multi-stepped barrel shroud with magnetic containment rings and an HDR glowing muzzle/drill core. | `frameGunmetal` + `warningAmber` |
| `treadAssembly` | `{ length = 1.3, height = 0.36, width = 0.3 }` | Rounded track housing with 3 recessed bogie wheels; place in mirrored pairs (`x = ±offset`). | `frameGunmetal` |

---

## 4. How to Register a Custom Greeble Extension

Any agent can extend the catalog by registering a new generator in `src/visuals/kitbash/extensions/`:

```typescript
import { KitbashRegistry } from '../KitbashRegistry';
import * as THREE from 'three';

KitbashRegistry.registerGreeble('cryoCondenserCoil', (params: { radius: number; turns: number }, builder) => {
  const points: THREE.Vector3[] = [];
  const steps = params.turns * 16;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const angle = t * Math.PI * 2 * params.turns;
    points.push(new THREE.Vector3(Math.cos(angle) * params.radius, t * 1.2, Math.sin(angle) * params.radius));
  }
  const curve = new THREE.CatmullRomCurve3(points);
  const coilGeo = new THREE.TubeGeometry(curve, steps, 0.04, 8, false);
  builder.addPart(coilGeo, 'energyCyan', { emissiveIntensity: 3.5 });
});
```
