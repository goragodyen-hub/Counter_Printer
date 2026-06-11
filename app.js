/* =====================================================================
   Counter Printer Tracker — app.js (Static Site + Google Sheets Version)
   ===================================================================== */

// ─── State & Configurations ──────────────────────────────────────────────────
let printers = [];
let records  = [];
let stats    = {};
let allMonths = [];
let activeZone = 'ทั้งหมด';
let chartMonthly = null;
let chartCompare = null;

// ใส่ Google Apps Script Web App URL ที่นี่
let gsheetsUrl = 'https://script.google.com/macros/s/AKfycbxVSZF5bn4T_mNy_lejv3Jh0r77lBDE0FsWdeE_jGNyw0qv4TIPvgnnpwBKE2dEU1uH/exec';

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

// ─── API Helper & Loading ─────────────────────────────────────────────────────
function showLoading(show) {
  const spinner = document.getElementById('loading-spinner');
  if (spinner) {
    if (show) spinner.classList.add('active');
    else spinner.classList.remove('active');
  }
}

async function fetchAll() {
  showLoading(true);
  try {
    const res = await fetch(`${gsheetsUrl}?action=all`).then(r => r.json());
    if (res && res.success) {
      printers = (res.printers || []).sort((a, b) => {
        const valA = ZONES.indexOf(a.zone) === -1 ? 999 : ZONES.indexOf(a.zone);
        const valB = ZONES.indexOf(b.zone) === -1 ? 999 : ZONES.indexOf(b.zone);
        return valA - valB;
      });
      records = (res.records || []).map(r => {
        r.counter = r.counter !== undefined ? Number(r.counter) : (r.counterBW !== undefined ? Number(r.counterBW) : 0);
        // ปรับจูน timezone จาก ISO เป็น YYYY-MM ในเขตนครกรุงเทพฯ (GMT+7) เพื่อให้ตรงกับใน Google Sheet เสมอ
        if (r.month && r.month.includes('T')) {
          const d = new Date(r.month);
          if (!isNaN(d.getTime())) {
            const thaiTime = new Date(d.getTime() + (7 * 60 * 60 * 1000));
            const year = thaiTime.getUTCFullYear();
            const month = String(thaiTime.getUTCMonth() + 1).padStart(2, '0');
            r.month = `${year}-${month}`;
          }
        }
        return r;
      });
      computeStats();
    } else {
      throw new Error(res ? res.error : 'ไม่สามารถโหลดข้อมูลได้');
    }
  } catch (err) {
    console.error('Error fetching data:', err);
    showToast('❌ ไม่สามารถเชื่อมต่อกับ Google Sheets ได้: ' + err.message, 'error');
  } finally {
    showLoading(false);
  }
}

