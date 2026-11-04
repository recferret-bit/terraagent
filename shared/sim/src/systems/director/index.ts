import { defineSimModule } from '../define';
import { directorIntentSystem } from './intent';
import { setDirectorPolicyHandler } from './policy';

export { goalKey, syncDirectorIntent } from './intent';
export { applyDirectiveBatch, type ActionAck } from './apply';
export { buildColonyBrief, guardBriefText } from './brief';
export { previewBatch, type BatchPreview, type PreviewLimits, type PreviewReason, type PreviewStock } from './preview';
export { directorSkillIds, selectDirectorSkills, type SkillSelectInput } from './skills';
export { actionLeavesColony, scopeDirective, screenDirective, screenProposal, type ColonyScope } from './scope';
export { applyDirectorPolicy, colonyDirector, noteDirectorPlan, setDirectorPolicyHandler } from './policy';
export { priorityKey, type ColonyDirectorRecord, type DirectorPlanRef } from './store';

export default defineSimModule({
  id: 'director',
  wave: 'W16',
  systems: [directorIntentSystem],
  handlers: [setDirectorPolicyHandler],
});
