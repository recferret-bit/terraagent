import { probeActiveHomeColony, type ActiveHomeColony } from '../../design/pilot/activeHomeColony';

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

function updateGenericPlayLinks(root: ParentNode, active: ActiveHomeColony | null): void {
  const links = root.querySelectorAll<HTMLAnchorElement>('a[href*="/play.html?planet="]');
  for (const link of links) {
    if (link.closest('#planets')) continue;
    if (!link.dataset.origHref) link.dataset.origHref = link.getAttribute('href') ?? '';
    link.setAttribute('href', active ? `/play.html?planet=${active.kind}` : link.dataset.origHref);
  }
}

export function applyLandingActiveColony(root: ParentNode, active: ActiveHomeColony | null): void {
  const cards = root.querySelectorAll<HTMLElement>('#planets article.planet');
  for (const card of cards) {
    captureDefaults(card);
    const kind = card.querySelector<HTMLCanvasElement>('canvas[data-planet]')?.dataset.planet ?? '';
    const badge = card.querySelector<HTMLElement>('.planet-head .badge');
    const btn = card.querySelector<HTMLAnchorElement>('.planet-body .btn');

    if (!active) {
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
      continue;
    }

    if (kind === active.kind) {
      card.classList.add('is-active-colony');
      card.classList.remove('is-colony-locked');
      card.removeAttribute('aria-disabled');
      card.dataset.activeColony = 'true';
      delete card.dataset.colonyLocked;
      if (badge) {
        badge.textContent = 'YOUR COLONY';
        badge.className = 'badge badge-active-colony';
      }
      if (btn) {
        btn.setAttribute('href', `/play.html?planet=${active.kind}`);
        btn.textContent = 'ENTER YOUR COLONY →';
        btn.removeAttribute('aria-disabled');
        btn.removeAttribute('tabindex');
      }
    } else {
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
        btn.textContent = `COLONY ACTIVE ON ${active.planetName.toUpperCase()}`;
      }
    }
  }
  updateGenericPlayLinks(root, active);
}

export async function refreshLandingActiveColony(
  root: ParentNode | null = typeof document !== 'undefined' ? document : null,
  fetchFn?: typeof fetch,
): Promise<ActiveHomeColony | null> {
  if (!root) return null;
  if (typeof location !== 'undefined' && location.protocol === 'file:') return null;
  const active = await probeActiveHomeColony({ fetch: fetchFn });
  applyLandingActiveColony(root, active);
  return active;
}
