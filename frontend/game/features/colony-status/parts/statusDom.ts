export interface ColonyStatusDomElements {
  readonly bannerEl: HTMLElement;
  readonly titleEl: HTMLElement;
  readonly placeHubBtn: HTMLButtonElement;
  readonly hqReprintEl: HTMLElement;
  readonly eliminatedEl: HTMLElement;
  readonly eliminatedTitleEl: HTMLElement;
  readonly eliminatedDetailEl: HTMLElement;
  readonly foundNewColonyBtn: HTMLButtonElement;
}

function createCriticalBannerDom(
  hostEl: HTMLElement,
  onPlaceHub: () => void,
): { bannerEl: HTMLElement; titleEl: HTMLElement; placeHubBtn: HTMLButtonElement } {
  const bannerEl = document.createElement('div');
  bannerEl.className = 'ta-colony-critical-banner';
  bannerEl.dataset.testid = 'colony-critical-banner';
  bannerEl.hidden = true;
  bannerEl.setAttribute('hidden', '');

  const bannerHeader = document.createElement('div');
  bannerHeader.className = 'ta-colony-critical__header';

  const bannerIcon = document.createElement('span');
  bannerIcon.className = 'ta-colony-critical__icon';
  bannerIcon.textContent = '⚠';
  bannerHeader.appendChild(bannerIcon);

  const titleEl = document.createElement('h2');
  titleEl.className = 'ta-colony-critical__title';
  titleEl.dataset.testid = 'colony-critical-title';
  titleEl.textContent = 'HUB LOST — REBUILD WITHIN 00:00';
  bannerHeader.appendChild(titleEl);

  const placeHubBtn = document.createElement('button');
  placeHubBtn.type = 'button';
  placeHubBtn.className = 'ta-colony-critical__btn';
  placeHubBtn.dataset.testid = 'colony-critical-place-hub';
  placeHubBtn.dataset.action = 'place-hub';
  placeHubBtn.textContent = 'Place Hub';
  placeHubBtn.addEventListener('click', onPlaceHub);

  bannerEl.append(bannerHeader, placeHubBtn);
  hostEl.appendChild(bannerEl);
  return { bannerEl, titleEl, placeHubBtn };
}

function createEliminatedModalDom(
  hostEl: HTMLElement,
  onFoundNewColony: () => void,
): {
  eliminatedEl: HTMLElement;
  eliminatedTitleEl: HTMLElement;
  eliminatedDetailEl: HTMLElement;
  foundNewColonyBtn: HTMLButtonElement;
} {
  const eliminatedEl = document.createElement('div');
  eliminatedEl.className = 'ta-colony-eliminated-screen';
  eliminatedEl.dataset.testid = 'colony-eliminated-screen';
  eliminatedEl.hidden = true;
  eliminatedEl.setAttribute('hidden', '');

  const card = document.createElement('div');
  card.className = 'ta-colony-eliminated__card';
  card.dataset.testid = 'colony-eliminated-modal';

  const elimIcon = document.createElement('div');
  elimIcon.className = 'ta-colony-eliminated__icon';
  elimIcon.textContent = '☠';

  const eliminatedTitleEl = document.createElement('h1');
  eliminatedTitleEl.className = 'ta-colony-eliminated__title';
  eliminatedTitleEl.dataset.testid = 'colony-eliminated-title';
  eliminatedTitleEl.textContent = 'COLONY ELIMINATED';

  const eliminatedDetailEl = document.createElement('p');
  eliminatedDetailEl.className = 'ta-colony-eliminated__detail';
  eliminatedDetailEl.dataset.testid = 'colony-eliminated-detail';
  eliminatedDetailEl.textContent = 'Hub lost — critical timer expired';

  const foundNewColonyBtn = document.createElement('button');
  foundNewColonyBtn.type = 'button';
  foundNewColonyBtn.className = 'ta-colony-eliminated__btn';
  foundNewColonyBtn.dataset.testid = 'found-new-colony-btn';
  foundNewColonyBtn.dataset.action = 'found-new-colony';
  foundNewColonyBtn.textContent = 'Found New Colony';
  foundNewColonyBtn.addEventListener('click', onFoundNewColony);

  card.append(elimIcon, eliminatedTitleEl, eliminatedDetailEl, foundNewColonyBtn);
  eliminatedEl.appendChild(card);
  hostEl.appendChild(eliminatedEl);
  return { eliminatedEl, eliminatedTitleEl, eliminatedDetailEl, foundNewColonyBtn };
}

export function createColonyStatusDom(
  hostEl: HTMLElement,
  onPlaceHub: () => void,
  onFoundNewColony: () => void,
): ColonyStatusDomElements {
  const { bannerEl, titleEl, placeHubBtn } = createCriticalBannerDom(hostEl, onPlaceHub);

  const hqReprintEl = document.createElement('div');
  hqReprintEl.className = 'ta-hq-reprint-status plate-sm';
  hqReprintEl.dataset.testid = 'hq-reprint-status';
  hqReprintEl.textContent = 'HQ REPRINTING AT HUB';
  hqReprintEl.hidden = true;
  hqReprintEl.setAttribute('hidden', '');
  hostEl.appendChild(hqReprintEl);

  const elim = createEliminatedModalDom(hostEl, onFoundNewColony);

  return {
    bannerEl,
    titleEl,
    placeHubBtn,
    hqReprintEl,
    ...elim,
  };
}
