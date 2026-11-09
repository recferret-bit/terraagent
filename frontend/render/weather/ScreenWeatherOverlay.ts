import {
  DEFAULT_WEATHER_PARAMS,
  getRainLevel,
  getWeatherParams,
  setWeatherParams,
  type WeatherParams,
} from '../core/weatherConfig';

export type MeteorScreenPhase = 'idle' | 'shadow-full' | 'shadow-shrink' | 'flash-constant' | 'flash-fade';

export type ScreenTargetLocator = () => { x: number; y: number } | null;

const METEOR_PHASE1_END = 1.1;
const METEOR_PHASE2_END = 2.1;
const METEOR_FLASH_HOLD_END = 2.42;
const METEOR_SEQUENCE_END = 2.85;
const LIGHTNING_FLASH_DURATION = 0.35;

/**
 * Ensures `getWeatherParams()` always returns populated defaults and `patchWeatherParams`
 * safely updates parameters even when `weatherConfig` store ranges are unconfigured.
 */
export function readWeatherParams(): WeatherParams {
  const raw = (getWeatherParams() ?? {}) as Partial<WeatherParams>;
  if (raw.twisterHeight === undefined) {
    Object.assign(raw, DEFAULT_WEATHER_PARAMS);
  }
  return {
    rainIntensity: typeof raw.rainIntensity === 'number' ? raw.rainIntensity : DEFAULT_WEATHER_PARAMS.rainIntensity,
    stormActive: typeof raw.stormActive === 'boolean' ? raw.stormActive : DEFAULT_WEATHER_PARAMS.stormActive,
    stormDarkness: typeof raw.stormDarkness === 'number' ? raw.stormDarkness : DEFAULT_WEATHER_PARAMS.stormDarkness,
    lightningFlash: typeof raw.lightningFlash === 'number' ? raw.lightningFlash : DEFAULT_WEATHER_PARAMS.lightningFlash,
    meteorShadowScale:
      typeof raw.meteorShadowScale === 'number' ? raw.meteorShadowScale : DEFAULT_WEATHER_PARAMS.meteorShadowScale,
    twisterHeight: typeof raw.twisterHeight === 'number' ? raw.twisterHeight : DEFAULT_WEATHER_PARAMS.twisterHeight,
  } as WeatherParams;
}

export function patchWeatherParams(patch: Partial<WeatherParams>): WeatherParams {
  const target = getWeatherParams() as WeatherParams;
  if (target && typeof target === 'object') {
    Object.assign(target, DEFAULT_WEATHER_PARAMS, readWeatherParams(), patch);
  }
  try {
    setWeatherParams(patch);
    if (target && typeof target === 'object') {
      Object.assign(target, patch);
    }
  } catch {
    if (target && typeof target === 'object') {
      Object.assign(target, patch);
    }
  }
  return readWeatherParams();
}

function normalizeScreenPercent(pt: { x: number; y: number } | null | undefined): {
  cx: number;
  cy: number;
  edgeFade: number;
  offScreen: boolean;
} {
  if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) {
    return { cx: 50, cy: 50, edgeFade: 1, offScreen: false };
  }
  let { x, y } = pt;
  if (x >= 0 && x <= 1 && y >= 0 && y <= 1) {
    x *= 100;
    y *= 100;
  }
  const offScreen = x < -20 || x > 120 || y < -20 || y > 120;
  const overX = x < 0 ? -x : x > 100 ? x - 100 : 0;
  const overY = y < 0 ? -y : y > 100 ? y - 100 : 0;
  const edgeFade = offScreen ? 0 : Math.max(0, Math.min(1, 1 - Math.max(overX, overY) / 20));
  return {
    cx: Math.max(-30, Math.min(130, Math.round(x * 10) / 10)),
    cy: Math.max(-30, Math.min(130, Math.round(y * 10) / 10)),
    edgeFade,
    offScreen,
  };
}

