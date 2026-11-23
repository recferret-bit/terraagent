import { PLANET_SPECS } from '@terra/render/planets/PlanetSpec';
import type { ActiveHomeColony } from '../../../design/pilot/activeHomeColony';

const DEFAULT_SUBTITLE = 'AUTONOMOUS COLONY BUILDER · SELECT A WORLD';

function syncWorldCardLock(card: HTMLButtonElement, active: ActiveHomeColony | null): void {
  if (!active) {
    card.disabled = false;
    card.removeAttribute('aria-disabled');
    delete card.dataset.activeColony;
    delete card.dataset.colonyLocked;
    card.classList.remove('is-active-colony', 'is-colony-locked');
    return;
  }

  if (card.dataset.k === active.kind) {
    card.disabled = false;
    card.removeAttribute('aria-disabled');
    card.dataset.activeColony = 'true';
    delete card.dataset.colonyLocked;
    card.classList.add('is-active-colony');
    card.classList.remove('is-colony-locked');
    return;
  }

  card.disabled = true;
  card.setAttribute('aria-disabled', 'true');
  card.dataset.colonyLocked = 'true';
  delete card.dataset.activeColony;
  card.classList.add('is-colony-locked');
  card.classList.remove('is-active-colony', 'sel');
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
}
