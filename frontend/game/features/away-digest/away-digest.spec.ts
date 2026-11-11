// @vitest-environment jsdom
import { RESOURCE_KEYS, type AwayDigestV1, type AwayResources, type ResourceKey } from '@terra/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isEscapeBlockedByHudOverlay } from '../../app/online/viewportHelper';
import { loadFeatures, type FeatureContext } from '../../core/registry';
import { AwayDigestModal, resetAwayDismissMemory } from './AwayDigestModal';
import awayDigest from './index';

const COLONY = 'co_01ARZ3NDEKTSV4RRFFQ69G5FAV';

function resources(over: Partial<Record<ResourceKey, { before: number; after: number }>> = {}): AwayResources {
  const out = {} as AwayResources;
  for (const key of RESOURCE_KEYS) out[key] = over[key] ?? { before: 0, after: 0 };
  return out;
}

function digest(over: Partial<AwayDigestV1> = {}): AwayDigestV1 {
  return {
    colonyId: COLONY,
    awayFrom: '2026-11-09T12:00:00.000Z',
    awayTo: '2026-11-09T12:10:00.000Z',
    durationS: 600,
    resources: resources({ 'metals.t1': { before: 10, after: 40 } }),
    energy: { before: 0, after: 0 },
    built: [],
    lost: [],
    robots: { before: 0, after: 0, produced: 0, lost: 0 },
    territory: { before: 0, after: 0 },
    attacks: { count: 2, repelled: 1, byColony: [] },
    hazards: [],
    ai: { decisions: 0, rejected: 0, highlights: [] },
    trades: { settled: 0, items: [] },
    alerts: [{ code: 'under_attack', message: 'Raiders at the east gate' }],
    story: 'The colony held the ridge.',
    ...over,
  };
}

const disposers: Array<() => void> = [];

function mount(store?: FeatureContext['services']['store']): { ctx: FeatureContext; modal: AwayDigestModal } {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const ctx: FeatureContext = { flags: new Set(['W09']), host: 'server', services: {} as FeatureContext['services'] };
  if (store) ctx.services.store = store;
  const panel = awayDigest.hud![0]!.mount(el, ctx);
  disposers.push(() => panel.dispose());
  return { ctx, modal: ctx.services.awayDigest! };
}

beforeEach(() => {
  document.body.replaceChildren();
  resetAwayDismissMemory();
});

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  document.body.replaceChildren();
  resetAwayDismissMemory();
});

describe('while you were away', () => {
  it('shows duration, the metals net, attacks, the alert and the story above the numbers', () => {
    const { modal } = mount();
    const sample = digest();
    modal.showWelcome({ reason: 'join', away: sample });
    const text = document.body.textContent ?? '';
    expect(text).toContain('10 min');
    expect(text).toContain('metals.t1 +30');
    expect(text).toContain('Attacks 2');
    expect(text).toContain('Repelled 1');
    expect(text).toContain('Raiders at the east gate');
    expect(text).toContain('The colony held the ridge.');
    expect(document.querySelector('[data-testid="away-director-trades"]')).toBeNull();
    expect(text.indexOf('The colony held the ridge.')).toBeLessThan(text.indexOf('10 min'));
    expect(text).not.toContain('minerals.t1');
    expect(document.querySelectorAll('[data-testid="away-digest"]')).toHaveLength(1);
    const dismiss = document.querySelector('[data-testid="away-dismiss"]');
    expect(dismiss?.className).toBe('ta-away-dismiss');
    expect(dismiss?.classList.contains('btn')).toBe(false);
    expect(dismiss?.classList.contains('card')).toBe(false);
  });

  it('shows a director trade item on the plate', () => {
    const { modal } = mount();
    modal.show(digest({
      items: [{ kind: 'digest.directorTrade', line: 'Director sold 300 metals to the Guild.' }],
    }));
    const row = document.querySelector('[data-kind="digest.directorTrade"]');
    expect(row?.textContent).toBe('Director sold 300 metals to the Guild.');
    expect(document.querySelector('[data-testid="away-director-trades"]')).not.toBeNull();
  });

  it('shows nothing when the welcome has no away, including a resync and while W09 is off', () => {
    const { modal } = mount();
    expect(document.querySelector('[data-testid="away-digest"]')).toBeNull();
    modal.showWelcome({ reason: 'join' });
    modal.showWelcome({ reason: 'resync', away: digest() });
    expect(document.querySelector('[data-testid="away-digest"]')).toBeNull();
    const off = loadFeatures({ flags: new Set(['W00', 'W08']), host: 'server' });
    const on = loadFeatures({ flags: new Set(['W00', 'W09']), host: 'server' });
    expect(off.some((f) => f.id === 'away-digest')).toBe(false);
    expect(on.some((f) => f.id === 'away-digest')).toBe(true);
    expect(awayDigest).toMatchObject({ id: 'away-digest', wave: 'W09' });
  });

  it('keeps three alerts, omits an empty story, and stays dismissed for the same return', () => {
    const { modal } = mount();
    const sample = digest({
      story: '',
      alerts: ['one', 'two', 'three', 'four'].map((message) => ({ code: 'power_deficit', message })),
    });
    modal.show(sample);
    const lines = [...document.querySelectorAll('[data-testid="away-alerts"] li')].map((li) => li.textContent);
    expect(lines).toEqual(['one', 'two', 'three']);
    expect(document.body.textContent).not.toContain('four');
    expect(document.querySelector('[data-testid="away-story"]')).toBeNull();

    (document.querySelector('[data-testid="away-dismiss"]') as HTMLButtonElement).click();
    expect(document.querySelector('[data-testid="away-digest"]')).toBeNull();
    modal.show(sample);
    modal.showWelcome({ reason: 'join', away: sample });
    expect(document.querySelector('[data-testid="away-digest"]')).toBeNull();

    modal.show(digest({ awayFrom: '2026-11-09T13:00:00.000Z', story: 'A later return.' }));
    expect(document.body.textContent).toContain('A later return.');
  });

  it('Escape dismisses the plate and blocks the pause key while it is open', () => {
    const { modal } = mount();
    modal.show(digest());
    expect(isEscapeBlockedByHudOverlay()).toBe(true);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('[data-testid="away-digest"]')).toBeNull();
    expect(isEscapeBlockedByHudOverlay()).toBe(false);
    modal.show(digest());
    expect(document.querySelector('[data-testid="away-digest"]')).toBeNull();
  });

  it('paints a digest the store already held and replaces it when a new one arrives', () => {
    const heard: { fn: ((d: AwayDigestV1) => void) | null } = { fn: null };
    const { ctx } = mount({
      latestAway: () => digest(),
      onAwayDigest: (fn) => {
        heard.fn = fn;
        return () => { heard.fn = null; };
      },
    });
    expect(document.body.textContent).toContain('metals.t1 +30');
    heard.fn?.(digest({ awayFrom: '2026-11-09T18:00:00.000Z', story: 'Night shift.' }));
    expect(document.body.textContent).toContain('Night shift.');
    expect(document.querySelectorAll('[data-testid="away-digest"]')).toHaveLength(1);
    ctx.services.awayDigest?.dispose();
    expect(document.querySelector('[data-testid="away-digest"]')).toBeNull();
  });
});
