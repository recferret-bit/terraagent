import { defineSimModule } from '../define';
import { setAutopilotHandler } from './autopilot';

export { awayPolicy } from './policy';
export { allowRule, withinDirective } from './allow';
export { applyAutopilot, readAwaySettings, type ColonyAwaySettings } from './store';
export type { AwayCommand, AwayDecision, AwayPolicyView } from './types';

export default defineSimModule({
  id: 'away',
  wave: 'W09',
  handlers: [setAutopilotHandler],
});
