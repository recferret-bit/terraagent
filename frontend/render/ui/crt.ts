/* Old-TV / VHS look over the 3D PICTURE only (ported from freightchain's ui/crt.js): crawling scanlines, a slow rolling
   bright band, soft flicker, tape grain, a vignette and a rare sideways distortion wave on the canvases.
   One absolutely-positioned layer per host (the element that holds a WebGL canvas), so HTML interface layers that sit
   above the host are never touched. Plus a small on/off switch (button, or F9). The choice and all shader parameters are remembered. */
import { disposePixelArt, initPixelArt } from './pixelArt';
import { initFpsCounter } from './fps';

const KEY = 'terraagent.crt';
const PARAMS_KEY = 'terraagent.crt.params';

export interface CrtParams {
  scanlineIntensity: number; // 0..0.65
  linePitch: number;         // 2..8 px
  crawlSpeed: number;        // 0.1..4.0 s
  rollIntensity: number;     // 0..0.25
  rollSpeed: number;         // 2..20 s
  noiseOpacity: number;      // 0..0.30
  flickerStrength: number;   // 0..0.25
  vignetteStrength: number;  // 0..0.95
  waveAmplitude: number;     // 0..40 px
  waveFrequency: number;     // 0.002..0.050
  waveInterval: number;      // 2..60 s
}

export const DEFAULT_CRT_PARAMS: Readonly<CrtParams> = {
  scanlineIntensity: 0.18,
  linePitch: 3,
  crawlSpeed: 0.9,
  rollIntensity: 0.045,
  rollSpeed: 8.0,
  noiseOpacity: 0.05,
  flickerStrength: 0.05,
  vignetteStrength: 0.50,
  waveAmplitude: 14,
  waveFrequency: 0.012,
  waveInterval: 22,
};

