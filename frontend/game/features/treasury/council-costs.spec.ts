// @vitest-environment jsdom
// Excluded from frontend/tsconfig.json. Importing council-view.ts pulls its bus
// module augmentation into that program, and tsc reports TS2664 even though the file resolves.
import { flagsFromList, parseWaves, type FlagSet } from '@terra/contracts';
import { compileData, type CompiledRow } from '@terra/sim';
import { describe, expect, it } from 'vitest';
import type { DaoView } from '../../../../backend/app/src/near/application/ports/treasury-dao.port';
import { treasuryProject } from '../../../../backend/app/src/near/treasury/costs';
import { toCouncil } from '../../../../backend/app/src/near/treasury/council-view';
import { mountCouncilSheet } from './councilDom';
import { councilKindLabel, councilView } from './councilModel';

const DAO: DaoView = {
  daoAccountId: 'planet.dao.terraagent.mock',
  name: 'Planet',
  members: [],
  balances: {},
  proposals: [],
};

/** W00..`last`, optionally skipping one wave. `flagsFromList` always keeps W00. */
function flagsUpTo(last: number, skip?: number): FlagSet {
  const ids: string[] = [];
  for (let n = 0; n <= last; n += 1) {
    if (n !== skip) ids.push(`W${String(n).padStart(2, '0')}`);
  }
  return flagsFromList(ids);
}

function treasuryRows(flags: FlagSet): CompiledRow[] {
  return Object.values(compileData(flags).tables.treasury ?? {});
}

function costText(row: CompiledRow): string {
  return String(row.cost);
}

function numField(row: CompiledRow, key: string): number {
  const value = row[key];
  if (typeof value !== 'number') throw new Error(`${row.id}.${key} is not a number`);
  return value;
}

function paintProjects(projects: readonly { kind: string; cost: string }[]): HTMLElement {
  const host = document.createElement('div');
  const dom = mountCouncilSheet(host, { close() {}, propose() {}, vote() {} });
  dom.paint(councilView({ w22: true, payload: { projects, proposals: [], members: [], balance: {} } }));
  return host;
}

describe('W22-13 council project costs', () => {
  it('positive: the Council form shows each treasury-table cost', () => {
    const flags = parseWaves('..22');
    const rows = treasuryRows(flags);
    const projects = toCouncil('pl_costs', DAO, new Map(), flags).projects;
    expect(projects.map((project) => project.kind)).toEqual(rows.map((row) => row.id));
    const host = paintProjects(projects);
    for (const row of rows) {
      const project = projects.find((item) => item.kind === row.id);
      expect(project?.cost).toBe(costText(row));
      expect(project?.durationH).toBe(numField(row, 'durationH'));
      expect(project?.magnitudeBp).toBe(numField(row, 'magnitudeBp'));
      expect(project?.visits).toBe(numField(row, 'visits'));
      const text = host.querySelector(`[data-testid="council-project-${row.id}"]`)?.textContent ?? '';
      expect(text).toContain(costText(row));
      expect(text).toBe(`${councilKindLabel(row.id)} · ${costText(row)}`);
    }
  });

  it('negative: W22 off lists no projects, so the form has no project options', () => {
    const flags = parseWaves('..21');
    expect(treasuryRows(flags)).toEqual([]);
    expect(toCouncil('pl_off', DAO, new Map(), flags).projects).toEqual([]);
    expect(paintProjects([]).querySelectorAll('option')).toHaveLength(0);
    const hidden = councilView({ w22: false, payload: { projects: [{ kind: 'meteor_shield', cost: '1' }] } });
    expect(hidden.menuItem).toBeNull();
    expect(hidden.projects).toEqual([]);
  });

  it('corner: an unknown kind is omitted, and guild_subsidy stays when W15 is off', () => {
    const flags = flagsUpTo(22, 15);
    expect(flags.has('W15')).toBe(false);
    expect(flags.has('W22')).toBe(true);
    expect(treasuryProject(flags, 'laser_beam')).toBeNull();
    const rows = treasuryRows(flags);
    const projects = toCouncil('pl_w15', DAO, new Map(), flags).projects;
    const subsidy = rows.find((row) => row.id === 'guild_subsidy');
    if (!subsidy) throw new Error('guild_subsidy missing from the treasury table');
    expect(projects.map((project) => project.kind)).toEqual(rows.map((row) => row.id));
    expect(projects.map((project) => project.kind)).not.toContain('laser_beam');
    expect(projects.find((project) => project.kind === 'guild_subsidy')?.cost).toBe(costText(subsidy));
    const text =
      paintProjects(projects).querySelector('[data-testid="council-project-guild_subsidy"]')?.textContent ?? '';
    expect(text).toContain(costText(subsidy));
  });
});
