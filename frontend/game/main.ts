import { initCrt } from '@terra/render/ui/crt';
import { onlineMode, type OnlineMode } from './app/online/onlineMode';

const app = document.getElementById('app')!;
let activeDispose: (() => void) | null = null;

function mountFromCurrentUrl(): void {
  activeDispose?.();
  const mode = onlineMode(location.search);
  activeDispose = mode ? startOnline(app, mode) : startPrototype(app);
}

mountFromCurrentUrl();
initCrt([app]); // old-TV look over the 3D picture only; menus/HUD layers sit above #app
if (import.meta.env.DEV || location.search.includes('devworld')) {
  void import('./store/devHook').then((m) => m.installWorldDevHook());
}
if (import.meta.hot) {
  import.meta.hot.dispose(() => activeDispose?.());
}

function startOnline(el: HTMLElement, m: OnlineMode): () => void {
  let session: { dispose(): void } | null = null;
  void import('./app/online/OnlineSession').then(({ OnlineSession }) => {
    const s = new OnlineSession(el, m, {
      onReturnToOrbit: (kind) => {
        history.replaceState(null, '', `${location.pathname}?planet=${kind}`);
        mountFromCurrentUrl();
      },
    });
    session = s;
    (window as unknown as { __online?: unknown; __game?: unknown }).__online = s;
    (window as unknown as { __online?: unknown; __game?: unknown }).__game = s;
  });
  return () => session?.dispose();
}

function startPrototype(el: HTMLElement): () => void {
  let game: { dispose(): void } | null = null;
  void import('./app/Game').then(({ Game }) => {
    const g = new Game(el);
    game = g;
    (window as unknown as { __game?: unknown }).__game = g;
  });
  return () => game?.dispose();
}
