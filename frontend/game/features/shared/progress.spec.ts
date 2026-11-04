// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createProgressBar, setProgress, setRangeProgress } from './progress';
import { SelectionDetails } from './SelectionDetails';
import { CargoToastController } from '../trade-hub/cargoUx';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it('writes a real CSS range custom property and accessible meter values', () => {
  const input = document.createElement('input');
  setRangeProgress(input, 25, 100);
  expect(input.style.getPropertyValue('--val')).toBe('25.0%');
  setRangeProgress(input, 0, 0);
  expect(input.style.getPropertyValue('--val')).toBe('0.0%');
  const { bar, fill } = createProgressBar('Throughput', 'bar', 'fill', 'fill');
  setProgress(fill, 250, 250);
  expect(fill.style.width).toBe('100%');
  expect(bar.getAttribute('aria-valuenow')).toBe('250');
});

it('expands building details through callbacks and hides unsupported building content', () => {
  const parent = document.createElement('div');
  const details = new SelectionDetails(parent);
  const content = document.createElement('section');
  const toggle = (open: boolean) => details.show(content, open, toggle);
  toggle(true);
  details.toggle.click();
  expect(details.body.hidden).toBe(true);
  expect(details.toggle.getAttribute('aria-expanded')).toBe('false');
  details.toggle.click();
  expect(details.body.hidden).toBe(false);
  expect(details.body.firstChild).toBe(content);
  details.hide();
  expect(details.body.hidden).toBe(true);
  expect(details.toggle.hidden).toBe(true);
});

it('shows exactly one warning and dismisses a limit warning after eight seconds', () => {
  vi.useFakeTimers();
  const inside = document.createElement('div');
  const outside = document.createElement('div');
  const toast = new CargoToastController(inside, outside);
  toast.setPanelOpen(true);
  toast.notifyError('mint_cap', undefined, 60);
  expect(inside.hidden).toBe(false);
  expect(outside.hidden).toBe(true);
  toast.setPanelOpen(false);
  expect(inside.hidden).toBe(true);
  expect(outside.hidden).toBe(false);
  vi.advanceTimersByTime(8000);
  expect(outside.hidden).toBe(true);
  toast.dispose();
});
