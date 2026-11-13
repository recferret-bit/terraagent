import type { AwayCommand, AwayDecision, AwayPolicyView } from './types';
import { allowRule } from './allow';
import { denyRule } from './deny';
import { isCancelTruce, isCancelWar, isRaidCommand, locksHumanNearBond } from './orders';

/**
 * Pure away policy (AW-01..15, AW-21).
 * Player commands and a colony that is not away are allowed (AW-23).
 * Anything an away actor does that is not on the allow list is rejected.
 */
export function awayPolicy(view: AwayPolicyView, command: AwayCommand): AwayDecision {
  if (!view.away) return { decision: 'allow', rule: 'present' };
  if (command.actor === 'player') return { decision: 'allow', rule: 'player' };
  if (isCancelTruce(command) || isCancelWar(command) || locksHumanNearBond(command)) {
    return { decision: 'reject', rule: 'AW-13', code: 'away_policy' };
  }
  const allowed = allowRule(view, command);
  if (allowed) return { decision: 'allow', rule: allowed };
  if (command.defensive) return { decision: 'allow', rule: 'defensive' };
  if (isRaidCommand(command) && view.awayRaids) return { decision: 'allow', rule: 'raid-opt-in' };
  if ((command.kind === 'trade' || command.kind === 'marketPlaceOrder') && command.withinAutoTrade === true) {
    return { decision: 'allow', rule: 'AW-01' };
  }
  const denied = denyRule(view, command);
  return { decision: 'reject', rule: denied ?? 'AW-15', code: 'away_policy' };
}
