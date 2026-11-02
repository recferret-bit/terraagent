/* Floating Faction-Plate dialog to live-tune CRT, Pixel-Art, and Dynamic Shadow / Sun shader parameters.
   Toggle open/closed with F8 (or Shift+P), or via the F8 gear button beside the bottom-left switches. Draggable by its header. */
import {
  getPixelArtParams, isPixelArtOn, onPixelArtChange, resetPixelArtParams,
  setPixelArt, setPixelArtParams, togglePixelArt, type PixelArtParams,
} from '../core/pixelArtPass';
import {
  computeSunOffset, getShadowParams, isShadowOn, onShadowChange, resetShadowParams,
  setShadow, setShadowParams, toggleShadow, type ShadowParams,
} from '../core/shadowConfig';
import {
  getCrtParams, isCrtOn, onCrtChange, resetCrtParams,
  setCrt, setCrtParams, toggleCrt, type CrtParams,
} from './crt';
import { SLIDERS_BY_TAB, VISUAL_TABS, type VisualTabId } from './visualLabSpecs';

const TAB_KEY = 'terraagent.visual.tab';

const DIALOG_CSS = `
#pixel-dlg{position:fixed;left:12px;bottom:52px;z-index:70;width:324px;display:none;flex-direction:column;
  font:500 11px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;color:#f2f4f7;
  background:rgba(11,13,17,.94);border:1px solid #2a3140;border-top:3px solid #ff6a13;
  backdrop-filter:blur(10px);box-shadow:0 16px 40px rgba(0,0,0,.65);user-select:none;
  clip-path:polygon(10px 0,100% 0,100% calc(100% - 10px),calc(100% - 10px) 100%,0 100%,0 10px)}
#pixel-dlg.open{display:flex}
#pixel-dlg .pd-head{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;
  background:rgba(7,8,10,.75);border-bottom:1px solid #232936;cursor:move;letter-spacing:.14em}
#pixel-dlg .pd-title{font-weight:700;color:#f2f4f7;display:flex;align-items:center;gap:7px}
#pixel-dlg .pd-title i{width:7px;height:7px;background:#ff6a13;display:inline-block}
#pixel-dlg .pd-sub{font-size:10px;color:#8a93a6;letter-spacing:.1em}
#pixel-dlg .pd-close{background:none;border:1px solid transparent;color:#8a93a6;cursor:pointer;font:inherit;padding:2px 6px}
#pixel-dlg .pd-close:hover{color:#f2f4f7;border-color:#ff6a13}
#pixel-dlg .pd-body{padding:12px;display:flex;flex-direction:column;gap:9px}
#pixel-dlg .pd-tabs{display:grid;grid-template-columns:repeat(3,1fr);gap:5px}
#pixel-dlg .pd-tab{background:#141820;border:1px solid #262c3a;color:#8a93a6;padding:6px 4px;font:600 10px/1 inherit;
  letter-spacing:.12em;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;text-transform:uppercase}
#pixel-dlg .pd-tab:hover{border-color:#ff6a13;color:#f2f4f7}
#pixel-dlg .pd-tab.on{background:rgba(255,106,19,.16);border-color:#ff6a13;color:#ff8a3d}
#pixel-dlg .pd-dot{width:5px;height:5px;border-radius:50%;background:#3a4152;display:inline-block}
#pixel-dlg .pd-dot.live{background:#3ddc84;box-shadow:0 0 6px #3ddc84}
#pixel-dlg .pd-top{display:flex;align-items:center;justify-content:space-between;padding-bottom:8px;border-bottom:1px solid #1e232e}
#pixel-dlg .pd-toggle{background:#181c24;border:1px solid #2a3140;color:#cfd6e4;padding:5px 10px;font:600 10px/1 inherit;
  letter-spacing:.14em;cursor:pointer;clip-path:polygon(5px 0,100% 0,100% calc(100% - 5px),calc(100% - 5px) 100%,0 100%,0 5px)}
#pixel-dlg .pd-toggle[aria-pressed="true"]{background:#ff6a13;border-color:#ff6a13;color:#07080a}
#pixel-dlg .pd-sliders{display:flex;flex-direction:column;gap:8px;max-height:min(440px,calc(100vh - 190px));overflow-y:auto;padding-right:3px}
#pixel-dlg .pd-row{display:flex;flex-direction:column;gap:3px}
#pixel-dlg .pd-lbl{display:flex;justify-content:space-between;font-size:10px;letter-spacing:.1em;color:#cfd6e4}
#pixel-dlg .pd-lbl b{color:#ff8a3d;font-weight:600;font-variant-numeric:tabular-nums}
#pixel-dlg input[type=range]{-webkit-appearance:none;appearance:none;width:100%;height:5px;background:#1d222d;outline:none;margin:2px 0}
#pixel-dlg input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:12px;height:12px;background:#ff6a13;border:1px solid #07080a;cursor:pointer}
#pixel-dlg .pd-sun-box{background:#12161e;border:1px solid #232a38;padding:8px;display:flex;flex-direction:column;gap:6px}
#pixel-dlg .pd-sun-row{display:flex;align-items:center;gap:10px}
#pixel-dlg .pd-sun-pad{position:relative;width:76px;height:76px;border-radius:50%;background:radial-gradient(circle,#1c2331 0%,#0d1118 75%);
  border:1px solid #2f384a;cursor:crosshair;flex-shrink:0;touch-action:none}
#pixel-dlg .pd-sun-pad::before,#pixel-dlg .pd-sun-pad::after{content:'';position:absolute;background:rgba(138,147,166,.18);pointer-events:none}
#pixel-dlg .pd-sun-pad::before{left:50%;top:4px;bottom:4px;width:1px}
#pixel-dlg .pd-sun-pad::after{top:50%;left:4px;right:4px;height:1px}
#pixel-dlg .pd-sun-ring{position:absolute;inset:17px;border-radius:50%;border:1px dashed rgba(138,147,166,.22);pointer-events:none}
#pixel-dlg .pd-sun-ray{position:absolute;left:50%;top:50%;height:2px;background:linear-gradient(90deg,rgba(255,138,61,.85),rgba(56,191,212,.35));
  transform-origin:0 50%;pointer-events:none}
#pixel-dlg .pd-sun-dot{position:absolute;width:11px;height:11px;border-radius:50%;background:#ff9d3b;border:1.5px solid #fff;
  box-shadow:0 0 8px #ff6a13;transform:translate(-50%,-50%);pointer-events:none}
#pixel-dlg .pd-sun-presets{display:grid;grid-template-columns:repeat(2,1fr);gap:4px;flex:1}
#pixel-dlg .pd-sun-btn{background:#181d27;border:1px solid #293142;color:#cfd6e4;padding:4px 5px;font:600 9px/1 inherit;
  letter-spacing:.1em;cursor:pointer;text-align:center}
#pixel-dlg .pd-sun-btn:hover,#pixel-dlg .pd-sun-btn.on{border-color:#ff6a13;color:#ff8a3d;background:rgba(255,106,19,.14)}
#pixel-dlg .pd-foot{display:flex;justify-content:space-between;align-items:center;padding-top:6px;border-top:1px solid #1e232e}
#pixel-dlg .pd-reset{background:none;border:1px solid #2a3140;color:#8a93a6;padding:4px 9px;font:600 10px/1 inherit;letter-spacing:.12em;cursor:pointer}
#pixel-dlg .pd-reset:hover{border-color:#ff6a13;color:#f2f4f7}`;

