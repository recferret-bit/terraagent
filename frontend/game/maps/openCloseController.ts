import { isTypingTarget } from '../features/shared/hotkeys';

export interface RtsCameraEnableTarget {
  enabled: boolean;
}

export type MapNavAction =
  | { readonly kind: 'pan'; readonly dx: number; readonly dy: number; readonly fast: boolean }
  | { readonly kind: 'zoom'; readonly factor: number }
  | { readonly kind: 'reset' };

/** Map-navigation key → action (while the global map is open; WASD/arrows pan, Q/E or +/- zoom, 0/Home reset). */
export function navActionForKey(e: Pick<KeyboardEvent, 'key' | 'shiftKey'>): MapNavAction | null {
  const fast = e.shiftKey;
  switch (e.key) {
    case 'w': case 'W': case 'ArrowUp': return { kind: 'pan', dx: 0, dy: 1, fast };
    case 's': case 'S': case 'ArrowDown': return { kind: 'pan', dx: 0, dy: -1, fast };
    case 'a': case 'A': case 'ArrowLeft': return { kind: 'pan', dx: 1, dy: 0, fast };
    case 'd': case 'D': case 'ArrowRight': return { kind: 'pan', dx: -1, dy: 0, fast };
    case 'e': case 'E': case '+': case '=': return { kind: 'zoom', factor: 1.25 };
    case 'q': case 'Q': case '-': case '_': return { kind: 'zoom', factor: 0.8 };
    case '0': case 'Home': return { kind: 'reset' };
    default: return null;
  }
}

export interface GlobalMapOpenCloseOptions {
  readonly onNavigate?: (action: MapNavAction) => void;
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
  private readonly onNavigate?: (action: MapNavAction) => void;
  private readonly onKeyDownBound: (e: KeyboardEvent) => void;
  private readonly cleanups: Array<() => void> = [];

  constructor(opts: GlobalMapOpenCloseOptions = {}) {
    this.isWaveEnabled = opts.isWaveEnabled ?? (() => true);
    this.getRtsCamera = opts.getRtsCamera;
    this.onStateChange = opts.onStateChange;
    this.onNavigate = opts.onNavigate;

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
      if (!isTypingTarget(e) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const action = navActionForKey(e);
        if (action) {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.onNavigate?.(action);
          return;
        }
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
