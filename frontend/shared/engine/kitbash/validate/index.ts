export { validateModel, DEFAULT_OPTIONS } from './ModelValidator';
export type { ModelInput, PartDef, Report, Issue, Severity, PartStat, PairStat, ValidatorOptions } from './ModelValidator';
export { checkAppearance, labOfHex, deltaE, roleOf } from './appearance';
export { extractArchetype } from './extract';
export { formatReport } from './format';

import { extractArchetype } from './extract';
import { validateModel, type ValidatorOptions } from './ModelValidator';
import { ArchetypeCatalog } from '../catalog';
/** Validate one registered archetype by id. Ships and props (orbital, not standing on ground) skip the ground rules. */
export const validateArchetype = (id: string, options: Partial<ValidatorOptions> = {}) => {
  const cat = ArchetypeCatalog.get(id).category;
  return validateModel(extractArchetype(id), { grounded: cat !== 'ship' && cat !== 'prop', ...options });
};
