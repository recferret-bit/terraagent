import { ArchetypeCatalog } from '@terra/render/kitbash';
import type { OrbitalStage } from '@terra/render/orbit/types';
import type { MainMenu } from '../ui/menu';
import type { OrbitPrestige } from './prestige/OrbitPrestige';

/** One orbit-menu frame: warm archetypes, feed the globe markers, advance the stage, project the AR HUD, sync prestige. */
export function stepMenuStageFrame(o: {
  stage: OrbitalStage; menu: MainMenu; dt: number; time: number; prewarmQueue: string[]; prestige: OrbitPrestige;
}): void {
  const { stage, menu } = o;
  ArchetypeCatalog.prewarmStep(o.prewarmQueue, 1.0);
  stage.setHighlights(menu.getGlobeMarkers());
  stage.update(o.dt, o.time);
  menu.updateArProjection(stage.projectHighlights());
  o.prestige.step(stage, menu.selectedPlanetId());
}
