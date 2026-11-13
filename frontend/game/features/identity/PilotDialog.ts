import { STAGE_TABLE_ROWS, type ViewColony } from '@terra/sim';
import type { FeatureContext, GameView, HudPanelInstance } from '../../core/registry/types';
import { ownColonyIndex, viewColony } from '../shared/colony';
import { mountOrbitStatus } from './orbitStatus';
import { formatPilotDisplayName, mountPilotChip } from './PilotChip';

function addStatCell(parent: HTMLElement, label: string, initial: string, testId: string): HTMLElement {
  const cell = document.createElement('div');
  cell.className = 'ta-pilot-modal__stat plate-sm';
  const lbl = document.createElement('span');
  lbl.className = 'ta-pilot-modal__stat-label';
  lbl.textContent = label;
  const val = document.createElement('span');
  val.className = 'ta-pilot-modal__stat-value';
  val.dataset.testid = testId;
  val.textContent = initial;
  cell.append(lbl, val);
  parent.append(cell);
  return val;
}

interface DialogHeaderEls {
  header: HTMLElement;
  titleEl: HTMLElement;
  statusChipEl: HTMLElement;
}

function buildDialogHeader(onClose: () => void): DialogHeaderEls {
  const header = document.createElement('header');
  header.className = 'ta-pilot-modal__header';
  const titleWrap = document.createElement('div');
  titleWrap.className = 'ta-pilot-modal__title-wrap';
  const eyebrow = document.createElement('div');
  eyebrow.className = 'ta-pilot-modal__eyebrow';
  eyebrow.textContent = 'TERRAAGENT // PILOT DOSSIER';
  const titleEl = document.createElement('h2');
  titleEl.className = 'ta-pilot-modal__title';
  titleEl.dataset.testid = 'pilot-dialog-title';
  titleEl.textContent = 'Guest Pilot';
  titleWrap.append(eyebrow, titleEl);

  const headerActions = document.createElement('div');
  headerActions.className = 'ta-pilot-modal__header-actions';
  const statusChipEl = document.createElement('span');
  statusChipEl.className = 'ta-pilot-modal__status';
  statusChipEl.dataset.testid = 'pilot-status-chip';
  statusChipEl.textContent = 'GUEST SESSION';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'btn btn-ghost btn-sm';
  closeBtn.dataset.testid = 'pilot-dialog-close';
  closeBtn.setAttribute('aria-label', 'Close Pilot Profile');
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', onClose);
  headerActions.append(statusChipEl, closeBtn);
  header.append(titleWrap, headerActions);
  return { header, titleEl, statusChipEl };
}

function buildDialogFooter(): HTMLElement {
  const footer = document.createElement('footer');
  footer.className = 'ta-pilot-modal__footer';
  const meLink = document.createElement('a');
  meLink.href = '/me.html';
  meLink.target = '_blank';
  meLink.rel = 'noopener noreferrer';
  meLink.className = 'btn btn-primary btn-sm ta-pilot-modal__me-link';
  meLink.dataset.testid = 'pilot-open-me';
  meLink.textContent = 'OPEN PILOT PROFILE (/me.html) ↗';
  footer.append(meLink);
  return footer;
}

export class PilotDialog implements HudPanelInstance {
  readonly root: HTMLElement;
  readonly triggerBtn: HTMLButtonElement;
  private readonly cardEl: HTMLElement;
  private readonly footerEl: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly statusChipEl: HTMLElement;
  private readonly displayNameValEl: HTMLElement;
  private readonly planetValEl: HTMLElement;
  private readonly colonyValEl: HTMLElement;
  private readonly stageValEl: HTMLElement;
  private readonly terraformValEl: HTMLElement;
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

    const { header, titleEl, statusChipEl } = buildDialogHeader(() => this.setOpen(false));
    this.titleEl = titleEl;
    this.statusChipEl = statusChipEl;

    const detailsGrid = document.createElement('div');
    detailsGrid.className = 'ta-pilot-modal__grid';
    this.displayNameValEl = addStatCell(detailsGrid, 'DISPLAY NAME', 'Guest Pilot', 'pilot-stat-name');
    this.planetValEl = addStatCell(detailsGrid, 'ACTIVE PLANET', '—', 'pilot-stat-planet');
    this.colonyValEl = addStatCell(detailsGrid, 'COLONY', '—', 'pilot-stat-colony');
    this.stageValEl = addStatCell(detailsGrid, 'COLONY STAGE', 'S0 Landing', 'pilot-stat-stage');
    this.terraformValEl = addStatCell(detailsGrid, 'TERRAFORM', '0 %', 'pilot-stat-terraform');

    this.chipSectionEl = document.createElement('div');
    this.chipSectionEl.className = 'ta-pilot-modal__account';
    this.pilotInstance = mountPilotChip(this.chipSectionEl, ctx);
    this.orbitInstance = mountOrbitStatus(this.chipSectionEl, ctx);

    this.footerEl = buildDialogFooter();
    this.cardEl.append(header, detailsGrid, this.footerEl);
    this.root.append(this.cardEl);

    if (overlay) {
      this.paneEl.append(this.chipSectionEl, this.triggerBtn);
      overlay.append(this.root);
      this.bindOverlayEvents();
    } else {
      this.cardEl.insertBefore(this.chipSectionEl, this.footerEl);
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
    const isLinked = Boolean(view && !view.isGuest && view.accountId);
    this.statusChipEl.textContent = isLinked ? 'LINKED PILOT' : 'GUEST SESSION';
    this.statusChipEl.dataset.linked = String(isLinked);
    this.triggerBtn.textContent = `Pilot · ${displayName}`;
  }

  setOpen(open: boolean): void {
    this.isOpen = open;
    this.root.dataset.open = String(open);
    if (this.ctx.services.hudOverlay) {
      this.root.hidden = !open;
      if (open) {
        this.cardEl.insertBefore(this.chipSectionEl, this.footerEl);
        this.syncIdentity();
      } else if (this.paneEl.isConnected || this.triggerBtn.parentElement === this.paneEl) {
        this.paneEl.insertBefore(this.chipSectionEl, this.triggerBtn);
      }
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
      this.colonyValEl.textContent = col.name || col.id || `Colony #${col.index}`;
      const st = typeof col.stage === 'number' ? col.stage : 0;
      const spec = STAGE_TABLE_ROWS[st] ?? STAGE_TABLE_ROWS[0]!;
      this.stageValEl.textContent = `S${st} ${spec.label}`;
      if (typeof col.terraformBp === 'number') {
        this.terraformValEl.textContent = `${Math.round(col.terraformBp / 100)} %`;
      }
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
