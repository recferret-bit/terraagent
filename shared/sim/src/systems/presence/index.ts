import { defineSimModule } from '../define';
import { presenceHandler } from './handler';

export { PRESENCE_BLOB, presenceAway, type PresenceBlobValue, type PresenceByColony } from './blob';

/** Away flag only. No wall clock (SIM-D-06): the server posts `system.presence` after `AWAY_AFTER_S`. */
export default defineSimModule({
  id: 'presence',
  wave: 'W09',
  handlers: [presenceHandler],
});
