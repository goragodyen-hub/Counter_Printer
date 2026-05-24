/* =====================================================================
   Counter Printer Tracker — app.js
   ===================================================================== */

// ─── State ────────────────────────────────────────────────────────────────────
let printers = [];
let records  = [];
let stats    = {};
let allMonths = [];
let activeZone = 'ทั้งหมด';
let chartMonthly = null;
let chartCompare = null;
let gsheetsUrl = 'https://script.google.com/macros/s/AKfycbzOcGOSTqfKxYs1P9kgjB7IlOHTMAHyhPcrFy1qesT5KKDIbSRYCRA22BBJ6xO7h5mcMg/exec';

const ZONES = ['มัธยม', 'ประถม', 'อนุบาล', 'ห้องปฏิบัติการ'];
const ZONE_COLORS = {
  'มัธยม':         '#7c3aed',
  'ประถม':         '#06b6d4',
  'อนุบาล':        '#10b981',
  'ห้องปฏิบัติการ': '#f59e0b',
};

// ─── Init ─────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  updateCurrentDate();
  await fetchAll();
  setupMonthSelects();
  showPage('dashboard');
});

async function fetchAll() {
  const [printersData, recordsData] = await Promise.all([
    fetch('data/printers.json').then(r => r.json()),
    fetch('data/records.json').then(r => r.json()),
  ]);
  printers = printersData.printers;
  records = recordsData.records;
  computeStats();
}

function computeStats() {
  const months = [...new Set(records.map(r => r.month))].sort();
  allMonths = months;
  stats = {};
  for (const month of months) {
    stats[month] = {};
    for (const printer of printers) {
      const rec = records.find(r => r.printerId === printer.id && r.month === month);
      if (!rec) continue;
      const monthIdx = months.indexOf(month);
      let usedBW = null;
      let usedColor = null;
      if (monthIdx > 0) {
        const prevMonth = months[monthIdx - 1];
        const prevRec = records.find(r => r.printerId === printer.id && r.month === prevMonth);
        if (prevRec) {
          usedBW = rec.counterBW - prevRec.counterBW;
          usedColor = rec.counterColor - prevRec.counterColor;
        }
      }
      const counterBW = rec.counterBW !== undefined ? rec.counterBW : (rec.counter || 0);
      const counterColor = rec.counterColor !== undefined ? rec.counterColor : 0;
      stats[month][printer.id] = { counterBW, counterColor, usedBW, usedColor, recordedAt: rec.recordedAt };
    }
  }
}

// ─── Navigation ───────────────────────────────────────────────────────────────
function showPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`page-${page}`).classList.add('active');
  document.getElementById(`nav-${page}`).classList.add('active');

  if (page === 'dashboard') loadDashboard();
  if (page === 'record')    initRecordPage();
  if (page === 'history')   loadHistory();
  if (page === 'settings')  loadSettings();

  // Close sidebar on mobile
  document.getElementById('sidebar').classList.remove('open');
  return false;
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
async function loadDashboard() {
  await fetchAll();
  const selMonth = document.getElementById('dash-month-select').value || latestMonth();
  renderSummaryCards(selMonth);
  renderZoneTabs();
  renderPrinterGrid(selMonth);
  renderCharts();
}

function latestMonth() {
  return allMonths.length ? allMonths[allMonths.length - 1] : currentYearMonth();
}

