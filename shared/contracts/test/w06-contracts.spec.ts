import { describe, expect, it } from 'vitest';
import {
  EVENT_KINDS,
  NEAR_CLAIM_NOT_AVAILABLE,
  NearClaimRequestSchema,
  SocialAuthRequestSchema,
  SocialAuthResponseSchema,
  colonyAccountId,
  eventDef,
  namedAccountOpId,
  parseWaves,
  playerAccountId,
  storageDepositOpId,
  type EventKind,
} from '../src';

describe('W06-01 contracts: social and claim DTOs, relay events, flag W06', () => {
  it('parses POST /v1/auth/social and POST /v1/near/claim, and rejects a stray field', () => {
    const social = SocialAuthRequestSchema.parse({ provider: 'google', token: 'mock.token' });
    expect(social.provider).toBe('google');
    expect(SocialAuthRequestSchema.safeParse({ provider: 'google', token: 't', extra: 1 }).success).toBe(false);
    expect(SocialAuthRequestSchema.safeParse({ provider: 'hot', token: 't' }).success).toBe(false);

    const claim = NearClaimRequestSchema.parse({ accountId: 'test-pilot.terraagent.mock' });
    expect(claim.accountId).toBe('test-pilot.terraagent.mock');
    expect(NearClaimRequestSchema.safeParse({ accountId: 'Bad.Near' }).success).toBe(false);
    expect(NEAR_CLAIM_NOT_AVAILABLE).toBe('NOT_AVAILABLE_YET');
  });

  it('builds a social response with a Pilot ID', () => {
    const body = SocialAuthResponseSchema.parse({
      accessToken: 'atk',
      expiresIn: 900,
      player: { id: 'pr_01ARZ3NDEKTSV4RRFFQ69G5FAV', handle: 'Test Pilot', isGuest: false },
      accountId: playerAccountId('test-pilot'),
    });
    expect(body.accountId).toBe('test-pilot.terraagent.mock');
    expect(colonyAccountId('col_0', 'test-pilot')).toBe('col_0.test-pilot.terraagent.mock');
    expect(namedAccountOpId('google', 'subj')).toBe('named-account:google:subj');
    expect(storageDepositOpId(body.accountId)).toBe('storage-deposit:test-pilot.terraagent.mock');
  });

  it('registers account.created and relay.submitted/settled/failed on wave W06', () => {
    const kinds: EventKind[] = ['account.created', 'relay.submitted', 'relay.settled', 'relay.failed'];
    for (const k of kinds) {
      expect(EVENT_KINDS).toContain(k);
      expect(eventDef(k).wave).toBe('W06');
    }
  });

  it('flags.list() shows W06 when the wave is on, and hides it at ..05', () => {
    expect(parseWaves('all').list).toContain('W06');
    expect(parseWaves('..06').has('W06')).toBe(true);
    expect(parseWaves('..05').has('W06')).toBe(false);
    expect(parseWaves('..05').list).not.toContain('W06');
  });
});
