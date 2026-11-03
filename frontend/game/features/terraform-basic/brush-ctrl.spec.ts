// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { BrushController, type BrushCommandSink } from './BrushController';
import { mountTerraformBasic } from './index';

let hovered = { q: 0, r: 0 };
const click = (el: HTMLElement, q: number, r: number, init: MouseEventInit = {}): void => {
  hovered = { q, r };
  el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, ...init }));
  el.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, cancelable: true, button: 0, ...init }));
};
const terraformOf = (s: { args: unknown }) => (s.args as { terraform: Record<string, unknown> }).terraform;

describe('Terraform brush: one click, one order (no multi-select)', () => {
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

  it('TERRAFORM: a click sends one `work` order with intent `terraform` and disarms (the next click selects again)', () => {
    const { brush, surface, sent } = setup();
    click(surface, 3, 1, { ctrlKey: true });
    expect(sent.map((s) => s.kind)).toEqual(['enqueueTask']);
    expect(sent.map(terraformOf)).toEqual([{ op: 'work', intent: 'terraform', tiles: [{ q: 3, r: 1 }] }]);
    expect(brush.isArmed()).toBe(false);
    click(surface, 4, 1);
    expect(sent).toHaveLength(1);
  });

  it('a click the preview refuses sends nothing and keeps the brush armed for another hex', () => {
    const { brush, surface, sent } = setup();
    brush.selectOp('repair');
    click(surface, 3, 1);
    expect(sent).toHaveLength(0);
    expect(brush.getLastStroke()?.statusText).toBe('Nothing to repair here');
    expect(brush.isArmed()).toBe(true);
  });

  it('the selected unit is sent as workerId', () => {
    const { surface, sent } = setup({ getWorkerId: () => 7 });
    click(surface, 2, 0);
    expect(terraformOf(sent[0]!)).toEqual({ op: 'work', intent: 'terraform', tiles: [{ q: 2, r: 0 }], workerId: 7 });
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

describe('W08-11: TerraformMenu stage filtering', () => {
  it('shows S2 terraform ops fill and bridge greyed out at S1 and unlocked at S2', () => {
    const container = document.createElement('div');
    const tf = mountTerraformBasic(container, {});

    tf.update({ colonies: [{ stage: 1, unlockStage: 1 }] } as never);
    const fillBtn = container.querySelector<HTMLButtonElement>('[data-testid="tf-op-fill"]');
    const bridgeBtn = container.querySelector<HTMLButtonElement>('[data-testid="tf-op-bridge"]');
    expect(fillBtn).not.toBeNull();
    expect(bridgeBtn).not.toBeNull();
    expect(fillBtn?.disabled).toBe(true);
    expect(bridgeBtn?.disabled).toBe(true);
    expect(fillBtn?.querySelector('.ta-tf-menu__reason')?.textContent).toBe(
      'Unlocks at S2: extractor + generator · 2 min',
    );
    expect(bridgeBtn?.querySelector('.ta-tf-menu__reason')?.textContent).toBe(
      'Unlocks at S2: extractor + generator · 2 min',
    );

    tf.update({ colonies: [{ stage: 2, unlockStage: 2 }] } as never);
    const fillUnlocked = container.querySelector<HTMLButtonElement>('[data-testid="tf-op-fill"]');
    const bridgeUnlocked = container.querySelector<HTMLButtonElement>('[data-testid="tf-op-bridge"]');
    expect(fillUnlocked?.disabled).toBe(false);
    expect(bridgeUnlocked?.disabled).toBe(false);
    expect(fillUnlocked?.querySelector('.ta-tf-menu__reason')).toBeNull();

    tf.dispose();
  });
});
