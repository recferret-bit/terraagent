import { defineSimModule } from '../define';
import { directorIntentSystem } from './intent';
import { setDirectorPolicyHandler } from './policy';

export { goalKey, syncDirectorIntent } from './intent';
export { applyDirectorPolicy, colonyDirector, noteDirectorPlan, setDirectorPolicyHandler } from './policy';
export { priorityKey, type ColonyDirectorRecord, type DirectorPlanRef } from './store';

export default defineSimModule({
  id: 'director',
  wave: 'W16',
  systems: [directorIntentSystem],
  handlers: [setDirectorPolicyHandler],
});