let dlg: HTMLElement | null = null;
let activeTab: VisualTabId = readInitialTab();
let cleanups: Array<() => void> = [];

function readInitialTab(): VisualTabId {
  try {
    const saved = localStorage.getItem(TAB_KEY) as VisualTabId | null;
    if (saved === 'crt' || saved === 'pixel' || saved === 'shadow') return saved;
  } catch { /* ignore */ }
  return 'shadow';
}

function isTabEffectOn(tab: VisualTabId): boolean {
  if (tab === 'crt') return isCrtOn();
  if (tab === 'pixel') return isPixelArtOn();
  return isShadowOn();
}

function getTabParams(tab: VisualTabId): Record<string, number> {
  if (tab === 'crt') return getCrtParams() as unknown as Record<string, number>;
  if (tab === 'pixel') return getPixelArtParams() as unknown as Record<string, number>;
  return getShadowParams() as unknown as Record<string, number>;
}

function toggleActiveTabEffect(): void {
  if (activeTab === 'crt') toggleCrt();
  else if (activeTab === 'pixel') togglePixelArt();
  else toggleShadow();
}

function resetActiveTabParams(): void {
  if (activeTab === 'crt') resetCrtParams();
  else if (activeTab === 'pixel') resetPixelArtParams();
  else resetShadowParams();
}

