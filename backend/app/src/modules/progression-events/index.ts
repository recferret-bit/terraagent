import { defineBackendModule } from '../define';
import { ProgressionEventsModule } from './progression-events.module';

export * from './progression-events.service';
export * from './progression-events.module';
export { defineBackendModule, type BackendModuleDef } from '../define';

export const progressionEventsModule = defineBackendModule({
  id: 'progression-events',
  wave: 'W02',
  module: ProgressionEventsModule,
});

export default progressionEventsModule;
