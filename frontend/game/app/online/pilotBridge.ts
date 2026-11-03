import { SocialAuthResponseSchema } from '@terra/contracts';
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
    return { ...this.state, accessToken: live || this.state.accessToken, saveEpoch: this.saveEpoch };
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

  async loginSocial(provider: 'google' | 'x', token: string): Promise<void> {
    const accessToken = this.view().accessToken || this.deps.sessionToken?.() || '';
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const doFetch: FetchLike = this.deps.fetch ?? ((input, init) => fetch(input, init));
    const res = await doFetch('/v1/auth/social', {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ provider, token }),
    });
    if (!res.ok) throw new Error(`POST /v1/auth/social: ${res.status}`);
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
    this.state = next;
    this.saveEpoch += 1;
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
