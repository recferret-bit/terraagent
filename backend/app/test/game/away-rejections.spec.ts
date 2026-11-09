import { describe, expect, it } from 'vitest';
import { Registry } from 'prom-client';
import { installAwayPolicyMetric, noteAwayPolicyRejection } from '../../src/game/away-rejections';

describe('W09-12 away_policy_rejections_total', () => {
  it('counts a rejection by rule and stays at zero for another rule', async () => {
    const registry = new Registry();
    installAwayPolicyMetric(registry);
    noteAwayPolicyRejection('AW-10', 'auto');
    noteAwayPolicyRejection('AW-10', 'auto');
    const text = await registry.metrics();
    expect(text).toContain('away_policy_rejections_total{rule="AW-10",actor="auto"} 2');
    noteAwayPolicyRejection('AW-15', 'ai');
    const again = await registry.metrics();
    expect(again).toContain('away_policy_rejections_total{rule="AW-15",actor="ai"} 1');
  });
});
