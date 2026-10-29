/* Old-TV / VHS look over the 3D PICTURE only (ported from freightchain's ui/crt.js): crawling scanlines, a slow rolling
   bright band, soft flicker, tape grain, a vignette and a rare sideways distortion wave on the canvases.
   One absolutely-positioned layer per host (the element that holds a WebGL canvas), so HTML interface layers that sit
   above the host are never touched. Plus a small on/off switch (button, or F9). The choice is remembered.
   Pure CSS + wall-clock animation — a look only, never read by game logic. reduced-motion keeps still lines + vignette. */

const KEY = 'terraagent.crt';
const CFG = { ON: true, LINE: 3, SCAN: 0.18, CRAWL_S: 0.9, ROLL: 0.045, ROLL_S: 8, NOISE: 0.05, FLICKER: 0.05, VIGNETTE: 0.5, WAVE_EVERY: [12, 35], WAVE_DUR: [0.5, 0.9], WAVE_PX: 14, WAVE_FREQ: 0.012 } as const;
const px = CFG.LINE;

const store = {
  get(k: string, d: string) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

const NOISE = `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .9 0'/></filter><rect width='160' height='160' filter='url(%23n)'/></svg>`)}")`;

const CSS = `
[data-crt-host]{isolation:isolate}
.crt{position:absolute;inset:0;z-index:1;pointer-events:none;overflow:hidden}
.crt i{position:absolute;inset:0;display:block;will-change:transform,opacity}
.crt .scan{inset:-${px}px 0 0;background:repeating-linear-gradient(0deg,#0000 0 ${px - 1}px,rgba(0,0,0,${CFG.SCAN}) ${px - 1}px ${px}px);animation:crt-crawl ${CFG.CRAWL_S}s linear infinite}
.crt .roll{top:-30%;height:30%;background:linear-gradient(0deg,#0000,rgba(255,255,255,${CFG.ROLL}) 55%,#0000);animation:crt-roll ${CFG.ROLL_S}s linear infinite}
.crt .noise{inset:-160px;background:${NOISE};opacity:${CFG.NOISE};animation:crt-noise .5s steps(5,end) infinite}
.crt .vig{background:radial-gradient(ellipse at 50% 52%,#0000 55%,rgba(0,0,0,${CFG.VIGNETTE}) 100%)}
.crt .fl{background:#000;opacity:0;animation:crt-flicker 3.7s ease-in-out infinite}
body.crt-off .crt{display:none}
#crt-switch{position:fixed;left:12px;bottom:12px;z-index:60;opacity:.6;transition:opacity .2s;display:flex;align-items:center;gap:8px;
  font:600 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:#cfd6e4;
  background:rgba(8,10,16,.78);border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:7px 12px 7px 9px;cursor:pointer;backdrop-filter:blur(6px)}
#crt-switch:hover,#crt-switch:focus-visible{opacity:1;border-color:rgba(255,255,255,.4)}
#crt-switch:focus-visible{outline:2px solid #ff6a1a;outline-offset:2px}
#crt-switch .knob{width:26px;height:14px;border-radius:999px;background:#3a4152;position:relative;transition:background .15s}
#crt-switch .knob::after{content:"";position:absolute;top:2px;left:2px;width:10px;height:10px;border-radius:50%;background:#cfd6e4;transition:transform .15s}
#crt-switch[aria-checked="true"] .knob{background:#ff6a1a}
#crt-switch[aria-checked="true"] .knob::after{transform:translateX(12px);background:#fff}
@keyframes crt-crawl{to{transform:translateY(${px}px)}}
@keyframes crt-roll{to{transform:translateY(433%)}}
@keyframes crt-noise{0%{transform:translate(0,0)}20%{transform:translate(-37px,23px)}40%{transform:translate(41px,-60px)}60%{transform:translate(-70px,-19px)}80%{transform:translate(28px,52px)}100%{transform:translate(0,0)}}
@keyframes crt-flicker{0%,100%{opacity:0}18%{opacity:${CFG.FLICKER}}22%{opacity:0}61%{opacity:0}64%{opacity:${CFG.FLICKER * 0.6}}70%{opacity:0}}
@media (prefers-reduced-motion:reduce){.crt i{animation:none}.crt .roll,.crt .noise,.crt .fl{display:none}}`;

