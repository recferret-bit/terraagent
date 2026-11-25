import type { MouseCursorState } from './MouseCursorStateMachine';

export interface CursorPalette {
  readonly voidBg: string;
  readonly hull: string;
  readonly orange: string;
  readonly terra: string;
  readonly energy: string;
  readonly fault: string;
}

export const FALLBACK_CURSOR_PALETTE: CursorPalette = {
  voidBg: '#07080A',
  hull: '#F2F4F7',
  orange: '#FF6A13',
  terra: '#3DDC84',
  energy: '#39D0FF',
  fault: '#FF3B3B',
};

function readCssToken(style: CSSStyleDeclaration | null, name: string, fallback: string): string {
  const raw = style?.getPropertyValue(name)?.trim();
  return raw && raw.length > 0 ? raw : fallback;
}

export function resolveCursorPalette(doc: Document | undefined = typeof document !== 'undefined' ? document : undefined): CursorPalette {
  if (!doc?.documentElement || typeof getComputedStyle !== 'function') return FALLBACK_CURSOR_PALETTE;
  const st = getComputedStyle(doc.documentElement);
  return {
    voidBg: readCssToken(st, '--ta-void', FALLBACK_CURSOR_PALETTE.voidBg),
    hull: readCssToken(st, '--ta-hull', FALLBACK_CURSOR_PALETTE.hull),
    orange: readCssToken(st, '--ta-orange', FALLBACK_CURSOR_PALETTE.orange),
    terra: readCssToken(st, '--ta-terra', FALLBACK_CURSOR_PALETTE.terra),
    energy: readCssToken(st, '--ta-energy', FALLBACK_CURSOR_PALETTE.energy),
    fault: readCssToken(st, '--ta-fault', FALLBACK_CURSOR_PALETTE.fault),
  };
}

function encodeSvgCursor(svg: string, hotX: number, hotY: number, fallback: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hotX} ${hotY}, ${fallback}`;
}

export function buildCursorCssValue(state: MouseCursorState, p: CursorPalette = FALLBACK_CURSOR_PALETTE): string {
  switch (state) {
    case 'idle': {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path d="M4 3L25 13L15.5 16.2L12.2 25.5Z" fill="${p.hull}" stroke="${p.voidBg}" stroke-width="2.4" stroke-linejoin="miter"/><path d="M6.8 6.5L14.8 14.5" stroke="${p.orange}" stroke-width="2" stroke-linecap="square"/></svg>`;
      return encodeSvgCursor(svg, 4, 3, 'default');
    }
    case 'select': {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><g fill="none" stroke="${p.voidBg}" stroke-width="4.4" stroke-linecap="square"><path d="M5 11V5H11M21 5H27V11M27 21V27H21M11 27H5V21"/></g><g fill="none" stroke="${p.orange}" stroke-width="2.2" stroke-linecap="square"><path d="M5 11V5H11M21 5H27V11M27 21V27H21M11 27H5V21"/></g><rect x="14" y="14" width="4" height="4" fill="${p.hull}" stroke="${p.voidBg}" stroke-width="1.2"/></svg>`;
      return encodeSvgCursor(svg, 16, 16, 'pointer');
    }
    case 'move': {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><g fill="none" stroke="${p.voidBg}" stroke-width="4.2" stroke-linecap="square"><path d="M16 3L20.5 8.5H11.5ZM16 29L20.5 23.5H11.5ZM3 16L8.5 11.5V20.5ZM29 16L23.5 11.5V20.5Z"/></g><g fill="${p.terra}" stroke="${p.voidBg}" stroke-width="1.1"><path d="M16 3L20.5 8.5H11.5ZM16 29L20.5 23.5H11.5ZM3 16L8.5 11.5V20.5ZM29 16L23.5 11.5V20.5Z"/></g><polygon points="16,11.5 20.5,16 16,20.5 11.5,16" fill="${p.voidBg}" stroke="${p.terra}" stroke-width="2"/><rect x="15" y="15" width="2" height="2" fill="${p.hull}"/></svg>`;
      return encodeSvgCursor(svg, 16, 16, 'crosshair');
    }
    case 'attack': {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><polygon points="16,4 28,16 16,28 4,16" fill="none" stroke="${p.voidBg}" stroke-width="4.4"/><polygon points="16,4 28,16 16,28 4,16" fill="none" stroke="${p.fault}" stroke-width="2.2"/><g stroke="${p.voidBg}" stroke-width="3.8"><path d="M16 1V8.5M16 23.5V31M1 16H8.5M23.5 16H31"/></g><g stroke="${p.fault}" stroke-width="2"><path d="M16 1V8.5M16 23.5V31M1 16H8.5M23.5 16H31"/></g><rect x="14" y="14" width="4" height="4" fill="${p.orange}" stroke="${p.voidBg}" stroke-width="1"/></svg>`;
      return encodeSvgCursor(svg, 16, 16, 'crosshair');
    }
    case 'prohibited': {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><polygon points="11,3 21,3 29,11 29,21 21,29 11,29 3,21 3,11" fill="${p.voidBg}" fill-opacity="0.55" stroke="${p.voidBg}" stroke-width="4.6"/><line x1="8.5" y1="8.5" x2="23.5" y2="23.5" stroke="${p.voidBg}" stroke-width="5.2" stroke-linecap="square"/><polygon points="11,3 21,3 29,11 29,21 21,29 11,29 3,21 3,11" fill="none" stroke="${p.fault}" stroke-width="2.6"/><polygon points="12,5.4 20,5.4 26.6,12 26.6,20 20,26.6 12,26.6 5.4,20 5.4,12" fill="none" stroke="${p.hull}" stroke-opacity="0.55" stroke-width="0.9"/><line x1="8.8" y1="8.8" x2="23.2" y2="23.2" stroke="${p.fault}" stroke-width="2.8" stroke-linecap="square"/></svg>`;
      return encodeSvgCursor(svg, 16, 16, 'not-allowed');
    }
  }
}

