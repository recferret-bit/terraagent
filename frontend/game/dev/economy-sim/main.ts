import './economy-sim.css';
import {
  renderAiBanner,
  renderColonyCards,
  renderContractorReceiptsSection,
  renderDailySeriesTable,
  renderSwarmRoundsSection,
  renderTimeline,
  type EconomySimUiReport,
} from './renderReport';

async function fetchSimReport(
  method: 'GET' | 'POST',
  body?: { seed: string; days: number; useLiveLlm?: boolean },
): Promise<EconomySimUiReport> {
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

function buildEconomySimHeader(): HTMLElement {
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
  return head;
}

interface SimControlsRefs {
  readonly form: HTMLFormElement;
  readonly seedInput: HTMLInputElement;
  readonly daysInput: HTMLInputElement;
  readonly modeSelect: HTMLSelectElement;
  readonly runBtn: HTMLButtonElement;
  readonly statusEl: HTMLSpanElement;
}

function buildEconomySimControls(): SimControlsRefs {
  const form = document.createElement('form');
  form.className = 'es-controls plate-sm';
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

  const modeLabel = document.createElement('label');
  modeLabel.textContent = 'ENGINE';
  const modeSelect = document.createElement('select');
  modeSelect.dataset.testid = 'econ-sim-mode';
  const optLive = document.createElement('option');
  optLive.value = 'live';
  optLive.textContent = 'NEAR.AI TEE + Scripted Swarm';
  const optZeroLlm = document.createElement('option');
  optZeroLlm.value = 'scripted';
  optZeroLlm.textContent = 'Zero-LLM Scripted Only';
  if (new URLSearchParams(location.search).get('llm') === '0') optZeroLlm.selected = true;
  modeSelect.append(optLive, optZeroLlm);
  modeLabel.appendChild(modeSelect);

  const runBtn = document.createElement('button');
  runBtn.type = 'submit';
  runBtn.className = 'btn btn-primary btn-sm';
  runBtn.dataset.testid = 'econ-sim-run';
  runBtn.textContent = 'FAST-FORWARD 7 DAYS';

  const statusEl = document.createElement('span');
  statusEl.className = 'es-event__meta';
  statusEl.dataset.testid = 'econ-sim-status';
  statusEl.textContent = 'Ready';
  form.append(seedLabel, daysLabel, modeLabel, runBtn, statusEl);
  return { form, seedInput, daysInput, modeSelect, runBtn, statusEl };
}

function mountEconomySimApp(root: HTMLElement): void {
  root.classList.add('es-wrap');
  const head = buildEconomySimHeader();
  const { form: controls, seedInput, daysInput, modeSelect, runBtn, statusEl } = buildEconomySimControls();

  const output = document.createElement('div');
  output.style.display = 'flex';
  output.style.flexDirection = 'column';
  output.style.gap = '16px';
  root.append(head, controls, output);

  const render = (report: EconomySimUiReport) => {
    const sections: HTMLElement[] = [
      renderAiBanner(report),
      renderColonyCards(report),
      renderDailySeriesTable(report),
    ];
    if (report.swarm) sections.push(renderSwarmRoundsSection(report.swarm));
    if (report.agentCommerce) sections.push(renderContractorReceiptsSection(report.agentCommerce));
    sections.push(renderTimeline(report));
    output.replaceChildren(...sections);
  };

  const execute = async (post: boolean) => {
    runBtn.disabled = true;
    statusEl.textContent = 'Running 7-day multi-agent simulation…';
    try {
      const report = post
        ? await fetchSimReport('POST', {
            seed: seedInput.value.trim() || 'near-hackathon-7d',
            days: Number(daysInput.value) || 7,
            useLiveLlm: modeSelect.value !== 'scripted',
          })
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
