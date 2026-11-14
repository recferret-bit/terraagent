import { WhitepaperLiveStage3D } from './liveStage3D';
import {
  buildRailTabsContent,
  initRailShowHideAndTabs,
  initScrollAnimationsAndSpy,
} from './scrollAndNav';
import { buildEntitiesAndEffectsSections } from './sections/entitiesAndEffects';
import {
  buildGameplayAndEngineSections,
  mountCanonicalRisksSummary,
} from './sections/gameplayAndEngine';
import { buildWeb3AndAiSections } from './sections/web3AndAi';

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

function bootWhitepaper(): void {
  rewriteSubdomainLinks();
  const mount = document.getElementById('wpSectionsMount');
  const stageStatus = document.getElementById('wpRenderStatus');
  if (!mount) return;

  const stage3D = new WhitepaperLiveStage3D((status) => {
    if (stageStatus) stageStatus.textContent = status;
  });

  const sections = [
    ...buildWeb3AndAiSections(),
    ...buildGameplayAndEngineSections(),
    ...buildEntitiesAndEffectsSections(stage3D),
  ];

  const frag = document.createDocumentFragment();
  for (const sec of sections) frag.appendChild(sec);
  mount.replaceChildren(frag);
  mountCanonicalRisksSummary();

  buildRailTabsContent();
  initRailShowHideAndTabs();
  initScrollAnimationsAndSpy();

  window.addEventListener('beforeunload', () => stage3D.dispose());
}

bootWhitepaper();
