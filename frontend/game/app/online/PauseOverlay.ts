import { FPS_LIMITS, getFpsCap, onFpsCapChange, setFpsCap, type FpsLimit } from '@terra/render/core/perfConfig';
import {
  getShadowQuality,
  onShadowQualityChange,
  setShadowQuality,
  SHADOW_QUALITY_PRESETS,
  type ShadowQualityPreset,
} from '@terra/render/core/shadowQuality';
import { setGameInputBlocked } from '../../core/input/gameInputBlock';
import '../../core/ui/scrim.css';

/** Input-block source of the pause dialog: game hotkeys stay quiet and the global map does not open while paused. */
export const PAUSE_INPUT_SOURCE = 'pause';

export interface PauseOverlayCallbacks {
  onResume(): void;
  onReturnToOrbit(): void;
}

function buildOptionSection<T extends string | number>(
  labelText: string,
  testId: string,
  options: readonly T[],
  labelOf: (v: T) => string,
  dataAttr: 'fpsCap' | 'shadowQuality',
  onSelect: (v: T) => void,
): { el: HTMLDivElement; buttons: HTMLButtonElement[] } {
  const section = document.createElement('div');
  section.className = 'ta-pause-fps';
  section.dataset.testid = testId;
  const lbl = document.createElement('div');
  lbl.className = 'ta-pause-fps__label';
  lbl.textContent = labelText;
  const row = document.createElement('div');
  row.className = 'ta-pause-fps__options';
  const buttons: HTMLButtonElement[] = [];
  for (const val of options) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ta-pause-fps__btn';
    btn.dataset[dataAttr] = String(val);
    btn.textContent = labelOf(val);
    btn.addEventListener('click', () => onSelect(val));
    buttons.push(btn);
    row.appendChild(btn);
  }
  section.append(lbl, row);
  return { el: section, buttons };
}

/**
 * Faction Plate pause dialog for the online play flow (`Esc` key):
 * lets the player adjust Max FPS and Shadows live, resume, or return to the 3D orbital planet selection screen.
 */
export class PauseOverlay {
  readonly el: HTMLElement;
  private isPaused = false;
  private readonly fpsButtons: HTMLButtonElement[];
  private readonly shadowButtons: HTMLButtonElement[];
  private readonly offFpsCap: () => void;
  private readonly offShadowQuality: () => void;

  constructor(parent: HTMLElement, private readonly cb: PauseOverlayCallbacks) {
    this.el = document.createElement('div');
    this.el.className = 'ta-online-pause ta-scrim';
    this.el.setAttribute('data-testid', 'online-pause');
    this.el.dataset.testid = 'online-pause';
    this.el.hidden = true;

    const box = document.createElement('div');
    box.className = 'ta-online-pause__box ta-scrim__box plate';

    const hazard = document.createElement('div');
    hazard.className = 'ta-online-pause__hazard ta-scrim__hazard hazard';

    const title = document.createElement('h2');
    title.className = 'ta-online-pause__title ta-scrim__title';
    title.textContent = 'PAUSED';

    const fpsSection = buildOptionSection('MAX FPS', 'pause-fps-cap', FPS_LIMITS, (c) => (c === 0 ? 'MAX' : `${c}`), 'fpsCap', (cap) => {
      setFpsCap(cap);
      this.syncFpsButtons(getFpsCap());
    });
    this.fpsButtons = fpsSection.buttons;
    this.syncFpsButtons(getFpsCap());
    this.offFpsCap = onFpsCapChange((cap) => this.syncFpsButtons(cap));

    const shadowSection = buildOptionSection('SHADOWS', 'pause-shadows', SHADOW_QUALITY_PRESETS, (q) => q.toUpperCase(), 'shadowQuality', (q) => {
      setShadowQuality(q);
      this.syncShadowButtons(getShadowQuality());
    });
    this.shadowButtons = shadowSection.buttons;
    this.syncShadowButtons(getShadowQuality());
    this.offShadowQuality = onShadowQualityChange((q) => this.syncShadowButtons(q));

    const resumeBtn = document.createElement('button');
    resumeBtn.type = 'button';
    resumeBtn.className = 'btn btn-primary';
    resumeBtn.setAttribute('data-testid', 'pause-resume');
    resumeBtn.dataset.testid = 'pause-resume';
    resumeBtn.textContent = 'Resume';
    resumeBtn.addEventListener('click', () => {
      this.setPaused(false);
      this.cb.onResume();
    });

    const returnBtn = document.createElement('button');
    returnBtn.type = 'button';
    returnBtn.className = 'btn btn-ghost';
    returnBtn.setAttribute('data-testid', 'pause-return-orbit');
    returnBtn.dataset.testid = 'pause-return-orbit';
    returnBtn.textContent = 'Return to orbit';
    returnBtn.addEventListener('click', () => {
      this.setPaused(false);
      this.cb.onReturnToOrbit();
    });

    box.append(hazard, title, fpsSection.el, shadowSection.el, resumeBtn, returnBtn);
    this.el.appendChild(box);
    parent.appendChild(this.el);
  }

  private syncFpsButtons(activeCap: FpsLimit): void {
    for (const btn of this.fpsButtons) {
      btn.setAttribute('aria-pressed', String(Number(btn.dataset.fpsCap) === activeCap));
    }
  }

  private syncShadowButtons(activeQuality: ShadowQualityPreset): void {
    for (const btn of this.shadowButtons) {
      btn.setAttribute('aria-pressed', String(btn.dataset.shadowQuality === activeQuality));
    }
  }

  get paused(): boolean {
    return this.isPaused;
  }

  setPaused(paused: boolean): void {
    this.isPaused = paused;
    if (paused) {
      this.syncFpsButtons(getFpsCap());
      this.syncShadowButtons(getShadowQuality());
    }
    this.el.hidden = !paused;
    this.el.dataset.active = paused ? 'true' : 'false';
    setGameInputBlocked(PAUSE_INPUT_SOURCE, paused);
  }

  toggle(): boolean {
    this.setPaused(!this.isPaused);
    return this.isPaused;
  }

  dispose(): void {
    this.offFpsCap();
    this.offShadowQuality();
    if (this.isPaused) setGameInputBlocked(PAUSE_INPUT_SOURCE, false);
    this.el.remove();
  }
}
