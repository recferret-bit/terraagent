// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { fieldsOf, type EconomySchema } from './model';
import { renderFields } from './view-fields';

const prop = (over: Record<string, unknown>) => ({ description: 'd', default: 100, type: 'integer', minimum: 0, maximum: 1000, 'x-unit': 'bp', 'x-mutability': 'runtime', 'x-requiredWave': 'W13', 'x-enabled': true, ...over });
const schema = { schemaVersion: 1, properties: { 'market.policy.platformFeeBp': prop({}), 'hub.t1.storageCapPerFamily': prop({ 'x-mutability': 'new_world_only', default: 500, 'x-unit': 'whole_units' }) } } as unknown as EconomySchema;

describe('economy form view', () => {
  it('renders one input per field with unit, default, bounds, badges and per-field errors, and reports edits', () => {
    let edited = 0;
    const edits: Record<string, string> = {};
    const root = renderFields(fieldsOf(schema), { params: { 'market.policy.platformFeeBp': 80 }, editable: true, edits, errors: { 'market.policy.platformFeeBp': ['out_of_bounds: too big'] }, filter: '', onEdit: () => { edited++; } });
    const input = root.querySelector<HTMLInputElement>('input[data-path="market.policy.platformFeeBp"]')!;
    expect(input.value).toBe('80');
    const row = input.closest('.xe-field')!;
    expect(row.textContent).toContain('unit bp');
    expect(row.textContent).toContain('default 100');
    expect(row.textContent).toContain('bounds 0…1000');
    expect(row.textContent).toContain('RUNTIME');
    expect(row.querySelector('[role="alert"]')?.textContent).toBe('out_of_bounds: too big');
    expect(root.querySelector('[data-path="hub.t1.storageCapPerFamily"]')?.textContent).toContain('NEW WORLD ONLY');
    input.value = '90';
    input.dispatchEvent(new Event('input'));
    expect(edits['market.policy.platformFeeBp']).toBe('90');
    expect(edited).toBe(1);
  });

  it('is read-only for a non-draft and filters by path', () => {
    const root = renderFields(fieldsOf(schema), { params: {}, editable: false, edits: {}, errors: {}, filter: 'storage', onEdit: () => undefined });
    expect(root.querySelectorAll('input')).toHaveLength(1);
    expect(root.querySelector<HTMLInputElement>('input')!.disabled).toBe(true);
  });
});
