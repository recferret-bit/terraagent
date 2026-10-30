/* Experimental Pixel-Art shader switch (paired with the CRT switch at bottom-left, shortcut F10)
   plus the F8 floating parameter dialog (pixelDialog.ts). */
import { isPixelArtOn, onPixelArtChange, setPixelArt, togglePixelArt } from '../core/pixelArtPass';
import { disposePixelDialog, initPixelDialog, togglePixelDialog } from './pixelDialog';

export { isPixelArtOn, onPixelArtChange, setPixelArt, togglePixelArt, togglePixelDialog };

const CSS = `
#pixel-switch,#pixel-tune{position:fixed;bottom:12px;z-index:60;opacity:.6;transition:opacity .2s;display:flex;align-items:center;gap:8px;
  font:600 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:#cfd6e4;
  background:rgba(8,10,16,.78);border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:7px 12px 7px 9px;cursor:pointer;backdrop-filter:blur(6px)}
#pixel-switch{left:100px}
#pixel-tune{left:196px;padding:7px 10px;gap:5px}
#pixel-switch:hover,#pixel-switch:focus-visible,#pixel-tune:hover,#pixel-tune:focus-visible{opacity:1;border-color:rgba(255,255,255,.4)}
#pixel-switch:focus-visible,#pixel-tune:focus-visible{outline:2px solid #ff6a1a;outline-offset:2px}
#pixel-switch .knob{width:26px;height:14px;border-radius:999px;background:#3a4152;position:relative;transition:background .15s}
#pixel-switch .knob::after{content:"";position:absolute;top:2px;left:2px;width:10px;height:10px;border-radius:50%;background:#cfd6e4;transition:transform .15s}
#pixel-switch[aria-checked="true"] .knob{background:#ff6a1a}
#pixel-switch[aria-checked="true"] .knob::after{transform:translateX(12px);background:#fff}
body.pixel-on [data-crt-host] canvas:not([data-pixel-shader]){filter:url(#pixel-svg-filter);image-rendering:pixelated}`;

const LEVELS = '0 0.08 0.17 0.25 0.33 0.42 0.5 0.58 0.67 0.75 0.83 0.92 1';
const SVG = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><filter id="pixel-svg-filter" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feFlood x="1" y="1" height="1" width="1"/><feComposite width="4" height="4"/><feTile result="t"/><feComposite in="SourceGraphic" in2="t" operator="in"/><feMorphology operator="dilate" radius="2" result="px"/><feComponentTransfer in="px"><feFuncR type="discrete" tableValues="${LEVELS}"/><feFuncG type="discrete" tableValues="${LEVELS}"/><feFuncB type="discrete" tableValues="${LEVELS}"/></feComponentTransfer></filter></svg>`;

let btn: HTMLButtonElement | null = null;
let tuneBtn: HTMLButtonElement | null = null;
let offChange: (() => void) | null = null;

const syncDom = (on: boolean) => {
  document.body.classList.toggle('pixel-on', on);
  btn?.setAttribute('aria-checked', String(on));
};

export function initPixelArt() {
  if (document.getElementById('pixel-css')) return;
  document.head.insertAdjacentHTML('beforeend', `<style id="pixel-css">${CSS}</style>`);
  document.body.insertAdjacentHTML('beforeend', SVG);

  btn = document.createElement('button');
  btn.id = 'pixel-switch';
  btn.type = 'button';
  btn.setAttribute('role', 'switch');
  btn.title = 'Pixel-art shader (F10)';
  btn.innerHTML = '<span class="knob"></span><span>PIXEL</span>';
  btn.addEventListener('click', () => { togglePixelArt(); btn?.blur(); });
  document.body.appendChild(btn);

  tuneBtn = document.createElement('button');
  tuneBtn.id = 'pixel-tune';
  tuneBtn.type = 'button';
  tuneBtn.title = 'Tune Pixel-Art shader parameters (F8 / Shift+P)';
  tuneBtn.innerHTML = '<span>⚙</span><span>F8</span>';
  tuneBtn.addEventListener('click', () => { togglePixelDialog(); tuneBtn?.blur(); });
  document.body.appendChild(tuneBtn);

  initPixelDialog();

  window.addEventListener('keydown', (e) => {
    if (e.code !== 'F10' || e.repeat || (e.target as HTMLElement | null)?.closest?.('input, textarea')) return;
    e.preventDefault();
    togglePixelArt();
  });

  offChange = onPixelArtChange(syncDom);
  syncDom(isPixelArtOn());
}

export function disposePixelArt() {
  offChange?.();
  offChange = null;
  disposePixelDialog();
  document.getElementById('pixel-switch')?.remove();
  document.getElementById('pixel-tune')?.remove();
  document.getElementById('pixel-css')?.remove();
  document.getElementById('pixel-svg-filter')?.closest('svg')?.remove();
  document.body.classList.remove('pixel-on');
  btn = null;
  tuneBtn = null;
}
