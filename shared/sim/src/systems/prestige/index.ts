import { defineSimModule } from '../define';
export * from './project';
export * from './rows';

/** No system of its own: the project runs as a `project` task in the order queue (`systems/queue`). */
export default defineSimModule({ id: 'prestige', wave: 'W13' });
