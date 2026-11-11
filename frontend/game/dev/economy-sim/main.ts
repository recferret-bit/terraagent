import './economy-sim.css';
import {
  renderAiBanner,
  renderColonyCards,
  renderDailySeriesTable,
  renderTimeline,
  type EconomySimUiReport,
} from './renderReport';

async function fetchSimReport(method: 'GET' | 'POST', body?: { seed: string; days: number }): Promise<EconomySimUiReport> {
  const urls = method === 'POST' ? ['/v1/economy-sim/run', '/v1/dev/economy-sim/run'] : ['/v1/economy-sim/latest', '/v1/dev/economy-sim/latest'];
  let lastErr = 'Simulation endpoint unreachable';
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.ok) return (await res.json()) as EconomySimUiReport;
      lastErr = `${url}: HTTP ${res.status}`;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(lastErr);
}

function mountEconomySimApp(root: HTMLElement): void {
  root.classList.add('es-wrap');
  const head = document.createElement('header');
  head.className = 'es-head';
  const left = document.createElement('div');
  const eye = document.createElement('p');
  eye.className = 'eyebrow';
  eye.textContent = 'TRACK 05 · 07 · 09 JUDGE HARNESS';
  const h1 = document.createElement('h1');
  h1.className = 'es-title';
  h1.innerHTML = '7-DAY MULTI-AGENT <b>ECONOMY SIM</b>';
  left.append(eye, h1);

  const back = document.createElement('a');
  back.className = 'btn btn-ghost btn-sm';
  back.href = '/';
  back.textContent = '← HUB';
  head.append(left, back);

  const controls = document.createElement('form');
  controls.className = 'es-controls plate-sm';
  const seedLabel = document.createElement('label');
  seedLabel.textContent = 'SEED';
  const seedInput = document.createElement('input');
  seedInput.type = 'text';
  seedInput.value = new URLSearchParams(location.search).get('seed') ?? 'near-hackathon-7d';
  seedInput.dataset.testid = 'econ-sim-seed';
  seedLabel.appendChild(seedInput);

  const daysLabel = document.createElement('label');
  daysLabel.textContent = 'DAYS';
  const daysInput = document.createElement('input');
  daysInput.type = 'number';
  daysInput.min = '1';
  daysInput.max = '14';
  daysInput.value = '7';
  daysInput.dataset.testid = 'econ-sim-days';
  daysLabel.appendChild(daysInput);

  const runBtn = document.createElement('button');
  runBtn.type = 'submit';
  runBtn.className = 'btn btn-primary btn-sm';
  runBtn.dataset.testid = 'econ-sim-run';
  runBtn.textContent = 'FAST-FORWARD 7 DAYS';

  const statusEl = document.createElement('span');
  statusEl.className = 'es-event__meta';
  statusEl.dataset.testid = 'econ-sim-status';
  statusEl.textContent = 'Ready';
  controls.append(seedLabel, daysLabel, runBtn, statusEl);

  const output = document.createElement('div');
  output.style.display = 'flex';
  output.style.flexDirection = 'column';
  output.style.gap = '16px';
  root.append(head, controls, output);

  const render = (report: EconomySimUiReport) => {
    output.replaceChildren(
      renderAiBanner(report),
      renderColonyCards(report),
      renderDailySeriesTable(report),
      renderTimeline(report),
    );
  };

  const execute = async (post: boolean) => {
    runBtn.disabled = true;
    statusEl.textContent = 'Running 7-day multi-agent simulation…';
    try {
      const report = post
        ? await fetchSimReport('POST', { seed: seedInput.value.trim() || 'near-hackathon-7d', days: Number(daysInput.value) || 7 })
        : await fetchSimReport('GET');
      render(report);
      statusEl.textContent = `Completed ${report.days}d sim in ${report.durationMs}ms`;
    } catch (e) {
      statusEl.textContent = `Error: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      runBtn.disabled = false;
    }
  };

  controls.addEventListener('submit', (ev) => {
    ev.preventDefault();
    void execute(true);
  });
  void execute(true);
}

const root = document.getElementById('econ-sim-app');
if (root) mountEconomySimApp(root);
