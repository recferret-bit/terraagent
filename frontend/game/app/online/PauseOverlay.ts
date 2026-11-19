import { FPS_LIMITS, getFpsCap, onFpsCapChange, setFpsCap, type FpsLimit } from '@terra/render/core/perfConfig';
import { setGameInputBlocked } from '../../core/input/gameInputBlock';
import '../../core/ui/scrim.css';

/** Input-block source of the pause dialog: game hotkeys stay quiet and the global map does not open while paused. */
export const PAUSE_INPUT_SOURCE = 'pause';

export interface PauseOverlayCallbacks {
  onResume(): void;
  onReturnToOrbit(): void;
}

/**
 * Faction Plate pause dialog for the online play flow (`Esc` key):
 * lets the player adjust Max FPS live, resume, or return to the 3D orbital planet selection screen.
 */
export class PauseOverlay {
  readonly el: HTMLElement;
  private isPaused = false;
  private readonly fpsButtons: HTMLButtonElement[] = [];
  private readonly offFpsCap: () => void;

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

    const fpsSection = document.createElement('div');
    fpsSection.className = 'ta-pause-fps';
    fpsSection.dataset.testid = 'pause-fps-cap';
    const fpsLbl = document.createElement('div');
    fpsLbl.className = 'ta-pause-fps__label';
    fpsLbl.textContent = 'MAX FPS';
    const fpsRow = document.createElement('div');
    fpsRow.className = 'ta-pause-fps__options';
    for (const cap of FPS_LIMITS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ta-pause-fps__btn';
      btn.dataset.fpsCap = String(cap);
      btn.textContent = cap === 0 ? 'MAX' : `${cap}`;
      btn.addEventListener('click', () => {
        setFpsCap(cap);
        this.syncFpsButtons(getFpsCap());
      });
      this.fpsButtons.push(btn);
      fpsRow.appendChild(btn);
    }
    fpsSection.append(fpsLbl, fpsRow);
    this.syncFpsButtons(getFpsCap());
    this.offFpsCap = onFpsCapChange((cap) => this.syncFpsButtons(cap));

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

    box.appendChild(hazard);
    box.appendChild(title);
    box.appendChild(fpsSection);
    box.appendChild(resumeBtn);
    box.appendChild(returnBtn);
    this.el.appendChild(box);
    parent.appendChild(this.el);
  }

  private syncFpsButtons(activeCap: FpsLimit): void {
    for (const btn of this.fpsButtons) {
      btn.setAttribute('aria-pressed', String(Number(btn.dataset.fpsCap) === activeCap));
    }
  }

  get paused(): boolean {
    return this.isPaused;
  }

  setPaused(paused: boolean): void {
    this.isPaused = paused;
    if (paused) this.syncFpsButtons(getFpsCap());
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
    if (this.isPaused) setGameInputBlocked(PAUSE_INPUT_SOURCE, false);
    this.el.remove();
  }
}
