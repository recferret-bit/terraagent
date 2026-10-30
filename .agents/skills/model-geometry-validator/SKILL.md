---
name: model-geometry-validator
description: >-
  Validate kitbashed 3D models. Geometry: parts floating off the body, hairline gaps, parts buried or cutting through each
  other, coplanar faces that z-fight, cables clipping through solids, animated parts (spin, bob, recoil) that sweep into
  something. Appearance: wrong or missing colours and materials (a solar panel that is a black slab, wheels, chassis and arm
  all one colour, a light that does not glow, a flat palette) and surfaces without enough detail (big blank faces, panels
  without a cell grid, bare wheels). Use this skill after creating or modifying ANY procedural archetype (robot, building,
  ship, prop, deposit) and before declaring it done; it is the automated half of the "no floating parts" and "readable
  detail" checks in the procedural-kitbash-3d visual verification step.
---

# Model Geometry Validator (`model-geometry-validator`)

The kitbash pipeline merges 20 to 120 sub-parts into **one** mesh, so nothing in the engine knows that a claw is meant to
hang from a joint or that a solar panel is meant to stand proud of its frame. A part that floats 1 cm off its support, an inset
that sits flush with its frame (z-fighting), or a radar dish that spins through a mast is invisible in code review and in a
single screenshot, but obvious to a player. This skill finds those defects **numerically**, then proves the fix **visually**.

The same pass also judges **appearance**. This pipeline has no image textures: what the player sees is each part's zone colour,
the zone's roughness/metalness, a faint ±4 % triplanar grain and the geometry itself. So "is the texture right?" becomes three
questions the validator can answer: does each part's colour fit what it is (a solar cell is not near-black gunmetal, a light glows),
do the functional groups of the machine read as different things (wheels vs platform vs manipulator), and does every big surface
carry enough geometry (cells, bus bars, ribs, hubs, vents, panel lines) to say what it is.

It reads the model the way the game builds it: `KitbashBuilder.capture()` returns the merged geometry **with the part list**
(name, zone, geometry kind, animation type and pivot), so every check works on real sub-parts at their final scale and
position. Animated parts are swept through the same motion the vertex shader applies (`UnifiedColonyMaterial.ts`).

---

## Where it sits in the modelling process

| Step | Skill | What happens |
| :--- | :--- | :--- |
| 1. Compose the blueprint | `procedural-kitbash-3d` | Four layers, ≥ 7 parts, a silhouette breaker, 60/30/10 zones, GPU animation tags |
| 2. **Validate geometry, colour and detail** | **`model-geometry-validator`** | **Run the CLI, fix every error and warning** |
| 3. Verify visually | `diorama-viewport-auditor` | iso / front / side / top in the playground, with the validation overlay on (`?validate=1`) |
| 4. Materials and shaders | `shader-texture-tuning` | Unifier shader, weathering, only after the shape is sound |

Do not tune materials or lighting on a model that fails this skill: you would be polishing a broken shape.

---

## Workflow (mandatory for every new or edited kitbash model)

### Step 1: Name the parts
Pass `name` in `PartOptions` (`b.addPart(geo, zone, { name: 'radar mast', ... })`, and through helpers such as `strut(b, a, c, r, zone, { name: 'jib' })`).
Reports use these names. Unnamed parts show as `Cylinder#31`, which is hard to map back to code.

### Step 2: Run the validator
```bash
npm run validate:models -- robot.builder            # one model
npm run validate:models -- --category robot         # a category: robot|building|ship|resource|fauna|prop
npm run validate:models -- --all --quiet            # the whole catalog, one line per model
npm run validate:models -- robot.builder --json     # machine-readable (for agents and CI)
npm run validate:models -- robot.builder --pairs    # every touching/crossing pair with its numbers (calibration)
npm run validate:models -- robot.builder --geometry-only   # skip the colour / material / detail checks
npm run test:models                                 # self-test of the validator itself (35 known-good/bad fixtures, geometry and appearance)
```
Exit code is `1` when any model has an **error** (`--strict` also fails on warnings).

### Step 3: Fix, using the check tables below
Every issue prints a `fix:` line. Fix the **cause in the model code**, not the threshold. The report also prints `colour by role`
(share, dominant zone and lightness L* of the locomotion / platform / manipulator / power / sensor groups): read it to decide
which group needs a different zone. Roles come from **part names** (`wheel`, `chassis`, `boom`, `solar`, `radar` ...), so name parts.
`--geometry-only` skips the appearance checks (for debugging a geometry problem on its own).

