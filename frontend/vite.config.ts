import { defineConfig, type Plugin } from 'vite';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { prerenderLandingHtml } from './landing/seoPrerender';

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
const hasExplicitProcessAppEnv = Object.prototype.hasOwnProperty.call(process.env, 'VITE_APP_ENV');
const resolvedAppEnv = hasExplicitProcessAppEnv
  ? (process.env.VITE_APP_ENV ?? '').trim()
  : (typeof env.VITE_APP_ENV === 'string' ? env.VITE_APP_ENV.trim() : '');
const defineAppEnv = hasExplicitProcessAppEnv || resolvedAppEnv.length > 0;

function splitUrl(raw: string): { path: string; search: string } {
  const qAt = raw.indexOf('?');
  return qAt === -1 ? { path: raw, search: '' } : { path: raw.slice(0, qAt), search: raw.slice(qAt) };
}

function rewriteChainTx(req: { url?: string }): void {
  const { path, search } = splitUrl(req.url ?? '');
  if (path !== '/dev/chain/tx' && !path.startsWith('/dev/chain/tx/')) return;
  req.url = `/dev/chain/tx.html${search}`;
}

function rewriteMockOauth(req: { url?: string }): void {
  const { path, search } = splitUrl(req.url ?? '');
  if (path !== '/dev/mock-oauth') return;
  req.url = `/dev/mock-oauth/index.html${search}`;
}

function rewriteMePage(req: { url?: string }): void {
  const { path, search } = splitUrl(req.url ?? '');
  if (path !== '/me' && path !== '/me/') return;
  req.url = `/me.html${search}`;
}

function rewriteDeedPage(req: { url?: string }): void {
  const { path, search } = splitUrl(req.url ?? '');
  if (path !== '/deed' && !path.startsWith('/deed/')) return;
  req.url = `/deed.html${search}`;
}

function rewriteEconomySim(req: { url?: string }): void {
  const { path, search } = splitUrl(req.url ?? '');
  if (path !== '/dev/economy-sim') return;
  req.url = `/dev/economy-sim/index.html${search}`;
}

function emitDeedEntryAssets(distDir: string): void {
  const deedHtmlPath = resolve(distDir, 'deed.html');
  if (!existsSync(deedHtmlPath)) return;
  const html = readFileSync(deedHtmlPath, 'utf8');
  const jsMatch = /<script\b[^>]*type=["']module["'][^>]*\bsrc=["'](\/assets\/deed-[^"']+\.js)["']/i.exec(html);
  const assetsDir = resolve(distDir, 'assets');
  mkdirSync(assetsDir, { recursive: true });
  if (jsMatch?.[1]) {
    const srcJs = resolve(distDir, jsMatch[1].slice(1));
    if (existsSync(srcJs)) cpSync(srcJs, resolve(assetsDir, 'deed-entry.js'));
  }
  const cssParts: string[] = [];
  for (const tag of html.matchAll(/<link\b[^>]*\brel=["']stylesheet["'][^>]*>/gi)) {
    const hrefMatch = /\bhref=["'](\/assets\/[^"']+\.css)["']/i.exec(tag[0]);
    if (!hrefMatch?.[1] || hrefMatch[1].startsWith('/assets/base-')) continue;
    const srcCss = resolve(distDir, hrefMatch[1].slice(1));
    if (existsSync(srcCss)) cssParts.push(readFileSync(srcCss, 'utf8').replace(/^@import[^;]+;\s*/gm, ''));
  }
  if (cssParts.length > 0) writeFileSync(resolve(assetsDir, 'deed-entry.css'), cssParts.join('\n'));
}

const chainTxPage: Plugin = {
  name: 'chain-tx-page',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const { path } = splitUrl(req.url ?? '');
      if (path === '/assets/deed-entry.js') {
        req.url = '/game/pages/deed/main.ts';
        next();
        return;
      }
      if (path === '/assets/deed-entry.css') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/css; charset=utf-8');
        res.end('@import "/game/features/deed/deedCardArt.css";\n@import "/game/pages/deed/deedPage.css";\n');
        return;
      }
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
  closeBundle() {
    emitDeedEntryAssets(resolve(frontend, 'dist'));
  },
};

const landingSeoPlugin: Plugin = {
  name: 'landing-seo-prerender',
  transformIndexHtml: {
    order: 'post',
    handler(html, ctx) {
      const file = ctx.filename.replace(/\\/g, '/');
      if (ctx.path === '/landing.html' || file.endsWith('/landing.html')) {
        return prerenderLandingHtml(html);
      }
      return html;
    },
  },
};

// One Vite app rooted at frontend/. URLs mirror the file layout: /play.html, /landing.html, /playground.html, /design/.
// `@terra/*` (render, sim, contracts, …) resolve as npm workspace packages; there are no path aliases.
export default defineConfig({
  plugins: [chainTxPage, landingSeoPlugin],
  root: frontend,
  envDir,
  ...(defineAppEnv
    ? { define: { 'import.meta.env.VITE_APP_ENV': JSON.stringify(resolvedAppEnv) } }
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
        notFound: resolve(frontend, '404.html'),
        play: resolve(frontend, 'play.html'),
        me: resolve(frontend, 'me.html'),
        deed: resolve(frontend, 'deed.html'),
        trade: resolve(frontend, 'trade.html'),
        playground: resolve(frontend, 'playground.html'),
        apiAtlas: resolve(frontend, 'dev/api-atlas/index.html'),
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
