// @vitest-environment jsdom
import { RESOURCE_KEYS, type AwayDigestV1, type AwayResources } from '@terra/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { ClientFlagsStore, resolveClientFlags } from '../../core/flags';
import { loadFeatures } from '../../core/registry';
import type { FeatureServices } from '../../core/registry/types';
import { resetAwayDismissMemory } from '../../features/away-digest/AwayDigestModal';
import { FeatureHud } from './featureHud';

const welcome = (flags: string[]) => resolveClientFlags({ welcomeFlags: flags, search: '', dev: true });
const allFeatureWaves = [
  ...new Set(loadFeatures({ flags: new Set(resolveClientFlags({ search: '', dev: true }).flags.list), host: 'server' }).map((f) => f.wave)),
].sort();
const huds: FeatureHud[] = [];
afterEach(() => { for (const h of huds.splice(0)) h.dispose(); document.body.replaceChildren(); resetAwayDismissMemory(); });

function mount(services: Partial<FeatureServices> = {}) {
  const flags = new ClientFlagsStore(resolveClientFlags({ search: '', dev: true }));
  const hud = new FeatureHud(document.body, flags, 'server', services);
  huds.push(hud);
  return { flags, hud };
}
const panels = () => [...document.querySelectorAll<HTMLElement>('.ta-hud__panel')];

function makeSampleAwayDigest(story: string): AwayDigestV1 {
  const res = {} as AwayResources;
  for (const k of RESOURCE_KEYS) res[k] = { before: 0, after: 0 };
  return {
    colonyId: 'co_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    awayFrom: '2026-11-09T12:00:00.000Z',
    awayTo: '2026-11-09T12:15:00.000Z',
    durationS: 900,
    resources: res,
    energy: { before: 0, after: 0 },
    built: [],
    lost: [],
    robots: { before: 0, after: 0, produced: 0, lost: 0 },
    territory: { before: 0, after: 0 },
    attacks: { count: 0, repelled: 0, byColony: [] },
    hazards: [],
    ai: { decisions: 0, rejected: 0, highlights: [] },
    trades: { settled: 0, items: [] },
    alerts: [],
    story,
  };
}

describe('FeatureHud (FA-29)', () => {
  it('mounts the features once: the first welcome and a reconnect welcome keep the same panels', () => {
    const { flags, hud } = mount();
    const before = panels();
    expect(before.length).toBeGreaterThan(0);
    flags.update(welcome(allFeatureWaves)); // default (all) → server: same enabled features
    flags.update(welcome(allFeatureWaves)); // reconnect
    expect(hud.mounts).toBe(1);
    expect(panels()).toEqual(before); // same elements: an open ghost / brush selection survives
    expect(document.querySelectorAll('.ta-hud')).toHaveLength(1);
  });

  it('re-mounts only when the enabled features change; ctx.flags and flagsSource follow the newest welcome', () => {
    const { flags, hud } = mount();
    const ctx = () => (hud as unknown as { ctx: { flags: ReadonlySet<string>; services: { flagsSource?: string } } }).ctx;
    const first = ctx();
    flags.update(welcome(allFeatureWaves));
    expect(ctx()).toBe(first);
    expect([...first.flags].sort()).toEqual(allFeatureWaves);
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

  it('defers showWelcome while deferInitialMount is active and replays away digest once mounted', () => {
    const flags = new ClientFlagsStore(resolveClientFlags({ search: '', dev: true }));
    const hud = new FeatureHud(document.body, flags, 'server', {}, true);
    huds.push(hud);

    expect(hud.isMounted).toBe(false);
    expect(hud.mounts).toBe(0);

    // Join without away digest & resync with away digest never mount HUD
    hud.showWelcome({ reason: 'join' });
    expect(hud.mounts).toBe(0);

    const sampleAway = makeSampleAwayDigest('Deferred welcome story.');

    hud.showWelcome({ reason: 'resync', away: sampleAway });
    expect(hud.mounts).toBe(0);

    // Join WITH away digest while deferred queues it without mounting on the welcome frame
    hud.showWelcome({ reason: 'join', away: sampleAway });
    expect(hud.mounts).toBe(0);
    expect(document.querySelector('[data-testid="away-digest"]')).toBeNull();

    // Scheduled idle mount replays the queued away digest cleanly
    hud.ensureMounted();
    expect(hud.mounts).toBe(1);
    expect(document.querySelector('[data-testid="away-digest"]')?.textContent).toContain('Deferred welcome story.');
  });
});

describe('FeatureHud startup collapse', () => {
  it('collapseCommandDock closes tabs and open dialogs while keeping an active "While You Were Away" notification', () => {
    const { hud } = mount();
    hud.showWelcome({
      reason: 'join',
      away: makeSampleAwayDigest('Colony kept mining while away.'),
    });
    const svc = hud.activeServices;
    svc?.openPilotDialog?.(true);
    document.querySelector<HTMLButtonElement>('[data-testid="colony-tab-director"]')?.click();
    expect(document.querySelector('[data-testid="colony-book"]')?.getAttribute('data-collapsed')).toBe('false');
    expect(document.querySelector('[data-testid="away-digest"]')).not.toBeNull();

    hud.collapseCommandDock();

    expect(document.querySelector('[data-testid="command-dock"]')?.getAttribute('data-collapsed')).toBe('true');
    expect(document.querySelector('[data-testid="colony-book"]')?.getAttribute('data-collapsed')).toBe('true');
    expect(document.querySelector<HTMLElement>('[data-testid="pilot-dialog"]')?.hidden).toBe(true);
    expect(document.querySelector('[data-testid="away-digest"]')).not.toBeNull();
  });
});
