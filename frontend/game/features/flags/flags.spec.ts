// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { FeatureContext } from '../../core/registry/types';
import flagsFeature from './index';

describe('flags panel (FA-30)', () => {
  it('redraws on update() when the live flag set or its source changed after mount (no re-mount on welcome)', () => {
    const flags = new Set(['W00']);
    const services: Record<string, unknown> = { flagsSource: 'default' };
    const ctx = { flags, host: 'server', services } as unknown as FeatureContext;
    const el = document.createElement('div');
    const panel = flagsFeature.hud![0].mount(el, ctx);
    if (el.querySelector('.ta-flags__head')!.getAttribute('aria-expanded') === 'false') (el.querySelector('.ta-flags__head') as HTMLButtonElement).click();
    expect(el.querySelector('[data-wave="W01"]')!.getAttribute('data-on')).toBe('false');

    flags.add('W01'); // the welcome updates the live set in place
    services.flagsSource = 'welcome';
    panel.update?.({});
    expect(el.querySelector('[data-wave="W01"]')!.getAttribute('data-on')).toBe('true');
    expect(el.querySelector('.ta-flags__src')!.textContent).toBe('source: server');
    const head = el.querySelector('.ta-flags__head');
    panel.update?.({}); // nothing changed: no redraw
    expect(el.querySelector('.ta-flags__head')).toBe(head);
    panel.dispose();
  });
});
