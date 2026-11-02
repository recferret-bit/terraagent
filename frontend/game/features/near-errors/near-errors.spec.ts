// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FeatureContext } from '../../core/registry/types';
import { CommandRunner } from '../../dev/console/runner';
import { DevServerError } from '../../net/devServer';
import { NEAR_PLAYER_ERRORS } from './copy';
import nearErrors from './index';

const LINES = {
  NEAR_PROVIDER_REJECTED: 'That sign-in could not be confirmed. Try again.',
  NEAR_NAME_TAKEN: 'That Pilot ID is already in use.',
  NEAR_RELAY_FAILED: "Couldn't save to orbit. Retrying.",
  NEAR_RELAY_RECEIVER_NOT_ALLOWED: 'That save is not allowed for this colony.',
} as const;

type Code = keyof typeof LINES;

function mount(): FeatureContext {
  document.body.replaceChildren();
  const el = document.createElement('div');
  document.body.appendChild(el);
  const ctx: FeatureContext = { flags: new Set(['W06']), host: 'server', services: {} as FeatureContext['services'] };
  nearErrors.hud![0]!.mount(el, ctx);
  return ctx;
}

async function run(line: string, ctx: FeatureContext): Promise<string> {
  const result = await new CommandRunner([nearErrors], ctx).run(line);
  return result?.kind === 'text' ? result.text : '';
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('near.error toasts', () => {
  it('duplicates the four player lines, with no wallet or key wording', () => {
    expect(NEAR_PLAYER_ERRORS).toEqual(LINES);
    expect(Object.values(NEAR_PLAYER_ERRORS).join('\n')).not.toMatch(/wallet|gas|transaction|seed phrase|private key/i);
    expect(nearErrors).toMatchObject({ id: 'near-errors', wave: 'W06' });
    expect(nearErrors.hud?.[0]).toMatchObject({ slot: 'bottom-left', order: 80 });
  });

  it('each code shows one toast with that text and data-code', async () => {
    const ctx = mount();
    const devServer = vi.fn(async (_name: string, args?: unknown) => {
      const code = (args as { code: Code }).code;
      throw new DevServerError('http_400', `400 ${LINES[code]}`, code);
    });
    ctx.services.devServer = devServer;
    for (const code of Object.keys(LINES) as Code[]) {
      expect(await run(`near.error ${code}`, ctx)).toBe(LINES[code]);
      const toasts = document.querySelectorAll('[data-testid="near-toast"]');
      expect(toasts).toHaveLength(1);
      expect(toasts[0]!.textContent).toBe(LINES[code]);
      expect(toasts[0]!.getAttribute('data-code')).toBe(code);
      expect(devServer).toHaveBeenCalledWith('near.error', { code });
    }
  });

  it('does not toast a usage error, an unknown code, or a missing server', async () => {
    const ctx = mount();
    expect(await run('near.error', ctx)).toBe('error: usage: near.error <code>');
    expect(document.querySelector('[data-testid="near-toast"]')).toBeNull();

    ctx.services.devServer = vi.fn(async () => {
      throw new DevServerError('http_400', '400 Unknown NEAR error code "NOPE"', 'VALIDATION_ERROR');
    });
    expect(await run('near.error NOPE', ctx)).toContain('Unknown NEAR error code "NOPE"');
    expect(document.querySelector('[data-testid="near-toast"]')).toBeNull();

    ctx.services.devServer = undefined;
    expect(await run('near.error NEAR_NAME_TAKEN', ctx)).toContain('host_unavailable');
    expect(document.querySelector('[data-testid="near-toast"]')).toBeNull();
  });
});
