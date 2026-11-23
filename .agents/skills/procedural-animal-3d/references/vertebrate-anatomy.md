# Vertebrate Anatomy, Proportions & Builders

## 1. Geometry Primitives & Modules

- `frontend/render/kitbash/greebles/organic/vertebrateLoft.ts`:
  - `sculptedLoft(stations, radialSegs, tissue, uvScale, noiseAmp, options)`: lofted anatomical silhouette supporting Catmull-Rom spline rings, `compactCaps` single-ring dome endcaps, `tiltSagittal` sagittal cross-section tilting for upright manes/ruffs, asymmetric dorsal/ventral radii (`ryTop`, `ryBot`), spine ridge pinching (`ridge`), superellipse squaring (`squareness`), ventral sternum/brisket V-keel taper (`keel`), dorsal-to-ventral width bias (`topWidth`), mid-flank iliac waist hollowing (`flankIndent`), and dorso-lateral scapular shoulder blade & pelvic/gluteal haunch muscular flare (`muscleFlare`).
  - `sculptedLimbSegment(pts, radiiX, radiiZ, segs, tissue)`: directional muscle-belly loft oriented along limb chain axes (scapula/deltoid/triceps -> elbow -> forearm/carpus -> pastern; croup haunch/gluteus/hamstring -> stifle -> gaskin calf -> calcaneal hock heel -> straight cannon) with caudal muscle-belly bias, 5-ring root-damped upward vertex normals (eliminating horizontal overhead-sun drumstick seams where upper limbs enter the flank), and deep sagittal shoulder (`>= 1.45x`) and haunch (`>= 1.65x`) chords.
  - `sculptedWingFoil(stations, spanSegs, tissue)`: cambered NACA-style avian wing airfoil (`chord`, `thick`, `camber`, `twist`) keeping leading edge rounded and trailing edge knife-tapered.
  - `sculptedFeather(length, width, thick, barbTaper, tissue)`: asymmetrical curved primary/rectrix feather vane with subtle central rachis camber.
  - `sculptedEar(width, height, cupDepth, side, pointFactor, tissue)`: concave pinna cup (`rot -PI/2` facing forward/outward).
- `frontend/render/kitbash/greebles/organic/vertebrates.ts`, `vertebrateLimbs.ts` & `vertebrateHeadTail.ts`:
  - `buildMammalCore`: composes the axial `sculpted mammalian trunk` with integrated 3D anatomical muscle volumes (`left/right scapular shoulder mass`, `left/right gluteal haunch mass`, `pectoral brisket mass`, all `role: 1` sharing world-space `makeMammalBodyColor` bounds so coat patterns flow seamlessly without foreign color patches and overhang upper limb roots without horizontal drumstick shelves).
  - `addMammalForelimb` / `addMammalHindlimb`: diagonal trot phases (`LF + RH = PI`, `RF + LH = 0`), medially-anchored upper limb roots inside the scapular/gluteal muscle masses, anatomical elbow/stifle/hock angulation, cloven hooves (`hoof: true`), camel cushion pads (`camelPad: true`), or 3-toe plantigrade/digitigrade paws (`addFoot`) sharing shoulder/hip `animPivot`.
  - `addMammalNeckAndHead` / `addMammalMuzzleAndJaw` / `addMammalEyesAndEars` / `addMammalTail`: 9 differentiated cranial archetypes (`skullProfile`: `canid`, `feline`, `ungulate`, `camelid`, `ursine`, `rodent`, `lagomorph`, `tapir`, `prosimian`) sculpting zygomatic cheek flare, deep mandibular jowl angle, distinct frontal stop, and species-specific muzzle geometry.
- `frontend/render/kitbash/greebles/organic/avianBuilder.ts`:
  - `buildAvianCore`: fuselage + pectoral breast keel + scapular dorsal mantle + `addBirdWings` (`inner wing` + `upper wing coverts` + `outer wing` + 4–5 shingled `primary feather` blades) + `addBirdHeadAndBeak` + `addBirdTailAndLegs`.
- `frontend/render/kitbash/archetypes/units/warmFaunaSpecs.ts` (+ `warmFaunaForestOceanSpecs.ts`, `warmFaunaDuneSpecs.ts`, `warmFaunaTypes.ts`) and `warmFauna.ts`: 12 biome-endemic mammals (`timberWolf`, `crownStag`, `cragUrsine`, `meadowHare`, `canopyPanther`, `reefTapir`, `lagoonCapybara`, `islandLemur`, `duneJackal`, `saberOryx`, `mesaCaracal`, `oasisCamelid`).
- `frontend/render/kitbash/archetypes/units/avianFaunaSpecs.ts` & `avianFauna.ts`: 15 biome-endemic birds across raptor, pelagic glider, songbird, corvid, wader, frugivore, swallow, and falcon guilds.

## 2. Tissue & Texture Assignments (`aOrganic`)

| Tissue ID | Anatomical Role | Procedural Surface Response (`organicSurface.ts`) |
| :--- | :--- | :--- |
| `6` | Mammalian pelage (trunk, neck, limbs, ears, paws, tail) | Triplanar/world-filtered guard-hair flow + neutral achromatic `warmFurPelage` PBR map/roughness (no orange banding) |
| `7` | Avian plumage (fuselage, coverts, primaries, rectrices) | Pennaceous rachis + diagonal barbule vane sheen via `avianFeatherVane` PBR map/roughness |
| `4` | Cloven hooves, desert camel pads, beaks, horns, antlers | Directional keratin ridge grain & matte wear |
| `5` | Recessed eyes, rhinarium nose pads | Glossy organic moisture specular (`roughness ~0.14`, dark sclera/iris) |
