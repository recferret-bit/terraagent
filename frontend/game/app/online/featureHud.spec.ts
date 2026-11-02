// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { ClientFlagsStore, resolveClientFlags } from '../../core/flags';
import type { FeatureServices } from '../../core/registry/types';
import { FeatureHud } from './featureHud';

const welcome = (flags: string[]) => resolveClientFlags({ welcomeFlags: flags, search: '', dev: true });
const huds: FeatureHud[] = [];
afterEach(() => { for (const h of huds.splice(0)) h.dispose(); document.body.replaceChildren(); });

function mount(services: Partial<FeatureServices> = {}) {
  const flags = new ClientFlagsStore(resolveClientFlags({ search: '', dev: true }));
  const hud = new FeatureHud(document.body, flags, 'server', services);
  huds.push(hud);
  return { flags, hud };
}
const panels = () => [...document.querySelectorAll<HTMLElement>('.ta-hud__panel')];

describe('FeatureHud (FA-29)', () => {
  it('mounts the features once: the first welcome and a reconnect welcome keep the same panels', () => {
    const { flags, hud } = mount();
    const before = panels();
    expect(before.length).toBeGreaterThan(0);
    flags.update(welcome(['W00', 'W01'])); // default (all) → server: same enabled features
    flags.update(welcome(['W00', 'W01'])); // reconnect
    expect(hud.mounts).toBe(1);
    expect(panels()).toEqual(before); // same elements: an open ghost / brush selection survives
    expect(document.querySelectorAll('.ta-hud')).toHaveLength(1);
  });

  it('re-mounts only when the enabled features change; ctx.flags and flagsSource follow the newest welcome', () => {
    const { flags, hud } = mount();
    const ctx = () => (hud as unknown as { ctx: { flags: ReadonlySet<string>; services: { flagsSource?: string } } }).ctx;
    const first = ctx();
    flags.update(welcome(['W00', 'W01']));
    expect(ctx()).toBe(first);
    expect([...first.flags].sort()).toEqual(['W00', 'W01']);
    expect(first.services.flagsSource).toBe('welcome');
    flags.update(welcome(['W00'])); // W01 features switched off
    expect(hud.mounts).toBe(2);
    expect(panels().some((p) => p.dataset.feature === 'hud-min')).toBe(false);
    expect([...ctx().flags]).toEqual(['W00']);
  });

  it('service getters stay live (colonyId, hexTerrain are read on use, not copied at mount)', () => {
    let colony = 0;
    const services: Partial<FeatureServices> = {};
    Object.defineProperty(services, 'colonyId', { get: () => colony, enumerable: true });
    const { hud } = mount(services);
    const ctx = (hud as unknown as { ctx: { services: FeatureServices & { colonyId?: number; flagsSource?: string } } }).ctx;
    expect(ctx.services.colonyId).toBe(0);
    colony = 3;
    expect(ctx.services.colonyId).toBe(3);
    expect(ctx.services.flagsSource).toBe('default');
  });
});
