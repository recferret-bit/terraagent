import { RESOURCE_KEYS } from '../ws/sim';
import { economyError, type EconomyError } from './errors';
import type { ProfileContent } from './profile';

/**
 * Structural profile checks that are not a single zod field: every one of the ten ResourceKeys has exactly one resource
 * policy with a source, a consumer, a producer cohort and a buyer cohort (ECONOMY §2), no duplicate recipes/pairs, and
 * band ordering. Returns `[]` when the content is coherent.
 */
export function checkProfileContent(content: Pick<ProfileContent, 'resourcePolicies' | 'recipes' | 'marketPolicies'>): EconomyError[] {
  const errors: EconomyError[] = [];
  const seen = new Set<string>();
  for (const p of content.resourcePolicies) {
    const at = `resourcePolicies.${p.resource}`;
    if (seen.has(p.resource)) errors.push(economyError('invalid_manifest', `duplicate resource policy for ${p.resource}`, at));
    seen.add(p.resource);
    const gaps = (['sources', 'consumers', 'producerCohorts', 'buyerCohorts'] as const).filter((f) => p[f].length === 0);
    if (gaps.length) errors.push(economyError('missing_resource_coverage', `${p.resource} has no ${gaps.join(', ')}`, at, { missing: gaps }));
    if (p.targetBand.loBp > p.targetBand.hiBp) errors.push(economyError('dependency_violation', 'targetBand.loBp must be <= hiBp', `${at}.targetBand`));
  }
  for (const k of RESOURCE_KEYS) {
    if (!seen.has(k)) errors.push(economyError('missing_resource_coverage', `no resource policy for ${k}`, `resourcePolicies.${k}`, { resource: k }));
  }
  dupes(content.recipes.map((r) => r.recipeId), 'recipes', errors);
  dupes(content.marketPolicies.map((m) => m.pairId), 'marketPolicies', errors);
  return errors;
}

function dupes(ids: readonly string[], section: string, out: EconomyError[]): void {
  const s = new Set<string>();
  for (const id of ids) {
    if (s.has(id)) out.push(economyError('invalid_manifest', `duplicate id "${id}" in ${section}`, `${section}.${id}`));
    s.add(id);
  }
}
