// @vitest-environment jsdom
import { parseWaves } from '@terra/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { FeatureContext } from '../../core/registry/types';
import { HqPanel } from './HqPanel';

function ctxWith(sendCommand: FeatureContext['services']['sendCommand']): FeatureContext {
  return {
    flags: new Set(parseWaves('..08').list),
    host: 'server',
    services: { track: () => {}, sendCommand, session: { planetId: () => 'p' }, colonyId: 0 },
  };
}

describe('HQ AI toggle', () => {
  it('shows OFF by default, sends setAiEnabled and mirrors the replica', () => {
    const send = vi.fn(async () => ({ ok: true as const, appliedAtTick: 1 }));
    const host = document.createElement('div');
    const hq = new HqPanel(host, ctxWith(send));
    const btn = host.querySelector<HTMLButtonElement>('[data-testid="hq-ai-toggle"]')!;
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(btn.textContent).toBe('AI OFF');
    // Mounted in the HQ panel above the tab strip.
    expect(host.querySelector('[data-testid="hq-panel"] > [data-testid="hq-ai-toggle-row"]')).not.toBeNull();

    btn.click();
    expect(send).toHaveBeenLastCalledWith('setAiEnabled', { enabled: true });
    // The button follows the host, not the click.
    expect(btn.textContent).toBe('AI OFF');
    hq.update({ colonies: [{ index: 0, aiEnabled: true }] });
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.textContent).toBe('AI ON');
    btn.click();
    expect(send).toHaveBeenLastCalledWith('setAiEnabled', { enabled: false });
  });
});
