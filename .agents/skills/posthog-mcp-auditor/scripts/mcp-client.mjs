import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

/** Lightweight stdio JSON-RPC 2.0 client for MCP servers. */
export async function connectMcp({ command, args = [], env = {} }) {
  const child = spawn(command, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
  });

  let nextId = 1;
  const pending = new Map();
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr = `${stderr}${chunk.toString('utf8')}`.slice(-2000);
  });

  const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg;
    try { msg = JSON.parse(trimmed); } catch { return; }
    if (msg.id === undefined || !pending.has(msg.id)) return;
    const entry = pending.get(msg.id);
    pending.delete(msg.id);
    clearTimeout(entry.timer);
    if (msg.error) entry.reject(new Error(msg.error.message || 'MCP error'));
    else entry.resolve(msg.result);
  });

  child.on('exit', (code) => {
    for (const [, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(`MCP server exited (${code}): ${stderr}`));
    }
    pending.clear();
  });

  function request(method, params = {}, timeoutMs = 30_000) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`MCP ${method} timed out`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  return {
    async initialize() {
      const res = await request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'terra-posthog-auditor', version: '0.1.0' },
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`);
      return res;
    },
    async listTools() {
      const res = await request('tools/list', {});
      return res.tools ?? [];
    },
    async callTool(name, argumentsObj = {}) {
      const res = await request('tools/call', { name, arguments: argumentsObj });
      const text = res?.content?.find((item) => item.type === 'text')?.text ?? '{}';
      if (res?.isError) throw new Error(`MCP tool ${name} failed: ${text}`);
      if (res?.structuredContent !== undefined) return res.structuredContent;
      if (!text.trim()) return {};
      try { return JSON.parse(text); } catch { return text; }
    },
    async close() {
      rl.close();
      child.kill();
    },
  };
}
