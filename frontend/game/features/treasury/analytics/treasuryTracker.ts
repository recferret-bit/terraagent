/** Consent-gated `track` (`ctx.services.track`). Without consent the client drops the call. */
export type TrackLike = (name: string, props?: Record<string, string | number | boolean | null>) => void;

/**
 * Names registered on the treasury feature. The client sends only `council_opened`.
 * `proposal_created` and `vote_cast` are inserted by the server (one writer each, BE-89).
 */
export const TREASURY_EVENTS = ['council_opened', 'proposal_created', 'vote_cast'] as const;

/** The only Council event this client writes. */
export const TREASURY_CLIENT_EVENTS = ['council_opened'] as const;

/** The only place the Council sheet names `council_opened`. Props are empty: no account, colony or wallet id. */
export class TreasuryTracker {
  constructor(private readonly track: TrackLike | undefined) {}

  councilOpened(): void {
    this.track?.('council_opened');
  }
}
