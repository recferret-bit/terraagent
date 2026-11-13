// @vitest-environment jsdom
import { execFileSync } from 'node:child_process';
import type { NearAuthChallengeResponse } from '@terra/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setFastAuthPopupDriverForTests } from '../../../design/pilot/fastAuthSpa';
import { consumeNearWalletCallback } from '../../../design/pilot/mockToken';
import {
  consumeRecentNep413PopupResult,
  savePendingNep413Redirect,
} from '../../../design/pilot/nearAuthApi';
import { buildCliSignCommand, tryParseCliJsonPaste } from '../../../design/pilot/nearCliPanel';
import { openNearWalletSelectorModal } from '../../../design/pilot/nearWalletModal';
import { PilotAccess } from '../../../design/pilot/PilotAccess';
import { setWalletSelectorDriverForTests } from '../../../design/pilot/walletSelectorRuntime';

afterEach(() => {
  setWalletSelectorDriverForTests(null);
  setFastAuthPopupDriverForTests(null);
  document.body.replaceChildren();
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

const SAMPLE_CHALLENGE: NearAuthChallengeResponse = {
  challengeId: '11111111-2222-4333-8444-555555555555',
  nonce: 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=',
  recipient: 'terraagent.testnet',
  message: [
    'Sign in to TerraAgent (NEAR Testnet)',
    'Domain: terraagent.testnet',
    'Challenge: 11111111-2222-4333-8444-555555555555',
    'Issued: 2026-11-13T21:00:00.000Z',
    'Expires: 2026-11-13T21:05:00.000Z',
  ].join('\n'),
  network: 'testnet',
  expiresAt: Date.now() + 300_000,
};

describe('NEAR Wallet modal top-layer suspension for external QR / iframe wallets', () => {
  it('suspends <dialog> modal top-layer while NEAR Mobile QR widget is active and restores dialog on cancel/error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(SAMPLE_CHALLENGE), { status: 200 })),
    );

    let dialogStateDuringQr: { open: boolean; display: string } | null = null;
    setWalletSelectorDriverForTests({
      async signChallenge(moduleId) {
        expect(moduleId).toBe('near-mobile-wallet');
        const activeDialog = document.querySelector<HTMLDialogElement>('dialog[data-testid="near-wallet-modal"]')!;
        dialogStateDuringQr = {
          open: activeDialog.open,
          display: activeDialog.style.display,
        };
        throw new Error('User rejected QR pairing in NEAR Mobile.');
      },
      async signOutActiveWallet() {},
    });

    const dialog = openNearWalletSelectorModal({
      onDirectToken: vi.fn(),
    });
    expect(dialog.open).toBe(true);

    document.querySelector<HTMLButtonElement>('[data-testid="near-wallet-mobile"]')!.click();
    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="near-wallet-error"]')?.textContent).toContain(
        'User rejected QR pairing in NEAR Mobile.',
      );
    });

    expect(dialogStateDuringQr).toEqual({ open: false, display: 'none' });
    expect(dialog.open).toBe(true);
    expect(dialog.style.display).toBe('');
  });
});

describe('near-cli-rs POSIX multi-line command quoting & terminal paste parser', () => {
  it('quotes multi-line NEP-413 challenge messages with real newlines in POSIX sh and parses full CLI terminal output', () => {
    const cmd = buildCliSignCommand(SAMPLE_CHALLENGE, 'alice.testnet');
    expect(cmd).not.toContain('\\nDomain:');

    // Extract the single-quoted message argument passed after `utf8 ` and expand it via real `/bin/sh`:
    const utf8Idx = cmd.indexOf('utf8 ');
    const nonceIdx = cmd.indexOf(' \\\n  nonce ');
    const quotedArg = cmd.slice(utf8Idx + 'utf8 '.length, nonceIdx);
    const expanded = execFileSync('/bin/sh', ['-c', `printf '%s' ${quotedArg}`], { encoding: 'utf8' });
    expect(expanded).toBe(SAMPLE_CHALLENGE.message);

    const cliTerminalCopy = [
      'Here is your console command if you need to script it or re-run:',
      '    near message sign-nep413 utf8 ...',
      '',
      '{',
      '  "accountId": "alice.testnet",',
      '  "publicKey": "ed25519:ET2EG9EuUQweAKUfc2rkaiop27fsNscVPEv916rXYX4Q",',
      '  "signature": "ed25519:33a9qKCaWic5yc1Dom139dzfmpdRhkBKaP8xVGNsVbz65H5RFk7PyVxjHKiiZEyxxEFqcRAo1MzqsSXxrzYk8XJK"',
      '}',
    ].join('\n');
    expect(tryParseCliJsonPaste(cliTerminalCopy)).toEqual({
      accountId: 'alice.testnet',
      publicKey: 'ed25519:ET2EG9EuUQweAKUfc2rkaiop27fsNscVPEv916rXYX4Q',
      signature: 'ed25519:33a9qKCaWic5yc1Dom139dzfmpdRhkBKaP8xVGNsVbz65H5RFk7PyVxjHKiiZEyxxEFqcRAo1MzqsSXxrzYk8XJK',
    });
  });
});

