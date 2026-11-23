import { bootProductAnalytics } from '../design/analytics/boot';
import { noteBootFailure } from '../design/analytics/play';
import { initCrt } from '@terra/render/ui/crt';
import { lazyStart } from './app/lazyStart';
import { onlineMode, type OnlineMode } from './app/online/onlineMode';
import { isProductionBuild } from './core/buildEnv';

bootProductAnalytics('play');

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
    try {
      const s = new OnlineSession(el, m, {
        onReturnToOrbit: (kind) => {
          history.replaceState(null, '', `${location.pathname}?planet=${kind}`);
          mountFromCurrentUrl();
        },
      });
      (window as unknown as { __online?: unknown; __game?: unknown }).__online = s;
      (window as unknown as { __online?: unknown; __game?: unknown }).__game = s;
      return s;
    } catch (err) {
      noteBootFailure(err instanceof Error ? err.message : 'boot');
      throw err;
    }
  });
}

function startPrototype(el: HTMLElement): () => void {
  return lazyStart(() => import('./app/Game'), ({ Game }) => {
    try {
      const g = new Game(el);
      (window as unknown as { __game?: unknown }).__game = g;
      return g;
    } catch (err) {
      noteBootFailure(err instanceof Error ? err.message : 'boot');
      throw err;
    }
  });
}
