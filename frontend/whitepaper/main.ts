import { rewriteSubdomainLinks } from '../design/js/subdomainLinks';
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

function bootWhitepaper(): void {
  const mount = document.getElementById('wpSectionsMount');
  const stageStatus = document.getElementById('wpRenderStatus');
  if (!mount) {
    rewriteSubdomainLinks();
    return;
  }

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
  rewriteSubdomainLinks();
  initRailShowHideAndTabs();
  initScrollAnimationsAndSpy();

  window.addEventListener('beforeunload', () => stage3D.dispose());
}

bootWhitepaper();
