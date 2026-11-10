// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { STAGE_TABLE_ROWS } from '@terra/sim';
import { mountStageTrackHud } from './index';
import { makeMockContext, makeMockTransport } from './stageTestHelpers';

function mountInBook(withOverlay = true) {
  const pane = document.createElement('div');
  const overlay = document.createElement('div');
  document.body.append(pane, overlay);
  const ctx = makeMockContext('..08');
  if (withOverlay) ctx.services.hudOverlay = overlay;
  const mounted = mountStageTrackHud(pane, ctx);
  return { pane, overlay, mounted, hud: mounted.hud! };
}

afterEach(() => document.body.replaceChildren());

describe('Stage goals in the Colony book (launcher + summary in the Goals tab, dialog in the HUD overlay)', () => {
  it('keeps the launcher and the summary line in the pane and mounts the dialog in the overlay', () => {
    const { pane, overlay, hud, mounted } = mountInBook();
    expect(pane.querySelector('[data-testid=stage-goals-launcher]')?.textContent).toBe('Goals · S0');
    expect(pane.querySelector('.ta-stage-summary')?.textContent).toContain(STAGE_TABLE_ROWS[0]!.label);
    expect(overlay.contains(hud.root)).toBe(true);
    expect(pane.contains(hud.root)).toBe(false);
    expect(hud.root.hidden).toBe(true);
    mounted.dispose();
  });

  it('opens the overlay dialog from the launcher and on a stage-reached notice from any tab', () => {
    const { pane, mounted, hud } = mountInBook();
    pane.querySelector<HTMLButtonElement>('[data-testid=stage-goals-launcher]')!.click();
    expect(hud.root.hidden).toBe(false);
    hud.root.querySelector<HTMLButtonElement>('[data-testid=stage-goals-close]')!.click();
    expect(hud.root.hidden).toBe(true);
    hud.showStageToast(2, { replay: true });
    expect(hud.root.hidden).toBe(false);
    expect(hud.root.querySelector('[data-testid=stage-reached-toast]')).not.toBeNull();
    mounted.dispose();
  });

  it('updates the summary with the next-stage condition and on stage changes', () => {
    const { pane, mounted } = mountInBook();
    mounted.update!({ colonies: [{ index: 0, stage: 3, nextStageConditionText: 'Build a Trade Hub' }] } as never);
    const summary = pane.querySelector('.ta-stage-summary')!.textContent!;
    expect(summary).toContain(STAGE_TABLE_ROWS[3]!.label);
    expect(summary).toContain('Next: Build a Trade Hub');
    mounted.dispose();
  });

  it('shows only the stage label at the last stage (no next condition)', () => {
    const { pane, mounted } = mountInBook();
    const last = STAGE_TABLE_ROWS[STAGE_TABLE_ROWS.length - 1]!;
    mounted.update!({ colonies: [{ index: 0, stage: last.stage }] } as never);
    expect(pane.querySelector('.ta-stage-summary')!.textContent).toBe(last.label);
    mounted.dispose();
  });

  it('falls back to the pane without an overlay; dispose removes launcher, summary and dialog either way', () => {
    const legacy = mountInBook(false);
    expect(legacy.pane.contains(legacy.hud.root)).toBe(true);
    legacy.mounted.dispose();
    expect(legacy.pane.childElementCount).toBe(0);
    const book = mountInBook();
    book.mounted.dispose();
    expect(book.pane.childElementCount).toBe(0);
    expect(book.overlay.childElementCount).toBe(0);
  });

  it('a transport stage-reached message opens the overlay dialog (notice visible with the Goals tab closed)', () => {
    const pane = document.createElement('div');
    const overlay = document.createElement('div');
    const mock = makeMockTransport();
    const ctx = makeMockContext('..08', mock.transport);
    ctx.services.hudOverlay = overlay;
    const mounted = mountStageTrackHud(pane, ctx);
    mock.emit({ t: 'event', d: { kind: 'stageReached', data: { stage: 1, colonyIndex: 0 } } });
    const toast = overlay.querySelector('[data-testid=stage-reached-toast]');
    expect(toast).not.toBeNull();
    expect(pane.querySelector('[data-testid=stage-reached-toast]')).toBeNull();
    mounted.dispose();
  });
});
