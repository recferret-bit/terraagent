import type { DevCommandDef, FeatureContext } from '../../core/registry/types';
import { usage } from '../shared/devCommand';
import { buildAuthenticatedDeedFetch } from './parts/deedAuth';

const NOMINATE_USAGE = 'stake.nominate [planetId]';

interface NominateBody {
  readonly isLeadPatron?: boolean;
  readonly leadPatron?: { readonly accountId?: string; readonly carrierName?: string } | null;
  readonly error?: { readonly code?: string; readonly message?: string };
  readonly message?: string;
}

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json().catch(() => ({}))) as T;
}

/**
 * W28 King-of-the-Hill: back a public planet with the pilot's linked wallet (`POST /v1/near/staking/patron/nominate`).
 * The seat goes to the highest ACTIVE `≥ 500 NEAR` staker nominating the planet; nominating alone never grants it.
 */
export async function nominatePlanet(ctx: FeatureContext, planetArg: string | undefined, doFetch = buildAuthenticatedDeedFetch(ctx)): Promise<string> {
  const planetId = planetArg?.trim() || ctx.services.session?.planetId() || '';
  if (!planetId) return 'no planet: join a planet or pass a planet id';
  const status = await doFetch('/v1/near/staking');
  if (!status.ok) return `no linked wallet (GET /v1/near/staking → ${status.status})`;
  const { accountId } = await readJson<{ accountId?: string }>(status);
  if (!accountId) return 'no linked wallet';
  const res = await doFetch('/v1/near/staking/patron/nominate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accountId, planetId }),
  });
  const body = await readJson<NominateBody>(res);
  if (!res.ok) return `nominate failed (${res.status}): ${body.error?.message ?? body.message ?? body.error?.code ?? 'error'}`;
  const lead = body.leadPatron;
  return body.isLeadPatron
    ? `${accountId} is Lead Patron of ${planetId} (${lead?.carrierName ?? 'ISS'})`
    : `${accountId} backs ${planetId}; lead patron: ${lead?.accountId ?? 'none (needs ≥ 500 NEAR active)'}`;
}

export const stakeNominateCmd: DevCommandDef = {
  name: 'stake.nominate',
  help: `${NOMINATE_USAGE}  W28: back this planet (or planetId) in the Lead Patron race with your linked wallet`,
  async run(a, ctx) {
    if (a.length > 1) usage(NOMINATE_USAGE);
    return nominatePlanet(ctx, a[0]);
  },
};
