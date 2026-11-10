import type { UserConfig } from 'vite';
import base from '../../../frontend/vite.config';

/**
 * The E2E stack's page server: the app's Vite config without the file watcher. Other people and agents edit the same
 * tree while a suite runs; with the watcher on, each saved `.ts` file full-reloads the page under test ("Execution
 * context was destroyed"). A run serves the code as it was when each module was first requested. `E2E_WATCH=1` keeps
 * the watcher (live edits while debugging a suite). `E2E_REUSE=1` attaches to `npm run dev`, which this does not touch.
 */
const config: UserConfig = process.env.E2E_WATCH === '1'
  ? base
  : { ...base, server: { ...base.server, watch: null } }; // mergeConfig drops null, so spread

export default config;
