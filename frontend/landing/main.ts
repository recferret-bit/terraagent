// Landing page entry: synchronizes lightweight copy, stats, resource technical sheet, scenarios, economics,
// protocol schematic, contracts board, and roadmap first; then defers header auth and loads all 3D/WebGL stages
// with Faction-Plate preloaders after initial main-content paint.
import { bootProductAnalytics } from '../design/analytics/boot';
import { bindLandingPlanets } from '../design/analytics/play';
import { initHeroCopy } from './sections/heroCopy';
import { initLiveStats } from './sections/liveStats';
import { initResourceSheet } from './resources';
import { initDirectorScenarios } from './sections/directorScenarios';
import { initEconomicsSection } from './sections/economicsSection';
import { initStakeNavPill } from './sections/stakeNavPill';
import { initProtocolSection } from './sections/protocolSection';
import { initContractsBoard } from './sections/contractsBoard';
import { initRoadmap } from './sections/roadmap';
import { scheduleLanding3DStages } from './stageLoader';

type Init = () => void;

class LandingPage {
  private readonly page = document.querySelector<HTMLElement>('.page');

  private readonly mainSections: Init[] = [
    () => initHeroCopy(this.page),
    () => initLiveStats(this.page),
    initResourceSheet,
    initDirectorScenarios,
    initEconomicsSection,
    initProtocolSection,
    initContractsBoard,
    initRoadmap,
    () => { void initStakeNavPill(); },
  ];

  boot() {
    for (const init of this.mainSections) {
      try { init(); } catch (e) { console.warn('landing section failed', e); }
    }

    const root = this.page ?? document;
    void Promise.all([
      import('../design/pilot/PilotAccess'),
      import('./sections/activeColony'),
    ])
      .then(([{ PilotAccess }, { refreshLandingActiveColony }]) => {
        const host = document.querySelector<HTMLElement>('.header-right');
        if (host) new PilotAccess(host, { onAuthChange: () => { void refreshLandingActiveColony(root); } });
        void refreshLandingActiveColony(root);
      })
      .catch((e) => console.warn('landing pilot access failed', e));

    void scheduleLanding3DStages(root);
  }
}

bootProductAnalytics('landing');
bindLandingPlanets();
new LandingPage().boot();
