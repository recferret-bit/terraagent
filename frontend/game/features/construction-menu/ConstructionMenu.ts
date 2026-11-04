import type { Disposable, FeatureContext, GameView } from '../../core/registry/types';
import { buildConstructionCatalog, type BuildingCardModel, type BuildingKind } from './catalog';
import { PlacementGhostController, type PlacementGhostState } from './PlacementGhost';
import { isGameInputBlocked } from '../../core/input/gameInputBlock';

const RESOURCE_LABELS: Record<string, string> = {
  'metals.t1': 'Metals',
  'minerals.t1': 'Minerals',
  'bio.biomass': 'Biomass',
  'bio.water': 'Water',
};

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function formatResourceLabel(res: string): string {
  if (RESOURCE_LABELS[res]) return RESOURCE_LABELS[res];
  const parts = res.split('.');
  const last = parts[parts.length - 1];
  return last.charAt(0).toUpperCase() + last.slice(1);
}

interface CardDomRefs {
  btn: HTMLButtonElement;
  title: HTMLElement;
  footprint: HTMLElement;
  time: HTMLElement;
  power: HTMLElement;
  costs: HTMLElement;
  costKey: string;
  reason: HTMLElement | null;
  unlockDetail: HTMLElement | null;
  card: BuildingCardModel;
}

export class ConstructionMenu implements Disposable {
  readonly root: HTMLElement;
  readonly ghost: PlacementGhostController;
  private readonly headBtn: HTMLButtonElement;
  private readonly cardsContainer: HTMLElement;
  private readonly cardRefs = new Map<BuildingKind, CardDomRefs>();
  private isOpen = true;
  private view?: GameView;
  selectedBuilding: BuildingKind | null = null;
  private readonly onKeyDown: (e: KeyboardEvent) => void;
  private readonly externalStartPlacement?: (building: BuildingKind) => void;

