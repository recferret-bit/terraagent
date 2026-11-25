import type { MouseCursorState } from './MouseCursorStateMachine';

export interface CursorPalette {
  readonly voidBg: string;
  readonly hull: string;
  readonly orange: string;
  readonly energy: string;
  readonly fault: string;
}

const FALLBACK_PALETTE: CursorPalette = {
  voidBg: '#07080A',
  hull: '#F2F4F7',
  orange: '#FF6A13',
  energy: '#39D0FF',
  fault: '#FF3B3B',
};

function readCssToken(style: CSSStyleDeclaration | null, name: string, fallback: string): string {
  const raw = style?.getPropertyValue(name)?.trim();
  return raw && raw.length > 0 ? raw : fallback;
}

export function resolveCursorPalette(doc: Document | undefined = typeof document !== 'undefined' ? document : undefined): CursorPalette {
  if (!doc?.documentElement || typeof getComputedStyle !== 'function') return FALLBACK_PALETTE;
  const st = getComputedStyle(doc.documentElement);
  return {
    voidBg: readCssToken(st, '--ta-void', FALLBACK_PALETTE.voidBg),
    hull: readCssToken(st, '--ta-hull', FALLBACK_PALETTE.hull),
    orange: readCssToken(st, '--ta-orange', FALLBACK_PALETTE.orange),
    energy: readCssToken(st, '--ta-energy', FALLBACK_PALETTE.energy),
    fault: readCssToken(st, '--ta-fault', FALLBACK_PALETTE.fault),
  };
}

function encodeSvgCursor(svg: string, hotX: number, hotY: number, fallback: string): string {
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hotX} ${hotY}, ${fallback}`;
}

export function buildCursorCssValue(state: MouseCursorState, p: CursorPalette = FALLBACK_PALETTE): string {
  switch (state) {
    case 'idle': {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path d="M4 3L24 13L15 16L12 25Z" fill="${p.voidBg}" stroke="${p.hull}" stroke-width="1.8" stroke-linejoin="miter"/><path d="M7 7L14 14" stroke="${p.energy}" stroke-width="1.6"/></svg>`;
      return encodeSvgCursor(svg, 4, 3, 'default');
    }
    case 'select': {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><g fill="none" stroke="${p.voidBg}" stroke-width="4" stroke-linecap="square"><path d="M5 11V5H11M21 5H27V11M27 21V27H21M11 27H5V21"/></g><g fill="none" stroke="${p.orange}" stroke-width="2" stroke-linecap="square"><path d="M5 11V5H11M21 5H27V11M27 21V27H21M11 27H5V21"/></g><rect x="14.5" y="14.5" width="3" height="3" fill="${p.hull}" stroke="${p.voidBg}" stroke-width="1"/></svg>`;
      return encodeSvgCursor(svg, 16, 16, 'pointer');
    }
    case 'move': {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><g fill="none" stroke="${p.voidBg}" stroke-width="3.8" stroke-linecap="square"><path d="M16 4L20 9H12ZM16 28L20 23H12ZM4 16L9 12V20ZM28 16L23 12V20Z"/></g><g fill="${p.energy}" stroke="${p.voidBg}" stroke-width="1"><path d="M16 4L20 9H12ZM16 28L20 23H12ZM4 16L9 12V20ZM28 16L23 12V20Z"/></g><polygon points="16,12 20,16 16,20 12,16" fill="${p.voidBg}" stroke="${p.energy}" stroke-width="1.6"/></svg>`;
      return encodeSvgCursor(svg, 16, 16, 'crosshair');
    }
    case 'attack': {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><polygon points="16,4 28,16 16,28 4,16" fill="none" stroke="${p.voidBg}" stroke-width="4"/><polygon points="16,4 28,16 16,28 4,16" fill="none" stroke="${p.fault}" stroke-width="2"/><g stroke="${p.voidBg}" stroke-width="3.4"><path d="M16 1V8M16 24V31M1 16H8M24 16H31"/></g><g stroke="${p.fault}" stroke-width="1.8"><path d="M16 1V8M16 24V31M1 16H8M24 16H31"/></g><rect x="14.5" y="14.5" width="3" height="3" fill="${p.orange}"/></svg>`;
      return encodeSvgCursor(svg, 16, 16, 'crosshair');
    }
  }
}

export class SurfaceCursorApplier {
  private readonly cssByState: Record<MouseCursorState, string>;
  private readonly prevCursor: string;
  private readonly prevDataset: string | undefined;

  constructor(private readonly surface: HTMLElement | null) {
    const palette = resolveCursorPalette(surface?.ownerDocument);
    this.cssByState = {
      idle: buildCursorCssValue('idle', palette),
      select: buildCursorCssValue('select', palette),
      move: buildCursorCssValue('move', palette),
      attack: buildCursorCssValue('attack', palette),
    };
    this.prevCursor = surface?.style.cursor ?? '';
    this.prevDataset = surface?.dataset.cursorState;
  }

  apply(state: MouseCursorState): void {
    if (!this.surface) return;
    this.surface.dataset.cursorState = state;
    this.surface.style.cursor = this.cssByState[state];
  }

  dispose(): void {
    if (!this.surface) return;
    this.surface.style.cursor = this.prevCursor;
    if (this.prevDataset === undefined) delete this.surface.dataset.cursorState;
    else this.surface.dataset.cursorState = this.prevDataset;
  }
}
