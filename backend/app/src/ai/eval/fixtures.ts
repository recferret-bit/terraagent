import type { DirectorRisk, DirectorTrigger } from '@terra/contracts';

/** Fixture axis from W16-22. Includes `power`, which is not a `DirectorSkillFamily`. */
export const EVAL_SKILLS = [
  'recovery',
  'resources',
  'power',
  'defence',
  'scouting',
  'expansion',
  'terraforming',
] as const;
export type EvalSkill = (typeof EVAL_SKILLS)[number];

export const EVAL_BIOMES = ['dune', 'oceanForest', 'forestRock'] as const;
export type EvalBiome = (typeof EVAL_BIOMES)[number];

export const EVAL_INVARIANTS = ['scope', 'budget', 'manual', 'none'] as const;
export type EvalInvariant = (typeof EVAL_INVARIANTS)[number];

/** Two authoritative director triggers. The product stays 3 × 2 × 7 × 2. */
const EVAL_TRIGGERS = ['resource.critical', 'under_attack'] as const satisfies readonly DirectorTrigger[];

const EVAL_RISKS = ['conservative', 'risky'] as const satisfies readonly DirectorRisk[];

export interface EvalFixture {
  readonly id: string;
  readonly biome: EvalBiome;
  readonly risk: DirectorRisk;
  readonly skill: EvalSkill;
  readonly trigger: DirectorTrigger;
  readonly invariant: EvalInvariant;
}

/**
 * Stable paired-risk cases, ids `fx-0` upward in biome → risk → skill → trigger order.
 * 3 biomes × 2 risks × 7 skills × 2 triggers = 84.
 */
export function buildFixtures(): EvalFixture[] {
  const fixtures: EvalFixture[] = [];
  for (const biome of EVAL_BIOMES) {
    for (const risk of EVAL_RISKS) {
      for (const skill of EVAL_SKILLS) {
        for (const trigger of EVAL_TRIGGERS) {
          const index = fixtures.length;
          const invariant = EVAL_INVARIANTS[index % EVAL_INVARIANTS.length] ?? 'none';
          fixtures.push({ id: `fx-${index}`, biome, risk, skill, trigger, invariant });
        }
      }
    }
  }
  return fixtures;
}
