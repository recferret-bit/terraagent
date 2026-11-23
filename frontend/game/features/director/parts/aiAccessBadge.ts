import { STAKING_RULES, STAKING_TIERS, type AiBudgetView } from '@terra/contracts';

/** Why the NEAR.AI provider refused the Director's key (`AiBudgetView.downshiftReason` `provider_*`). */
export type ProviderIssue = 'unfunded' | 'unauthorized' | 'unavailable';

/** What the Director's AI access card shows (W28-11); `legacy` = no card (W28 off / ai-access unavailable). */
export type AiAccessState =
  | { readonly kind: 'legacy' }
  | { readonly kind: 'trial'; readonly left: number; readonly total: number; readonly model: string }
  | { readonly kind: 'script'; readonly trialComplete: boolean; readonly guest: boolean; readonly provider?: ProviderIssue }
  | {
      readonly kind: 'tee';
      readonly tier: number;
      readonly usedUsd: number;
      readonly capUsd: number;
      readonly calls: number;
      readonly callLimit: number;
      readonly slotsUsed: number;
      readonly slotsMax: number;
    }
  | { readonly kind: 'byok'; readonly provider?: ProviderIssue };

/** The tier whose AI colony slot count equals `slots` (data table lookup; 0 when none matches). */
const tierForSlots = (slots: number): number => STAKING_TIERS.find((t) => t.id > 0 && t.aiColonySlots === slots)?.id ?? 0;

const PROVIDER_ISSUES: Readonly<Record<string, ProviderIssue>> = {
  provider_unfunded: 'unfunded',
  provider_unauthorized: 'unauthorized',
  provider_unavailable: 'unavailable',
};

/** `{ provider }` when the budget view says the provider refused the key, else `{}` (keeps old states unchanged). */
const providerOf = (b: AiBudgetView): { provider?: ProviderIssue } => {
  const issue = b.downshiftReason ? PROVIDER_ISSUES[b.downshiftReason] : undefined;
  return issue ? { provider: issue } : {};
};

/** The player's own key failed: what to tell them (the autopilot keeps playing on rules). */
const BYOK_NOTICE: Readonly<Record<ProviderIssue, string>> = {
  unfunded: 'Your NEAR.AI key has no balance. Autopilot runs on rules until you top it up.',
  unauthorized: 'Your NEAR.AI key was rejected. Autopilot runs on rules until you save a valid key.',
  unavailable: 'NEAR.AI is unavailable right now. Autopilot runs on rules meanwhile.',
};

export function aiAccessState(b: AiBudgetView | null): AiAccessState {
  if (!b) return { kind: 'legacy' };
  switch (b.mode) {
    case 'trial':
      return { kind: 'trial', left: b.freeTrialTurnsRemaining, total: b.freeTrialTurnsTotal, model: b.model };
    case 'byok':
      return { kind: 'byok', ...providerOf(b) };
    case 'tee':
      return {
        kind: 'tee', tier: tierForSlots(b.colonySlotsMax), usedUsd: b.dailyBudgetUsedUsd, capUsd: b.dailyBudgetUsd,
        calls: b.dailyCallsUsed, callLimit: b.dailyCallLimit, slotsUsed: b.colonySlotsUsed, slotsMax: b.colonySlotsMax,
      };
    default:
      return {
        kind: 'script',
        guest: !b.trialEligible,
        trialComplete: b.trialEligible && b.freeTrialTurnsTotal > 0 && b.freeTrialTurnsRemaining === 0,
        ...providerOf(b),
      };
  }
}

/** `z-ai/glm-5.3-flash` -> `GLM-5.3-Flash`. */
export function modelLabel(model: string): string {
  const base = model.split('/').pop() ?? model;
  return base.split('-').map((p, i) => (i === 0 ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1))).join('-');
}

const stakeMinNear = (): number => STAKING_TIERS[1]!.minStakeNear;
export const stakeCtaHref = (): string => `/me.html#staking?amount=${stakeMinNear()}`;

export interface AiAccessHandlers { onOpenTee(): void }

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, testid?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = cls;
  if (testid) e.dataset.testid = testid;
  if (text !== undefined) e.textContent = text;
  return e;
};

const handlerMap = new WeakMap<HTMLElement, AiAccessHandlers>();

