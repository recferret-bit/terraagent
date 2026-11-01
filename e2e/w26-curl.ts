// curl --resolve host:80:127.0.0.1. Same flags as scripts/sites/curl.mjs.
// A websocket upgrade may time out after status 101; that exit is accepted.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface CurlResult {
  status: number;
  body: string;
  rawHeaders: string;
}

export interface CurlOpts {
  headers?: string[];
  maxTime?: number;
  allowTimeout?: boolean;
}

export function curlResolve(host: string, path: string, opts: CurlOpts = {}): CurlResult {
  const dir = mkdtempSync(join(tmpdir(), 'ta-curl-'));
  const headerFile = join(dir, 'headers');
  const bodyFile = join(dir, 'body');
  try {
    const result = spawnSync('curl', curlArgs(host, path, opts, headerFile, bodyFile), { encoding: 'utf8' });
    const rawHeaders = readText(headerFile);
    const status = httpStatus(rawHeaders);
    const timedOut = result.status === 28;
    if ((result.status ?? 1) !== 0 && !(timedOut && opts.allowTimeout && status)) {
      throw new Error((result.stderr || `curl ${host}${path} exited ${result.status}`).trim());
    }
    return { status, body: readText(bodyFile), rawHeaders };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function curlArgs(host: string, path: string, opts: CurlOpts, headerFile: string, bodyFile: string): string[] {
  return [
    '--silent',
    '--show-error',
    '--http1.1',
    '--max-time',
    String(opts.maxTime ?? 20),
    '--resolve',
    `${host}:80:127.0.0.1`,
    '-D',
    headerFile,
    '-o',
    bodyFile,
    ...(opts.headers ?? []).flatMap((header) => ['-H', header]),
    `http://${host}${path}`,
  ];
}

function readText(file: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function httpStatus(raw: string): number {
  const line = raw.split(/\r?\n/).find((row) => row.startsWith('HTTP/'));
  const status = Number(line?.split(/\s+/)[1]);
  return Number.isInteger(status) ? status : 0;
}
