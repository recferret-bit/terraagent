export interface PauseOverlayCallbacks {
  onResume(): void;
  onReturnToOrbit(): void;
}

/**
 * Faction Plate pause dialog for the online play flow (`Esc` key):
 * lets the player resume or return to the 3D orbital planet selection screen (`/play.html?planet=<kind>`).
 */
export class PauseOverlay {
  readonly el: HTMLElement;
  private isPaused = false;

  constructor(parent: HTMLElement, private readonly cb: PauseOverlayCallbacks) {
    this.el = document.createElement('div');
    this.el.className = 'ta-online-pause';
    this.el.setAttribute('data-testid', 'online-pause');
    this.el.dataset.testid = 'online-pause';
    this.el.hidden = true;

    const box = document.createElement('div');
    box.className = 'ta-online-pause__box plate';

    const hazard = document.createElement('div');
    hazard.className = 'ta-online-pause__hazard hazard';

    const title = document.createElement('h2');
    title.className = 'ta-online-pause__title';
    title.textContent = 'PAUSED';

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
    box.appendChild(resumeBtn);
    box.appendChild(returnBtn);
    this.el.appendChild(box);
    parent.appendChild(this.el);
  }

  get paused(): boolean {
    return this.isPaused;
  }

  setPaused(paused: boolean): void {
    this.isPaused = paused;
    this.el.hidden = !paused;
    this.el.dataset.active = paused ? 'true' : 'false';
  }

  toggle(): boolean {
    this.setPaused(!this.isPaused);
    return this.isPaused;
  }

  dispose(): void {
    this.el.remove();
  }
}
