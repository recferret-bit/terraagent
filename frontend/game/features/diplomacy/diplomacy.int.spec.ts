// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import type { FeatureContext } from '../../core/registry/types';
import { installMockDocument } from '../test-dom';
import {
  mountDiplomacyHud,
  diplomacyFeature,
} from './index';

interface MockStore {
  latest?: any;
  onView(fn: (v: any) => void): () => void;
  onServerEvents(fn: (evs: readonly any[]) => void): () => void;
  sendCommand(kind: string, args: unknown): void;
}

function createHarness(flags = ['W18'], ownColony = 0) {
  const sentCommands: Array<{ kind: string; args: unknown }> = [];
  let viewListener: ((v: any) => void) | null = null;
  let serverEventsListener: ((evs: readonly any[]) => void) | null = null;

  const store: MockStore = {
    latest: {
      tick: 100,
      colonies: [
        {
          index: ownColony,
          id: `col_${ownColony}`,
          diplomacy: { contacts: [1, 2], incomingOffers: [], truces: [] },
        },
      ],
    },
    onView(fn) {
      viewListener = fn;
      return () => { viewListener = null; };
    },
    onServerEvents(fn) {
      serverEventsListener = fn;
      return () => { serverEventsListener = null; };
    },
    sendCommand(kind, args: unknown) {
      sentCommands.push({ kind, args });
    },
  };

  const ctx: FeatureContext = {
    flags: new Set(flags),
    host: 'server',
    services: {
      track: () => {},
      store: store as any,
      sendCommand: async (kind: string, args: unknown) => {
        store.sendCommand(kind, args);
        return { ok: true } as any;
      },
      colonyId: ownColony,
    },
  };

  const container = document.createElement('div');
  const instance = mountDiplomacyHud(container, ctx);

  return {
    container,
    instance,
    ctx,
    sentCommands,
    pushView: (v: any) => viewListener?.(v),
    emitEvents: (evs: readonly any[]) => serverEventsListener?.(evs),
  };
}

describe('W18-20 Acceptance: offerTruce to active badge flow', () => {
  let restoreDom: () => void;
  beforeEach(() => {
    restoreDom = installMockDocument();
  });
  afterEach(() => {
    restoreDom?.();
  });

  it('dev.offerTruce -> banner -> click Accept -> truce badge shows', () => {
    const { container, ctx, sentCommands, emitEvents, instance } = createHarness();

    const devCmd = diplomacyFeature.devCommands?.find((c) => c.name === 'dev.offerTruce');
    expect(devCmd).toBeDefined();
    devCmd?.run(['1', '6'], ctx);

    expect(sentCommands).toContainEqual({
      kind: 'dev.offerTruce',
      args: { fromColony: 1, toColony: 0, durationHours: 6 },
    });

    emitEvents([{
      kind: 'truceOffered',
      data: { offerId: 'off_accepted', fromColony: 1, toColony: 0, hours: 6, offeredAtTick: 100, expiresAtTick: 3100 },
    }]);

    const banner = container.querySelector<HTMLElement>('[data-testid="diplomacy-offer-banner"]');
    expect(banner?.hidden).toBe(false);

    const acceptBtn = container.querySelector<HTMLButtonElement>('[data-action="accept-truce"]');
    acceptBtn?.click();

    expect(sentCommands).toContainEqual({
      kind: 'diplomacy.respondTruce',
      args: { offerId: 'off_accepted', accept: true },
    });

    emitEvents([{
      kind: 'truceSigned',
      data: { truceId: 'tr_active_1', offerId: 'off_accepted', colonyA: 1, colonyB: 0, hours: 6, signedAtTick: 110, expiresAtTick: 108110 },
    }]);

    expect(banner?.hidden).toBe(true);

    const truceBadge = container.querySelector<HTMLElement>('[data-testid="diplomacy-truce-badge"]');
    expect(truceBadge).not.toBeNull();
    expect(truceBadge?.getAttribute('data-status')).toBe('active');
    expect(truceBadge?.getAttribute('data-truce-id')).toBe('tr_active_1');

    instance.dispose();
  });

  it('declining an incoming truce offer dispatches respondTruce with accept: false', () => {
    const { container, sentCommands, emitEvents, instance } = createHarness();

    emitEvents([{
      kind: 'truceOffered',
      data: { offerId: 'off_declined', fromColony: 2, toColony: 0, hours: 24, offeredAtTick: 100, expiresAtTick: 3100 },
    }]);

    const declineBtn = container.querySelector<HTMLButtonElement>('[data-action="decline-truce"]');
    declineBtn?.click();

    expect(sentCommands).toContainEqual({
      kind: 'diplomacy.respondTruce',
      args: { offerId: 'off_declined', accept: false },
    });

    instance.dispose();
  });
});

