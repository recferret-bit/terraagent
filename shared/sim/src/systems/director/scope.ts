import {
  DirectiveProposalSchema,
  DirectiveV2Schema,
  parseAiJson,
  type DirectiveAction,
  type DirectiveProposal,
  type DirectiveV2,
} from '@terra/contracts';

export interface ColonyScope {
  readonly colonyId: string;
  readonly planetId: string;
  readonly worldId: string;
  readonly colonyIndex: number;
}

export type ScopeReject = 'unauthorized' | 'invalid' | 'context_too_large' | 'too_deep';

function foreignString(value: unknown, scope: ColonyScope): boolean {
  if (typeof value !== 'string') return false;
  if (value === scope.colonyId || value === scope.planetId || value === scope.worldId) return false;
  return /^(co|pl|world)_/.test(value);
}

function walkForeign(value: unknown, scope: ColonyScope): boolean {
  if (foreignString(value, scope)) return true;
  if (Array.isArray(value)) return value.some((item) => walkForeign(item, scope));
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((item) => walkForeign(item, scope));
  }
  return false;
}

/** True when a goal names another colony index. */
export function actionLeavesColony(action: DirectiveAction, colonyIndex: number): boolean {
  if (action.kind !== 'queueGoal') return false;
  const target = action.args.params?.targetColonyId;
  return typeof target === 'number' && target !== colonyIndex;
}

/** Envelope identity must be the authorized colony. Action args may not name another colony. */
export function scopeDirective(directive: DirectiveV2, scope: ColonyScope): ScopeReject | null {
  if (directive.colonyId !== scope.colonyId || directive.planetId !== scope.planetId || directive.worldId !== scope.worldId) {
    return 'unauthorized';
  }
  if (walkForeign(directive.actions, scope)) return 'unauthorized';
  if (directive.actions.some((action) => actionLeavesColony(action, scope.colonyIndex))) return 'unauthorized';
  return null;
}

/**
 * Parse then scope-check. A failure returns no directive, so nothing is turned into a command.
 * Oversized text is rejected inside `parseAiJson` before `JSON.parse`.
 */
export function screenDirective(raw: string, scope: ColonyScope, maxBytes?: number): { ok: true; directive: DirectiveV2 } | { ok: false; code: ScopeReject } {
  const parsed = parseAiJson(DirectiveV2Schema, raw, maxBytes);
  if (!parsed.ok) return { ok: false, code: parsed.code === 'invalid' ? 'invalid' : parsed.code };
  const scopeCode = scopeDirective(parsed.value, scope);
  if (scopeCode) return { ok: false, code: scopeCode };
  return { ok: true, directive: parsed.value };
}

/** Model proposals have no colony id. A foreign id stuffed into the JSON fails before a command exists. */
export function screenProposal(raw: string, scope: ColonyScope, maxBytes?: number): { ok: true; proposal: DirectiveProposal } | { ok: false; code: ScopeReject } {
  const parsed = parseAiJson(DirectiveProposalSchema, raw, maxBytes);
  if (!parsed.ok) return { ok: false, code: parsed.code === 'invalid' ? 'invalid' : parsed.code };
  if (walkForeign(parsed.value.actions, scope)) return { ok: false, code: 'unauthorized' };
  if (parsed.value.actions.some((action) => actionLeavesColony(action, scope.colonyIndex))) return { ok: false, code: 'unauthorized' };
  return { ok: true, proposal: parsed.value };
}
