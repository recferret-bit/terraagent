// Landing section 03: resource tabs + deferred live 3D viewer + FULL / HALF / DEPLETED deposit stage selector.
import { RES } from './data';
import { ResourceTabs } from './ResourceTabs';
import type { ResourceViewer3D } from './ResourceViewer3D';

export const DEPOSIT_STAGES = ['full', 'half', 'depleted'] as const;
export type DepositVisualStage = (typeof DEPOSIT_STAGES)[number];

interface ResourceControllerState {
  viewer: ResourceViewer3D | null;
  mounting: Promise<void> | null;
  currentKey: string;
  currentStage: DepositVisualStage;
  stageEl: HTMLElement | null;
  tagEl: HTMLElement | null;
}

const state: ResourceControllerState = {
  viewer: null,
  mounting: null,
  currentKey: 'metals',
  currentStage: 'full',
  stageEl: null,
  tagEl: null,
};

function updateTagPreview(key: string, stage: DepositVisualStage): void {
  if (!state.tagEl) return;
  const r = RES[key];
  state.tagEl.textContent = `LIVE RENDER · ${r?.archetype ?? key} · ${stage.toUpperCase()}`;
}

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

/** Synchronously hydrates the resource tabs, stage selector, and technical sheet without loading Three.js/kitbash. */
export function initResourceSheet(): void {
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('[data-res]')];
  const stage = document.getElementById('rv-stage');
  const info = document.getElementById('rv-info');
  const tag = document.getElementById('rv-tag');
  if (!tabs.length || !stage || !info) return;

  if (state.stageEl !== stage) {
    state.viewer = null;
    state.mounting = null;
  }
  state.stageEl = stage;
  state.tagEl = tag;
  state.currentKey = 'metals';
  state.currentStage = 'full';

  const viewHost = stage.parentElement ?? stage;
  mountDepositStageBar(viewHost, (nextStage) => {
    state.currentStage = nextStage;
    if (state.viewer) {
      state.viewer.setStage(nextStage);
    } else {
      updateTagPreview(state.currentKey, nextStage);
    }
  });
  const sheet = new ResourceTabs(tabs, info, (key) => {
    state.currentKey = key;
    if (state.viewer) {
      state.viewer.show(key, state.currentStage);
    } else {
      updateTagPreview(key, state.currentStage);
    }
  });
  sheet.select('metals');
}

/** Lazily imports and mounts the WebGL2 3D resource viewer after main page paint. */
export async function mountResourceViewer3D(): Promise<void> {
  if (!state.stageEl || !document.contains(state.stageEl)) {
    initResourceSheet();
  }
  const stage = state.stageEl;
  if (!stage) return;
  if (state.viewer) return;
  if (state.mounting) return state.mounting;

  stage.dataset.stageState = 'loading';
  state.mounting = (async () => {
    try {
      const { ResourceViewer3D } = await import('./ResourceViewer3D');
      if (!document.contains(stage) || state.stageEl !== stage) return;
      const viewer = new ResourceViewer3D(stage, state.tagEl);
      state.viewer = viewer;
      viewer.show(state.currentKey, state.currentStage);
      stage.dataset.stageState = 'live';
    } catch (e) {
      console.warn('resource viewer: WebGL unavailable, showing the sheet only', e);
      stage.classList.add('is-fallback');
      stage.dataset.stageState = 'fallback';
    } finally {
      state.mounting = null;
    }
  })();
  return state.mounting;
}

export function initResources(): Promise<void> {
  initResourceSheet();
  return mountResourceViewer3D();
}
