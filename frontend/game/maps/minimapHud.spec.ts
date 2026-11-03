// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { PlanetRasterCache } from './rasterCache';
import {
  MINIMAP_COMPACT_PX,
  MINIMAP_DESKTOP_PX,
  MinimapHud,
} from './MinimapHud';

describe('W04-05 MinimapHud plate and responsive sizing', () => {
  it('mounts a 180 px chamfered Faction Plate with expand icon and shrinks to 140 px at 844 x 390', () => {
    Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 720, configurable: true });

    const parent = document.createElement('div');
    const onExpand = vi.fn();
    const cache = new PlanetRasterCache();
    const minimap = new MinimapHud({
      parent,
      rasterCache: cache,
      onExpandClick: onExpand,
    });

    expect(minimap.el.classList.contains('plate-sm')).toBe(true);
    expect(minimap.currentSizePx).toBe(MINIMAP_DESKTOP_PX);
    expect(minimap.el.style.width).toBe('180px');
    expect(minimap.el.style.height).toBe('180px');
    expect(minimap.canvas.width).toBe(180);
    expect(minimap.canvas.height).toBe(180);

    // Resize to 844 x 390 (phone landscape) -> 140 px
    Object.defineProperty(window, 'innerWidth', { value: 844, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 390, configurable: true });
    window.dispatchEvent(new Event('resize'));

    expect(minimap.currentSizePx).toBe(MINIMAP_COMPACT_PX);
    expect(minimap.el.style.width).toBe('140px');
    expect(minimap.el.style.height).toBe('140px');
    expect(minimap.canvas.width).toBe(140);
    expect(minimap.canvas.height).toBe(140);

    minimap.expandBtn.click();
    expect(onExpand).toHaveBeenCalledTimes(1);

    minimap.dispose();
  });

  it('uses only valid --ta-* tokens and zero border-radius in minimap.css', () => {
    const css = readFileSync(resolve(import.meta.dirname, 'minimap.css'), 'utf8');
    const tokensCss = readFileSync(
      resolve(import.meta.dirname, '../../design/css/tokens.css'),
      'utf8',
    );
    const defined = new Set<string>();
    for (const m of tokensCss.matchAll(/(--ta-[a-z0-9-]+)\s*:/g)) {
      defined.add(m[1]!);
    }
    for (const m of css.matchAll(/var\(\s*(--ta-[a-z0-9-]+)/g)) {
      expect(defined.has(m[1]!)).toBe(true);
    }
    expect(css).not.toMatch(/border-radius\s*:/);
  });
});
