// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { FlagshipLabel } from './FlagshipLabel';

describe('W28-12 FlagshipLabel (unit)', () => {
  it('shows the name with textContent only (server text never becomes markup) and hides without a flagship', () => {
    const host = document.createElement('div');
    const label = new FlagshipLabel(host);
    expect(label.el.hidden).toBe(true);
    const evil = 'ISS <img src=x onerror=alert(1)>.near';
    label.sync({ globeNx: 0, globeNy: 0, globeRadiusNormY: 0, anchors: [], flagship: { name: evil, nx: 0.25, ny: 0.2, visible: true } });
    expect(label.el.hidden).toBe(false);
    expect(host.querySelector('img')).toBeNull();
    expect(label.el.querySelector('.flagship-label-name')!.textContent).toBe(evil);
    expect(label.el.style.transform).toContain('25.00vw');
    label.sync({ globeNx: 0, globeNy: 0, globeRadiusNormY: 0, anchors: [] });
    expect(label.el.hidden).toBe(true);
    label.sync(null);
    expect(label.el.hidden).toBe(true);
    label.dispose();
    expect(host.children.length).toBe(0);
  });
});
