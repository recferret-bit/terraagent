// @vitest-environment jsdom
import { execFileSync } from 'node:child_process';
import type { NearAuthChallengeResponse } from '@terra/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setFastAuthPopupDriverForTests } from '../../../design/pilot/fastAuthSpa';
import {
  buildNearWalletSignMessageUrl,
  consumeNearWalletCallback,
  NEAR_MAINNET_WALLET_URL,
  NEAR_TESTNET_WALLET_URL,
  OAUTH_CALLBACK_STORAGE_KEY,
} from '../../../design/pilot/mockToken';
import {
  consumeRecentNep413PopupResult,
  PENDING_NEP413_STORAGE_KEY,
  RECENT_NEP413_POPUP_KEY,
  savePendingNep413Redirect,
} from '../../../design/pilot/nearAuthApi';
import {
  buildCliSignCommand,
  isValidCliAccountForNetwork,
  tryParseCliJsonPaste,
} from '../../../design/pilot/nearCliPanel';
import { openNearWalletSelectorModal } from '../../../design/pilot/nearWalletModal';
import { PilotAccess } from '../../../design/pilot/PilotAccess';
import { PKCE_STATE_STORAGE_KEY } from '../../../design/pilot/pkceState';
import {
  assertNetworkAccountId,
  setWalletSelectorDriverForTests,
} from '../../../design/pilot/walletSelectorRuntime';
import { signOut as tradeSignOut } from '../../../trade/api/identity';

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

interface ObservedDialogStep {
  hasOpenAttr: boolean;
  display: string;
  isSigning: boolean;
  closedBy: string | null;
  stepText: string;
  externalHref: string | null;
}

function captureDialogStep(dialog: HTMLDialogElement): ObservedDialogStep {
  return {
    hasOpenAttr: dialog.hasAttribute('open'),
    display: dialog.style.display,
    isSigning: dialog.classList.contains('is-signing'),
    closedBy: dialog.getAttribute('closedby'),
    stepText: dialog.querySelector('[data-testid="near-wallet-step"]')?.textContent ?? '',
    externalHref: dialog.querySelector<HTMLAnchorElement>('[data-testid="near-wallet-external-link"]')?.href ?? null,
  };
}

describe('NEAR Wallet modal top-layer suspension for external QR / iframe & extension wallets', () => {
  it('exits #top-layer without hiding dialog (.is-signing), displays live 2/3 & 3/3 steps, and restores modal on cancel/error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => new Response(JSON.stringify(SAMPLE_CHALLENGE), { status: 200 })),
    );

    const observedSteps: ObservedDialogStep[] = [];

    setWalletSelectorDriverForTests({
      async signChallenge(moduleId, _challenge, _callbackUrl, progress) {
        const activeDialog = document.querySelector<HTMLDialogElement>('dialog[data-testid="near-wallet-modal"]')!;
        if (moduleId === 'near-mobile-wallet') {
          progress?.onStep?.('2/3 · Scan the QR code (or tap Open App) in NEAR Mobile (Testnet) and approve the signature…');
          observedSteps.push(captureDialogStep(activeDialog));
          throw new Error('User rejected QR pairing in NEAR Mobile.');
        }

        progress?.onStep?.('2/3 · Connect your Testnet account in Meteor Wallet…');
        observedSteps.push(captureDialogStep(activeDialog));
        progress?.onStep?.('3/3 · Confirm the NEP-413 sign-in message in Meteor Wallet…');
        observedSteps.push(captureDialogStep(activeDialog));
        throw new Error('Meteor signature declined.');
      },
      async signOutActiveWallet() {},
    });

    const dialog = openNearWalletSelectorModal({
      onDirectToken: vi.fn(),
    });
    expect(dialog.open).toBe(true);
    expect(dialog.classList.contains('is-signing')).toBe(false);

    // 1) NEAR Mobile: stays open non-modally (.is-signing), shows 2/3 QR step + Need NEAR Mobile App? link
    document.querySelector<HTMLButtonElement>('[data-testid="near-wallet-mobile"]')!.click();
    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="near-wallet-error"]')?.textContent).toContain(
        'User rejected QR pairing in NEAR Mobile.',
      );
    });
    expect(observedSteps[0]).toMatchObject({
      hasOpenAttr: true,
      isSigning: true,
      closedBy: 'none',
    });
    expect(observedSteps[0]!.display).not.toBe('none');
    expect(observedSteps[0]!.stepText).toContain('2/3 · Scan the QR code');
    expect(observedSteps[0]!.externalHref).toContain('nearmobile.app');
    expect(dialog.open).toBe(true);
    expect(dialog.classList.contains('is-signing')).toBe(false);
    expect(dialog.getAttribute('closedby')).toBe('any');

    // 2) Meteor Wallet: stays open non-modally (.is-signing) while showing both 2/3 and 3/3 step texts
    document.querySelector<HTMLButtonElement>('[data-testid="near-wallet-meteor"]')!.click();
    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="near-wallet-error"]')?.textContent).toContain(
        'Meteor signature declined.',
      );
    });
    expect(observedSteps[1]).toMatchObject({
      hasOpenAttr: true,
      isSigning: true,
      stepText: '2/3 · Connect your Testnet account in Meteor Wallet…',
    });
    expect(observedSteps[1]!.display).not.toBe('none');
    expect(observedSteps[2]).toMatchObject({
      hasOpenAttr: true,
      isSigning: true,
      stepText: '3/3 · Confirm the NEP-413 sign-in message in Meteor Wallet…',
    });
    expect(observedSteps[2]!.display).not.toBe('none');
    expect(dialog.open).toBe(true);
    expect(dialog.classList.contains('is-signing')).toBe(false);
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
});

