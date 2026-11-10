import type { AwayCommand, AwayDenyRule, AwayPolicyView } from './types';
import { withinDirective } from './allow';
import { buildOrder } from './orders';

const HIGH_TIER = 2;
const CHAIN = new Set(['claimAccount', 'relay', 'stake', 'retireColony', 'abandonColony']);

function overBudget(view: AwayPolicyView, command: AwayCommand): boolean {
  return command.cost !== undefined && !withinDirective(view, command.cost);
}

function highTier(args: unknown): boolean {
  const order = buildOrder(args);
  return order !== null && order.tier >= HIGH_TIER;
}

/** AW-10..15. Null means no specific deny; the policy then uses AW-15 for anything still unallowed. */
export function denyRule(view: AwayPolicyView, command: AwayCommand): AwayDenyRule | null {
  if (command.kind === 'demolish' || command.kind === 'downgrade') return 'AW-10';
  if (command.kind === 'raid' && !view.awayRaids) return 'AW-11';
  if (command.kind === 'launchRocket' || command.kind === 'planetTransfer') return 'AW-12';
  if ((command.kind === 'trade' || command.kind === 'marketPlaceOrder') && command.withinAutoTrade !== true) return 'AW-13';
  if (command.kind === 'setAutopilot' || command.kind === 'retireColony' || CHAIN.has(command.kind)) return 'AW-14';
  if (highTier(command.args) || overBudget(view, command) || command.kind === 'project') return 'AW-15';
  return null;
}
