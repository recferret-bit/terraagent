// @vitest-environment jsdom
import * as THREE from 'three';
import type { PlanetSurface } from '@terra/render/planets/surface/types';
import { describe, expect, it, vi } from 'vitest';
import { RTSCamera } from '../app/RTSCamera';
import { GlobalMapOpenCloseController } from './openCloseController';

describe('W04-11 Global map open/close wiring and 3D input suspension', () => {
  it('opens on expand icon or M, closes on Esc, M, or close plate, and suspends WASD 3D camera pan while open', () => {
    const cam3d = new THREE.PerspectiveCamera(28, 16 / 9, 0.1, 1000);
    const canvas = document.createElement('canvas');
    const rtsCam = new RTSCamera(
      cam3d,
      canvas,
      { halfSize: 50, heightAt: () => 0 } as unknown as PlanetSurface,
      new THREE.Vector3(20, 20, 20),
      new THREE.Vector3(0, 0, 0),
    );

    const onState = vi.fn();
    const ctrl = new GlobalMapOpenCloseController({
      getRtsCamera: () => rtsCam,
      onStateChange: onState,
    });

    const expandBtn = document.createElement('button');
    const closeBtn = document.createElement('button');
    ctrl.bindExpandButton(expandBtn);
    ctrl.bindCloseButton(closeBtn);

    // Press M -> opens global map and suspends RTSCamera
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }));
    expect(ctrl.isOpen).toBe(true);
    expect(rtsCam.enabled).toBe(false);
    expect(onState).toHaveBeenLastCalledWith(true);

    // While open, pressing W/A/S/D does NOT pan the 3D camera
    const targetBefore = rtsCam.target.clone();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    rtsCam.update(0.5);
    expect(rtsCam.target.x).toBeCloseTo(targetBefore.x, 5);
    expect(rtsCam.target.z).toBeCloseTo(targetBefore.z, 5);

    // Press Escape -> closes global map and re-enables RTSCamera
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(ctrl.isOpen).toBe(false);
    expect(rtsCam.enabled).toBe(true);

    // Expand button opens, close button closes
    expandBtn.click();
    expect(ctrl.isOpen).toBe(true);
    closeBtn.click();
    expect(ctrl.isOpen).toBe(false);

    // Open with M and close with M
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'M', bubbles: true }));
    expect(ctrl.isOpen).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }));
    expect(ctrl.isOpen).toBe(false);

    ctrl.dispose();
    rtsCam.dispose();
  });
});

describe('W04 global map restores the camera it suspended', () => {
  it('a camera that was off (paused, scripted) stays off after close; one that was on comes back on', () => {
    const cam = { enabled: false };
    const ctrl = new GlobalMapOpenCloseController({ getRtsCamera: () => cam, setInputBlocked: () => {}, isOpenBlocked: () => false });
    ctrl.open();
    expect(cam.enabled).toBe(false);
    ctrl.close();
    expect(cam.enabled).toBe(false);

    cam.enabled = true;
    ctrl.open();
    expect(cam.enabled).toBe(false);
    ctrl.close();
    expect(cam.enabled).toBe(true);

    cam.enabled = false;
    ctrl.open();
    ctrl.dispose();
    expect(cam.enabled).toBe(false);
  });

  it('does not open while another modal blocks input; feeds its own block while open', () => {
    const cam = { enabled: true };
    const blocked: boolean[] = [];
    let paused = true;
    const ctrl = new GlobalMapOpenCloseController({
      getRtsCamera: () => cam,
      setInputBlocked: (b) => blocked.push(b),
      isOpenBlocked: () => paused,
    });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }));
    ctrl.open();
    expect(ctrl.isOpen).toBe(false);
    expect(cam.enabled).toBe(true);
    expect(blocked).toEqual([]);

    paused = false;
    ctrl.open();
    expect(ctrl.isOpen).toBe(true);
    ctrl.close();
    expect(blocked).toEqual([true, false]);
    ctrl.dispose();
  });
});

describe('W04 map navigation keys while the global map is open', () => {
  it('maps WASD/arrows to pan, Q/E to zoom, 0 to reset, and routes them to onNavigate', async () => {
    const { navActionForKey, GlobalMapOpenCloseController: Ctrl } = await import('./openCloseController');
    expect(navActionForKey({ key: 'w', shiftKey: false })).toEqual({ kind: 'pan', dx: 0, dy: 1, fast: false });
    expect(navActionForKey({ key: 'ArrowRight', shiftKey: true })).toEqual({ kind: 'pan', dx: -1, dy: 0, fast: true });
    expect(navActionForKey({ key: 'e', shiftKey: false })).toEqual({ kind: 'zoom', factor: 1.25 });
    expect(navActionForKey({ key: '0', shiftKey: false })).toEqual({ kind: 'reset' });
    expect(navActionForKey({ key: 'x', shiftKey: false })).toBeNull();

    const onNavigate = vi.fn();
    const ctrl = new Ctrl({ onNavigate });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(onNavigate).not.toHaveBeenCalled();
    ctrl.open();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(onNavigate).toHaveBeenCalledWith({ kind: 'pan', dx: 1, dy: 0, fast: false });
    ctrl.dispose();
  });
});
