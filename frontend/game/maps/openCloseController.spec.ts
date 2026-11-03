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
