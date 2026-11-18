// Roadmap: the flight plan (a burn line and a ship that ride your scroll; legs ignite as you pass them).
import { clamp, prefersReducedMotion } from '@terra/render/core/StageHost';

function initFlightPlan(mission: HTMLElement, reduced: boolean) {
  const legs = [...mission.querySelectorAll<HTMLElement>('[data-leg]')];
  mission.classList.add('js');
  const update = () => {
    const r = mission.getBoundingClientRect();
    const line = innerHeight * 0.6;
    const p = reduced ? 1 : clamp((line - r.top) / r.height, 0, 1);
    mission.style.setProperty('--p', String(p));
    for (const l of legs) {
      const node = l.querySelector('.leg-node');
      l.classList.toggle('reached', reduced || (node ? node.getBoundingClientRect().top < line : true));
    }
  };
  let queued = false;
  const onScroll = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      update();
    });
  };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll);
  update();
}

export function initRoadmap() {
  const mission = document.getElementById('mission');
  if (mission) initFlightPlan(mission, prefersReducedMotion());
}
