import { test, type Browser, type BrowserContextOptions } from '@playwright/test';
import { urls } from './ports';

/** Separate GPU process for a second WebGL client; retain the suite's browser configuration and traces. */
export async function independentBrowser(source: Browser, options: BrowserContextOptions = {}, traceName = 'independent') {
  const { channel, headless, launchOptions } = test.info().project.use;
  const browser = await source.browserType().launch({ ...launchOptions, channel, headless });
  let context;
  try { context = await browser.newContext({ baseURL: urls().client, ...options }); }
  catch (error) { await browser.close(); throw error; }
  return {
    context,
    async close(failed = false): Promise<void> {
      let cleanupError: unknown;
      try {
        const path = test.info().outputPath(`${traceName}.trace.zip`);
        await context.tracing.stopChunk({ path });
        await test.info().attach(`${traceName} context trace`, { path, contentType: 'application/zip' });
        await context.tracing.startChunk(); // Leave a final chunk for the runner's automatic collection.
      } catch (error) { cleanupError = error; }
      try { await browser.close(); } catch (error) { cleanupError ??= error; }
      if (cleanupError && !failed) throw cleanupError;
      if (cleanupError) console.warn(`[${traceName} cleanup]`, String(cleanupError));
    },
  };
}