function applyTabParam(tab: VisualTabId, key: string, val: number): void {
  if (tab === 'crt') {
    if (!isCrtOn()) setCrt(true);
    setCrtParams({ [key as keyof CrtParams]: val });
  } else if (tab === 'pixel') {
    if (!isPixelArtOn()) setPixelArt(true);
    setPixelArtParams({ [key as keyof PixelArtParams]: val });
  } else {
    if (!isShadowOn()) setShadow(true);
    setShadowParams({ [key as keyof ShadowParams]: val });
  }
}

function buildSunPositionHtml(): string {
  return `
    <div class="pd-sun-box" id="pd-sun-box">
      <span class="pd-lbl"><span>SUN POSITION</span><b id="pd-sun-xyz"></b></span>
      <div class="pd-sun-row">
        <div class="pd-sun-pad" id="pd-sun-pad" title="Drag to move sun position and inspect shadows">
          <i class="pd-sun-ring"></i>
          <i class="pd-sun-ray" id="pd-sun-ray"></i>
          <i class="pd-sun-dot" id="pd-sun-dot"></i>
        </div>
        <div class="pd-sun-presets">
          <button type="button" class="pd-sun-btn" data-sun-preset="18,18">DAWN</button>
          <button type="button" class="pd-sun-btn" data-sun-preset="38,38">MORN</button>
          <button type="button" class="pd-sun-btn" data-sun-preset="110,68">NOON</button>
          <button type="button" class="pd-sun-btn" data-sun-preset="218,22">DUSK</button>
          <button type="button" class="pd-sun-btn" data-sun-preset="305,32">WEST</button>
          <button type="button" class="pd-sun-btn" id="pd-sun-orbit">ORBIT</button>
        </div>
      </div>
    </div>`;
}

function buildSlidersHtml(tab: VisualTabId): string {
  const head = tab === 'shadow' ? buildSunPositionHtml() : '';
  return head + SLIDERS_BY_TAB[tab].map((s) => `
    <label class="pd-row">
      <span class="pd-lbl"><span>${s.label}</span><b data-val="${s.key}"></b></span>
      <input type="range" data-key="${s.key}" min="${s.min}" max="${s.max}" step="${s.step}" />
    </label>`).join('');
}

function buildDialogHtml(): string {
  const tabs = VISUAL_TABS.map((t) =>
    `<button type="button" class="pd-tab" role="tab" data-tab="${t.id}" aria-selected="${t.id === activeTab}"><i class="pd-dot" data-dot="${t.id}"></i><span>${t.label}</span></button>`,
  ).join('');
  return `
    <div class="pd-head" id="pd-drag">
      <span class="pd-title"><i></i>VISUAL SHADER LAB</span>
      <span class="pd-sub">F8</span>
      <button type="button" class="pd-close" id="pd-close" title="Close (F8)">✕</button>
    </div>
    <div class="pd-body">
      <div class="pd-tabs" role="tablist">${tabs}</div>
      <div class="pd-top">
        <span class="pd-sub" id="pd-status-lbl">STATUS</span>
        <button type="button" class="pd-toggle" id="pd-enable" aria-pressed="false">OFF</button>
      </div>
      <div class="pd-sliders" id="pd-sliders">${buildSlidersHtml(activeTab)}</div>
      <div class="pd-foot">
        <span class="pd-sub">HOTKEY: F8 / SHIFT+P</span>
        <button type="button" class="pd-reset" id="pd-reset">RESET</button>
      </div>
    </div>`;
}

