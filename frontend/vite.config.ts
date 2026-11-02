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

const chainTxPage: Plugin = {
  name: 'chain-tx-page',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      rewriteChainTx(req);
      rewriteMockOauth(req);
      next();
    });
  },
  configurePreviewServer(server) {
    server.middlewares.use((req, _res, next) => {
      rewriteChainTx(req);
      rewriteMockOauth(req);
      next();
    });
  },
};

// One Vite app rooted at frontend/. URLs mirror the file layout: /play.html, /landing.html, /playground.html, /design/.
// `@terra/*` (render, sim, contracts, …) resolve as npm workspace packages; there are no path aliases.
export default defineConfig({
  plugins: [chainTxPage],
  root: frontend,
  // The client uses same-origin /v1 (REST) and /ws (WebSocket); in dev they are proxied to the app.
  server: { proxy: { '/v1': app, '/ws': { target: app, ws: true } } },
  build: {
    outDir: resolve(frontend, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(frontend, 'index.html'),
        landing: resolve(frontend, 'landing.html'),
        play: resolve(frontend, 'play.html'),
        playground: resolve(frontend, 'playground.html'),
        devChain: resolve(frontend, 'dev/chain/index.html'),
        devChainTx: resolve(frontend, 'dev/chain/tx.html'),
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
