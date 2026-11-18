import { HOSTED_MCP_TOOLS } from './mcp-tools.registry.js';

export function buildAgentMarketManifest(baseUrl: string) {
  const cleanBase = baseUrl.replace(/\/$/, '');
  return {
    schema: 'https://market.near.ai/schemas/agent-v1.json',
    id: 'terra-agent-autonomous-colony-exchange',
    name: 'TerraAgent Autonomous Colony Exchange',
    version: '1.0.0',
    description:
      'On-chain colony commodity orderbook, NEAR Intents (NEP-413 + NEP-245) atomic settlement, deterministic 1-round RFQ negotiation, and Day-1 staking yield engine.',
    mcp: {
      transport: 'http-jsonrpc-2.0',
      endpoint: `${cleanBase}/v1/mcp`,
      toolsCount: HOSTED_MCP_TOOLS.length,
    },
    auth: {
      scheme: 'bearer',
      tokenPrefix: 'ta_bot_',
      keyManagementUrl: `${cleanBase}/trade.html#keys`,
    },
    protocols: [
      'near-intents-nep413',
      'nep-245-multitoken',
      'near-oneclick-1click',
      'near-mpc-v1-signer',
      'mcp-2025-03-26',
    ],
    endpoints: {
      rfq: `${cleanBase}/v1/trade/agent/rfq`,
      quote: `${cleanBase}/v1/trade/agent/quote`,
      orders: `${cleanBase}/v1/trade/orders`,
      intentsQuote: `${cleanBase}/v1/near/intents/quote`,
      shadeManifest: `${cleanBase}/v1/near/shade-agent/manifest`,
    },
    capabilities: HOSTED_MCP_TOOLS.map((t) => ({ name: t.name, description: t.description })),
  };
}