function createOverlayDom(parent: HTMLElement): {
  root: HTMLElement;
  meteorLayer: HTMLElement;
  lightningLayer: HTMLElement;
  atmosphereLayer: HTMLElement;
} {
  const existing = parent.querySelector<HTMLElement>('[data-testid="weather-screen-overlay"]');
  if (existing) {
    const meteorLayer =
      existing.querySelector<HTMLElement>('[data-testid="weather-meteor-layer"]') ?? document.createElement('div');
    const lightningLayer =
      existing.querySelector<HTMLElement>('[data-testid="weather-lightning-layer"]') ?? document.createElement('div');
    const atmosphereLayer =
      existing.querySelector<HTMLElement>('[data-testid="weather-atmosphere-layer"]') ?? document.createElement('div');
    if (!meteorLayer.parentElement) existing.appendChild(meteorLayer);
    if (!lightningLayer.parentElement) existing.appendChild(lightningLayer);
    if (!atmosphereLayer.parentElement) existing.appendChild(atmosphereLayer);
    return { root: existing, meteorLayer, lightningLayer, atmosphereLayer };
  }

  const root = document.createElement('div');
  root.setAttribute('data-testid', 'weather-screen-overlay');
  root.setAttribute('data-phase', 'idle');
  root.setAttribute('data-lightning-flash', 'false');
  root.setAttribute('data-rain-level', 'none');
  root.setAttribute('data-storm-active', 'false');
  root.style.cssText =
    'position:fixed;inset:0;pointer-events:none;z-index:9990;overflow:hidden;opacity:1;transition:none;';
  root.style.pointerEvents = 'none';
  root.style.position = 'fixed';

  const atmosphereLayer = document.createElement('div');
  atmosphereLayer.setAttribute('data-testid', 'weather-atmosphere-layer');
  atmosphereLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;opacity:0;';
  atmosphereLayer.style.pointerEvents = 'none';

  const meteorLayer = document.createElement('div');
  meteorLayer.setAttribute('data-testid', 'weather-meteor-layer');
  meteorLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;opacity:0;';
  meteorLayer.style.pointerEvents = 'none';

  const lightningLayer = document.createElement('div');
  lightningLayer.setAttribute('data-testid', 'weather-lightning-layer');
  lightningLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;opacity:0;';
  lightningLayer.style.pointerEvents = 'none';

  root.appendChild(atmosphereLayer);
  root.appendChild(meteorLayer);
  root.appendChild(lightningLayer);
  parent.appendChild(root);
  return { root, meteorLayer, lightningLayer, atmosphereLayer };
}

/**
 * Full-screen pointer-events-none DOM overlay (`data-testid="weather-screen-overlay"`)
 * for the 3-phase Meteor Eclipse Shadow + Constant Impact Flash sequence and
 * double-pulse Lightning Screen Flash.
 */
export class ScreenWeatherOverlay {
  public readonly el: HTMLElement | null = null;
  private readonly parent: HTMLElement | null;
  private meteorLayer: HTMLElement | null = null;
  private lightningLayer: HTMLElement | null = null;
  private atmosphereLayer: HTMLElement | null = null;

  private meteorAge = -1;
  private meteorPhase: MeteorScreenPhase = 'idle';
  private getScreenTargetXY?: ScreenTargetLocator;

  private lightningAge = -1;
  private lightningIntensity = 1.0;

  constructor(parent?: HTMLElement | null) {
    readWeatherParams();
    this.parent = parent !== undefined ? parent : typeof document !== 'undefined' ? document.body : null;
    if (this.parent && typeof document !== 'undefined') {
      const dom = createOverlayDom(this.parent);
      this.el = dom.root;
      this.meteorLayer = dom.meteorLayer;
      this.lightningLayer = dom.lightningLayer;
      this.atmosphereLayer = dom.atmosphereLayer;
    }
  }

  public triggerMeteorScreenSequence(getScreenTargetXY?: ScreenTargetLocator): void {
    this.getScreenTargetXY = getScreenTargetXY;
    this.meteorAge = 0;
    this.meteorPhase = 'shadow-full';
    this.applyMeteorVisuals();
  }

  public triggerLightningScreenFlash(intensity = 1.0): void {
    const mult = readWeatherParams().lightningFlash;
    this.lightningIntensity = Math.max(0.1, intensity * mult);
    this.lightningAge = 0;
    this.applyLightningVisuals();
  }

