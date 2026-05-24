/**
 * Google Apps Script - Counter Printer Tracker
 * ใส่ใน Apps Script ของ Google Sheet
 * วิธี: Extensions → Apps Script
 */

function doPost(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

  if (e.postData && e.postData.contents) {
    const data = JSON.parse(e.postData.contents);

    if (data.action === 'appendRecord') {
      // data: { month, printerId, location, serial, counterBW, counterColor, note }
      const row = [
        data.month,
        data.printerId,
        data.location,
        data.serial || '',
        data.zone || '',
        data.type || '',
        data.counterBW || 0,
        data.counterColor || 0,
        (data.counterBW || 0) + (data.counterColor || 0), // รวม
        data.note || '',
        new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }),
        data.recordedAt || new Date().toISOString()
      ];
      sheet.appendRow(row);
      return ContentService.createTextOutput(JSON.stringify({ success: true }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (data.action === 'batchAppend') {
      // data: { month, entries: [...] }
      const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
      const rows = data.entries.map(entry => [
        data.month,
        entry.printerId,
        entry.location,
        entry.serial || '',
        entry.zone || '',
        entry.type || '',
        entry.counterBW || 0,
        entry.counterColor || 0,
        (entry.counterBW || 0) + (entry.counterColor || 0),
        entry.note || '',
        now,
        new Date().toISOString()
      ]);
      rows.forEach(row => sheet.appendRow(row));
      return ContentService.createTextOutput(JSON.stringify({ success: true, count: rows.length }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }

  return ContentService.createTextOutput(JSON.stringify({ error: 'Invalid data' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({ status: 'ok', message: 'Counter Printer Tracker API is running' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ฟังก์ชันสำหรับลบแถวสุดท้าย (ทดสอบ)
function testAppend() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  sheet.appendRow(['TEST', 'TEST', 'TEST', 'TEST', 'TEST', 'TEST', 1, 2, 3, 'note', new Date().toISOString()]);
}
