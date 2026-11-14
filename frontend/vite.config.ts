import { defineConfig, type Plugin } from 'vite';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

const frontend = import.meta.dirname;
const root = resolve(frontend, '..');

// Same precedence as @terra/config: real env > .env.worktree > .env. The app listens on TA_PORT_BASE + 1 (default 4001).
const fileEnv = (name: string) => {
  const infraFile = resolve(root, 'infra', name);
  if (existsSync(infraFile)) return parseEnv(readFileSync(infraFile, 'utf8'));
  const rootFile = resolve(root, name);
  return existsSync(rootFile) ? parseEnv(readFileSync(rootFile, 'utf8')) : {};
};
const env = { ...fileEnv('.env'), ...fileEnv('.env.worktree'), ...process.env };
const appPort = Number(env.PORT ?? Number(env.TA_PORT_BASE ?? 4000) + 1);
const app = `http://127.0.0.1:${appPort}`;
const envDir = existsSync(resolve(root, 'infra/.env')) ? resolve(root, 'infra') : root;
const explicitAppEnv = typeof env.VITE_APP_ENV === 'string' && env.VITE_APP_ENV.trim().length > 0
  ? env.VITE_APP_ENV.trim()
  : undefined;

function splitUrl(raw: string): { path: string; search: string } {
  const qAt = raw.indexOf('?');
  return qAt === -1 ? { path: raw, search: '' } : { path: raw.slice(0, qAt), search: raw.slice(qAt) };
}

/** `/dev/chain/tx` and `/dev/chain/tx/*` serve the receipt page. Leaves `/v1` for the app proxy. */
function rewriteChainTx(req: { url?: string }): void {
  const { path, search } = splitUrl(req.url ?? '');
  if (path !== '/dev/chain/tx' && !path.startsWith('/dev/chain/tx/')) return;
  req.url = `/dev/chain/tx.html${search}`;
}

/**
 * `/dev/mock-oauth` (no slash) is the mock login page. Without this, Vite's SPA fallback serves the hub,
 * so the Save progress popup has no `#mo-preset`.
 */
function rewriteMockOauth(req: { url?: string }): void {
  const { path, search } = splitUrl(req.url ?? '');
  if (path !== '/dev/mock-oauth') return;
  req.url = `/dev/mock-oauth/index.html${search}`;
}

/** `/me` and `/me/` serve `me.html` (`OWNER_TASKS.md` N2). */
function rewriteMePage(req: { url?: string }): void {
  const { path, search } = splitUrl(req.url ?? '');
  if (path !== '/me' && path !== '/me/') return;
  req.url = `/me.html${search}`;
}

/** `/deed` and `/deed/*` serve `deed.html` (W20-12 public share page). */
function rewriteDeedPage(req: { url?: string }): void {
  const { path, search } = splitUrl(req.url ?? '');
  if (path !== '/deed' && !path.startsWith('/deed/')) return;
  req.url = `/deed.html${search}`;
}

/** `/dev/economy-sim` (no slash) serves `/dev/economy-sim/index.html`. */
function rewriteEconomySim(req: { url?: string }): void {
  const { path, search } = splitUrl(req.url ?? '');
  if (path !== '/dev/economy-sim') return;
  req.url = `/dev/economy-sim/index.html${search}`;
}

const chainTxPage: Plugin = {
  name: 'chain-tx-page',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      rewriteChainTx(req);
      rewriteMockOauth(req);
      rewriteMePage(req);
      rewriteDeedPage(req);
      rewriteEconomySim(req);
      next();
    });
  },
  configurePreviewServer(server) {
    server.middlewares.use((req, _res, next) => {
      rewriteChainTx(req);
      rewriteMockOauth(req);
      rewriteMePage(req);
      rewriteDeedPage(req);
      rewriteEconomySim(req);
      next();
    });
  },
};

// One Vite app rooted at frontend/. URLs mirror the file layout: /play.html, /landing.html, /playground.html, /design/.
// `@terra/*` (render, sim, contracts, …) resolve as npm workspace packages; there are no path aliases.
export default defineConfig({
  plugins: [chainTxPage],
  root: frontend,
  envDir,
  ...(explicitAppEnv
    ? { define: { 'import.meta.env.VITE_APP_ENV': JSON.stringify(explicitAppEnv) } }
    : {}),
  // The client uses same-origin /v1 (REST) and /ws (WebSocket); in dev and local preview they are proxied to the app.
  server: { proxy: { '/v1': app, '/ws': { target: app, ws: true } } },
  preview: { proxy: { '/v1': app, '/ws': { target: app, ws: true } } },
  build: {
    outDir: resolve(frontend, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(frontend, 'index.html'),
        landing: resolve(frontend, 'landing.html'),
        play: resolve(frontend, 'play.html'),
        me: resolve(frontend, 'me.html'),
        deed: resolve(frontend, 'deed.html'),
        trade: resolve(frontend, 'trade.html'),
        playground: resolve(frontend, 'playground.html'),
        devChain: resolve(frontend, 'dev/chain/index.html'),
        devChainTx: resolve(frontend, 'dev/chain/tx.html'),
        devEconomySim: resolve(frontend, 'dev/economy-sim/index.html'),
        devMockOauth: resolve(frontend, 'dev/mock-oauth/index.html'),
        devParity: resolve(frontend, 'dev/parity/index.html'),
        design: resolve(frontend, 'design/index.html'),
        designFoundations: resolve(frontend, 'design/foundations.html'),
        designStorybook: resolve(frontend, 'design/storybook.html'),
        designMotion: resolve(frontend, 'design/motion.html'),
        pitchdeck: resolve(frontend, 'pitchdeck/index.html'),
        whitepaper: resolve(frontend, 'whitepaper/index.html'),
      },
    },
  },
});
