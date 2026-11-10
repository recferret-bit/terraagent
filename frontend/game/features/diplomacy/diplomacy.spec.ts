// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { FeatureContext } from '../../core/registry/types';
import { installMockDocument } from '../test-dom';
import {
  createDiplomacyPanel,
  extractDiplomacyColonyView,
  applyDiplomacySimEvent,
  formatCountdownSeconds,
  formatTickRemaining,
  mountDiplomacyHud,
  diplomacyFeature,
  type DiplomacyColonyView,
} from './index';

function testCtx(flags: readonly string[], extraServices: Record<string, unknown> = {}): FeatureContext {
  return {
    flags: new Set(flags),
    host: 'server',
    services: {
      track: () => {},
      ...extraServices,
    },
  };
}

describe('Diplomacy formatting helpers and view extraction', () => {
  it('formats countdown seconds across boundary intervals (0s, 59s, 600s, 86400s)', () => {
    expect(formatCountdownSeconds(0)).toBe('00:00');
    expect(formatCountdownSeconds(-5)).toBe('00:00');
    expect(formatCountdownSeconds(59)).toBe('00:59');
    expect(formatCountdownSeconds(600)).toBe('10:00');
    expect(formatCountdownSeconds(3599)).toBe('59:59');
    expect(formatCountdownSeconds(3600)).toBe('01:00:00');
    expect(formatCountdownSeconds(86400)).toBe('24:00:00');
    expect(formatTickRemaining(3000, 0)).toBe('10:00');
  });

  it('extracts incoming and outgoing offers, active truces, and contacts from colony snapshot', () => {
    const snapshot = {
      tick: 100,
      colonies: [
        {
          index: 0,
          id: 'col_0',
          diplomacy: {
            incomingOffers: [
              { offerId: 'off_1', fromColony: 1, toColony: 0, hours: 6, expiresAtTick: 3100, status: 'pending' },
            ],
            truces: [
              { truceId: 'tr_1', colonyA: 0, colonyB: 2, hours: 24, signedAtTick: 50, expiresAtTick: 10000, status: 'active' },
            ],
            contacts: [1, 2],
            oathbreakerUntil: 500,
          },
        },
      ],
    };

    const view = extractDiplomacyColonyView(snapshot, 0, 100);
    expect(view.colonyIndex).toBe(0);
    expect(view.currentTick).toBe(100);
    expect(view.incomingOffers.length).toBe(1);
    expect(view.incomingOffers[0].offerId).toBe('off_1');
    expect(view.truces.length).toBe(1);
    expect(view.truces[0].partnerColony).toBe(2);
    expect(view.oathbreakerUntil).toBe(500);
    expect(view.contacts).toEqual([1, 2]);
  });

  it('filters out expired offers, ended truces, and expired oathbreaker status', () => {
    const snapshot = {
      tick: 1000,
      colonies: [
        {
          index: 0,
          diplomacy: {
            incomingOffers: [
              { offerId: 'off_exp', fromColony: 1, toColony: 0, hours: 2, expiresAtTick: 900, status: 'pending' },
            ],
            truces: [
              { truceId: 'tr_ended', colonyA: 0, colonyB: 1, hours: 6, signedAtTick: 0, expiresAtTick: 5000, status: 'ended' },
              { truceId: 'tr_expired', colonyA: 0, colonyB: 2, hours: 2, signedAtTick: 0, expiresAtTick: 800, status: 'active' },
            ],
            oathbreakerUntil: 999,
          },
        },
      ],
    };

    const view = extractDiplomacyColonyView(snapshot, 0, 1000);
    expect(view.incomingOffers.length).toBe(0);
    expect(view.truces.length).toBe(0);
    expect(view.oathbreakerUntil).toBeNull();
  });
});

