import type { Disposable, FeatureContext, GameView } from '../../core/registry/types';

export type FamilyKey = 'metals' | 'minerals' | 'bio';

export interface SubResourceDef {
  key: string;
  name: string;
  isT1: boolean;
}

export const FAMILY_DEFS: Record<FamilyKey, { label: string; subs: SubResourceDef[] }> = {
  metals: {
    label: 'METALS',
    subs: [
      { key: 'metals.t1', name: 'Iron', isT1: true },
      { key: 'metals.t2', name: 'T2 Metal', isT1: false },
      { key: 'metals.t3', name: 'T3 Metal', isT1: false },
    ],
  },
  minerals: {
    label: 'MINERALS',
    subs: [
      { key: 'minerals.t1', name: 'Silica', isT1: true },
      { key: 'minerals.t2', name: 'T2 Mineral', isT1: false },
      { key: 'minerals.t3', name: 'T3 Mineral', isT1: false },
    ],
  },
  bio: {
    label: 'BIO',
    subs: [
      { key: 'bio.water', name: 'Water', isT1: true },
      { key: 'bio.biomass', name: 'Biomass', isT1: true },
      { key: 'bio.t2', name: 'T2 Bio', isT1: false },
      { key: 'bio.t3', name: 'T3 Bio', isT1: false },
    ],
  },
};

interface FamilyElements {
  chip: HTMLElement;
  stockEl: HTMLElement;
  rateEl: HTMLElement;
  breakdownEl: HTMLElement;
}

export class ResourcesHud implements Disposable {
  readonly root: HTMLElement;
  private energyEl: { chip: HTMLElement; stockEl: HTMLElement; rateEl: HTMLElement };
  private families: Record<FamilyKey, FamilyElements>;

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

    chip.append(label, stockEl, rateEl);
    container.appendChild(chip);
    return { chip, stockEl, rateEl };
  }

  private createFamilyChip(container: HTMLElement, family: FamilyKey): FamilyElements {
    const def = FAMILY_DEFS[family];
    const chip = document.createElement('div');
    chip.className = 'ta-res-chip';
    chip.setAttribute('data-family', family);
    chip.setAttribute('data-capped', 'false');

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

    chip.append(label, stockEl, rateEl, breakdownEl);
    container.appendChild(chip);
    return { chip, stockEl, rateEl, breakdownEl };
  }

  update(view: GameView): void {
    const v = (view ?? {}) as Record<string, unknown>;
    const colonies = Array.isArray(v.colonies) ? v.colonies : [];
    const col = (colonies[0] ?? v.colony ?? v) as Record<string, unknown>;
    const stock = ((col.stock ?? v.stock ?? {}) as Record<string, number>);
    const caps = ((col.caps ?? v.caps ?? {}) as Record<string, number>);
    const prod = (col.production ?? v.production ?? {}) as Record<string, unknown>;
    const famIncome = ((prod.familyIncomePerS ?? {}) as Record<string, number>);
    const subIncome = ((prod.incomePerS ?? {}) as Record<string, number>);

    for (const f of ['metals', 'minerals', 'bio'] as const) {
      this.updateFamily(f, stock, caps, famIncome, subIncome);
    }
    this.updateEnergy(col, v);
  }

  private updateFamily(
    family: FamilyKey,
    stock: Record<string, number>,
    caps: Record<string, number>,
    famIncome: Record<string, number>,
    subIncome: Record<string, number>,
  ): void {
    const def = FAMILY_DEFS[family];
    const el = this.families[family];
    let totStock = 0;
    for (const s of def.subs) totStock += (stock[s.key] ?? 0);

    const cap = typeof caps[family] === 'number' ? caps[family] : 500;
    const income = typeof famIncome[family] === 'number' ? famIncome[family] : 0;
    const isCapped = cap > 0 && totStock >= cap - 1e-6;

    el.chip.setAttribute('data-capped', String(isCapped));
    el.chip.classList.toggle('ta-res-chip--capped', isCapped);
    el.stockEl.textContent = `${Math.floor(totStock)} / ${Math.floor(cap)}`;
    el.rateEl.textContent = `${income >= 0 ? '+' : ''}${income.toFixed(1)}/s`;

    el.breakdownEl.replaceChildren();
    const hdr = document.createElement('div');
    hdr.className = 'ta-res-breakdown__header';
    hdr.textContent = `${def.label} TIERS`;
    el.breakdownEl.appendChild(hdr);

    for (const s of def.subs) {
      const val = Math.floor(stock[s.key] ?? 0);
      const rate = typeof subIncome[s.key] === 'number' ? subIncome[s.key] : 0;
      const isLocked = !s.isT1 && val <= 0 && rate <= 0;

      const row = document.createElement('div');
      row.className = 'ta-res-breakdown__row' + (isLocked ? ' ta-res-tier--locked' : '');
      row.setAttribute('data-res', s.key);
      row.setAttribute('data-locked', String(isLocked));

      const name = document.createElement('span');
      name.className = 'ta-res-breakdown__name';
      name.textContent = s.name;

      const amt = document.createElement('span');
      amt.className = 'ta-res-breakdown__amount';
      amt.textContent = String(val);

      const rateSpan = document.createElement('span');
      rateSpan.className = 'ta-res-breakdown__rate';
      rateSpan.textContent = `${rate >= 0 ? '+' : ''}${rate.toFixed(1)}/s`;

      row.append(name, amt, rateSpan);
      el.breakdownEl.appendChild(row);
    }
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
  }

  dispose(): void {
    this.root.remove();
  }
}
