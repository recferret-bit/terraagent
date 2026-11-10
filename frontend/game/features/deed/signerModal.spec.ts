// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Nep413Signature } from '@terra/contracts';
import {
  buildMockNep413Signature,
  createMockNep413Nonce,
  openMockWalletSignerModal,
  type SignerModalRequest,
} from './signerModal';

const BASE_REQ: SignerModalRequest = {
  actionSummary: 'Stake 10 NEAR to pool aurora.poolv1.near',
  accountId: 'player.testnet',
  recipient: 'terra-agent.testnet',
  message: 'Stake 10 NEAR on colony-settled-1',
};

describe('signerModal (W20-22) - nonce and signature helpers', () => {
  it('returns a 32-byte hex nonce string (64 chars, >= 16 chars)', () => {
    const nonce = createMockNep413Nonce();
    expect(typeof nonce).toBe('string');
    expect(nonce.length).toBe(64);
    expect(nonce).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns deterministic nonce when seed is provided', () => {
    const nonce1 = createMockNep413Nonce('seed-alpha');
    const nonce2 = createMockNep413Nonce('seed-alpha');
    const nonce3 = createMockNep413Nonce('seed-beta');
    expect(nonce1).toBe(nonce2);
    expect(nonce1).not.toBe(nonce3);
  });

  it('builds a signature that strictly satisfies Nep413Signature schema', () => {
    const sig = buildMockNep413Signature({
      accountId: 'player.near',
      recipient: 'terra-agent.near',
      message: 'Stake 5 NEAR',
    });
    const parsed = Nep413Signature.parse(sig);
    expect(parsed.accountId).toBe('player.near');
    expect(parsed.recipient).toBe('terra-agent.near');
    expect(parsed.message).toBe('Stake 5 NEAR');
    expect(parsed.publicKey).toMatch(/^ed25519:mock-/);
    expect(parsed.signature).toMatch(/^mock-sig:/);
    expect(parsed.nonce.length).toBeGreaterThanOrEqual(16);
  });

  it('preserves an explicitly passed nonce', () => {
    const customNonce = 'custom-nonce-12345678';
    const sig = buildMockNep413Signature({
      accountId: 'player.near',
      recipient: 'terra-agent.near',
      message: 'Claim account',
      nonce: customNonce,
    });
    expect(sig.nonce).toBe(customNonce);
    expect(Nep413Signature.safeParse(sig).success).toBe(true);
  });
});

describe('signerModal (W20-22) - DOM structure and approve flow', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('renders modal overlay with NEP-413 fields and default title', () => {
    const modal = openMockWalletSignerModal(BASE_REQ);
    expect(modal.root.getAttribute('role')).toBe('dialog');
    expect(modal.root.getAttribute('aria-modal')).toBe('true');
    expect(document.body.contains(modal.root)).toBe(true);

    expect(modal.root.querySelector('#mock-signer-modal-title')?.textContent).toBe('NEAR Wallet Signature Request (Mock)');
    expect(modal.root.querySelector('[data-testid="signer-action-summary"]')?.textContent).toBe(BASE_REQ.actionSummary);
    expect(modal.root.querySelector('[data-testid="signer-account"]')?.textContent).toBe(BASE_REQ.accountId);
    expect(modal.root.querySelector('[data-testid="signer-recipient"]')?.textContent).toBe(BASE_REQ.recipient);
    expect(modal.root.querySelector('[data-testid="signer-message"]')?.textContent).toBe(BASE_REQ.message);
    expect(modal.root.querySelector('[data-testid="signer-nonce"]')?.textContent?.length).toBe(64);
    expect(modal.root.querySelector('.ta-signer-modal__notice')?.textContent).toBe(
      'Real NEAR from your wallet — not game currency, no in-game bonus',
    );
    expect(modal.root.querySelector('[data-testid="signer-approve-btn"]')?.textContent).toBe('Approve in Wallet');
    expect(modal.root.querySelector('[data-testid="signer-reject-btn"]')?.textContent).toBe('Reject');
    modal.close();
  });

  it('approving resolves promise with valid signature and removes modal', async () => {
    const modal = openMockWalletSignerModal(BASE_REQ);
    const approveBtn = modal.root.querySelector<HTMLButtonElement>('[data-testid="signer-approve-btn"]')!;
    approveBtn.click();
    const outcome = await modal.promise;

    expect(outcome.status).toBe('approved');
    if (outcome.status === 'approved') {
      expect(Nep413Signature.safeParse(outcome.signature).success).toBe(true);
      expect(outcome.signature.accountId).toBe(BASE_REQ.accountId);
      expect(outcome.signature.recipient).toBe(BASE_REQ.recipient);
      expect(outcome.signature.message).toBe(BASE_REQ.message);
    }
    expect(document.body.contains(modal.root)).toBe(false);
  });

  it('supports custom nonce, title, subtitle, and custom container', () => {
    const container = document.createElement('section');
    document.body.appendChild(container);
    const customNonce = 'nonce-custom-99999999';
    const modal = openMockWalletSignerModal({
      ...BASE_REQ,
      title: 'Authorize Account Claim',
      subtitle: 'Colony Deed #42',
      nonce: customNonce,
      container,
    });

    expect(container.contains(modal.root)).toBe(true);
    expect(modal.root.querySelector('#mock-signer-modal-title')?.textContent).toBe('Authorize Account Claim');
    expect(modal.root.querySelector('.ta-signer-modal__subtitle')?.textContent).toBe('Colony Deed #42');
    expect(modal.root.querySelector('[data-testid="signer-nonce"]')?.textContent).toBe(customNonce);
    modal.close();
    expect(container.contains(modal.root)).toBe(false);
  });
});

