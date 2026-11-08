/**
 * Keeps the bottom-left stack (Command Dock, env panel) below the top-left stack (tick, warp, goals tag, pilot chip):
 * publishes the top-left slot's height as `--ta-hud-top-left-h` on the HUD root, which `hud.css` uses as the
 * bottom-left slot's top edge, so a tall dock shrinks (its body scrolls) instead of sliding under the top-left plates.
 * Returns the cleanup.
 */
export function fitBottomLeftUnderTopLeft(root: HTMLElement, topLeft: HTMLElement): () => void {
  if (typeof ResizeObserver === 'undefined') return () => {};
  const apply = (): void => {
    const h = Math.ceil(topLeft.getBoundingClientRect().height);
    root.style.setProperty('--ta-hud-top-left-h', `${h}px`);
  };
  const ro = new ResizeObserver(apply);
  ro.observe(topLeft);
  apply();
  return () => ro.disconnect();
}
