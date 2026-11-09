import type { Disposable, FeatureContext, GameView } from '../../core/registry/types';
import { isGameInputBlocked } from '../../core/input/gameInputBlock';
import { releaseArchetypeThumbs, retainArchetypeThumbs } from '../shared/archetypeThumb';
import { type MenuTier, presentTiers, rememberTier, renderTierBar, setTierVisible } from '../shared/menuCards';
import { createBuildingCard, syncBuildingCard, type BuildingCardRefs } from './buildingCard';
import { buildConstructionCatalog, type BuildingKind } from './catalog';
import { PlacementGhostController, type PlacementGhostState } from './PlacementGhost';

export { formatResourceLabel } from './catalog';

export class ConstructionMenu implements Disposable {
  readonly root: HTMLElement;
  readonly ghost: PlacementGhostController;
  private readonly headBtn: HTMLButtonElement;
  private readonly tierBar: HTMLElement;
  private readonly cardsContainer: HTMLElement;
  private readonly cardRefs = new Map<BuildingKind, BuildingCardRefs>();
  private pickedTier: MenuTier | null = null;
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
    retainArchetypeThumbs();
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
    this.tierBar = document.createElement('div');
    this.root.appendChild(this.tierBar);

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
    const tier = rememberTier(this.pickedTier, cards);
    this.pickedTier = tier;
    renderTierBar(this.tierBar, 'build', presentTiers(cards), tier, (next) => {
      this.pickedTier = next;
      this.renderCards();
    });
    const activeKinds = new Set(cards.map((c) => c.building));
    for (const [kind, ref] of [...this.cardRefs.entries()]) {
      if (!activeKinds.has(kind)) {
        ref.btn.remove();
        ref.tip.remove(); // an open tip is parked on document.body (`bindCardTip`)
        this.cardRefs.delete(kind);
      }
    }
    for (const card of cards) {
      let ref = this.cardRefs.get(card.building);
      if (!ref) {
        ref = createBuildingCard(card, (building) => this.activateCard(building));
        this.cardRefs.set(card.building, ref);
        this.cardsContainer.appendChild(ref.btn);
      }
      syncBuildingCard(ref, card, this.selectedBuilding === card.building);
      setTierVisible(ref.btn, card.tier === tier);
    }
  }

  dispose(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.onKeyDown);
    }
    this.ghost.dispose();
    for (const ref of this.cardRefs.values()) ref.tip.remove();
    this.root.remove();
    releaseArchetypeThumbs();
  }
}
