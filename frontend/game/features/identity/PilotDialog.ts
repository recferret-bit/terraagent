import { STAGE_TABLE_ROWS, type ViewColony } from '@terra/sim';
import type { FeatureContext, GameView, HudPanelInstance } from '../../core/registry/types';
import { ownColonyIndex, viewColony } from '../shared/colony';
import { mountOrbitStatus } from './orbitStatus';
import {
  addPilotStatCell,
  buildPilotCallsignCard,
  buildPilotDialogFooter,
  buildPilotDialogHeader,
  computePilotMonogram,
  formatColonyStockSummary,
  resolvePilotDeedSummary,
  type PilotCallsignCardEls,
} from './parts/pilotDossierParts';
import { formatColonyOrPilotName, formatPilotDisplayName, mountPilotChip } from './PilotChip';

export class PilotDialog implements HudPanelInstance {
  readonly root: HTMLElement;
  readonly triggerBtn: HTMLButtonElement;
  private readonly cardEl: HTMLElement;
  private readonly detailsColEl: HTMLElement;
  private readonly footerEl: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly statusChipEl: HTMLElement;
  private readonly callsignCard: PilotCallsignCardEls;
  private readonly displayNameValEl: HTMLElement;
  private readonly planetValEl: HTMLElement;
  private readonly colonyValEl: HTMLElement;
  private readonly stageValEl: HTMLElement;
  private readonly terraformValEl: HTMLElement;
  private readonly stockValEl: HTMLElement;
  private readonly chipSectionEl: HTMLElement;
  private readonly pilotInstance: HudPanelInstance;
  private readonly orbitInstance: HudPanelInstance;
  private readonly cleanups: Array<() => void> = [];
  private isOpen = false;

  constructor(
    private readonly paneEl: HTMLElement,
    private readonly ctx: FeatureContext,
  ) {
    const overlay = ctx.services.hudOverlay;

    this.triggerBtn = document.createElement('button');
    this.triggerBtn.type = 'button';
    this.triggerBtn.className = 'btn btn-primary btn-sm ta-pilot-trigger';
    this.triggerBtn.dataset.testid = 'pilot-dialog-trigger';
    this.triggerBtn.dataset.dialogTrigger = 'true';
    this.triggerBtn.setAttribute('aria-expanded', 'false');
    this.triggerBtn.textContent = 'Pilot Profile';
    this.triggerBtn.addEventListener('click', () => this.setOpen(!this.isOpen));

    this.root = document.createElement('div');
    this.root.className = overlay ? 'ta-pilot-modal-backdrop' : 'ta-pilot-inline';
    this.root.dataset.testid = 'pilot-dialog';
    this.root.dataset.open = overlay ? 'false' : 'true';
    if (overlay) this.root.hidden = true;

    this.cardEl = document.createElement('section');
    this.cardEl.className = 'plate ta-pilot-modal';
    this.cardEl.setAttribute('role', 'dialog');
    this.cardEl.setAttribute('aria-modal', 'true');
    this.cardEl.setAttribute('aria-label', 'Pilot Profile');

    const { header, titleEl, statusChipEl } = buildPilotDialogHeader(() => this.setOpen(false));
    this.titleEl = titleEl;
    this.statusChipEl = statusChipEl;

    const bodyEl = document.createElement('div');
    bodyEl.className = 'ta-pilot-modal__body';

    this.callsignCard = buildPilotCallsignCard({
      onOpenDeed: () => this.jumpToColonyDialog('deed'),
      onOpenGoals: () => this.jumpToColonyDialog('goals'),
    });

    this.detailsColEl = document.createElement('div');
    this.detailsColEl.className = 'ta-pilot-modal__details';

    const detailsGrid = document.createElement('div');
    detailsGrid.className = 'ta-pilot-modal__grid';
    this.displayNameValEl = addPilotStatCell(detailsGrid, 'DISPLAY NAME', 'Guest Pilot', 'pilot-stat-name');
    this.planetValEl = addPilotStatCell(detailsGrid, 'ACTIVE PLANET', '—', 'pilot-stat-planet');
    this.colonyValEl = addPilotStatCell(detailsGrid, 'COLONY', '—', 'pilot-stat-colony');
    this.stageValEl = addPilotStatCell(detailsGrid, 'COLONY STAGE', 'S0 Landing', 'pilot-stat-stage');
    this.terraformValEl = addPilotStatCell(detailsGrid, 'TERRAFORM', '0 %', 'pilot-stat-terraform');
    this.stockValEl = addPilotStatCell(detailsGrid, 'COLONY STOCK', '—', 'pilot-stat-stock');

    this.chipSectionEl = document.createElement('div');
    this.chipSectionEl.className = 'ta-pilot-modal__account';
    const acctHdr = document.createElement('span');
    acctHdr.className = 'ta-pilot-modal__stat-label';
    acctHdr.textContent = 'ACCOUNT & ORBIT SYNC';
    this.chipSectionEl.append(acctHdr);
    this.pilotInstance = mountPilotChip(this.chipSectionEl, ctx);
    this.orbitInstance = mountOrbitStatus(this.chipSectionEl, ctx);

    this.detailsColEl.append(detailsGrid);
    bodyEl.append(this.callsignCard.card, this.detailsColEl);

    this.footerEl = buildPilotDialogFooter();
    this.cardEl.append(header, bodyEl, this.footerEl);
    this.root.append(this.cardEl);

    if (overlay) {
      this.paneEl.append(this.chipSectionEl, this.triggerBtn);
      overlay.append(this.root);
      this.bindOverlayEvents();
    } else {
      this.detailsColEl.append(this.chipSectionEl);
      this.paneEl.append(this.root);
    }

    if (ctx.services.pilot) {
      this.cleanups.push(ctx.services.pilot.subscribe(() => this.syncIdentity()));
    }
    this.syncIdentity();
    if (ctx.services.store?.latest) {
      this.update(ctx.services.store.latest as GameView);
    }
  }

