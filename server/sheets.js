/**
 * Two-way Google Sheet Book Log integration (10-column schema with Source column).
 */

function parseCsvLine(line) {
  const cols = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      cols.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  cols.push(cur.trim());
  return cols;
}

export function normalizeBookTitle(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function normalizeStatus(raw) {
  const s = String(raw || '').toLowerCase();
  if (s.includes('love') || s.includes('❤') || s.includes('favorite')) return 'loved';
  if (s.includes('like') || s.includes('👍')) return 'liked';
  if (s.includes('borrow') || s.includes('want') || s.includes('reserve')) return 'to_borrow';
  if (s.includes('hold')) return 'on_hold';
  if (s.includes('skip') || s.includes('didn') || s.includes('dislike') || s.includes('👎')) return 'skip';
  return 'read';
}

export function formatStatusForSheet(status) {
  const map = {
    to_borrow: 'To Borrow',
    on_hold: 'On Hold',
    loved: 'Loved ❤️',
    liked: 'Liked 👍',
    read: 'Read',
    skip: "Didn't Love 👎",
  };
  return map[status] || 'To Borrow';
}

export function parseBookLogCsv(csvText) {
  const lines = String(csvText || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((l) => l.trim().length > 0);

  if (lines.length === 0) return [];

  const firstRow = parseCsvLine(lines[0]).map((c) => c.toLowerCase());
  const hasHeader = firstRow.some((c) => c === 'title' || c === 'book' || c === 'date');

  let colMap = {
    date: 0,
    title: 1,
    author: 2,
    reader: 3,
    status: 4,
    source: 5,
    theme: 6,
    notes: 7,
    catalogUrl: 8,
    bibId: 9,
  };

  if (hasHeader) {
    const findIdx = (names) => firstRow.findIndex((h) => names.some((n) => h.includes(n)));
    const tIdx = findIdx(['title', 'book']);
    colMap = {
      date: findIdx(['date']),
      title: tIdx >= 0 ? tIdx : 0,
      author: findIdx(['author']),
      reader: findIdx(['reader', 'who', 'kid']),
      status: findIdx(['status', 'rating', 'liked']),
      source: findIdx(['source', 'list']),
      theme: findIdx(['theme', 'genre', 'topic']),
      notes: findIdx(['note', 'reaction', 'why', 'comment']),
      catalogUrl: findIdx(['link', 'url']),
      bibId: findIdx(['bib']),
    };
  } else if (firstRow.length <= 3) {
    colMap = {
      date: -1,
      title: 0,
      author: 1,
      reader: -1,
      status: 2,
      source: -1,
      theme: -1,
      notes: -1,
      catalogUrl: -1,
      bibId: -1,
    };
  }

  const start = hasHeader ? 1 : 0;
  const rows = [];
  for (let i = start; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    const get = (idx) => (idx >= 0 && idx < cols.length ? cols[idx].trim() : '');
    const title = get(colMap.title);
    if (!title) continue;
    rows.push({
      date: get(colMap.date) || new Date().toISOString().slice(0, 10),
      title,
      author: get(colMap.author),
      reader: get(colMap.reader) || '4-Year-Old',
      status: normalizeStatus(get(colMap.status) || 'to_borrow'),
      source: get(colMap.source) || 'Added by Us',
      theme: get(colMap.theme) || 'Picture Book',
      notes: get(colMap.notes),
      catalogUrl: get(colMap.catalogUrl),
      bibId: get(colMap.bibId),
    });
  }
  return rows;
}

export function exportBookLogCsv(entries) {
  const escCsv = (val) => {
    const s = String(val ?? '');
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const header = [
    'Date',
    'Title',
    'Author',
    'Reader',
    'Status',
    'Source',
    'Theme',
    "Notes / Why It's Great",
    'SMPL Link',
    'BibID',
  ];
  const lines = [header.map(escCsv).join(',')];
  for (const e of entries) {
    lines.push(
      [
        e.date || new Date().toISOString().slice(0, 10),
        e.title,
        e.author || '',
        e.reader || '4-Year-Old',
        formatStatusForSheet(e.status),
        e.source || 'Added by Us',
        e.theme || 'Picture Book',
        e.notes || '',
        e.catalogUrl || '',
        e.bibId || '',
      ]
        .map(escCsv)
        .join(',')
    );
  }
  return lines.join('\n');
}

export async function pullFromSheetWebhook(webhookUrl) {
  if (!webhookUrl) throw new Error('Google Sheet sync URL is not configured yet.');
  const res = await fetch(webhookUrl, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`Google Sheet sync returned status ${res.status}`);
  const data = await res.json();
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  return rows
    .filter((r) => r && r.title)
    .map((r) => ({
      date: r.date || new Date().toISOString().slice(0, 10),
      title: String(r.title).trim(),
      author: String(r.author || '').trim(),
      reader: String(r.reader || '4-Year-Old').trim(),
      status: normalizeStatus(r.status),
      source: String(r.source || 'Added by Us').trim(),
      theme: String(r.theme || 'Picture Book').trim(),
      notes: String(r.notes || '').trim(),
      catalogUrl: String(r.catalogUrl || '').trim(),
      bibId: String(r.bibId || '').trim(),
    }));
}

export async function pushEntryToSheetWebhook(webhookUrl, entry) {
  if (!webhookUrl) return { ok: false, skipped: true };
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      redirect: 'follow',
      body: JSON.stringify({
        action: 'upsert',
        date: entry.date || new Date().toISOString().slice(0, 10),
        title: entry.title,
        author: entry.author || '',
        reader: entry.reader || '4-Year-Old',
        status: formatStatusForSheet(entry.status),
        source: entry.source || 'Added by Us',
        theme: entry.theme || 'Picture Book',
        notes: entry.notes || '',
        catalogUrl: entry.catalogUrl || '',
        bibId: entry.bibId || '',
      }),
    });
    return { ok: res.ok };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function deleteEntryFromSheetWebhook(webhookUrl, title) {
  if (!webhookUrl || !title) return { ok: false, skipped: true };
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      redirect: 'follow',
      body: JSON.stringify({ action: 'delete', title }),
    });
    return { ok: res.ok };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
