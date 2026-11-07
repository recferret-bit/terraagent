/** Worker-only reconstruction/search data never needs cloning onto the render thread. */
const PRIVATE_VIEW_BLOBS = new Set(['unitMotion', 'pathQueue', 'groupMarch', 'pathStats', 'faunaMotionSeed', 'combatStanceChanges']);

export function renderViewBlobs(blobs: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!blobs) return undefined;
  return Object.fromEntries(Object.entries(blobs).filter(([name]) => !PRIVATE_VIEW_BLOBS.has(name)));
}
