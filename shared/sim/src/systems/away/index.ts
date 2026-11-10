import { defineSimModule } from '../define';
import { setAutopilotHandler } from './autopilot';

export { awayPolicy } from './policy';
export { allowRule, withinDirective } from './allow';
export { denyRule } from './deny';
export {
  isCancelTruce,
  isProposeTruce,
  isRaidCommand,
  isRespondTruce,
  isTruceCommand,
  raidOrder,
  withinDiplomacyPolicy,
} from './orders';
export { withinAutoTrade } from './auto-trade';
export { chargeAwaySpend, openAwaySession, type SpendPurpose, type SpendResult } from './session';
export {
  awayPolicyRejectionCount,
  checkAiRaidAwayPolicy,
  colonyIsAway,
  gateAwayCommand,
  resetAwayPolicyRejections,
  resolveColonyAwayRaids,
} from './gate';
export { applyAutopilot, readAwaySettings, type ColonyAwaySettings } from './store';
export type { AwayCommand, AwayDecision, AwayPolicyView } from './types';

export default defineSimModule({
  id: 'away',
  wave: 'W09',
  handlers: [setAutopilotHandler],
});
