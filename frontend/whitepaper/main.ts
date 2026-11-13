import type { PlanetKind } from '@terra/render/planets/PlanetSpec';
import { WhitepaperLiveStage3D } from './liveStage3D';
import {
  buildRailTabsContent,
  initRailShowHideAndTabs,
  initScrollAnimationsAndSpy,
} from './scrollAndNav';
import { buildEntitiesAndEffectsSections } from './sections/entitiesAndEffects';
import { buildOverviewAndMechanicsSections } from './sections/overviewAndMechanics';
import { buildWeb2AndWeb3Sections } from './sections/web2AndWeb3';

function rewriteSubdomainLinks(): void {
  if (location.hostname !== 'whitepaper.terraagent.fun') return;
  const map: Readonly<Record<string, string>> = {
    '/': 'https://terraagent.fun/',
    '/landing.html': 'https://terraagent.fun/',
    '/play.html?planet=dune&skip=1': 'https://play.terraagent.fun/play.html?planet=dune&skip=1',
    '/trade.html': 'https://play.terraagent.fun/trade.html',
    '/me.html': 'https://play.terraagent.fun/me.html',
    '/playground.html': 'https://playground.terraagent.fun/',
    '/design/': 'https://design.terraagent.fun/',
    '/pitchdeck/': 'https://pitchdeck.terraagent.fun/',
  };
  for (const a of document.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const raw = a.getAttribute('href');
    if (raw && map[raw]) a.href = map[raw];
  }
}

function wireBiomeSwitcher(stage3D: WhitepaperLiveStage3D): void {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-biome]'));
  for (const btn of buttons) {
    btn.addEventListener('click', () => {
      const biome = btn.dataset.biome as PlanetKind | undefined;
      if (!biome) return;
      for (const b of buttons) {
        const active = b === btn;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-pressed', String(active));
      }
      stage3D.setBiome(biome);
    });
  }
}

function bootWhitepaper(): void {
  rewriteSubdomainLinks();
  const mount = document.getElementById('wpSectionsMount');
  const stageStatus = document.getElementById('wpRenderStatus');
  if (!mount) return;

  const stage3D = new WhitepaperLiveStage3D((status) => {
    if (stageStatus) stageStatus.textContent = status;
  });

  const sections = [
    ...buildOverviewAndMechanicsSections(),
    ...buildWeb2AndWeb3Sections(),
    ...buildEntitiesAndEffectsSections(stage3D),
  ];

  const frag = document.createDocumentFragment();
  for (const sec of sections) frag.appendChild(sec);
  mount.replaceChildren(frag);

  wireBiomeSwitcher(stage3D);
  buildRailTabsContent();
  initRailShowHideAndTabs();
  initScrollAnimationsAndSpy();

  window.addEventListener('beforeunload', () => stage3D.dispose());
}

bootWhitepaper();