describe('signerModal (W20-22) - rejection, timeout, and corner cases', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('clicking Reject displays "Cancelled in wallet" and resolves with rejected status', async () => {
    const modal = openMockWalletSignerModal(BASE_REQ);
    const rejectBtn = modal.root.querySelector<HTMLButtonElement>('[data-testid="signer-reject-btn"]')!;
    rejectBtn.click();
    const outcome = await modal.promise;

    expect(outcome).toEqual({ status: 'rejected', reason: 'Cancelled in wallet' });
    expect(modal.root.querySelector('[data-testid="signer-status"]')?.textContent).toBe('Cancelled in wallet');
    expect(document.body.contains(modal.root)).toBe(false);
  });

  it('times out after timeoutMs and displays "Wallet request timed out"', async () => {
    vi.useFakeTimers();
    const modal = openMockWalletSignerModal({ ...BASE_REQ, timeoutMs: 50 });
    vi.advanceTimersByTime(50);
    const outcome = await modal.promise;

    expect(outcome).toEqual({ status: 'timeout', reason: 'Wallet request timed out' });
    expect(modal.root.querySelector('[data-testid="signer-status"]')?.textContent).toBe('Wallet request timed out');
    expect(document.body.contains(modal.root)).toBe(false);
  });

  it('pressing Escape key triggers reject', async () => {
    const modal = openMockWalletSignerModal(BASE_REQ);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    const outcome = await modal.promise;
    expect(outcome).toEqual({ status: 'rejected', reason: 'Cancelled in wallet' });
    expect(document.body.contains(modal.root)).toBe(false);
  });

  it('clicking on backdrop overlay triggers reject', async () => {
    const modal = openMockWalletSignerModal(BASE_REQ);
    modal.root.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const outcome = await modal.promise;
    expect(outcome).toEqual({ status: 'rejected', reason: 'Cancelled in wallet' });
    expect(document.body.contains(modal.root)).toBe(false);
  });

  it('settles only once even with multiple calls or close()', async () => {
    const modal = openMockWalletSignerModal(BASE_REQ);
    modal.approve();
    modal.reject();
    modal.close();
    const outcome = await modal.promise;
    expect(outcome.status).toBe('approved');
  });

  it('close() on unsettled modal rejects with "Cancelled in wallet"', async () => {
    const modal = openMockWalletSignerModal(BASE_REQ);
    modal.close();
    const outcome = await modal.promise;
    expect(outcome).toEqual({ status: 'rejected', reason: 'Cancelled in wallet' });
    expect(document.body.contains(modal.root)).toBe(false);
  });
});