describe('MyNearWallet cross-popup storage & sign-out cleanup', () => {
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

describe('MyNearWallet COOP popup recovery, signer-* isolation & sign-out cleanup', () => {
  it('recovers MyNearWallet popup result when COOP severs window.opener and isolates signer-* redirects from login callbacks', () => {
    const prevName = window.name;
    const prevHash = location.hash;
    const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => undefined);
    try {
      window.name = 'MyNearWallet';
      const sig64 = btoa('y'.repeat(64));

      // 1) Login challenge inside a COOP-severed MyNearWallet popup (window.opener === null)
      savePendingNep413Redirect({
        challengeId: SAMPLE_CHALLENGE.challengeId,
        callbackUrl: 'http://localhost:3000/',
        walletId: 'my-near-wallet',
        expiresAt: Date.now() + 60_000,
      });
      history.replaceState(
        null,
        '',
        `/#accountId=mnw.testnet&publicKey=ed25519:ET2EG9EuUQweAKUfc2rkaiop27fsNscVPEv916rXYX4Q&signature=${encodeURIComponent(sig64)}&state=${SAMPLE_CHALLENGE.challengeId}`,
      );
      expect(consumeNearWalletCallback()).toBeNull();
      expect(closeSpy).toHaveBeenCalledTimes(1);
      expect(consumeRecentNep413PopupResult(SAMPLE_CHALLENGE.challengeId)?.accountId).toBe('mnw.testnet');
      localStorage.removeItem(OAUTH_CALLBACK_STORAGE_KEY);

      // 2) Real signer modal state (`signer-*`) inside a MyNearWallet popup: saves popup result, closes popup, never emits login token
      savePendingNep413Redirect({
        challengeId: 'signer-abcd1234efgh5678',
        callbackUrl: 'http://localhost:3000/play.html',
        walletId: 'my-near-wallet',
      });
      history.replaceState(
        null,
        '',
        `/#accountId=mnw.testnet&publicKey=ed25519:ET2EG9EuUQweAKUfc2rkaiop27fsNscVPEv916rXYX4Q&signature=${encodeURIComponent(sig64)}&state=signer-abcd1234efgh5678`,
      );
      expect(consumeNearWalletCallback()).toBeNull();
      expect(closeSpy).toHaveBeenCalledTimes(2);
      expect(localStorage.getItem(OAUTH_CALLBACK_STORAGE_KEY)).toBeNull();
      expect(consumeRecentNep413PopupResult('signer-abcd1234efgh5678')).toMatchObject({
        accountId: 'mnw.testnet',
        callbackUrl: 'http://localhost:3000/play.html',
      });
    } finally {
      window.name = prevName;
      history.replaceState(null, '', prevHash || '/');
    }
  });

  it('clears ta_fastauth_pkce and sessionStorage NEP-413 keys on PilotAccess.signOut and trade signOut', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    const seedKeys = () => {
      localStorage.setItem(PKCE_STATE_STORAGE_KEY, '[{"stateId":"s1"}]');
      localStorage.setItem(PENDING_NEP413_STORAGE_KEY, '{"challengeId":"c1"}');
      localStorage.setItem(RECENT_NEP413_POPUP_KEY, '{"payload":{}}');
      sessionStorage.setItem(PENDING_NEP413_STORAGE_KEY, '{"challengeId":"c1"}');
      sessionStorage.setItem(RECENT_NEP413_POPUP_KEY, '{"payload":{}}');
    };

    seedKeys();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const access = new PilotAccess(host, { skipRestore: true });
    await access.signOut();
    expect(localStorage.getItem(PKCE_STATE_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(PENDING_NEP413_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(RECENT_NEP413_POPUP_KEY)).toBeNull();
    expect(sessionStorage.getItem(PENDING_NEP413_STORAGE_KEY)).toBeNull();
    expect(sessionStorage.getItem(RECENT_NEP413_POPUP_KEY)).toBeNull();
    access.dispose();

    seedKeys();
    tradeSignOut();
    expect(localStorage.getItem(PKCE_STATE_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(PENDING_NEP413_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(RECENT_NEP413_POPUP_KEY)).toBeNull();
    expect(sessionStorage.getItem(PENDING_NEP413_STORAGE_KEY)).toBeNull();
    expect(sessionStorage.getItem(RECENT_NEP413_POPUP_KEY)).toBeNull();
  });
});

describe('Mainnet vs Testnet wallet account validation, CLI command & sign-message URL parity', () => {
  it('enforces network-specific account IDs across assertNetworkAccountId and isValidCliAccountForNetwork', () => {
    expect(assertNetworkAccountId('Alice.Testnet', 'testnet')).toBe('alice.testnet');
    expect(assertNetworkAccountId('alex.pilots.terraagent.testnet', 'testnet')).toBe(
      'alex.pilots.terraagent.testnet',
    );
    expect(() => assertNetworkAccountId('alice.near', 'testnet')).toThrow(/Mainnet/);

    expect(assertNetworkAccountId('Alice.Near', 'mainnet')).toBe('alice.near');
    expect(assertNetworkAccountId('pilot.tg', 'mainnet')).toBe('pilot.tg');
    expect(assertNetworkAccountId('aurora', 'mainnet')).toBe('aurora');
    expect(assertNetworkAccountId('a'.repeat(64), 'mainnet')).toBe('a'.repeat(64));
    expect(() => assertNetworkAccountId('alice.testnet', 'mainnet')).toThrow(/Testnet/);

    expect(isValidCliAccountForNetwork('alice.testnet', 'testnet')).toBe(true);
    expect(isValidCliAccountForNetwork('alice.near', 'testnet')).toBe(false);
    expect(isValidCliAccountForNetwork('alice.near', 'mainnet')).toBe(true);
    expect(isValidCliAccountForNetwork('pilot.tg', 'mainnet')).toBe(true);
    expect(isValidCliAccountForNetwork('alice.testnet', 'mainnet')).toBe(false);
  });

  it('switches buildCliSignCommand and buildNearWalletSignMessageUrl cleanly between testnet and mainnet', () => {
    const mainnetChallenge: NearAuthChallengeResponse = {
      ...SAMPLE_CHALLENGE,
      recipient: 'terraagent.near',
      network: 'mainnet',
    };
    const mainnetCmd = buildCliSignCommand(mainnetChallenge, 'alice.near');
    expect(mainnetCmd).toContain('network-config mainnet');
    expect(mainnetCmd).toContain('recipient "terraagent.near"');
    expect(mainnetCmd).toContain('sign-as alice.near');

    const testnetUrl = buildNearWalletSignMessageUrl({
      message: 'Sign in',
      recipient: 'terraagent.testnet',
      nonce: SAMPLE_CHALLENGE.nonce,
      callbackUrl: 'https://play.terraagent.fun/landing.html',
      state: 'c-test',
      network: 'testnet',
    });
    expect(testnetUrl.startsWith(`${NEAR_TESTNET_WALLET_URL}/sign-message?`)).toBe(true);

    const mainnetUrl = buildNearWalletSignMessageUrl({
      message: 'Sign in',
      recipient: 'terraagent.near',
      nonce: SAMPLE_CHALLENGE.nonce,
      callbackUrl: 'https://play.terraagent.fun/landing.html',
      state: 'c-main',
      network: 'mainnet',
    });
    expect(mainnetUrl.startsWith(`${NEAR_MAINNET_WALLET_URL}/sign-message?`)).toBe(true);
  });
});
