import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileData, createPlanet, DEPOSIT, getDepositRichnessBp, setOverride, TERRAIN } from '../../src';
import { allTables } from '../../src/data';

const W01 = new Set(['W00', 'W01']);

describe('generation data is not tunable (WE-19)', () => {
  it('rejects tunes of worldgen rows and of terrain codes with a clear message', () => {
    expect(() => compileData(W01, setOverride({}, 'worldgen.desert.duneHeightM', 8))).toThrow(
      /worldgen\.desert\.duneHeightM cannot be tuned: world generation reads the file rows once/,
    );
    expect(() => compileData(W01, setOverride({}, 'worldgen.shared.spawnRingRadius', 20))).toThrow(/cannot be tuned/);
    expect(() => compileData(W01, setOverride({}, 'terrain.flat.code', 3))).toThrow(/terrain\.flat\.code cannot be tuned/);
    // the spawn / richness numbers left the terrain table: tuning them there is an unknown field
    expect(() => compileData(W01, setOverride({}, 'terrain.temperate.spawnRingRadius', 20))).toThrow(/unknown field/);
    // runtime terrain numbers stay tunable
    expect(() => compileData(W01, setOverride({}, 'terrain.rock.moveMult', 0.8))).not.toThrow();
    expect(() => compileData(W01, setOverride({}, 'terrain.temperate.livingMoveMult', 1.2))).not.toThrow();
  });
});

describe('per-profile deposit richness modifiers are data (WE-20)', () => {
  it('desert metals / minerals +15 %, ocean oil +20 % and metals −15 %, temperate minerals +15 %', () => {
    const base = (kind: number) => getDepositRichnessBp('s', 7, kind, 'desert'); // the base draw ignores the type
    const raw = Math.round((base(DEPOSIT.oil) * 10000) / 10000);
    expect(base(DEPOSIT.metals)).toBe(Math.round((raw * 11500) / 10000));
    expect(base(DEPOSIT.minerals)).toBe(Math.round((raw * 11500) / 10000));
    expect(getDepositRichnessBp('s', 7, DEPOSIT.oil, 'ocean')).toBe(Math.round((raw * 12000) / 10000));
    expect(getDepositRichnessBp('s', 7, DEPOSIT.metals, 'ocean')).toBe(Math.round((raw * 8500) / 10000));
    expect(getDepositRichnessBp('s', 7, DEPOSIT.minerals, 'ocean')).toBe(raw);
    expect(getDepositRichnessBp('s', 7, DEPOSIT.minerals, 'temperate')).toBe(Math.round((raw * 11500) / 10000));
    expect(getDepositRichnessBp('s', 7, DEPOSIT.metals, 'temperate')).toBe(raw);
  });

  it('the temperate class shares come from the worldgen row (quota classifier)', () => {
    const s = createPlanet({ id: 'p', seed: 'shares', type: 'temperate', planetType: 'temperate', radius: 30 });
    const deep = Array.from(s.grid.layers.terrain).filter((t) => t === TERRAIN.deep).length;
    expect(deep).toBe(Math.round((s.grid.count * 400) / 10000)); // worldgen.temperate.shareDeep (spawn guarantees never touch water)
  });
});

// WE-24: every field of these tables is read somewhere in the sim source (or reserved below). The gameplay tables
// (hq, hub, opsBasic) joined once their alias fields were gone (GP-25 / XC-01).
const CHECKED_TABLES = ['dev', 'terrain', 'worldgen', 'hq', 'hub', 'opsBasic'];
/** Fields no sim code reads, with the reason. */
const RESERVED: Record<string, string> = {
  'dev.probe.buildS': 'unit-conversion probe (tests and the tune loop only)',
  'dev.probe.ratePerS': 'unit-conversion probe (tests and the tune loop only)',
  'terrain.*.code': 'documents the TERRAIN layer code (fixed)',
  'hq.t1.supply': 'supply use of a unit: W02 production / supply cap',
  'hq.t1.gridDrawPerS': 'power grid draw: W02 power grid',
  'hq.t1.maxBuildTier': 'worker tier rule (UO-L-02): when a second building tier exists',
  'hq.t1.cellFastRechargeShedGroup': 'power shedding group: W02 power grid',
  'hq.t1.selfPreservationHpRatio': 'HQ retreat rule: combat wave',
  'hq.startingKit.autoPlaceIdleS': 'auto Hub placement after idling (W01-18 stretch, client-side today)',
  'hub.t1.powerDrainPerS': 'power grid drain: W02 power grid',
  'hub.t1.pylonMaxLoad': 'pylon chains: W02 power grid',
  'opsBasic.*.unlockStage': 'stage unlocks: a later wave (every S0 op is unlocked in W01)',
};

function simSources(): string {
  const root = resolve(import.meta.dirname, '../../src');
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.ts') && !(dir.endsWith('/data') && !e.name.startsWith('_') && e.name !== 'index.ts')) out.push(readFileSync(p, 'utf8'));
    }
  };
  walk(root);
  return out.join('\n');
}

describe('every field of the engine-owned tables is read (WE-24)', () => {
  it('names each field outside the table files, or lists it as reserved', () => {
    const src = simSources();
    const unread: string[] = [];
    for (const t of allTables().filter((x) => CHECKED_TABLES.includes(x.name))) {
      for (const row of t.rows) {
        for (const f of Object.keys(row)) {
          if (f === 'id' || f === 'wave' || f === 'stages') continue;
          if (RESERVED[`${t.name}.${row.id}.${f}`] || RESERVED[`${t.name}.*.${f}`]) continue;
          if (!new RegExp(`['.\`]${f}\\b`).test(src)) unread.push(`${t.name}.${row.id}.${f}`);
        }
      }
    }
    expect(unread).toEqual([]);
  });
});
