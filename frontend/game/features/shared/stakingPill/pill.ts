import type { EvaluatedStakerPerksV2 } from '@terra/contracts';
import { feePillView, fetchApy, fetchPerks, pillView, STAKING_HREF, type PillFetch, type PillQuery } from './model';
import './stakingPill.css';

export interface StakingPillOptions {
  readonly doFetch?: PillFetch;
  readonly query: () => PillQuery;
  /** Called with the fresh perks (or `null` when hidden) so a page can drive its fee pill from the same fetch. */
  readonly onPerks?: (perks: EvaluatedStakerPerksV2 | null, accountId?: string | null) => void;
}

const defaultFetch: PillFetch = (input, init) => fetch(input, init);

/**
 * `⚡ TIER N · APY` pill (anchor to `/me.html#staking`). Hidden until perks answer; stays hidden when the W28 wave is
 * off (perks 404) or nobody can be asked about (no account / colony). `refresh()` refetches perks and APY.
 */
export class StakingPill {
  readonly el: HTMLAnchorElement;
  private readonly doFetch: PillFetch;
  private disposed = false;

  constructor(private readonly opts: StakingPillOptions) {
    this.doFetch = opts.doFetch ?? defaultFetch;
    this.el = document.createElement('a');
    this.el.className = 'ta-stake-pill';
    this.el.href = STAKING_HREF;
    this.el.dataset.testid = 'staking-pill';
    this.el.hidden = true;
  }

  async refresh(): Promise<void> {
    const res = await fetchPerks(this.doFetch, this.opts.query());
    if (this.disposed) return;
    if (res.status !== 'ok') {
      this.el.hidden = true;
      this.opts.onPerks?.(null);
      return;
    }
    const apy = await fetchApy(this.doFetch);
    if (this.disposed) return;
    this.draw(res.data.perks, apy);
    this.opts.onPerks?.(res.data.perks, res.data.accountId);
  }

  private draw(perks: EvaluatedStakerPerksV2, apy: Parameters<typeof pillView>[1]): void {
    const v = pillView(perks, apy);
    this.el.hidden = false;
    this.el.dataset.tier = String(v.tier);
    this.el.dataset.source = apy.source;
    this.el.title = v.title;
    const label = document.createElement('span');
    label.className = 'ta-stake-pill__label';
    label.textContent = v.label;
    const apyEl = document.createElement('b');
    apyEl.className = 'ta-stake-pill__apy';
    apyEl.dataset.testid = 'staking-pill-apy';
    apyEl.textContent = `· ${v.apyText}`;
    const parts: HTMLElement[] = [label, apyEl];
    if (v.sim) {
      const sim = document.createElement('i');
      sim.className = 'ta-stake-pill__sim';
      sim.dataset.testid = 'staking-pill-sim';
      sim.textContent = 'Sim';
      parts.push(sim);
    }
    this.el.replaceChildren(...parts);
  }

  dispose(): void {
    this.disposed = true;
    this.el.remove();
  }
}

/** `FEE 0.65%` pill with a warmup countdown (`FEE 0.65% → 0.50% in 3h 12m`); call `update` on a timer to tick it. */
export class FeePill {
  readonly el: HTMLElement;
  private perks: EvaluatedStakerPerksV2 | null = null;

  constructor(private readonly now: () => number = Date.now) {
    this.el = document.createElement('span');
    this.el.className = 'ta-fee-pill';
    this.el.dataset.testid = 'trade-fee-pill';
    this.el.hidden = true;
  }

  update(perks: EvaluatedStakerPerksV2 | null = this.perks): void {
    this.perks = perks;
    if (!perks) { this.el.hidden = true; return; }
    const v = feePillView(perks, this.now());
    this.el.hidden = false;
    this.el.textContent = v.text;
    this.el.title = v.title;
    this.el.dataset.warmup = String(v.warmup);
  }
}
