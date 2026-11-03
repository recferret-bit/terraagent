import { defineTable, type RowValue } from './_define';

/** The deposit families a terraform find can be. */
export const FIND_FAMILIES = ['metals', 'minerals', 'oil'] as const;
export type FindFamily = (typeof FIND_FAMILIES)[number];

/** The resource deposit roll of a finished ground terraform `work` job, as the sim reads it (`terraformFindSpec`). */
export interface TerraformFindSpec {
  readonly chance: number;
  readonly tierWeights: Readonly<Record<1 | 2 | 3, number>>;
  readonly families: readonly FindFamily[];
  readonly richnessBp: number;
}

const num = (row: Readonly<Record<string, RowValue>>, field: string): number => {
  const v = row[field];
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new Error(`data row terraformFinds.deposit.${field} is not a non-negative number`);
  return v;
};

/** A row of `terraformFinds` (file or compiled) as a {@link TerraformFindSpec}; unknown families are an error. */
export function findSpecFromRow(row: Readonly<Record<string, RowValue>>): TerraformFindSpec {
  const fams = row.families;
  if (!Array.isArray(fams) || fams.some((f) => !(FIND_FAMILIES as readonly unknown[]).includes(f))) {
    throw new Error(`data row terraformFinds.deposit.families must list ${FIND_FAMILIES.join(' / ')}`);
  }
  return {
    chance: Math.min(1, num(row, 'chance')),
    tierWeights: { 1: num(row, 't1Weight'), 2: num(row, 't2Weight'), 3: num(row, 't3Weight') },
    families: [...(fams as FindFamily[])],
    richnessBp: num(row, 'richnessBp'),
  };
}

/**
 * Resource deposit found by terraforming (owner decision W02): when a ground `work` job finishes and the hex holds no
 * deposit after the buried-deposit reveal, roll `chance` (the `misc` rng stream); on a hit a full deposit
 * (`richnessBp`) of a uniform `families` kind appears with tier odds `t1Weight` / `t2Weight` / `t3Weight` (relative).
 * Its tier is the visible `depositTier` tile layer (Harvester and Metals Extractor pay `metals.t{tier}`, …).
 * Tunable: `tune terraformFinds.deposit.chance 0.5`. Dev: `spawndeposit <q> <r> <family> <tier>` places one.
 */
const table = defineTable({
  name: 'terraformFinds',
  summary: 'Resource deposit found by a finished terraform work job: chance, tier odds, families, richness.',
  rows: [
    {
      id: 'deposit',
      wave: 'W02',
      chance: 0.01,
      t1Weight: 0.5,
      t2Weight: 0.35,
      t3Weight: 0.15,
      families: ['metals', 'minerals', 'oil'],
      richnessBp: 10000,
    },
  ],
});
export default table;

/** The file row's numbers (untuned). The sim and a tune-aware UI read `terraformFindSpec(data)` instead. */
export const TERRAFORM_RESOURCE_SPAWN: TerraformFindSpec = findSpecFromRow(table.rows[0]!);
