const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3500;
const DATA_DIR = path.join(__dirname, 'data');
const PRINTERS_FILE = path.join(DATA_DIR, 'printers.json');
const RECORDS_FILE = path.join(DATA_DIR, 'records.json');

app.use(express.json());
app.use(express.static(__dirname));

// ─── Helpers ──────────────────────────────────────────────────────────────────
function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}
function generateId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
}

// ─── Printers API ─────────────────────────────────────────────────────────────
app.get('/api/printers', (req, res) => {
  const data = readJSON(PRINTERS_FILE);
  res.json(data.printers);
});

app.post('/api/printers', (req, res) => {
  const data = readJSON(PRINTERS_FILE);
  const printer = { id: generateId('P'), ...req.body };
  data.printers.push(printer);
  writeJSON(PRINTERS_FILE, data);
  res.status(201).json(printer);
});

app.put('/api/printers/:id', (req, res) => {
  const data = readJSON(PRINTERS_FILE);
  const idx = data.printers.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  data.printers[idx] = { ...data.printers[idx], ...req.body };
  writeJSON(PRINTERS_FILE, data);
  res.json(data.printers[idx]);
});

app.delete('/api/printers/:id', (req, res) => {
  const data = readJSON(PRINTERS_FILE);
  const before = data.printers.length;
  data.printers = data.printers.filter(p => p.id !== req.params.id);
  if (data.printers.length === before) return res.status(404).json({ error: 'Not found' });
  writeJSON(PRINTERS_FILE, data);
  res.json({ success: true });
});

// ─── Records API ──────────────────────────────────────────────────────────────
app.get('/api/records', (req, res) => {
  const data = readJSON(RECORDS_FILE);
  let records = data.records;
  if (req.query.month) records = records.filter(r => r.month === req.query.month);
  if (req.query.printerId) records = records.filter(r => r.printerId === req.query.printerId);
  res.json(records);
});

// บันทึกทีละเดือน (array of {printerId, counterBW, counterColor, note})
app.post('/api/records/batch', (req, res) => {
  const { month, entries } = req.body;
  if (!month || !Array.isArray(entries)) {
    return res.status(400).json({ error: 'month and entries[] required' });
  }
  const data = readJSON(RECORDS_FILE);

  const results = [];
  for (const entry of entries) {
    // ลบของเก่าในเดือนนั้นก่อน (ถ้ามี) แล้วใส่ใหม่
    data.records = data.records.filter(
      r => !(r.printerId === entry.printerId && r.month === month)
    );
    const record = {
      id: generateId('R'),
      printerId: entry.printerId,
      month,
      counterBW: Number(entry.counterBW) || 0,
      counterColor: Number(entry.counterColor) || 0,
      recordedAt: new Date().toISOString(),
      note: entry.note || ''
    };
    data.records.push(record);
    results.push(record);
  }

  writeJSON(RECORDS_FILE, data);
  res.status(201).json(results);
});

app.delete('/api/records/:id', (req, res) => {
  const data = readJSON(RECORDS_FILE);
  const before = data.records.length;
  data.records = data.records.filter(r => r.id !== req.params.id);
  if (data.records.length === before) return res.status(404).json({ error: 'Not found' });
  writeJSON(RECORDS_FILE, data);
  res.json({ success: true });
});

// ─── Statistics API ───────────────────────────────────────────────────────────
// คำนวณยอดใช้จริงแต่ละเดือน (counter ปัจจุบัน - counter เดือนก่อน)
app.get('/api/stats/monthly', (req, res) => {
  const printersData = readJSON(PRINTERS_FILE);
  const recordsData = readJSON(RECORDS_FILE);

  // หา months ที่มีข้อมูล
  const months = [...new Set(recordsData.records.map(r => r.month))].sort();

  const stats = {};
  for (const month of months) {
    stats[month] = {};
    for (const printer of printersData.printers) {
      const rec = recordsData.records.find(r => r.printerId === printer.id && r.month === month);
      if (!rec) continue;

      // หา record เดือนก่อนหน้า
      const monthIdx = months.indexOf(month);
      let usedBW = null;
      let usedColor = null;
      if (monthIdx > 0) {
        const prevMonth = months[monthIdx - 1];
        const prevRec = recordsData.records.find(r => r.printerId === printer.id && r.month === prevMonth);
        if (prevRec) {
          usedBW = rec.counterBW - prevRec.counterBW;
          usedColor = rec.counterColor - prevRec.counterColor;
        }
      }

      // สำหรับ record เก่าที่มีแค่ counter ให้ treat เป็น counterBW
      const counterBW = rec.counterBW !== undefined ? rec.counterBW : (rec.counter || 0);
      const counterColor = rec.counterColor !== undefined ? rec.counterColor : 0;

      stats[month][printer.id] = {
        counterBW,
        counterColor,
        usedBW,
        usedColor,
        recordedAt: rec.recordedAt
      };
    }
  }
  res.json({ months, stats });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🖨️  Counter Printer Tracker`);
  console.log(`   รันที่: http://localhost:${PORT}`);
  console.log(`   เครือข่าย: http://<IP เครื่องนี้>:${PORT}\n`);
});