const store = {
  get(k: string, d: string) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

function readInitialCrtParams(): CrtParams {
  try {
    const raw = localStorage.getItem(PARAMS_KEY);
    if (!raw) return { ...DEFAULT_CRT_PARAMS };
    return { ...DEFAULT_CRT_PARAMS, ...JSON.parse(raw) };
  } catch { return { ...DEFAULT_CRT_PARAMS }; }
}

const NOISE = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .9 0'/></filter><rect width='160' height='160' filter='url(%23n)'/></svg>`)}")`;

const CSS = `
:root{
  --crt-line:3px;--crt-line-gap:2px;--crt-scan:0.18;--crt-crawl-s:0.9s;
  --crt-roll:0.045;--crt-roll-s:8s;--crt-noise:0.05;--crt-flicker:0.05;--crt-flicker-sub:0.03;--crt-vignette:0.5;
}
[data-crt-host]{isolation:isolate}
.crt{position:absolute;inset:0;z-index:1;pointer-events:none;overflow:hidden}
.crt i{position:absolute;inset:0;display:block;will-change:transform,opacity}
.crt .scan{inset:calc(-1 * var(--crt-line)) 0 0;background:repeating-linear-gradient(0deg,#0000 0 var(--crt-line-gap),rgba(0,0,0,var(--crt-scan)) var(--crt-line-gap) var(--crt-line));animation:crt-crawl var(--crt-crawl-s) linear infinite}
.crt .roll{top:-30%;height:30%;background:linear-gradient(0deg,#0000,rgba(255,255,255,var(--crt-roll)) 55%,#0000);animation:crt-roll var(--crt-roll-s) linear infinite}
.crt .noise{inset:-160px;background:${NOISE};opacity:var(--crt-noise);animation:crt-noise .5s steps(5,end) infinite}
.crt .vig{background:radial-gradient(ellipse at 50% 52%,#0000 55%,rgba(0,0,0,var(--crt-vignette)) 100%)}
.crt .fl{background:#000;opacity:0;animation:crt-flicker 3.7s ease-in-out infinite}
body.crt-off .crt{display:none}
#fx-bar{position:fixed;left:12px;bottom:12px;z-index:60;display:flex;align-items:center;gap:8px}
#crt-switch{box-sizing:border-box;height:30px;opacity:.6;transition:opacity .2s;display:flex;align-items:center;gap:8px;
  font:600 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:#cfd6e4;
  background:rgba(8,10,16,.78);border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:7px 12px 7px 9px;cursor:pointer;backdrop-filter:blur(6px)}
#crt-switch:hover,#crt-switch:focus-visible{opacity:1;border-color:rgba(255,255,255,.4)}
#crt-switch:focus-visible{outline:2px solid #ff6a1a;outline-offset:2px}
#crt-switch .knob{width:26px;height:14px;flex-shrink:0;border-radius:999px;background:#3a4152;position:relative;transition:background .15s}
#crt-switch .knob::after{content:"";position:absolute;top:2px;left:2px;width:10px;height:10px;border-radius:50%;background:#cfd6e4;transition:transform .15s}
#crt-switch[aria-checked="true"] .knob{background:#ff6a1a}
#crt-switch[aria-checked="true"] .knob::after{transform:translateX(12px);background:#fff}
@keyframes crt-crawl{to{transform:translateY(var(--crt-line))}}
@keyframes crt-roll{to{transform:translateY(433%)}}
@keyframes crt-noise{0%{transform:translate(0,0)}20%{transform:translate(-37px,23px)}40%{transform:translate(41px,-60px)}60%{transform:translate(-70px,-19px)}80%{transform:translate(28px,52px)}100%{transform:translate(0,0)}}
@keyframes crt-flicker{0%,100%{opacity:0}18%{opacity:var(--crt-flicker)}22%{opacity:0}61%{opacity:0}64%{opacity:var(--crt-flicker-sub)}70%{opacity:0}}
@media (prefers-reduced-motion:reduce){.crt i{animation:none}.crt .roll,.crt .noise,.crt .fl{display:none}}`;

const SVG = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><filter id="crt-wave" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feTurbulence type="turbulence" baseFrequency="0 ${DEFAULT_CRT_PARAMS.waveFrequency}" numOctaves="1" seed="3" result="n"/><feOffset in="n" dy="0" result="m"/><feDisplacementMap in="SourceGraphic" in2="m" scale="0" xChannelSelector="R" yChannelSelector="R"/></filter></svg>`;

let on = true;
let params: CrtParams = readInitialCrtParams();
let waving = false;
let timer = 0;
let btn: HTMLButtonElement | null = null;
const rnd = ([a, b]: readonly number[]) => a + Math.random() * (b - a);
const listeners = new Set<(on: boolean, params: CrtParams) => void>();

let hosts: HTMLElement[] = [];

function applyCrtCssVars() {
  if (typeof document === 'undefined') return;
  const r = document.documentElement.style;
  const pitch = Math.max(2, Math.round(params.linePitch));
  r.setProperty('--crt-line', `${pitch}px`);
  r.setProperty('--crt-line-gap', `${pitch - 1}px`);
  r.setProperty('--crt-scan', params.scanlineIntensity.toFixed(3));
  r.setProperty('--crt-crawl-s', `${Math.max(0.1, params.crawlSpeed).toFixed(2)}s`);
  r.setProperty('--crt-roll', params.rollIntensity.toFixed(3));
  r.setProperty('--crt-roll-s', `${Math.max(0.5, params.rollSpeed).toFixed(2)}s`);
  r.setProperty('--crt-noise', params.noiseOpacity.toFixed(3));
  r.setProperty('--crt-flicker', params.flickerStrength.toFixed(3));
  r.setProperty('--crt-flicker-sub', (params.flickerStrength * 0.6).toFixed(3));
  r.setProperty('--crt-vignette', params.vignetteStrength.toFixed(3));
  const turb = document.querySelector('#crt-wave feTurbulence');
  if (turb) turb.setAttribute('baseFrequency', `0 ${params.waveFrequency}`);
}

/** The distortion wave shears the hosts' canvases sideways for ~0.7 s; the SVG filter is attached only during a wave. */
function wave() {
  const f = document.getElementById('crt-wave');
  const off = f?.querySelector('feOffset'), dm = f?.querySelector('feDisplacementMap');
  const els = hosts.flatMap((h) => [...h.querySelectorAll<HTMLElement>('canvas')]);
  if (!on || waving || document.hidden || !dm || !off || !els.length || params.waveAmplitude <= 0) return;
  waving = true;
  const dur = rnd([0.5, 0.9]) * 1000, t0 = performance.now(), speed = rnd([300, 700]), amp = params.waveAmplitude * rnd([0.6, 1]);
  const prev = els.map((e) => e.style.filter);
  els.forEach((e) => { e.style.filter = 'url(#crt-wave)'; });
  const step = (now: number) => {
    const p = Math.min(1, (now - t0) / dur);
    dm.setAttribute('scale', (amp * Math.sin(Math.PI * p) ** 2).toFixed(2));
    off.setAttribute('dy', ((p * speed * dur) / 1000).toFixed(1));
    if (p < 1 && on) { requestAnimationFrame(step); return; }
    els.forEach((e, i) => { e.style.filter = prev[i]; });
    waving = false;
  };
  step(t0);
}

const schedule = () => {
  clearTimeout(timer);
  const avg = Math.max(2, params.waveInterval);
  timer = window.setTimeout(() => { wave(); schedule(); }, rnd([avg * 0.65, avg * 1.35]) * 1000);
};

const apply = () => {
  document.body.classList.toggle('crt-off', !on);
  btn?.setAttribute('aria-checked', String(on));
  applyCrtCssVars();
  listeners.forEach((l) => l(on, params));
};

export function setCrt(v: boolean) { on = v; apply(); store.set(KEY, on ? '1' : '0'); return on; }
export const toggleCrt = () => setCrt(!on);
export const isCrtOn = () => on;
export const getCrtParams = (): Readonly<CrtParams> => params;
export const onCrtChange = (fn: (on: boolean, params: CrtParams) => void) => {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
};

export function setCrtParams(next: Partial<CrtParams>): CrtParams {
  params = { ...params, ...next };
  store.set(PARAMS_KEY, JSON.stringify(params));
  if (next.waveInterval !== undefined) schedule();
  apply();
  return params;
}

export const resetCrtParams = (): CrtParams => setCrtParams({ ...DEFAULT_CRT_PARAMS });

export function ensureFxBar(): HTMLElement {
  let bar = document.getElementById('fx-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'fx-bar';
    document.body.appendChild(bar);
  }
  return bar;
}

/** Mount one overlay per host (each host must contain the WebGL canvas) + the switch. Safe to call repeatedly. */
export function initCrt(targets: HTMLElement[]) {
  if (document.getElementById('crt-css')) return;
  hosts = targets.filter(Boolean);
  on = store.get(KEY, '1') === '1';
  document.head.insertAdjacentHTML('beforeend', `<style id="crt-css">${CSS}</style>`);
  for (const h of hosts) {
    if (getComputedStyle(h).position === 'static') h.style.position = 'relative';
    h.dataset.crtHost = '';
    const el = document.createElement('div');
    el.className = 'crt'; el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<i class="noise"></i><i class="roll"></i><i class="scan"></i><i class="vig"></i><i class="fl"></i>';
    h.appendChild(el);
  }

  const bar = ensureFxBar();
  btn = document.createElement('button');
  btn.id = 'crt-switch'; btn.type = 'button'; btn.setAttribute('role', 'switch');
  btn.title = 'Old-TV look (F9)';
  btn.innerHTML = '<span class="knob"></span><span>CRT</span>';
  btn.addEventListener('click', () => { toggleCrt(); btn?.blur(); });
  bar.appendChild(btn);

  window.addEventListener('keydown', (e) => {
    if (e.code !== 'F9' || e.repeat || (e.target as HTMLElement | null)?.closest?.('input, textarea')) return;
    e.preventDefault(); toggleCrt();
  });
  const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion:reduce)').matches;
  if (!reducedMotion) { document.body.insertAdjacentHTML('beforeend', SVG); schedule(); }
  apply();
  initPixelArt();
  initFpsCounter();
}

export function disposeCrt() {
  clearTimeout(timer);
  disposePixelArt();
  document.querySelectorAll('.crt').forEach((e) => e.remove());
  document.getElementById('crt-switch')?.remove();
  document.getElementById('fx-bar')?.remove();
  document.getElementById('crt-css')?.remove();
  document.getElementById('crt-wave')?.closest('svg')?.remove();
  btn = null; hosts = [];
}
