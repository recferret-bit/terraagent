import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        landing: resolve(__dirname, 'landing.html'),
        play: resolve(__dirname, 'play.html'),
        playground: resolve(__dirname, 'playground.html'),
        design: resolve(__dirname, 'frontend/design/index.html'),
        designFoundations: resolve(__dirname, 'frontend/design/foundations.html'),
        designStorybook: resolve(__dirname, 'frontend/design/storybook.html'),
        designMotion: resolve(__dirname, 'frontend/design/motion.html'),
        designLanding: resolve(__dirname, 'frontend/design/landing.html'),
      },
    },
  },
});
