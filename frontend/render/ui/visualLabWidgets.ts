/* Head widgets of the F8 Visual Shader Lab tabs: the sun pad (SHADOW), the solar clock (DAY/NIGHT), the wind
   compass (WIND) and the live frame readout (PERF). Each is `{ html, bind, sync }`; `pixelDialog.ts` draws the active tab's head above its sliders. */
import { computeSolarState, getDayNightParams, isDayNightOn, setDayNight, setDayNightParams } from '../core/dayNightConfig';
import { computeSunOffset, getShadowParams, isShadowOn, setShadow, setShadowParams } from '../core/shadowConfig';
import { getWindParams, isWindOn, setWind, setWindParams } from '../core/windConfig';
import {
  getPerfParams, getRenderScaleMode, isPerfOn, perfTelemetry, RENDER_SCALES, setPerf, setPerfParams,
} from '../core/perfConfig';
import { targetRefreshMs } from '../core/renderScale';
import { getViewFocus, isViewFocusFrozen } from '../core/viewFocus';
export { bindWeatherHead, syncWeatherHead, WEATHER_HEAD, WEATHER_HEAD_HTML } from './visualLabWeatherWidget';

export interface VisualLabHead {
  html(): string;
  /** Wires the widget's events; called each time the tab's panel is (re)built inside `box`. */
  bind(box: HTMLElement): void;
  /** Mirrors the current store state into the widget. */
  sync(box: HTMLElement): void;
}

/**
 * Drag on a round pad: `apply(azimuthDeg, dist)` with the azimuth measured like the sun pad (screen right = 0°,
 * screen down = 90°, i.e. world +x / +z) and `dist` 0 (centre) .. 1 (rim).
 */
function bindPad(pad: HTMLElement | null, apply: (azimDeg: number, dist: number) => void): void {
  if (!pad) return;
  let dragging = false;
  const fromPointer = (e: PointerEvent) => {
    const rect = pad.getBoundingClientRect();
    const R = rect.width * 0.5;
    const dx = (e.clientX - (rect.left + R)) / Math.max(1, R - 5);
    const dy = (e.clientY - (rect.top + R)) / Math.max(1, R - 5);
    apply(((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360, Math.min(1, Math.hypot(dx, dy)));
  };
  pad.addEventListener('pointerdown', (e: PointerEvent) => {
    dragging = true;
    pad.setPointerCapture(e.pointerId);
    fromPointer(e);
  });
  pad.addEventListener('pointermove', (e: PointerEvent) => { if (dragging) fromPointer(e); });
  pad.addEventListener('pointerup', () => { dragging = false; });
}

const shadowOn = () => { if (!isShadowOn()) setShadow(true); };

export const SUN_HEAD: VisualLabHead = {
  html: () => `
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
    </div>`,
  bind(box) {
    bindPad(box.querySelector<HTMLElement>('#pd-sun-pad'), (azim, dist) => {
      const elev = Math.round(85 - dist * 77);
      shadowOn();
      setShadowParams({ sunAzimuth: Math.round(azim), sunElevation: Math.max(8, Math.min(85, elev)) });
    });
    box.querySelectorAll<HTMLButtonElement>('[data-sun-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const [az, el] = (btn.dataset.sunPreset ?? '38,38').split(',').map(Number);
        shadowOn();
        setShadowParams({ sunAzimuth: az, sunElevation: el, sunOrbitSpeed: 0 });
      });
    });
    box.querySelector<HTMLButtonElement>('#pd-sun-orbit')?.addEventListener('click', () => {
      shadowOn();
      const cur = getShadowParams().sunOrbitSpeed;
      setShadowParams({ sunOrbitSpeed: cur > 0.1 ? 0 : 12 });
    });
  },
  sync(box) {
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
  },
};

