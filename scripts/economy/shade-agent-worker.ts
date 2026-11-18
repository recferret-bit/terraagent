import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export interface ShadeWorkerRunOptions {
  readonly baseUrl: string;
  readonly accountId: string;
  readonly mrtd: string;
  readonly dryRun: boolean;
}

export async function runShadeAgentWorker(opts: ShadeWorkerRunOptions): Promise<void> {
  const manifestRes = await fetch(`${opts.baseUrl}/v1/near/shade-agent/manifest`);
  const manifest = await manifestRes.json();
  const payloadHex = createHash('sha256').update(`shade-heartbeat:${opts.accountId}:${Date.now()}`).digest('hex');

  console.log('[shade-worker] manifest:', JSON.stringify(manifest));
  if (opts.dryRun) {
    const signRes = await fetch(`${opts.baseUrl}/v1/near/shade-agent/mpc-sign-request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ predecessorId: opts.accountId, path: 'terra/director', payloadHex }),
    });
    console.log('[shade-worker] dry-run mpc-sign-request:', JSON.stringify(await signRes.json()));
    return;
  }

  const quoteHex = createHash('sha256').update(`tdx-quote:${opts.accountId}:${opts.mrtd}`).digest('hex');
  const verifyRes = await fetch(`${opts.baseUrl}/v1/near/shade-agent/verify-attestation`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workerId: `worker-${process.pid}`,
      accountId: opts.accountId,
      tdxQuoteHex: quoteHex,
      mrtd: opts.mrtd,
    }),
  });
  console.log('[shade-worker] verify-attestation:', JSON.stringify(await verifyRes.json()));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = new Set(process.argv.slice(2));
  const dryRun = !args.has('--live');
  void runShadeAgentWorker({
    baseUrl: process.env.TA_API_URL || 'http://127.0.0.1:3000',
    accountId: process.env.SHADE_WORKER_ACCOUNT_ID || 'agent.terraagent.testnet',
    mrtd: process.env.SHADE_WORKER_MRTD || 'a'.repeat(64),
    dryRun,
  });
}