  constructor(
    private readonly el: HTMLElement,
    private readonly ctx: FeatureContext,
    initialView?: GameView,
  ) {
    const storeLatest = (ctx.services.store as { latest?: GameView | null } | undefined)?.latest ?? undefined;
    this.view = initialView ?? ctx.services.getView?.() ?? storeLatest;
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

    this.onKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'b' || e.key === 'B') && !isGameInputBlocked()) {
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
        this.toggle();
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.onKeyDown);
    }

    this.ghost = new PlacementGhostController({
      container: this.root,
      ctx: this.ctx,
      initialView: this.view,
      onCancel: () => {
        this.selectedBuilding = null;
        this.renderCards();
      },
      onConfirm: () => {
        this.selectedBuilding = null;
        this.renderCards();
      },
    });

    this.cardsContainer = document.createElement('div');
    this.cardsContainer.className = 'ta-construction__cards';
    this.cardsContainer.setAttribute('data-cards', '');
    this.root.appendChild(this.cardsContainer);

    this.el.appendChild(this.root);

    this.externalStartPlacement = this.ctx.services.startPlacement;
    this.ctx.services.startPlacement = (building) => {
      this.startPlacement(building);
      if (this.externalStartPlacement && this.externalStartPlacement !== this.ctx.services.startPlacement) {
        this.externalStartPlacement(building as BuildingKind);
      }
    };
    const s = this.ctx.services as unknown as Record<string, unknown>;
    s.setHoverTile = (q: number, r: number) => this.setHoverTile(q, r);
    s.rotate = () => this.rotate();
    s.confirm = () => this.confirm();
    s.cancel = () => this.cancel();
    s.getGhostState = () => this.getGhostState();
    s.setPlacementHoverTile = (q: number, r: number) => this.setHoverTile(q, r);
    s.rotatePlacement = () => this.rotate();
    s.confirmPlacement = () => this.confirm();
    s.cancelPlacement = () => this.cancel();
    s.getPlacementGhostState = () => this.getGhostState();

    this.renderCards();
  }

  startPlacement(building: BuildingKind | string): void {
    if (this.ctx.services.hubPlacement?.isPlacementActive?.()) {
      this.ctx.services.hubPlacement.cancelPlacement();
    }
    this.selectedBuilding = building as BuildingKind;
    this.setOpen(true);
    this.ghost.start(building);
    this.renderCards();
  }

  setHoverTile(q: number, r: number): void {
    this.ghost.setHoverTile(q, r);
  }

  rotate(): void {
    this.ghost.rotate();
  }

  confirm(): boolean {
    return this.ghost.confirm();
  }

  cancel(): void {
    this.ghost.cancel();
  }

  getGhostState(): PlacementGhostState | null {
    return this.ghost.getState();
  }

  setOpen(open: boolean): void {
    this.isOpen = open;
    this.root.dataset.open = String(open);
    this.headBtn.setAttribute('aria-expanded', String(open));
    if (open) {
      const dock = this.root.closest?.('[data-testid="command-dock"]');
      const buildTab = dock?.querySelector<HTMLButtonElement>('[data-testid="dock-tab-build"]');
      if (buildTab && buildTab.getAttribute('data-active') !== 'true') {
        buildTab.click();
      }
    }
  }

  toggle(): void {
    this.setOpen(!this.isOpen);
  }

  update(view: GameView): void {
    this.view = view;
    this.ghost.updateView(view);
    this.renderCards();
  }

  private activateCard(building: BuildingKind): void {
    this.startPlacement(building);
    if (this.externalStartPlacement && this.externalStartPlacement !== this.ctx.services.startPlacement) {
      this.externalStartPlacement(building);
    }
  }

  private renderCards(): void {
    const cards = buildConstructionCatalog(this.ctx.flags, this.view);
    const activeKinds = new Set(cards.map((c) => c.building));
    for (const [kind, ref] of [...this.cardRefs.entries()]) {
      if (!activeKinds.has(kind)) {
        ref.btn.remove();
        this.cardRefs.delete(kind);
      }
    }
    for (const card of cards) {
      let ref = this.cardRefs.get(card.building);
      if (!ref) {
        ref = this.createCardDom(card);
        this.cardRefs.set(card.building, ref);
        this.cardsContainer.appendChild(ref.btn);
      }
      this.syncCardDom(ref, card);
    }
  }

  private createCardDom(card: BuildingCardModel): CardDomRefs {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ta-construction__card plate-sm';
    btn.setAttribute('data-building', card.building);

    const headRow = document.createElement('div');
    headRow.className = 'ta-construction__card-head';

    const title = document.createElement('span');
    title.className = 'ta-construction__title';

    const footprint = document.createElement('span');
    footprint.className = 'ta-construction__footprint';
    headRow.append(title, footprint);

    const metaRow = document.createElement('div');
    metaRow.className = 'ta-construction__meta';

    const time = document.createElement('span');
    time.className = 'ta-construction__time';

    const power = document.createElement('span');
    power.className = 'ta-construction__power';
    metaRow.append(time, power);

    const costs = document.createElement('div');
    costs.className = 'ta-construction__costs';

    btn.append(headRow, metaRow, costs);

    const ref: CardDomRefs = {
      btn,
      title,
      footprint,
      time,
      power,
      costs,
      costKey: '',
      reason: null,
      unlockDetail: null,
      card,
    };

    let pointerDownAt = -Infinity;
    (btn as unknown as { onpointerdown?: (e?: PointerEvent) => void }).onpointerdown = (e?: PointerEvent) => {
      if (e && typeof e.button === 'number' && e.button !== 0) return;
      if (ref.card.disabled) return;
      pointerDownAt = now();
      this.activateCard(ref.card.building);
    };
    btn.onclick = () => {
      if (now() - pointerDownAt < 400) {
        pointerDownAt = -Infinity;
        return;
      }
      if (ref.card.disabled) return;
      this.activateCard(ref.card.building);
    };

    return ref;
  }

  private syncCardDom(ref: CardDomRefs, card: BuildingCardModel): void {
    ref.card = card;
    const disabledStr = String(card.disabled);
    if (ref.btn.getAttribute('data-disabled') !== disabledStr) {
      ref.btn.setAttribute('data-disabled', disabledStr);
    }
    if (ref.btn.disabled !== card.disabled) {
      ref.btn.disabled = card.disabled;
    }

    const isSelected = this.selectedBuilding === card.building;
    if (isSelected) {
      if (ref.btn.getAttribute('data-selected') !== 'true') {
        ref.btn.setAttribute('data-selected', 'true');
      }
    } else if (ref.btn.getAttribute('data-selected') !== null) {
      if (typeof ref.btn.removeAttribute === 'function') {
        ref.btn.removeAttribute('data-selected');
      } else {
        ref.btn.setAttribute('data-selected', 'false');
      }
    }

    if (ref.title.textContent !== card.label) ref.title.textContent = card.label;
    if (ref.footprint.textContent !== card.footprintText) ref.footprint.textContent = card.footprintText;

    const timeText = `${card.designBuildS}s (${card.hqBuildS}s HQ)`;
    if (ref.time.textContent !== timeText) ref.time.textContent = timeText;
    if (ref.power.textContent !== card.powerText) ref.power.textContent = card.powerText;

    const costEntries = Object.entries(card.cost).filter(([, amt]) => amt > 0);
    const costKey = costEntries.map(([r, a]) => `${r}:${a}`).join('|');
    if (ref.costKey !== costKey) {
      ref.costKey = costKey;
      ref.costs.replaceChildren();
      for (const [res, amt] of costEntries) {
        const pill = document.createElement('span');
        pill.className = 'ta-construction__cost-pill';
        pill.textContent = `${amt} ${formatResourceLabel(res)}`;
        ref.costs.appendChild(pill);
      }
    }

    if (card.disabled && card.disabledReason) {
      if (!ref.reason) {
        ref.reason = document.createElement('span');
        ref.reason.className = 'ta-construction__reason';
        ref.btn.appendChild(ref.reason);
      }
      if (ref.reason.textContent !== card.disabledReason) {
        ref.reason.textContent = card.disabledReason;
      }
    } else if (ref.reason) {
      ref.reason.remove();
      ref.reason = null;
    }

    this.syncCardLockState(ref, card);
  }

  private syncCardLockState(ref: CardDomRefs, card: BuildingCardModel): void {
    const nextClass = card.stageLocked ? 'ta-construction__card plate-sm is-stage-locked' : 'ta-construction__card plate-sm';
    if (ref.btn.className !== nextClass) {
      ref.btn.className = nextClass;
    }
    ref.btn.setAttribute('data-unlock-stage', String(card.unlockStage));

    if (card.stageLocked) {
      ref.btn.setAttribute('data-stage-locked', 'true');
      const cond = card.unlockConditionText ?? card.disabledReason ?? '';
      const detail = card.unlockDetailText ?? cond;
      const fullTooltip = detail && detail !== cond ? `${cond} (${detail})` : cond;
      ref.btn.setAttribute('title', fullTooltip);
      ref.btn.setAttribute('aria-label', `${card.label} — ${fullTooltip}`);
      ref.btn.setAttribute('data-unlock-detail', detail);
      if (detail && detail !== card.disabledReason) {
        if (!ref.unlockDetail) {
          ref.unlockDetail = document.createElement('span');
          ref.unlockDetail.className = 'ta-construction__unlock-detail';
          ref.btn.appendChild(ref.unlockDetail);
        }
        if (ref.unlockDetail.textContent !== detail) {
          ref.unlockDetail.textContent = detail;
        }
      } else if (ref.unlockDetail) {
        ref.unlockDetail.remove();
        ref.unlockDetail = null;
      }
      return;
    }

    for (const attr of ['data-stage-locked', 'title', 'aria-label', 'data-unlock-detail']) {
      if (typeof ref.btn.removeAttribute === 'function') {
        ref.btn.removeAttribute(attr);
      }
    }
    if (ref.unlockDetail) {
      ref.unlockDetail.remove();
      ref.unlockDetail = null;
    }
  }

  dispose(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.onKeyDown);
    }
    this.ghost.dispose();
    this.root.remove();
  }
}
