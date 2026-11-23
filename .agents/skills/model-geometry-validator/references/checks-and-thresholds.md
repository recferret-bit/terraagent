# Checks, thresholds and algorithm notes

All lengths are metres. Source of truth: `DEFAULT_OPTIONS` in `frontend/render/kitbash/validate/types.ts`.

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

### Night lights (`checks/lights.ts`)

Not `DEFAULT_OPTIONS`. Overlap is `embed` depth, either way, on the pair `relate` already computed.

| Code | Rule |
| :--- | :--- |
| `LIGHT_UNMOUNTED` | error. Name matches `/light\|lamp\|beacon\|bulb/i`, zone is `energyCyan`, `warningAmber`, `dangerCrimson`, or `terraformEmerald`, and `role` is not `whip`. The part must overlap a structural neighbour by ≥ 1 cm (0.01 m). A structural neighbour's zone is outside that emissive set and its name does not match the same pattern. A ring or strip that cuts its frame by ≥ 1 cm passes. A gap, or a touch of only another emissive blob, fails. Zero lights is allowed. |
| `LIGHT_CORNER_STAMP` | error. Model id starts with `building.` and at least 4 parts are named exactly `plinth corner light`. Does not run on robots, fauna, or ships. Four differently named fixtures are allowed. |

## Algorithm

1. **Extract**: `KitbashBuilder.capture(() => entry.create())` returns the merged geometry plus per-part metadata. Parts are contiguous vertex ranges of the merged buffer, so positions are the final, scaled and snapped ones; `aPartAnim` supplies the final pivot.
2. **Relate every part pair** (`relate`): broad phase by boxes, then triangle-triangle intersection (Möller 1997). No crossing: nearest approach by vertex-to-triangle plus edge-to-edge distance. Coplanar overlap counts as z-fighting only when both faces point the same way (opposite facing is a flush contact).
3. **Support graph**: edges where distance ≤ `contactTol`; roots are the lowest parts (or the largest part when ungrounded). Cables (`TubeGeometry`) can be held but never hold. Loose clusters are reported greedily nearest-first, treating each reported cluster as attached, which yields the minimal set of missing links.
4. **Overlap**: ray-parity inside test on closed parts gives the fraction of one part inside another and the depth. A cable is sampled along its whole length. Samples more than 12 cm from either end that sit inside a closed solid are `CABLE_CLIPS`, including when that solid is the cable's own anchor. A short socket bite is allowed. A part named cable, guy, or rope that is a cylinder is `CABLE_BAR`. On a span of at least 0.8 m, the hang perpendicular to the chord must be 2–16% of the span (`CABLE_TAUT` / `CABLE_DROOP`). A world-Y drop is not that hang when the span is steep. Bus cables are rigid arches and are not judged as hanging lines.
5. **Animation sweep**: each animated part is posed through the shader's motion (24 spin angles for `animType 1`, 4 bob offsets for `2`, 4 recoil offsets for `3`, 16 gait cycle steps for `4` BipedLeg / `5` BipedArm / `6` SpiderLeg / `8` BipedBody / `9` SpiderBody / `18..39` compound mounted channels, 16 roll angles for `7` WheelSpin, or `vertebratePartPoses` closed-form quadruped 2-link IK / avian wing fold / sleep & graze across mammals & birds) and related to every other part within reach (`sameVertebrateRig`, `coupledVertebrate`). Sub-parts sharing the same `animType`/`vertRig` and 3D `pivot` (`sameRig`, or sharing `BipedBody 8` / `SpiderBody 9`) move as a single coupled assembly; parts sharing a shader clock (`1`, `4..6, 8, 9, 18..39`, `7`, or `2`/`3` with equal `pivot.x`) are compared at matching time steps. Two recoil (`3`) parts are one rig only when their `pivot.x` is equal (their phase is `sin(t + pivot.x * 2.3)`), exactly like bob (`2`); otherwise their pair is swept like any two moving parts.

### Organic & Vertebrate Checks

- **Organic profile (`ORGANIC_*`):** `ORGANIC_TISSUE` (`aOrganic` in `1..7`), `ORGANIC_METAL`, `ORGANIC_ROUGHNESS`, `ORGANIC_FLEX`, `ORGANIC_TOO_DARK`, `ORGANIC_UNIFORM`.
- **Vertebrate anti-slop stage (`checks/vertebrateAnatomy.ts`, `VERTEBRATE_*`):** requires `>= 22` sculpted sub-parts & `>= 3` tissues (`VERTEBRATE_DETAIL_RICHNESS`), valid `vertRig`/`vertConfig` on every part (`VERTEBRATE_RIG_PARITY`), multi-segment limb articulation, `>= 6 mm` ball-in-socket elbow/stifle overlap & zero mechanical joint balls (`VERTEBRATE_LIMB_ANATOMY`), separated inner/outer wings + `>= 4` fanned tail rectrices (`VERTEBRATE_WING_ARTICULATION`), `>= 1 cm` axial / `>= 4 mm` 3D solid avian foot/toe anchoring into leg/foot tips (`VERTEBRATE_FOOT_ANCHOR`), grounded mammal sleep torso settle (`-1.5..4.8 cm`) + sagittal folded limbs without lateral breakout, ground dip or upward joint spikes (`VERTEBRATE_SLEEP_POSTURE`), eyes `<= 25%` cranium width (`VERTEBRATE_EYE_PROPORTION`), and max non-emissive RGB `<= 218` (`VERTEBRATE_BLOOM_SAFE`).

6. **Night lights** (`checks/lights.ts`): see the table above. `LIGHT_UNMOUNTED` uses `embed` depth ≥ 0.01 m against a non-emissive, non-light-named neighbour. `LIGHT_CORNER_STAMP` counts parts named exactly `plinth corner light` on `building.*` ids only.
7. **Appearance** (`appearance.ts`): each part gets area, planar faces (normals binned to 0.01, so rotated panels work), a thin-plate flag (two opposite faces ≥ 75 % of its area), the CIE L*a*b* of its zone colour and a role from its name (`power`, `locomotion`, `sensor`, `manipulator`, `platform`). Role rules, group colour distance (area-weighted mean Lab per role, plus the worst touching pair across two roles, each also with the biome dust blended in via `shadedLab`: `mix = (1 - smoothstep(0, weatheringHeight, y)) * weatheringIntensity` toward the dust colour, then the top-down gradient 0.78..1.08), inset contrast, name/zone fit and palette balance follow. A face's features are the smaller touching parts whose centre lies on its outward side; a face is skipped when a closed neighbour covers it, when it faces down, or when the part is emissive or glass. Curved parts (cylinders, spheres, lathes) use half their surface as the face.

## Calibration notes

- Thresholds were calibrated so the old Builder T1 (one dark slab for cells, tyres/chassis/claws all `frameGunmetal`) failed `ROLE_DETAIL`, `FLAT_SURFACE` and `GROUP_SAME_COLOR`, and the redesigned one passes. Across the catalog they flag 20 of 29 models, mostly `FLAT_SURFACE` (27) and `ROLE_DETAIL` (12): treat those as a work list, not as noise.

- A joint sunk into a hull is normal: only **mutual** penetration is reported.
- Rounded boxes make `rbox(…, 2)` cost 300 triangles at any size; thin parts use `rbox(…, 1)` (about 100).
- `--pairs` prints every touching/crossing pair with `embed` fractions and depth for choosing thresholds from data.
