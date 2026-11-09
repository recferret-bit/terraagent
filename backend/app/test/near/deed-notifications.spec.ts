// @vitest-environment jsdom
import type { DeedUpdatedPayload } from '@terra/contracts';
import { describe, expect, it, vi } from 'vitest';
import { DeedToastHost } from '../../../../frontend/game/features/deed/deedNotifications.js';
import { FlagsService } from '../../src/flags/flags.service.js';
import { DeedDebounceService } from '../../src/near/deed/deed-debounce.service.js';
import { DeedMintOutboxService } from '../../src/near/deed/deed-mint-outbox.service.js';
import { DeedProjectorService } from '../../src/near/deed/deed-projector.service.js';
import { DeedSettledService } from '../../src/near/deed/deed-settled.service.js';
import { DeedRepository } from '../../src/near/deed/deed.repository.js';
import type { NotifierPort } from '../../src/ports/notifier.port.js';

function makeDeedUpdatedPayload(overrides: Partial<DeedUpdatedPayload> = {}): DeedUpdatedPayload {
  const metadata = {
    planet: 'planet_w20',
    colony: 'col_0',
    colonyName: 'Aegis Spire',
    planetType: 'temperate' as const,
    stage: 4,
    terraformBp: 4000,
    status: 'active' as const,
    settled: false,
    version: 2,
    imageUrl: '/v1/near/deed/deed%3Acol_0/image.png?v=2',
  };
  return {
    colonyId: 'col_0',
    planetId: 'planet_w20',
    tokenId: 'deed:col_0',
    version: 2,
    change: 'Terraform 40 %',
    metadata,
    deed: {
      colonyId: 'col_0',
      planetId: 'planet_w20',
      tokenId: 'deed:col_0',
      accountId: 'planet_w20-col_0.terraagent.mock',
      contract: 'deeds.terraagent.mock',
      metadata,
      version: 2,
      status: 'active',
      settled: false,
      pendingState: 'FINAL',
      pendingRetries: 0,
      accountClaimed: false,
      claimedByAccountId: null,
      lastUpdateTx: 'mock:tx1',
      explorerUrl: '/dev/chain/?tab=deeds&tokenId=deed%3Acol_0',
      shareUrl: '/deed/deed%3Acol_0',
      imageUrl: metadata.imageUrl,
      history: [],
    },
    ...overrides,
  };
}

function buildSettledHarness(waves: string, notifier: NotifierPort) {
  const flags = new FlagsService({ TA_WAVES: waves });
  const deeds = new DeedRepository();
  const mint = new DeedMintOutboxService(flags, deeds);
  const proj = new DeedProjectorService(flags, deeds);
  const deb = new DeedDebounceService(flags, deeds, proj, mint);
  const settled = new DeedSettledService(
    flags,
    deeds,
    proj,
    deb,
    mint,
    undefined,
    undefined,
    undefined,
    notifier,
  );
  deb.onModuleInit();
  return { mint, proj, settled };
}

describe('W20-25 DeedToastHost (unit)', () => {
  it('shows "Your Deed was updated: Terraform 40 %" once per update and deduplicates duplicate pushes', () => {
    const hostEl = document.createElement('div');
    let emitDeedUpdated: ((p: DeedUpdatedPayload) => void) | null = null;
    let emitServerEvents:
      | ((events: ReadonlyArray<{ kind: string; data?: Record<string, unknown> }>) => void)
      | null = null;

    const toastHost = new DeedToastHost(hostEl, {
      onDeedUpdated: (fn) => {
        emitDeedUpdated = fn;
        return () => {
          emitDeedUpdated = null;
        };
      },
      onServerEvents: (fn) => {
        emitServerEvents = fn;
        return () => {
          emitServerEvents = null;
        };
      },
    });

    emitDeedUpdated!(makeDeedUpdatedPayload({ change: 'Terraform 40 %', version: 2 }));
    expect(hostEl.hidden).toBe(false);
    expect(hostEl.querySelector('[data-testid="deed-toast"]')?.textContent).toContain(
      'Your Deed was updated: Terraform 40 %',
    );

    toastHost.dismiss();
    expect(hostEl.hidden).toBe(true);
    emitServerEvents!([
      {
        kind: 'deedUpdated',
        data: {
          colonyId: 'col_0',
          tokenId: 'deed:col_0',
          version: 2,
          change: 'Terraform 40 %',
        },
      },
    ]);
    expect(hostEl.hidden).toBe(true);

    emitDeedUpdated!(makeDeedUpdatedPayload({ change: 'Terraform 50 %', version: 3 }));
    expect(hostEl.hidden).toBe(false);
    expect(hostEl.textContent).toContain('Your Deed was updated: Terraform 50 %');
    toastHost.dispose();
  });

  it('ignores initial v1 mint notification and empty changes', () => {
    const hostEl = document.createElement('div');
    const toastHost = new DeedToastHost(hostEl);
    expect(
      toastHost.handleUpdate({
        colonyId: 'col_0',
        tokenId: 'deed:col_0',
        version: 1,
        change: 'Deed minted on NEAR',
      }),
    ).toBe(false);
    expect(
      toastHost.handleUpdate({
        colonyId: 'col_0',
        tokenId: 'deed:col_0',
        version: 2,
        change: '   ',
      }),
    ).toBe(false);
    expect(hostEl.hidden).toBe(true);
  });
});

describe('W20-25 NotifierPort integration on DeedSettledService (unit)', () => {
  it('calls NotifierPort ONLY on deed settled when W09 is enabled, and never errors when W09 is off', async () => {
    const sendSpy = vi.fn(async () => ({ id: 'notif_1', status: 'sent' as const }));
    const notifier: NotifierPort = { send: sendSpy };

    const noW09 = buildSettledHarness('W05,W08,W20', notifier);
    await noW09.mint.mintForColony({
      colonyId: 'col_0',
      planetId: 'planet_w20',
      colonyName: 'Aegis',
      planetType: 'temperate',
      stage: 4,
      terraformBp: 4000,
    });
    await noW09.proj.projectMilestone({
      colonyId: 'col_0',
      planetId: 'planet_w20',
      terraformBp: 5000,
      change: 'Terraform 50 %',
    });
    await noW09.settled.settleColonyDeed({ colonyId: 'col_0', planetId: 'planet_w20' });
    expect(sendSpy).not.toHaveBeenCalled();

    const withW09 = buildSettledHarness('W05,W08,W09,W20', notifier);
    await withW09.mint.mintForColony({
      colonyId: 'col_1',
      planetId: 'planet_w20',
      colonyName: 'Helios',
      planetType: 'temperate',
      stage: 4,
      terraformBp: 4000,
    });
    await withW09.proj.projectMilestone({
      colonyId: 'col_1',
      planetId: 'planet_w20',
      terraformBp: 5000,
      change: 'Terraform 50 %',
      forceImmediate: true,
    });
    expect(sendSpy).not.toHaveBeenCalled();

    await withW09.settled.settleColonyDeed({ colonyId: 'col_1', planetId: 'planet_w20' });
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'telegram',
        title: 'Colony Deed Settled',
      }),
    );
  });
});
