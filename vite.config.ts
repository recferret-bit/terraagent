import { defineConfig } from 'vite';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

const frontend = resolve(__dirname, 'frontend');

// Same precedence as @terra/config: real env > .env.worktree > .env. The app listens on TA_PORT_BASE + 1 (default 4001).
const fileEnv = (name: string) => {
  const file = resolve(__dirname, name);
  return existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {};
};
const env = { ...fileEnv('.env'), ...fileEnv('.env.worktree'), ...process.env };
const appPort = Number(env.PORT ?? Number(env.TA_PORT_BASE ?? 4000) + 1);
const app = `http://127.0.0.1:${appPort}`;

// One Vite app rooted at frontend/. URLs mirror the file layout: /play.html, /landing.html, /playground.html, /design/.
// `@terra/*` (render, sim, contracts, …) resolve as npm workspace packages; there are no path aliases.
export default defineConfig({
  root: frontend,
  // The client uses same-origin /v1 (REST) and /ws (WebSocket); in dev they are proxied to the app.
  server: { proxy: { '/v1': app, '/ws': { target: app, ws: true } } },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(frontend, 'index.html'),
        landing: resolve(frontend, 'landing.html'),
        play: resolve(frontend, 'play.html'),
        playground: resolve(frontend, 'playground.html'),
        design: resolve(frontend, 'design/index.html'),
        designFoundations: resolve(frontend, 'design/foundations.html'),
        designStorybook: resolve(frontend, 'design/storybook.html'),
        designMotion: resolve(frontend, 'design/motion.html'),
      },
    },
  },
});
