// Landing section 03: resource tabs + live 3D viewer. Metals is the default.
import { ResourceTabs } from './ResourceTabs';
import { ResourceViewer3D } from './ResourceViewer3D';

export function initResources() {
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('[data-res]')];
  const stage = document.getElementById('rv-stage'), info = document.getElementById('rv-info'), tag = document.getElementById('rv-tag');
  if (!tabs.length || !stage || !info) return;
  let viewer: ResourceViewer3D | null = null;
  const sheet = new ResourceTabs(tabs, info, (key) => viewer?.show(key));
  try { viewer = new ResourceViewer3D(stage, tag); }
  catch (e) { console.warn('resource viewer: WebGL unavailable, showing the sheet only', e); stage.classList.add('is-fallback'); }
  sheet.select('metals');
}
