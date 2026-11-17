// Score panel rendering (DOM). Browser only.

import { CONFIG } from './config.js';
import { state } from './state.js';

const CATEGORY_LABEL = {
  geometry: 'Framing & pose',
  exposure: 'Exposure, color & background',
  face: 'Face details',
};

export function renderScorePanel(container, analysis) {
  container.replaceChildren();

  const overall = document.createElement('div');
  overall.className = 'overall';
  const chip = document.createElement('span');
  chip.className = 'chip ' + chipClass(analysis.overall);
  chip.textContent = analysis.overall === null ? 'N/A' : `${analysis.overall}%`;
  const title = document.createElement('span');
  title.textContent = 'Overall ICAO score';
  overall.append(chip, title);
  container.append(overall);

  for (const note of analysis.notes) {
    const n = document.createElement('div');
    n.className = 'note';
    n.textContent = note;
    container.append(n);
  }

  let lastCat = null;
  for (const r of analysis.results) {
    if (r.category !== lastCat) {
      const h = document.createElement('h3');
      h.textContent = CATEGORY_LABEL[r.category];
      container.append(h);
      lastCat = r.category;
    }
    container.append(scoreRow(r));
  }

  // manual checks
  const h = document.createElement('h3');
  h.textContent = 'Check manually';
  container.append(h);
  const hint = document.createElement('div');
  hint.className = 'note';
  hint.textContent = 'These cannot be scored automatically. Confirm each by eye.';
  container.append(hint);
  for (const mc of analysis.manualChecks) {
    const row = document.createElement('label');
    row.className = 'manual-row';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = !!state.manualChecks[mc.id];
    box.addEventListener('change', () => { state.manualChecks[mc.id] = box.checked; });
    const txt = document.createElement('span');
    txt.innerHTML = `<strong>${esc(mc.label)}</strong> — ${esc(mc.text)}`;
    row.append(box, txt);
    container.append(row);
  }
}

function scoreRow(r) {
  const row = document.createElement('details');
  row.className = 'score-row ' + r.state;

  const summary = document.createElement('summary');
  const label = document.createElement('span');
  label.className = 'score-label';
  label.textContent = r.label;

  const barWrap = document.createElement('span');
  barWrap.className = 'bar';
  const bar = document.createElement('span');
  bar.className = 'bar-fill';
  bar.style.width = `${r.score ?? 0}%`;
  barWrap.append(bar);

  const val = document.createElement('span');
  val.className = 'score-val';
  val.textContent = r.score === null ? 'N/A' : `${r.score}%`;

  summary.append(label, barWrap, val);
  row.append(summary);

  const detail = document.createElement('div');
  detail.className = 'score-detail';
  const d = document.createElement('p');
  d.textContent = r.detail;
  const g = document.createElement('p');
  g.className = 'guide';
  g.textContent = 'Guideline: ' + r.guideline;
  detail.append(d, g);
  row.append(detail);
  return row;
}

function chipClass(score) {
  if (score === null) return 'na';
  if (score >= CONFIG.passScore) return 'pass';
  if (score >= CONFIG.warnScore) return 'warn';
  return 'fail';
}

function esc(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
