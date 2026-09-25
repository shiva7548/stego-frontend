/* ============================================================
   Steganalysis Forensic Scanner — Frontend JavaScript
   Backend URL is hardcoded — no manual input needed.
   ============================================================ */

const BACKEND = "https://stego-backend-rxnw.onrender.com";

// ---- Chart instance ----
let probChart = null;

// ============================================================
// Tab switching
// ============================================================
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(p => p.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.getElementById('panel-' + tab).classList.add('active');
}

// ============================================================
// Backend health check — auto-wake Render on page load
// ============================================================
async function checkBackend() {
  const dot  = document.getElementById('status-dot');
  const text = document.getElementById('status-text');
  dot.className  = 'status-dot waking';
  text.textContent = 'Waking backend…';

  try {
    const res = await fetch(BACKEND + '/health', { signal: AbortSignal.timeout(30000) });
    const data = await res.json();
    if (data.model_loaded) {
      dot.className    = 'status-dot online';
      text.textContent = 'Backend ready ✓';
    } else {
      dot.className    = 'status-dot offline';
      text.textContent = 'Backend: model not loaded';
    }
  } catch (e) {
    dot.className    = 'status-dot offline';
    text.textContent = 'Backend offline — refresh to retry';
  }
}

// ============================================================
// Single image — file selection
// ============================================================
function onFileSelected(input) {
  const file = input.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  const img = document.getElementById('preview-img');
  img.src = url;
  img.style.display = 'block';
  document.getElementById('upload-placeholder').style.display = 'none';
  // Reset old results
  clearSingleResults();
}

function clearSingleResults() {
  document.getElementById('single-verdict-wrap').style.display  = 'none';
  document.getElementById('single-metrics-wrap').style.display  = 'none';
  document.getElementById('chart-panel').style.display          = 'none';
  document.getElementById('summary-wrap').style.display         = 'none';
  document.getElementById('single-loading').style.display       = 'none';
}

// ============================================================
// Single image — run analysis
// ============================================================
async function runSingle() {
  const input = document.getElementById('file-input');
  if (!input.files.length) {
    alert('Please select an image first.');
    return;
  }

  clearSingleResults();
  document.getElementById('single-loading').style.display = 'flex';

  const formData = new FormData();
  formData.append('file', input.files[0]);

  try {
    const res = await fetch(BACKEND + '/predict', {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(60000),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error('API error ' + res.status + ': ' + errText);
    }

    const data = await res.json();
    renderSingleResult(data);

  } catch (err) {
    document.getElementById('single-loading').style.display = 'none';
    const vw = document.getElementById('single-verdict-wrap');
    const vd = document.getElementById('single-verdict');
    vd.className     = 'verdict verdict-error';
    vd.textContent   = 'Error: ' + err.message;
    vw.style.display = 'block';
  }
}

// ============================================================
// Single image — render result (same layout as Gradio)
// ============================================================
function renderSingleResult(data) {
  document.getElementById('single-loading').style.display = 'none';

  // -- Verdict badge (mirrors badge_html) --
  const vd = document.getElementById('single-verdict');
  const vw = document.getElementById('single-verdict-wrap');
  const isCover = data.is_cover;

  const shieldClean = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
    stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 3l7 3v5c0 4.6-3 8.3-7 9.6-4-1.3-7-5-7-9.6V6z"/>
    <path d="M9 12l2.2 2.2L15.5 10"/></svg>`;

  const shieldStego = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
    stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 3l7 3v5c0 4.6-3 8.3-7 9.6-4-1.3-7-5-7-9.6V6z"/>
    <path d="M12 9v4.5M12 16.6v.1"/></svg>`;

  vd.className = 'verdict ' + (isCover ? 'verdict-clean' : 'verdict-stego');
  vd.innerHTML = `<span style="display:inline-flex">${isCover ? shieldClean : shieldStego}</span>
                  <span>${escHtml(data.headline)}</span>`;
  vw.style.display = 'block';

  // -- Metric cards (mirrors metrics_html) --
  const mw = document.getElementById('single-metrics-wrap');
  const conf   = (data.confidence    * 100).toFixed(2);
  const clean  = (data.p_clean       * 100).toFixed(2);
  const threat = (data.total_threat  * 100).toFixed(2);

  document.getElementById('m-conf').innerHTML   = conf   + '<span class="metric-unit">%</span>';
  document.getElementById('m-clean').innerHTML  = clean  + '<span class="metric-unit">%</span>';
  document.getElementById('m-threat').innerHTML = threat + '<span class="metric-unit">%</span>';

  document.getElementById('mf-conf').style.width   = conf   + '%';
  document.getElementById('mf-clean').style.width  = clean  + '%';
  document.getElementById('mf-threat').style.width = threat + '%';

  mw.style.display = 'grid';

  // -- Bar chart (mirrors BarPlot) --
  const probs = data.probs;
  const labels = Object.keys(probs);
  const values = labels.map(l => probs[l]);
  const colors = { Cover: '#0f9d58', JMiPOD: '#2f6bff', JUNIWARD: '#d92d43', UERD: '#f59e0b' };

  document.getElementById('chart-panel').style.display = 'block';
  const ctx = document.getElementById('prob-chart').getContext('2d');
  if (probChart) probChart.destroy();
  probChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: labels.map(l => colors[l] || '#6366f1'),
        borderRadius: 6,
        borderSkipped: false,
      }]
    },
    options: {
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => (ctx.parsed.y * 100).toFixed(2) + '%'
          }
        }
      },
      scales: {
        y: {
          min: 0, max: 1,
          ticks: { callback: v => (v * 100) + '%' },
          title: { display: true, text: 'Probability' }
        }
      }
    }
  });

  // -- Forensic summary (mirrors summary_html) --
  document.getElementById('summary-headline').textContent = data.verdict;
  document.getElementById('summary-body').textContent     = data.explanation;

  const tbody = document.getElementById('prob-table-body');
  tbody.innerHTML = labels.map(label =>
    `<tr>
      <td>${escHtml(label)}</td>
      <td class="num">${(probs[label] * 100).toFixed(2)}%</td>
      <td class="num">${probs[label].toFixed(4)}</td>
    </tr>`
  ).join('');

  document.getElementById('summary-wrap').style.display = 'block';
}