export const CYCLE_HEAD: VisualLabHead = {
  html: () => `
    <div class="pd-sun-box" id="pd-cycle-box">
      <span class="pd-lbl"><span>SOLAR CLOCK &amp; SUN COLOR</span><b id="pd-cycle-clock"></b></span>
      <div class="pd-sun-row">
        <div id="pd-sun-swatch" title="Active sun color based on time of day" style="width:36px;height:36px;border:1px solid #2f384a;flex-shrink:0"></div>
        <div class="pd-sun-presets" style="grid-template-columns:repeat(4,1fr)">
          <button type="button" class="pd-sun-btn" data-time-preset="6">DAWN</button>
          <button type="button" class="pd-sun-btn" data-time-preset="12">NOON</button>
          <button type="button" class="pd-sun-btn" data-time-preset="18">DUSK</button>
          <button type="button" class="pd-sun-btn" data-time-preset="0">NIGHT</button>
        </div>
      </div>
    </div>`,
  bind(box) {
    box.querySelectorAll<HTMLButtonElement>('[data-time-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const hour = Number(btn.dataset.timePreset ?? 12);
        if (!isDayNightOn()) setDayNight(true);
        setDayNightParams({ timeOfDay: hour }, 'user');
      });
    });
  },
  sync(box) {
    const sp = getShadowParams();
    const solar = computeSolarState(getDayNightParams(), sp.sunAzimuth, sp.sunElevation);
    const clk = box.querySelector<HTMLElement>('#pd-cycle-clock');
    if (clk) clk.textContent = `${solar.clockText} · ${solar.period} · ${solar.sunColorHex.toUpperCase()}`;
    const sw = box.querySelector<HTMLElement>('#pd-sun-swatch');
    if (sw) {
      sw.style.background = solar.sunColorHex;
      sw.style.boxShadow = `0 0 10px ${solar.sunColorHex}`;
    }
  },
};

const windOn = () => { if (!isWindOn()) setWind(true); };

/** Wind compass: drag sets where the wind blows TOWARD (arrow); presets set strength or rotate by 45°. */
export const WIND_HEAD: VisualLabHead = {
  html: () => `
    <div class="pd-sun-box" id="pd-wind-box">
      <span class="pd-lbl"><span>WIND DIRECTION</span><b id="pd-wind-read"></b></span>
      <div class="pd-sun-row">
        <div class="pd-sun-pad" id="pd-wind-pad" title="Drag to set where the wind blows (screen right = world +X, down = +Z)">
          <i class="pd-sun-ring"></i>
          <i class="pd-wind-arrow" id="pd-wind-arrow"></i>
          <i class="pd-wind-hub"></i>
        </div>
        <div class="pd-sun-presets">
          <button type="button" class="pd-sun-btn" data-wind-strength="0">CALM</button>
          <button type="button" class="pd-sun-btn" data-wind-strength="0.8">BREEZE</button>
          <button type="button" class="pd-sun-btn" data-wind-strength="1.3">WINDY</button>
          <button type="button" class="pd-sun-btn" data-wind-strength="2">GALE</button>
          <button type="button" class="pd-sun-btn" data-wind-rotate="-45">⟲ 45°</button>
          <button type="button" class="pd-sun-btn" data-wind-rotate="45">⟳ 45°</button>
        </div>
      </div>
    </div>`,
  bind(box) {
    bindPad(box.querySelector<HTMLElement>('#pd-wind-pad'), (azim) => {
      windOn();
      setWindParams({ directionDeg: Math.round(azim) });
    });
    box.querySelectorAll<HTMLButtonElement>('[data-wind-strength]').forEach((btn) => {
      btn.addEventListener('click', () => {
        windOn();
        setWindParams({ strength: Number(btn.dataset.windStrength ?? 0.8) });
      });
    });
    box.querySelectorAll<HTMLButtonElement>('[data-wind-rotate]').forEach((btn) => {
      btn.addEventListener('click', () => {
        windOn();
        const next = (getWindParams().directionDeg + Number(btn.dataset.windRotate ?? 0) + 360) % 360;
        setWindParams({ directionDeg: Math.round(next) });
      });
    });
  },
  sync(box) {
    const p = getWindParams();
    const read = box.querySelector<HTMLElement>('#pd-wind-read');
    if (read) read.textContent = `TOWARD ${Math.round(p.directionDeg)}° · ${isWindOn() ? p.strength.toFixed(2) : 'OFF'}`;
    const arrow = box.querySelector<HTMLElement>('#pd-wind-arrow');
    if (arrow) {
      const len = isWindOn() ? 10 + Math.min(1, p.strength / 2) * 22 : 8;
      arrow.style.width = `${len}px`;
      arrow.style.transform = `rotate(${p.directionDeg}deg)`;
      arrow.style.opacity = isWindOn() ? '1' : '0.4';
    }
    box.querySelectorAll<HTMLElement>('[data-wind-strength]').forEach((b) => {
      b.classList.toggle('on', isWindOn() && Math.abs(Number(b.dataset.windStrength) - p.strength) < 0.03);
    });
  },
};

