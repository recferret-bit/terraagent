import type { FeatureContext, GameView } from '../../core/registry/types';
import { fetchCouncil, postProposal, postVote, readApiErrorCode, type CouncilFetch } from './councilApi';
import { mountCouncilSheet, type CouncilDom } from './councilDom';
import { councilSignature, councilView, mergeProposalPush } from './councilModel';
import { PlanetMenu } from './planetMenu';

export interface CouncilPanelOptions {
  fetchImpl?: CouncilFetch;
}

/** Planet menu → Council. Balance, members, effects, proposals and the create form. */
export class CouncilPanel {
  private readonly menu: PlanetMenu;
  private readonly dom: CouncilDom;
  private payload: unknown = null;
  private errorCode: string | null = null;
  private tick = Number.NaN;
  private treasury: unknown = null;
  private painted = '';
  private sheetOpen = false;
  private readonly offs: Array<() => void> = [];
  private readonly fetchImpl: CouncilFetch;

  constructor(
    host: HTMLElement,
    scope: HTMLElement,
    private readonly ctx: FeatureContext,
    opts: CouncilPanelOptions = {},
  ) {
    this.fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init));
    this.menu = new PlanetMenu(host);
    if (ctx.flags.has('W22')) this.offs.push(this.menu.register({ id: 'council', label: 'Council', open: () => { void this.open(); } }));
    const overlay = ctx.services.hudOverlay ?? scope;
    this.dom = mountCouncilSheet(overlay, {
      close: () => this.close(),
      propose: (kind) => { void this.propose(kind); },
      vote: (id, vote) => { void this.cast(id, vote); },
    });
    ctx.services.registerPlanetMenuItem = (item) => this.menu.register(item);
    ctx.services.openCouncil = (open = true) => { if (open) void this.open(); else this.close(); };
    const offCloser = ctx.services.registerHudCloser?.(() => this.close());
    if (offCloser) this.offs.push(offCloser);
    const offPush = ctx.services.store?.onTreasuryProposal?.((push) => this.onPush(push));
    if (offPush) this.offs.push(offPush);
  }

  open(): Promise<void> {
    this.menu.closeList();
    this.sheetOpen = true;
    this.dom.root.hidden = false;
    return this.refresh();
  }

  close(): void {
    this.sheetOpen = false;
    this.dom.root.hidden = true;
    this.menu.closeList();
  }

  update(view: GameView): void {
    const raw = view as { tick?: unknown; blobs?: { treasury?: unknown } };
    if (typeof raw.tick === 'number') this.tick = raw.tick;
    if (raw.blobs && 'treasury' in raw.blobs) this.treasury = raw.blobs.treasury;
    if (this.sheetOpen) this.paint();
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
    if (this.ctx.services.openCouncil) this.ctx.services.openCouncil = undefined;
    if (this.ctx.services.registerPlanetMenuItem) this.ctx.services.registerPlanetMenuItem = undefined;
    this.menu.dispose();
    this.dom.root.remove();
  }

  private onPush(push: unknown): void {
    this.payload = mergeProposalPush(this.payload, push);
    this.painted = '';
    if (this.sheetOpen) this.paint();
  }

  private paint(): void {
    const view = councilView({
      w22: this.ctx.flags.has('W22'),
      payload: this.payload,
      treasury: this.treasury,
      tick: this.tick,
      errorCode: this.errorCode,
    });
    const sig = councilSignature(view);
    if (sig === this.painted) return;
    this.painted = sig;
    this.dom.paint(view);
  }

  private async refresh(): Promise<void> {
    const planetId = this.planetId();
    if (!planetId) {
      this.paint();
      return;
    }
    try {
      const res = await fetchCouncil(planetId, this.token(), this.fetchImpl);
      if (!res.ok) this.errorCode = (await readApiErrorCode(res)) ?? 'REQUEST_FAILED';
      else {
        this.payload = await res.json();
        this.errorCode = null;
      }
    } catch {
      this.errorCode = 'REQUEST_FAILED';
    }
    this.painted = '';
    this.paint();
  }

  private async propose(kind: string): Promise<void> {
    if (!kind || !await this.send((planetId) => postProposal(planetId, kind, this.token(), this.fetchImpl))) return;
    await this.refresh();
  }

  private async cast(id: string, vote: 'approve' | 'reject'): Promise<void> {
    if (!await this.send((planetId) => postVote(planetId, id, vote, this.token(), this.fetchImpl))) return;
    await this.refresh();
  }

  private async send(run: (planetId: string) => Promise<Response>): Promise<boolean> {
    const planetId = this.planetId();
    if (!planetId) return false;
    try {
      const res = await run(planetId);
      if (!res.ok) {
        this.fail((await readApiErrorCode(res)) ?? 'REQUEST_FAILED');
        return false;
      }
    } catch {
      this.fail('REQUEST_FAILED');
      return false;
    }
    return true;
  }

  private fail(code: string): void {
    this.errorCode = code;
    this.painted = '';
    this.paint();
  }

  private planetId(): string | null {
    return this.ctx.services.session?.planetId() ?? this.ctx.services.store?.currentPlanetId?.() ?? null;
  }

  private token(): string | null {
    const token = this.ctx.services.pilot?.view().accessToken;
    return token ? token : null;
  }
}
