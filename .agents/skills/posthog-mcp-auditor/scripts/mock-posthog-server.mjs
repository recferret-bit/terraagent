import { createServer } from 'node:http';

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve({});
      try { resolve(JSON.parse(text)); } catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

export async function startMockPostHogServer(opts = {}) {
  const expectedKey = opts.personalApiKey ?? 'phx_mock_test_key';
  const expectedProject = String(opts.projectId ?? '364100');
  const dashboards = new Map();
  const insights = new Map();
  const batches = [];
  let nextDashId = 1;
  let nextInsId = 1;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method === 'POST' && url.pathname === '/batch/') {
      const body = await readJson(req);
      batches.push(body);
      return sendJson(res, 200, { status: 1 });
    }
    const auth = req.headers.authorization ?? '';
    if (auth !== `Bearer ${expectedKey}`) {
      return sendJson(res, 401, { type: 'authentication_error', code: 'authentication_failed' });
    }
    const base = `/api/projects/${expectedProject}`;
    if (!url.pathname.startsWith(base)) return sendJson(res, 404, { detail: 'Not found' });
    const sub = url.pathname.slice(base.length);

    if (sub === '/dashboards/' && req.method === 'GET') {
      return sendJson(res, 200, { results: [...dashboards.values()], next: null });
    }
    if (sub === '/dashboards/' && req.method === 'POST') {
      const body = await readJson(req);
      const id = nextDashId++;
      const row = { id, ...body, tiles: [] };
      dashboards.set(id, row);
      return sendJson(res, 201, row);
    }
    const dashMatch = /^\/dashboards\/(\d+)\/$/.exec(sub);
    if (dashMatch) {
      const id = Number(dashMatch[1]);
      const existing = dashboards.get(id);
      if (!existing) return sendJson(res, 404, { detail: 'Dashboard not found' });
      if (req.method === 'GET') {
        const storedLayouts = new Map((existing.tiles ?? []).map((t) => [t.id, t.layouts]));
        const tiles = [...insights.values()]
          .filter((ins) => Array.isArray(ins.dashboards) && ins.dashboards.includes(id))
          .map((ins) => ({ id: ins.id, insight: ins, ...(storedLayouts.has(ins.id) ? { layouts: storedLayouts.get(ins.id) } : {}) }));
        return sendJson(res, 200, { ...existing, tiles });
      }
      if (req.method === 'PATCH') {
        const body = await readJson(req);
        const updated = { ...existing, ...body, id };
        dashboards.set(id, updated);
        return sendJson(res, 200, updated);
      }
    }

    if (sub === '/insights/' && req.method === 'GET') {
      return sendJson(res, 200, { results: [...insights.values()], next: null });
    }
    if (sub === '/insights/' && req.method === 'POST') {
      const body = await readJson(req);
      const id = nextInsId++;
      const row = { id, short_id: `ins_${id}`, ...body };
      insights.set(id, row);
      return sendJson(res, 201, row);
    }
    const insMatch = /^\/insights\/(\d+)\/$/.exec(sub);
    if (insMatch) {
      const id = Number(insMatch[1]);
      const existing = insights.get(id);
      if (!existing) return sendJson(res, 404, { detail: 'Insight not found' });
      if (req.method === 'GET') return sendJson(res, 200, existing);
      if (req.method === 'PATCH') {
        const body = await readJson(req);
        const updated = { ...existing, ...body, id };
        insights.set(id, updated);
        return sendJson(res, 200, updated);
      }
    }

    if (sub === '/query/' && req.method === 'POST') {
      const body = await readJson(req);
      const kind = body?.query?.source?.kind ?? body?.query?.kind;
      if (!kind) return sendJson(res, 400, { detail: 'Invalid InsightVizNode query' });
      return sendJson(res, 200, { results: [], hasMore: false, columns: [], types: [], queryKind: kind });
    }

    return sendJson(res, 404, { detail: 'Unknown endpoint' });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  return {
    url: `http://127.0.0.1:${addr.port}`,
    projectId: expectedProject,
    personalApiKey: expectedKey,
    dashboards,
    insights,
    batches,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
