import { makeBtn, makeDiv } from './dom';

/** Expandable building content owned by the selection bar. Features supply content and callbacks. */
export class SelectionDetails {
  readonly body = makeDiv('ta-selection-details');
  readonly toggle = makeBtn('ta-hq-panel__cancel', 'selection-details-toggle', 'DETAILS', () => this.onToggle?.(!this.open));
  private open = false;
  private onToggle?: (open: boolean) => void;

  constructor(private readonly parent: HTMLElement) {
    this.body.hidden = true;
    this.toggle.hidden = true;
    parent.append(this.toggle, this.body);
  }

  show(content: HTMLElement, open: boolean, onToggle: (open: boolean) => void): void {
    if (content.parentElement !== this.body) this.body.replaceChildren(content);
    this.open = open;
    this.onToggle = onToggle;
    this.toggle.hidden = false;
    this.toggle.textContent = open ? 'HIDE DETAILS' : 'SHOW DETAILS';
    this.toggle.setAttribute('aria-expanded', String(open));
    this.body.hidden = !open;
    this.parent.setAttribute('data-expanded', String(open));
  }

  hide(): void {
    this.toggle.hidden = true;
    this.body.hidden = true;
    this.parent.setAttribute('data-expanded', 'false');
  }
}

declare module '../../core/registry/types' {
  interface FeatureServices { selectionDetails?: SelectionDetails }
}
