import * as THREE from 'three';
import type { ColonyViewport } from '@terra/render/core/createColonyViewport';
import { DIRS, type CameraRig } from './camera/CameraRig';
import { download } from './dom';
import { VIEWS, type PgState } from './state';

export function screenshot(vp: ColonyViewport, rig: CameraRig, state: PgState) {
  rig.controls.update(); vp.render();
  download(vp.renderer.domElement.toDataURL('image/png'), `terra-${state.id || 'scene'}-${state.view}-${state.kind}.png`);
}

/** 2x2 sheet of the four standard views; returns (and downloads) the PNG data URL. */
export function contactSheet(vp: ColonyViewport, rig: CameraRig, state: PgState, box: THREE.Box3): string {
  const { camera, renderer } = vp, controls = rig.controls;
  const saved = { p: camera.position.clone(), t: controls.target.clone() };
  const w = renderer.domElement.width, h = renderer.domElement.height;
  const out = document.createElement('canvas'); out.width = w; out.height = h;
  const g = out.getContext('2d')!; g.fillStyle = '#07080A'; g.fillRect(0, 0, w, h);
  const c = box.getCenter(new THREE.Vector3());
  const r = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.9);
  const dist = r / Math.sin(THREE.MathUtils.degToRad(14)) * 1.2;
  VIEWS.forEach((v, i) => {
    camera.position.copy(c).addScaledVector(DIRS[v], dist); controls.target.copy(c); camera.lookAt(c);
    vp.render();
    const x = (i % 2) * (w / 2), y = Math.floor(i / 2) * (h / 2);
    g.drawImage(renderer.domElement, x, y, w / 2, h / 2);
    g.fillStyle = '#F2F4F7'; g.font = `600 ${Math.round(h / 40)}px "IBM Plex Mono", monospace`; g.fillText(v.toUpperCase(), x + 12, y + h / 34 + 6);
  });
  g.fillStyle = '#FF8A3D'; g.fillText(`${state.id}  ·  ${state.kind}`, 12, h - 12);
  camera.position.copy(saved.p); controls.target.copy(saved.t); controls.update();
  const url = out.toDataURL('image/png');
  download(url, `terra-${state.id || 'scene'}-sheet-${state.kind}.png`);
  return url;
}
