/* Floating Faction-Plate dialog to live-tune the visual effects (CRT, Pixel-Art, Shadow / Sun, Day/Night, Wind, Water, Weather, Perf).
   Toggle open/closed with F8 (or Shift+P), or via the F8 gear button beside the bottom-left switches. Draggable by its header.
   The tabs, their stores and head widgets are a registry (`visualLabTabs.ts`); this file only renders and dispatches. */
import { onWeatherChange } from '../core/weatherConfig';
import { isProductionBuild } from './buildEnv';
import { VISUAL_LAB_CSS } from './visualLabCss';
import type { SliderSpec } from './visualLabSpecs';
import { getVisualLabTab, VISUAL_LAB_TABS, type VisualLabTab, type VisualTabId } from './visualLabTabs';

const TAB_KEY = 'terraagent.visual.tab';

let dlg: HTMLElement | null = null;
let activeTab: VisualTabId = readInitialTab();
let cleanups: Array<() => void> = [];

function readInitialTab(): VisualTabId {
  try { return getVisualLabTab(localStorage.getItem(TAB_KEY)).id; } catch { return getVisualLabTab(null).id; }
}

const activeSpec = (): VisualLabTab => getVisualLabTab(activeTab);

function sliderHtml(s: SliderSpec, prev?: SliderSpec): string {
  const group = s.group && s.group !== prev?.group ? `<div class="pd-group">${s.group}</div>` : '';
  return `${group}
    <label class="pd-row">
      <span class="pd-lbl"><span>${s.label}</span><b data-val="${s.key}"></b></span>
      <input type="range" data-key="${s.key}" min="${s.min}" max="${s.max}" step="${s.step}" />
    </label>`;
}

function buildSlidersHtml(tab: VisualLabTab): string {
  return (tab.head?.html() ?? '') + tab.sliders.map((s, i) => sliderHtml(s, tab.sliders[i - 1])).join('');
}

function buildDialogHtml(): string {
  const tabs = VISUAL_LAB_TABS.map((t) =>
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
      <div class="pd-sliders" id="pd-sliders">${buildSlidersHtml(activeSpec())}</div>
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

function bindSliderEvents(box: HTMLElement) {
  box.querySelectorAll<HTMLInputElement>('#pd-sliders input[type=range]').forEach((inp) => {
    inp.addEventListener('input', () => {
      const k = inp.dataset.key;
      if (k) activeSpec().setParam(k, parseFloat(inp.value));
    });
  });
  activeSpec().head?.bind(box);
}

function syncDialog(box: HTMLElement) {
  const spec = activeSpec();
  const on = spec.isOn();
  const p = spec.getParams();
  const lbl = box.querySelector<HTMLElement>('#pd-status-lbl');
  if (lbl) lbl.textContent = spec.statusTitle;
  const en = box.querySelector<HTMLButtonElement>('#pd-enable');
  if (en) { en.setAttribute('aria-pressed', String(on)); en.textContent = on ? 'ACTIVE · ON' : 'BYPASSED · OFF'; }

  box.querySelectorAll<HTMLElement>('.pd-tab').forEach((b) => {
    const isAct = b.dataset.tab === activeTab;
    b.classList.toggle('on', isAct);
    b.setAttribute('aria-selected', String(isAct));
  });
  for (const t of VISUAL_LAB_TABS) {
    box.querySelector<HTMLElement>(`[data-dot="${t.id}"]`)?.classList.toggle('live', t.isOn());
  }
  for (const s of spec.sliders) {
    const inp = box.querySelector<HTMLInputElement>(`input[data-key="${s.key}"]`);
    const val = box.querySelector<HTMLElement>(`[data-val="${s.key}"]`);
    const v = p[s.key] ?? 0;
    // timeOfDay wraps 24 -> 0: don't yank a slider the user is holding at the right end back to the left.
    if (inp && !(s.key === 'timeOfDay' && v === 0 && Number(inp.value) === 24 && document.activeElement === inp)) {
      inp.value = String(v);
    }
    if (val) val.textContent = s.fmt(v);
  }
  spec.head?.sync(box);
}

export function selectVisualTab(tab: VisualTabId): void {
  activeTab = getVisualLabTab(tab).id;
  try { localStorage.setItem(TAB_KEY, activeTab); } catch { /* ignore */ }
  if (!dlg) return;
  const host = dlg.querySelector<HTMLElement>('#pd-sliders');
  if (host) {
    host.innerHTML = buildSlidersHtml(activeSpec());
    bindSliderEvents(dlg);
  }
  syncDialog(dlg);
}

export function togglePixelDialog(force?: boolean): boolean {
  if (isProductionBuild()) return false;
  initPixelDialog();
  if (!dlg) return false;
  const open = force ?? !dlg.classList.contains('open');
  dlg.classList.toggle('open', open);
  if (open) syncDialog(dlg);
  document.getElementById('pixel-tune')?.setAttribute('aria-expanded', String(open));
  return open;
}

export function initPixelDialog() {
  if (isProductionBuild()) return;
  if (typeof document === 'undefined' || document.getElementById('pixel-dlg')) return;
  document.head.insertAdjacentHTML('beforeend', `<style id="pixel-dlg-css">${VISUAL_LAB_CSS}</style>`);
  const box = dlg = document.createElement('div');
  box.id = 'pixel-dlg';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Visual shader and shadow settings');
  box.innerHTML = buildDialogHtml();
  document.body.appendChild(box);

  enableDragging(box, box.querySelector<HTMLElement>('#pd-drag')!);
  box.querySelector('#pd-close')?.addEventListener('click', () => togglePixelDialog(false));
  box.querySelector('#pd-enable')?.addEventListener('click', () => activeSpec().toggle());
  box.querySelector('#pd-reset')?.addEventListener('click', () => activeSpec().reset());
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
    onWeatherChange(() => {
      if (box.classList.contains('open')) syncDialog(box);
    }),
    ...VISUAL_LAB_TABS.map((t) => t.onChange((always) => {
      if (always || box.classList.contains('open')) syncDialog(box);
    })),
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
