import {
  DEFAULT_FPS_CAP,
  getFpsCap,
  getViewportPreset,
  isShaderOptimized,
  onPerfConfigChange,
  parseFpsLimit,
  setFpsCap,
  type FpsLimit,
  type ViewportPreset,
} from '@terra/render/core/perfConfig';
import {
  getShadowQuality,
  onShadowQualityChange,
  parseShadowQuality,
  setShadowQuality,
  SHADOW_QUALITY_PRESETS,
  type ShadowQualityPreset,
} from '@terra/render/core/shadowQuality';

const QUALITY_KEY = 'terraagent.quality';

export interface MenuSettings {
  bloom: boolean;
  quality: 'low' | 'high';
  shadows?: ShadowQualityPreset;
  skipCinematic: boolean;
  optimized: boolean;
  resolution: ViewportPreset;
  fpsCap: FpsLimit;
}

export function getSavedGraphicsQuality(): 'low' | 'high' {
  try {
    const saved = localStorage.getItem(QUALITY_KEY);
    return saved === 'low' ? 'low' : 'high';
  } catch {
    return 'high';
  }
}

export function saveGraphicsQuality(quality: 'low' | 'high'): void {
  try {
    localStorage.setItem(QUALITY_KEY, quality);
  } catch {
    /* private mode */
  }
}

export function createInitialMenuSettings(): MenuSettings {
  return {
    bloom: true,
    quality: getSavedGraphicsQuality(),
    shadows: getShadowQuality(),
    skipCinematic: false,
    optimized: isShaderOptimized(),
    resolution: getViewportPreset(),
    fpsCap: getFpsCap(),
  };
}

const RES_OPTIONS: ReadonlyArray<readonly [ViewportPreset, string]> = [
  ['auto', 'AUTO'],
  ['2560x1440', '2560×1440'],
  ['1920x1080', '1920×1080'],
  ['1280x720', '1280×720'],
];

const FPS_OPTIONS: ReadonlyArray<readonly [FpsLimit, string]> = [
  [0, 'UNCAPPED'],
  [120, '120 FPS'],
  [90, '90 FPS'],
  [60, '60 FPS'],
  [30, '30 FPS'],
];

function buildSettingsDialogHtml(settings: MenuSettings): string {
  const { quality, shadows = getShadowQuality(), optimized, resolution, fpsCap } = settings;
  const shadowRadios = SHADOW_QUALITY_PRESETS.map(
    (val) =>
      `<label><input type="radio" name="s-shadows" value="${val}" ${shadows === val ? 'checked' : ''} /><span>${val.toUpperCase()}</span></label>`,
  ).join('');
  const resRadios = RES_OPTIONS.map(
    ([val, label]) =>
      `<label><input type="radio" name="s-res" value="${val}" ${resolution === val ? 'checked' : ''} /><span>${label}</span></label>`,
  ).join('');
  const fpsRadios = FPS_OPTIONS.map(
    ([val, label]) =>
      `<label><input type="radio" name="s-fps" value="${val}" ${fpsCap === val ? 'checked' : ''} /><span>${label}</span></label>`,
  ).join('');

  return `<div class="hazard-system settings-dialog-bar"></div>
    <div class="settings-dialog-head">
      <div>
        <div class="eyebrow">ORBITAL SHIP // CONFIG</div>
        <h2 id="settings-dialog-title">SYSTEM SETTINGS</h2>
      </div>
      <button type="button" class="btn btn-ghost btn-sm" data-testid="settings-close">CLOSE</button>
    </div>
    <div class="settings-dialog-body">
      <div class="radio-group">
        <div class="field-label">GRAPHICS QUALITY</div>
        <div class="radios">
          <label><input type="radio" name="s-quality" value="high" ${quality === 'high' ? 'checked' : ''} /><span>HIGH</span></label>
          <label><input type="radio" name="s-quality" value="low" ${quality === 'low' ? 'checked' : ''} /><span>LOW</span></label>
        </div>
      </div>
      <div class="radio-group" data-testid="settings-shadows">
        <div class="field-label">SHADOWS</div>
        <div class="radios">${shadowRadios}</div>
      </div>
      <div class="radio-group">
        <div class="field-label">SHADER OPTIMIZATIONS</div>
        <div class="radios">
          <label><input type="radio" name="s-opt" value="1" ${optimized ? 'checked' : ''} /><span>ON</span></label>
          <label><input type="radio" name="s-opt" value="0" ${!optimized ? 'checked' : ''} /><span>OFF</span></label>
        </div>
      </div>
      <div class="radio-group" data-testid="settings-fps-cap">
        <div class="field-label">MAX FPS</div>
        <div class="radios">${fpsRadios}</div>
      </div>
      <div class="radio-group">
        <div class="field-label">VIEWPORT W×H</div>
        <div class="radios">${resRadios}</div>
      </div>
    </div>
    <div class="settings-dialog-foot"><span class="label">PRESS ESC TO CLOSE</span></div>`;
}

/**
 * Faction Plate `<dialog>` popup toggled via `Esc` (or header Settings button) on the planet selection screen.
 * Holds Graphics Quality, Shadows, Shader Optimizations, Max FPS, and Viewport W×H (with bloom kept enabled and no seed/skip inputs).
 */
export class SettingsModal {
  readonly dialog: HTMLDialogElement;
  private current: MenuSettings;
  private pressedOutside = false;
  private readonly offFpsCap: () => void;
  private readonly offShadowQuality: () => void;

