/**
 * PageTurner <-> Google Sheets 2-Way Sync Bridge (10-Column BookLog)
 *
 * 1-Minute Setup inside your "PageTurner — Family Book Log" Google Sheet:
 * 1. Click Extensions -> Apps Script
 * 2. Paste this entire file and click Save
 * 3. Click Deploy -> New deployment -> Web app
 *    - Execute as: Me
 *    - Who has access: Anyone (keeps your sheet private; only the random URL can talk to it)
 * 4. Copy the Web App URL and paste it into PageTurner -> Library Card -> Google Sheet Sync
 */

const SHEET_NAME = 'BookLog';

function getBookLogSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0];
}

function doGet() {
  const sheet = getBookLogSheet();
  const values = sheet.getDataRange().getValues();
  const rows = [];

  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (!r[1]) continue;
    rows.push({
      date: r[0] instanceof Date ? Utilities.formatDate(r[0], 'America/Los_Angeles', 'yyyy-MM-dd') : String(r[0] || ''),
      title: String(r[1] || ''),
      author: String(r[2] || ''),
      reader: String(r[3] || '4-Year-Old'),
      status: String(r[4] || 'To Borrow'),
      source: String(r[5] || 'Added by Us'),
      theme: String(r[6] || 'Picture Book'),
      notes: String(r[7] || ''),
      catalogUrl: String(r[8] || ''),
      bibId: String(r[9] || ''),
    });
  }

  return ContentService.createTextOutput(JSON.stringify({ ok: true, rows })).setMimeType(
    ContentService.MimeType.JSON
  );
}

function doPost(e) {
  const sheet = getBookLogSheet();
  const body = JSON.parse(e.postData.contents || '{}');
  if (!body.title) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'Missing title' })).setMimeType(
      ContentService.MimeType.JSON
    );
  }

  const values = sheet.getDataRange().getValues();
  const norm = String(body.title).toLowerCase().trim();
  let existingRow = -1;

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][1] || '').toLowerCase().trim() === norm) {
      existingRow = i + 1;
      break;
    }
  }

  const rowValues = [
    body.date || Utilities.formatDate(new Date(), 'America/Los_Angeles', 'yyyy-MM-dd'),
    body.title,
    body.author || '',
    body.reader || '4-Year-Old',
    body.status || 'To Borrow',
    body.source || 'Added by Us',
    body.theme || 'Picture Book',
    body.notes || '',
    body.catalogUrl || '',
    body.bibId || '',
  ];

  if (existingRow > 0) {
    sheet.getRange(existingRow, 1, 1, rowValues.length).setValues([rowValues]);
  } else {
    sheet.appendRow(rowValues);
  }

  return ContentService.createTextOutput(JSON.stringify({ ok: true, updated: existingRow > 0 })).setMimeType(
    ContentService.MimeType.JSON
  );
}