// คำนวณยอดใช้จริงแต่ละเดือน (แก้ bug คำนวณเดือนไม่ต่อเนื่อง)
function computeStats() {
  const months = [...new Set(records.map(r => r.month))].sort();
  allMonths = months;
  stats = {};
  
  for (const month of months) {
    stats[month] = {};
    const monthIdx = months.indexOf(month);
    
    for (const printer of printers) {
      // ค้นหาข้อมูลล่าสุดในเดือนนั้นๆ (จากท้ายอาร์เรย์) เผื่อกรณีมีข้อมูลซ้ำ
      const rec = [...records].reverse().find(r => r.printerId === printer.id && r.month === month);
      if (!rec) continue;
      
      const isBaseline = rec.note && (rec.note.includes('ข้อมูลเริ่มต้น') || rec.note.includes('สรุปจำนวนมิเตอร์เครื่องพิมพ์'));
      
      let used = null;
      
      // ค้นหาข้อมูลเดือนล่าสุดก่อนหน้า (รองรับการข้ามเดือนหรือข้อมูลไม่ต่อเนื่อง)
      if (monthIdx > 0 && !isBaseline) {
        const prevMonths = months.slice(0, monthIdx).reverse();
        let prevRec = null;
        for (const pm of prevMonths) {
          prevRec = [...records].reverse().find(r => r.printerId === printer.id && r.month === pm);
          if (prevRec) break;
        }
        
        if (prevRec) {
          used = (rec.counter !== undefined ? rec.counter : (rec.counterBW || 0)) - 
                 (prevRec.counter !== undefined ? prevRec.counter : (prevRec.counterBW || 0));
        }
      }
      
      const counter = rec.counter !== undefined ? rec.counter : (rec.counterBW !== undefined ? rec.counterBW : 0);
      
      stats[month][printer.id] = {
        counter,
        used,
        recordedAt: rec.recordedAt,
        note: rec.note || '',
        isBaseline: !!isBaseline
      };
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
  const selMonthEl = document.getElementById('dash-month-select');
  const selMonth = selMonthEl.value || latestMonth();
  renderSummaryCards(selMonth);
  renderZoneSummary(selMonth);
  renderZoneTabs();
  renderPrinterGrid(selMonth);
}

function latestMonth() {
  return allMonths.length ? allMonths[allMonths.length - 1] : currentYearMonth();
}

function renderSummaryCards(month) {
  const monthStats = stats[month] || {};
  const totalPrinters = printers.length;
  const recorded = Object.values(monthStats).length;
  
  const totalUsed = Object.values(monthStats).reduce((s, v) => s + (v.used || 0), 0);
  const totalCounter = Object.values(monthStats).reduce((s, v) => s + (v.counter || 0), 0);

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
      <div class="card-label">ยอดใช้ไปรวมเดือนนี้</div>
      <div class="card-value" style="color:#10b981">${totalUsed > 0 ? fmtNum(totalUsed) : '—'}</div>
      <div class="card-sub">แผ่น</div>
    </div>
    <div class="summary-card orange" onclick="showOverallDetail()" style="cursor:pointer">
      <div class="card-label">มิเตอร์สะสมรวมทั้งหมด</div>
      <div class="card-value" style="color:#f59e0b">${totalCounter > 0 ? fmtNum(totalCounter) : '—'}</div>
      <div class="card-sub">แผ่น</div>
    </div>
  `;
}

// ─── Zone Summary Bar ────────────────────────────────────────────────────────
function renderZoneSummary(month) {
  const el = document.getElementById('zone-summary');
  if (!el) return;

  const monthStats = stats[month] || {};
  const hasData = Object.keys(monthStats).length > 0;
  if (!hasData) { el.innerHTML = ''; return; }

  // คำนวณยอดรวมแต่ละโซน (used = ใช้ไปเดือนนี้, counter = มิเตอร์สะสม)
  const zoneTotals = {};
  let grandUsed = 0;
  let grandCounter = 0;

  for (const p of printers) {
    const st = monthStats[p.id];
    if (!st) continue;
    const zone = p.zone;
    if (!zoneTotals[zone]) zoneTotals[zone] = { used: 0, counter: 0, count: 0 };
    zoneTotals[zone].used    += st.used    || 0;
    zoneTotals[zone].counter += st.counter || 0;
    zoneTotals[zone].count++;
    grandUsed    += st.used    || 0;
    grandCounter += st.counter || 0;
  }

  const ZONE_ORDER = ['มัธยม', 'ประถม', 'อนุบาล', 'ห้องปฏิบัติการ'];
  const ZONE_GRADIENT = {
    'มัธยม':         'linear-gradient(135deg,rgba(124,58,237,0.18),rgba(124,58,237,0.06))',
    'ประถม':         'linear-gradient(135deg,rgba(6,182,212,0.18),rgba(6,182,212,0.06))',
    'อนุบาล':        'linear-gradient(135deg,rgba(16,185,129,0.18),rgba(16,185,129,0.06))',
    'ห้องปฏิบัติการ': 'linear-gradient(135deg,rgba(245,158,11,0.18),rgba(245,158,11,0.06))',
  };

  const zoneCards = ZONE_ORDER.filter(z => zoneTotals[z]).map(zone => {
    const zt = zoneTotals[zone];
    const col = ZONE_COLORS[zone] || '#94a3b8';
    const grad = ZONE_GRADIENT[zone] || 'none';
    const hasUsed = zt.used > 0;
    return `
      <div class="zscard" style="background:${grad};border:1px solid ${col}33;">
        <div class="zscard-zone" style="color:${col}">${zone}</div>
        <div class="zscard-sub">${zt.count} เครื่อง</div>
        <div class="zscard-divider"></div>
        <div class="zscard-total-row" style="margin-top:12px;">
          <span class="zscard-label" style="font-size:0.85rem">ใช้ไปรวม</span>
          <span class="zscard-val total" style="color:#f8fafc;font-size:1.1rem;font-weight:700;">${hasUsed ? fmtNum(zt.used) : '—'}</span>
        </div>
        <div class="zscard-divider" style="margin-top:6px"></div>
        <div class="zscard-row" style="opacity:0.65;margin-top:4px">
          <span class="zscard-label" style="font-size:0.68rem">สะสมรวม</span>
          <span class="zscard-val" style="font-size:0.75rem;color:#94a3b8">${fmtNum(zt.counter)}</span>
        </div>
      </div>`;
  }).join('');

  const grandHasUsed = grandUsed > 0;
  el.innerHTML = `
    <div class="zone-summary-wrap">
      <div class="zone-summary-label">📊 สรุปยอดพิมพ์แยกตามแผนก — <span style="color:var(--accent-light)">${thMonth(month)}</span></div>
      <div class="zone-summary-row">
        ${zoneCards}
        <div class="zscard zscard-grand">
          <div class="zscard-zone" style="color:#c4b5fd">🏆 รวมทั้งหมด</div>
          <div class="zscard-sub">ทุกแผนก</div>
          <div class="zscard-divider"></div>
          <div class="zscard-total-row" style="margin-top:12px;">
            <span class="zscard-label" style="font-size:0.95rem">ใช้ไปรวมทั้งหมด</span>
            <span class="zscard-val" style="font-size:1.25rem;color:#a78bfa;font-weight:800">${grandHasUsed ? fmtNum(grandUsed) : '—'}</span>
          </div>
          <div class="zscard-divider" style="margin-top:6px"></div>
          <div class="zscard-row" style="opacity:0.65;margin-top:4px">
            <span class="zscard-label" style="font-size:0.68rem">สะสมรวมทั้งหมด</span>
            <span class="zscard-val" style="font-size:0.75rem;color:#94a3b8">${fmtNum(grandCounter)}</span>
          </div>
        </div>
      </div>
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
    const counter = st ? st.counter : null;
    const used = st ? st.used : null;
    
    const typeBadge = p.type === 'สี'
      ? `<span class="printer-type-badge badge-color">🎨 สี</span>`
      : `<span class="printer-type-badge badge-bw">⬛ ขาวดำ</span>`;

    let usedHtml = '';
    if (used === null || used === undefined) usedHtml = `<span class="used-badge none">— ไม่มีข้อมูลเดิม</span>`;
    else if (used < 0) usedHtml = `<span class="used-badge err">⚠️ ${fmtNum(used)}</span>`;
    else usedHtml = `<span class="used-badge up">▲ ${fmtNum(used)} แผ่น</span>`;

    const noteHtml = p.note ? `<div class="printer-note-text">⚠️ ${p.note}</div>` : '';

    return `
      <div class="printer-card" onclick="openPrinterDetail('${p.id}')" style="cursor:pointer">
        <div class="printer-card-header">
          <span style="font-size:0.7rem;color:var(--text-muted)">${p.zone}</span>
          ${typeBadge}
        </div>
        <div class="printer-location">${p.location}</div>
        <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 8px; margin-top: 4px;">
          <span style="font-size: 0.68rem; font-weight: 600; color: var(--cyan); background: rgba(6, 182, 212, 0.1); padding: 2px 6px; border-radius: 4px;">${p.model || getPrinterModel(p.serial, p.location)}</span>
        </div>
        <div class="printer-ip" style="margin-bottom: 10px">${p.ip || ''} ${p.serial ? '· ' + p.serial : ''}</div>
        <div class="printer-counter-row">
          <div>
            <div class="counter-label">มิเตอร์สะสมล่าสุด</div>
            <div class="counter-value">${counter !== null ? fmtNum(counter) : '—'}</div>
          </div>
          ${usedHtml}
        </div>
        ${noteHtml}
      </div>
    `;
  }).join('');
}



// ─── Record Page ──────────────────────────────────────────────────────────────
function initRecordPage() {
  const mi = document.getElementById('record-month');
  if (!mi.value) mi.value = currentYearMonth();
}

