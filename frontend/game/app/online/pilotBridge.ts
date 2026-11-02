import { SocialAuthResponseSchema } from '@terra/contracts';
import type { BootAuthResult, FetchLike } from './bootOnline';
import type { GuestBootTarget } from './guestBoot';

export interface PilotView {
  isGuest: boolean;
  handle: string;
  accountId: string | null;
  accessToken: string;
}

export interface PilotBridgeDeps {
  fetch?: FetchLike;
  /** The guest boot target whose `accessToken` the socket sends. Null on scenario flows with no guest. */
  target(): GuestBootTarget | null;
}

const GUEST: PilotView = { isGuest: true, handle: 'Guest', accountId: null, accessToken: '' };

/**
 * Pilot state for the identity chip. `loginSocial` posts `/v1/auth/social` and writes the new access token onto the
 * session target. It does not reload the page and does not send `reauth` (the open socket keeps its token until the
 * transport's own renewal; an upgrade is the same player).
 */
export class PilotBridge {
  private state: PilotView = { ...GUEST };
  private readonly listeners = new Set<() => void>();

  constructor(private readonly deps: PilotBridgeDeps) {}

  /** Live access token: the target wins once a boot or a refresh has stored one. */
  view(): PilotView {
    const live = this.deps.target()?.accessToken ?? '';
    return { ...this.state, accessToken: live || this.state.accessToken };
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
    const accessToken = this.view().accessToken;
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
    const next: PilotView = {
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
    this.emit();
  }

  private emit(): void {
    for (const fn of [...this.listeners]) fn();
  }
}
