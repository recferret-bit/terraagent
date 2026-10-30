import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as nearPorts from '../../src/near/application/ports/index.js';
import * as appPorts from '../../src/ports/index.js';
import { ChainReceipt, NEAR_PORT_NAMES, AccountId, TokenAmount } from '../../src/near/domain/types.js';

const { PORTS } = nearPorts;
const abstractClasses = Object.entries({ ...nearPorts, ...appPorts }).filter(([k, v]) => k.endsWith('Port') && typeof v === 'function');

describe('ports', () => {
  it('exports 13 uniquely named abstract classes', () => {
    const names = abstractClasses.map(([k]) => k);
    console.log(names.join('\n'));
    expect(names).toHaveLength(13);
    expect(new Set(names).size).toBe(13);
    expect(PORTS).toHaveLength(13);
    expect(new Set(PORTS.map((p) => p.name)).size).toBe(13);
    expect(new Set(PORTS.map((p) => p.token)).size).toBe(13);
    for (const n of NEAR_PORT_NAMES) expect(PORTS.some((p) => p.name === n)).toBe(true);
  });

  it('cannot be constructed at type level', () => {
    // @ts-expect-error abstract class
    void (() => new nearPorts.ChainReadPort());
    // @ts-expect-error abstract class
    void (() => new appPorts.LlmProviderPort());
  });

  it('contains no any in the ports sources', () => {
    const root = join(import.meta.dirname, '../../src');
    const files: string[] = [];
    const walk = (d: string) => readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(join(d, e.name)) : files.push(join(d, e.name))));
    walk(join(root, 'near')); walk(join(root, 'ports'));
    expect(files.length).toBeGreaterThan(13);
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toMatch(/:\s*any\b|<any>|\bas any\b|any\[\]/);
  });

  it('boundary schemas validate', () => {
    expect(AccountId.safeParse('alice.terraagent.mock').success).toBe(true);
    expect(AccountId.safeParse('Alice').success).toBe(false);
    expect(TokenAmount.safeParse('12').success).toBe(true);
    expect(TokenAmount.safeParse('1.5').success).toBe(false);
    expect(ChainReceipt.safeParse({ txHash: 'mock:1', status: 'success', network: 'mock', at: 1 }).success).toBe(true);
  });
});
