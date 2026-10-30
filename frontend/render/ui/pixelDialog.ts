/* Floating Faction-Plate dialog to live-tune the experimental Pixel-Art shader uniforms.
   Toggle open/closed with F8 (or Shift+P), or via the gear button beside the PIXEL switch. Draggable by its header. */
import {
  getPixelArtParams, isPixelArtOn, onPixelArtChange, resetPixelArtParams,
  setPixelArt, setPixelArtParams, togglePixelArt, type PixelArtParams,
} from '../core/pixelArtPass';

interface SliderSpec {
  key: keyof PixelArtParams;
  label: string;
  min: number;
  max: number;
  step: number;
  fmt: (v: number) => string;
}

const SLIDERS: SliderSpec[] = [
  { key: 'pixelSize', label: 'PIXEL SIZE', min: 1, max: 12, step: 0.5, fmt: (v) => `${v.toFixed(1)} px` },
  { key: 'colorLevels', label: 'COLOR LEVELS', min: 2, max: 64, step: 1, fmt: (v) => `${Math.round(v)} steps` },
  { key: 'dither', label: 'BAYER DITHER', min: 0, max: 2, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'edgeStrength', label: 'EDGE INK / RIDGE', min: 0, max: 2, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'saturation', label: 'SATURATION', min: 0, max: 2.5, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'contrast', label: 'CONTRAST', min: 0.5, max: 2.0, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'gridStrength', label: 'PIXEL GRID BEVEL', min: 0, max: 0.35, step: 0.01, fmt: (v) => `${Math.round(v * 100)}%` },
];

const PALETTES = ['FULL RGB', 'GAMEBOY', 'AMBER CRT', 'CYBER NEON'];

const DIALOG_CSS = `
#pixel-dlg{position:fixed;left:12px;bottom:52px;z-index:70;width:308px;display:none;flex-direction:column;
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
#pixel-dlg .pd-top{display:flex;align-items:center;justify-content:space-between;padding-bottom:8px;border-bottom:1px solid #1e232e}
#pixel-dlg .pd-toggle{background:#181c24;border:1px solid #2a3140;color:#cfd6e4;padding:5px 10px;font:600 10px/1 inherit;
  letter-spacing:.14em;cursor:pointer;clip-path:polygon(5px 0,100% 0,100% calc(100% - 5px),calc(100% - 5px) 100%,0 100%,0 5px)}
#pixel-dlg .pd-toggle[aria-pressed="true"]{background:#ff6a13;border-color:#ff6a13;color:#07080a}
#pixel-dlg .pd-modes{display:grid;grid-template-columns:repeat(4,1fr);gap:4px}
#pixel-dlg .pd-mode{background:#141820;border:1px solid #262c3a;color:#8a93a6;padding:5px 2px;font:600 9px/1 inherit;
  letter-spacing:.08em;cursor:pointer;text-align:center}
#pixel-dlg .pd-mode:hover{border-color:#ff6a13;color:#f2f4f7}
#pixel-dlg .pd-mode.on{background:rgba(255,106,19,.16);border-color:#ff6a13;color:#ff8a3d}
#pixel-dlg .pd-row{display:flex;flex-direction:column;gap:3px}
#pixel-dlg .pd-lbl{display:flex;justify-content:space-between;font-size:10px;letter-spacing:.1em;color:#cfd6e4}
#pixel-dlg .pd-lbl b{color:#ff8a3d;font-weight:600;font-variant-numeric:tabular-nums}
#pixel-dlg input[type=range]{-webkit-appearance:none;appearance:none;width:100%;height:5px;background:#1d222d;outline:none;margin:2px 0}
#pixel-dlg input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:12px;height:12px;background:#ff6a13;border:1px solid #07080a;cursor:pointer}
#pixel-dlg .pd-foot{display:flex;justify-content:space-between;align-items:center;padding-top:6px;border-top:1px solid #1e232e}
#pixel-dlg .pd-reset{background:none;border:1px solid #2a3140;color:#8a93a6;padding:4px 9px;font:600 10px/1 inherit;letter-spacing:.12em;cursor:pointer}
#pixel-dlg .pd-reset:hover{border-color:#ff6a13;color:#f2f4f7}`;

let dlg: HTMLElement | null = null;
let offSub: (() => void) | null = null;