function teeLink(host: HTMLElement): HTMLButtonElement {
  const b = el('button', 'btn btn-ghost btn-sm ta-director__ai-proof', 'director-ai-tee-proof', 'TEE ✓');
  b.type = 'button';
  b.title = 'Inspect & cryptographically verify NEAR.AI TEE attestations';
  b.addEventListener('click', () => handlerMap.get(host)?.onOpenTee());
  return b;
}

function meter(used: number, cap: number): HTMLElement {
  const pct = cap > 0 ? Math.min(100, Math.max(0, (used / cap) * 100)) : 0;
  const m = el('div', 'ta-director__meter', 'director-ai-meter');
  m.setAttribute('role', 'meter');
  m.setAttribute('aria-valuemin', '0');
  m.setAttribute('aria-valuemax', String(cap));
  m.setAttribute('aria-valuenow', String(used));
  const fill = el('div', 'ta-director__meter-fill');
  fill.style.width = `${pct.toFixed(1)}%`;
  m.appendChild(fill);
  return m;
}

const usd = (n: number): string => `$${n.toFixed(n >= 1 ? 2 : 4)}`;

function ctaLink(): HTMLAnchorElement {
  const a = el('a', 'btn btn-primary btn-sm ta-director__ai-cta', 'director-ai-cta', `Trial Complete — Stake ${stakeMinNear()} NEAR → Keep NEAR.AI TEE Active`);
  a.href = stakeCtaHref();
  return a;
}

const providerHint = (text: string): HTMLElement => {
  const hint = el('div', 'ta-director__ai-hint ta-director__ai-provider', 'director-ai-provider-hint', text);
  hint.setAttribute('role', 'status');
  return hint;
};

/** Draws the AI access card into `host` (`hidden` for `legacy`). Never uses innerHTML. */
export function renderAiAccess(host: HTMLElement, s: AiAccessState, h: AiAccessHandlers): void {
  handlerMap.set(host, h);
  const sig = JSON.stringify(s);
  if (host.dataset.renderedSig === sig && (s.kind === 'legacy' || host.childElementCount > 0)) return;
  host.dataset.renderedSig = sig;
  host.dataset.state = s.kind;
  if ('provider' in s && s.provider) host.dataset.provider = s.provider;
  else delete host.dataset.provider;
  host.hidden = s.kind === 'legacy';
  if (s.kind === 'legacy') { host.replaceChildren(); return; }
  const badge = el('div', 'ta-director__ai-badge', 'director-ai-badge');
  const kids: HTMLElement[] = [badge];
  if (s.kind === 'trial') {
    badge.textContent = `FREE TEE TRIAL (${s.left} / ${s.total} TURNS LEFT · ${modelLabel(s.model)})`;
    badge.append(' ', teeLink(host));
  } else if (s.kind === 'tee') {
    badge.textContent = `NEAR.AI TEE · TIER ${s.tier}`;
    badge.append(' ', teeLink(host));
    const stats = el('div', 'ta-director__ai-stats', 'director-ai-stats', `${usd(s.usedUsd)} / ${usd(s.capUsd)} today · ${s.calls}/${s.callLimit} calls · slots ${s.slotsUsed}/${s.slotsMax}`);
    kids.push(meter(s.usedUsd, s.capUsd), stats);
  } else if (s.kind === 'byok') {
    badge.textContent = s.provider ? 'BYOK · AUTOPILOT: RULES' : 'BYOK';
    badge.title = 'Your own NEAR.AI key: $0 protocol cost';
    if (s.provider) kids.push(providerHint(BYOK_NOTICE[s.provider]));
  } else if (s.provider) {
    badge.textContent = 'AUTOPILOT: RULES (AI PROVIDER UNAVAILABLE)';
    badge.title = 'NEAR.AI cannot take calls right now; your colony keeps playing on the rule-based policy at no cost';
  } else {
    badge.textContent = 'SCRIPT AI (FREE)';
    if (s.trialComplete) kids.push(ctaLink());
    if (s.guest) kids.push(el('div', 'ta-director__ai-hint', 'director-ai-guest-hint', `Sign in to unlock ${STAKING_RULES.freeTrialTurns} free TEE turns`));
  }
  host.replaceChildren(...kids);
}
