// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { DirectorControls } from './DirectorControls';

describe('W16-19 director controls', () => {
  it('sends a risky patch without an away-raid grant, and keeps the note as text', () => {
    const host = document.createElement('div');
    const controls = new DirectorControls(host);
    const risk = host.querySelector<HTMLSelectElement>('select[name="risk"]');
    const note = host.querySelector('textarea');
    expect(risk).not.toBeNull();
    expect(note).not.toBeNull();
    risk!.value = 'risky';
    note!.value = '<script>alert(1)</script>';
    const args = controls.read();
    expect(args.risk).toBe('risky');
    expect(args.note).toBe('<script>alert(1)</script>');
    expect(JSON.stringify(args)).not.toContain('awayRaids');
    expect(host.querySelector('script')).toBeNull();
    expect(host.querySelector('[name="awayRaids"]')).toBeNull();
  });
});