function renderSummaryCards(month) {
  const monthStats = stats[month] || {};
  const totalPrinters = printers.length;
  const recorded = Object.keys(monthStats).length;
  const totalCounterBW = Object.values(monthStats).reduce((s, v) => s + (v.counterBW || 0), 0);
  const totalCounterColor = Object.values(monthStats).reduce((s, v) => s + (v.counterColor || 0), 0);
  const totalUsedBW = Object.values(monthStats).reduce((s, v) => s + (v.usedBW || 0), 0);
  const totalUsedColor = Object.values(monthStats).reduce((s, v) => s + (v.usedColor || 0), 0);

  const el = document.getElementById('summary-cards');
  el.innerHTML = `
    <div class="summary-card purple" onclick="showOverallDetail()" style="cursor:pointer">
      <div class="card-label">เครื่องพิมพ์ทั้งหมด</div>
      <div class="card-value" style="color:#a855f7">${totalPrinters}</div>
      <div class="card-sub">เครื่อง</div>
    </div>
    <div class="summary-card cyan" onclick="showOverallDetail()" style="cursor:pointer">
      <div class="card-label">บันทึกแล้วเดือนนี้</div>
      <div class="card-value" style="color:#06b6d4">${recorded}</div>
      <div class="card-sub">จาก ${totalPrinters} เครื่อง</div>
    </div>
    <div class="summary-card green" onclick="showOverallDetail()" style="cursor:pointer">
      <div class="card-label">ใช้ไปเดือนนี้ (B&W)</div>
      <div class="card-value" style="color:#10b981">${totalUsedBW > 0 ? fmtNum(totalUsedBW) : '—'}</div>
      <div class="card-sub">แผ่น</div>
    </div>
    <div class="summary-card orange" onclick="showOverallDetail()" style="cursor:pointer">
      <div class="card-label">ใช้ไปเดือนนี้ (สี)</div>
      <div class="card-value" style="color:#f59e0b">${totalUsedColor > 0 ? fmtNum(totalUsedColor) : '—'}</div>
      <div class="card-sub">แผ่น</div>
    </div>
  `;
}

function renderZoneTabs() {
  const el = document.getElementById('zone-tabs');
  const zones = ['ทั้งหมด', ...ZONES];
  el.innerHTML = zones.map(z => `
    <button class="zone-tab ${z === activeZone ? 'active' : ''}"
            onclick="setZone('${z}')">${z}</button>
  `).join('');
}

function setZone(zone) {
  activeZone = zone;
  renderZoneTabs();
  const month = document.getElementById('dash-month-select').value || latestMonth();
  renderPrinterGrid(month);
}

