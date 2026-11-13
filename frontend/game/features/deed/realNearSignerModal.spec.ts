// @vitest-environment jsdom
import { Nep413Signature, type DeedView } from '@terra/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FeatureContext } from '../../core/registry/types';
import {
  createRealSignerWalletSelector,
  getRealSignerModuleIds,
  setRealSignerWalletDriverForTests,
} from './parts/realNearWalletDriver';
import { openRealNearSignerModal } from './realNearSignerModal';
import { StakingPanel } from './stakingPanel';

afterEach(() => {
  setRealSignerWalletDriverForTests(null);
  vi.restoreAllMocks();
});

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
    expect(modal?.querySelector('[data-testid="real-signer-mobile"]')).not.toBeNull();
    expect(modal?.querySelector('[data-testid="real-signer-mynearwallet"]')).toBeNull();

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

describe('Real NEAR Signer Testnet wallet parity & near-cli-rs JSON auto-paste', () => {
  it('registers Meteor, OKX, NEAR Mobile, Intear, and MyNearWallet on Testnet and auto-extracts CLI JSON paste', async () => {
    const testnetSelector = await createRealSignerWalletSelector('testnet');
    expect(testnetSelector.store.getState().modules.map((m) => m.id)).toEqual([
      'meteor-wallet',
      'okx-wallet',
      'near-mobile-wallet',
      'intear-wallet',
      'my-near-wallet',
    ]);
    expect(getRealSignerModuleIds('mainnet')).toEqual([
      'meteor-wallet',
      'okx-wallet',
      'near-mobile-wallet',
      'intear-wallet',
    ]);

    const cliContainer = document.createElement('div');
    const cliHandle = openRealNearSignerModal({
      network: 'testnet',
      actionSummary: 'Claim colony account for col_0 (testnet)',
      accountId: 'p-col0.terraagent.mock',
      recipient: 'terraagent.testnet',
      message: 'claim:col_0',
      container: cliContainer,
    });
    for (const id of [
      'real-signer-meteor',
      'real-signer-okx',
      'real-signer-mobile',
      'real-signer-intear',
      'real-signer-mynearwallet',
    ]) {
      expect(cliContainer.querySelector(`[data-testid="${id}"]`)).not.toBeNull();
    }

    const sigInput = cliContainer.querySelector<HTMLInputElement>('[data-testid="real-signer-signature"]')!;
    sigInput.value = [
      'Signed NEP-413 message:',
      JSON.stringify({
        accountId: 'commander.testnet',
        publicKey: 'ed25519:ET2EG9EuUQweAKUfc2rkaiop27fsNscVPEv916rXYX4Q',
        signature: 'ed25519:33a9qKCaWic5yc1Dom139dzfmpdRhkBKaP8xVGNsVbz65H5RFk7PyVxjHKiiZEyxxEFqcRAo1MzqsSXxrzYk8XJK',
      }),
    ].join('\n');
    sigInput.dispatchEvent(new Event('input'));

    expect(cliContainer.querySelector<HTMLInputElement>('[data-testid="real-signer-account"]')?.value).toBe(
      'commander.testnet',
    );
    expect(cliContainer.querySelector<HTMLInputElement>('[data-testid="real-signer-pubkey"]')?.value).toBe(
      'ed25519:ET2EG9EuUQweAKUfc2rkaiop27fsNscVPEv916rXYX4Q',
    );
    expect(sigInput.value).toBe(
      'ed25519:33a9qKCaWic5yc1Dom139dzfmpdRhkBKaP8xVGNsVbz65H5RFk7PyVxjHKiiZEyxxEFqcRAo1MzqsSXxrzYk8XJK',
    );
    expect(cliContainer.querySelector('[data-testid="real-signer-cli-cmd"]')?.textContent).toContain(
      'sign-as commander.testnet',
    );
    cliHandle.approve();
    expect((await cliHandle.promise).status).toBe('approved');
  });
});

describe('Real NEAR Signer wallet button signing & network mismatch guard', () => {
  it('signs via NEAR Mobile & MyNearWallet buttons on Testnet and rejects wrong-network accounts', async () => {
    const calledModules: string[] = [];
    setRealSignerWalletDriverForTests(async (req) => {
      calledModules.push(req.moduleId);
      if (req.moduleId === 'okx-wallet') {
        return { accountId: 'wrong.near', publicKey: 'ed25519:abc', signature: 'ed25519:sig' };
      }
      return {
        accountId: `${req.moduleId.split('-')[0]}.testnet`,
        publicKey: 'ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp',
        signature: 'ed25519:sig-wallet-123',
        ...(req.moduleId === 'my-near-wallet' ? { callbackUrl: 'https://terraagent.fun/play.html' } : {}),
      };
    });

    const errContainer = document.createElement('div');
    const errHandle = openRealNearSignerModal({
      network: 'testnet',
      actionSummary: 'Stake NEAR',
      accountId: 'alice.testnet',
      recipient: 'staking.terraagent.testnet',
      message: 'stake:10',
      container: errContainer,
    });
    errContainer.querySelector<HTMLButtonElement>('[data-testid="real-signer-okx"]')!.click();
    await vi.waitFor(() => {
      expect(errContainer.querySelector('[data-testid="signer-status"]')?.textContent).toContain('Mainnet (.near)');
    });
    errHandle.reject();
    await errHandle.promise;

    for (const [btnId, expectedModule] of [
      ['real-signer-mobile', 'near-mobile-wallet'],
      ['real-signer-mynearwallet', 'my-near-wallet'],
    ] as const) {
      const c = document.createElement('div');
      const h = openRealNearSignerModal({
        network: 'testnet',
        actionSummary: 'Stake NEAR',
        accountId: 'alice.testnet',
        recipient: 'staking.terraagent.testnet',
        message: 'stake:10',
        container: c,
      });
      c.querySelector<HTMLButtonElement>(`[data-testid="${btnId}"]`)!.click();
      const out = await h.promise;
      expect(out.status).toBe('approved');
      expect(calledModules.at(-1)).toBe(expectedModule);
      if (out.status === 'approved') {
        expect(Nep413Signature.safeParse(out.signature).success).toBe(true);
        if (expectedModule === 'my-near-wallet') {
          expect(out.signature.callbackUrl).toBe('https://terraagent.fun/play.html');
        }
      }
    }
  });

  it('opens real Testnet signer modal when NEAR_ADAPTER_IDENTITY=testnet pairs with mock DeedNft contractId', () => {
    const parent = document.createElement('div');
    const overlay = document.createElement('div');
    const ctx: FeatureContext = {
      flags: new Set(['W20']),
      host: 'server',
      services: { track: () => {}, hudOverlay: overlay },
    };
    const panel = new StakingPanel(parent, ctx);
    panel.syncDeed({
      ...makeRealNetworkDeed('testnet', false),
      contractId: 'deeds.terraagent.mock',
      ownerAccountId: 'alice.pilots.terraagent.testnet',
    });

    const claimPromise = panel.claimAccountFlow();
    const modal = overlay.querySelector('[data-testid="real-wallet-signer-modal"]');
    expect(modal).not.toBeNull();
    expect(modal?.textContent).toContain('TESTNET');
    expect(modal?.querySelector('[data-testid="real-signer-mynearwallet"]')).not.toBeNull();
    overlay.querySelector<HTMLButtonElement>('[data-testid="signer-reject-btn"]')!.click();
    return expect(claimPromise).resolves.toBe(false).then(() => panel.dispose());
  });
});
