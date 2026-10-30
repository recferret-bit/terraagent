import type { ParityCase } from './_define';
import { PARITY_CASES } from './index.generated';

export * from './_define';

/** Every parity case, sorted by id (one file per case, `scenarios/parity/*.parity.ts`; generated index). */
export const listParityCases = (): readonly (ParityCase & { readonly id: string })[] => PARITY_CASES.map((c) => ({ ...c.def, id: c.id }));

export const getParityCase = (id: string): (ParityCase & { readonly id: string }) | undefined => listParityCases().find((c) => c.id === id);
