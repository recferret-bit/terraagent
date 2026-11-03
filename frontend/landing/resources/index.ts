// Landing section 03: resource tabs + live 3D viewer + FULL / HALF / DEPLETED deposit stage selector.
import { DEPOSIT_STAGES, type DepositVisualStage } from '@terra/render/kitbash';
import { RES } from './data';
import { ResourceTabs } from './ResourceTabs';
import { ResourceViewer3D } from './ResourceViewer3D';

function mountDepositStageBar(
  host: HTMLElement,
  onStageChange: (stage: DepositVisualStage) => void,
): { setStage(stage: DepositVisualStage): void } {
  let bar = host.querySelector<HTMLElement>('[data-testid="landing-resource-stage"]');
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'rv-stage-bar';
    bar.dataset.testid = 'landing-resource-stage';
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', 'Resource deposit visual stage');
    bar.innerHTML = `<span class="rv-stage-lbl">STAGE:</span>${DEPOSIT_STAGES.map(
      (st) =>
        `<button type="button" class="rv-stage-btn${st === 'full' ? ' is-active' : ''}" data-stage="${st}" aria-pressed="${st === 'full'}">${st.toUpperCase()}</button>`,
    ).join('')}`;
    host.appendChild(bar);
  }
  const btns = [...bar.querySelectorAll<HTMLButtonElement>('[data-stage]')];
  const setStage = (stage: DepositVisualStage) => {
    for (const b of btns) {
      const active = b.dataset.stage === stage;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-pressed', String(active));
    }
  };
  for (const b of btns) {
    b.onclick = () => {
      const st = (b.dataset.stage as DepositVisualStage) || 'full';
      setStage(st);
      onStageChange(st);
    };
  }
  return { setStage };
}

export function initResources() {
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('[data-res]')];
  const stage = document.getElementById('rv-stage'), info = document.getElementById('rv-info'), tag = document.getElementById('rv-tag');
  if (!tabs.length || !stage || !info) return;
  let viewer: ResourceViewer3D | null = null;
  let currentKey = 'metals';
  let currentStage: DepositVisualStage = 'full';
  const viewHost = stage.parentElement ?? stage;
  mountDepositStageBar(viewHost, (nextStage) => {
    currentStage = nextStage;
    if (viewer) {
      viewer.setStage(nextStage);
    } else if (tag) {
      const r = RES[currentKey];
      tag.textContent = `LIVE RENDER · ${r?.archetype ?? currentKey} · ${nextStage.toUpperCase()}`;
    }
  });
  const sheet = new ResourceTabs(tabs, info, (key) => {
    currentKey = key;
    if (viewer) {
      viewer.show(key, currentStage);
    } else if (tag) {
      const r = RES[key];
      tag.textContent = `LIVE RENDER · ${r?.archetype ?? key} · ${currentStage.toUpperCase()}`;
    }
  });
  try { viewer = new ResourceViewer3D(stage, tag); }
  catch (e) { console.warn('resource viewer: WebGL unavailable, showing the sheet only', e); stage.classList.add('is-fallback'); }
  sheet.select('metals');
}
