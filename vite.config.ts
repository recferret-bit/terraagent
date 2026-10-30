import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const frontend = resolve(__dirname, 'frontend');

// One Vite app rooted at frontend/. URLs mirror the file layout: /play.html, /landing.html, /playground.html, /design/.
export default defineConfig({
  root: frontend,
  resolve: { alias: { '@shared': resolve(frontend, 'shared') } },
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
