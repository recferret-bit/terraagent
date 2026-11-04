// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { FeatureContext } from '../../core/registry/types';
import { DirectorControls } from './DirectorControls';
import { DirectorPanel } from './DirectorPanel';
import directorFeature from './index';

function ctx(flags: readonly string[]): FeatureContext {
  return { flags: new Set(flags), host: 'local', services: {} };
}

describe('W16-45 director UI flow', () => {
  it('covers both risk profiles and does not grant away raids', () => {
    const host = document.createElement('div');
    const controls = new DirectorControls(host);
    const risk = host.querySelector<HTMLSelectElement>('select[name="risk"]');
    risk!.value = 'conservative';
    expect(controls.read().risk).toBe('conservative');
    risk!.value = 'risky';
    const args = controls.read();
    expect(args.risk).toBe('risky');
    expect(JSON.stringify(args)).not.toContain('awayRaids');
  });

  it('keeps a manual cancel rejected and hides the panel when W16 is off', () => {
    const host = document.createElement('div');
    const panel = new DirectorPanel(host);
    panel.render([{ actionId: 'cancel-manual', state: 'rejected', reason: 'locked_goal' }]);
    expect(host.querySelector('[data-state="rejected"]')?.textContent).toContain('rejected');
    expect(host.textContent).not.toContain('applied');

    const mount = document.createElement('div');
    const hud = directorFeature.hud?.[0];
    const hidden = hud?.mount(mount, ctx(['W00']));
    expect(mount.hidden).toBe(true);
    hidden?.dispose();
  });
});
