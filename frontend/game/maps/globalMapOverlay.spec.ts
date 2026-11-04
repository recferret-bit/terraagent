// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { MAP_LAYER_META } from '@terra/contracts';
import { GlobalMapOverlay } from './GlobalMapOverlay';
import type { MapLayer } from './types';

describe('W04-13 GlobalMapOverlay shell, legend, chips, and focus trap', () => {
  it('renders fullscreen overlay, legend, chips, close button, and traps Tab focus inside the overlay', () => {
    const parent = document.createElement('div');
    const outsideBtn = document.createElement('button');
    outsideBtn.textContent = 'Outside';
    document.body.append(outsideBtn, parent);
    outsideBtn.focus();

    const onClose = vi.fn();
    const overlay = new GlobalMapOverlay({
      parent,
      onCloseClick: onClose,
    });

    const layers: MapLayer[] = [
      { ...MAP_LAYER_META.territory, draw: () => {} },
      { ...MAP_LAYER_META.terrain, draw: () => {} },
      { ...MAP_LAYER_META.units, draw: () => {} },
    ];
    overlay.renderChips(layers, new Set(['territory', 'terrain', 'units']));

    expect(overlay.isOpen).toBe(false);
    expect(overlay.el.hidden).toBe(true);
    expect(overlay.legendEl.querySelectorAll('[data-legend-key]').length).toBeGreaterThanOrEqual(8);

    overlay.setOpen(true);
    expect(overlay.isOpen).toBe(true);
    expect(overlay.el.hidden).toBe(false);
    expect(overlay.el.dataset.open).toBe('true');

    const focusables = overlay.getFocusableElements();
    expect(focusables.length).toBeGreaterThanOrEqual(4); // 3 chips + close button + canvas
    expect(document.activeElement).toBe(focusables[0]);

    // Tab cycles only through focusables inside the overlay and wraps around
    for (let i = 1; i <= focusables.length; i++) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      expect(overlay.el.contains(document.activeElement)).toBe(true);
      expect(document.activeElement).toBe(focusables[i % focusables.length]);
    }

    // Shift+Tab cycles backward inside the overlay
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }),
    );
    expect(document.activeElement).toBe(focusables[focusables.length - 1]);

    overlay.closeBtn.click();
    expect(onClose).toHaveBeenCalledTimes(1);

    overlay.setOpen(false);
    expect(document.activeElement).toBe(outsideBtn);

    overlay.dispose();
    outsideBtn.remove();
    parent.remove();
  });

});

describe('W04 GlobalMapOverlay under the dev console', () => {
  it('keeps Tab inside the dev console (a dialog stacked above the map) instead of pulling focus back, and sits below it', () => {
    const parent = document.createElement('div');
    const consoleEl = document.createElement('div');
    consoleEl.setAttribute('role', 'dialog');
    const input = document.createElement('input');
    consoleEl.appendChild(input);
    document.body.append(parent, consoleEl);
    const overlay = new GlobalMapOverlay({ parent });
    overlay.setOpen(true);

    input.focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    input.dispatchEvent(tab);
    expect(document.activeElement).toBe(input); // the console's only field keeps focus; the map does not take it

    // A text field outside any dialog keeps the browser's own Tab
    const loose = document.createElement('input');
    document.body.appendChild(loose);
    loose.focus();
    const tabLoose = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    loose.dispatchEvent(tabLoose);
    expect(tabLoose.defaultPrevented).toBe(false);
    loose.remove();

    // From anywhere else (e.g. body) Tab is still trapped inside the map
    input.blur();
    const tab2 = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    window.dispatchEvent(tab2);
    expect(tab2.defaultPrevented).toBe(true);
    expect(overlay.el.contains(document.activeElement)).toBe(true);

    const z = (file: string, sel: string) => {
      const css = readFileSync(resolve(import.meta.dirname, file), 'utf8');
      const block = css.slice(css.indexOf(sel));
      return Number(/z-index:\s*(\d+)/.exec(block)![1]);
    };
    expect(z('../dev/console/console.css', '.ta-devcon {')).toBeGreaterThan(z('global-map.css', '.ta-global-map {'));

    overlay.dispose();
    parent.remove();
    consoleEl.remove();
  });
});

describe('W04-13 GlobalMapOverlay styles', () => {
  it('uses only valid --ta-* tokens and zero border-radius in global-map.css', () => {
    const css = readFileSync(resolve(import.meta.dirname, 'global-map.css'), 'utf8');
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
