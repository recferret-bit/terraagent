import { PilotAccess } from '../design/pilot/PilotAccess';
// Landing page entry: boots every section (copy variant, live stats, 3D forest colony, roadmap first; then the heavy WebGL
// sections: hero stage, planet cards, resource viewer) and the CRT treatment of the live pictures.
// WebGL sections are loaded lazily so the light sections never wait for three.js; one failing never blocks the rest.
import { initHeroCopy } from './sections/heroCopy';
import { initLiveStats } from './sections/liveStats';
import { initColonyCanvas } from './sections/colonyCanvas';
import { initRoadmap } from './sections/roadmap';
import { setCrt } from '@terra/render/ui/crt';
import { setPixelArt, setShadow } from '@terra/render/ui/pixelArt';

type Init = () => void;
const lazy = (load: () => Promise<Init>): Init => () => { load().then((init) => init()).catch((e) => console.warn('landing section failed', e)); };

class LandingPage {
  private readonly page = document.querySelector<HTMLElement>('.page');

  private readonly sections: Init[] = [
    () => {
      // Enable all visual effects (Shadows, Pixel-Art, CRT) by default on landing before viewports initialize.
      setShadow(true);
      setPixelArt(true, false);
      setCrt(true);
    },
    () => initHeroCopy(this.page),
    () => initLiveStats(this.page),
    initColonyCanvas,
    initRoadmap,
    () => { const host = document.querySelector<HTMLElement>('.header-right'); if (host) new PilotAccess(host); },
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
