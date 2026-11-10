// @vitest-environment jsdom
import type { DeedUpdatedPayload } from '@terra/contracts';
import { describe, expect, it } from 'vitest';
import { DeedToastHost } from './deedNotifications';

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
    status: 'active',
    settled: false,
    metadata,
    deed: {
      colonyId: 'col_0',
      planetId: 'planet_w20',
      tokenId: 'deed:col_0',
      ownerAccountId: 'planet_w20-col_0.terraagent.mock',
      contractId: 'deeds.terraagent.mock',
      metadata,
      version: 2,
      status: 'active',
      settled: false,
      pendingState: 'FINAL',
      pendingRetries: 0,
      accountClaimed: false,
      claimedByAccountId: null,
      txHash: 'mock:tx1',
      mintedAt: 1731153600000,
      updatedAt: 1731153600000,
      history: [],
    },
    ...overrides,
  };
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
