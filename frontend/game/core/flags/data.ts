import { compileData, type BalanceOverrides } from '@terra/sim';
import type { FlagSet } from '@terra/contracts';

/** Client-side data tables for the current flags: rows of disabled waves are dropped (same compile as the server, with the planet's balance overrides from `welcome.overrides`, D-35). */
export const clientDataFor = (flags: FlagSet, overrides?: BalanceOverrides) => compileData(flags, overrides);
