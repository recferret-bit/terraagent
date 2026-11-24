import type { OrbitalProjectedFrame } from '@terra/render/orbit/types';
import './flagshipLabel.css';

/**
 * Name plate of the planet's Lead Patron flagship (`ISS <pilot>.near`, W28-12), drawn over the orbit menu at the screen
 * anchor the stage projects each frame. The name is server text: it only ever goes through `textContent`.
 */
export class FlagshipLabel {
  readonly el = document.createElement('div');
  private readonly tagEl = document.createElement('span');
  private readonly nameEl = document.createElement('span');
  private shown = false;
  private lastName = '';

  constructor(parent: HTMLElement) {
    this.el.className = 'flagship-label';
    this.el.dataset.testid = 'flagship-label';
    this.el.hidden = true;
    this.tagEl.className = 'flagship-label-tag';
    this.tagEl.textContent = 'LEAD PATRON · FLAGSHIP';
    this.nameEl.className = 'flagship-label-name';
    this.el.append(this.tagEl, this.nameEl);
    parent.appendChild(this.el);
  }

  /** Call every frame with the stage's projection (null or no flagship hides the plate). */
  sync(frame: OrbitalProjectedFrame | null): void {
    const f = frame?.flagship;
    const show = Boolean(f && f.visible);
    if (show !== this.shown) {
      this.shown = show;
      this.el.hidden = !show;
    }
    if (!f || !show) return;
    if (f.name !== this.lastName) {
      this.lastName = f.name;
      this.nameEl.textContent = f.name;
    }
    const xExpr = `clamp(calc(25.5vw + 162px), ${(f.nx * 100).toFixed(2)}vw, calc(66vw - 162px))`;
    const yExpr = `max(166px, ${(f.ny * 100).toFixed(2)}vh)`;
    this.el.style.transform = `translate3d(${xExpr}, ${yExpr}, 0) translate(-50%, -100%)`;
  }

  dispose(): void { this.el.remove(); }
}
