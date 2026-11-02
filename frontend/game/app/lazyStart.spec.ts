import { describe, expect, it } from 'vitest';
import { lazyStart } from './lazyStart';

const deferred = () => { let ok!: (v: string) => void; const p = new Promise<string>((r) => { ok = r; }); return { p, ok }; };

describe('lazyStart (FA-04)', () => {
  it('an unmount before the chunk loaded builds nothing', async () => {
    const d = deferred();
    let built = 0;
    const unmount = lazyStart(() => d.p, () => { built++; return { dispose() {} }; });
    unmount();
    d.ok('chunk');
    await d.p; await Promise.resolve();
    expect(built).toBe(0);
  });

  it('an unmount after the build disposes the instance once', async () => {
    const d = deferred();
    let disposed = 0;
    const unmount = lazyStart(() => d.p, (m) => ({ m, dispose() { disposed++; } }));
    d.ok('chunk');
    await d.p; await Promise.resolve();
    unmount();
    unmount();
    expect(disposed).toBe(1);
  });
});
