import { compileData } from '@terra/sim';
import type { FlagSet } from '@terra/contracts';

/** Client-side data tables for the current flags: rows of disabled waves are dropped (same compile as the server). */
export const clientDataFor = (flags: FlagSet) => compileData(flags);
