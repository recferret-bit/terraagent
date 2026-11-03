import { isGameInputBlocked, setGameInputBlocked } from '../core/input/gameInputBlock';
import { isTypingTarget } from '../features/shared/hotkeys';

/** Input-block source of the open global map (`core/input/gameInputBlock.ts`). */
export const GLOBAL_MAP_INPUT_SOURCE = 'global-map';

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
  /** Feeds the shared modal input block (default: the `core/input` singleton under `GLOBAL_MAP_INPUT_SOURCE`). */
  readonly setInputBlocked?: (blocked: boolean) => void;
  /** Another modal (pause) owns the input: the map does not open (default: any other block source is on). */
  readonly isOpenBlocked?: () => boolean;
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
  private readonly setInputBlocked: (blocked: boolean) => void;
  private readonly isOpenBlocked: () => boolean;
  /** `enabled` of the RTS camera before the map opened (a paused or scripted camera stays off after close). */
  private camEnabledBeforeOpen: boolean | null = null;
  private readonly onKeyDownBound: (e: KeyboardEvent) => void;
  private readonly cleanups: Array<() => void> = [];

  constructor(opts: GlobalMapOpenCloseOptions = {}) {
    this.isWaveEnabled = opts.isWaveEnabled ?? (() => true);
    this.getRtsCamera = opts.getRtsCamera;
    this.onStateChange = opts.onStateChange;
    this.onNavigate = opts.onNavigate;
    this.setInputBlocked = opts.setInputBlocked ?? ((b) => setGameInputBlocked(GLOBAL_MAP_INPUT_SOURCE, b));
    this.isOpenBlocked = opts.isOpenBlocked ?? (() => isGameInputBlocked(GLOBAL_MAP_INPUT_SOURCE));

    this.onKeyDownBound = (e: KeyboardEvent) => this.handleKeyDown(e);
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('keydown', this.onKeyDownBound, true);
    }
  }

  get isOpen(): boolean {
    return this.openState;
  }

  open(): void {
    if (!this.isWaveEnabled() || this.openState || this.isOpenBlocked()) return;
    this.openState = true;
    const cam = this.getRtsCamera?.();
    this.camEnabledBeforeOpen = cam ? cam.enabled : null;
    if (cam) cam.enabled = false;
    this.setInputBlocked(true);
    this.onStateChange?.(true);
  }

  close(): void {
    if (!this.openState) return;
    this.release();
    this.onStateChange?.(false);
  }

  /** Leaves the open state: restores the camera's previous `enabled` and lifts the input block. */
  private release(): void {
    this.openState = false;
    const cam = this.getRtsCamera?.();
    if (cam && this.camEnabledBeforeOpen !== null) cam.enabled = this.camEnabledBeforeOpen;
    this.camEnabledBeforeOpen = null;
    this.setInputBlocked(false);
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
      if (e.key === 'Escape' && !isTypingTarget(e)) { // Esc typed in the dev console closes the console, not the map
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
    if (this.openState) this.release();
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('keydown', this.onKeyDownBound, true);
    }
    for (const fn of this.cleanups) fn();
    this.cleanups.length = 0;
  }
}
