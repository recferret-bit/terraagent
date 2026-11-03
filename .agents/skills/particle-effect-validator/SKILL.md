---
name: particle-effect-validator
description: >-
  Validate 3D procedural particle presets and tool-cutter beams. Checks
  multi-layer composition (>= 3 layers, >= 2 3D geometry primitives), 60/30/10
  primary/secondary/accent role balance, CIE Lab colour contrast (ΔE76 >= 15)
  between primary and secondary debris, HDR bloom intensity (>= 3.0 on accents
  and beams), ground-plane bounce physics, kinematic ranges, and GPU instance/
  triangle budgets. Use this skill after creating or modifying ANY particle
  preset and before visual QA.
---

# Particle Effect Validator (`particle-effect-validator`)

Just as `model-geometry-validator` prevents primitive, monochrome, or broken kitbashed meshes from landing in the game, `particle-effect-validator` prevents particle effects from degenerating into flat 2D templates, single-colour dust clouds, or non-physical sprites that fall through the terrain.

It reads every `ParticlePresetSpec` registered in `ParticlePresetRegistry` (`frontend/render/particles/`), computes exact triangle and instance budgets from the 3D chunk geometries (`geometries.ts`), converts layer sRGB hex colours into perceptual CIE $L^*a^*b^*$ coordinates, and verifies all 10 composition, appearance, and physics invariants numerically.

---

## Workflow (Mandatory for Every New or Edited Particle Preset)

### Step 1: Run the CLI Validator
```bash
npm run validate:particles -- --all                # validate all registered presets in ParticlePresetRegistry
npm run validate:particles -- work.tree            # validate by preset ID
npm run validate:particles -- rock                 # validate by targetKind (tree|rock|dune|hole|flat|metals|minerals|oil|repair)
npm run validate:particles -- --all --quiet        # one summary line per preset
npm run validate:particles -- --all --json         # machine-readable JSON output
npm run test:particles                             # self-test of the validator (known-good and known-bad synthetic fixtures)
```
Exit code is `1` when any preset has an **error** (`--strict` also fails on warnings).

### Step 2: Fix Issues Using the Check Table Below
Every reported issue prints a `fix:` prescription. Fix the **preset definition** in `frontend/render/particles/presets.ts`, never the validator thresholds.

### Step 3: Visual QA in the 3D Playground
Open `http://127.0.0.1:5173/playground.html?inspect=robot.miner&work=1&workTarget=tree` (or call `window.__pg.setWorkTarget('rock')` / `window.__pg.validateParticles('work.rock')`).
Inspect `iso`, `front`, `side`, and `top` views to confirm:
- Distinct 3D chunk silhouettes and high-contrast primary vs secondary debris colours (e.g., emerald foliage vs mahogany bark on `tree`, weathered granite vs dark basalt on `rock`, golden sand vs ochre clods on `dune`).
- Solid chunks bouncing and skittering along the `Y = 0` ground plane.
- Articulated tool cutter beam (locked to GPU-animated hands/drills via `toolOrigins.ts`) and HDR accent sparks triggering selective bloom.

---

## What It Checks

| Code | Severity | Meaning | Typical Fix |
| :--- | :--- | :--- | :--- |
| `FEW_LAYERS` | error | Preset has `< 3` particle layers | Compose at least 3 layers: `primary` (~60%), `secondary` (~30%), and `accent` (~10%) |
| `FLAT_GEOMETRY_VARIETY` | warn | Preset uses `< 3` distinct `ParticleGeometryKind` primitives | Mix at least 3 distinct 3D chunk geometries (e.g. `leafCluster` + `barkSlab` + `woodSplinter` + `weldSpark`) |
| `MISSING_ROLE` | error | Missing `primary`, `secondary`, or `accent` role tier | Ensure all three roles (`primary`, `secondary`, `accent`) are present in `layers` |
| `ROLE_RATIO_SKEW` | warn | Instance count shares deviate from the 60/30/10 hierarchy (`primary` outside `42%..75%`, `secondary` outside `16%..45%`, or `accent` outside `4%..25%`) | Rebalance `layer.count` across `primary`, `secondary`, and `accent` |
| `LOW_LAYER_CONTRAST` | error | Dominant `primary` and `secondary` layers have CIE $\Delta E_{76} < 15.0$ | Increase lightness ($L^*$) or hue ($a^*, b^*$) separation between primary and secondary debris colours |
| `EMISSIVE_TOO_LOW` | error | `accent` layer or `toolBeam` has `emissiveIntensity < 3.0` and will not trigger selective `UnrealBloomPass` (`threshold: 1.1`) | Set `emissiveIntensity >= 3.5` on `accent` layers and `toolBeam` |
| `PRIMARY_EMISSIVE_BLOWOUT` | warn | Non-`accent` debris layer has `emissiveIntensity >= 1.5`, washing out 3D facet shading into a glowing blob | Keep `primary` and `secondary` layers non-emissive (`emissiveIntensity < 1.0`) so sun/shadow facets read clearly |
| `NO_GROUND_BOUNCE` | warn | Heavy ballistic layer (`gravity >= 5.0`) has `bounce <= 0.05`, or no `primary`/`secondary` layer has `bounce >= 0.15` | Enable `bounce >= 0.25` on solid chunk layers so debris rebounds and skitters on the terrain |
| `PHYSICS_INVALID` | error | Invalid `count <= 0`, `sizeRange` outside `(0, 0.8]`, `lifetimeRange` outside `(0.05, 6.0]`, `spreadCone` outside `(0, PI]`, `drag` outside `[0, 15]`, `bounce` outside `[0, 0.95]`, or `toolBeam.beamRadius <= 0` | Fix kinematic ranges in the offending `ParticleLayerSpec` or `ToolBeamSpec` |
| `PARTICLE_BUDGET` | error | Total instances `> 180` or total instanced triangles `> 3,500` per active work site | Reduce `layer.count` or use lower-poly 3D chunk primitives (`leafCluster`, `sandGrain`, `weldSpark`) |