export class SurfaceCursorApplier {
  private cssByState: Record<MouseCursorState, string>;
  private hasTokenStyles: boolean;
  private readonly prevCursor: string;
  private readonly prevDataset: string | undefined;

  constructor(private readonly surface: HTMLElement | null) {
    this.hasTokenStyles = this.checkTokenLoaded();
    this.cssByState = this.compileTable();
    this.prevCursor = surface?.style.cursor ?? '';
    this.prevDataset = surface?.dataset.cursorState;
  }

  private checkTokenLoaded(): boolean {
    const doc = this.surface?.ownerDocument;
    if (!doc?.documentElement || typeof getComputedStyle !== 'function') return false;
    return getComputedStyle(doc.documentElement).getPropertyValue('--ta-orange').trim().length > 0;
  }

  private compileTable(): Record<MouseCursorState, string> {
    const palette = resolveCursorPalette(this.surface?.ownerDocument);
    return {
      idle: buildCursorCssValue('idle', palette),
      select: buildCursorCssValue('select', palette),
      move: buildCursorCssValue('move', palette),
      attack: buildCursorCssValue('attack', palette),
      prohibited: buildCursorCssValue('prohibited', palette),
    };
  }

  apply(state: MouseCursorState): void {
    if (!this.surface) return;
    if (!this.hasTokenStyles && this.checkTokenLoaded()) {
      this.hasTokenStyles = true;
      this.cssByState = this.compileTable();
    }
    const nextCss = this.cssByState[state];
    if (this.surface.dataset.cursorState !== state) {
      this.surface.dataset.cursorState = state;
    }
    if (this.surface.style.cursor !== nextCss) {
      this.surface.style.cursor = nextCss;
    }
  }

  dispose(): void {
    if (!this.surface) return;
    this.surface.style.cursor = this.prevCursor;
    if (this.prevDataset === undefined) delete this.surface.dataset.cursorState;
    else this.surface.dataset.cursorState = this.prevDataset;
  }
}