function enableDragging(box: HTMLElement, handle: HTMLElement) {
  let dragging = false, ox = 0, oy = 0;
  handle.addEventListener('pointerdown', (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    dragging = true;
    const r = box.getBoundingClientRect();
    ox = e.clientX - r.left; oy = e.clientY - r.top;
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener('pointermove', (e: PointerEvent) => {
    if (!dragging) return;
    const x = Math.max(8, Math.min(window.innerWidth - box.offsetWidth - 8, e.clientX - ox));
    const y = Math.max(8, Math.min(window.innerHeight - box.offsetHeight - 8, e.clientY - oy));
    box.style.left = `${x}px`; box.style.top = `${y}px`; box.style.bottom = 'auto';
  });
  handle.addEventListener('pointerup', () => { dragging = false; });
}

function bindSunPadEvents(box: HTMLElement) {
  const pad = box.querySelector<HTMLElement>('#pd-sun-pad');
  if (pad) {
    let dragging = false;
    const applyFromPointer = (e: PointerEvent) => {
      const rect = pad.getBoundingClientRect();
      const R = rect.width * 0.5;
      const dx = (e.clientX - (rect.left + R)) / Math.max(1, R - 5);
      const dy = (e.clientY - (rect.top + R)) / Math.max(1, R - 5);
      const dist = Math.min(1, Math.hypot(dx, dy));
      const azim = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
      const elev = Math.round(85 - dist * 77);
      if (!isShadowOn()) setShadow(true);
      setShadowParams({ sunAzimuth: Math.round(azim), sunElevation: Math.max(8, Math.min(85, elev)) });
    };
    pad.addEventListener('pointerdown', (e: PointerEvent) => {
      dragging = true;
      pad.setPointerCapture(e.pointerId);
      applyFromPointer(e);
    });
    pad.addEventListener('pointermove', (e: PointerEvent) => { if (dragging) applyFromPointer(e); });
    pad.addEventListener('pointerup', () => { dragging = false; });
  }
  box.querySelectorAll<HTMLButtonElement>('[data-sun-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const [az, el] = (btn.dataset.sunPreset ?? '38,38').split(',').map(Number);
      if (!isShadowOn()) setShadow(true);
      setShadowParams({ sunAzimuth: az, sunElevation: el, sunOrbitSpeed: 0 });
    });
  });
  box.querySelector<HTMLButtonElement>('#pd-sun-orbit')?.addEventListener('click', () => {
    if (!isShadowOn()) setShadow(true);
    const cur = getShadowParams().sunOrbitSpeed;
    setShadowParams({ sunOrbitSpeed: cur > 0.1 ? 0 : 12 });
  });
}

function bindSliderEvents(box: HTMLElement) {
  box.querySelectorAll<HTMLInputElement>('#pd-sliders input[type=range]').forEach((inp) => {
    inp.addEventListener('input', () => {
      const k = inp.dataset.key;
      if (k) applyTabParam(activeTab, k, parseFloat(inp.value));
    });
  });
  bindSunPadEvents(box);
}

function syncSunWidget(box: HTMLElement) {
  if (activeTab !== 'shadow') return;
  const sp = getShadowParams();
  const off = computeSunOffset(undefined, sp);
  const xyz = box.querySelector<HTMLElement>('#pd-sun-xyz');
  if (xyz) xyz.textContent = `X ${Math.round(off.x)} · Y ${Math.round(off.y)} · Z ${Math.round(off.z)}`;
  const dot = box.querySelector<HTMLElement>('#pd-sun-dot');
  const ray = box.querySelector<HTMLElement>('#pd-sun-ray');
  const normR = Math.max(0, Math.min(1, (85 - sp.sunElevation) / 77));
  const rad = (sp.sunAzimuth * Math.PI) / 180;
  const px = 50 + Math.cos(rad) * normR * 42;
  const py = 50 + Math.sin(rad) * normR * 42;
  if (dot) { dot.style.left = `${px}%`; dot.style.top = `${py}%`; }
  if (ray) {
    ray.style.width = `${Math.max(8, normR * 32)}px`;
    ray.style.transform = `rotate(${(sp.sunAzimuth + 180) % 360}deg)`;
  }
  box.querySelector<HTMLElement>('#pd-sun-orbit')?.classList.toggle('on', sp.sunOrbitSpeed > 0.1);
}

