import type { Disposable, FeatureContext, GameView } from '../../core/registry/types';
import {
  bindHoverPopover,
  computeResourceFlow,
  FAMILY_DEFS,
  renderFamilyBreakdown,
  renderPowerBreakdown,
  type FamilyKey,
  type ResourceFlowSummary,
  type SubResourceDef,
} from '../hud-min/resourceBreakdown';

export { FAMILY_DEFS, type FamilyKey, type SubResourceDef };

interface FamilyElements {
  chip: HTMLElement;
  stockEl: HTMLElement;
  rateEl: HTMLElement;
  breakdownEl: HTMLElement;
}

export class ResourcesHud implements Disposable {
  readonly root: HTMLElement;
  private energyEl: { chip: HTMLElement; stockEl: HTMLElement; rateEl: HTMLElement; breakdownEl: HTMLElement };
  private families: Record<FamilyKey, FamilyElements>;
  private prevFamilyStock: Record<string, number> = {};

  constructor(
    private readonly parent: HTMLElement,
    _ctx?: FeatureContext,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'ta-resources-hud plate-sm';

    const chips = document.createElement('div');
    chips.className = 'ta-resources-hud__chips';
    this.root.appendChild(chips);

    this.energyEl = this.createEnergyChip(chips);
    this.families = {
      metals: this.createFamilyChip(chips, 'metals'),
      minerals: this.createFamilyChip(chips, 'minerals'),
      bio: this.createFamilyChip(chips, 'bio'),
    };

    this.parent.appendChild(this.root);
  }

  private createEnergyChip(container: HTMLElement) {
    const chip = document.createElement('div');
    chip.className = 'ta-res-chip';
    chip.setAttribute('data-family', 'energy');

    const label = document.createElement('span');
    label.className = 'ta-res-chip__label';
    label.textContent = 'ENERGY';

    const stockEl = document.createElement('b');
    stockEl.className = 'ta-res-chip__stock';
    stockEl.textContent = '+0 / −0 E/s';

    const rateEl = document.createElement('small');
    rateEl.className = 'ta-res-chip__rate';
    rateEl.textContent = '+0 E/s';

    const breakdownEl = document.createElement('div');
    breakdownEl.className = 'ta-res-chip__breakdown plate-sm';
    breakdownEl.setAttribute('data-testid', 'res-breakdown-energy');
    renderPowerBreakdown(breakdownEl, undefined, null, false);

    chip.append(label, stockEl, rateEl, breakdownEl);
    bindHoverPopover(chip);
    container.appendChild(chip);
    return { chip, stockEl, rateEl, breakdownEl };
  }

  private createFamilyChip(container: HTMLElement, family: FamilyKey): FamilyElements {
    const def = FAMILY_DEFS[family];
    const chip = document.createElement('div');
    chip.className = 'ta-res-chip';
    chip.setAttribute('data-family', family);
    chip.setAttribute('data-capped', 'false');
    chip.dataset.trend = 'flat';
    chip.setAttribute('data-trend', 'flat');

    const label = document.createElement('span');
    label.className = 'ta-res-chip__label';
    label.textContent = def.label;

    const stockEl = document.createElement('b');
    stockEl.className = 'ta-res-chip__stock';
    stockEl.textContent = '0 / 500';

    const rateEl = document.createElement('small');
    rateEl.className = 'ta-res-chip__rate';
    rateEl.textContent = '+0.0/s';

    const breakdownEl = document.createElement('div');
    breakdownEl.className = 'ta-res-chip__breakdown plate-sm';
    breakdownEl.setAttribute('data-testid', `res-breakdown-${family}`);
    renderFamilyBreakdown(breakdownEl, family, {}, computeResourceFlow(undefined, undefined, 0));

    chip.append(label, stockEl, rateEl, breakdownEl);
    bindHoverPopover(chip);
    container.appendChild(chip);
    return { chip, stockEl, rateEl, breakdownEl };
  }

  update(view: GameView): void {
    const v = (view ?? {}) as Record<string, unknown>;
    const colonies = Array.isArray(v.colonies) ? v.colonies : [];
    const col = (colonies[0] ?? v.colony ?? v) as Record<string, unknown>;
    const stock = ((col.stock ?? v.stock ?? {}) as Record<string, number>);
    const caps = ((col.caps ?? v.caps ?? {}) as Record<string, number>);
    const flow = computeResourceFlow(col, v, 0);

    for (const f of ['metals', 'minerals', 'bio'] as const) {
      this.updateFamily(f, stock, caps, flow);
    }
    this.updateEnergy(col, v);
  }

  private updateFamily(
    family: FamilyKey,
    stock: Record<string, number>,
    caps: Record<string, number>,
    flow: ResourceFlowSummary,
  ): void {
    const def = FAMILY_DEFS[family];
    const el = this.families[family];
    let totStock = 0;
    for (const s of def.subs) totStock += (stock[s.key] ?? 0);

    const cap = typeof caps[family] === 'number' ? caps[family] : 500;
    const income = flow.familyIncome[family] ?? 0;
    const spending = flow.familySpending[family] ?? 0;
    const totalRate = income - spending;
    const prevStock = this.prevFamilyStock[family];
    const stockDelta = typeof prevStock === 'number' ? totStock - prevStock : 0;
    this.prevFamilyStock[family] = totStock;
    const nearZeroRate = Math.abs(totalRate) <= 0.01;
    const trend: 'up' | 'down' | 'flat' =
      totalRate > 0.01 || (nearZeroRate && stockDelta > 0.01)
        ? 'up'
        : totalRate < -0.01 || (nearZeroRate && stockDelta < -0.01)
          ? 'down'
          : 'flat';
    const isCapped = cap > 0 && totStock >= cap - 1e-6;

    el.chip.dataset.trend = trend;
    el.chip.setAttribute('data-trend', trend);
    el.chip.classList.toggle('ta-resources-hud__chip--up', trend === 'up');
    el.chip.classList.toggle('ta-resources-hud__chip--down', trend === 'down');
    el.chip.setAttribute('data-capped', String(isCapped));
    el.chip.classList.toggle('ta-res-chip--capped', isCapped);
    el.stockEl.textContent = `${Math.floor(totStock)} / ${Math.floor(cap)}`;
    el.rateEl.textContent = `${income >= 0 ? '+' : ''}${income.toFixed(1)}/s`;

    renderFamilyBreakdown(el.breakdownEl, family, stock, flow);
  }

  private updateEnergy(col: Record<string, unknown>, v: Record<string, unknown>): void {
    const blobs = (v.blobs ?? {}) as Record<string, unknown>;
    const powerBlob = (blobs.power ?? {}) as Record<string, unknown>;
    const byColony = (powerBlob.byColony ?? {}) as Record<number, unknown>;
    const power = (col.power ?? byColony[0] ?? v.power) as Record<string, unknown> | undefined;

    if (power && typeof power.supply === 'number') {
      const sup = Math.round(Number(power.supply));
      const dem = Math.round(Number(power.demand ?? 0));
      const net = Math.round(Number(power.net ?? (sup - dem)));
      this.energyEl.stockEl.textContent = `+${sup} / −${dem} E/s`;
      this.energyEl.rateEl.textContent = `${net >= 0 ? '+' : ''}${net} E/s`;
    } else {
      this.energyEl.stockEl.textContent = '+0 / −0 E/s';
      this.energyEl.rateEl.textContent = '+0 E/s';
    }
    renderPowerBreakdown(this.energyEl.breakdownEl, power, null, false);
  }

  dispose(): void {
    this.root.remove();
  }
}
