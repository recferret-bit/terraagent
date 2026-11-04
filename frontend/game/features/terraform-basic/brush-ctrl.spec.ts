// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { BrushController, type BrushCommandSink } from './BrushController';

let hovered = { q: 0, r: 0 };
const click = (el: HTMLElement, q: number, r: number, init: MouseEventInit = {}): void => {
  hovered = { q, r };
  el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, ...init }));
  el.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, cancelable: true, button: 0, ...init }));
};
const terraformOf = (s: { args: unknown }) => (s.args as { terraform: Record<string, unknown> }).terraform;

describe('Terraform brush: one click, one order; Ctrl+click queues and stays armed', () => {
  let cleanup: (() => void) | null = null;
  afterEach(() => cleanup?.());

  function setup(extra: Partial<BrushCommandSink> = {}) {
    const sent: Array<{ kind: string; args: unknown }> = [];
    const brush = new BrushController({ sendCommand: (kind, args) => { sent.push({ kind, args }); }, ...extra });
    const surface = document.createElement('div');
    document.body.appendChild(surface);
    cleanup = brush.bindSurface(surface, () => hovered);
    brush.selectOp('terraform');
    return { brush, surface, sent };
  }

  it('TERRAFORM: a click sends one order (the host picks the op) and disarms (the next click selects again)', () => {
    const { brush, surface, sent } = setup();
    click(surface, 3, 1);
    expect(sent.map((s) => s.kind)).toEqual(['enqueueTask']);
    expect(sent.map(terraformOf)).toEqual([{ op: 'grade', tiles: [{ q: 3, r: 1 }] }]);
    expect(brush.isArmed()).toBe(false);
    click(surface, 4, 1);
    expect(sent).toHaveLength(1);
  });

  it('Ctrl+click and Cmd+click send the order and keep the brush armed for the next hex', () => {
    const { brush, surface, sent } = setup();
    click(surface, 3, 1, { ctrlKey: true });
    click(surface, 4, 1, { metaKey: true });
    expect(sent.map(terraformOf).map((t) => t.tiles)).toEqual([[{ q: 3, r: 1 }], [{ q: 4, r: 1 }]]);
    expect(brush.isArmed()).toBe(true);
    click(surface, 5, 1);
    expect(sent).toHaveLength(3);
    expect(brush.isArmed()).toBe(false);
  });

  it('a click the preview refuses sends nothing and keeps the brush armed for another hex', () => {
    const { brush, surface, sent } = setup();
    brush.selectOp('repair');
    click(surface, 3, 1);
    expect(sent).toHaveLength(0);
    expect(brush.getLastStroke()?.statusText).toBe('Nothing to repair here');
    expect(brush.isArmed()).toBe(true);
  });

  it('the selected unit is sent as workerId of a REPAIR order only', () => {
    const { brush, surface, sent } = setup({ getWorkerId: () => 7 });
    click(surface, 2, 0);
    expect(terraformOf(sent[0]!)).toEqual({ op: 'grade', tiles: [{ q: 2, r: 0 }] });
    expect(brush.isArmed()).toBe(false);
  });

  it('any right click (Ctrl or not) disarms', () => {
    const { brush, surface } = setup();
    surface.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, ctrlKey: true }));
    expect(brush.isArmed()).toBe(false);
  });
});

describe('Terraform brush: host reject', () => {
  it("the command bus' reject of this order replaces the \"ordered\" status with the reject code", async () => {
    const brush = new BrushController({ sendCommand: async () => ({ ok: false, code: 'not_own_territory' }) });
    brush.selectOp('terraform');
    brush.strokeTile(3, 1);
    expect(brush.getLastStroke()?.statusText).toMatch(/ordered/i);
    await new Promise((r) => setTimeout(r, 0));
    expect(brush.getLastStroke()?.statusText).toBe('Rejected by host: not own territory');
    expect(brush.getLastOutcome()?.ok).toBe(false);
  });

  it('an ack keeps the status; a late reject of an older order does not overwrite the newer one', async () => {
    const verdicts: Array<(r: { ok: boolean; code?: string }) => void> = [];
    const brush = new BrushController({ sendCommand: () => new Promise((res) => verdicts.push(res)) });
    brush.selectOp('terraform');
    brush.strokeTile(3, 1);
    brush.strokeTile(4, 1);
    verdicts[1]!({ ok: true });
    verdicts[0]!({ ok: false, code: 'site_blocked' });
    await new Promise((r) => setTimeout(r, 0));
    expect(brush.getLastStroke()?.statusText).toMatch(/^Terraform ordered/);
    expect(brush.getLastOutcome()?.ok).toBe(true);
  });
});
