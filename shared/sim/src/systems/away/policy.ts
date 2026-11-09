import type { AwayCommand, AwayDecision, AwayPolicyView } from './types';
import { allowRule } from './allow';

/**
 * Pure away policy for the allow list (AW-01..07, AW-21).
 * A command that matches no allow rule abstains. Deny rules (AW-10..15) are W09-10.
 * Player commands and a colony that is not away are allowed (AW-23).
 */
export function awayPolicy(view: AwayPolicyView, command: AwayCommand): AwayDecision {
  if (!view.away) return { decision: 'allow', rule: 'present' };
  if (command.actor === 'player') return { decision: 'allow', rule: 'player' };
  const rule = allowRule(view, command);
  return rule ? { decision: 'allow', rule } : { decision: 'abstain' };
}
