import { describe, expect, it, vi } from 'vitest';
import { deliverMintedToken } from './deliverToken';

function host(opener: Window | null, assign = vi.fn(), close = vi.fn()): Window {
  return { opener, close, location: { origin: 'http://play.test', assign } } as unknown as Window;
}

describe('mock oauth token delivery (W06-15)', () => {
  it('posts to a same-origin opener and does not navigate either window', () => {
    const postMessage = vi.fn();
    const assign = vi.fn();
    const close = vi.fn();
    const opener = { location: { origin: 'http://play.test' }, postMessage } as unknown as Window;
    const win = host(opener, assign, close);
    expect(deliverMintedToken(win, 'google', 'abc def', '/play.html?planet=dune')).toBe('posted');
    expect(postMessage).toHaveBeenCalledWith(
      { type: 'terra:mock-token', provider: 'google', token: 'abc def' },
      'http://play.test',
    );
    expect(close).toHaveBeenCalledOnce();
    expect(assign).not.toHaveBeenCalled();
  });

  it('redirects this window when there is no opener (direct navigation)', () => {
    const assign = vi.fn();
    const close = vi.fn();
    const win = host(null, assign, close);
    expect(deliverMintedToken(win, 'x', 'abc def', '/play.html?planet=dune')).toBe('redirected');
    expect(assign).toHaveBeenCalledWith('/play.html?planet=dune#mock_token=abc%20def');
    expect(close).not.toHaveBeenCalled();
  });

  it('redirects this window when the opener is not same-origin', () => {
    const postMessage = vi.fn();
    const assign = vi.fn();
    const other = { location: { origin: 'https://other.test' }, postMessage } as unknown as Window;
    expect(deliverMintedToken(host(other, assign), 'google', 't', '/play.html')).toBe('redirected');
    expect(postMessage).not.toHaveBeenCalled();
    expect(assign).toHaveBeenCalledWith('/play.html#mock_token=t');

    const blocked = {
      get location(): Location { throw new DOMException('blocked'); },
      postMessage: vi.fn(),
    } as unknown as Window;
    const assignBlocked = vi.fn();
    expect(deliverMintedToken(host(blocked, assignBlocked), 'google', 't', '/play.html')).toBe('redirected');
    expect(blocked.postMessage).not.toHaveBeenCalled();
    expect(assignBlocked).toHaveBeenCalledOnce();
  });
});
