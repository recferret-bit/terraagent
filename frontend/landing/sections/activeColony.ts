import {
  canFoundAnotherColony,
  probePilotColonyRoster,
  rosterFromSingleActiveColony,
  type ActiveHomeColony,
  type PilotColonyRoster,
} from '../../design/pilot/activeHomeColony';

function captureDefaults(card: HTMLElement): void {
  if (card.dataset.colonyInit === '1') return;
  card.dataset.colonyInit = '1';
  const badge = card.querySelector<HTMLElement>('.planet-head .badge');
  if (badge) {
    card.dataset.origBadgeText = badge.textContent ?? '';
    card.dataset.origBadgeClass = badge.className;
  }
  const btn = card.querySelector<HTMLAnchorElement>('.planet-body .btn');
  if (btn) {
    card.dataset.origBtnText = btn.textContent ?? '';
    card.dataset.origBtnHref = btn.getAttribute('href') ?? '';
  }
}

function restoreCardDefaults(card: HTMLElement): void {
  const badge = card.querySelector<HTMLElement>('.planet-head .badge');
  const btn = card.querySelector<HTMLAnchorElement>('.planet-body .btn');
  card.querySelector('[data-testid^="landing-colony-select-"]')?.remove();
  card.classList.remove('is-active-colony', 'is-colony-locked');
  card.removeAttribute('aria-disabled');
  delete card.dataset.activeColony;
  delete card.dataset.colonyLocked;
  if (badge && card.dataset.origBadgeText !== undefined) {
    badge.textContent = card.dataset.origBadgeText;
    badge.className = card.dataset.origBadgeClass ?? 'badge';
  }
  if (btn) {
    if (card.dataset.origBtnHref) btn.setAttribute('href', card.dataset.origBtnHref);
    if (card.dataset.origBtnText) btn.textContent = card.dataset.origBtnText;
    btn.removeAttribute('aria-disabled');
    btn.removeAttribute('tabindex');
  }
}

function landingColonyHref(kind: string, colony?: ActiveHomeColony | null): string {
  if (!colony) return `/play.html?planet=${kind}`;
  const sector = colony.foundingSectorId
    ? `&sector=${encodeURIComponent(colony.foundingSectorId)}`
    : '';
  return `/play.html?planet=${kind}&colonyId=${encodeURIComponent(colony.colonyId)}${sector}`;
}

const NEW_SECTOR_OPTION = '__new__';

function syncLandingColonySelect(
  card: HTMLElement,
  kind: string,
  ownedHere: readonly ActiveHomeColony[],
  btn: HTMLAnchorElement | null,
  canExpand: boolean,
): ActiveHomeColony | null {
  const existing = card.querySelector<HTMLSelectElement>(`[data-testid="landing-colony-select-${kind}"]`);
  if (ownedHere.length === 0 || (ownedHere.length === 1 && !canExpand)) {
    existing?.remove();
    return ownedHere[0] ?? null;
  }
  const select = existing ?? document.createElement('select');
  select.className = 'input ta-landing-colony-select';
  select.dataset.testid = `landing-colony-select-${kind}`;
  select.setAttribute('aria-label', `Select colony on ${ownedHere[0]!.planetName}`);
  const prevValue = select.value;
  const options = ownedHere.map((c) => {
    const opt = document.createElement('option');
    opt.value = c.colonyId;
    const sec = (c.foundingSectorId ?? 'sec_0_0').toUpperCase();
    opt.textContent = `${c.colonyName} (${sec})`;
    return opt;
  });
  if (canExpand) {
    const addOpt = document.createElement('option');
    addOpt.value = NEW_SECTOR_OPTION;
    addOpt.textContent = '+ Deploy new colony in open sector';
    options.push(addOpt);
  }
  select.replaceChildren(...options);
  const isNewChosen = canExpand && prevValue === NEW_SECTOR_OPTION;
  const selected = ownedHere.find((c) => c.colonyId === prevValue) ?? ownedHere[0]!;
  select.value = isNewChosen ? NEW_SECTOR_OPTION : selected.colonyId;

  const syncButtonForValue = (val: string): void => {
    if (!btn) return;
    if (canExpand && val === NEW_SECTOR_OPTION) {
      btn.setAttribute('href', `/play.html?planet=${kind}&new=1`);
      btn.textContent = 'DEPLOY IN NEW SECTOR →';
      return;
    }
    const picked = ownedHere.find((c) => c.colonyId === val) ?? ownedHere[0]!;
    btn.setAttribute('href', landingColonyHref(kind, picked));
    btn.textContent = `ENTER ${picked.colonyName.toUpperCase()} →`;
  };

  select.onchange = () => syncButtonForValue(select.value);
  if (!existing && btn && btn.parentElement) {
    btn.parentElement.insertBefore(select, btn);
  }
  syncButtonForValue(select.value);
  return isNewChosen ? null : selected;
}

