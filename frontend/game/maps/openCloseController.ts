import { isTypingTarget } from '../features/shared/hotkeys';

export interface RtsCameraEnableTarget {
  enabled: boolean;
}

export interface GlobalMapOpenCloseOptions {
  readonly isWaveEnabled?: () => boolean;
  readonly getRtsCamera?: () => RtsCameraEnableTarget | null | undefined;
  readonly onStateChange?: (isOpen: boolean) => void;
}

const SUSPENDED_3D_KEYS = new Set([
  'w',
  'a',
  's',
  'd',
  'W',
  'A',
  'S',
  'D',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'q',
  'e',
  'Q',
  'E',
  'f',
  'F',
  ' ',
]);

export class GlobalMapOpenCloseController {
  private openState = false;
  private readonly isWaveEnabled: () => boolean;
  private readonly getRtsCamera?: () => RtsCameraEnableTarget | null | undefined;
  private readonly onStateChange?: (isOpen: boolean) => void;
  private readonly onKeyDownBound: (e: KeyboardEvent) => void;
  private readonly cleanups: Array<() => void> = [];

  constructor(opts: GlobalMapOpenCloseOptions = {}) {
    this.isWaveEnabled = opts.isWaveEnabled ?? (() => true);
    this.getRtsCamera = opts.getRtsCamera;
    this.onStateChange = opts.onStateChange;

    this.onKeyDownBound = (e: KeyboardEvent) => this.handleKeyDown(e);
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('keydown', this.onKeyDownBound, true);
    }
  }

  get isOpen(): boolean {
    return this.openState;
  }

  open(): void {
    if (!this.isWaveEnabled() || this.openState) return;
    this.openState = true;
    const cam = this.getRtsCamera?.();
    if (cam) cam.enabled = false;
    this.onStateChange?.(true);
  }

  close(): void {
    if (!this.openState) return;
    this.openState = false;
    const cam = this.getRtsCamera?.();
    if (cam) cam.enabled = true;
    this.onStateChange?.(false);
  }

  toggle(): void {
    if (this.openState) this.close();
    else this.open();
  }

  bindExpandButton(btn: HTMLElement): () => void {
    const onClick = (e: Event) => {
      e.stopPropagation();
      this.open();
    };
    btn.addEventListener('click', onClick);
    const off = () => btn.removeEventListener('click', onClick);
    this.cleanups.push(off);
    return off;
  }

  bindCloseButton(btn: HTMLElement): () => void {
    const onClick = (e: Event) => {
      e.stopPropagation();
      this.close();
    };
    btn.addEventListener('click', onClick);
    const off = () => btn.removeEventListener('click', onClick);
    this.cleanups.push(off);
    return off;
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (!this.isWaveEnabled()) {
      if (this.openState) this.close();
      return;
    }

    if (this.openState) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.close();
        return;
      }
      if (
        (e.key === 'm' || e.key === 'M') &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !isTypingTarget(e)
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.close();
        return;
      }
      if (!isTypingTarget(e) && SUSPENDED_3D_KEYS.has(e.key)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
      return;
    }

    if (
      (e.key === 'm' || e.key === 'M') &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      !isTypingTarget(e)
    ) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.open();
    }
  }

  dispose(): void {
    if (this.openState) {
      const cam = this.getRtsCamera?.();
      if (cam) cam.enabled = true;
      this.openState = false;
    }
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('keydown', this.onKeyDownBound, true);
    }
    for (const fn of this.cleanups) fn();
    this.cleanups.length = 0;
  }
}
