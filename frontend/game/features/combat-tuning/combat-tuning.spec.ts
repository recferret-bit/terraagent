// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileData } from '@terra/sim';
import { isGameInputBlocked, resetGameInputBlock } from '../../core/input/gameInputBlock';
import type { FeatureContext } from '../../core/registry/types';
import { CombatTuningPanel } from './CombatTuningPanel';
import { combatTuneTypes, readTuneValue, tuneDesignValue } from './catalog';

const flags = new Set(Array.from({ length: 11 }, (_, i) => `W${String(i).padStart(2, '0')}`));
const data = compileData(flags);
const panels: CombatTuningPanel[] = [];
afterEach(() => { panels.splice(0).forEach(p => p.dispose()); document.body.replaceChildren(); resetGameInputBlock(); });

function mount(devServer = vi.fn().mockResolvedValue({ dataHash: 'new' }), host: 'server' | 'local' = 'server') {
  const el = document.createElement('div'); document.body.append(el);
  const ctx: FeatureContext = { flags, host, services: { track: vi.fn(), devServer, session: { planetId: () => 'pl_test' }, store: { simData: () => data } } };
  const panel = new CombatTuningPanel(el, ctx); panels.push(panel);
  return { el, devServer, panel };
}
const open = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('[data-testid="combat-tuning-toggle"]')!.click();
const field = (el: HTMLElement, path: string) => el.querySelector<HTMLInputElement>(`input[data-path="${path}"]`)!;
async function submit(input: HTMLInputElement, value: string) {
  input.value = value;
  input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(input.disabled).toBe(false));
}

describe('Combat Lab live data and numeric conversion', () => {
  it('uses weapon rows for recon and fauna source rows for insects, with type health', () => {
    const types = combatTuneTypes(data);
    const recon = types.find(t => t.id === 'combatUnits.recon')!;
    expect(recon.fields.map(f => f.path)).toContain('weapons.reconGun.damage');
    expect(recon.fields.map(f => f.path)).not.toContain('combatUnits.recon.damage');
    expect(types.find(t => t.id === 'fauna.blackAnt')!.fields.map(f => f.path)).toContain('fauna.blackAnt.attackIntervalS');
    expect(types.find(t => t.id === 'fauna.hiveBlackAnt')!.fields.map(f => f.path)).toEqual(['fauna.hiveBlackAnt.hp']);
  });

  it('shows design movement speed and limits insect attack intervals to their shared action timing', () => {
    const types = combatTuneTypes(data);
    const speed = types.find(t => t.id === 'combatUnits.recon')!.fields.find(f => f.path.endsWith('.speed'))!;
    expect(readTuneValue(data, speed)).toBeCloseTo(3.5);
    expect(tuneDesignValue(speed, '2')).toBe(2);
    const rate = types.find(t => t.id === 'fauna.blueBeetle')!.fields.find(f => f.path.endsWith('.attackIntervalS'))!;
    expect(readTuneValue(data, rate)).toBe(2);
    expect(tuneDesignValue(rate, '1.2')).toBe(1.2);
    expect(() => tuneDesignValue(rate, '0')).toThrow('must be');
    expect(() => tuneDesignValue(rate, '1.25')).toThrow('steps');
    expect(() => tuneDesignValue(speed, '')).toThrow('must be');
    expect(() => tuneDesignValue(speed, 'Infinity')).toThrow('must be');
  });
});

describe('Combat Lab controls', () => {
  it('opens with F6, blocks gameplay, leaves F8/F9 alone, closes on Escape and disposes', () => {
    const { el, panel } = mount();
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F6' }));
    expect(el.querySelector<HTMLElement>('[role="dialog"]')!.hidden).toBe(false);
    expect(isGameInputBlocked()).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F8' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F9' }));
    expect(el.querySelector<HTMLElement>('[role="dialog"]')!.hidden).toBe(false);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(isGameInputBlocked()).toBe(false);
    open(el); panel.dispose();
    expect(isGameInputBlocked()).toBe(false);
    expect(el.children.length).toBe(0);
  });

  it.each(['server', 'local'] as const)('applies live type health and weapon damage on the %s host', async host => {
    const { el, devServer } = mount(undefined, host); open(el);
    await submit(field(el, 'weapons.reconGun.damage'), '23');
    expect(devServer).toHaveBeenLastCalledWith('tune', { planetId: 'pl_test', op: 'set', path: 'weapons.reconGun.damage', value: 23 });
    await submit(field(el, 'combatUnits.recon.hp'), '420');
    expect(devServer).toHaveBeenLastCalledWith('tune', { planetId: 'pl_test', op: 'set', path: 'combatUnits.recon.hp', value: 420 });
    expect(el.textContent).toContain('Applied maximum health');
  });

  it('rejects invalid input before sending and displays host failure without claiming success', async () => {
    const devServer = vi.fn().mockRejectedValue(new Error('Planet unavailable'));
    const { el } = mount(devServer); open(el);
    const hp = field(el, 'combatUnits.recon.hp');
    await submit(hp, '-1'); expect(devServer).not.toHaveBeenCalled();
    await submit(hp, '300');
    expect(el.textContent).toContain('Not applied: Planet unavailable');
  });

  it('exports the current planet overrides without resetting other tuning', async () => {
    const devServer = vi.fn().mockResolvedValue({ text: '{"weapons":{}}' });
    const { el } = mount(devServer); open(el);
    el.querySelector<HTMLButtonElement>('[data-testid="combat-tuning-export"]')!.click();
    await vi.waitFor(() => expect(el.querySelector('textarea')!.hidden).toBe(false));
    expect(el.querySelector('textarea')!.value).toBe('{"weapons":{}}');
    expect(devServer).toHaveBeenCalledWith('tune', { planetId: 'pl_test', op: 'export' });
  });
});

describe('Combat Lab in the Colony book (launcher section in the pane, dialog in the HUD overlay)', () => {
  function mountWithOverlay() {
    const el = document.createElement('div'); const overlay = document.createElement('div');
    document.body.append(el, overlay);
    const ctx: FeatureContext = { flags, host: 'server', services: { track: vi.fn(), hudOverlay: overlay, session: { planetId: () => 'pl_test' }, store: { simData: () => data } } };
    const panel = new CombatTuningPanel(el, ctx); panels.push(panel);
    return { el, overlay, panel };
  }

  it('keeps the COMBAT F6 launcher as a titled section in the pane and the dialog in the overlay', () => {
    const { el, overlay } = mountWithOverlay();
    const section = el.querySelector('[data-testid="combat-tuning-launcher"]')!;
    expect(section.textContent).toContain('COMBAT LAB');
    expect(section.querySelector('[data-testid="combat-tuning-toggle"]')?.textContent).toBe('COMBAT F6');
    expect(el.querySelector('[role="dialog"]')).toBeNull();
    expect(overlay.querySelector<HTMLElement>('[data-testid="combat-tuning-panel"]')!.hidden).toBe(true);
  });

  it('opens the overlay dialog from the launcher and from F6, and closes it with Escape', () => {
    const { el, overlay } = mountWithOverlay();
    const dialog = overlay.querySelector<HTMLElement>('[role="dialog"]')!;
    open(el);
    expect(dialog.hidden).toBe(false);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(dialog.hidden).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F6' }));
    expect(dialog.hidden).toBe(false);
  });

  it('removes both the launcher and the overlay dialog on dispose', () => {
    const { el, overlay, panel } = mountWithOverlay();
    panel.dispose();
    expect(el.childElementCount).toBe(0);
    expect(overlay.childElementCount).toBe(0);
  });
});
