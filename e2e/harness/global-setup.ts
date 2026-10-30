import { bootStack } from './stack';

/** Playwright globalSetup: boot the stack, return the teardown (SIGTERM app + Vite, drop the test DB). */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const s = await bootStack();
  return () => s.stop();
}