### Step 4: Look at it (visual self-correction loop)
Open `http://127.0.0.1:5173/playground.html?inspect=<id>&validate=1` (or press **V**). Offending parts are outlined
(red = error, amber = warning) and numbered; the numbers match the list in the info panel. Check all four views
(`iso`, `front`, `side`, `top`) and take screenshots, exactly as the `diorama-viewport-auditor` skill requires. A clean report
with a visibly wrong model means a check is missing: add a fixture and a check (see Extending).

### Step 5: Repeat until the model passes, then regress
`0 errors, 0 warnings` (informational `·` lines are fine). Then run `npm run validate:models -- --category <cat>` and
`npm run test:models` so a shared helper change did not break a sibling. State in your report what you ran and the final counts.

---

## What it checks

| Code | Severity | Meaning | Typical fix |
| :--- | :--- | :--- | :--- |
| `FLOATING_PART` | error | A part (or cluster) has no touching path to the body or ground, and nothing is within 6 cm | Mount it: strut, bracket, or move it onto its support |
| `HAIRLINE_GAP` | error | Stops < 6 cm short of its support: reads as attached, is not. Reported as a **minimal set of missing links**, so a dish on a mast on a cabin gives two short gaps | Overlap the neighbour by ≥ 1 cm; the overlap hides inside the hull |
| `COPLANAR_Z_FIGHT` | error | Same-facing faces of two parts share a plane: they flicker | Make an inset thicker/thinner than its frame so it stands ≥ 2 mm proud |
| `ANIM_COLLISION` | error | An animated part comes within 1 cm of (or cuts) a part it does not rest against, at some point of its motion | Shorten the part, move the pivot, or shift the neighbour ≥ 1 cm |
| `ANIM_DISTORTION` | error | An animated part stretches, resizes, shears, or bends (> 0.5 mm edge-length drift) during its motion | Use pure rigid-body 3D rotations and translations per part; never scale or blend per-vertex coordinates |
| `GROUND_CONTACT` | error/warn | Grounded model hovers (> 2 mm) or its foundation sinks > 10.5 cm | Snap minY to 0; plinth may go to -0.1 m |
| `NAN_VERTEX` | error | NaN/Infinity (zero-length strut, bad scale) | Fix the inputs |
| `NEAR_COPLANAR` | warn | Faces cross at a grazing angle within 3 mm of the same plane: the edge shimmers | Offset one part ≥ 3 mm or tilt it more |
| `CUTS_THROUGH` | warn | Two similar-size parts each sit ≥ 15 % inside the other, > 4 cm deep: the crossing line shows | Separate them to a joint-sized overlap or merge them |
| `BURIED_PART` | warn | A part is ≥ 92 % inside another: invisible, costs triangles | Delete it or pull it out so it shows |
| `CABLE_CLIPS` | warn | A `TubeGeometry` cable passes through a solid mid-span | Re-anchor under the joints, reduce sag, let it end on its two anchors |
| `ANIM_DETACH` | warn/info | A bobbing/recoiling part lifts > 3 cm off its mount (warn for bob, info for recoil) | Overlap it deeper, or accept for hover glows |
| `ANIM_DEEPENS_OVERLAP` | warn/info | A spinner sinks deeper into its mount while moving (info for recoil, which slides into a housing by design) | Re-centre the pivot on the part's axis |
| `ANIM_BELOW_GROUND` | warn | A bob dips > 2 cm below y = 0 | Raise the part |
| `TRI_BUDGET` | warn | > 3,500 triangles | Use `rbox(w,h,d,r,1)` (one bevel segment) for small and thin parts: 3x fewer triangles |
| `FEW_PARTS` | warn | < 7 sub-parts (Pillar 1) | Add detail, not primitives |
| `EMISSIVE_LOW` | warn | An energy/amber/crimson/emerald zone below intensity 3.0 will not bloom | Raise `emissiveIntensity` |

### Appearance checks (colour, material, surface detail)

