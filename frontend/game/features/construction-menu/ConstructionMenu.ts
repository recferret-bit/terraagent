import type { Disposable, FeatureContext, GameView } from '../../core/registry/types';
import { buildConstructionCatalog, type BuildingCardModel, type BuildingKind } from './catalog';

const RESOURCE_LABELS: Record<string, string> = {
  'metals.t1': 'Metals',
  'minerals.t1': 'Minerals',
  'bio.biomass': 'Biomass',
  'bio.water': 'Water',
};

export function formatResourceLabel(res: string): string {
  if (RESOURCE_LABELS[res]) return RESOURCE_LABELS[res];
  const parts = res.split('.');
  const last = parts[parts.length - 1];
  return last.charAt(0).toUpperCase() + last.slice(1);
}

export class ConstructionMenu implements Disposable {
  readonly root: HTMLElement;
  private readonly headBtn: HTMLButtonElement;
  private readonly cardsContainer: HTMLElement;
  private isOpen = true;
  private view?: GameView;
  selectedBuilding: BuildingKind | null = null;
  private readonly onKeyDown: (e: KeyboardEvent) => void;

  constructor(
    private readonly el: HTMLElement,
    private readonly ctx: FeatureContext,
    initialView?: GameView,
  ) {
    this.view = initialView;
    this.root = document.createElement('div');
    this.root.className = 'ta-construction plate-sm';
    this.root.dataset.open = 'true';

    const header = document.createElement('div');
    header.className = 'ta-construction__header';

    this.headBtn = document.createElement('button');
    this.headBtn.type = 'button';
    this.headBtn.className = 'ta-construction__toggle';
    this.headBtn.textContent = 'BUILD [B]';
    this.headBtn.setAttribute('aria-expanded', 'true');
    this.headBtn.onclick = () => this.toggle();
    header.appendChild(this.headBtn);
    this.root.appendChild(header);

    this.cardsContainer = document.createElement('div');
    this.cardsContainer.className = 'ta-construction__cards';
    this.cardsContainer.setAttribute('data-cards', '');
    this.root.appendChild(this.cardsContainer);

    this.el.appendChild(this.root);

    this.onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'b' || e.key === 'B') {
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
        this.toggle();
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.onKeyDown);
    }

    this.renderCards();
  }

  setOpen(open: boolean): void {
    this.isOpen = open;
    this.root.dataset.open = String(open);
    this.headBtn.setAttribute('aria-expanded', String(open));
  }

  toggle(): void {
    this.setOpen(!this.isOpen);
  }

  update(view: GameView): void {
    this.view = view;
    this.renderCards();
  }

  private renderCards(): void {
    this.cardsContainer.replaceChildren();
    const cards = buildConstructionCatalog(this.ctx.flags, this.view);
    for (const card of cards) {
      this.cardsContainer.appendChild(this.createCardElement(card));
    }
  }

  private createCardElement(card: BuildingCardModel): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ta-construction__card plate-sm';
    btn.setAttribute('data-building', card.building);
    btn.setAttribute('data-disabled', String(card.disabled));
    if (card.disabled) {
      btn.disabled = true;
    }
    if (this.selectedBuilding === card.building) {
      btn.setAttribute('data-selected', 'true');
    }

    const headRow = document.createElement('div');
    headRow.className = 'ta-construction__card-head';

    const title = document.createElement('span');
    title.className = 'ta-construction__title';
    title.textContent = card.label;

    const footprint = document.createElement('span');
    footprint.className = 'ta-construction__footprint';
    footprint.textContent = card.footprintText;
    headRow.append(title, footprint);

    const metaRow = document.createElement('div');
    metaRow.className = 'ta-construction__meta';

    const time = document.createElement('span');
    time.className = 'ta-construction__time';
    time.textContent = `${card.designBuildS}s (${card.hqBuildS}s HQ)`;

    const power = document.createElement('span');
    power.className = 'ta-construction__power';
    power.textContent = card.powerText;
    metaRow.append(time, power);

    const costs = document.createElement('div');
    costs.className = 'ta-construction__costs';
    for (const [res, amt] of Object.entries(card.cost)) {
      if (amt <= 0) continue;
      const pill = document.createElement('span');
      pill.className = 'ta-construction__cost-pill';
      pill.textContent = `${amt} ${formatResourceLabel(res)}`;
      costs.appendChild(pill);
    }

    btn.append(headRow, metaRow, costs);

    if (card.disabled && card.disabledReason) {
      const reason = document.createElement('span');
      reason.className = 'ta-construction__reason';
      reason.textContent = card.disabledReason;
      btn.appendChild(reason);
    }

    btn.onclick = () => {
      if (card.disabled) return;
      this.selectedBuilding = card.building;
      this.ctx.services.startPlacement?.(card.building);
      this.renderCards();
    };

    return btn;
  }

  dispose(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.onKeyDown);
    }
    this.root.remove();
  }
}