  public getMeteorPhase(): MeteorScreenPhase {
    return this.meteorPhase;
  }

  public getMeteorAge(): number {
    return this.meteorAge;
  }

  public isLightningFlashActive(): boolean {
    return this.lightningAge >= 0 && this.lightningAge < LIGHTNING_FLASH_DURATION;
  }

  public update(dt: number): void {
    const step = Math.max(0, dt);
    if (this.meteorAge >= 0) {
      this.meteorAge += step;
      if (this.meteorAge >= METEOR_SEQUENCE_END) {
        this.meteorAge = -1;
        this.meteorPhase = 'idle';
      } else if (this.meteorAge < METEOR_PHASE1_END) {
        this.meteorPhase = 'shadow-full';
      } else if (this.meteorAge < METEOR_PHASE2_END) {
        this.meteorPhase = 'shadow-shrink';
      } else if (this.meteorAge < METEOR_FLASH_HOLD_END) {
        this.meteorPhase = 'flash-constant';
      } else {
        this.meteorPhase = 'flash-fade';
      }
      this.applyMeteorVisuals();
    }

    if (this.lightningAge >= 0) {
      this.lightningAge += step;
      if (this.lightningAge >= LIGHTNING_FLASH_DURATION) {
        this.lightningAge = -1;
      }
      this.applyLightningVisuals();
    }

    this.applyAtmosphereVisuals();
  }

  private applyMeteorVisuals(): void {
    if (!this.el || !this.meteorLayer) return;
    this.el.setAttribute('data-phase', this.meteorPhase);
    const params = readWeatherParams();
    const shadowScale = Math.max(0.5, Math.min(2.0, params.meteorShadowScale));
    const flashScale = Math.max(0.2, Math.min(2.0, params.lightningFlash));

    if (this.meteorPhase === 'idle' || this.meteorAge < 0) {
      this.meteorLayer.style.opacity = '0';
      this.meteorLayer.style.background = 'transparent';
      return;
    }

    if (this.meteorPhase === 'shadow-full') {
      // Phase 1 (0.0s -> 1.1s): Localized trajectory shadow tightens along the meteor path
      const target = normalizeScreenPercent(this.getScreenTargetXY?.());
      if (target.offScreen || target.edgeFade <= 0.001) {
        this.meteorLayer.style.opacity = '0';
        this.meteorLayer.style.background = 'transparent';
        return;
      }
      const p = Math.max(0, Math.min(1, this.meteorAge / METEOR_PHASE1_END));
      const innerRadius = (6 + (1 - p) * 14) * shadowScale;
      const outerRadius = (28 + (1 - p) * 26) * shadowScale;
      const peakAlpha = Math.min(0.92, (0.38 + p * 0.24) * Math.min(1.15, shadowScale));
      const midAlpha = (peakAlpha * 0.68).toFixed(3);
      this.meteorLayer.style.opacity = target.edgeFade.toFixed(3);
      this.meteorLayer.style.background = `radial-gradient(ellipse 115% 88% at ${target.cx.toFixed(1)}% ${target.cy.toFixed(1)}%, rgba(4, 6, 12, ${peakAlpha.toFixed(3)}) 0%, rgba(4, 6, 12, ${midAlpha}) ${innerRadius.toFixed(1)}%, rgba(4, 6, 12, 0) ${outerRadius.toFixed(1)}%)`;
      return;
    }

    if (this.meteorPhase === 'shadow-shrink') {
      // Phase 2 (1.1s -> 2.1s): Shadow contracts from outerRadius = 28 -> 8 onto the impact coordinates
      const target = normalizeScreenPercent(this.getScreenTargetXY?.());
      if (target.offScreen || target.edgeFade <= 0.001) {
        this.meteorLayer.style.opacity = '0';
        this.meteorLayer.style.background = 'transparent';
        return;
      }
      const u = Math.max(0, Math.min(1, (this.meteorAge - METEOR_PHASE1_END) / (METEOR_PHASE2_END - METEOR_PHASE1_END)));
      const ease = u * u * (3 - 2 * u);
      const innerRadius = (6 * (1 - ease) + 2.5 * ease) * shadowScale;
      const outerRadius = (28 * (1 - ease) + 8 * ease) * shadowScale;
      const peakAlpha = Math.min(0.94, (0.62 + ease * 0.22) * Math.min(1.15, shadowScale));
      const midAlpha = (peakAlpha * 0.72).toFixed(3);
      this.meteorLayer.style.opacity = target.edgeFade.toFixed(3);
      this.meteorLayer.style.background = `radial-gradient(ellipse 110% 85% at ${target.cx.toFixed(1)}% ${target.cy.toFixed(1)}%, rgba(4, 6, 12, ${peakAlpha.toFixed(3)}) 0%, rgba(4, 6, 12, ${midAlpha}) ${innerRadius.toFixed(1)}%, rgba(4, 6, 12, 0) ${outerRadius.toFixed(1)}%)`;
      return;
    }

    if (this.meteorPhase === 'flash-constant') {
      // Phase 3a (2.1s -> 2.42s): Full-screen constant bright white-amber flash
      const alpha = Math.min(1, 0.96 * flashScale);
      this.meteorLayer.style.opacity = alpha.toFixed(3);
      this.meteorLayer.style.background = 'rgba(255, 248, 225, 0.96)';
      return;
    }

    // Phase 3b (2.42s -> 2.85s): Constant flash fades out gradually
    const fadeU = Math.max(
      0,
      Math.min(1, (this.meteorAge - METEOR_FLASH_HOLD_END) / (METEOR_SEQUENCE_END - METEOR_FLASH_HOLD_END)),
    );
    const alpha = Math.max(0, (1 - fadeU) * 0.96 * Math.min(1.2, flashScale));
    this.meteorLayer.style.opacity = alpha.toFixed(3);
    this.meteorLayer.style.background = 'rgba(255, 248, 225, 0.96)';
  }