// ============================================================
// Batch — file selection
// ============================================================
let batchFiles = [];

function onBatchFilesSelected(input) {
  batchFiles = Array.from(input.files).slice(0, 20);
  const placeholder = document.getElementById('batch-placeholder');
  const listEl      = document.getElementById('batch-file-list');

  if (batchFiles.length) {
    placeholder.style.display = 'none';
    listEl.innerHTML = batchFiles.map(f =>
      `<span class="batch-file-chip">${escHtml(f.name)}</span>`
    ).join('');
  } else {
    placeholder.style.display = 'flex';
    listEl.innerHTML = '';
  }

  document.getElementById('batch-results-wrap').style.display = 'none';
}

// ============================================================
// Batch — run scan
// ============================================================
async function runBatch() {
  if (!batchFiles.length) {
    alert('Please select at least one JPEG file.');
    return;
  }

  document.getElementById('batch-results-wrap').style.display = 'none';
  const loadingEl = document.getElementById('batch-loading');
  const loadText  = document.getElementById('batch-loading-text');
  loadingEl.style.display = 'flex';

  const rows    = [];
  const results = [];
  let failed    = 0;

  for (let i = 0; i < batchFiles.length; i++) {
    const file = batchFiles[i];
    loadText.textContent = `Scanning ${i + 1} of ${batchFiles.length}: ${file.name}`;

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch(BACKEND + '/predict', {
        method: 'POST',
        body: formData,
        signal: AbortSignal.timeout(60000),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      results.push(data);
      rows.push({
        file:      file.name,
        verdict:   data.headline,
        topAlgo:   data.dominant_algo + ' ' + (data.dominant_score * 100).toFixed(2) + '%',
        conf:      (data.confidence   * 100).toFixed(2) + '%',
        cover:     (data.p_clean      * 100).toFixed(2),
        jmipod:    (data.probs.JMiPOD  * 100).toFixed(2),
        juniward:  (data.probs.JUNIWARD * 100).toFixed(2),
        uerd:      (data.probs.UERD     * 100).toFixed(2),
        isCover:   data.is_cover,
      });
    } catch (err) {
      failed++;
      rows.push({
        file: file.name, verdict: 'FAILED', topAlgo: '', conf: '',
        cover: '', jmipod: '', juniward: '', uerd: '', isCover: false, error: err.message,
      });
    }
  }

  loadingEl.style.display = 'none';
  renderBatchResults(rows, results, failed);
}

// ============================================================
// Batch — render results
// ============================================================
function renderBatchResults(rows, results, failed) {
  // Table
  const tbody = document.getElementById('batch-table-body');
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${escHtml(r.file)}</td>
      <td><strong>${escHtml(r.verdict)}</strong></td>
      <td>${escHtml(r.topAlgo)}</td>
      <td>${escHtml(r.conf)}</td>
      <td>${escHtml(r.cover)}</td>
      <td>${escHtml(r.jmipod)}</td>
      <td>${escHtml(r.juniward)}</td>
      <td>${escHtml(r.uerd)}</td>
    </tr>`
  ).join('');

  // Overview cards (mirrors batch_summary in Gradio)
  const cover = results.filter(r => r.is_cover).length;
  const stego = results.length - cover;
  const headline = `${rows.length} file(s) scanned · ${cover} clean · ${stego} stego` +
                   (failed ? ` · ${failed} failed` : '');

  const cards = results.map(r => `
    <div class="batch-card ${r.is_cover ? 'batch-clean' : 'batch-stego'}">
      <div class="batch-file">${escHtml(r.filename || '')}</div>
      <div class="batch-verdict">${escHtml(r.headline)}</div>
      <div class="batch-metrics">confidence ${(r.confidence * 100).toFixed(2)}% · clean ${(r.p_clean * 100).toFixed(2)}% · threat ${(r.total_threat * 100).toFixed(2)}%</div>
      <div class="batch-metrics">top algorithm ${escHtml(r.dominant_algo)} ${(r.dominant_score * 100).toFixed(2)}%</div>
    </div>`
  ).join('');

  document.getElementById('batch-overview').innerHTML = `
    <div class="summary">
      <div class="summary-headline">${escHtml(headline)}</div>
      ${cards}
    </div>`;

  document.getElementById('batch-results-wrap').style.display = 'block';
}

// ============================================================
// Helpers
// ============================================================
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ============================================================
// Init — wake the backend as soon as the page loads
// ============================================================
window.addEventListener('DOMContentLoaded', () => {
  checkBackend();
});