describe('Diplomacy sim event application', () => {
  const baseView: DiplomacyColonyView = {
    colonyIndex: 0,
    currentTick: 100,
    oathbreakerUntil: null,
    incomingOffers: [],
    outgoingOffers: [],
    truces: [],
    contacts: [1],
  };

  it('applies truceOffered, truceSigned, truceNotice and truceEnded events', () => {
    const v1 = applyDiplomacySimEvent(baseView, {
      kind: 'truceOffered',
      data: { offerId: 'off_alpha', fromColony: 1, toColony: 0, hours: 6, expiresAtTick: 3100 },
    });
    expect(v1.incomingOffers.length).toBe(1);
    expect(v1.incomingOffers[0].offerId).toBe('off_alpha');

    const v2 = applyDiplomacySimEvent(v1, {
      kind: 'truceSigned',
      data: { truceId: 'tr_alpha', offerId: 'off_alpha', colonyA: 1, colonyB: 0, hours: 6, expiresAtTick: 108100 },
    });
    expect(v2.incomingOffers.length).toBe(0);
    expect(v2.truces.length).toBe(1);
    expect(v2.truces[0].truceId).toBe('tr_alpha');
    expect(v2.truces[0].partnerColony).toBe(1);

    const v3 = applyDiplomacySimEvent(v2, {
      kind: 'truceNotice',
      data: { truceId: 'tr_alpha', cancelledBy: 0, noticeEndsAtTick: 3100 },
    });
    expect(v3.truces[0].status).toBe('notice');
    expect(v3.truces[0].noticeEndsAtTick).toBe(3100);
    expect(v3.oathbreakerUntil).toBeGreaterThan(3100);

    const v4 = applyDiplomacySimEvent(v3, {
      kind: 'truceEnded',
      data: { truceId: 'tr_alpha', reason: 'cancelled', cancelledBy: 0, oathbreakerUntilTick: 50000 },
    });
    expect(v4.truces.length).toBe(0);
    expect(v4.oathbreakerUntil).toBe(50000);
  });
});

describe('DiplomacyPanel offer banner', () => {
  let restoreDom: () => void;
  beforeEach(() => {
    restoreDom = installMockDocument();
  });
  afterEach(() => {
    restoreDom?.();
  });

  it('renders incoming offer banner, accept sends respondTruce, decline sends respondTruce', () => {
    const onRespondTruce = vi.fn();
    const host = document.createElement('div');
    const panel = createDiplomacyPanel(host, { ownColonyIndex: 0, actions: { onRespondTruce } });

    const bannerBefore = host.querySelector<HTMLElement>('[data-testid="diplomacy-offer-banner"]');
    expect(bannerBefore?.hidden).toBe(true);

    panel.update({
      tick: 200,
      colonies: [{
        index: 0,
        diplomacy: {
          incomingOffers: [
            { offerId: 'off_10', fromColony: 2, toColony: 0, hours: 24, expiresAtTick: 3200, status: 'pending' },
          ],
        },
      }],
    });

    const banner = host.querySelector<HTMLElement>('[data-testid="diplomacy-offer-banner"]');
    expect(banner?.hidden).toBe(false);
    expect(host.querySelector<HTMLElement>('[data-testid="offer-countdown"]')?.textContent).toBe('10:00');

    const acceptBtn = host.querySelector<HTMLButtonElement>('[data-action="accept-truce"]');
    acceptBtn?.click();
    expect(onRespondTruce).toHaveBeenCalledWith('off_10', true);

    const declineBtn = host.querySelector<HTMLButtonElement>('[data-action="decline-truce"]');
    declineBtn?.click();
    expect(onRespondTruce).toHaveBeenCalledWith('off_10', false);

    panel.dispose();
  });
});

