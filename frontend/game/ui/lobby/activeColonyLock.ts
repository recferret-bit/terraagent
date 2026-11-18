import { PLANET_SPECS } from '@terra/render/planets/PlanetSpec';
import type { ActiveHomeColony } from '../../../design/pilot/activeHomeColony';

const DEFAULT_SUBTITLE = 'AUTONOMOUS COLONY BUILDER · SELECT A WORLD';

function syncWorldCardLock(card: HTMLButtonElement, active: ActiveHomeColony | null): void {
  const statusEl = card.querySelector<HTMLElement>('.world-card-status');
  const colonyBadge = card.querySelector<HTMLElement>('.world-colony-badge');
  const rawAvail = card.dataset.availability ?? 'open';

  if (!active) {
    card.disabled = false;
    card.removeAttribute('aria-disabled');
    delete card.dataset.activeColony;
    delete card.dataset.colonyLocked;
    card.classList.remove('is-active-colony', 'is-colony-locked');
    if (colonyBadge) colonyBadge.hidden = true;
    if (statusEl) {
      statusEl.dataset.availability = rawAvail;
      statusEl.textContent = rawAvail.toUpperCase();
    }
    return;
  }

  if (card.dataset.k === active.kind) {
    card.disabled = false;
    card.removeAttribute('aria-disabled');
    card.dataset.activeColony = 'true';
    delete card.dataset.colonyLocked;
    card.classList.add('is-active-colony');
    card.classList.remove('is-colony-locked');
    if (colonyBadge) colonyBadge.hidden = false;
    if (statusEl) {
      statusEl.dataset.availability = rawAvail;
      statusEl.textContent = rawAvail.toUpperCase();
    }
    return;
  }

  card.disabled = true;
  card.setAttribute('aria-disabled', 'true');
  card.dataset.colonyLocked = 'true';
  delete card.dataset.activeColony;
  card.classList.add('is-colony-locked');
  card.classList.remove('is-active-colony', 'sel');
  if (colonyBadge) colonyBadge.hidden = true;
  if (statusEl) {
    statusEl.dataset.availability = 'locked';
    statusEl.textContent = 'LOCKED';
  }
}

export function applyActiveColonyToMenuDom(el: HTMLElement, active: ActiveHomeColony | null): void {
  el.querySelectorAll<HTMLButtonElement>('.world-card').forEach((card) => syncWorldCardLock(card, active));

  const deployBtn = el.querySelector<HTMLButtonElement>('#deploy');
  if (deployBtn) deployBtn.textContent = active ? 'ENTER COLONY' : 'DEPLOY';

  const subtitle = el.querySelector<HTMLElement>('.subtitle');
  if (subtitle) {
    subtitle.textContent = active
      ? `ACTIVE COLONY · ${PLANET_SPECS[active.kind].name.toUpperCase()} (${active.colonyName})`
      : DEFAULT_SUBTITLE;
  }

  const sectorHost = el.querySelector<HTMLElement>('#sector-picker-host');
  if (sectorHost) sectorHost.hidden = Boolean(active);

  const seedInput = el.querySelector<HTMLInputElement>('#seed');
  if (seedInput) seedInput.disabled = Boolean(active);

  const diceBtn = el.querySelector<HTMLButtonElement>('#dice');
  if (diceBtn) diceBtn.disabled = Boolean(active);
}
