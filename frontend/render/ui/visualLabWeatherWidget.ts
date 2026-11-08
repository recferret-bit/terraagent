import {
  getRainLevel,
  getTwisterAvailabilityHint,
  getWeatherParams,
  isTwisterAvailable,
  isWeatherOn,
  onWeatherChange,
  setWeather,
  setWeatherParams,
  triggerWeatherAction,
  type WeatherActionKind,
} from '../core/weatherConfig';
import { getWindParams, isWindOn, onWindChange, setWind, setWindParams } from '../core/windConfig';
import type { VisualLabHead } from './visualLabWidgets';

const widgetCleanups = new WeakMap<HTMLElement, () => void>();
const lastActionStatus = new WeakMap<HTMLElement, string>();

function classifyWindTier(strength: number): 'LOW' | 'MED' | 'HIGH' {
  if (strength >= 1.2) return 'HIGH';
  if (strength >= 0.45) return 'MED';
  return 'LOW';
}

export const WEATHER_HEAD_HTML = `
  <div class="pd-sun-box pd-weather-box" id="pd-weather-box">
    <span class="pd-lbl">
      <span>LIVE CONDITIONS</span>
      <b id="pd-weather-summary"></b>
    </span>
    <div class="pd-weather-banner" id="pd-weather-banner">
      <div class="pd-weather-cond">
        <span>WIND: <b id="pd-weather-wind"></b></span>
        <span>RAIN: <b id="pd-weather-rain"></b></span>
      </div>
      <div class="pd-weather-twister-status" id="pd-weather-twister-hint"></div>
    </div>
    <div class="pd-group">RAIN &amp; WEATHER SWITCH</div>
    <div class="pd-sun-presets pd-weather-rain-modes" id="pd-weather-rain-modes">
      <button type="button" class="pd-sun-btn" data-rain-mode="clear" data-weather-preset="clear" data-weather-act="clear">CLEAR</button>
      <button type="button" class="pd-sun-btn" data-rain-mode="rain-minor" data-weather-preset="rain-minor" data-weather-act="rain-minor">MINOR RAIN</button>
      <button type="button" class="pd-sun-btn" data-rain-mode="rain-heavy" data-weather-preset="rain-heavy" data-weather-act="rain-heavy">HEAVY RAIN</button>
      <button type="button" class="pd-sun-btn" data-rain-mode="storm" data-weather-preset="storm" data-weather-act="storm">STORM</button>
    </div>
    <div class="pd-group">HAZARD TRIGGERS &amp; PRESETS</div>
    <div class="pd-sun-presets pd-weather-presets">
      <button type="button" class="pd-sun-btn" data-weather-preset="twister-ready" data-weather-act="twister-ready">TWISTER READY</button>
    </div>
    <div class="pd-weather-actions">
      <button type="button" class="pd-sun-btn pd-weather-act-btn" data-weather-act="meteor">☄ METEOR (10 HEX)</button>
      <button type="button" class="pd-sun-btn pd-weather-act-btn" data-weather-act="twister" id="pd-weather-twister-btn">🌪 TWISTER</button>
      <button type="button" class="pd-sun-btn pd-weather-act-btn" data-weather-act="lightning">⚡ LIGHTNING (4 HEX)</button>
    </div>
    <div class="pd-weather-status" id="pd-weather-feedback">Ready for weather &amp; hazard controls</div>
  </div>`;

function ensureWeatherAndWindActive(): void {
  if (!isWeatherOn()) setWeather(true, 'user');
  if (!isWindOn()) setWind(true);
}

function applyWeatherPreset(overlay: HTMLElement, action: WeatherActionKind, refreshUI?: () => void): void {
  ensureWeatherAndWindActive();
  if (action === 'clear') {
    setWeatherParams({ rainIntensity: 0, stormActive: false, stormDarkness: 0 }, 'user');
    lastActionStatus.set(overlay, 'Cleared precipitation & storm clouds');
  } else if (action === 'rain-minor') {
    setWeatherParams({ rainIntensity: 0.35, stormActive: false, stormDarkness: 0.2 }, 'user');
    lastActionStatus.set(overlay, 'Set MINOR RAIN (35%)');
  } else if (action === 'rain-heavy') {
    setWeatherParams({ rainIntensity: 0.85, stormActive: false, stormDarkness: 0.45 }, 'user');
    lastActionStatus.set(overlay, 'Set HEAVY RAIN (85%)');
  } else if (action === 'twister-ready') {
    setWindParams({ strength: 1.35 }, 'user');
    setWeatherParams({ rainIntensity: 0.35, stormActive: false, stormDarkness: 0.25 }, 'user');
    lastActionStatus.set(overlay, 'Set HIGH wind (135%) + MINOR rain (35%) — Twister READY');
  } else if (action === 'storm') {
    setWindParams({ strength: 1.4 }, 'user');
    setWeatherParams({ rainIntensity: 0.85, stormActive: true, stormDarkness: 0.65 }, 'user');
    lastActionStatus.set(overlay, 'Activated STORM + HEAVY RAIN (85%)');
  }
  triggerWeatherAction(action);
  refreshUI?.();
  syncWeatherHead(overlay);
}

