import { Counter, type Registry } from 'prom-client';

let counter: Counter<'rule' | 'actor'> | undefined;

/** Registers `away_policy_rejections_total{rule,actor}` on the shared registry. */
export function installAwayPolicyMetric(registry: Registry): void {
  if (counter) return;
  counter = new Counter({
    name: 'away_policy_rejections_total',
    help: 'Automated commands rejected by the away policy',
    labelNames: ['rule', 'actor'],
    registers: [registry],
  });
}

/** Counts one sim reject whose code is `away_policy`. `detail` is the AW rule. */
export function noteAwayPolicyRejection(rule: string, actor = 'auto'): void {
  counter?.inc({ rule, actor });
}