  constructor(
    parent: HTMLElement,
    initial: MenuSettings,
    private readonly onChange: (next: MenuSettings) => void,
  ) {
    this.current = { ...initial };
    this.dialog = document.createElement('dialog');
    this.dialog.className = 'plate settings-dialog';
    this.dialog.setAttribute('closedby', 'any');
    this.dialog.setAttribute('aria-labelledby', 'settings-dialog-title');
    this.dialog.dataset.testid = 'settings-dialog';
    this.dialog.innerHTML = buildSettingsDialogHtml(this.current);
    parent.appendChild(this.dialog);
    this.bindEvents();
    this.offFpsCap = onPerfConfigChange((opt, res, cap) => {
      if (this.current.optimized === opt && this.current.resolution === res && this.current.fpsCap === cap) return;
      this.sync({ ...this.current, optimized: opt, resolution: res, fpsCap: cap });
    });
    this.offShadowQuality = onShadowQualityChange((shadows) => {
      if (this.current.shadows === shadows) return;
      this.sync({ ...this.current, shadows });
    });
  }

  isOpen(): boolean {
    return Boolean(this.dialog.open || this.dialog.hasAttribute('open'));
  }

  open(): void {
    this.sync({
      ...this.current,
      shadows: getShadowQuality(),
      optimized: isShaderOptimized(),
      resolution: getViewportPreset(),
      fpsCap: getFpsCap(),
    });
    if (typeof this.dialog.showModal === 'function') {
      if (!this.dialog.open) this.dialog.showModal();
    } else {
      this.dialog.setAttribute('open', '');
    }
  }

  close(): void {
    if (typeof this.dialog.close === 'function') {
      if (this.dialog.open) this.dialog.close();
      else this.dialog.removeAttribute('open');
    } else {
      this.dialog.removeAttribute('open');
    }
  }

  toggle(): boolean {
    if (this.isOpen()) {
      this.close();
      return false;
    }
    this.open();
    return true;
  }

  sync(settings: MenuSettings): void {
    this.current = { ...settings };
    this.dialog
      .querySelectorAll<HTMLInputElement>('input[name="s-quality"]')
      .forEach((r) => { r.checked = r.value === settings.quality; });
    const shadows = settings.shadows ?? getShadowQuality();
    this.dialog
      .querySelectorAll<HTMLInputElement>('input[name="s-shadows"]')
      .forEach((r) => { r.checked = r.value === shadows; });
    this.dialog
      .querySelectorAll<HTMLInputElement>('input[name="s-opt"]')
      .forEach((r) => { r.checked = r.value === (settings.optimized ? '1' : '0'); });
    this.dialog
      .querySelectorAll<HTMLInputElement>('input[name="s-fps"]')
      .forEach((r) => { r.checked = Number(r.value) === settings.fpsCap; });
    this.dialog
      .querySelectorAll<HTMLInputElement>('input[name="s-res"]')
      .forEach((r) => { r.checked = r.value === settings.resolution; });
  }

  private bindEvents(): void {
    this.dialog.querySelector<HTMLButtonElement>('[data-testid="settings-close"]')?.addEventListener('click', () => {
      this.close();
    });
    this.dialog
      .querySelectorAll<HTMLInputElement>('input[name="s-quality"], input[name="s-shadows"], input[name="s-opt"], input[name="s-fps"], input[name="s-res"]')
      .forEach((input) => {
        input.addEventListener('change', () => this.emitCurrent());
      });

    if (!('closedBy' in HTMLDialogElement.prototype)) {
      const isOutside = (e: PointerEvent): boolean => {
        const r = this.dialog.getBoundingClientRect();
        return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
      };
      this.dialog.addEventListener('pointerdown', (e) => {
        this.pressedOutside = isOutside(e);
      });
      this.dialog.addEventListener('pointerup', (e) => {
        if (this.pressedOutside && isOutside(e)) this.close();
      });
    }
  }

  private emitCurrent(): void {
    const qEl = this.dialog.querySelector<HTMLInputElement>('input[name="s-quality"]:checked');
    const shEl = this.dialog.querySelector<HTMLInputElement>('input[name="s-shadows"]:checked');
    const optEl = this.dialog.querySelector<HTMLInputElement>('input[name="s-opt"]:checked');
    const fpsEl = this.dialog.querySelector<HTMLInputElement>('input[name="s-fps"]:checked');
    const resEl = this.dialog.querySelector<HTMLInputElement>('input[name="s-res"]:checked');
    const quality = qEl?.value === 'low' ? 'low' : 'high';
    const shadows = parseShadowQuality(shEl?.value) ?? getShadowQuality();
    const fpsCap = parseFpsLimit(fpsEl?.value) ?? DEFAULT_FPS_CAP;
    saveGraphicsQuality(quality);
    setShadowQuality(shadows);
    setFpsCap(fpsCap);
    this.current = {
      ...this.current,
      bloom: true,
      skipCinematic: false,
      quality,
      shadows,
      optimized: optEl ? optEl.value === '1' : true,
      resolution: (resEl?.value as ViewportPreset) ?? 'auto',
      fpsCap,
    };
    this.onChange({ ...this.current });
  }

  dispose(): void {
    this.offFpsCap();
    this.offShadowQuality();
    this.close();
    this.dialog.remove();
  }
}