const READOUT_MS = 250;
const readoutTimers = new WeakMap<HTMLElement, number>();

function perfReadout(): [string, string] {
  const t = perfTelemetry;
  const mode = getRenderScaleMode();
  const fps = t.frameMs > 0 ? Math.round(1000 / t.frameMs) : 0;
  const f = getViewFocus();
  const focus = f.enabled && f.radius < 1e5
    ? `FOCUS ${Math.round(f.radius)} M (VIS ${Math.round(f.visibleRadius)})${isViewFocusFrozen() ? ' FROZEN' : ''}` : 'FOCUS OFF';
  const modeName = mode === 'auto' ? 'AUTO' : mode === 'native' ? 'NATIVE' : 'FIXED';
  const target = targetRefreshMs();
  const aim = mode === 'auto' && target ? ` → ${Math.round(1000 / Math.max(target, 1000 / 120))}` : '';
  return [
    `×${t.dpr.toFixed(2)} ${modeName} · ${t.canvasW}×${t.canvasH} PX`,
    `${fps}${aim} FPS · ${t.frameMs.toFixed(1)} MS · ${focus}`,
  ];
}

/** PERF: live render scale / canvas / frame time / focus readout (polled while open) + render-scale quick picks. */
export const PERF_HEAD: VisualLabHead = {
  html: () => `
    <div class="pd-sun-box" id="pd-perf-box">
      <span class="pd-lbl"><span>LIVE</span><b id="pd-perf-read"></b></span>
      <span class="pd-lbl"><span></span><b id="pd-perf-read2"></b></span>
      <div class="pd-sun-presets" style="grid-template-columns:repeat(5,1fr)">
        ${RENDER_SCALES.map((s, i) => `<button type="button" class="pd-sun-btn" data-perf-scale="${i}">${s === 'auto' ? 'AUTO' : `×${s}`}</button>`).join('')}
      </div>
    </div>`,
  bind(box) {
    box.querySelectorAll<HTMLButtonElement>('[data-perf-scale]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!isPerfOn()) setPerf(true);
        setPerfParams({ renderScale: Number(btn.dataset.perfScale ?? 0) });
      });
    });
    clearInterval(readoutTimers.get(box));
    const id = window.setInterval(() => {
      if (!box.querySelector('#pd-perf-read')) { clearInterval(id); readoutTimers.delete(box); return; }
      if (box.classList.contains('open')) PERF_HEAD.sync(box);
    }, READOUT_MS);
    readoutTimers.set(box, id);
  },
  sync(box) {
    const [a, b] = perfReadout();
    const r1 = box.querySelector<HTMLElement>('#pd-perf-read');
    const r2 = box.querySelector<HTMLElement>('#pd-perf-read2');
    if (r1) r1.textContent = a;
    if (r2) r2.textContent = b;
    const cur = Math.round(getPerfParams().renderScale);
    box.querySelectorAll<HTMLElement>('[data-perf-scale]').forEach((btn) => {
      btn.classList.toggle('on', isPerfOn() && Number(btn.dataset.perfScale) === cur);
    });
  },
};
