// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { ClientView } from '../../store/replica/viewCodec';
import { mountMinimalHud } from './index';

function freshBody(): HTMLElement {
  document.body.replaceChildren();
  return document.body;
}

describe('Env panel wind row', () => {
  it('shows `Wind HIGH 150%` on its own row, hidden without a wind factor or with W02 off, never in the header', () => {
    const parent = freshBody();
    const flags = new Set(['W00', 'W01', 'W02', 'W05']);
    const mounted = mountMinimalHud({ el: parent, ownerColonyIndex: 0, flags });
    const wind = parent.querySelector<HTMLElement>('[data-testid="hud-wind"]')!;
    expect(mounted.hud.el.querySelector('[data-testid="hud-wind"]')).toBeNull();
    expect(wind.hidden).toBe(true);
    const view = (w: number) => ({ tick: 1, colonies: [{ index: 0, power: { phase: 'day', clockText: '18:45', daylight: 0, windFactor: w } }] }) as unknown as ClientView;
    mounted.update(view(1.5));
    expect(wind.hidden).toBe(false);
    expect(wind.textContent).toBe('Wind HIGH 150%');
    mounted.update(view(0.4));
    expect(wind.textContent).toBe('Wind LOW 40%');
    mounted.update(view(1));
    expect(wind.textContent).toBe('Wind MED 100%');
    flags.delete('W02');
    mounted.update(view(1.5));
    expect(wind.hidden).toBe(true);
    expect(parent.querySelector<HTMLElement>('[data-testid="hud-env"]')!.hidden).toBe(false); // Terraform (W05) row still on
    mounted.dispose();
  });

  it('attachEnvPanel moves the panel into another container (the slot under the minimap)', () => {
    const parent = freshBody();
    const slot = document.createElement('div');
    parent.appendChild(slot);
    const mounted = mountMinimalHud({ el: parent, ownerColonyIndex: 0 });
    mounted.hud.attachEnvPanel(slot);
    expect(slot.querySelector('[data-testid="hud-env"]')).not.toBeNull();
    expect(slot.querySelector('[data-testid="hud-terraform"]')).not.toBeNull();
    mounted.dispose();
    expect(document.querySelector('[data-testid="hud-env"]')).toBeNull();
  });
});
