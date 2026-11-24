import type { Disposable, FeatureContext, GameView } from '../../core/registry/types';
import { noteUiAction } from '../../../design/analytics/ui';
import { isGameInputBlocked } from '../../core/input/gameInputBlock';
import { releaseArchetypeThumbs, retainArchetypeThumbs } from '../shared/archetypeThumb';
import { hideActiveCardTip, type MenuTier, presentTiers, rememberTier, renderTierBar, setTierVisible } from '../shared/menuCards';
import { BUILD_GROUPS, layoutMenuGroups } from '../shared/menuSections';
import { createBuildingCard, syncBuildingCard, type BuildingCardRefs } from './buildingCard';
import { buildConstructionCatalog, type BuildingKind } from './catalog';
import { PlacementGhostController, type PlacementGhostState } from './PlacementGhost';
import { ownColonyIndex } from './sitePlacement';
import { isReadOnlySpectator } from '../shared/colony';

export { formatResourceLabel } from './catalog';

export class ConstructionMenu implements Disposable {
  readonly root: HTMLElement;
  readonly ghost: PlacementGhostController;
  private offCloser: (() => void) | undefined;
  private readonly headBtn: HTMLButtonElement;
  private readonly tierBar: HTMLElement;
  private readonly cardsContainer: HTMLElement;
  private readonly cardRefs = new Map<BuildingKind, BuildingCardRefs>();
  private readonly sectionHeads = new Map<string, HTMLElement>();
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
    this.offCloser = this.ctx.services.registerHudCloser?.(() => this.cancel());
    s.getPlacementGhostState = () => this.getGhostState();

    this.renderCards();
  }

  private isReadOnly(): boolean {
    return isReadOnlySpectator(this.ctx.services);
  }

  startPlacement(building: BuildingKind | string): void {
    if (this.isReadOnly()) return;
    hideActiveCardTip();
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
    if (!open) {
      hideActiveCardTip();
      return;
    }
    const dock = this.root.closest?.('[data-testid="command-dock"]');
    const buildTab = dock?.querySelector<HTMLButtonElement>('[data-testid="dock-tab-build"]');
    if (buildTab && buildTab.getAttribute('data-active') !== 'true') {
      buildTab.click();
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
    if (this.isReadOnly()) return;
    noteUiAction('build', 'select_building', building);
    this.startPlacement(building);
    if (this.externalStartPlacement && this.externalStartPlacement !== this.ctx.services.startPlacement) {
      this.externalStartPlacement(building);
    }
  }

  private renderCards(): void {
    const cards = buildConstructionCatalog(
      this.ctx.flags,
      this.view,
      ownColonyIndex(this.ctx.services),
      this.ctx.services.store?.buildingCatalog?.() ?? null,
    );
    const tier = rememberTier(this.pickedTier, cards);
    this.pickedTier = tier;
    renderTierBar(this.tierBar, 'build', presentTiers(cards), tier, (next) => {
      hideActiveCardTip();
      this.pickedTier = next;
      this.renderCards();
    });
    const activeKinds = new Set(cards.map((c) => c.building));
    for (const [kind, ref] of [...this.cardRefs.entries()]) {
      if (!activeKinds.has(kind)) {
        if (ref.tip.getAttribute?.('data-open') === 'true') hideActiveCardTip();
        ref.btn.remove();
        ref.tip.remove(); // an open tip is parked on document.body (`bindCardTip`)
        this.cardRefs.delete(kind);
      }
    }
    const ro = this.isReadOnly();
    const placed: { key: string; el: HTMLElement }[] = [];
    for (const card of cards) {
      let ref = this.cardRefs.get(card.building);
      if (!ref) {
        ref = createBuildingCard(card, (building) => this.activateCard(building));
        this.cardRefs.set(card.building, ref);
      }
      syncBuildingCard(ref, card, !ro && this.selectedBuilding === card.building);
      if (ro) {
        ref.btn.disabled = true;
        ref.btn.setAttribute('data-disabled', 'true');
      }
      setTierVisible(ref.btn, card.tier === tier);
      placed.push({ key: card.building, el: ref.btn });
    }
    layoutMenuGroups(this.cardsContainer, BUILD_GROUPS, placed, this.sectionHeads);
  }

  dispose(): void {
    hideActiveCardTip();
    this.offCloser?.();
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.onKeyDown);
    }
    this.ghost.dispose();
    for (const ref of this.cardRefs.values()) ref.tip.remove();
    this.root.remove();
    releaseArchetypeThumbs();
  }
}