describe('DiplomacyPanel active truces', () => {
  let restoreDom: () => void;
  beforeEach(() => {
    restoreDom = installMockDocument();
  });
  afterEach(() => {
    restoreDom?.();
  });

  it('renders active truce badge with timer and cancel, disables cancel when notice', () => {
    const onCancelTruce = vi.fn();
    const host = document.createElement('div');
    const panel = createDiplomacyPanel(host, { ownColonyIndex: 0, actions: { onCancelTruce } });

    panel.update({
      tick: 500,
      colonies: [{
        index: 0,
        diplomacy: {
          truces: [
            { truceId: 'tr_55', colonyA: 0, colonyB: 3, hours: 6, signedAtTick: 500, expiresAtTick: 11300, status: 'active' },
          ],
        },
      }],
    });

    const badge = host.querySelector<HTMLElement>('[data-testid="diplomacy-truce-badge"]');
    expect(badge?.getAttribute('data-status')).toBe('active');

    const cancelBtn = host.querySelector<HTMLButtonElement>('[data-action="cancel-truce"]');
    expect(cancelBtn?.disabled).toBe(false);
    cancelBtn?.click();
    expect(onCancelTruce).toHaveBeenCalledWith('tr_55');

    panel.update({
      tick: 600,
      colonies: [{
        index: 0,
        diplomacy: {
          truces: [
            { truceId: 'tr_55', colonyA: 0, colonyB: 3, hours: 6, signedAtTick: 500, expiresAtTick: 11300, status: 'notice', noticeEndsAtTick: 3600 },
          ],
        },
      }],
    });

    expect(host.querySelector<HTMLElement>('[data-testid="truce-timer"]')?.textContent).toContain('Notice:');
    expect(host.querySelector<HTMLButtonElement>('[data-action="cancel-truce"]')?.disabled).toBe(true);

    panel.dispose();
  });
});

describe('DiplomacyPanel propose truce and oathbreaker', () => {
  let restoreDom: () => void;
  beforeEach(() => {
    restoreDom = installMockDocument();
  });
  afterEach(() => {
    restoreDom?.();
  });

  it('proposes truce with target colony and selected duration hours, disabled when oathbreaker', () => {
    const onProposeTruce = vi.fn();
    const host = document.createElement('div');
    const panel = createDiplomacyPanel(host, { ownColonyIndex: 0, actions: { onProposeTruce } });

    panel.update({
      tick: 100,
      colonies: [{ index: 0, diplomacy: { contacts: [2, 3] } }],
    });

    const chip24 = host.querySelector<HTMLButtonElement>('[data-testid="duration-chip-24h"]');
    chip24?.click();

    const proposeBtn = host.querySelector<HTMLButtonElement>('[data-action="propose-truce"]');
    expect(proposeBtn?.disabled).toBe(false);
    proposeBtn?.click();
    expect(onProposeTruce).toHaveBeenCalledWith(2, 24);

    panel.update({
      tick: 100,
      colonies: [{ index: 0, diplomacy: { contacts: [2, 3], oathbreakerUntil: 5000 } }],
    });

    const oathbreaker = host.querySelector<HTMLElement>('[data-testid="diplomacy-oathbreaker"]');
    expect(oathbreaker?.hidden).toBe(false);
    expect(oathbreaker?.textContent).toContain('OATHBREAKER');
    expect(host.querySelector<HTMLButtonElement>('[data-action="propose-truce"]')?.disabled).toBe(true);

    panel.dispose();
  });
});

describe('Diplomacy HUD mounting and wave gating', () => {
  let restoreDom: () => void;
  beforeEach(() => {
    restoreDom = installMockDocument();
  });
  afterEach(() => {
    restoreDom?.();
  });

  it('hides the HUD panel when W18 wave flag is missing', () => {
    const el = document.createElement('div');
    const inst = mountDiplomacyHud(el, testCtx(['W17']));
    expect(el.hidden).toBe(true);
    inst.dispose();
  });

  it('mounts the HUD panel when W18 wave flag is enabled', () => {
    const el = document.createElement('div');
    const sendCommand = vi.fn();
    const inst = mountDiplomacyHud(el, testCtx(['W18'], { sendCommand }));
    expect(el.hidden).toBe(false);
    expect(el.querySelector<HTMLElement>('[data-testid="diplomacy-panel"]')).not.toBeNull();
    inst.dispose();
  });

  it('has devCommands registered for offerTruce and dev.offerTruce', () => {
    expect(diplomacyFeature.id).toBe('diplomacy');
    expect(diplomacyFeature.wave).toBe('W18');
    const names = diplomacyFeature.devCommands?.map((c) => c.name) ?? [];
    expect(names).toContain('offerTruce');
    expect(names).toContain('dev.offerTruce');
  });
});
