import { sendPlanetRequest } from '../../core/net/planetHttp';
import type { FeatureContext } from '../../core/registry/types';
import { ownColonyIndex } from '../shared/colony';
import { fetchBounties, postBounty, postClaim, readApiErrorCode, type BountyFetch } from './bountyApi';
import { mountBountySheet, type BountyDom } from './bountyDom';
import { bountyPostArgs, bountySignature, bountyView, type BountyDraft } from './bountyModel';

export interface BountyBoardOptions {
  fetchImpl?: BountyFetch;
}

const POLL_MS = 4_000;

/** Planet menu → Bounties. Lists, post form, and claim. Both clients read the same GET. */
export class BountyBoard {
  private readonly dom: BountyDom;
  private payload: unknown = null;
  private errorCode: string | null = null;
  private painted = '';
  private sheetOpen = false;
  private gen = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly offs: Array<() => void> = [];
  private readonly fetchImpl: BountyFetch;

  constructor(
    _host: HTMLElement,
    scope: HTMLElement,
    private readonly ctx: FeatureContext,
    opts: BountyBoardOptions = {},
  ) {
    this.fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init));
    if (ctx.flags.has('W22')) this.register(ctx);
    const overlay = ctx.services.hudOverlay ?? scope;
    this.dom = mountBountySheet(overlay, {
      close: () => this.close(),
      post: (draft) => {
        void this.post(draft);
      },
      claim: (id) => {
        void this.claim(id);
      },
    });
    const offCloser = ctx.services.registerHudCloser?.(() => this.close());
    if (offCloser) this.offs.push(offCloser);
  }

  open(): Promise<void> {
    this.sheetOpen = true;
    this.dom.root.hidden = false;
    this.armPoll();
    return this.refresh();
  }

  close(): void {
    this.sheetOpen = false;
    this.dom.root.hidden = true;
    this.stopPoll();
  }

  dispose(): void {
    this.stopPoll();
    for (const off of this.offs) off();
    this.offs.length = 0;
    this.dom.root.remove();
  }

  private register(ctx: FeatureContext): void {
    const off = ctx.services.registerPlanetMenuItem?.({
      id: 'bounties',
      label: 'Bounties',
      open: () => {
        void this.open();
      },
    });
    if (off) this.offs.push(off);
  }

  private armPoll(): void {
    this.stopPoll();
    this.timer = setInterval(() => {
      void this.refresh();
    }, POLL_MS);
  }

  private stopPoll(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private paint(): void {
    const view = bountyView({ w22: this.ctx.flags.has('W22'), payload: this.payload, errorCode: this.errorCode });
    const sig = bountySignature(view);
    if (sig === this.painted) return;
    this.painted = sig;
    this.dom.paint(view);
  }

  private async refresh(): Promise<void> {
    if (!this.sheetOpen) return;
    const planetId = this.planetId();
    if (!planetId) {
      this.paint();
      return;
    }
    const gen = ++this.gen;
    try {
      const res = await fetchBounties(planetId, this.token(), this.fetchImpl);
      if (gen !== this.gen || !this.sheetOpen) return;
      if (!res.ok) this.errorCode = (await readApiErrorCode(res)) ?? 'REQUEST_FAILED';
      else {
        this.payload = await res.json();
        this.errorCode = null;
      }
    } catch {
      if (gen !== this.gen || !this.sheetOpen) return;
      this.errorCode = 'REQUEST_FAILED';
    }
    this.painted = '';
    this.paint();
  }

  private async post(draft: BountyDraft): Promise<void> {
    const args = bountyPostArgs(draft, Date.now());
    if (!args) {
      this.fail('invalid_args');
      return;
    }
    const colony = this.poster();
    const ok = await this.send((planetId) =>
      postBounty(planetId, { ...colony, ...args }, this.token(), this.fetchImpl),
    );
    if (ok) await this.refresh();
  }

  private async claim(id: string): Promise<void> {
    const colony = this.poster();
    const ok = await this.send((planetId) => postClaim(planetId, id, colony, this.token(), this.fetchImpl));
    if (ok) await this.refresh();
  }

  private send(run: (planetId: string) => Promise<Response>): Promise<boolean> {
    return sendPlanetRequest(this.planetId(), run, (code) => this.fail(code));
  }

  private fail(code: string): void {
    this.errorCode = code;
    this.painted = '';
    this.paint();
  }

  private planetId(): string | null {
    return this.ctx.services.session?.planetId() ?? this.ctx.services.store?.currentPlanetId?.() ?? null;
  }

  private poster(): { colonyId: string; colonyIndex: number } {
    const colonyIndex = ownColonyIndex(this.ctx.services);
    const home = this.ctx.services.session?.colonyId?.();
    return { colonyId: home && home.length > 0 ? home : `col_${colonyIndex}`, colonyIndex };
  }

  private token(): string | null {
    const token = this.ctx.services.pilot?.view().accessToken;
    return token ? token : null;
  }
}
