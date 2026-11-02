// curl --resolve host:80:127.0.0.1. A websocket upgrade may time out after status 101; that exit is accepted.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function curl(host, path, opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ta-curl-'));
  const headerFile = join(dir, 'headers');
  const bodyFile = join(dir, 'body');
  try {
    const r = spawnSync('curl', curlArgs(host, path, opts, headerFile, bodyFile), { encoding: 'utf8' });
    const rawHeaders = readText(headerFile);
    const status = httpStatus(rawHeaders);
    const timedOut = r.status === 28;
    if ((r.status ?? 1) !== 0 && !(timedOut && opts.allowTimeout && status)) {
      throw new Error((r.stderr || `curl ${host}${path} exited ${r.status}`).trim());
    }
    return { status, body: readText(bodyFile), rawHeaders, header: (name) => headerValue(rawHeaders, name) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function curlArgs(host, path, opts, headerFile, bodyFile) {
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

function readText(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function httpStatus(raw) {
  const line = raw.split(/\r?\n/).find((row) => row.startsWith('HTTP/'));
  const status = Number(line?.split(/\s+/)[1]);
  return Number.isInteger(status) ? status : 0;
}

function headerValue(raw, name) {
  const want = name.toLowerCase();
  let value = null;
  for (const line of raw.split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0 && line.slice(0, i).trim().toLowerCase() === want) value = line.slice(i + 1).trim();
  }
  return value;
}