  private applyLightningVisuals(): void {
    if (!this.el || !this.lightningLayer) return;
    const active = this.isLightningFlashActive();
    this.el.setAttribute('data-lightning-flash', active ? 'true' : 'false');
    if (!active) {
      this.lightningLayer.style.opacity = '0';
      return;
    }
    const u = Math.max(0, Math.min(1, this.lightningAge / LIGHTNING_FLASH_DURATION));
    // Double-pulse flicker over 0.35s
    const pulse1 = u < 0.38 ? Math.sin((u / 0.38) * Math.PI) : 0;
    const pulse2 = u >= 0.44 ? Math.sin(((u - 0.44) / 0.56) * Math.PI) * 0.85 : 0;
    const env = Math.max(pulse1, pulse2, u < 0.12 ? 1 : 0.15 * (1 - u));
    const alpha = Math.min(1, 0.78 * env * this.lightningIntensity);
    this.lightningLayer.style.background = 'rgba(210, 245, 255, 0.78)';
    this.lightningLayer.style.opacity = alpha.toFixed(3);
  }

  private applyAtmosphereVisuals(): void {
    if (!this.el || !this.atmosphereLayer) return;
    const params = readWeatherParams();
    const rainLevel = getRainLevel(params.rainIntensity);
    this.el.setAttribute('data-rain-level', rainLevel);
    this.el.setAttribute('data-storm-active', params.stormActive ? 'true' : 'false');

    const darkness = Math.max(params.stormActive ? 0.28 : 0, params.stormDarkness * 0.38);
    const rainAlpha = Math.min(0.28, params.rainIntensity * 0.25);
    if (darkness <= 0.01 && rainAlpha <= 0.01) {
      this.atmosphereLayer.style.opacity = '0';
      return;
    }
    this.atmosphereLayer.style.opacity = '1';
    this.atmosphereLayer.style.background = `radial-gradient(circle at 50% 45%, rgba(16, 26, 42, ${(rainAlpha * 0.5).toFixed(3)}) 35%, rgba(6, 10, 18, ${(darkness + rainAlpha).toFixed(3)}) 100%)`;
  }

  public dispose(): void {
    if (!this.el) return;
    if (typeof this.el.remove === 'function') {
      this.el.remove();
    } else if (this.el.parentElement && typeof this.el.parentElement.removeChild === 'function') {
      this.el.parentElement.removeChild(this.el);
    }
  }
}