const SVG = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><filter id="crt-wave" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feTurbulence type="turbulence" baseFrequency="0 ${CFG.WAVE_FREQ}" numOctaves="1" seed="3" result="n"/><feOffset in="n" dy="0" result="m"/><feDisplacementMap in="SourceGraphic" in2="m" scale="0" xChannelSelector="R" yChannelSelector="R"/></filter></svg>`;

let on = true;
let waving = false;
let timer = 0;
let btn: HTMLButtonElement | null = null;
const rnd = ([a, b]: readonly number[]) => a + Math.random() * (b - a);
const listeners = new Set<(on: boolean) => void>();

let hosts: HTMLElement[] = [];
/** The distortion wave shears the hosts' canvases sideways for ~0.7 s; the SVG filter is attached only during a wave. */
function wave() {
  const f = document.getElementById('crt-wave');
  const off = f?.querySelector('feOffset'), dm = f?.querySelector('feDisplacementMap');
  const els = hosts.flatMap((h) => [...h.querySelectorAll<HTMLElement>('canvas')]);
  if (!on || waving || document.hidden || !dm || !off || !els.length) return;
  waving = true;
  const dur = rnd(CFG.WAVE_DUR) * 1000, t0 = performance.now(), speed = rnd([300, 700]), amp = CFG.WAVE_PX * rnd([0.6, 1]);
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
const schedule = () => { timer = window.setTimeout(() => { wave(); schedule(); }, rnd(CFG.WAVE_EVERY) * 1000); };

const apply = () => {
  document.body.classList.toggle('crt-off', !on);
  btn?.setAttribute('aria-checked', String(on));
  listeners.forEach((l) => l(on));
};

export function setCrt(v: boolean) { on = v; apply(); store.set(KEY, on ? '1' : '0'); return on; }
export const toggleCrt = () => setCrt(!on);
export const isCrtOn = () => on;
export const onCrtChange = (fn: (on: boolean) => void) => { listeners.add(fn); return () => listeners.delete(fn); };

/** Mount one overlay per host (each host must contain the WebGL canvas) + the switch. Safe to call repeatedly. */
export function initCrt(targets: HTMLElement[]) {
  if (document.getElementById('crt-css')) return;
  hosts = targets.filter(Boolean);
  on = store.get(KEY, CFG.ON ? '1' : '0') === '1';
  document.head.insertAdjacentHTML('beforeend', `<style id="crt-css">${CSS}</style>`);
  for (const h of hosts) {
    if (getComputedStyle(h).position === 'static') h.style.position = 'relative';
    h.dataset.crtHost = '';
    const el = document.createElement('div');
    el.className = 'crt'; el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '<i class="noise"></i><i class="roll"></i><i class="scan"></i><i class="vig"></i><i class="fl"></i>';
    h.appendChild(el);
  }

  btn = document.createElement('button');
  btn.id = 'crt-switch'; btn.type = 'button'; btn.setAttribute('role', 'switch');
  btn.title = 'Old-TV look (F9)';
  btn.innerHTML = '<span class="knob"></span><span>CRT</span>';
  btn.addEventListener('click', () => { toggleCrt(); btn?.blur(); });
  document.body.appendChild(btn);

  window.addEventListener('keydown', (e) => {
    if (e.code !== 'F9' || e.repeat || (e.target as HTMLElement | null)?.closest?.('input, textarea')) return;
    e.preventDefault(); toggleCrt();
  });
  apply();
  if (!matchMedia('(prefers-reduced-motion:reduce)').matches) { document.body.insertAdjacentHTML('beforeend', SVG); schedule(); }
}

export function disposeCrt() {
  clearTimeout(timer);
  document.querySelectorAll('.crt').forEach((e) => e.remove()); document.getElementById('crt-switch')?.remove();
  document.getElementById('crt-css')?.remove(); document.getElementById('crt-wave')?.closest('svg')?.remove();
  btn = null; hosts = [];
}
