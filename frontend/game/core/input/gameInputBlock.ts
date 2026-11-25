/**
 * One switch for "a modal owns the input": while any source (the open global map, the pause dialog) holds a block,
 * game hotkeys and right-click cancels underneath stay quiet. Every hotkey that goes through `isHotkeyPress`
 * (`features/shared/hotkeys.ts`) honours it; handlers that read keys themselves (Command Dock, the placement ghost's
 * context menu, the terraform brush) check `isGameInputBlocked()`. The modal's own keys (map M / Esc / pan, pause Esc)
 * and the dev console (backtick, typing in its input) never check it.
 */

const blockers = new Set<string>();
const listeners = new Set<() => void>();

function notifyChange(): void {
  for (const fn of [...listeners]) fn();
}

/** Turns the block of `source` on or off (idempotent; sources are independent). */
export function setGameInputBlocked(source: string, blocked: boolean): void {
  const had = blockers.has(source);
  if (blocked === had) return;
  if (blocked) blockers.add(source);
  else blockers.delete(source);
  notifyChange();
}

/** Subscribes to changes in the active game-input block set. */
export function onGameInputBlockChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Some modal holds the input; `except` ignores that one source (a modal asking whether *another* one is up). */
export function isGameInputBlocked(except?: string): boolean {
  if (blockers.size === 0) return false;
  if (except === undefined) return true;
  for (const s of blockers) if (s !== except) return true;
  return false;
}

/** Sources currently blocking (debug / tests). */
export function gameInputBlockers(): string[] {
  return [...blockers];
}

/** Test helper: drops every block. */
export function resetGameInputBlock(): void {
  if (blockers.size === 0) return;
  blockers.clear();
  notifyChange();
}
