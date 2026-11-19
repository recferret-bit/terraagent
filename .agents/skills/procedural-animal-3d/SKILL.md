---
name: procedural-animal-3d
description: >-
  Create or refine TerraAgent warm-blooded vertebrate mammals and birds with sculpted anatomical lofts,
  differentiated forelimb/hindlimb joints, cambered airfoils, primary feather fans, fur pelage and feather
  vane textures, and organic anti-slop validation. Not for insects or mechanical robots.
---

# Procedural Vertebrate Animals & Birds (`procedural-animal-3d`)

Follow the [organic fauna policy](../procedural-kitbash-3d/references/organic-fauna.md) and the anatomical proportions in [vertebrate anatomy](./references/vertebrate-anatomy.md).

## Non-Negotiable Anti-Slop Guardrails

- **Zero geometric primitives as whole body parts:** never represent a trunk as a single scaled ellipsoid or a limb as a straight stick with protruding spherical joint balls. Use `sculptedLoft` (`greebles/organic/vertebrateLoft.ts`) with ribcage-to-loin-to-croup cross-sections and `sculptedLimbSegment` (`vertebrae`, `scapula -> elbow -> wrist -> pastern`, `pelvis -> stifle -> hock -> ankle`).
- **Rich sub-part count & tight triangle budget:** every vertebrate model must assemble **>= 22 sculpted sub-parts** (trunk/fuselage, brisket/breast plumage, differentiated limbs/wings, cranium, upper muzzle/culmen, separate lower jaw/mandible, supraorbital brow ridges, recessed eyes, cupped pinnae/crests, fanned tail rectrices/tail brush, and hooves/paws) while staying strictly under **3,500 triangles**.
- **Recessed brow-shaded eyes (`<= 25%` cranium width):** always tuck `glassVisor` eyes under sculpted brow ridges (`eye <= 0.25 * craniumWidth`), never oversized protruding marble eyes.
- **No HDR bloom blowouts (`channel <= 218`):** keep albedos natural (`max RGB channel <= 218`, e.g., capped whites `0xc4c8d0`, warm ochres `<= 0xc8a482`) so directional sunlight and `UnrealBloomPass` never wash pale coats or plumage into glowing white blobs.
- **Differentiated bird wings & fanned tails:** use `sculptedWingFoil` for separate cambered inner secondary (`role 7`), upper coverts, and outer hand wing (`role 8`), tipped with individual shingled `sculptedFeather` primary blades (`>= 6` outer parts) and `>= 4` individually fanned tail rectrices (`role 9`).
- **Tissues & startup textures:** stamp coat parts with `tissue = 6` (`warmFurPelage` achromatic pelage PBR bundle) and feathered parts with `tissue = 7` (`avianFeatherVane` barbule/rachis PBR bundle); keep horns, beaks, claws, and hooves `tissue = 4`, eyes `tissue = 5`, `metalness = 0`.
- **Mandatory workflow:** run `npm run validate:models -- --category fauna --strict` + `npm run test:models` + inspect `iso`, `front`, `side`, `top` and poses in `/playground.html?inspect=fauna.<id>&pose=...` across all three biomes.