function buildDialogHtml(): string {
  const modes = PALETTES.map((m, i) => `<button type="button" class="pd-mode" data-mode="${i}">${m}</button>`).join('');
  const rows = SLIDERS.map((s) => `
    <label class="pd-row">
      <span class="pd-lbl"><span>${s.label}</span><b data-val="${s.key}"></b></span>
      <input type="range" data-key="${s.key}" min="${s.min}" max="${s.max}" step="${s.step}" />
    </label>`).join('');
  return `
    <div class="pd-head" id="pd-drag">
      <span class="pd-title"><i></i>PIXEL SHADER LAB</span>
      <span class="pd-sub">F8</span>
      <button type="button" class="pd-close" id="pd-close" title="Close (F8)">✕</button>
    </div>
    <div class="pd-body">
      <div class="pd-top">
        <span class="pd-sub">SHADER STATUS</span>
        <button type="button" class="pd-toggle" id="pd-enable" aria-pressed="false">OFF</button>
      </div>
      <div class="pd-modes">${modes}</div>
      ${rows}
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

function syncDialog(box: HTMLElement, on: boolean, p: PixelArtParams) {
  const en = box.querySelector<HTMLButtonElement>('#pd-enable');
  if (en) { en.setAttribute('aria-pressed', String(on)); en.textContent = on ? 'ACTIVE · ON' : 'BYPASSED · OFF'; }
  box.querySelectorAll<HTMLElement>('.pd-mode').forEach((b) => b.classList.toggle('on', Number(b.dataset.mode) === p.paletteMode));
  for (const s of SLIDERS) {
    const inp = box.querySelector<HTMLInputElement>(`input[data-key="${s.key}"]`);
    const val = box.querySelector<HTMLElement>(`[data-val="${s.key}"]`);
    if (inp) inp.value = String(p[s.key]);
    if (val) val.textContent = s.fmt(p[s.key]);
  }
}

export function togglePixelDialog(force?: boolean): boolean {
  initPixelDialog();
  if (!dlg) return false;
  const open = force ?? !dlg.classList.contains('open');
  dlg.classList.toggle('open', open);
  return open;
}

export function initPixelDialog() {
  if (typeof document === 'undefined' || document.getElementById('pixel-dlg')) return;
  document.head.insertAdjacentHTML('beforeend', `<style id="pixel-dlg-css">${DIALOG_CSS}</style>`);
  const box = dlg = document.createElement('div');
  box.id = 'pixel-dlg';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Pixel shader parameters');
  box.innerHTML = buildDialogHtml();
  document.body.appendChild(box);

  enableDragging(box, box.querySelector<HTMLElement>('#pd-drag')!);
  box.querySelector('#pd-close')?.addEventListener('click', () => togglePixelDialog(false));
  box.querySelector('#pd-enable')?.addEventListener('click', () => togglePixelArt());
  box.querySelector('#pd-reset')?.addEventListener('click', () => resetPixelArtParams());
  box.querySelectorAll<HTMLElement>('.pd-mode').forEach((b) => b.addEventListener('click', () => {
    if (!isPixelArtOn()) setPixelArt(true);
    setPixelArtParams({ paletteMode: Number(b.dataset.mode) });
  }));
  box.querySelectorAll<HTMLInputElement>('input[type=range]').forEach((inp) => inp.addEventListener('input', () => {
    const k = inp.dataset.key as keyof PixelArtParams;
    if (!isPixelArtOn()) setPixelArt(true);
    setPixelArtParams({ [k]: parseFloat(inp.value) });
  }));

  window.addEventListener('keydown', (e) => {
    if (e.repeat || (e.target as HTMLElement | null)?.closest?.('input, textarea, select')) return;
    if (e.code === 'F8' || (e.shiftKey && e.code === 'KeyP')) {
      e.preventDefault();
      togglePixelDialog();
    } else if (e.key === 'Escape' && box.classList.contains('open')) {
      togglePixelDialog(false);
    }
  });

  offSub = onPixelArtChange((on, p) => syncDialog(box, on, p));
  syncDialog(box, isPixelArtOn(), getPixelArtParams());
  if (new URLSearchParams(location.search).get('pixelDialog') === '1') box.classList.add('open');
}

export function disposePixelDialog() {
  offSub?.(); offSub = null;
  document.getElementById('pixel-dlg')?.remove();
  document.getElementById('pixel-dlg-css')?.remove();
  dlg = null;
}
