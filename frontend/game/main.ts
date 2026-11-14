import { initCrt } from '@terra/render/ui/crt';
import { lazyStart } from './app/lazyStart';
import { onlineMode, type OnlineMode } from './app/online/onlineMode';
import { isProductionBuild } from './core/buildEnv';

const app = document.getElementById('app')!;
let activeDispose: (() => void) | null = null;

function mountFromCurrentUrl(): void {
  activeDispose?.();
  const mode = onlineMode(location.search);
  activeDispose = mode ? startOnline(app, mode) : startPrototype(app);
}

mountFromCurrentUrl();
initCrt([app]); // old-TV look over the 3D picture only; menus/HUD layers sit above #app
if (!isProductionBuild() && (import.meta.env.DEV || location.search.includes('devworld'))) {
  void import('./store/devHook').then((m) => m.installWorldDevHook());
}
if (import.meta.hot) {
  import.meta.hot.dispose(() => activeDispose?.());
}

function startOnline(el: HTMLElement, m: OnlineMode): () => void {
  return lazyStart(() => import('./app/online/OnlineSession'), ({ OnlineSession }) => {
    const s = new OnlineSession(el, m, {
      onReturnToOrbit: (kind) => {
        history.replaceState(null, '', `${location.pathname}?planet=${kind}`);
        mountFromCurrentUrl();
      },
    });
    (window as unknown as { __online?: unknown; __game?: unknown }).__online = s;
    (window as unknown as { __online?: unknown; __game?: unknown }).__game = s;
    return s;
  });
}

function startPrototype(el: HTMLElement): () => void {
  return lazyStart(() => import('./app/Game'), ({ Game }) => {
    const g = new Game(el);
    (window as unknown as { __game?: unknown }).__game = g;
    return g;
  });
}
