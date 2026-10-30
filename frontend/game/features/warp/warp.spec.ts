import { describe, expect, it, vi } from 'vitest';
import type { ServerMessage } from '@terra/contracts';
import type { FeatureContext, GameView } from '../../core/registry';
import { CommandRunner } from '../../dev/console/runner';
import { warpOfMessage } from '../../net/warpFeed';
import warpFeature, { warpBadge } from './index';

/** The vitest env is node: a tiny fake element is enough for the badge. */
const fakeEl = () => ({ hidden: false, textContent: '', className: '', dataset: {} as Record<string, string>, appendChild() {}, remove() {} });
const mountBadge = () => {
  const el = fakeEl();
  vi.stubGlobal('document', { createElement: () => el });
  const inst = warpFeature.hud![0]!.mount(fakeEl() as unknown as HTMLElement, {} as FeatureContext);
  return { el, update: (v: GameView) => inst.update?.(v) };
};

describe('warp badge', () => {
  it('is hidden at x1 and when unknown, shows x<k> above 1', () => {
    const b = mountBadge();
    expect(b.el.hidden).toBe(true);
    b.update({ warp: 1 });
    expect(b.el.hidden).toBe(true);
    b.update({ warp: 10 });
    expect(b.el.hidden).toBe(false);
    expect(b.el.textContent).toBe('×10');
    b.update({ warp: 1 });
    expect(b.el.hidden).toBe(true);
    expect(warpBadge(undefined)).toBeNull();
  });
});

describe('warpOfMessage', () => {
  it('reads welcome.warp (default 1) and dev.warp events, ignores the rest', () => {
    const welcome = (warp?: number) => ({ t: 'welcome', d: { ...(warp ? { warp } : {}) } }) as unknown as ServerMessage;
    expect(warpOfMessage(welcome())).toBe(1);
    expect(warpOfMessage(welcome(10))).toBe(10);
    expect(warpOfMessage({ t: 'event', d: { kind: 'dev.warp', data: { k: 7 } } } as unknown as ServerMessage)).toBe(7);
    expect(warpOfMessage({ t: 'event', d: { kind: 'dev.pong', data: {} } } as unknown as ServerMessage)).toBeUndefined();
    expect(warpOfMessage({ t: 'pong', d: {} } as unknown as ServerMessage)).toBeUndefined();
  });
});

describe('warp command', () => {
  const run = async (line: string, services: Partial<FeatureContext['services']>) => {
    const r = await new CommandRunner([warpFeature], { flags: new Set(['W00']), host: 'server', services: services as FeatureContext['services'] }).run(line);
    return r?.kind === 'text' ? r.text : '';
  };
  it('posts the session planet and k to the server', async () => {
    const devServer = vi.fn(async () => ({}));
    await run('warp 10', { devServer, session: { planetId: () => 'pl_1' } });
    expect(devServer).toHaveBeenCalledWith('warp', { planetId: 'pl_1', k: 10 });
  });
  it('rejects bad k, no planet and no server', async () => {
    const devServer = vi.fn(async () => ({}));
    expect(await run('warp 0', { devServer, session: { planetId: () => 'pl_1' } })).toContain('usage');
    expect(await run('warp x', { devServer, session: { planetId: () => 'pl_1' } })).toContain('usage');
    expect(await run('warp 5', { devServer, session: { planetId: () => null } })).toContain('not connected');
    expect(await run('warp 5', {})).toContain('host_unavailable');
    expect(devServer).not.toHaveBeenCalled();
  });
});
