import { $ } from './dom';
import type { ToggleKey, View } from './state';

export interface KeyHandlers { cycle(d: number): void; view(v: View): void; toggle(k: ToggleKey): void; focus(): void; }

const KEY_TOGGLE: Record<string, ToggleKey> = { t: 'turntable', g: 'grid', w: 'wire', b: 'bloom', p: 'pixel', r: 'row', h: 'human', v: 'validate' };
const KEY_VIEW: Record<string, View> = { 1: 'iso', 2: 'front', 3: 'side', 4: 'top' };

export function bindKeys(on: KeyHandlers) {
  window.addEventListener('keydown', (e) => {
    const typing = (e.target as HTMLElement)?.tagName === 'INPUT';
    if (e.key === 'Escape' && typing) { (e.target as HTMLElement).blur(); return; }
    if (e.key === '/' && !typing) { e.preventDefault(); $('#search').focus(); return; }
    if (typing || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    const k = e.key.toLowerCase();
    if (k === ']' || k === 'arrowright') on.cycle(1);
    else if (k === '[' || k === 'arrowleft') on.cycle(-1);
    else if (k === 'f') on.focus();
    else if (KEY_VIEW[k]) on.view(KEY_VIEW[k]);
    else if (KEY_TOGGLE[k]) on.toggle(KEY_TOGGLE[k]);
  });
}