function renderPrinterGrid(month) {
  const monthStats = stats[month] || {};
  const filtered = activeZone === 'ทั้งหมด'
    ? printers
    : printers.filter(p => p.zone === activeZone);

  const el = document.getElementById('printer-grid');
  if (!filtered.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><p>ไม่พบเครื่องพิมพ์ในแผนกนี้</p></div>`;
    return;
  }

  el.innerHTML = filtered.map(p => {
    const st = monthStats[p.id];
    const counterBW = st ? st.counterBW : null;
    const counterColor = st ? st.counterColor : null;
    const usedBW = st ? st.usedBW : null;
    const usedColor = st ? st.usedColor : null;
    const typeBadge = p.type === 'สี'
      ? `<span class="printer-type-badge badge-color">🎨 สี</span>`
      : `<span class="printer-type-badge badge-bw">⬛ ขาวดำ</span>`;

    let usedBWHtml = '';
    if (usedBW === null || usedBW === undefined) usedBWHtml = `<span class="used-badge none">— ไม่มีข้อมูลเดิม</span>`;
    else if (usedBW < 0) usedBWHtml = `<span class="used-badge err">⚠️ ${fmtNum(usedBW)}</span>`;
    else usedBWHtml = `<span class="used-badge up">▲ ${fmtNum(usedBW)} แผ่น</span>`;

    let usedColorHtml = '';
    if (usedColor === null || usedColor === undefined) usedColorHtml = `<span class="used-badge none">— ไม่มีข้อมูลเดิม</span>`;
    else if (usedColor < 0) usedColorHtml = `<span class="used-badge err">⚠️ ${fmtNum(usedColor)}</span>`;
    else usedColorHtml = `<span class="used-badge up" style="color:#f59e0b">▲ ${fmtNum(usedColor)} แผ่น</span>`;

    const noteHtml = p.note ? `<div class="printer-note-text">⚠️ ${p.note}</div>` : '';

    return `
      <div class="printer-card" onclick="openPrinterDetail('${p.id}')" style="cursor:pointer">
        <div class="printer-card-header">
          <span style="font-size:0.7rem;color:var(--text-muted)">${p.zone}</span>
          ${typeBadge}
        </div>
        <div class="printer-location">${p.location}</div>
        <div class="printer-ip">${p.ip || ''} ${p.serial ? '· ' + p.serial : ''}</div>
        <div class="printer-counter-row">
          <div>
            <div class="counter-label">⬛ ขาวดำ ล่าสุด</div>
            <div class="counter-value">${counterBW !== null ? fmtNum(counterBW) : '—'}</div>
          </div>
          ${usedBWHtml}
        </div>
        <div class="printer-counter-row" style="margin-top:8px">
          <div>
            <div class="counter-label">🎨 สี ล่าสุด</div>
            <div class="counter-value" style="color:#f59e0b">${counterColor !== null ? fmtNum(counterColor) : '—'}</div>
          </div>
          ${usedColorHtml}
        </div>
        ${noteHtml}
      </div>
    `;
  }).join('');
}

function renderCharts() {
  // Monthly total usage bar chart - separate BW and Color
  const months6 = allMonths.slice(-6);
  const totalBWByMonth = months6.map(m => {
    return Object.values(stats[m] || {}).reduce((s, v) => s + (v.usedBW ?? v.counterBW ?? 0), 0);
  });
  const totalColorByMonth = months6.map(m => {
    return Object.values(stats[m] || {}).reduce((s, v) => s + (v.usedColor ?? v.counterColor ?? 0), 0);
  });

  const ctx1 = document.getElementById('chart-monthly');
  if (chartMonthly) chartMonthly.destroy();
  chartMonthly = new Chart(ctx1, {
    type: 'bar',
    data: {
      labels: months6.map(m => thMonth(m)),
      datasets: [
        {
          label: 'ขาวดำ (แผ่น/เดือน)',
          data: totalBWByMonth,
          backgroundColor: 'rgba(100,100,100,0.6)',
          borderColor: '#666',
          borderWidth: 2,
          borderRadius: 6,
        },
        {
          label: 'สี (แผ่น/เดือน)',
          data: totalColorByMonth,
          backgroundColor: 'rgba(245,158,11,0.6)',
          borderColor: '#f59e0b',
          borderWidth: 2,
          borderRadius: 6,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: true, labels: { color: '#94a3b8', font: { family: 'Noto Sans Thai' } } } },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8', font: { family: 'Noto Sans Thai' } } },
        y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8', font: { family: 'Noto Sans Thai' } } }
      }
    }
  });

  // Compare per printer (latest month)
  const latM = latestMonth();
  const latStats = stats[latM] || {};
  const pList = printers.filter(p => latStats[p.id] && ((latStats[p.id].counterBW || 0) > 0 || (latStats[p.id].counterColor || 0) > 0));
  pList.sort((a, b) => ((latStats[b.id].counterBW || 0) + (latStats[b.id].counterColor || 0)) - ((latStats[a.id].counterBW || 0) + (latStats[a.id].counterColor || 0)));
  const top10 = pList.slice(0, 10);

  const ctx2 = document.getElementById('chart-compare');
  if (chartCompare) chartCompare.destroy();
  chartCompare = new Chart(ctx2, {
    type: 'bar',
    data: {
      labels: top10.map(p => p.location.replace(/\s*\(.*?\)\s*/g, ' ').trim()),
      datasets: [{
        label: 'ขาวดำ',
        data: top10.map(p => latStats[p.id]?.counterBW || 0),
        backgroundColor: 'rgba(100,100,100,0.7)',
        borderColor: '#666',
        borderWidth: 2,
        borderRadius: 6,
      },
      {
        label: 'สี',
        data: top10.map(p => latStats[p.id]?.counterColor || 0),
        backgroundColor: 'rgba(245,158,11,0.7)',
        borderColor: '#f59e0b',
        borderWidth: 2,
        borderRadius: 6,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: { legend: { display: true, labels: { color: '#94a3b8', font: { family: 'Noto Sans Thai' } } } },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8', font: { family: 'Noto Sans Thai' } } },
        y: { grid: { color: 'transparent' }, ticks: { color: '#94a3b8', font: { family: 'Noto Sans Thai', size: 11 } } }
      }
    }
  });
}

// ─── Record Page ──────────────────────────────────────────────────────────────
function initRecordPage() {
  const mi = document.getElementById('record-month');
  if (!mi.value) mi.value = currentYearMonth();
}

async function loadRecordForm() {
  const month = document.getElementById('record-month').value;
  if (!month) return showToast('กรุณาเลือกเดือน', 'error');

  await fetchAll();
  const monthStats = stats[month] || {};

  // Build form grouped by zone
  const zones = [...new Set(printers.map(p => p.zone))];
  let html = `<table class="record-table">
    <thead><tr>
      <th>ห้อง / สถานที่</th>
      <th>IP / Serial</th>
      <th>⬛ ขาวดำ เดิม</th>
      <th>⬛ ขาวดำ ใหม่</th>
      <th>ใช้ไป (B&W)</th>
      <th>🎨 สี เดิม</th>
      <th>🎨 สี ใหม่</th>
      <th>ใช้ไป (สี)</th>
      <th>หมายเหตุ</th>
    </tr></thead>
    <tbody id="record-tbody">`;

  for (const zone of zones) {
    const zPrinters = printers.filter(p => p.zone === zone);
    html += `<tr class="zone-group-row"><td colspan="9">▪ ${zone}</td></tr>`;
    for (const p of zPrinters) {
      const st = monthStats[p.id];
      const prevBWCounter = st && st.counterBW !== undefined ? st.counterBW : null;
      const prevColorCounter = st && st.counterColor !== undefined ? st.counterColor : null;
      const prevBWVal = prevBWCounter !== null ? prevBWCounter : '';
      const prevColorVal = prevColorCounter !== null ? prevColorCounter : '';
      html += `
        <tr>
          <td>
            <div style="font-weight:500">${p.location}</div>
            <div style="font-size:0.7rem;color:var(--text-muted)">${p.type === 'สี' ? '🎨 สี' : '⬛ ขาวดำ'}</div>
          </td>
          <td>
            <div class="ip-mono">${p.ip || ''}</div>
            <div class="serial-mono">${p.serial || ''}</div>
          </td>
          <td class="prev-counter">${prevBWCounter !== null ? fmtNum(prevBWCounter) : '—'}</td>
          <td>
            <input type="number" class="counter-input"
              id="ci-bw-${p.id}"
              data-printer-id="${p.id}"
              data-counter-type="bw"
              data-prev="${prevBWVal}"
              value="${prevBWVal}"
              min="0"
              placeholder="กรอก Counter"
              oninput="updateDiff('${p.id}')"
            />
          </td>
          <td id="diff-bw-${p.id}" class="diff-preview diff-zero">—</td>
          <td class="prev-counter" style="color:#f59e0b">${prevColorCounter !== null ? fmtNum(prevColorCounter) : '—'}</td>
          <td>
            <input type="number" class="counter-input"
              id="ci-color-${p.id}"
              data-printer-id="${p.id}"
              data-counter-type="color"
              data-prev="${prevColorVal}"
              value="${prevColorVal}"
              min="0"
              placeholder="กรอก Counter"
              oninput="updateDiff('${p.id}')"
            />
          </td>
          <td id="diff-color-${p.id}" class="diff-preview diff-zero">—</td>
          <td>
            <input type="text" class="note-input" id="note-${p.id}" placeholder="หมายเหตุ..." />
          </td>
        </tr>`;
    }
  }

  html += `</tbody></table>`;

  document.getElementById('record-form-area').innerHTML = html;
  document.getElementById('record-actions').style.display = 'block';
}

function updateDiff(printerId) {
  ['bw', 'color'].forEach(type => {
    const input = document.getElementById(`ci-${type}-${printerId}`);
    if (!input) return;
    const prev  = Number(input.dataset.prev);
    const curr  = Number(input.value);
    const diffEl= document.getElementById(`diff-${type}-${printerId}`);

    if (!input.value) { diffEl.textContent = '—'; diffEl.className = 'diff-preview diff-zero'; return; }

    const diff = curr - prev;
    if (!prev && prev !== 0) { diffEl.textContent = '—'; diffEl.className = 'diff-preview diff-zero'; return; }
    if (diff > 0) { diffEl.textContent = `▲ ${fmtNum(diff)}`; diffEl.className = 'diff-preview diff-positive'; }
    else if (diff < 0) { diffEl.textContent = `▼ ${fmtNum(Math.abs(diff))}`; diffEl.className = 'diff-preview diff-negative'; }
    else { diffEl.textContent = '0'; diffEl.className = 'diff-preview diff-zero'; }

    input.classList.toggle('changed', input.value !== input.dataset.prev);
  });
}

async function saveAllRecords() {
  return showToast('🔒 ฟีเจอร์บันทึกใช้งานได้เฉพาะตอนรันบน localhost', 'error');
}

// ─── History Page ─────────────────────────────────────────────────────────────
async function loadHistory() {
  await fetchAll();

  // Populate filters
  const histMonth = document.getElementById('hist-month');
  const histZone  = document.getElementById('hist-zone');
  const curHistMonth = histMonth.value;
  const curHistZone  = histZone.value;

  histMonth.innerHTML = `<option value="">— ทุกเดือน —</option>` +
    [...allMonths].reverse().map(m => `<option value="${m}">${thMonth(m)}</option>`).join('');
  histMonth.value = curHistMonth;

  histZone.innerHTML = `<option value="">— ทุกแผนก —</option>` +
    ZONES.map(z => `<option value="${z}">${z}</option>`).join('');
  histZone.value = curHistZone;

  // Build table
  const filterMonth = histMonth.value;
  const filterZone  = histZone.value;

  let rows = [];
  const months = filterMonth ? [filterMonth] : [...allMonths].reverse();

  for (const m of months) {
    const mStats = stats[m] || {};
    for (const p of printers) {
      if (filterZone && p.zone !== filterZone) continue;
      const st = mStats[p.id];
      if (!st) continue;
      rows.push({
        month: m,
        printer: p,
        counterBW: st.counterBW,
        counterColor: st.counterColor,
        usedBW: st.usedBW,
        usedColor: st.usedColor,
        recordedAt: st.recordedAt
      });
    }
  }

  const wrap = document.getElementById('history-table-wrap');
  if (!rows.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><p>ไม่พบข้อมูล</p></div>`;
    return;
  }

  wrap.innerHTML = `
    <table class="history-table" id="export-table">
      <thead><tr>
        <th>เดือน</th>
        <th>แผนก</th>
        <th>ห้อง / สถานที่</th>
        <th>IP</th>
        <th>Serial</th>
        <th>⬛ B&W (แผ่น)</th>
        <th>ใช้ไป B&W</th>
        <th>🎨 สี (แผ่น)</th>
        <th>ใช้ไป สี</th>
        <th>วันที่บันทึก</th>
      </tr></thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td class="month-cell">${thMonth(r.month)}</td>
            <td><span style="color:${ZONE_COLORS[r.printer.zone] || '#94a3b8'}">${r.printer.zone}</span></td>
            <td>${r.printer.location}</td>
            <td class="ip-mono">${r.printer.ip || ''}</td>
            <td class="serial-mono">${r.printer.serial || ''}</td>
            <td class="counter-cell">${fmtNum(r.counterBW)}</td>
            <td class="used-cell">${r.usedBW != null ? (r.usedBW >= 0 ? '+' + fmtNum(r.usedBW) : fmtNum(r.usedBW)) : '—'}</td>
            <td class="counter-cell" style="color:#f59e0b">${fmtNum(r.counterColor)}</td>
            <td class="used-cell" style="color:#f59e0b">${r.usedColor != null ? (r.usedColor >= 0 ? '+' + fmtNum(r.usedColor) : fmtNum(r.usedColor)) : '—'}</td>
            <td style="color:var(--text-muted);font-size:0.8rem">${r.recordedAt ? new Date(r.recordedAt).toLocaleDateString('th-TH') : '—'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

// ─── Export PDF ───────────────────────────────────────────────────────────────
function exportPDF() {
  const filterMonth = document.getElementById('hist-month').value;
  const title = filterMonth ? `สรุปมิเตอร์เครื่องพิมพ์ ${thMonth(filterMonth)}` : 'ประวัติมิเตอร์เครื่องพิมพ์';

  const tableEl = document.getElementById('export-table');
  if (!tableEl) return showToast('ไม่มีข้อมูลสำหรับ Export', 'error');

  const printWin = window.open('', '_blank');
  printWin.document.write(`
    <!DOCTYPE html><html><head>
    <meta charset="UTF-8">
    <title>${title}</title>
    <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@400;600;700&display=swap" rel="stylesheet">
    <style>
      body { font-family: 'Noto Sans Thai', sans-serif; padding: 20px; color: #111; }
      h1 { font-size: 1.2rem; margin-bottom: 6px; }
      .sub { font-size: 0.8rem; color: #555; margin-bottom: 20px; }
      table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
      th { background: #1e1b4b; color: #fff; padding: 8px 10px; text-align: left; }
      td { padding: 7px 10px; border-bottom: 1px solid #e5e7eb; }
      tr:nth-child(even) td { background: #f9fafb; }
    </style>
    </head><body>
    <h1>🖨️ ${title}</h1>
    <div class="sub">พิมพ์เมื่อ: ${new Date().toLocaleString('th-TH')}</div>
    ${tableEl.outerHTML}
    </body></html>
  `);
  printWin.document.close();
  printWin.onload = () => { printWin.print(); };
}

// ─── Settings Page ────────────────────────────────────────────────────────────
async function loadSettings() {
  await fetchAll();
  const wrap = document.getElementById('settings-table-wrap');
  wrap.innerHTML = `
    <table class="settings-table">
      <thead><tr>
        <th>แผนก</th>
        <th>ห้อง / สถานที่</th>
        <th>ประเภท</th>
        <th>IP Address</th>
        <th>Serial / MAC</th>
        <th>หมายเหตุ</th>
        <th>สถานะ</th>
      </tr></thead>
      <tbody>
        ${printers.map(p => `
          <tr>
            <td><span style="color:${ZONE_COLORS[p.zone] || '#94a3b8'}">${p.zone}</span></td>
            <td>${p.location}</td>
            <td>${p.type === 'สี' ? '🎨 สี' : '⬛ ขาวดำ'}</td>
            <td class="ip-mono">${p.ip || ''}</td>
            <td class="serial-mono">${p.serial || ''}</td>
            <td style="font-size:0.78rem;color:var(--orange)">${p.note || ''}</td>
            <td style="color:var(--text-muted);font-size:0.75rem">🔒 ดูอย่างเดียว</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

// ─── Printer Modal ────────────────────────────────────────────────────────────
function openPrinterModal(id) {
  document.getElementById('modal-title').textContent = id ? 'แก้ไขเครื่องพิมพ์' : 'เพิ่มเครื่องพิมพ์';
  document.getElementById('modal-printer-id').value  = id || '';
  const p = id ? printers.find(x => x.id === id) : null;
  document.getElementById('modal-zone').value     = p?.zone     || 'มัธยม';
  document.getElementById('modal-type').value     = p?.type     || 'ขาวดำ';
  document.getElementById('modal-location').value = p?.location || '';
  document.getElementById('modal-ip').value       = p?.ip       || '';
  document.getElementById('modal-serial').value   = p?.serial   || '';
  document.getElementById('modal-note').value     = p?.note     || '';
  document.getElementById('printer-modal').classList.add('open');
}

function editPrinter(id) { openPrinterModal(id); }

function closePrinterModal(e) {
  if (e && e.target !== document.getElementById('printer-modal')) return;
  document.getElementById('printer-modal').classList.remove('open');
}

function openPrinterDetail(printerId) {
  const p = printers.find(x => x.id === printerId);
  if (!p) return;

  const monthKeys = [...allMonths].sort().reverse();

  // ประวัติทุกเดือน
  let rows = monthKeys.map(m => {
    const st = (stats[m] || {})[printerId];
    if (!st) return null;
    const usedBW = st.usedBW != null ? (st.usedBW >= 0 ? '+' + fmtNum(st.usedBW) : fmtNum(st.usedBW)) : '—';
    const usedColor = st.usedColor != null ? (st.usedColor >= 0 ? '+' + fmtNum(st.usedColor) : fmtNum(st.usedColor)) : '—';
    return `
      <tr>
        <td style="font-weight:600;color:var(--accent-light)">${thMonth(m)}</td>
        <td style="text-align:right;font-variant-numeric:tabular-nums">${fmtNum(st.counterBW)}</td>
        <td style="text-align:right;font-variant-numeric:tabular-nums;color:#f59e0b">${fmtNum(st.counterColor)}</td>
        <td style="text-align:right;font-variant-numeric:tabular-nums">${usedBW}</td>
        <td style="text-align:right;font-variant-numeric:tabular-nums;color:#f59e0b">${usedColor}</td>
      </tr>`;
  }).filter(Boolean).join('');

  const body = document.getElementById('detail-printer-body');
  document.getElementById('detail-modal-title').textContent = `🖨️ ${p.location}`;
  body.innerHTML = `
    <div style="margin-bottom:16px">
      <div style="font-size:1.1rem;font-weight:600;margin-bottom:4px">${p.location}</div>
      <div style="font-size:0.82rem;color:var(--text-muted)">
        ${p.zone} · ${p.type === 'สี' ? '🎨 สี' : '⬛ ขาวดำ'}
        ${p.ip ? ' · IP: ' + p.ip : ''}
        ${p.serial ? ' · Serial: ' + p.serial : ''}
      </div>
      ${p.note ? `<div style="margin-top:6px;font-size:0.8rem;color:var(--orange)">📝 ${p.note}</div>` : ''}
    </div>
    <div style="max-height:300px;overflow-y:auto">
      <table style="width:100%;border-collapse:collapse;font-size:0.82rem">
        <thead>
          <tr style="background:rgba(255,255,255,0.05)">
            <th style="text-align:left;padding:6px 10px;border-bottom:1px solid var(--border)">เดือน</th>
            <th style="text-align:right;padding:6px 10px;border-bottom:1px solid var(--border)">⬛ B&W</th>
            <th style="text-align:right;padding:6px 10px;border-bottom:1px solid var(--border)">🎨 สี</th>
            <th style="text-align:right;padding:6px 10px;border-bottom:1px solid var(--border)">ใช้ B&W</th>
            <th style="text-align:right;padding:6px 10px;border-bottom:1px solid var(--border)">ใช้ สี</th>
          </tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="5" style="text-align:center;padding:16px;color:var(--text-muted)">ไม่มีข้อมูล</td></tr>'}</tbody>
      </table>
    </div>
  `;

  document.getElementById('printer-detail-modal').classList.add('open');
}

function showOverallDetail() {
  const latM = latestMonth();
  const monthStats = stats[latM] || {};

  // รวม totals
  const totalBW = Object.values(monthStats).reduce((s, v) => s + (v.counterBW || 0), 0);
  const totalColor = Object.values(monthStats).reduce((s, v) => s + (v.counterColor || 0), 0);
  const totalUsedBW = Object.values(monthStats).reduce((s, v) => s + (v.usedBW || 0), 0);
  const totalUsedColor = Object.values(monthStats).reduce((s, v) => s + (v.usedColor || 0), 0);

  // ตารางแต่ละเครื่อง
  let rows = printers.map(p => {
    const st = monthStats[p.id];
    const bw = st ? st.counterBW : null;
    const color = st ? st.counterColor : null;
    const usedBW = st ? st.usedBW : null;
    const usedColor = st ? st.usedColor : null;
    return `
      <tr>
        <td style="font-weight:600;color:${ZONE_COLORS[p.zone] || '#94a3b8'}">${p.zone}</td>
        <td>${p.location}</td>
        <td style="text-align:right;font-variant-numeric:tabular-nums">${bw !== null ? fmtNum(bw) : '—'}</td>
        <td style="text-align:right;font-variant-numeric:tabular-nums;color:#f59e0b">${color !== null ? fmtNum(color) : '—'}</td>
        <td style="text-align:right;font-variant-numeric:tabular-nums">${usedBW != null ? fmtNum(usedBW) : '—'}</td>
        <td style="text-align:right;font-variant-numeric:tabular-nums;color:#f59e0b">${usedColor != null ? fmtNum(usedColor) : '—'}</td>
      </tr>`;
  }).join('');

  const body = document.getElementById('detail-printer-body');
  document.getElementById('detail-modal-title').textContent = `📊 สรุปยอด ${thMonth(latM)}`;
  body.innerHTML = `
    <div style="margin-bottom:20px">
      <div style="font-size:1rem;font-weight:600;margin-bottom:4px">📊 ${thMonth(latM)}</div>
      <div style="display:flex;gap:24px;margin-top:12px;flex-wrap:wrap">
        <div><span style="color:var(--text-muted)">⬛ B&W รวม:</span> <b>${fmtNum(totalBW)}</b></div>
        <div><span style="color:var(--text-muted)">🎨 สี รวม:</span> <b style="color:#f59e0b">${fmtNum(totalColor)}</b></div>
        <div><span style="color:var(--text-muted)">ใช้ไป B&W:</span> <b style="color:#10b981">${totalUsedBW > 0 ? fmtNum(totalUsedBW) : '—'}</b></div>
        <div><span style="color:var(--text-muted)">ใช้ไป สี:</span> <b style="color:#f59e0b">${totalUsedColor > 0 ? fmtNum(totalUsedColor) : '—'}</b></div>
      </div>
    </div>
    <div style="max-height:360px;overflow-y:auto">
      <table style="width:100%;border-collapse:collapse;font-size:0.82rem">
        <thead>
          <tr style="background:rgba(255,255,255,0.05)">
            <th style="text-align:left;padding:6px 10px;border-bottom:1px solid var(--border)">แผนก</th>
            <th style="text-align:left;padding:6px 10px;border-bottom:1px solid var(--border)">ห้อง/สถานที่</th>
            <th style="text-align:right;padding:6px 10px;border-bottom:1px solid var(--border)">⬛ B&W ล่าสุด</th>
            <th style="text-align:right;padding:6px 10px;border-bottom:1px solid var(--border)">🎨 สี ล่าสุด</th>
            <th style="text-align:right;padding:6px 10px;border-bottom:1px solid var(--border)">ใช้ B&W</th>
            <th style="text-align:right;padding:6px 10px;border-bottom:1px solid var(--border)">ใช้ สี</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;

  document.getElementById('printer-detail-modal').classList.add('open');
}

function closePrinterDetail(e) {
  if (e && e.target !== document.getElementById('printer-detail-modal')) return;
  document.getElementById('printer-detail-modal').classList.remove('open');
}

async function savePrinter() {
  showToast('🔒 ฟีเจอร์แก้ไขใช้งานได้เฉพาะตอนรันบน localhost', 'error');
  closePrinterModal();
}

async function deletePrinter(id) {
  showToast('🔒 ฟีเจอร์ลบใช้งานได้เฉพาะตอนรันบน localhost', 'error');
}

// ─── Month Select Setup ───────────────────────────────────────────────────────
function setupMonthSelects() {
  const sel = document.getElementById('dash-month-select');
  const months = allMonths.length ? allMonths : [currentYearMonth()];
  sel.innerHTML = [...months].reverse().map(m =>
    `<option value="${m}">${thMonth(m)}</option>`
  ).join('');
}

// ─── Utilities ────────────────────────────────────────────────────────────────
async function api(url, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  if (!res.ok) { console.error('API error', res.status, await res.text()); return null; }
  return res.json();
}

function fmtNum(n) {
  if (n === null || n === undefined) return '—';
  return Number(n).toLocaleString('th-TH');
}

function currentYearMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}

const TH_MONTHS = ['','ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
function thMonth(ym) {
  if (!ym) return '';
  const [y, m] = ym.split('-');
  return `${TH_MONTHS[Number(m)]} ${Number(y) + 543}`;
}

function updateCurrentDate() {
  const el = document.getElementById('current-date');
  const d = new Date();
  el.textContent = d.toLocaleDateString('th-TH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast ${type} show`;
  setTimeout(() => t.classList.remove('show'), 3500);
}
