// @vitest-environment jsdom
import type { DeedView } from '@terra/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { FeatureContext } from '../../core/registry/types';
import { openRealNearSignerModal } from './realNearSignerModal';
import { StakingPanel } from './stakingPanel';

function makeRealNetworkDeed(network: 'testnet' | 'mainnet', accountClaimed = false): DeedView {
  const suffix = network === 'mainnet' ? 'near' : 'testnet';
  return {
    colonyId: 'col_0',
    planetId: 'planet_w20',
    tokenId: 'deed:col_0',
    ownerAccountId: `p-col0.pilots.terraagent.${suffix}`,
    contractId: `deed.terraagent.${suffix}`,
    metadata: {
      planet: 'planet_w20',
      colony: 'col_0',
      colonyName: 'Aegis Spire',
      planetType: 'temperate',
      stage: 4,
      terraformBp: 10_000,
      status: 'settled',
      settled: true,
      version: 2,
      imageUrl: '/v1/near/deed/deed%3Acol_0/image.png?v=2',
    },
    version: 2,
    status: 'settled',
    settled: true,
    pendingState: 'FINAL',
    pendingRetries: 0,
    accountClaimed,
    claimedByAccountId: accountClaimed ? `alice.${suffix}` : null,
    txHash: `${network}:tx-deed-1`,
    mintedAt: 1731153600000,
    updatedAt: 1731153600000,
    history: [],
  };
}

describe('Real NEAR NEP-413 Signer Modal & StakingPanel Testnet/Mainnet wiring', () => {
  it('renders CLI NEP-413 sign command, validates required fields, and resolves approved signature', async () => {
    const container = document.createElement('div');
    const handle = openRealNearSignerModal({
      network: 'testnet',
      actionSummary: 'Claim colony account for col_0 (testnet)',
      accountId: 'alice.testnet',
      recipient: 'terraagent.testnet',
      message: 'claim:col_0',
      container,
    });

    const cliCmd = container.querySelector('[data-testid="real-signer-cli-cmd"]')?.textContent ?? '';
    expect(cliCmd).toContain('near message sign-nep413');
    expect(cliCmd).toContain('network-config testnet');
    expect(cliCmd).toContain('recipient "terraagent.testnet"');

    // Empty signature/pubkey -> inline validation message without closing modal
    handle.approve();
    expect(container.querySelector('[data-testid="signer-status"]')?.textContent).toContain('FullAccess public key');

    const pubInput = container.querySelector<HTMLInputElement>('[data-testid="real-signer-pubkey"]')!;
    const sigInput = container.querySelector<HTMLInputElement>('[data-testid="real-signer-signature"]')!;
    pubInput.value = 'ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp';
    sigInput.value = 'ed25519:3s123456789abcdef';
    handle.approve();

    const outcome = await handle.promise;
    expect(outcome.status).toBe('approved');
    if (outcome.status === 'approved') {
      expect(outcome.signature.accountId).toBe('alice.testnet');
      expect(outcome.signature.publicKey).toBe('ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp');
      expect(outcome.signature.recipient).toBe('terraagent.testnet');
      expect(Buffer.from(outcome.signature.nonce, 'base64').length).toBe(32);
    }
  });

  it('opens real signer modal automatically for .testnet/.near deeds and fails closed on server rejection', async () => {
    const parent = document.createElement('div');
    const overlay = document.createElement('div');
    const ctx: FeatureContext = {
      flags: new Set(['W20']),
      host: 'server',
      services: { track: () => {}, hudOverlay: overlay },
    };

    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/v1/near/claim-account')) {
        return {
          ok: false,
          json: async () => ({ code: 'NEAR_NOT_OWNER', message: 'Key is not FullAccess on mainnet' }),
        };
      }
      return { ok: false, json: async () => ({}) };
    }) as unknown as typeof fetch;

    const panel = new StakingPanel(parent, ctx, { fetchFn });
    panel.syncDeed(makeRealNetworkDeed('mainnet', false));

    const claimPromise = panel.claimAccountFlow();
    const modal = overlay.querySelector('[data-testid="real-wallet-signer-modal"]');
    expect(modal).not.toBeNull();
    expect(modal?.textContent).toContain('MAINNET');

    overlay.querySelector<HTMLInputElement>('[data-testid="real-signer-account"]')!.value = 'alice.near';
    overlay.querySelector<HTMLInputElement>('[data-testid="real-signer-pubkey"]')!.value = 'ed25519:userMainnetKey';
    overlay.querySelector<HTMLInputElement>('[data-testid="real-signer-signature"]')!.value = 'ed25519:sigMainnet';
    overlay.querySelector<HTMLButtonElement>('[data-testid="signer-approve-btn"]')!.click();

    const ok = await claimPromise;
    expect(ok).toBe(false);
    expect(panel.statusMsgEl.textContent).toBe('Key is not FullAccess on mainnet');
    panel.dispose();
  });
});
