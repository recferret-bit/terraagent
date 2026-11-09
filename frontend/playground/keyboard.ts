import { $ } from './dom';
import type { ToggleKey, View } from './state';

export interface KeyHandlers {
  cycle(d: number): void;
  view(v: View): void;
  toggle(k: ToggleKey): void;
  focus(): void;
  /** `/` focuses archetype search. Called first so a hidden object list can open. */
  revealSearch?(): void;
}

const KEY_TOGGLE: Record<string, ToggleKey> = { t: 'turntable', b: 'bloom', p: 'pixel', r: 'row', h: 'human', v: 'validate', l: 'lights' };
const KEY_VIEW: Record<string, View> = { 1: 'iso', 2: 'front', 3: 'side', 4: 'top' };

export const flyKeys = { w: false, a: false, s: false, d: false, q: false, e: false };
export type FlyState = typeof flyKeys;

function isTypingElement(el: EventTarget | null): boolean {
  const tag = (el as HTMLElement | null)?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function isFlyKey(k: string): k is keyof FlyState {
  return Object.hasOwn(flyKeys, k);
}

function clearFlyKeys() {
  flyKeys.w = flyKeys.a = flyKeys.s = flyKeys.d = flyKeys.q = flyKeys.e = false;
}

function trackFly(e: KeyboardEvent, down: boolean): boolean {
  const k = e.key.toLowerCase();
  if (!isFlyKey(k)) return false;
  if (!down) { flyKeys[k] = false; return true; }
  if (isTypingElement(e.target) || e.ctrlKey || e.metaKey || e.altKey) return false;
  flyKeys[k] = true;
  return true;
}

export function bindKeys(on: KeyHandlers) {
  window.addEventListener('keydown', (e) => {
    const typing = isTypingElement(e.target);
    if (e.key === 'Escape' && typing) { (e.target as HTMLElement).blur(); return; }
    if (e.key === '/' && !typing) { e.preventDefault(); on.revealSearch?.(); $('#search')?.focus(); return; }
    if (trackFly(e, true)) { e.preventDefault(); return; }
    if (typing || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    const k = e.key.toLowerCase();
    if (k === ']' || k === 'arrowright') on.cycle(1);
    else if (k === '[' || k === 'arrowleft') on.cycle(-1);
    else if (k === 'f') on.focus();
    else if (KEY_VIEW[k]) on.view(KEY_VIEW[k]);
    else if (KEY_TOGGLE[k]) on.toggle(KEY_TOGGLE[k]);
  });
  window.addEventListener('keyup', (e) => { trackFly(e, false); });
  window.addEventListener('blur', clearFlyKeys);
  window.addEventListener('focusin', (e) => { if (isTypingElement(e.target)) clearFlyKeys(); });
}
