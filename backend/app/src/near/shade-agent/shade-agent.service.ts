import { createHash } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { z } from 'zod';
import { CoreException } from '../../core/errors/index.js';
import { APP_ENV, type AppEnv } from '../../core/tokens.js';
import { nearAdapterFor } from '../infrastructure/adapter-selection.js';
import { buildMpcSignRequest, deriveEpsilonHex, resolveMpcSignerContract, type MpcSignRequestDescriptor } from './mpc-signer.js';

const EVEN_HEX_RE = /^(?:0x)?(?:[0-9a-fA-F]{2})+$/;
const MAX_VERIFIED_WORKERS = 256;

const AttestationVerifySchema = z.object({
  workerId: z.string().min(1).max(80),
  accountId: z.string().min(2).max(64),
  tdxQuoteHex: z
    .string()
    .min(32)
    .max(16386)
    .regex(EVEN_HEX_RE, 'tdxQuoteHex must be even-length hex'),
  mrtd: z
    .string()
    .min(64)
    .max(130)
    .regex(EVEN_HEX_RE, 'mrtd must be even-length hex'),
  rtmr0: z.string().min(64).max(130).regex(EVEN_HEX_RE).optional(),
  path: z.string().min(1).max(128).default('terra/director'),
  agentPublicKey: z.string().min(8).max(128).optional(),
});

const MpcSignBodySchema = z.object({
  predecessorId: z.string().min(2).max(64),
  path: z.string().min(1).max(128).default('terra/director'),
  payloadHex: z.string().regex(/^(?:0x)?[0-9a-fA-F]{64}$/),
  keyVersion: z.number().int().nonnegative().optional(),
});

export interface VerifiedShadeWorker {
  readonly verified: true;
  readonly workerId: string;
  readonly accountId: string;
  readonly mpcContractId: string;
  readonly epsilonHex: string;
  readonly quoteSha256: string;
  readonly mrtd: string;
  readonly registeredAt: string;
}

@Injectable()
export class ShadeAgentService {
  private readonly verifiedWorkers = new Map<string, VerifiedShadeWorker>();

  constructor(@Optional() @Inject(APP_ENV) private readonly env?: AppEnv) {}

  private envMap(): Record<string, string | undefined> {
    return (this.env ?? process.env) as Record<string, string | undefined>;
  }

  private network(): 'testnet' | 'mainnet' {
    return nearAdapterFor('AgentWallet', this.envMap()) === 'mainnet' ? 'mainnet' : 'testnet';
  }

  private allowedMrtds(): string[] {
    const raw = this.envMap().SHADE_AGENT_ALLOWED_MRTDS ?? '';
    return raw
      .split(',')
      .map((s) => s.trim().toLowerCase().replace(/^0x/, ''))
      .filter(Boolean);
  }

  manifest() {
    const network = this.network();
    const allow = this.allowedMrtds();
    return {
      protocol: 'near-shade-agent-v1',
      network,
      mpcContractId: resolveMpcSignerContract(network),
      allowedMrtds: allow,
      supportedPaths: ['terra/director', 'terra/market-maker'],
      endpoints: {
        verifyAttestation: '/v1/near/shade-agent/verify-attestation',
        mpcSignRequest: '/v1/near/shade-agent/mpc-sign-request',
      },
      verifiedWorkersCount: this.verifiedWorkers.size,
    };
  }

  verifyAttestation(raw: unknown): VerifiedShadeWorker {
    const parsed = AttestationVerifySchema.safeParse(raw ?? {});
    if (!parsed.success) {
      throw new CoreException('VALIDATION_ERROR', {
        status: 400,
        message: 'Invalid Shade Agent attestation payload',
        details: { issues: parsed.error.issues },
      });
    }
    const { workerId, accountId, tdxQuoteHex, mrtd, path } = parsed.data;
    const cleanMrtd = mrtd.toLowerCase().replace(/^0x/, '');
    const allow = this.allowedMrtds();
    const isProd = this.envMap().NODE_ENV === 'production';
    if ((allow.length > 0 && !allow.includes(cleanMrtd)) || (isProd && allow.length === 0)) {
      throw new CoreException('SHADE_MRTD_REJECTED', {
        status: 403,
        message: 'TEE MRTD measurement is not in SHADE_AGENT_ALLOWED_MRTDS',
      });
    }

    const quoteSha256 = createHash('sha256').update(tdxQuoteHex.replace(/^0x/i, ''), 'hex').digest('hex');
    const rec: VerifiedShadeWorker = {
      verified: true,
      workerId,
      accountId,
      mpcContractId: resolveMpcSignerContract(this.network()),
      epsilonHex: deriveEpsilonHex(accountId, path),
      quoteSha256,
      mrtd: cleanMrtd,
      registeredAt: new Date().toISOString(),
    };
    if (!this.verifiedWorkers.has(workerId) && this.verifiedWorkers.size >= MAX_VERIFIED_WORKERS) {
      const oldest = this.verifiedWorkers.keys().next().value;
      if (oldest !== undefined) this.verifiedWorkers.delete(oldest);
    }
    this.verifiedWorkers.set(workerId, rec);
    return rec;
  }

  mpcSignRequest(raw: unknown): MpcSignRequestDescriptor {
    const parsed = MpcSignBodySchema.safeParse(raw ?? {});
    if (!parsed.success) {
      throw new CoreException('VALIDATION_ERROR', { status: 400, message: 'Invalid MPC sign request parameters' });
    }
    return buildMpcSignRequest({
      network: this.network(),
      predecessorId: parsed.data.predecessorId,
      path: parsed.data.path,
      payloadHex: parsed.data.payloadHex,
      keyVersion: parsed.data.keyVersion,
    });
  }
}