describe('W18-20 Decline, cancel, notice and end flows', () => {
  let restoreDom: () => void;
  beforeEach(() => {
    restoreDom = installMockDocument();
  });
  afterEach(() => {
    restoreDom?.();
  });

  it('cancelling an active truce enters notice countdown and marks Oathbreaker upon ending', () => {
    const { container, sentCommands, emitEvents, instance } = createHarness();

    emitEvents([{
      kind: 'truceSigned',
      data: { truceId: 'tr_to_cancel', colonyA: 0, colonyB: 1, hours: 6, signedAtTick: 100, expiresAtTick: 108100 },
    }]);

    const cancelBtn = container.querySelector<HTMLButtonElement>('[data-action="cancel-truce"]');
    expect(cancelBtn?.disabled).toBe(false);
    cancelBtn?.click();

    expect(sentCommands).toContainEqual({
      kind: 'diplomacy.cancelTruce',
      args: { truceId: 'tr_to_cancel' },
    });

    emitEvents([{
      kind: 'truceNotice',
      data: { truceId: 'tr_to_cancel', cancelledBy: 0, noticeEndsAtTick: 3100 },
    }]);

    const badgeNotice = container.querySelector<HTMLElement>('[data-testid="diplomacy-truce-badge"]');
    expect(badgeNotice?.getAttribute('data-status')).toBe('notice');
    expect(container.querySelector<HTMLElement>('[data-testid="truce-timer"]')?.textContent).toContain('Notice:');
    expect(container.querySelector<HTMLButtonElement>('[data-action="cancel-truce"]')?.disabled).toBe(true);

    emitEvents([{
      kind: 'truceEnded',
      data: { truceId: 'tr_to_cancel', reason: 'cancelled', cancelledBy: 0, oathbreakerUntilTick: 435100 },
    }]);

    expect(container.querySelector('[data-testid="diplomacy-truce-badge"]')).toBeNull();
    const oathbreaker = container.querySelector<HTMLElement>('[data-testid="diplomacy-oathbreaker"]');
    expect(oathbreaker?.hidden).toBe(false);
    expect(oathbreaker?.textContent).toContain('OATHBREAKER');

    instance.dispose();
  });
});

describe('W18-20 Propose and wave gating flows', () => {
  let restoreDom: () => void;
  beforeEach(() => {
    restoreDom = installMockDocument();
  });
  afterEach(() => {
    restoreDom?.();
  });

  it('proposes a truce by selecting target colony and hours', () => {
    const { container, sentCommands, instance } = createHarness();

    const chip72 = container.querySelector<HTMLButtonElement>('[data-testid="duration-chip-72h"]');
    chip72?.click();

    const proposeBtn = container.querySelector<HTMLButtonElement>('[data-action="propose-truce"]');
    proposeBtn?.click();

    expect(sentCommands).toContainEqual({
      kind: 'diplomacy.proposeTruce',
      args: { targetColonyId: 1, hours: 72 },
    });

    instance.dispose();
  });

  it('hides HUD panel and disallows interactions when W18 wave flag is disabled', () => {
    const { container, instance } = createHarness(['W17']);
    expect(container.hidden).toBe(true);
    instance.dispose();
  });
});
