import { defineSimModule } from '../define';
import { directorIntentSystem } from './intent';
import { setDirectorPolicyHandler } from './policy';

export { goalKey, syncDirectorIntent } from './intent';
export { applyDirectiveBatch, type ActionAck } from './apply';
export { buildColonyBrief, guardBriefText } from './brief';
export { previewBatch, type BatchPreview, type PreviewLimits, type PreviewReason, type PreviewStock } from './preview';
export { coreSkillAction, coreSkillLimits, type CoreSkill } from './strategies';
export { directorSkillIds, selectDirectorSkills, type SkillSelectInput } from './skills';
export { actionLeavesColony, scopeDirective, screenDirective, screenProposal, type ColonyScope } from './scope';
export { spatialAllowed, type ObservedRoute, type ProtectedArea } from './spatial';
export { applyPriorityOverlay, awayGuardPoints, expirePriorityOverlays } from './overlay';
export { applyDirectorPolicy, colonyDirector, noteDirectorPlan, setDirectorPolicyHandler } from './policy';
export { priorityKey, type ColonyDirectorRecord, type DirectorPlanRef } from './store';
export { goalSuppressed, suppressGoal } from './suppress';
export { projectW11Context, restoreW11Context, type W11ContextView, type W11Sector } from './w11';

export default defineSimModule({
  id: 'director',
  wave: 'W16',
  systems: [directorIntentSystem],
  handlers: [setDirectorPolicyHandler],
});