describe('PilotAccess NestJS error envelope surfacing, Email popup cancel handling & MyNearWallet cross-popup storage', () => {
  it('surfaces NestJS { error: { message } } envelope and does not open a second popup when Email Auth0 popup is cancelled', async () => {
    const openSpy = vi.spyOn(window, 'open');
    setFastAuthPopupDriverForTests(async () => {
      const err = new Error('Popup closed');
      err.name = 'PopupCancelledError';
      throw err;
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    const access = new PilotAccess(host, { skipRestore: true });

    host.querySelector<HTMLButtonElement>('[data-testid="pilot-sign-in"]')!.click();
    const emailInput = host.querySelector<HTMLInputElement>('[data-testid="pilot-email-input"]')!;
    emailInput.value = 'pilot@terraagent.fun';
    host.querySelector<HTMLButtonElement>('[data-testid="continue-email"]')!.click();

    await vi.waitFor(() => {
      expect(host.querySelector('[role="status"]')?.textContent).toBe('Sign-in was cancelled.');
    });
    expect(openSpy).not.toHaveBeenCalled();

    // Now return an ID token from FastAuth and reject on backend with NestJS AllExceptionsFilter envelope:
    setFastAuthPopupDriverForTests(async () => ({ idToken: 'a.b.c', email: 'pilot@terraagent.fun' }));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            errorCode: 'NEAR_PROVIDER_REJECTED',
            error: { code: 'NEAR_PROVIDER_REJECTED', message: 'Email address is not verified' },
            requestId: 'req-123',
          }),
          { status: 401, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );

    host.querySelector<HTMLButtonElement>('[data-testid="pilot-sign-in"]')!.click();
    host.querySelector<HTMLInputElement>('[data-testid="pilot-email-input"]')!.value = 'pilot@terraagent.fun';
    host.querySelector<HTMLButtonElement>('[data-testid="continue-email"]')!.click();

    await vi.waitFor(() => {
      expect(host.querySelector('[role="status"]')?.textContent).toBe('Email address is not verified');
    });
    access.dispose();
  });

  it('persists MyNearWallet pending NEP-413 redirect in localStorage across popup boundaries', () => {
    savePendingNep413Redirect({
      challengeId: SAMPLE_CHALLENGE.challengeId,
      callbackUrl: 'https://terraagent.fun/landing.html',
      walletId: 'my-near-wallet',
      expiresAt: Date.now() + 60_000,
    });
    // Simulate a separate popup window where sessionStorage is empty:
    sessionStorage.clear();

    const sig64 = btoa('x'.repeat(64));
    const res = consumeNearWalletCallback({
      origin: 'https://terraagent.fun',
      pathname: '/landing.html',
      search: '',
      hash: `#accountId=mnw.testnet&publicKey=ed25519:ET2EG9EuUQweAKUfc2rkaiop27fsNscVPEv916rXYX4Q&signature=${encodeURIComponent(sig64)}&state=${SAMPLE_CHALLENGE.challengeId}`,
      opener: null,
    });
    expect(res?.provider).toBe('near-wallet');
    expect(res?.token.startsWith('nep413:')).toBe(true);
    expect(consumeRecentNep413PopupResult(SAMPLE_CHALLENGE.challengeId)).toBeNull();
  });
});
