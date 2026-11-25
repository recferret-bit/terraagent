export type MouseCursorState = 'idle' | 'select' | 'move' | 'attack';

export type MouseCursorHoverTarget =
  | 'none'
  | 'hostile'
  | 'ownSelectable'
  | 'ownSelectedSelf'
  | 'deposit'
  | 'passableGround'
  | 'impassableGround';

export interface MouseCursorContext {
  readonly pointerInside: boolean;
  readonly inputBlocked: boolean;
  readonly cameraDragging?: boolean;
  readonly spectator: boolean;
  readonly attackMoveArmed: boolean;
  readonly hasSelectedMovableUnit: boolean;
  readonly hasSelectedArmedUnit: boolean;
  readonly shiftKey: boolean;
  readonly hoverTarget: MouseCursorHoverTarget;
}

export type MouseCursorListener = (state: MouseCursorState, prev: MouseCursorState, ctx: MouseCursorContext) => void;

export const DEFAULT_MOUSE_CURSOR_CONTEXT: MouseCursorContext = {
  pointerInside: false,
  inputBlocked: false,
  cameraDragging: false,
  spectator: false,
  attackMoveArmed: false,
  hasSelectedMovableUnit: false,
  hasSelectedArmedUnit: false,
  shiftKey: false,
  hoverTarget: 'none',
};

/**
 * Pure deterministic transition function mapping the current pointer/selection context
 * onto one of the 4 gameplay mouse cursor states: `idle`, `select`, `move`, or `attack`.
 */
export function resolveMouseCursorState(ctx: MouseCursorContext): MouseCursorState {
  if (!ctx.pointerInside || ctx.inputBlocked || ctx.cameraDragging || ctx.hoverTarget === 'none') {
    return 'idle';
  }

  if (ctx.spectator) {
    return ctx.hoverTarget === 'ownSelectable' ? 'select' : 'idle';
  }

  if (ctx.attackMoveArmed && ctx.hasSelectedArmedUnit) {
    return 'attack';
  }

  if (ctx.hoverTarget === 'hostile' && ctx.hasSelectedArmedUnit) {
    return 'attack';
  }

  if (ctx.hoverTarget === 'ownSelectable') {
    return 'select';
  }

  if (ctx.hoverTarget === 'ownSelectedSelf') {
    return ctx.shiftKey && ctx.hasSelectedArmedUnit ? 'select' : 'idle';
  }

  if (ctx.hoverTarget === 'deposit') {
    return ctx.hasSelectedMovableUnit ? 'move' : 'select';
  }

  if (ctx.hoverTarget === 'passableGround' && ctx.hasSelectedMovableUnit) {
    return 'move';
  }

  return 'idle';
}

/**
 * Explicit state machine managing gameplay mouse cursor state (`idle | select | move | attack`)
 * and notifying subscribers only when the resolved state transitions.
 */
export class MouseCursorStateMachine {
  private ctx: MouseCursorContext = { ...DEFAULT_MOUSE_CURSOR_CONTEXT };
  private state: MouseCursorState = 'idle';
  private readonly listeners = new Set<MouseCursorListener>();

  getState(): MouseCursorState {
    return this.state;
  }

  getContext(): MouseCursorContext {
    return { ...this.ctx };
  }

  transition(patch: Partial<MouseCursorContext>): MouseCursorState {
    this.ctx = { ...this.ctx, ...patch };
    const next = resolveMouseCursorState(this.ctx);
    if (next !== this.state) {
      const prev = this.state;
      this.state = next;
      const snap = { ...this.ctx };
      for (const fn of this.listeners) fn(next, prev, snap);
    }
    return this.state;
  }

  reset(): MouseCursorState {
    return this.transition(DEFAULT_MOUSE_CURSOR_CONTEXT);
  }

  onChange(fn: MouseCursorListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  dispose(): void {
    this.listeners.clear();
  }
}