function syncDialog(box: HTMLElement) {
  const on = isTabEffectOn(activeTab);
  const p = getTabParams(activeTab);
  const spec = VISUAL_TABS.find((t) => t.id === activeTab)!;
  const lbl = box.querySelector<HTMLElement>('#pd-status-lbl');
  if (lbl) lbl.textContent = spec.statusTitle;
  const en = box.querySelector<HTMLButtonElement>('#pd-enable');
  if (en) { en.setAttribute('aria-pressed', String(on)); en.textContent = on ? 'ACTIVE · ON' : 'BYPASSED · OFF'; }

  box.querySelectorAll<HTMLElement>('.pd-tab').forEach((b) => {
    const isAct = b.dataset.tab === activeTab;
    b.classList.toggle('on', isAct);
    b.setAttribute('aria-selected', String(isAct));
  });
  for (const t of VISUAL_TABS) {
    box.querySelector<HTMLElement>(`[data-dot="${t.id}"]`)?.classList.toggle('live', isTabEffectOn(t.id));
  }
  for (const s of SLIDERS_BY_TAB[activeTab]) {
    const inp = box.querySelector<HTMLInputElement>(`input[data-key="${s.key}"]`);
    const val = box.querySelector<HTMLElement>(`[data-val="${s.key}"]`);
    const v = p[s.key] ?? 0;
    if (inp) inp.value = String(v);
    if (val) val.textContent = s.fmt(v);
  }
  syncSunWidget(box);
}

export function selectVisualTab(tab: VisualTabId): void {
  activeTab = tab;
  try { localStorage.setItem(TAB_KEY, tab); } catch { /* ignore */ }
  if (!dlg) return;
  const host = dlg.querySelector<HTMLElement>('#pd-sliders');
  if (host) {
    host.innerHTML = buildSlidersHtml(tab);
    bindSliderEvents(dlg);
  }
  syncDialog(dlg);
}

export function togglePixelDialog(force?: boolean): boolean {
  initPixelDialog();
  if (!dlg) return false;
  const open = force ?? !dlg.classList.contains('open');
  dlg.classList.toggle('open', open);
  document.getElementById('pixel-tune')?.setAttribute('aria-expanded', String(open));
  return open;
}

export function initPixelDialog() {
  if (typeof document === 'undefined' || document.getElementById('pixel-dlg')) return;
  document.head.insertAdjacentHTML('beforeend', `<style id="pixel-dlg-css">${DIALOG_CSS}</style>`);
  const box = dlg = document.createElement('div');
  box.id = 'pixel-dlg';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Visual shader and shadow settings');
  box.innerHTML = buildDialogHtml();
  document.body.appendChild(box);

  enableDragging(box, box.querySelector<HTMLElement>('#pd-drag')!);
  box.querySelector('#pd-close')?.addEventListener('click', () => togglePixelDialog(false));
  box.querySelector('#pd-enable')?.addEventListener('click', () => toggleActiveTabEffect());
  box.querySelector('#pd-reset')?.addEventListener('click', () => resetActiveTabParams());
  box.querySelectorAll<HTMLElement>('.pd-tab').forEach((b) => b.addEventListener('click', () => {
    const t = b.dataset.tab as VisualTabId | undefined;
    if (t) selectVisualTab(t);
  }));
  bindSliderEvents(box);

  const onKey = (e: KeyboardEvent) => {
    if (e.repeat || (e.target as HTMLElement | null)?.closest?.('input, textarea, select')) return;
    if (e.code === 'F8' || (e.shiftKey && e.code === 'KeyP')) {
      e.preventDefault();
      togglePixelDialog();
    } else if (e.key === 'Escape' && box.classList.contains('open')) {
      togglePixelDialog(false);
    }
  };
  window.addEventListener('keydown', onKey);
  cleanups.push(
    () => window.removeEventListener('keydown', onKey),
    onCrtChange(() => syncDialog(box)),
    onPixelArtChange(() => syncDialog(box)),
    onShadowChange(() => syncDialog(box)),
  );
  syncDialog(box);
  if (new URLSearchParams(location.search).get('pixelDialog') === '1') togglePixelDialog(true);
}

export function disposePixelDialog() {
  cleanups.forEach((f) => f());
  cleanups = [];
  document.getElementById('pixel-dlg')?.remove();
  document.getElementById('pixel-dlg-css')?.remove();
  dlg = null;
}
