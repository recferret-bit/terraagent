import {
  computeSolarOutputPerS,
  DISMANTLE_REFUND_RATE,
  REPAIR_COST_RATE,
  resolveExtractorRow,
  resolveHarvesterRow,
  terraformFindSpec,
  TERRAFORM_TIME_TABLE,
  type CompiledDataLike,
} from '@terra/sim';
import { makeDiv, makeSpan } from '../shared/dom';
import { formatCost } from '../shared/resources';
import { groundYields } from './groundPreview';

/**
 * The dock's reference tables. Every number is read from the sim: `TERRAFORM_TIME_TABLE`, the yields of
 * `groundYields`, the deposit roll `terraformFindSpec`, and the host's compiled balance rows (`simData()`:
 * Harvester `harvestRatePerS`, Extractor `outputPerS`, Solar output) so a dev `tune` shows up here.
 */

export interface ReferenceTableRow {
  readonly target: string;
  readonly detail: string;
}

export const pct = (x: number): string => `${Number((x * 100).toFixed(2))}%`;
const secs = (key: keyof typeof TERRAFORM_TIME_TABLE): string => `${TERRAFORM_TIME_TABLE[key].durationSec.toFixed(1)}s`;
const plusYield = (key: 'forest' | 'rock', data?: CompiledDataLike): string =>
  `+${formatCost(groundYields(key, data) ?? {}).replace(/ · /g, ', +')}`;
const rate = (n: unknown, digits = 2): string => (Number(n) || 0).toFixed(digits);

/** The deposit roll of a terraformed hex (the sim's `terraformFindSpec`: the tunable `terraformFinds.deposit` row). */
export function resourceFindRow(data?: CompiledDataLike): ReferenceTableRow {
  const { chance, tierWeights: w } = terraformFindSpec(data);
  return { target: 'Resource find', detail: `${pct(chance)} per hex · t1 ${pct(w[1])} / t2 ${pct(w[2])} / t3 ${pct(w[3])}` };
}

/** Time and result of each op. */
export function timeReferenceRows(data?: CompiledDataLike): ReferenceTableRow[] {
  return [
    { target: 'Terraform: Trees', detail: `${secs('forest')} · ${plusYield('forest', data)}` },
    { target: 'Terraform: Rock', detail: `${secs('rock')} · ${plusYield('rock', data)}` },
    { target: 'Terraform: Slope / Crater', detail: `${secs('slope')} · Prepared Hex` },
    { target: 'Terraform: Wild Ground', detail: `${secs('flat')} · Prepared Hex` },
    resourceFindRow(data),
    { target: 'Repair', detail: `${secs('repair')} · ${pct(REPAIR_COST_RATE)} of base cost` },
    { target: 'Dismantle', detail: `½ build time (Builder / HQ) · +${pct(DISMANTLE_REFUND_RATE)} refunded step by step` },
  ];
}

/** What the colony earns: terraform yields and the T1 producers' rates (the host's compiled rows). */
export function incomeReferenceRows(data?: CompiledDataLike): ReferenceTableRow[] {
  const harvest = rate(resolveHarvesterRow(data).harvestRatePerS);
  return [
    { target: 'Trees (Terraform)', detail: `${plusYield('forest', data)} (one-shot)` },
    { target: 'Rock (Terraform)', detail: plusYield('rock', data) },
    { target: 'Harvester (per deposit)', detail: `+${harvest}/s of its resource` },
    { target: 'Resource Extractor', detail: `+${rate(resolveExtractorRow(data).outputPerS)} Metals or Minerals/s` },
    { target: 'Solar Array (Day)', detail: `+${rate(computeSolarOutputPerS(1, 'temperate', data).net, 1)} Energy/s` },
  ];
}

function fillTable(list: HTMLElement, rows: readonly ReferenceTableRow[]): void {
  list.replaceChildren(
    ...rows.map((row) => {
      const item = makeDiv('ta-tf-menu__table-row');
      item.dataset.target = row.target;
      item.append(makeSpan('ta-tf-menu__table-key', undefined, row.target), makeSpan('ta-tf-menu__table-val mono', undefined, row.detail));
      return item;
    }),
  );
}

function tableSection(testid: string, heading: string): { section: HTMLElement; list: HTMLElement } {
  const section = makeDiv('ta-tf-menu__table plate-sm', testid);
  const list = makeDiv('ta-tf-menu__table-rows');
  section.append(makeDiv('ta-tf-menu__table-title eyebrow', undefined, heading), list);
  return { section, list };
}

/** The two tables; refilled only when the host's balance data changes (a `tune`). */
export class ReferenceTables {
  readonly el: HTMLElement;
  private readonly time: HTMLElement;
  private readonly income: HTMLElement;
  private shownFor: CompiledDataLike | null | undefined = null;

  constructor(private readonly getData: () => CompiledDataLike | null | undefined = () => undefined) {
    this.el = makeDiv('ta-tf-menu__tables');
    const time = tableSection('tf-time-table', 'TERRAFORM · REPAIR · DISMANTLE TIME');
    const income = tableSection('tf-income-table', 'COLONY INCOME & YIELD');
    this.time = time.list;
    this.income = income.list;
    this.el.append(time.section, income.section);
    this.refresh(true);
  }

  refresh(force = false): void {
    const data = this.getData() ?? undefined;
    if (!force && data === this.shownFor) return;
    this.shownFor = data;
    fillTable(this.time, timeReferenceRows(data));
    fillTable(this.income, incomeReferenceRows(data));
  }
}
