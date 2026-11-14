import type { ViewColony } from '@terra/sim';
import type { FeatureContext } from '../../../core/registry/types';

export function addPilotStatCell(
  parent: HTMLElement,
  label: string,
  initial: string,
  testId: string,
): HTMLElement {
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

export interface DialogHeaderEls {
  header: HTMLElement;
  titleEl: HTMLElement;
  statusChipEl: HTMLElement;
}

export function buildPilotDialogHeader(onClose: () => void): DialogHeaderEls {
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
  closeBtn.className = 'btn btn-sm';
  closeBtn.dataset.testid = 'pilot-dialog-close';
  closeBtn.setAttribute('aria-label', 'Close Pilot Profile');
  closeBtn.textContent = 'CLOSE';
  closeBtn.addEventListener('click', onClose);
  headerActions.append(statusChipEl, closeBtn);
  header.append(titleWrap, headerActions);
  return { header, titleEl, statusChipEl };
}

export interface PilotCallsignCardEls {
  card: HTMLElement;
  monogramEl: HTMLElement;
  callsignEl: HTMLElement;
  networkEl: HTMLElement;
  deedSummaryEl: HTMLElement;
}

export function buildPilotCallsignCard(opts: {
  onOpenDeed: () => void;
  onOpenGoals: () => void;
}): PilotCallsignCardEls {
  const card = document.createElement('aside');
  card.className = 'ta-pilot-dossier-card plate-sm';
  card.dataset.testid = 'pilot-dossier-card';

  const top = document.createElement('div');
  top.className = 'ta-pilot-dossier-card__top';
  const monogramEl = document.createElement('div');
  monogramEl.className = 'ta-pilot-dossier-card__monogram';
  monogramEl.textContent = 'GP';

  const meta = document.createElement('div');
  meta.className = 'ta-pilot-dossier-card__meta';
  const callsignEl = document.createElement('div');
  callsignEl.className = 'ta-pilot-dossier-card__callsign';
  callsignEl.textContent = 'Guest Pilot';
  const networkEl = document.createElement('div');
  networkEl.className = 'ta-pilot-dossier-card__network';
  networkEl.textContent = 'LOCAL GUEST SESSION';
  meta.append(callsignEl, networkEl);
  top.append(monogramEl, meta);

  const deedBox = document.createElement('div');
  deedBox.className = 'ta-pilot-dossier-card__box';
  const deedLabel = document.createElement('span');
  deedLabel.className = 'ta-pilot-modal__stat-label';
  deedLabel.textContent = 'ON-CHAIN COLONY DEED';
  const deedSummaryEl = document.createElement('span');
  deedSummaryEl.className = 'ta-pilot-dossier-card__deed';
  deedSummaryEl.dataset.testid = 'pilot-dossier-deed';
  deedSummaryEl.textContent = 'Active territory claim';
  const quickRow = document.createElement('div');
  quickRow.className = 'ta-pilot-dossier-card__actions';

  const deedBtn = document.createElement('button');
  deedBtn.type = 'button';
  deedBtn.className = 'btn btn-ghost btn-sm';
  deedBtn.dataset.testid = 'pilot-open-deed';
  deedBtn.textContent = 'COLONY DEED →';
  deedBtn.addEventListener('click', opts.onOpenDeed);

  const goalsBtn = document.createElement('button');
  goalsBtn.type = 'button';
  goalsBtn.className = 'btn btn-ghost btn-sm';
  goalsBtn.dataset.testid = 'pilot-open-goals';
  goalsBtn.textContent = 'STAGE GOALS →';
  goalsBtn.addEventListener('click', opts.onOpenGoals);

  quickRow.append(deedBtn, goalsBtn);
  deedBox.append(deedLabel, deedSummaryEl, quickRow);

  const hubBox = document.createElement('div');
  hubBox.className = 'ta-pilot-dossier-card__box';
  const hubLabel = document.createElement('span');
  hubLabel.className = 'ta-pilot-modal__stat-label';
  hubLabel.textContent = 'PILOT PROFILE HUB (/ME)';
  const hubDesc = document.createElement('p');
  hubDesc.className = 'ta-pilot-dossier-card__desc';
  hubDesc.textContent =
    'Inspect full achievement badges, multi-planet colony history, and encrypted BYOK NEAR.AI model configuration.';
  hubBox.append(hubLabel, hubDesc);

  card.append(top, deedBox, hubBox);
  return { card, monogramEl, callsignEl, networkEl, deedSummaryEl };
}

export function buildPilotDialogFooter(): HTMLElement {
  const footer = document.createElement('footer');
  footer.className = 'ta-pilot-modal__footer';
  const note = document.createElement('span');
  note.className = 'ta-pilot-modal__footer-note';
  note.textContent = 'Opens in a new browser tab — your colony session stays active.';
  const meLink = document.createElement('a');
  meLink.href = '/me.html';
  meLink.target = '_blank';
  meLink.rel = 'noopener noreferrer';
  meLink.className = 'btn btn-primary btn-sm ta-pilot-modal__me-link';
  meLink.dataset.testid = 'pilot-open-me';
  meLink.textContent = 'OPEN PILOT PROFILE (/me.html) ↗';
  footer.append(note, meLink);
  return footer;
}

export function computePilotMonogram(displayName: string): string {
  const hashMatch = /#([A-Z0-9]{2,4})$/i.exec(displayName.trim());
  if (hashMatch) return `#${hashMatch[1]!.slice(0, 2).toUpperCase()}`;
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]!.charAt(0)}${parts[1]!.charAt(0)}`.toUpperCase();
  }
  return (displayName.trim().slice(0, 2) || 'PL').toUpperCase();
}

export function formatColonyStockSummary(col: ViewColony | undefined): string {
  const stock = (col as { stock?: Record<string, number> } | undefined)?.stock;
  if (!stock || typeof stock !== 'object') return '—';
  let metals = 0;
  let minerals = 0;
  let bio = 0;
  let hasAny = false;
  for (const [k, raw] of Object.entries(stock)) {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
    hasAny = true;
    const val = Math.floor(raw + 1e-6);
    if (k === 'metals' || k.startsWith('metals.')) metals += val;
    else if (k === 'minerals' || k.startsWith('minerals.')) minerals += val;
    else if (k === 'bio' || k.startsWith('bio.')) bio += val;
  }
  if (!hasAny) return '—';
  return `M ${metals} · Mn ${minerals} · B ${bio}`;
}

export function resolvePilotDeedSummary(ctx: FeatureContext): string {
  const deed = (ctx.services as { getDeedPanel?: () => { getDeed(): { tokenId: string; status: string; settled: boolean; version: number } | null } | null })
    .getDeedPanel?.()
    ?.getDeed();
  if (!deed) return 'Active territory claim';
  const state = deed.settled ? 'SETTLED' : deed.status.toUpperCase();
  return `${deed.tokenId} · v${deed.version} ${state}`;
}
