// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FeatureContext } from '../../../core/registry/types';
import { ALERT_PING_DURATION_MS, mountCombatFeature } from '../index';

/** HUD services of the Colony book (HudRoot): overlay layer + spine badge. */
function makeContext(withHud = true) {
  const overlay = document.createElement('div');
  overlay.className = 'ta-hud__overlay';
  const setHudTabBadge = vi.fn();
  const services: FeatureContext['services'] = { track: () => undefined, ...(withHud ? { hudOverlay: overlay, setHudTabBadge } : {}) };
  const ctx: FeatureContext = { flags: new Set(['W07']), host: 'local', services };
  return { ctx, overlay, setHudTabBadge };
}

function mount(withHud = true) {
  const el = document.createElement('div');
  document.body.append(el);
  const env = makeContext(withHud);
  document.body.append(env.overlay);
  let now = 1_000;
  const inst = mountCombatFeature(el, env.ctx, { now: () => now });
  inst.hud.setFocusTile(0, 0);
  return { el, ...env, inst, advance: (ms: number) => { now += ms; } };
}

afterEach(() => document.body.replaceChildren());

describe('Combat alerts in the Colony book (overlay, spine badge, empty state)', () => {
  it('mounts the edge-ping layer in the HUD overlay, not in the (clipped, hideable) tab pane', () => {
    const { el, overlay, inst } = mount();
    expect(overlay.contains(inst.hud.edgeContainerEl)).toBe(true);
    expect(el.contains(inst.hud.edgeContainerEl)).toBe(false);
    inst.hud.pushUnderAttackPing({ q: 40, r: -30 });
    expect(overlay.querySelector('[data-testid=under-attack-ping]')).not.toBeNull();
    expect(el.querySelector('[data-testid=under-attack-ping]')).toBeNull();
    inst.dispose();
  });

  it('falls back to its own element when the HUD gives no overlay (unit mounts, legacy slots)', () => {
    const { el, inst, setHudTabBadge } = mount(false);
    expect(el.contains(inst.hud.edgeContainerEl)).toBe(true);
    inst.hud.pushUnderAttackPing({ q: 40, r: -30 });
    expect(el.querySelector('[data-testid=under-attack-ping]')).not.toBeNull();
    expect(setHudTabBadge).not.toHaveBeenCalled();
    inst.dispose();
    expect(el.childElementCount).toBe(0);
  });

  it('removes the overlay layer on dispose and clears the badge first', () => {
    const { overlay, inst, setHudTabBadge } = mount();
    inst.hud.pushUnderAttackPing({ q: 40, r: -30 });
    inst.dispose();
    expect(overlay.childElementCount).toBe(0);
    expect(setHudTabBadge).toHaveBeenLastCalledWith(inst.hud.el, null);
  });

  it('badges the Combat spine with the live alert count (on-screen pings included) and clears it on expiry', () => {
    const { inst, setHudTabBadge, advance } = mount();
    inst.hud.pushUnderAttackPing({ q: 40, r: -30 });
    expect(setHudTabBadge).toHaveBeenLastCalledWith(inst.hud.el, 1);
    inst.hud.pushUnderAttackPing({ q: 1, r: 0, kind: 'raidStarted' }); // on screen: no edge ping, still an alert
    expect(inst.hud.getActivePings()[1]?.edge).toBeNull();
    expect(setHudTabBadge).toHaveBeenLastCalledWith(inst.hud.el, 2);
    advance(ALERT_PING_DURATION_MS - 1);
    inst.update({} as never);
    expect(setHudTabBadge).toHaveBeenLastCalledWith(inst.hud.el, 2);
    advance(1); // boundary: expiresAtMs <= now prunes
    inst.update({} as never);
    expect(setHudTabBadge).toHaveBeenLastCalledWith(inst.hud.el, null);
    inst.dispose();
  });

  it('never badges for another colony\'s alert (negative)', () => {
    const { inst, setHudTabBadge } = mount();
    expect(inst.hud.pushUnderAttackPing({ q: 40, r: -30, colonyIndex: 3 })).toBeNull();
    expect(setHudTabBadge.mock.calls.every(([, value]) => value === null)).toBe(true);
    inst.dispose();
  });

  it('shows the "No threats" line until the first combat log entry, then hides it', () => {
    const { el, inst } = mount();
    const empty = el.querySelector<HTMLElement>('[data-testid=combat-empty]')!;
    expect(empty.hidden).toBe(false);
    expect(empty.textContent).toMatch(/No threats/);
    inst.hud.triggerEvent({ kind: 'raidRepelled', data: { unbreached: true } });
    expect(empty.hidden).toBe(true);
    expect(el.querySelector('[data-testid=combat-log]')?.getAttribute('data-empty')).toBe('false');
    inst.dispose();
  });
});