function updateGenericPlayLinks(root: ParentNode, primary: ActiveHomeColony | null): void {
  const links = root.querySelectorAll<HTMLAnchorElement>('a[href*="/play.html?planet="]');
  for (const link of links) {
    if (link.closest('#planets')) continue;
    if (!link.dataset.origHref) link.dataset.origHref = link.getAttribute('href') ?? '';
    link.setAttribute('href', primary ? `/play.html?planet=${primary.kind}` : link.dataset.origHref);
  }
}

export function applyLandingColonyRoster(root: ParentNode, roster: PilotColonyRoster | null): void {
  const cards = root.querySelectorAll<HTMLElement>('#planets article.planet');
  const hasColonies = Boolean(roster && roster.colonies.length > 0);
  const canExpand = canFoundAnotherColony(roster);
  const primary = roster?.primary ?? roster?.colonies[0] ?? null;

  for (const card of cards) {
    captureDefaults(card);
    if (!hasColonies || !roster) {
      restoreCardDefaults(card);
      continue;
    }

    const kind = card.querySelector<HTMLCanvasElement>('canvas[data-planet]')?.dataset.planet ?? '';
    const ownedHere = roster.colonies.filter((c) => c.kind === kind);
    const badge = card.querySelector<HTMLElement>('.planet-head .badge');
    const btn = card.querySelector<HTMLAnchorElement>('.planet-body .btn');

    if (ownedHere.length > 0) {
      card.classList.add('is-active-colony');
      card.classList.remove('is-colony-locked');
      card.removeAttribute('aria-disabled');
      card.dataset.activeColony = 'true';
      delete card.dataset.colonyLocked;
      if (badge) {
        badge.textContent = ownedHere.length > 1 ? `${ownedHere.length} COLONIES` : 'YOUR COLONY';
        badge.className = 'badge badge-active-colony';
      }
      if (btn) {
        btn.setAttribute('href', `/play.html?planet=${kind}`);
        btn.textContent = canExpand ? 'ENTER OR ADD SECTOR →' : 'ENTER YOUR COLONY →';
        btn.removeAttribute('aria-disabled');
        btn.removeAttribute('tabindex');
      }
      syncLandingColonySelect(card, kind, ownedHere, btn, canExpand);
      continue;
    }

    card.querySelector('[data-testid^="landing-colony-select-"]')?.remove();

    if (canExpand) {
      card.classList.remove('is-active-colony', 'is-colony-locked');
      card.removeAttribute('aria-disabled');
      delete card.dataset.activeColony;
      delete card.dataset.colonyLocked;
      if (badge) {
        badge.textContent = 'SLOT OPEN';
        badge.className = 'badge badge-recruiting';
      }
      if (btn) {
        btn.setAttribute('href', `/play.html?planet=${kind}&new=1`);
        btn.textContent = `DEPLOY COLONY (${roster.colonies.length}/${roster.slots.max}) →`;
        btn.removeAttribute('aria-disabled');
        btn.removeAttribute('tabindex');
      }
      continue;
    }

    card.classList.add('is-colony-locked');
    card.classList.remove('is-active-colony');
    card.setAttribute('aria-disabled', 'true');
    card.dataset.colonyLocked = 'true';
    delete card.dataset.activeColony;
    if (badge) {
      badge.textContent = 'LOCKED';
      badge.className = 'badge';
    }
    if (btn) {
      btn.removeAttribute('href');
      btn.setAttribute('aria-disabled', 'true');
      btn.setAttribute('tabindex', '-1');
      btn.textContent =
        roster.colonies.length === 1 && primary
          ? `COLONY ACTIVE ON ${primary.planetName.toUpperCase()}`
          : `${roster.colonies.length}/${roster.slots.max} NEAR.AI SLOTS ACTIVE`;
    }
  }
  updateGenericPlayLinks(root, primary);
}

export function applyLandingActiveColony(root: ParentNode, active: ActiveHomeColony | null): void {
  applyLandingColonyRoster(root, rosterFromSingleActiveColony(active));
}

export async function refreshLandingActiveColony(
  root: ParentNode | null = typeof document !== 'undefined' ? document : null,
  fetchFn?: typeof fetch,
): Promise<ActiveHomeColony | null> {
  if (!root) return null;
  if (typeof location !== 'undefined' && location.protocol === 'file:') return null;
  const roster = await probePilotColonyRoster({ fetch: fetchFn });
  applyLandingColonyRoster(root, roster);
  return roster?.primary ?? null;
}
