import { SocialAuthResponseSchema } from '@terra/contracts';
import { authenticateFastAuthEmailPopup } from '../../../design/pilot/fastAuthSpa';
import {
  OAUTH_CALLBACK_STORAGE_KEY,
  OAUTH_ERROR_STORAGE_KEY,
  PKCE_STATE_STORAGE_KEY,
} from '../../../design/pilot/mockToken';
import {
  decodeNep413SocialToken,
  extractAuthApiErrorMessage,
  PENDING_NEP413_STORAGE_KEY,
  RECENT_NEP413_POPUP_KEY,
} from '../../../design/pilot/nearAuthApi';
import { signOutNearWalletSelector } from '../../../design/pilot/walletSelectorRuntime';
import type { BootAuthResult, FetchLike } from './bootOnline';
import type { GuestBootTarget } from './guestBoot';
import { createRelayWatch, type RelayWatch } from './relayWatch';

interface PilotState {
  isGuest: boolean;
  handle: string;
  accountId: string | null;
  accessToken: string;
}

export interface PilotView extends PilotState {
  /** Bumps only when `loginSocial` links a pilot. The orbit chip starts a poll on the increase. */
  saveEpoch: number;
}

export interface PilotBridgeDeps {
  fetch?: FetchLike;
  /** The guest boot target whose `accessToken` the socket sends. Null on scenario flows with no guest. */
  target(): GuestBootTarget | null;
  /** Scenario flows have no guest target. Their dev token is the bearer until social login stores a JWT. */
  sessionToken?(): string;
}

const GUEST: PilotState = { isGuest: true, handle: 'Guest', accountId: null, accessToken: '' };

/**
 * Pilot state for the identity chip. `loginSocial` posts `/v1/auth/social` and writes the new access token onto the
 * session target. It does not reload the page and does not send `reauth` (the open socket keeps its token until the
 * transport's own renewal; an upgrade is the same player).
 */
export class PilotBridge {
  private state: PilotState = { ...GUEST };
  private readonly listeners = new Set<() => void>();
  private saveEpoch = 0;

  constructor(private readonly deps: PilotBridgeDeps) {}

  /** Live access token: the target wins once a boot or a refresh has stored one. */
  view(): PilotView {
    const live = this.deps.target()?.accessToken ?? '';
    const session = this.deps.sessionToken?.() ?? '';
    return { ...this.state, accessToken: live || this.state.accessToken || session, saveEpoch: this.saveEpoch };
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  /** Boot (and a later re-boot) seeds the chip. Omitted `isGuest` is already normalised to true on the result. */
  note(boot: BootAuthResult): void {
    this.state = {
      isGuest: boot.isGuest,
      handle: boot.handle,
      accountId: boot.accountId ?? null,
      accessToken: boot.accessToken,
    };
    this.emit();
  }

  async loginSocial(
    provider: 'google' | 'x' | 'fastauth' | 'email' | 'near-wallet',
    token: string,
    options?: { readonly mode?: 'signin' | 'signup' },
  ): Promise<void> {
    let resolvedToken = token;
    if (provider === 'email' && token.includes('@') && !token.includes(':') && token.split('.').length !== 3) {
      resolvedToken = (await authenticateFastAuthEmailPopup({ email: token, mode: options?.mode })).idToken;
    }
    const accessToken = this.view().accessToken || this.deps.sessionToken?.() || '';
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const doFetch: FetchLike = this.deps.fetch ?? ((input, init) => fetch(input, init));
    const nep413 = decodeNep413SocialToken(resolvedToken);
    const endpoint = nep413 ? '/v1/auth/near/verify' : '/v1/auth/social';
    const res = await doFetch(endpoint, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify(nep413 ?? { provider, token: resolvedToken }),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => null);
      const detail = extractAuthApiErrorMessage(errBody, '');
      throw new Error(`POST ${endpoint}: ${res.status}${detail ? ` — ${detail}` : ''}`);
    }
    const parsed = SocialAuthResponseSchema.safeParse(await res.json());
    if (!parsed.success) throw new Error('POST /v1/auth/social: unexpected answer');
    const body = parsed.data;
    const next: PilotState = {
      isGuest: body.player.isGuest,
      handle: body.player.handle,
      accountId: body.accountId,
      accessToken: body.accessToken,
    };
    this.deps.target()?.applyLinkedSession({
      accessToken: body.accessToken,
      expiresIn: body.expiresIn,
      isGuest: body.player.isGuest,
      handle: body.player.handle,
      accountId: body.accountId,
      playerId: body.player.id,
    });
    try {
      const ls = (globalThis as unknown as { localStorage?: Storage }).localStorage;
      ls?.setItem(
        'ta_active_pilot',
        JSON.stringify({
          playerId: body.player.id,
          accessToken: body.accessToken,
          updatedAt: Date.now(),
          isGuest: body.player.isGuest,
          handle: body.player.handle,
          accountId: body.accountId,
        }),
      );
      if (body.player.isGuest === false) {
        ls?.setItem('ta_trade_token', body.accessToken);
      }
    } catch {
      /* ignore */
    }
    this.state = next;
    this.saveEpoch += 1;
    this.emit();
  }

  async logout(): Promise<void> {
    const doFetch: FetchLike = this.deps.fetch ?? ((input, init) => fetch(input, init));
    void signOutNearWalletSelector().catch(() => undefined);
    try {
      await doFetch('/v1/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {
      /* ignore */
    }
    try {
      const ls = (globalThis as unknown as { localStorage?: Storage }).localStorage;
      ls?.removeItem('ta_active_pilot');
      ls?.removeItem('ta_trade_token');
      ls?.removeItem(OAUTH_CALLBACK_STORAGE_KEY);
      ls?.removeItem(OAUTH_ERROR_STORAGE_KEY);
      ls?.removeItem(PKCE_STATE_STORAGE_KEY);
      ls?.removeItem(PENDING_NEP413_STORAGE_KEY);
      ls?.removeItem(RECENT_NEP413_POPUP_KEY);
    } catch {
      /* ignore */
    }
    try {
      const ss = (globalThis as unknown as { sessionStorage?: Storage }).sessionStorage;
      ss?.removeItem(PENDING_NEP413_STORAGE_KEY);
      ss?.removeItem(RECENT_NEP413_POPUP_KEY);
    } catch {
      /* ignore */
    }
    this.state = { ...GUEST };
    this.emit();
  }

  /** Deposit poll and retry. Uses the same `fetch` as social login so a spec can fake both. */
  watchRelay(): RelayWatch {
    const doFetch: FetchLike = this.deps.fetch ?? ((input, init) => fetch(input, init));
    return createRelayWatch(doFetch, () => this.view().accessToken);
  }

  private emit(): void {
    for (const fn of [...this.listeners]) fn();
  }
}