| Code | Severity | Meaning | Typical fix |
| :--- | :--- | :--- | :--- |
| `GROUP_SAME_COLOR` | warn | Two functional groups (locomotion, platform, manipulator; each ≥ 4 % of the surface) have mean zone colours closer than ΔE 14, **or** two touching parts from different groups (each ≥ 2.4 % of the surface) look alike either raw or after the biome dust of dune / oceanForest / forestRock is blended in (two dark zones both turn the same sand tint near the ground): the player cannot tell the parts of the machine apart | Give each group its own zone and lightness: `rubberDark` tyres + light rims, gunmetal chassis, `hullPrimary` body, `hullSecondary` arm |
| `LOW_CONTRAST_INSET` | warn | A thin plate (panel, cell slab, stripe) sits on a bigger part with almost the same colour (ΔE < 12): it disappears | Use a zone that differs in lightness or hue (`solarCell`, `hullSecondary`, `glassVisor`) |
| `ROLE_DETAIL` | warn | A part must look like what it is: a **solar panel** needs ≥ 6 separate cells (each face < 0.028 of the model's squared length) with gaps and a frame; a **wheel** needs a rim/hub in another zone; a **vent** needs ≥ 3 slats | Use `solarPanel()` from `greebles/unitParts.ts`; add a rim and hub; add louvres |
| `FLAT_SURFACE` | warn | A big visible face (≥ 4.5 % of the model's squared length; need grows 1 → 4 features at 2.5x / 5x / 10x that area) has too few parts mounted on it | Add panel lines, vents, hatches, bolts, a stripe or an emissive strip: ≥ 5 mm proud, overlapping the face by ≥ 1 cm |
| `ROLE_ZONE` | warn | Name and zone disagree: a `light`/`beacon`/`laser` that is not an emissive zone (≥ 3.0), a `solar cell` outside `solarCell`, a `visor`/`glass`/`window` outside `glassVisor` | Switch the zone |
| `PALETTE_FLAT` | warn | One zone covers > 70 % of the surface, or fewer than 3 zones carry ≥ 3 %: no material hierarchy | Add the missing tier (60 % primary, 30 % gunmetal, 10 % accent) |
| `NO_ACCENT` | warn | `hullSecondary` + emissive zones cover < 2 % of the surface | Add faction trim and at least one emissive light |
| `MODEL_TOO_DARK` | warn | Area-weighted lightness L* < 30: a dark blob on dark terrain | Move big areas to `hullPrimary` / `hullSecondary` |

Face-size thresholds are **relative to the model's longest side squared**, so a 40 m carrier and a 1.3 m robot are judged alike.
Colour distance is CIE ΔE76 between the zones' sRGB colours. Surface detail is counted from geometry: a "feature" is a smaller part that
touches the face and sits on its outward side; faces covered by a neighbour, facing down, glassVisor or emissive are skipped.

Things the validator deliberately does **not** report: a joint sphere sunk into a hull (one-sided overlap is normal kitbashing),
flush opposite-facing faces (that is a clean contact), and cables as structural support (a cable draped over a part does not hold it up).

## Modelling rules this skill enforces

0. **Colour and detail rules** (appearance checks):
   - **Every functional group has its own colour.** Typical tiers: tyres/treads `rubberDark`, rims and body `hullPrimary`, chassis/joints `frameGunmetal`, arms and trim `hullSecondary`, lights emissive. Do not paint wheels, platform and manipulator with one zone.
   - **A thin inset never shares its base's colour.** A solar cell is `solarCell` (mid blue) on a gunmetal frame, never a dark slab on a dark plate.
   - **A part that has a function shows it:** a solar panel is a grid of cells + bus bars + frame ribs; a wheel is tyre + rim + hub; a vent is a plate with louvres; a tank has bands and a cap; an arm has joints and a gripper.
   - **Big faces carry features.** More than a handful of m² of blank plate reads as a placeholder at the 28° RTS camera.
   - **Low parts must differ in lightness, not hue.** The shader blends the lowest 0.7 to 1.15 m toward the biome dust (35 to 65 %), so two dark zones (tyre and gunmetal chassis) end up the same sand tint on a dune. The validator applies the same blend (`shadedLab` in `appearance.ts`, biome presets from `visuals/biomes.ts`) when it compares touching parts of different groups. Pair a dark part with a light or orange one.

1. **Every part touches its support by ≥ 1 cm of overlap** (contact tolerance is 4 mm). Overlap hides inside the neighbour.
2. **Insets stand proud**: a panel on a frame is thicker or offset by ≥ 2 mm; never coplanar, never inside.
3. **Cables end on anchors**: both ends inside a joint or socket, mid-span clear of every solid. Cables are not supports.
4. **Animated parts are clean about their motion** (from `UnifiedColonyMaterial.ts` and [`procedural-animation-3d`](../procedural-animation-3d/SKILL.md)):
   - `animType 1` (`SpinY`): rotates about **+Y through `animPivot`**, one full turn. **All spinners share the same angle** (they move in lockstep).
   - `animType 2` (`HoverBob`): bobs **±5 cm in Y**; phase depends on `pivot.x`, so equal `pivot.x` means lockstep.
   - `animType 3` (`RecoilPulse`): recoils **0 to 6 cm toward −Z**; phase depends on `pivot.x`.
   - `animType 4` (`BipedLeg`): sagittal hip swing + knee bend + foot clearance lift around hip `animPivot`, coupled to `BipedBody (8)` at the hip socket; left (`pivot.x >= 0`) and right (`pivot.x < 0`) alternate by $\pi$.
   - `animType 5` (`BipedArm`): counter-phase shoulder swing around shoulder `animPivot` (opposite same-side `BipedLeg`), riding on `BipedBody (8)`.
   - `animType 6` (`SpiderLeg`): alternating diagonal/tripod coxa yaw + snappy stepping lift + stance knee flex around hip `animPivot`, coupled to `SpiderBody (9)` at the hip socket.
   - `animType 7` (`WheelSpin`): continuous X-axis rolling around wheel axle `animPivot`.
   - `animType 8` (`BipedBody`) & `animType 9` (`SpiderBody`): full-body step-reaction suspension (spring-damped $2\omega$ impact heave, roll, pitch, yaw, sway, surge). Compound codes `18, 28, 38` and `19, 29, 39` layer `SpinY (1)`, `HoverBob (2)`, or `RecoilPulse (3)` on top of the moving body carrier.
   All sub-parts of a single limb or wheel must share the exact same `animType` and `animPivot` (`sameRig`), with a ball-joint (`sph`) centered at `animPivot` sunk into the static mount and moving struts kept ≥ 1.5 cm clear of static hull walls.
5. **Name the parts** so a report points at code.

## Limits (read before trusting a PASS)

- Colour checks compare zone colours (dust-blended for touching parts of different groups), not rendered pixels: lighting, IBL, bloom and rim light also change what is seen. They catch "same colour" and "no hierarchy", not taste.
- Detail is counted in parts, not triangles: a part that is only a normal-map or a shader trick would count as blank (there are no such textures in this pipeline).
- Group colours need named parts (role keywords in `frontend/render/kitbash/validate/appearance.ts`). Unnamed parts fall under `other` and skip the group and role checks; `FLAT_SURFACE`, `LOW_CONTRAST_INSET` and the palette checks still run.
- A pass means "no detected defect", not "looks good". The 4-view visual loop is still mandatory.
- Not detected: a **dangling free end** of a strut that is attached at its other end, UV/normal problems, silhouette quality, material balance.
- Archetypes that do not go through `KitbashBuilder` fall back to connected islands of the merged mesh (reported as such); part names are then generic.
- The inside test needs closed meshes. Open geometry (cables, planes) takes part in crossing and distance checks only.
- An animated part that already sits within 1 cm of another part **at rest** is skipped by the sweep (it is assumed to be a static problem, reported elsewhere). That is only true when the other part is otherwise unsupported: a spinner 7 mm from a wall, both supported by other paths, can still hit the wall and nothing fires. Keep animated parts ≥ 1 cm from everything but their mount.
- Ships and props are treated as ungrounded (no ground contact rule; the largest part is the root).

## Extending

1. Add the check as a stage in `frontend/render/kitbash/validate/checks/` and run it from `ModelValidator.ts` (use `relate()` for distance/crossing, `embed()` for containment, both in `relation.ts`) or, for colour/material/detail, in `frontend/render/kitbash/validate/appearance.ts` (role keywords, ΔE, face features).
2. Add a **known-bad and a known-good** fixture to `scripts/self-test.mjs` and make `npm run test:models` pass.
3. Document the code in the table above and in [references/checks-and-thresholds.md](./references/checks-and-thresholds.md).
4. Thresholds are `DEFAULT_OPTIONS` in `validate/types.ts`; calibrate with `--pairs` on real models, never to silence one model.
