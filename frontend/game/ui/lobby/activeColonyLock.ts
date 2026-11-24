import { PLANET_SPECS, type PlanetKind } from '@terra/render/planets/PlanetSpec';
import {
  canFoundAnotherColony,
  rosterFromSingleActiveColony,
  type ActiveHomeColony,
  type PilotColonyRoster,
} from '../../../design/pilot/activeHomeColony';

const DEFAULT_SUBTITLE = 'AUTONOMOUS COLONY BUILDER · SELECT A WORLD';

function syncWorldCardWithRoster(card: HTMLButtonElement, roster: PilotColonyRoster | null): void {
  if (!roster || roster.colonies.length === 0) {
    card.disabled = false;
    card.removeAttribute('aria-disabled');
    delete card.dataset.activeColony;
    delete card.dataset.colonyLocked;
    card.classList.remove('is-active-colony', 'is-colony-locked');
    return;
  }

  const cardKind = card.dataset.k as PlanetKind | undefined;
  const ownedHere = cardKind ? roster.colonies.filter((c) => c.kind === cardKind) : [];
  const canExpand = canFoundAnotherColony(roster);

  if (ownedHere.length > 0) {
    card.disabled = false;
    card.removeAttribute('aria-disabled');
    card.dataset.activeColony = 'true';
    delete card.dataset.colonyLocked;
    card.classList.add('is-active-colony');
    card.classList.remove('is-colony-locked');
    return;
  }

  if (canExpand) {
    card.disabled = false;
    card.removeAttribute('aria-disabled');
    delete card.dataset.activeColony;
    delete card.dataset.colonyLocked;
    card.classList.remove('is-active-colony', 'is-colony-locked');
    return;
  }

  card.disabled = true;
  card.setAttribute('aria-disabled', 'true');
  card.dataset.colonyLocked = 'true';
  delete card.dataset.activeColony;
  card.classList.add('is-colony-locked');
  card.classList.remove('is-active-colony', 'sel');
}

export function applyColonyRosterToMenuDom(el: HTMLElement, roster: PilotColonyRoster | null): void {
  el.querySelectorAll<HTMLButtonElement>('.world-card').forEach((card) =>
    syncWorldCardWithRoster(card, roster),
  );

  const subtitle = el.querySelector<HTMLElement>('.subtitle');
  if (!subtitle) return;

  if (!roster || roster.colonies.length === 0) {
    subtitle.textContent = roster?.slots.isStaker
      ? `NEAR.AI STAKER · 0/${roster.slots.max} COLONIES · SELECT A WORLD`
      : DEFAULT_SUBTITLE;
    return;
  }

  const canExpand = canFoundAnotherColony(roster);
  if (canExpand) {
    subtitle.textContent =
      `NEAR.AI SLOTS · ${roster.colonies.length}/${roster.slots.max} COLONIES ACTIVE · SELECT SECTOR OR PLANET`;
    return;
  }

  if (roster.colonies.length === 1 && !roster.slots.isStaker) {
    const active = roster.colonies[0]!;
    subtitle.textContent = `ACTIVE COLONY · ${PLANET_SPECS[active.kind].name.toUpperCase()} (${active.colonyName})`;
    return;
  }

  subtitle.textContent =
    `ACTIVE COLONIES · ${roster.colonies.length}/${roster.slots.max} NEAR.AI SLOTS FULL`;
}

export function applyActiveColonyToMenuDom(el: HTMLElement, active: ActiveHomeColony | null): void {
  applyColonyRosterToMenuDom(el, rosterFromSingleActiveColony(active));
  const deployBtn = el.querySelector<HTMLButtonElement>('#deploy');
  if (deployBtn) deployBtn.textContent = active ? 'ENTER COLONY' : 'DEPLOY';
}