async function loadRecordForm() {
  const month = document.getElementById('record-month').value;
  if (!month) return showToast('กรุณาเลือกเดือน', 'error');

  showLoading(true);
  try {
    await fetchAll();
    const monthStats = stats[month] || {};

    const zones = [...new Set(printers.map(p => p.zone))];
    let html = `<table class="record-table">
      <thead><tr>
        <th>ห้อง / สถานที่</th>
        <th>IP / Serial</th>
        <th>🔢 มิเตอร์ปัจจุบัน</th>
        <th style="text-align:right;">📊 มิเตอร์เดิม</th>
        <th style="text-align:right;">📈 ยอดใช้ไป</th>
        <th>หมายเหตุ</th>
      </tr></thead>
      <tbody id="record-tbody">`;

    for (const zone of zones) {
      const zPrinters = printers.filter(p => p.zone === zone);
      html += `<tr class="zone-group-row"><td colspan="6">▪ ${zone}</td></tr>`;
      for (const p of zPrinters) {
        // ค้นหาข้อมูลมิเตอร์ล่าสุดของเดือนก่อนหน้า (เพื่อเอามาตั้งต้นเป็น มิเตอร์เดิม)
        let prevVal = '';

        // ดึงจากประวัติตรงๆ
        const sortedMonths = [...allMonths].sort();
        const curMonthIdx = sortedMonths.indexOf(month);
        
        let prevRec = null;
        if (curMonthIdx > 0) {
          const prevMonths = sortedMonths.slice(0, curMonthIdx).reverse();
          for (const pm of prevMonths) {
            prevRec = [...records].reverse().find(r => r.printerId === p.id && r.month === pm);
            if (prevRec) break;
          }
        } else if (curMonthIdx === -1) {
          // หากเป็นเดือนใหม่ที่ยังไม่เคยมีข้อมูลมาก่อน ให้ค้นจากเดือนทั้งหมดที่มี
          const prevMonths = [...sortedMonths].reverse();
          for (const pm of prevMonths) {
            if (pm < month) {
              prevRec = [...records].reverse().find(r => r.printerId === p.id && r.month === pm);
              if (prevRec) break;
            }
          }
        }

        if (prevRec) {
          prevVal = prevRec.counter !== undefined ? prevRec.counter : (prevRec.counterBW || 0);
        }

        // ค่าในเดือนปัจจุบันที่บันทึกไปแล้ว (ถ้ามีและไม่ใช่ข้อมูลเริ่มต้น)
        const st = monthStats[p.id];
        const currentVal = st && st.counter !== undefined ? st.counter : '';
        const note = (st && st.note) ? st.note : '';

        const prevCounter = prevVal !== '' ? Number(prevVal) : 0;

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
            <td>
              <input type="number" class="counter-input"
                id="ci-counter-${p.id}"
                data-printer-id="${p.id}"
                data-prev="${prevVal}"
                value="${currentVal}"
                min="0"
                placeholder="กรอก Counter"
                oninput="updateDiff('${p.id}')"
              />
              <div class="prev-hint">เดิม: ${prevVal !== '' ? fmtNum(prevVal) : '—'}</div>
            </td>
            <td style="text-align:right;color:var(--text-secondary);font-variant-numeric:tabular-nums;" id="prev-counter-${p.id}">
              ${fmtNum(prevCounter)}
            </td>
            <td style="text-align:right;font-weight:700;font-variant-numeric:tabular-nums;" id="diff-total-${p.id}" class="diff-preview diff-zero">
              —
            </td>
            <td>
              <input type="text" class="note-input" id="note-${p.id}" value="${note}" placeholder="หมายเหตุ..." />
            </td>
          </tr>`;
      }
    }

    html += `</tbody></table>`;

    document.getElementById('record-form-area').innerHTML = html;
    document.getElementById('record-actions').style.display = 'block';

    // อัปเดต diff ทันทีหลังโหลดฟอร์ม
    printers.forEach(p => updateDiff(p.id));

  } catch (err) {
    console.error('Error loading record form:', err);
    showToast('❌ ไม่สามารถโหลดฟอร์มบันทึกได้', 'error');
  } finally {
    showLoading(false);
  }
}

function updateDiff(printerId) {
  const input = document.getElementById(`ci-counter-${printerId}`);
  if (!input) return;
  
  const prev = input.dataset.prev !== '' ? Number(input.dataset.prev) : 0;
  const curr = input.value !== '' ? Number(input.value) : null;
  
  // Highlight inputs if they changed from their previous values
  input.classList.toggle('changed', input.value !== (input.dataset.prev || ''));
  
  const diffEl = document.getElementById(`diff-total-${printerId}`);
  if (curr === null) {
    if (diffEl) {
      diffEl.textContent = '—';
      diffEl.className = 'diff-preview diff-zero';
    }
    return;
  }
  
  if (diffEl) {
    const diff = curr - prev;
    if (diff > 0) {
      diffEl.textContent = `▲ ${fmtNum(diff)}`;
      diffEl.className = 'diff-preview diff-positive';
    } else if (diff < 0) {
      diffEl.textContent = `⚠️ ${fmtNum(diff)}`;
      diffEl.className = 'diff-preview diff-negative';
    } else {
      diffEl.textContent = '0';
      diffEl.className = 'diff-preview diff-zero';
    }
  }
}

// เซฟข้อมูลมิเตอร์แบบกลุ่มไปยัง Google Sheets
async function saveAllRecords() {
  const month = document.getElementById('record-month').value;
  if (!month) return showToast('กรุณาเลือกเดือน', 'error');

  const entries = [];
  printers.forEach(p => {
    const input = document.getElementById(`ci-counter-${p.id}`);
    const noteInput = document.getElementById(`note-${p.id}`);

    if (input) {
      const counter = input.value !== '' ? Number(input.value) : null;
      const note = noteInput ? noteInput.value : '';

      if (counter !== null) {
        entries.push({
          printerId: p.id,
          counter: counter,
          note: note
        });
      }
    }
  });

  if (entries.length === 0) {
    return showToast('⚠️ กรุณากรอกข้อมูลมิเตอร์อย่างน้อย 1 เครื่องก่อนกดบันทึก', 'warning');
  }

  showLoading(true);
  try {
    const res = await fetch(gsheetsUrl, {
      method: 'POST',
      body: JSON.stringify({
        action: 'saveRecords',
        month: month,
        entries: entries
      })
    }).then(r => r.json());

    if (res && res.success) {
      showToast('💾 บันทึกข้อมูลมิเตอร์ลง Google Sheets เรียบร้อย!', 'success');
      await fetchAll();
      loadRecordForm(); // โหลดฟอร์มใหม่พร้อมค่าล่าสุด
    } else {
      throw new Error(res ? res.error : 'ไม่สามารถบันทึกข้อมูลได้');
    }
  } catch (err) {
    console.error('Error saving records:', err);
    showToast('❌ บันทึกล้มเหลว: ' + err.message, 'error');
  } finally {
    showLoading(false);
  }
}

// ─── History Page ─────────────────────────────────────────────────────────────
async function loadHistory() {
  showLoading(true);
  try {
    await fetchAll();

    const histMonth = document.getElementById('hist-month');
    const histZone  = document.getElementById('hist-zone');
    const curHistMonth = histMonth.value;
    const curHistZone  = histZone.value;

    histMonth.innerHTML = `<option value="">— เลือกเดือนล่าสุด —</option>` +
      [...allMonths].reverse().map(m => `<option value="${m}">${thMonth(m)}</option>`).join('');
    
    if (curHistMonth) {
      histMonth.value = curHistMonth;
    } else {
      histMonth.value = latestMonth();
    }

    histZone.innerHTML = `<option value="">— ทุกแผนก —</option>` +
      ZONES.map(z => `<option value="${z}">${z}</option>`).join('');
    histZone.value = curHistZone;

    const filterMonth = histMonth.value || latestMonth();
    const filterZone  = histZone.value;

    // คำนวณ 3 เดือนย้อนหลัง
    const [m3, m2, m1] = get3MonthsList(filterMonth);

    let rows = [];
    for (const p of printers) {
      if (filterZone && p.zone !== filterZone) continue;

      const st1 = (stats[m1] || {})[p.id];
      const st2 = (stats[m2] || {})[p.id];
      const st3 = (stats[m3] || {})[p.id];

      // แสดงเฉพาะเครื่องที่มีประวัติบันทึกอย่างน้อย 1 ครั้งใน 3 เดือนนี้
      if (!st1 && !st2 && !st3) continue;

      // คำนวณยอดสะสม
      const tot1 = st1 ? (st1.counter !== undefined ? st1.counter : null) : null;
      const tot2 = st2 ? (st2.counter !== undefined ? st2.counter : null) : null;
      const tot3 = st3 ? (st3.counter !== undefined ? st3.counter : null) : null;

      const val1 = tot1 !== null ? fmtNum(tot1) : '—';
      const val2 = tot2 !== null ? fmtNum(tot2) : '—';
      const val3 = tot3 !== null ? fmtNum(tot3) : '—';

      // คำนวณยอดที่ใช้ไปล่าสุด (เดือน M1 เทียบกับ M2, หรือใช้ค่าที่คำนวณชดเชยไว้หากเว้นว่างเดือนก่อนหน้า)
      let diffText = '—';
      let diffClass = 'diff-zero';
      if (tot1 !== null && tot2 !== null) {
        const diff = tot1 - tot2;
        if (diff > 0) {
          diffText = `+${fmtNum(diff)}`;
          diffClass = 'diff-positive';
        } else if (diff < 0) {
          diffText = `⚠️ ${fmtNum(diff)}`;
          diffClass = 'diff-negative';
        } else {
          diffText = '0';
          diffClass = 'diff-zero';
        }
      } else if (st1 && st1.used !== null) {
        // หากไม่มีข้อมูลเดือนก่อนหน้าโดยตรง แต่มีข้อมูลที่ระบบเคยคำนวณชดเชยย้อนหลังให้
        const diff = st1.used || 0;
        if (diff > 0) {
          diffText = `+${fmtNum(diff)}`;
          diffClass = 'diff-positive';
        } else if (diff < 0) {
          diffText = `⚠️ ${fmtNum(diff)}`;
          diffClass = 'diff-negative';
        } else {
          diffText = '0';
          diffClass = 'diff-zero';
        }
      }

      const recordedAt = st1 && st1.recordedAt 
        ? new Date(st1.recordedAt).toLocaleDateString('th-TH') 
        : (st2 && st2.recordedAt ? new Date(st2.recordedAt).toLocaleDateString('th-TH') : '—');

      rows.push({
        zone: p.zone,
        location: p.location,
        model: p.model || getPrinterModel(p.serial, p.location),
        serial: p.serial || '—',
        val3,
        val2,
        val1,
        diffText,
        diffClass,
        recordedAt
      });
    }

    const wrap = document.getElementById('history-table-wrap');
    if (!rows.length) {
      wrap.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><p>ไม่พบข้อมูลบันทึกย้อนหลังในช่วง 3 เดือนนี้</p></div>`;
      return;
    }

    wrap.innerHTML = `
      <table class="history-table" id="export-table">
        <thead><tr>
          <th>แผนก</th>
          <th>ห้อง / สถานที่</th>
          <th>รุ่น / Serial No.</th>
          <th style="text-align:right">${thMonth(m3)}</th>
          <th style="text-align:right">${thMonth(m2)}</th>
          <th style="text-align:right;" class="latest-month-col">${thMonth(m1)} (สะสมล่าสุด)</th>
          <th style="text-align:right;" class="diff-col-header">ใช้ไปล่าสุด (แผ่น)</th>
          <th style="text-align:center">วันที่บันทึก (ล่าสุด)</th>
        </tr></thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td><span style="color:${ZONE_COLORS[r.zone] || '#94a3b8'}">${r.zone}</span></td>
              <td style="font-weight:600">${r.location}</td>
              <td>
                <div style="font-weight:600">${r.model}</div>
                <div class="serial-mono" style="font-size:0.72rem;color:var(--text-muted);margin-top:2px;">${r.serial}</div>
              </td>
              <td class="counter-cell" style="text-align:right">${r.val3}</td>
              <td class="counter-cell" style="text-align:right">${r.val2}</td>
              <td class="counter-cell latest-month-col" style="text-align:right;font-weight:700;">${r.val1}</td>
              <td class="counter-cell ${r.diffClass}" style="text-align:right;font-weight:600">${r.diffText}</td>
              <td style="color:var(--text-muted);font-size:0.8rem;text-align:center">${r.recordedAt}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    console.error('Error loading history:', err);
    showToast('❌ ไม่สามารถโหลดประวัติได้', 'error');
  } finally {
    showLoading(false);
  }
}

// คำนวณ 3 เดือนย้อนหลังจากเดือนเป้าหมาย
function get3MonthsList(targetMonthStr) {
  if (!targetMonthStr) return ['', '', ''];
  const [year, month] = targetMonthStr.split('-').map(Number);
  const date = new Date(year, month - 1, 1);
  
  const m1 = targetMonthStr; 
  
  date.setMonth(date.getMonth() - 1);
  const m2 = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  
  date.setMonth(date.getMonth() - 1);
  const m3 = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  
  return [m3, m2, m1]; 
}

// Export PDF
function exportPDF() {
  const filterMonth = document.getElementById('hist-month').value || latestMonth();
  const [m3, m2, m1] = get3MonthsList(filterMonth);
  const title = `รายงานสรุปมิเตอร์เครื่องพิมพ์ย้อนหลัง 3 เดือน (${thMonth(m1)})`;

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
      .serial-mono { font-family: monospace; }
      .counter-cell { font-variant-numeric: tabular-nums; text-align: right; }
      .diff-positive { color: #10b981; }
      .diff-negative { color: #ef4444; }
      .diff-zero { color: #555; }
      @media print {
        .no-print { display: none !important; }
      }
    </style>
    </head><body>
    <div class="no-print" style="display: flex; justify-content: space-between; align-items: center; background: #1e1b4b; color: white; padding: 12px 16px; margin-bottom: 20px; border-radius: 8px; font-family: 'Noto Sans Thai', sans-serif; gap: 10px; flex-wrap: wrap;">
      <span style="font-weight: 600; font-size: 0.95rem;">📄 หน้าแสดงตัวอย่างรายงานสำหรับพิมพ์</span>
      <div style="display: flex; gap: 8px; flex-wrap: wrap;">
        <button onclick="window.print()" style="background: #10b981; color: white; border: none; padding: 8px 16px; border-radius: 6px; font-weight: 600; cursor: pointer; font-family: 'Noto Sans Thai', sans-serif;">🖨️ สั่งพิมพ์ / บันทึก PDF</button>
        <button onclick="window.close(); setTimeout(() => { window.location.href = window.location.origin + window.location.pathname; }, 300);" style="background: #ef4444; color: white; border: none; padding: 8px 16px; border-radius: 6px; font-weight: 600; cursor: pointer; font-family: 'Noto Sans Thai', sans-serif;">❌ ปิด / ย้อนกลับ</button>
      </div>
    </div>
    <h1>🖨️ ${title}</h1>
    <div class="sub">พิมพ์เมื่อ: ${new Date().toLocaleString('th-TH')}</div>
    ${tableEl.outerHTML}
    </body></html>
  `);
  printWin.document.close();
  // หลีกเลี่ยงการสั่งพิมพ์อัตโนมัติบนอุปกรณ์มือถือเพื่อให้ผู้ใช้กดปุ่มได้
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  printWin.onload = () => { 
    if (!isMobile) {
      printWin.print(); 
    }
  };
}

// Export CSV (Excel)
function exportCSV() {
  const filterMonth = document.getElementById('hist-month').value || latestMonth();
  const filterZone  = document.getElementById('hist-zone').value;

  const [m3, m2, m1] = get3MonthsList(filterMonth);

  let rows = [];
  for (const p of printers) {
    if (filterZone && p.zone !== filterZone) continue;

    const st1 = (stats[m1] || {})[p.id];
    const st2 = (stats[m2] || {})[p.id];
    const st3 = (stats[m3] || {})[p.id];

    if (!st1 && !st2 && !st3) continue;

    const tot1 = st1 ? (st1.counter !== undefined ? st1.counter : null) : null;
    const tot2 = st2 ? (st2.counter !== undefined ? st2.counter : null) : null;
    const tot3 = st3 ? (st3.counter !== undefined ? st3.counter : null) : null;

    const val1 = tot1 !== null ? tot1 : '—';
    const val2 = tot2 !== null ? tot2 : '—';
    const val3 = tot3 !== null ? tot3 : '—';

    let diffText = '—';
    if (tot1 !== null && tot2 !== null) {
      const diff = tot1 - tot2;
      diffText = diff >= 0 ? `+${diff}` : `${diff}`;
    } else if (st1 && st1.used !== null) {
      const diff = st1.used || 0;
      diffText = diff >= 0 ? `+${diff}` : `${diff}`;
    }

    const recordedAt = st1 && st1.recordedAt 
      ? new Date(st1.recordedAt).toLocaleDateString('th-TH') 
      : (st2 && st2.recordedAt ? new Date(st2.recordedAt).toLocaleDateString('th-TH') : '—');

    rows.push({
      zone: p.zone,
      location: p.location,
      model: p.model || getPrinterModel(p.serial, p.location),
      serial: p.serial || '—',
      val3,
      val2,
      val1,
      diffText,
      recordedAt
    });
  }

  if (!rows.length) return showToast('ไม่มีข้อมูลสำหรับ Export', 'error');

  // สร้างไฟล์ CSV
  const headers = ['แผนก', 'ห้อง / สถานที่', 'รุ่นเครื่องพิมพ์ (Serial No.)', thMonth(m3), thMonth(m2), `${thMonth(m1)} (สะสมล่าสุด)`, 'ใช้ไปล่าสุด (แผ่น)', 'วันที่บันทึก (ล่าสุด)'];
  
  const csvRows = [
    headers.join(','),
    ...rows.map(r => [
      `"${r.zone}"`,
      `"${r.location.replace(/"/g, '""')}"`,
      `"${r.model} (${r.serial})"`,
      `"${r.val3}"`,
      `"${r.val2}"`,
      `"${r.val1}"`,
      `"${r.diffText}"`,
      `"${r.recordedAt}"`
    ].join(','))
  ];

  const csvContent = "\uFEFF" + csvRows.join("\n");

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement("a");
  link.setAttribute("href", url);
  
  const filenameMonth = filterMonth ? `_${filterMonth}` : '';
  link.setAttribute("download", `report_printer_counter${filenameMonth}.csv`);
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ─── Settings Page (CRUD เครื่องพิมพ์) ─────────────────────────────────────────
async function loadSettings() {
  showLoading(true);
  try {
    await fetchAll();
    const wrap = document.getElementById('settings-table-wrap');
    wrap.innerHTML = `
      <table class="settings-table">
        <thead><tr>
          <th>แผนก</th>
          <th>ห้อง / สถานที่</th>
          <th>ประเภท</th>
          <th>IP Address</th>
          <th>รุ่น / Serial No.</th>
          <th>หมายเหตุ</th>
          <th>จัดการ</th>
        </tr></thead>
        <tbody>
          ${printers.map(p => `
            <tr>
              <td><span style="color:${ZONE_COLORS[p.zone] || '#94a3b8'}">${p.zone}</span></td>
              <td>${p.location}</td>
              <td>${p.type === 'สี' ? '🎨 สี' : '⬛ ขาวดำ'}</td>
              <td class="ip-mono">${p.ip || ''}</td>
              <td>
                <div style="font-weight:600">${p.model || getPrinterModel(p.serial, p.location)}</div>
                <div class="serial-mono" style="font-size:0.72rem;color:var(--text-muted);margin-top:2px;">${p.serial || '—'}</div>
              </td>
              <td style="font-size:0.78rem;color:var(--orange)">${p.note || ''}</td>
              <td>
                <div class="action-btns">
                  <button class="btn-icon" onclick="editPrinter('${p.id}')">✏️ แก้ไข</button>
                  <button class="btn-icon del" onclick="deletePrinter('${p.id}')">🗑️ ลบ</button>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    console.error('Error loading settings:', err);
    showToast('❌ ไม่สามารถโหลดการตั้งค่าได้', 'error');
  } finally {
    showLoading(false);
  }
}

// ─── Printer Modal ────────────────────────────────────────────────────────────
function openPrinterModal(id) {
  document.getElementById('modal-title').textContent = id ? 'แก้ไขเครื่องพิมพ์' : 'เพิ่มเครื่องพิมพ์';
  document.getElementById('modal-printer-id').value  = id || '';
  const p = id ? printers.find(x => x.id === id) : null;
  document.getElementById('modal-zone').value     = p?.zone     || 'มัธยม';
  document.getElementById('modal-type').value     = p?.type     || 'ขาวดำ';
  document.getElementById('modal-location').value = p?.location || '';
  document.getElementById('modal-model').value    = p?.model    || '';
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

// ─── Save Printer (Add or Update) ─────────────────────────────────────────────
async function savePrinter() {
  const id = document.getElementById('modal-printer-id').value;
  const zone = document.getElementById('modal-zone').value;
  const type = document.getElementById('modal-type').value;
  const location = document.getElementById('modal-location').value;
  const model = document.getElementById('modal-model').value;
  const ip = document.getElementById('modal-ip').value;
  const serial = document.getElementById('modal-serial').value;
  const note = document.getElementById('modal-note').value;

  if (!location) return showToast('⚠️ กรุณาระบุสถานที่ตั้งของเครื่องพิมพ์', 'warning');

  const printerData = { zone, type, location, ip, model, serial, note };
  const action = id ? 'updatePrinter' : 'addPrinter';
  if (id) printerData.id = id;

  showLoading(true);
  try {
    const res = await fetch(gsheetsUrl, {
      method: 'POST',
      body: JSON.stringify({
        action: action,
        printer: printerData
      })
    }).then(r => r.json());

    if (res && res.success) {
      showToast(id ? '✏️ แก้ไขข้อมูลเครื่องพิมพ์แล้ว!' : '➕ เพิ่มเครื่องพิมพ์เรียบร้อย!', 'success');
      closePrinterModal();
      await fetchAll();
      loadSettings();
    } else {
      throw new Error(res ? res.error : 'ไม่สามารถบันทึกเครื่องพิมพ์ได้');
    }
  } catch (err) {
    console.error('Error saving printer:', err);
    showToast('❌ ข้อผิดพลาดในการบันทึก: ' + err.message, 'error');
  } finally {
    showLoading(false);
  }
}

// ─── Delete Printer ───────────────────────────────────────────────────────────
async function deletePrinter(id) {
  const p = printers.find(x => x.id === id);
  if (!p) return;
  
  if (!confirm(`⚠️ ยืนยันการลบเครื่องพิมพ์ "${p.location}" ใช่หรือไม่?\nการลบนี้จะนำประวัติการบันทึกมิเตอร์ทั้งหมดของเครื่องนี้ออกด้วย!`)) return;

  showLoading(true);
  try {
    const res = await fetch(gsheetsUrl, {
      method: 'POST',
      body: JSON.stringify({
        action: 'deletePrinter',
        id: id
      })
    }).then(r => r.json());

    if (res && res.success) {
      showToast('🗑️ ลบเครื่องพิมพ์เรียบร้อย!', 'success');
      await fetchAll();
      loadSettings();
    } else {
      throw new Error(res ? res.error : 'ไม่สามารถลบเครื่องพิมพ์ได้');
    }
  } catch (err) {
    console.error('Error deleting printer:', err);
    showToast('❌ ลบล้มเหลว: ' + err.message, 'error');
  } finally {
    showLoading(false);
  }
}

// ─── Migration: นำเข้าข้อมูลเดิมจาก JSON Local ─────────────────────────────────────
async function importLocalData() {
  if (!confirm('🚀 คุณต้องการล้าง Google Sheet และแทนที่ด้วยข้อมูลจากไฟล์ printers.json + records.json ในระบบเดิมใช่หรือไม่? (ดำเนินการครั้งเดียวตอนย้ายระบบ)')) return;

  showLoading(true);
  try {
    const [pRes, rRes] = await Promise.all([
      fetch('data/printers.json').then(r => r.json()),
      fetch('data/records.json').then(r => r.json())
    ]);

    const res = await fetch(gsheetsUrl, {
      method: 'POST',
      body: JSON.stringify({
        action: 'importData',
        printers: pRes.printers,
        records: rRes.records
      })
    }).then(r => r.json());

    if (res && res.success) {
      showToast('🚀 ย้ายข้อมูลเดิมเข้า Google Sheets สำเร็จเรียบร้อย!', 'success');
      await fetchAll();
      showPage('dashboard');
    } else {
      throw new Error(res ? res.error : 'การ Migration ข้อมูลไม่สำเร็จ');
    }
  } catch (err) {
    console.error('Data migration failed:', err);
    showToast('❌ การนำเข้าข้อมูลล้มเหลว: ' + err.message, 'error');
  } finally {
    showLoading(false);
  }
}

// ─── Modals: Printer Detail & Overall ─────────────────────────────────────────
function openPrinterDetail(printerId) {
  const p = printers.find(x => x.id === printerId);
  if (!p) return;

  const monthKeys = [...allMonths].sort().reverse();

  let rows = monthKeys.map(m => {
    const st = (stats[m] || {})[printerId];
    if (!st) return null;
    const used = st.used != null ? st.used : null;
    const counter = st.counter != null ? st.counter : 0;

    const fmtUsedTotal = (v) => v == null ? '—'
      : v > 0  ? `<span style="font-weight:700;color:#a78bfa">+${fmtNum(v)}</span>`
      : v < 0  ? `<span style="font-weight:700;color:#ef4444">${fmtNum(v)}</span>`
      : `<span style="color:var(--text-muted)">0</span>`;

    return `
      <tr style="border-bottom:1px solid rgba(255,255,255,0.04)">
        <td style="font-weight:600;color:var(--accent-light);padding:7px 10px">${thMonth(m)}</td>
        <td style="text-align:right;font-variant-numeric:tabular-nums;padding:7px 10px">${fmtNum(counter)}</td>
        <td style="text-align:right;font-variant-numeric:tabular-nums;padding:7px 10px;background:rgba(124,58,237,0.07);border-left:1px solid rgba(124,58,237,0.2)">${fmtUsedTotal(used)}</td>
      </tr>`;
  }).filter(Boolean).join('');

  const body = document.getElementById('detail-printer-body');
  document.getElementById('detail-modal-title').textContent = `🖨️ ${p.location}`;

  // Form บันทึกมิเตอร์ด่วนภายใน Popup พร้อมปุ่มปรับค่าแบบรวดเร็ว (-100, +100)
  const quickRecordHtml = `
    <div class="quick-record-card" style="background:rgba(255,255,255,0.02);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:20px;">
      <h4 style="margin:0 0 12px 0;font-size:0.92rem;display:flex;align-items:center;gap:6px;color:var(--text-primary)">📝 บันทึก/แก้ไขมิเตอร์ด่วน</h4>
      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;">
        <div style="flex:1;min-width:120px;">
          <label style="font-size:0.75rem;color:var(--text-secondary);display:block;margin-bottom:4px;">เลือกเดือน</label>
          <input type="month" id="modal-record-month" class="month-input" style="width:100%;margin:0;height:38px;padding:8px 10px;" onchange="onModalMonthChange('${p.id}')" />
        </div>
        <div style="flex:2;min-width:220px;">
          <label style="font-size:0.75rem;color:var(--text-secondary);display:block;margin-bottom:4px;">มิเตอร์สะสม (เดิม: <span id="modal-prev-counter-label">—</span>)</label>
          <div style="display:flex;align-items:center;gap:4px;">
            <button type="button" class="btn-icon" style="height:38px;width:38px;display:flex;align-items:center;justify-content:center;padding:0;background:rgba(255,255,255,0.03);border:1px solid var(--border);color:var(--text-secondary);" onclick="adjustModalValue(-100, '${p.id}')">-100</button>
            <input type="number" id="modal-ci-counter" class="counter-input" style="flex:1;height:38px;width:100%;text-align:center;padding:6px 4px;" placeholder="กรอกมิเตอร์" oninput="updateModalDiff('${p.id}')" />
            <button type="button" class="btn-icon" style="height:38px;width:38px;display:flex;align-items:center;justify-content:center;padding:0;background:rgba(255,255,255,0.03);border:1px solid var(--border);color:var(--text-secondary);" onclick="adjustModalValue(100, '${p.id}')">+100</button>
          </div>
          <div id="modal-diff-counter" class="diff-preview diff-zero" style="margin-top:2px;font-size:0.75rem;">—</div>
        </div>
      </div>
      <div style="display:flex;gap:12px;margin-top:12px;align-items:center;flex-wrap:wrap;">
        <div style="flex:1;min-width:200px;">
          <input type="text" id="modal-record-note" class="note-input" style="width:100%;height:38px;background:var(--bg-base);border:1px solid var(--border);border-radius:8px;padding:8px 12px;color:var(--text-primary)" placeholder="หมายเหตุ (ไม่บังคับ)..." />
        </div>
        <button class="btn btn-primary" style="height:38px;padding:0 16px;white-space:nowrap;" onclick="saveSingleRecord('${p.id}')">💾 บันทึกมิเตอร์</button>
      </div>
    </div>
  `;

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
    
    ${quickRecordHtml}

    <h3 style="font-size:0.92rem;margin:24px 0 12px 0;font-weight:600;display:flex;align-items:center;gap:6px;color:var(--text-secondary)">📋 ประวัติการบันทึกย้อนหลัง</h3>
    <div style="max-height:240px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;">
      <table style="width:100%;border-collapse:collapse;font-size:0.82rem">
        <thead>
          <tr style="background:rgba(255,255,255,0.05);position:sticky;top:0;z-index:1">
            <th style="text-align:left;padding:8px 10px;border-bottom:1px solid var(--border)">เดือน</th>
            <th style="text-align:right;padding:8px 10px;border-bottom:1px solid var(--border)">มิเตอร์สะสม</th>
            <th style="text-align:right;padding:8px 10px;border-bottom:1px solid var(--border);color:#a78bfa;background:rgba(124,58,237,0.08);border-left:1px solid rgba(124,58,237,0.2)">✨ ใช้ไป</th>
          </tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="3" style="text-align:center;padding:16px;color:var(--text-muted)">ไม่มีข้อมูล</td></tr>'}</tbody>
      </table>
    </div>
  `;

  document.getElementById('printer-detail-modal').classList.add('open');

  // ตั้งค่าเดือนเริ่มต้นเป็นเดือนปัจจุบัน และอัปเดตฟิลด์คำนวณมิเตอร์เดิมทันที
  const currentMonthStr = currentYearMonth();
  document.getElementById('modal-record-month').value = currentMonthStr;
  onModalMonthChange(p.id);
}

// ─── ฟังก์ชันสนับสนุนการบันทึกมิเตอร์ใน Modal ──────────────────────────────────────────

function onModalMonthChange(printerId) {
  const month = document.getElementById('modal-record-month').value;
  if (!month) return;

  const p = printers.find(x => x.id === printerId);
  if (!p) return;

  // ค้นหาประวัติก่อนหน้าเพื่อดึงยอดมิเตอร์เดิม
  const sortedMonths = [...allMonths].sort();
  const curMonthIdx = sortedMonths.indexOf(month);

  let prevRec = null;
  if (curMonthIdx > 0) {
    const prevMonths = sortedMonths.slice(0, curMonthIdx).reverse();
    for (const pm of prevMonths) {
      prevRec = [...records].reverse().find(r => r.printerId === p.id && r.month === pm);
      if (prevRec) break;
    }
  } else if (curMonthIdx === -1) {
    const prevMonths = [...sortedMonths].reverse();
    for (const pm of prevMonths) {
      if (pm < month) {
        prevRec = [...records].reverse().find(r => r.printerId === p.id && r.month === pm);
        if (prevRec) break;
      }
    }
  }

  const prevVal = prevRec ? (prevRec.counter !== undefined ? prevRec.counter : (prevRec.counterBW || 0)) : 0;

  // อัปเดตการแสดงผลมิเตอร์เดิมบนป้าย label
  document.getElementById('modal-prev-counter-label').textContent = fmtNum(prevVal);

  const input = document.getElementById('modal-ci-counter');
  input.dataset.prev = prevVal;

  // ตรวจสอบว่าเดือนนี้เคยบันทึกไปแล้วหรือไม่ หากมีให้ดึงมาแสดงเพื่อทำการแก้ไขได้
  const currentRecord = [...records].reverse().find(r => r.printerId === p.id && r.month === month);
  if (currentRecord) {
    input.value = currentRecord.counter !== undefined ? currentRecord.counter : '';
    document.getElementById('modal-record-note').value = currentRecord.note || '';
  } else {
    input.value = '';
    document.getElementById('modal-record-note').value = '';
  }

  // อัปเดตผลต่างตัวเลขแผ่นที่พิมพ์ไป
  updateModalDiff(printerId);
}

function updateModalDiff(printerId) {
  const p = printers.find(x => x.id === printerId);
  if (!p) return;

  const input = document.getElementById('modal-ci-counter');
  if (!input || input.disabled) return;

  const prev = input.dataset.prev !== '' ? Number(input.dataset.prev) : null;
  const curr = input.value !== '' ? Number(input.value) : null;
  const diffEl = document.getElementById('modal-diff-counter');

  if (curr === null || prev === null) {
    diffEl.textContent = '—';
    diffEl.className = 'diff-preview diff-zero';
    return;
  }

  const diff = curr - prev;
  if (diff > 0) {
    diffEl.textContent = `▲ ${fmtNum(diff)} แผ่น`;
    diffEl.className = 'diff-preview diff-positive';
  } else if (diff < 0) {
    diffEl.textContent = `⚠️ ${fmtNum(diff)}`;
    diffEl.className = 'diff-preview diff-negative';
  } else {
    diffEl.textContent = '0 แผ่น';
    diffEl.className = 'diff-preview diff-zero';
  }
}

function adjustModalValue(amount, printerId) {
  const input = document.getElementById('modal-ci-counter');
  if (!input || input.disabled) return;

  const prev = input.dataset.prev !== '' ? Number(input.dataset.prev) : 0;
  let curr = input.value !== '' ? Number(input.value) : prev;

  curr = Math.max(0, curr + amount);
  input.value = curr;

  updateModalDiff(printerId);
}

async function saveSingleRecord(printerId) {
  const month = document.getElementById('modal-record-month').value;
  if (!month) return showToast('กรุณาเลือกเดือน', 'error');

  const input = document.getElementById('modal-ci-counter');
  const noteInput = document.getElementById('modal-record-note');

  const counter = input.value !== '' ? Number(input.value) : null;
  const note = noteInput ? noteInput.value : '';

  if (counter === null) {
    return showToast('⚠️ กรุณากรอกข้อมูลมิเตอร์สะสมก่อนกดบันทึก', 'warning');
  }

  const entries = [{
    printerId: printerId,
    counter: counter,
    note: note
  }];

  showLoading(true);
  try {
    const res = await fetch(gsheetsUrl, {
      method: 'POST',
      body: JSON.stringify({
        action: 'saveRecords',
        month: month,
        entries: entries
      })
    }).then(r => r.json());

    if (res && res.success) {
      showToast('💾 บันทึกข้อมูลมิเตอร์เรียบร้อย!', 'success');
      await fetchAll();
      // รีโหลด Dashboard ด้านหลังด้วย
      loadDashboard();
      // เปิด Popup แสดงค่าล่าสุด
      openPrinterDetail(printerId);
    } else {
      throw new Error(res ? res.error : 'ไม่สามารถบันทึกข้อมูลได้');
    }
  } catch (err) {
    console.error('Error saving single record:', err);
    showToast('❌ บันทึกล้มเหลว: ' + err.message, 'error');
  } finally {
    showLoading(false);
  }
}

function showOverallDetail() {
  const latM = latestMonth();
  const monthStats = stats[latM] || {};

  const totalCounter = Object.values(monthStats).reduce((s, v) => s + (v.counter || 0), 0);
  const totalUsed = Object.values(monthStats).reduce((s, v) => s + (v.used || 0), 0);

  let rows = printers.map(p => {
    const st = monthStats[p.id];
    const counter = st ? st.counter : null;
    const used = st ? st.used : null;
    return `
      <tr>
        <td style="font-weight:600;color:${ZONE_COLORS[p.zone] || '#94a3b8'}">${p.zone}</td>
        <td>${p.location}</td>
        <td style="text-align:right;font-variant-numeric:tabular-nums">${counter !== null ? fmtNum(counter) : '—'}</td>
        <td style="text-align:right;font-variant-numeric:tabular-nums">${used != null ? fmtNum(used) : '—'}</td>
      </tr>`;
  }).join('');

  const body = document.getElementById('detail-printer-body');
  document.getElementById('detail-modal-title').textContent = `📊 สรุปยอดเดือน ${thMonth(latM)}`;
  body.innerHTML = `
    <div style="margin-bottom:20px">
      <div style="font-size:1rem;font-weight:600;margin-bottom:4px">📊 ${thMonth(latM)}</div>
      <div style="display:flex;gap:24px;margin-top:12px;flex-wrap:wrap">
        <div><span style="color:var(--text-muted)">มิเตอร์สะสมรวม:</span> <b>${fmtNum(totalCounter)}</b></div>
        <div><span style="color:var(--text-muted)">ยอดใช้ไปรวม:</span> <b style="color:#10b981">${totalUsed > 0 ? fmtNum(totalUsed) : '—'}</b></div>
      </div>
    </div>
    <div style="max-height:360px;overflow-y:auto">
      <table style="width:100%;border-collapse:collapse;font-size:0.82rem">
        <thead>
          <tr style="background:rgba(255,255,255,0.05)">
            <th style="text-align:left;padding:6px 10px;border-bottom:1px solid var(--border)">แผนก</th>
            <th style="text-align:left;padding:6px 10px;border-bottom:1px solid var(--border)">ห้อง/สถานที่</th>
            <th style="text-align:right;padding:6px 10px;border-bottom:1px solid var(--border)">มิเตอร์สะสมล่าสุด</th>
            <th style="text-align:right;padding:6px 10px;border-bottom:1px solid var(--border)">ใช้ไปเดือนนี้</th>
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

// ─── Month Select Setup ───────────────────────────────────────────────────────
function setupMonthSelects() {
  const sel = document.getElementById('dash-month-select');
  const months = allMonths.length ? allMonths : [currentYearMonth()];
  sel.innerHTML = [...months].reverse().map(m =>
    `<option value="${m}">${thMonth(m)}</option>`
  ).join('');
}

// ─── Utilities ────────────────────────────────────────────────────────────────
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
  if (el) {
    const d = new Date();
    el.textContent = d.toLocaleDateString('th-TH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }
}

function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  if (t) {
    t.textContent = msg;
    t.className = `toast ${type} show`;
    setTimeout(() => t.classList.remove('show'), 3500);
  }
}



// ค้นหารุ่นเครื่องพิมพ์ตาม Serial No. หรือสถานที่ตั้ง (อ้างอิงจากตารางสรุปมกราคม-พฤษภาคม)
function getPrinterModel(serial, location) {
  if (!serial) return '—';
  const s = String(serial).trim().toUpperCase();
  const loc = String(location).trim();

  // จับคู่ตาม Serial No.
  if (s.includes('9173RB20165')) return 'IM C4510';
  if (s.includes('4443RC20076')) return 'IM 4000';
  if (s.includes('9154R130684')) return 'IM C3010';
  if (s.includes('9173RB20195')) return 'IM C4500';
  if (s.includes('4443RC20088')) return 'IM 4000';
  if (s.includes('5323XA42068')) return 'P C600';
  if (s.includes('4443RC20066')) return 'IM 4000';
  if (s.includes('5323X941683')) return 'P C600';
  if (s.includes('4443RC20060')) return 'IM 4000';
  if (s.includes('5823P700770') || s.includes('58:38:79:65:68:FB')) return 'M C251FWB';
  if (s.includes('5323X941720')) return 'P C600';
  if (s.includes('5323XA42071') || s.includes('5323AA42071')) return 'P C600';
  if (s.includes('5323XA42065')) return 'P C600';
  if (s.includes('5323XA42070') || s.includes('5323AA42070')) return 'P C600';
  if (s.includes('5823PA00137') || s.includes('58:38:79:65:B7:52')) return 'M C251FWB';

  // ค้นหาตามชื่อห้อง (เผื่อมีการแก้ไข Serial หรือใช้ต่างออกไป)
  if (loc.includes('วิชาการ (มัธยม) - เครื่องใหญ่')) return 'IM C4510';
  if (loc.includes('อำนวยการ (มัธยม) - 2')) return 'IM 4000';
  if (loc.includes('อำนวยการ (มัธยม) - 1')) return 'IM C3010';
  if (loc.includes('ห้องประชุมกลาง (ประถม) - 1')) return 'IM C4500';
  if (loc.includes('ธุรการ (ประถม)')) return 'IM 4000';
  if (loc.includes('ทะเบียน (มัธยม)')) return 'P C600';
  if (loc.includes('ศูนย์ครู (อนุบาล) - 1')) return 'IM 4000';
  if (loc.includes('ศูนย์ครู (อนุบาล) - 2')) return 'P C600';
  if (loc.includes('ห้องประชุมกลาง (ประถม) - 2')) return 'IM 4000';
  if (loc.includes('ห้องประชุมกลาง (ประถม) - เครื่องสี')) return 'M C251FWB';
  if (loc.includes('PC4')) return 'P C600';
  if (loc.includes('PC2')) return 'P C600';
  if (loc.includes('PC1')) return 'P C600';
  if (loc.includes('PC3')) return 'P C600';
  if (loc.includes('วิชาการ (มัธยม) - เครื่องสีเล็ก')) return 'M C251FWB';

  return '—';
}

// ─── Realtime SNMP Auto-Fetch ────────────────────────────────────────────────
async function fetchRealtimeCounters() {
  const month = document.getElementById('record-month').value;
  if (!month) {
    showToast('⚠️ กรุณาเลือกเดือนก่อนดึงข้อมูล', 'warning');
    return;
  }
  
  // 1. ตรวจสอบว่ามีตารางฟอร์มหรือยัง ถ้าไม่มี ให้โหลดก่อน
  const recordTbody = document.getElementById('record-tbody');
  if (!recordTbody) {
    showLoading(true);
    await loadRecordForm();
  }
  
  showLoading(true);
  try {
    // ตรวจสอบว่าโฮสต์เป็น localhost หรือเป็นหน้าเว็บออนไลน์บน GitHub Pages
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const apiEndpoint = isLocal ? '/api/scan-realtime' : 'http://localhost:3000/api/scan-realtime';
    
    const res = await fetch(apiEndpoint).then(r => r.json());
    if (res && res.success) {
      const results = res.results || {};
      let count = 0;
      
      for (const pid in results) {
        const item = results[pid];
        const input = document.getElementById(`ci-counter-${pid}`);
        
        let val = 0;
        if (item.counter !== undefined) val = item.counter;
        else val = (item.counterBW || 0) + (item.counterColor || 0);

        if (input && val > 0) {
          input.value = val;
          updateDiff(pid);
          count++;
        }
      }
      
      if (count > 0) {
        showToast(`⚡ ดึงข้อมูล Realtime สำเร็จ ${count} เครื่อง!`, 'success');
      } else {
        showToast('⚠️ ดึงข้อมูลสำเร็จ แต่ไม่พบเครื่องพิมพ์ที่ออนไลน์ในเครือข่าย', 'warning');
      }
    } else {
      throw new Error(res.error || 'ดึงข้อมูลไม่สำเร็จ');
    }
  } catch (err) {
    console.error('Error fetching realtime counters:', err);
    showToast('❌ ไม่สามารถดึงข้อมูลได้: กรุณาเปิดรันไฟล์ server.py เพื่อใช้งานแบบมี API', 'error');
  } finally {
    showLoading(false);
  }
}
