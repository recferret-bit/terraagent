// Landing page entry: boots every section (copy variant, live stats, hex colony, roadmap first; then the heavy WebGL
// sections: hero stage, planet cards, resource viewer) and the CRT treatment of the live pictures.
// WebGL sections are loaded lazily so the light sections never wait for three.js; one failing never blocks the rest.
import { initHeroCopy } from './sections/heroCopy';
import { initLiveStats } from './sections/liveStats';
import { initColonyCanvas } from './sections/colonyCanvas';
import { initRoadmap } from './sections/roadmap';

type Init = () => void;
const lazy = (load: () => Promise<Init>): Init => () => { load().then((init) => init()).catch((e) => console.warn('landing section failed', e)); };

class LandingPage {
  private readonly page = document.querySelector<HTMLElement>('.page');

  private readonly sections: Init[] = [
    () => initHeroCopy(this.page),
    () => initLiveStats(this.page),
    initColonyCanvas,
    initRoadmap,
    lazy(() => import('./hero/HeroStage').then((m) => m.initHeroStage)),
    lazy(() => import('./sections/planetCards').then((m) => m.initPlanetCards)),
    lazy(() => import('./resources').then((m) => m.initResources)),
    lazy(() => import('@terra/render/ui/crtEntry').then(() => () => {})),
  ];

  boot() {
    for (const init of this.sections) {
      try { init(); } catch (e) { console.warn('landing section failed', e); }
    }
  }
}

new LandingPage().boot();
