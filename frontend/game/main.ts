import { initCrt } from '@terra/render/ui/crt';
import { onlineMode } from './app/online/onlineMode';

const app = document.getElementById('app')!;
const mode = onlineMode(location.search);
// `?scenario=` / `?host=` run the online flow (no prototype menu, descent or decorative colony); otherwise the prototype game.
const dispose = mode ? startOnline(app, mode) : startPrototype(app);
initCrt([app]); // old-TV look over the 3D picture only; menus/HUD layers sit above #app
if (import.meta.env.DEV || location.search.includes('devworld')) void import('./store/devHook').then((m) => m.installWorldDevHook());
if (import.meta.hot) import.meta.hot.dispose(() => dispose());

function startOnline(el: HTMLElement, m: NonNullable<typeof mode>): () => void {
  let session: { dispose(): void } | null = null;
  void import('./app/online/OnlineSession').then(({ OnlineSession }) => { const s = new OnlineSession(el, m); session = s; (window as any).__online = s; });
  return () => session?.dispose();
}

function startPrototype(el: HTMLElement): () => void {
  let game: { dispose(): void } | null = null;
  void import('./app/Game').then(({ Game }) => { const g = new Game(el); game = g; (window as any).__game = g; });
  return () => game?.dispose();
}
