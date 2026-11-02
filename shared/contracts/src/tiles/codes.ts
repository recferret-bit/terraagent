/**
 * Tile enum codes and the default colony palette, as plain data both the sim and the render engine may import
 * (RN-06: render may not import the sim's state modules). They are the one copy: the sim's `TERRAIN`, `PREP`,
 * `DEPOSIT` (`shared/sim/src/grid/layers.ts`) and `DEFAULT_COLONY_COLORS` (`shared/sim/src/kernel/colonies.ts`) are
 * built from them (`shared/sim/test/grid/tile-codes.spec.ts`). Later waves append values, never renumber.
 */

/** Ground class of a tile (`terrain` layer). */
export const TERRAIN_CODES = { flat: 0, forest: 1, rock: 2, slope: 3, hole: 4, shallow: 5, deep: 6 } as const;

/** Preparation state of a tile (`prep` layer). */
export const PREP_CODES = { wild: 0, flat: 1, prepared: 2, irrigated: 3, living: 4, ridge: 5, moat: 6 } as const;

/** Visible deposit of a tile (`deposit` layer). */
export const DEPOSIT_CODES = { none: 0, metals: 1, minerals: 2, oil: 3 } as const;

/** Colours (0xrrggbb) given to colony records created without one, by colony index. */
export const DEFAULT_COLONY_COLORS = [0xff6a2a, 0x2ec4b6, 0xe71d36, 0xff9f1c, 0x8338ec, 0x3a86ff] as const;
