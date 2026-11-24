import 'reflect-metadata';
import http from 'node:http';
import { afterAll, describe, expect, it } from 'vitest';
import { rpcApyProbe } from '../../src/near/infrastructure/adapters/real/chain-apy-probe';
import { TestnetStakingAdapter } from '../../src/near/infrastructure/adapters/real/testnet-staking.adapter';
import { resolveNearNetworkConfig } from '../../src/near/infrastructure/network/near-network.config';
import { NearRpcClient } from '../../src/near/infrastructure/rpc/near-rpc.client';
import { nearToYocto } from '../../src/near/staking/yocto';

const rpcServers: http.Server[] = [];
afterAll(async () => {
  await Promise.all(rpcServers.map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
});

const enc = (val: unknown) => Array.from(Buffer.from(JSON.stringify(val), 'utf8'));

function callFnResult(methodName: string, args: Record<string, string>): unknown {
  if (methodName === 'get_account_positions') {
    return [{
      account_id: args.account_id, pool_id: 'astro-stakers.poolv1.testnet', staked: nearToYocto(50),
      unbonding: '0', unbonding_ready_at_ms: null, withdrawable: '0', rewards: nearToYocto(1),
      staked_since_ms: 1700000000000, last_staked_at_ms: 1700000000000, asset: 'near',
    }];
  }
  if (methodName === 'ft_balance_of') return nearToYocto(12);
  if (methodName === 'get_st_near_price' || methodName === 'ft_price' || methodName === 'get_lst_price') return nearToYocto('1.1');
  if (methodName === 'get_account_total_balance') return nearToYocto(51);
  if (methodName === 'get_total_staked_balance') return nearToYocto(10_000);
  return '0';
}

function handleJsonRpcRequest(body: { id: number; method: string; params: Record<string, unknown> }) {
  if (body.method === 'block') {
    const blkId = body.params.block_id as number | undefined;
    const isOld = typeof blkId === 'number' && blkId < 200_000;
    const tsNs = isOld ? '1700000000000000000' : String(1700000000000000000n + 86_400_000_000_000n);
    return {
      jsonrpc: '2.0',
      id: body.id,
      result: {
        header: {
          height: isOld ? blkId : 200_000, prev_height: 199_999,
          epoch_id: '11111111111111111111111111111111', prev_hash: '11111111111111111111111111111111',
          hash: '11111111111111111111111111111111', timestamp: Number(tsNs), timestamp_nanosec: tsNs,
        },
        chunks: [],
      },
    };
  }
  if (body.method === 'query' && body.params.request_type === 'call_function') {
    const methodName = body.params.method_name as string;
    const args = JSON.parse(Buffer.from(String(body.params.args_base64 ?? ''), 'base64').toString('utf8')) as Record<string, string>;
    if (args.account_id === 'missing.testnet') {
      if (methodName === 'get_account_positions') {
        return { jsonrpc: '2.0', id: body.id, result: { result: enc([]), block_height: 200_000, block_hash: '11111111111111111111111111111111' } };
      }
      return {
        jsonrpc: '2.0',
        id: body.id,
        error: { name: 'HANDLER_ERROR', cause: { name: 'UNKNOWN_ACCOUNT', info: { requested_account_id: 'missing.testnet' } }, data: 'Account missing.testnet does not exist', message: 'Account missing.testnet does not exist' },
      };
    }
    return { jsonrpc: '2.0', id: body.id, result: { result: enc(callFnResult(methodName, args)), block_height: 200_000, block_hash: '11111111111111111111111111111111' } };
  }
  return { jsonrpc: '2.0', id: body.id, result: {} };
}

describe('W28 TestnetStakingAdapter + NearRpcClient + rpcApyProbe JSON-RPC integration', () => {
  it('communicates end-to-end over HTTP JSON-RPC 127.0.0.1:0', async () => {
    const srv = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c as Buffer));
      req.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { id: number; method: string; params: Record<string, unknown> };
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(handleJsonRpcRequest(body)));
      });
    });
    rpcServers.push(srv);
    await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', resolve));
    const rpcUrl = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
    const env = {
      NODE_ENV: 'test', NEAR_MODE: 'testnet', NEAR_ADAPTER_STAKING: 'testnet',
      NEAR_RPC_URL: rpcUrl, NEAR_RPC_FALLBACK_URL: rpcUrl,
      NEAR_CONTRACT_STAKING: 'staking.terraagent.testnet', NEAR_STAKING_POOLS: 'astro-stakers.poolv1.testnet:Astro:900',
    };
    const client = new NearRpcClient(resolveNearNetworkConfig(env, 'testnet'));
    const adapter = new TestnetStakingAdapter(env as never, client as never, rpcApyProbe(client));

    const positions = await adapter.accountPositions('pilot.testnet');
    expect(positions).toHaveLength(1);
    expect(positions[0]).toMatchObject({ pool: 'astro-stakers.poolv1.testnet', staked: nearToYocto(50) });
    expect(await adapter.accountPositions('missing.testnet')).toEqual([]);
    expect(await adapter.lstBalanceOf('pilot.testnet', 'stNEAR')).toBe(nearToYocto(12));
    expect((await adapter.validatorApy()).apyBp).toBeGreaterThan(0);
  });
});
