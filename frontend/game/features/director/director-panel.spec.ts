// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { FeatureContext } from '../../core/registry/types';
import { DirectorPanel } from './DirectorPanel';
import directorFeature from './index';

const RATIONALE = '<img src=x onerror=alert(1)>';

function ctx(flags: readonly string[]): FeatureContext {
  return { flags: new Set(flags), host: 'server', services: { track: () => {} } };
}

describe('director panel', () => {
  it('renders a rejection as text and never as applied', () => {
    const host = document.createElement('div');
    const panel = new DirectorPanel(host);
    panel.render([
      { actionId: 'a-reject', state: 'rejected', reason: 'terrain_unbuildable', rationale: RATIONALE },
      { actionId: 'a-ok', state: 'applied', rationale: 'built the depot' },
    ]);

    const rejected = host.querySelector<HTMLElement>('[data-state="rejected"]');
    expect(rejected).not.toBeNull();
    const text = rejected?.textContent ?? '';
    expect(text).toContain('rejected');
    expect(text).toContain('terrain_unbuildable');
    expect(text.split(/\s+/)).not.toContain('applied');
    expect(rejected?.className.split(/\s+/)).not.toContain('applied');
    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toContain(RATIONALE);
    expect(host.querySelector('[data-state="applied"]')?.textContent).toContain('applied');
  });

  it('hides the HUD panel when W16 is off', () => {
    expect(directorFeature.id).toBe('director');
    expect(directorFeature.wave).toBe('W16');
    expect(directorFeature.hud?.[0]).toMatchObject({ id: 'director-status', slot: 'top-right', order: 20 });
    const el = document.createElement('div');
    const hidden = directorFeature.hud?.[0]?.mount(el, ctx(['W00']));
    expect(el.hidden).toBe(true);
    expect(el.childElementCount).toBe(0);
    hidden?.dispose();
    expect(el.hidden).toBe(true);

    const shown = document.createElement('div');
    const live = directorFeature.hud?.[0]?.mount(shown, ctx(['W16']));
    expect(shown.hidden).toBe(false);
    expect(shown.querySelector('.ta-director__title')?.textContent).toBe('DIRECTOR');
    live?.dispose();
    expect(shown.childElementCount).toBe(0);
  });
});
