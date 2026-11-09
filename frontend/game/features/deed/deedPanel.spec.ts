// @vitest-environment jsdom
import type { DeedUpdatedPayload, DeedView } from '@terra/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { FeatureContext } from '../../core/registry/types';
import { DeedPanel } from './deedPanel';

function buildSampleDeed(overrides: Partial<DeedView> = {}): DeedView {
  const metadata = {
    planet: 'planet_w20',
    colony: 'col_0',
    colonyName: 'Aegis Spire',
    planetType: 'temperate' as const,
    stage: 4,
    terraformBp: 4000,
    status: 'active' as const,
    settled: false,
    version: 1,
    imageUrl: '/v1/near/deed/deed%3Acol_0/image.png?v=1',
    ...(overrides.metadata ?? {}),
  };
  return {
    colonyId: 'col_0',
    planetId: 'planet_w20',
    tokenId: 'deed:col_0',
    accountId: 'planet_w20-col_0.terraagent.mock',
    contract: 'deeds.terraagent.mock',
    metadata,
    version: 1,
    status: 'active',
    settled: false,
    pendingState: 'FINAL',
    pendingRetries: 0,
    accountClaimed: false,
    claimedByAccountId: null,
    lastUpdateTx: 'mock:tx-v1',
    explorerUrl: '/dev/chain/?tab=deeds&tokenId=deed%3Acol_0',
    shareUrl: '/deed/deed%3Acol_0',
    imageUrl: metadata.imageUrl,
    history: [
      {
        version: 1,
        change: 'Deed minted on NEAR',
        at: '2026-11-09T12:00:00.000Z',
        txHash: 'mock:tx-v1',
        metadata,
      },
    ],
    ...overrides,
  };
}

describe('W20-10 DeedCard UI panel live updates (unit)', () => {
  it('renders live preview, stats, status chip, history timeline, and receipt link to /dev/chain, and refreshes on deed.updated push without reload', async () => {
    const parent = document.createElement('div');
    let emitDeedUpdated: ((p: DeedUpdatedPayload) => void) | null = null;
    const track = vi.fn();

    const initialDeed = buildSampleDeed();
    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => ({ deeds: [initialDeed] }),
    })) as unknown as typeof fetch;

    const ctx: FeatureContext = {
      flags: new Set(['W20']),
      host: 'server',
      services: {
        track,
        store: {
          onDeedUpdated: (fn) => {
            emitDeedUpdated = fn;
            return () => {
              emitDeedUpdated = null;
            };
          },
        },
      },
    };

    const panel = new DeedPanel(parent, ctx, { fetchFn });
    panel.setOpen(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(panel.root.dataset.open).toBe('true');
    expect(track).toHaveBeenCalledWith(
      'deed_viewed',
      expect.objectContaining({ colonyId: 'col_0', tokenId: 'deed:col_0' }),
    );
    expect(panel.root.querySelector('[data-testid="deed-version-badge"]')?.textContent).toBe('v1');
    expect(panel.root.querySelector('[data-testid="deed-status-chip"]')?.textContent).toBe(
      'Active',
    );
    expect(panel.root.querySelector('[data-testid="deed-stat-terraform"]')?.textContent).toBe(
      '40 %',
    );
    const receipt = panel.root.querySelector(
      '[data-testid="deed-receipt-link"]',
    ) as HTMLAnchorElement | null;
    expect(receipt?.textContent).toBe('Recorded on NEAR (mock)');
    expect(receipt?.getAttribute('href')).toContain('/dev/chain/?tab=deeds&tokenId=deed%3Acol_0');

    const updatedDeed = buildSampleDeed({
      version: 2,
      metadata: { ...initialDeed.metadata, terraformBp: 5000, version: 2 },
      history: [
        ...initialDeed.history,
        {
          version: 2,
          change: 'Terraform 50 %',
          at: '2026-11-09T12:10:00.000Z',
          txHash: 'mock:tx-v2',
          metadata: { ...initialDeed.metadata, terraformBp: 5000, version: 2 },
        },
      ],
    });
    emitDeedUpdated!({
      colonyId: 'col_0',
      planetId: 'planet_w20',
      tokenId: 'deed:col_0',
      version: 2,
      change: 'Terraform 50 %',
      metadata: updatedDeed.metadata,
      deed: updatedDeed,
    });

    expect(panel.root.querySelector('[data-testid="deed-version-badge"]')?.textContent).toBe('v2');
    expect(panel.root.querySelector('[data-testid="deed-stat-terraform"]')?.textContent).toBe(
      '50 %',
    );
    expect(panel.root.querySelector('[data-testid="deed-history-list"]')?.textContent).toContain(
      'v2 · Terraform 50 %',
    );
    panel.dispose();
  });
});

describe('W20-10 DeedCard UI panel states (unit)', () => {
  it('displays pending/retrying badge when pendingRetries > 0 and switches to Settled gold frame on settle', () => {
    const parent = document.createElement('div');
    const ctx: FeatureContext = {
      flags: new Set(['W20']),
      host: 'server',
      services: {},
    };
    const panel = new DeedPanel(parent, ctx);

    panel.renderDeed(
      buildSampleDeed({
        pendingState: 'PENDING',
        pendingRetries: 1,
      }),
    );
    const pendingBadge = panel.root.querySelector('[data-testid="deed-pending-badge"]');
    expect(pendingBadge?.textContent).toContain('Pending / retrying (retries: 1)');

    panel.renderDeed(
      buildSampleDeed({
        settled: true,
        status: 'settled',
        pendingState: 'FINAL',
        pendingRetries: 0,
      }),
    );
    expect(panel.root.dataset.settled).toBe('true');
    expect(panel.root.querySelector('[data-testid="deed-status-chip"]')?.textContent).toBe(
      'Settled',
    );
    expect(pendingBadge?.textContent).toBe('Confirmed');
    panel.dispose();
  });
});