function handleHazardTrigger(overlay: HTMLElement, action: WeatherActionKind, refreshUI?: () => void): void {
  ensureWeatherAndWindActive();
  if (action === 'twister') {
    const windStr = isWindOn() ? getWindParams().strength : 0;
    const rainInt = isWeatherOn() ? getWeatherParams().rainIntensity : 0;
    const wasReady = isTwisterAvailable(windStr, rainInt);
    triggerWeatherAction(action);
    if (!isTwisterAvailable(getWindParams().strength, getWeatherParams().rainIntensity)) {
      setWindParams({ strength: Math.max(1.35, windStr) }, 'user');
      setWeatherParams({ rainIntensity: 0.35, stormActive: false, stormDarkness: 0.25 }, 'user');
    }
    lastActionStatus.set(
      overlay,
      wasReady
        ? 'Triggered TWISTER funnel hazard'
        : 'Auto-configured HIGH wind (135%) + MINOR rain (35%) & triggered TWISTER',
    );
    refreshUI?.();
    syncWeatherHead(overlay);
    return;
  }
  if (action === 'meteor') {
    lastActionStatus.set(overlay, 'Triggered METEOR strike (10 HEX radius)');
  } else if (action === 'lightning') {
    lastActionStatus.set(overlay, 'Triggered LIGHTNING strike (4 HEX radius)');
  }
  triggerWeatherAction(action);
  refreshUI?.();
  syncWeatherHead(overlay);
}

export function syncWeatherHead(overlay: HTMLElement): void {
  const wp = getWeatherParams();
  const weatherOn = isWeatherOn();
  const effRain = weatherOn ? wp.rainIntensity : 0;
  const effStorm = weatherOn && wp.stormActive;
  const windStr = isWindOn() ? getWindParams().strength : 0;
  const windTier = classifyWindTier(windStr);
  const windPct = Math.round(windStr * 100);
  const rainLevelKey = getRainLevel(effRain);
  const rainLvl = rainLevelKey.toUpperCase();
  const rainPct = Math.round(effRain * 100);
  const twisterOk = weatherOn && isTwisterAvailable(windStr, effRain);
  const hint = getTwisterAvailabilityHint(windStr, effRain);

  const summary = overlay.querySelector<HTMLElement>('#pd-weather-summary');
  if (summary) summary.textContent = effStorm ? 'STORM ACTIVE' : `${rainLvl} RAIN · ${windTier} WIND`;

  const windEl = overlay.querySelector<HTMLElement>('#pd-weather-wind');
  if (windEl) windEl.textContent = `${windTier} (${windPct}%)`;

  const rainEl = overlay.querySelector<HTMLElement>('#pd-weather-rain');
  if (rainEl) rainEl.textContent = `${rainLvl} (${rainPct}%)`;

  const hintEl = overlay.querySelector<HTMLElement>('#pd-weather-twister-hint');
  if (hintEl) {
    hintEl.textContent = twisterOk
      ? `TWISTER: ${hint}`
      : `TWISTER: NEEDS HIGH WIND & MINOR RAIN (${hint})`;
    hintEl.classList.toggle('ready', twisterOk);
    hintEl.classList.toggle('locked', !twisterOk);
  }

  const twisterBtn = overlay.querySelector<HTMLButtonElement>('#pd-weather-twister-btn');
  if (twisterBtn) {
    twisterBtn.disabled = false;
    twisterBtn.classList.toggle('locked', false);
    twisterBtn.classList.toggle('ready', twisterOk);
    twisterBtn.title = hint;
  }

  const fb = overlay.querySelector<HTMLElement>('#pd-weather-feedback');
  if (fb) fb.textContent = lastActionStatus.get(overlay) ?? hint;

  overlay.querySelectorAll<HTMLElement>('[data-weather-preset]').forEach((btn) => {
    const p = btn.dataset.weatherPreset;
    const isClear = p === 'clear' && (!weatherOn || (rainLevelKey === 'none' && !effStorm));
    const isMinor = p === 'rain-minor' && weatherOn && rainLevelKey === 'minor' && !effStorm;
    const isHeavy = p === 'rain-heavy' && weatherOn && rainLevelKey === 'heavy' && !effStorm;
    const isReady = p === 'twister-ready' && twisterOk && !effStorm;
    const isStorm = p === 'storm' && effStorm;
    btn.classList.toggle('on', isClear || isMinor || isHeavy || isReady || isStorm);
  });
}

export function bindWeatherHead(overlay: HTMLElement, refreshUI?: () => void): () => void {
  widgetCleanups.get(overlay)?.();

  overlay.querySelectorAll<HTMLButtonElement>('[data-weather-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const preset = btn.dataset.weatherPreset as WeatherActionKind | undefined;
      if (preset) applyWeatherPreset(overlay, preset, refreshUI);
    });
  });

  overlay.querySelectorAll<HTMLButtonElement>('.pd-weather-actions [data-weather-act]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const act = btn.dataset.weatherAct as WeatherActionKind | undefined;
      if (act) handleHazardTrigger(overlay, act, refreshUI);
    });
  });

  const offWind = onWindChange(() => syncWeatherHead(overlay));
  const offWeather = onWeatherChange(() => syncWeatherHead(overlay));
  const cleanup = () => {
    offWind();
    offWeather();
  };
  widgetCleanups.set(overlay, cleanup);
  syncWeatherHead(overlay);
  return cleanup;
}

export const WEATHER_HEAD: VisualLabHead = {
  html: () => WEATHER_HEAD_HTML,
  bind(box) {
    bindWeatherHead(box);
  },
  sync(box) {
    syncWeatherHead(box);
  },
};