  private jumpToColonyDialog(tabId: 'deed' | 'goals'): void {
    const tabBtn = document.querySelector<HTMLButtonElement>(`[data-testid="colony-tab-${tabId}"]`);
    if (tabBtn) {
      tabBtn.click();
      return;
    }
    this.setOpen(false);
    if (tabId === 'deed') {
      (this.ctx.services as { getDeedPanel?: () => { setOpen(v: boolean): void } | null })
        .getDeedPanel?.()
        ?.setOpen(true);
    }
  }

  private bindOverlayEvents(): void {
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.setOpen(false);
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.isOpen) {
        e.preventDefault();
        this.setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    this.cleanups.push(() => window.removeEventListener('keydown', onKey));
    if (this.ctx.services.registerHudCloser) {
      this.cleanups.push(this.ctx.services.registerHudCloser(() => this.setOpen(false)));
    }
  }

  private syncIdentity(): void {
    const view = this.ctx.services.pilot?.view();
    const displayName = formatPilotDisplayName(view?.handle, view?.accountId, view?.isGuest ?? true);
    this.titleEl.textContent = displayName;
    this.displayNameValEl.textContent = displayName;
    this.callsignCard.callsignEl.textContent = displayName;
    this.callsignCard.monogramEl.textContent = computePilotMonogram(displayName);
    const isLinked = Boolean(view && !view.isGuest && view.accountId);
    this.statusChipEl.textContent = isLinked ? 'LINKED PILOT' : 'GUEST SESSION';
    this.statusChipEl.dataset.linked = String(isLinked);
    this.callsignCard.networkEl.textContent = isLinked
      ? `NEAR LINKED · ${(view?.accountId ?? '').endsWith('.near') ? 'MAINNET' : 'TESTNET / MOCK'}`
      : 'LOCAL GUEST SESSION';
    this.callsignCard.deedSummaryEl.textContent = resolvePilotDeedSummary(this.ctx);
    this.triggerBtn.textContent = `Pilot · ${displayName}`;
  }

  setOpen(open: boolean): void {
    const wasOpen = this.isOpen;
    this.isOpen = open;
    this.root.dataset.open = String(open);
    this.triggerBtn.setAttribute('aria-expanded', String(open));
    if (this.ctx.services.hudOverlay) {
      this.root.hidden = !open;
      if (open) {
        this.detailsColEl.append(this.chipSectionEl);
        this.syncIdentity();
      } else if (this.paneEl.isConnected || this.triggerBtn.parentElement === this.paneEl) {
        this.paneEl.insertBefore(this.chipSectionEl, this.triggerBtn);
      }
    }
    if (wasOpen && !open) {
      this.ctx.services.clearHudDialogTab?.('player');
    }
  }

  isOpenState(): boolean {
    return this.isOpen;
  }

  update(view: GameView): void {
    const raw = view as {
      planet?: { id?: string; type?: string };
      colonies?: ReadonlyArray<ViewColony & { terraformBp?: number }>;
    };
    if (raw.planet?.id) {
      this.planetValEl.textContent = raw.planet.type ? `${raw.planet.id} (${raw.planet.type})` : raw.planet.id;
    }
    const col = viewColony(view, ownColonyIndex(this.ctx.services)) as
      | (ViewColony & { terraformBp?: number })
      | undefined;
    if (col) {
      const rawColName = col.name || col.id || `Colony #${col.index}`;
      this.colonyValEl.textContent = formatColonyOrPilotName(rawColName);
      const st = typeof col.stage === 'number' ? col.stage : 0;
      const spec = STAGE_TABLE_ROWS[st] ?? STAGE_TABLE_ROWS[0]!;
      this.stageValEl.textContent = spec.label.startsWith(`S${st}`) ? spec.label : `S${st} ${spec.label}`;
      if (typeof col.terraformBp === 'number') {
        this.terraformValEl.textContent = `${Math.round(col.terraformBp / 100)} %`;
      }
      this.stockValEl.textContent = formatColonyStockSummary(col);
    }
    if (this.isOpen) {
      this.callsignCard.deedSummaryEl.textContent = resolvePilotDeedSummary(this.ctx);
    }
  }

  dispose(): void {
    for (const fn of this.cleanups.splice(0)) fn();
    this.pilotInstance.dispose();
    this.orbitInstance.dispose();
    this.chipSectionEl.remove();
    this.triggerBtn.remove();
    this.root.remove();
  }
}
