# Checks, thresholds and algorithm notes

All lengths are metres. Source of truth: `DEFAULT_OPTIONS` in `frontend/shared/engine/kitbash/validate/types.ts`.

| Option | Default | Used by |
| :--- | :--- | :--- |
| `contactTol` | 0.004 | Two surfaces closer than this are touching (the support graph) |
| `nearMiss` | 0.06 | Gap up to this is a `HAIRLINE_GAP`; beyond it is `FLOATING_PART` |
| `groundTol` | 0.02 | Parts reaching down to this height are the ground roots of the support graph |
| `clearance` | 0.01 | Minimum distance an animated part keeps from non-mount parts over its whole motion |
| `grazeDist` | 0.003 | Near-parallel crossing faces closer than this shimmer (`NEAR_COPLANAR`) |
| `buriedFrac` | 0.92 | Fraction of a part inside another for `BURIED_PART` |
| `cutFrac` / `cutDepth` | 0.15 / 0.04 | Both parts this far inside each other, at least this deep: `CUTS_THROUGH` |
| `foundationDepth` | 0.105 | Allowed sink below y = 0 for foundations |
| `triBudget` / `minParts` | 3500 / 7 | Pillar 1 limits |

### Appearance options

| Option | Default | Used by |
| :--- | :--- | :--- |
| `appearance` | true | Run the colour / material / surface-detail checks (`--geometry-only` turns it off) |
| `flatFace` | 0.045 | Face area (fraction of the model's longest side squared; Builder T1 ≈ 2.1 m², so ≈ 0.10 m²) above which a face needs ≥ 1 mounted feature; 2 / 3 / 4 at 2.5x / 5x / 10x that area (`FLAT_SURFACE`) |
| `insetMin` / `insetContrast` | 0.014 / 12 | A thin plate whose face is at least `insetMin` (relative) must differ from its support by ΔE ≥ 12 (`LOW_CONTRAST_INSET`) |
| `groupShare` / `groupContrast` | 0.04 / 14 | Functional groups holding ≥ 4 % of the surface must differ by ΔE ≥ 14 and not share a dominant zone (`GROUP_SAME_COLOR`) |
| `minCells` / `cellMaxFace` | 6 / 0.028 | Solar panels: ≥ 6 cells, each face below `cellMaxFace` (relative), clustered within 3 cm of each other (`ROLE_DETAIL`) |
| `dominantZone` / `minMeanL` | 0.7 / 30 | One zone above 70 % of the surface, or mean L* below 30 (`PALETTE_FLAT`, `MODEL_TOO_DARK`) |

## Algorithm

1. **Extract**: `KitbashBuilder.capture(() => entry.create())` returns the merged geometry plus per-part metadata. Parts are contiguous vertex ranges of the merged buffer, so positions are the final, scaled and snapped ones; `aPartAnim` supplies the final pivot.
2. **Relate every part pair** (`relate`): broad phase by boxes, then triangle-triangle intersection (Möller 1997). No crossing: nearest approach by vertex-to-triangle plus edge-to-edge distance. Coplanar overlap counts as z-fighting only when both faces point the same way (opposite facing is a flush contact).
3. **Support graph**: edges where distance ≤ `contactTol`; roots are the lowest parts (or the largest part when ungrounded). Cables (`TubeGeometry`) can be held but never hold. Loose clusters are reported greedily nearest-first, treating each reported cluster as attached, which yields the minimal set of missing links.
4. **Overlap**: ray-parity inside test on closed parts gives the fraction of one part inside another and the depth; cables are sampled along their length (15 % to 85 %) for mid-span clipping.
5. **Animation sweep**: each animated part is posed through the shader's motion (24 spin angles, 4 bob offsets, 4 recoil offsets) and related to every other part within reach. A part may stay in contact with its **mount** (touching at rest) but not touch anything new. Spinners always move together; bobbers/recoilers with equal `pivot.x` move together, so only matching poses are compared.

6. **Appearance** (`appearance.ts`): each part gets area, planar faces (normals binned to 0.01, so rotated panels work), a thin-plate flag (two opposite faces ≥ 75 % of its area), the CIE L*a*b* of its zone colour and a role from its name (`power`, `locomotion`, `sensor`, `manipulator`, `platform`). Role rules, group colour distance (area-weighted mean Lab per role, plus the worst touching pair across two roles, each also with the biome dust blended in via `shadedLab`: `mix = (1 - smoothstep(0, weatheringHeight, y)) * weatheringIntensity` toward the dust colour, then the top-down gradient 0.78..1.08), inset contrast, name/zone fit and palette balance follow. A face's features are the smaller touching parts whose centre lies on its outward side; a face is skipped when a closed neighbour covers it, when it faces down, or when the part is emissive or glass. Curved parts (cylinders, spheres, lathes) use half their surface as the face.

## Calibration notes

- Thresholds were calibrated so the old Builder T1 (one dark slab for cells, tyres/chassis/claws all `frameGunmetal`) failed `ROLE_DETAIL`, `FLAT_SURFACE` and `GROUP_SAME_COLOR`, and the redesigned one passes. Across the catalog they flag 20 of 29 models, mostly `FLAT_SURFACE` (27) and `ROLE_DETAIL` (12): treat those as a work list, not as noise.

- A joint sunk into a hull is normal: only **mutual** penetration is reported.
- Rounded boxes make `rbox(…, 2)` cost 300 triangles at any size; thin parts use `rbox(…, 1)` (about 100).
- `--pairs` prints every touching/crossing pair with `embed` fractions and depth for choosing thresholds from data.
