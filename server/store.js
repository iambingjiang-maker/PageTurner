import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { LIBRARY_CONFIG } from './config.js';
import { decryptSecret, encryptSecret, maskCardNumber } from './crypto.js';
import { normalizeBookTitle, normalizeStatus } from './sheets.js';
import { buildStarterBookLog } from './curatedSeed.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const VAULT_FILE = path.join(DATA_DIR, 'vault.json');

function addDaysIso(daysFromNow) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

function buildDemoSeed() {
  const demoCardId = 'card_demo_family';
  return {
    version: 4,
    settings: {
      familyName: 'Our Family',
      defaultBranch: 'main',
      autoSyncMinutes: Number(process.env.SYNC_INTERVAL_MINUTES ?? 30),
      autoScoutMonthly: true,
      lastScoutAt: null,
      googleSheetUrl: process.env.GOOGLE_SHEET_URL?.trim() || '',
      sheetWebhookEnc: process.env.GOOGLE_SHEET_WEBHOOK_URL?.trim()
        ? encryptSecret(process.env.GOOGLE_SHEET_WEBHOOK_URL.trim())
        : '',
      lastSheetSyncAt: null,
    },
    cards: [
      {
        id: demoCardId,
        label: 'Family Preview Card',
        shelfName: 'FAMILY',
        avatarColor: '#1F5E4B',
        defaultBranch: 'main',
        cardNumberEnc: '',
        pinEnc: '',
        isDemo: true,
        lastSyncedAt: new Date().toISOString(),
        lastSyncStatus: 'demo',
        lastSyncError: null,
      },
    ],
    holds: [
      {
        id: 'hold_demo_1',
        cardId: demoCardId,
        bibId: 'S76C3645337',
        title: 'Knight Owl',
        author: 'Christopher Denise',
        format: 'Picture Book',
        coverUrl: 'https://covers.openlibrary.org/b/isbn/9780316310628-M.jpg',
        status: 'ready',
        pickupBranch: 'main',
        pickupBy: addDaysIso(2),
        queuePosition: null,
        totalHolds: null,
        grabbed: false,
        catalogUrl: `${LIBRARY_CONFIG.catalogBaseUrl}/v2/search?query=Knight+Owl+Christopher+Denise&searchType=smart`,
        updatedAt: new Date().toISOString(),
        isDemo: true,
      },
      {
        id: 'hold_demo_2',
        cardId: demoCardId,
        bibId: 'S76C3645338',
        title: 'The Bakery Dragon',
        author: 'Devin Elle Kurtz',
        format: 'Picture Book',
        coverUrl: 'https://images.booksense.com/images/999/710/9780593710999.jpg',
        status: 'ready',
        pickupBranch: 'main',
        pickupBy: addDaysIso(5),
        queuePosition: null,
        totalHolds: null,
        grabbed: false,
        catalogUrl: `${LIBRARY_CONFIG.catalogBaseUrl}/v2/search?query=The+Bakery+Dragon+Devin+Elle+Kurtz&searchType=smart`,
        updatedAt: new Date().toISOString(),
        isDemo: true,
      },
      {
        id: 'hold_demo_3',
        cardId: demoCardId,
        bibId: 'S76C3645339',
        title: 'Secret Pizza Party',
        author: 'Adam Rubin',
        format: 'Picture Book',
        coverUrl: 'https://covers.openlibrary.org/b/isbn/9780803739475-M.jpg',
        status: 'ready',
        pickupBranch: 'main',
        pickupBy: addDaysIso(4),
        queuePosition: null,
        totalHolds: null,
        grabbed: false,
        catalogUrl: `${LIBRARY_CONFIG.catalogBaseUrl}/v2/search?query=Secret+Pizza+Party+Adam+Rubin&searchType=smart`,
        updatedAt: new Date().toISOString(),
        isDemo: true,
      },
      {
        id: 'hold_demo_4',
        cardId: demoCardId,
        bibId: 'S76C3645340',
        title: 'Hot Dog',
        author: 'Doug Salati',
        format: 'Picture Book',
        coverUrl: 'https://covers.openlibrary.org/b/isbn/9780593308431-M.jpg',
        status: 'in_transit',
        pickupBranch: 'main',
        pickupBy: null,
        queuePosition: 1,
        totalHolds: 1,
        grabbed: false,
        catalogUrl: `${LIBRARY_CONFIG.catalogBaseUrl}/v2/search?query=Hot+Dog+Doug+Salati&searchType=smart`,
        updatedAt: new Date().toISOString(),
        isDemo: true,
      },
    ],
    queue: [],
    bookLog: buildStarterBookLog(),
    history: [],
  };
}

let state = null;

function persist() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmpFile = `${VAULT_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2), { mode: 0o600 });
  fs.renameSync(tmpFile, VAULT_FILE);
}

function ensureMigrations() {
  if (!Array.isArray(state.bookLog) || state.bookLog.length === 0) {
    state.bookLog = buildStarterBookLog();
  }
  if (!state.settings) state.settings = {};
  if (state.settings.autoScoutMonthly === undefined) state.settings.autoScoutMonthly = true;
  if (state.settings.lastScoutAt === undefined) state.settings.lastScoutAt = null;
  if (state.settings.googleSheetUrl === undefined) {
    state.settings.googleSheetUrl = process.env.GOOGLE_SHEET_URL?.trim() || '';
  }
  if (state.settings.sheetWebhookEnc === undefined) {
    state.settings.sheetWebhookEnc = process.env.GOOGLE_SHEET_WEBHOOK_URL?.trim()
      ? encryptSecret(process.env.GOOGLE_SHEET_WEBHOOK_URL.trim())
      : '';
  }
}

function bootstrapEnvCard() {
  const envCardNumber = process.env.SMPL_CARD_NUMBER?.trim();
  const envPin = process.env.SMPL_PIN?.trim();
  if (!envCardNumber || !envPin) return;

  const existingEnv = state.cards.find((c) => c.id === 'card_env_primary');
  const cardData = {
    id: 'card_env_primary',
    label: process.env.SMPL_CARD_NAME?.trim() || 'Family Library Card',
    shelfName: (process.env.SMPL_SHELF_NAME?.trim() || 'FAMILY').toUpperCase(),
    avatarColor: '#1F5E4B',
    defaultBranch: 'main',
    cardNumberEnc: encryptSecret(envCardNumber),
    pinEnc: encryptSecret(envPin),
    isDemo: false,
    fromEnv: true,
    lastSyncedAt: existingEnv?.lastSyncedAt || null,
    lastSyncStatus: existingEnv?.lastSyncStatus || 'configured',
    lastSyncError: existingEnv?.lastSyncError || null,
  };

  state.cards = state.cards.filter((c) => !c.isDemo && c.id !== 'card_env_primary');
  state.cards.unshift(cardData);
  state.holds = state.holds.filter((h) => !h.isDemo);
  persist();
}

export function loadStore() {
  if (state) return state;
  if (fs.existsSync(VAULT_FILE)) {
    try {
      state = JSON.parse(fs.readFileSync(VAULT_FILE, 'utf8'));
    } catch {
      state = buildDemoSeed();
    }
  } else {
    state = buildDemoSeed();
    persist();
  }
  ensureMigrations();
  bootstrapEnvCard();
  return state;
}

export function resetStoreForTests(customState) {
  state = customState || buildDemoSeed();
  ensureMigrations();
  persist();
  return state;
}

export function getStore() {
  return loadStore();
}

export function hasLiveCard() {
  const s = loadStore();
  return s.cards.some((c) => !c.isDemo && Boolean(c.cardNumberEnc && c.pinEnc));
}

export function sanitizeCard(card) {
  const rawNumber = card.cardNumberEnc ? decryptSecret(card.cardNumberEnc) : '';
  return {
    id: card.id,
    label: card.label,
    shelfName: card.shelfName,
    avatarColor: card.avatarColor || '#1F5E4B',
    defaultBranch: 'main',
    maskedCardNumber: card.isDemo ? 'Preview Mode' : maskCardNumber(rawNumber),
    hasCredentials: !card.isDemo && Boolean(card.cardNumberEnc && card.pinEnc),
    isDemo: Boolean(card.isDemo),
    fromEnv: Boolean(card.fromEnv),
    lastSyncedAt: card.lastSyncedAt || null,
    lastSyncStatus: card.lastSyncStatus || 'idle',
    lastSyncError: card.lastSyncError || null,
  };
}

export function getPublicSettings() {
  const s = loadStore();
  return {
    familyName: s.settings.familyName || 'Our Family',
    defaultBranch: 'main',
    autoSyncMinutes: s.settings.autoSyncMinutes ?? 30,
    autoScoutMonthly: s.settings.autoScoutMonthly !== false,
    lastScoutAt: s.settings.lastScoutAt || null,
    googleSheetUrl: s.settings.googleSheetUrl || '',
    hasSheetWebhook: Boolean(s.settings.sheetWebhookEnc),
    lastSheetSyncAt: s.settings.lastSheetSyncAt || null,
  };
}

export function getSheetWebhookUrl() {
  const s = loadStore();
  return s.settings.sheetWebhookEnc ? decryptSecret(s.settings.sheetWebhookEnc) : '';
}

export function updateSheetConfig({ googleSheetUrl, webhookUrl }) {
  const s = loadStore();
  if (googleSheetUrl !== undefined) {
    s.settings.googleSheetUrl = String(googleSheetUrl || '').trim();
  }
  if (webhookUrl !== undefined) {
    const clean = String(webhookUrl || '').trim();
    s.settings.sheetWebhookEnc = clean ? encryptSecret(clean) : '';
  }
  persist();
  return getPublicSettings();
}

export function markSheetSynced() {
  const s = loadStore();
  s.settings.lastSheetSyncAt = new Date().toISOString();
  persist();
}

export function markScoutCompleted() {
  const s = loadStore();
  s.settings.lastScoutAt = new Date().toISOString();
  persist();
}

export function getDecryptedCard(cardId) {
  const s = loadStore();
  const card = s.cards.find((c) => c.id === cardId) || s.cards[0];
  if (!card) return null;
  return {
    ...card,
    cardNumber: decryptSecret(card.cardNumberEnc),
    pin: decryptSecret(card.pinEnc),
  };
}

export function addOrUpdateCard({ id, label, shelfName, avatarColor, cardNumber, pin }) {
  const s = loadStore();
  const cleanLabel = String(label || 'Family Card').trim();
  const cleanShelf = String(shelfName || cleanLabel).trim().toUpperCase().slice(0, 24);

  if (id) {
    const existing = s.cards.find((c) => c.id === id);
    if (!existing) throw new Error('Card not found');
    existing.label = cleanLabel;
    existing.shelfName = cleanShelf;
    if (avatarColor) existing.avatarColor = avatarColor;
    existing.defaultBranch = 'main';
    if (cardNumber && String(cardNumber).trim()) {
      existing.cardNumberEnc = encryptSecret(String(cardNumber).trim());
      existing.isDemo = false;
    }
    if (pin && String(pin).trim()) {
      existing.pinEnc = encryptSecret(String(pin).trim());
      existing.isDemo = false;
    }
    persist();
    return sanitizeCard(existing);
  }

  if (!cardNumber || !pin) {
    throw new Error('Library card number and PIN are required.');
  }

  const hadOnlyDemo = s.cards.every((c) => c.isDemo);
  if (hadOnlyDemo) {
    s.cards = [];
    s.holds = s.holds.filter((h) => !h.isDemo);
  }

  const newCard = {
    id: `card_${crypto.randomBytes(6).toString('hex')}`,
    label: cleanLabel,
    shelfName: cleanShelf,
    avatarColor: avatarColor || '#1F5E4B',
    defaultBranch: 'main',
    cardNumberEnc: encryptSecret(String(cardNumber).trim()),
    pinEnc: encryptSecret(String(pin).trim()),
    isDemo: false,
    fromEnv: false,
    lastSyncedAt: null,
    lastSyncStatus: 'configured',
    lastSyncError: null,
  };

  s.cards.push(newCard);
  persist();
  return sanitizeCard(newCard);
}

export function deleteCard(cardId) {
  const s = loadStore();
  const before = s.cards.length;
  s.cards = s.cards.filter((c) => c.id !== cardId);
  s.holds = s.holds.filter((h) => h.cardId !== cardId);
  if (s.cards.length === 0) {
    const fresh = buildDemoSeed();
    s.cards = fresh.cards;
    s.holds = fresh.holds;
  }
  persist();
  return s.cards.length !== before;
}

export function updateCardSyncMeta(cardId, { status, error = null }) {
  const s = loadStore();
  const card = s.cards.find((c) => c.id === cardId);
  if (!card) return;
  card.lastSyncedAt = new Date().toISOString();
  card.lastSyncStatus = status;
  card.lastSyncError = error;
  persist();
}

export function replaceCardHolds(cardId, fetchedHolds) {
  const s = loadStore();
  const prevGrabbed = new Map();
  for (const h of s.holds) {
    if (h.cardId === cardId && h.grabbed) {
      prevGrabbed.set(h.holdId || h.bibId || h.title.toLowerCase(), true);
    }
  }

  s.holds = s.holds.filter((h) => h.cardId !== cardId);
  for (const raw of fetchedHolds) {
    const key = raw.holdId || raw.bibId || raw.title.toLowerCase();
    s.holds.push({
      id: raw.id || `hold_${crypto.randomBytes(5).toString('hex')}`,
      holdId: raw.holdId || null,
      cardId,
      bibId: raw.bibId || '',
      title: raw.title,
      author: raw.author || '',
      format: raw.format || 'Book',
      coverUrl: raw.coverUrl || '',
      status: raw.status || 'waiting',
      pickupBranch: 'main',
      pickupBy: raw.pickupBy || null,
      queuePosition: raw.queuePosition ?? null,
      totalHolds: raw.totalHolds ?? null,
      grabbed: prevGrabbed.get(key) || false,
      catalogUrl: raw.catalogUrl || `${LIBRARY_CONFIG.catalogBaseUrl}/v2/search?query=${encodeURIComponent(raw.title)}`,
      updatedAt: new Date().toISOString(),
      isDemo: Boolean(raw.isDemo),
    });
  }
  persist();
}

export function addHoldRecord(hold) {
  const s = loadStore();
  const record = {
    id: hold.id || `hold_${crypto.randomBytes(6).toString('hex')}`,
    holdId: hold.holdId || null,
    cardId: hold.cardId,
    bibId: hold.bibId || '',
    title: hold.title,
    author: hold.author || '',
    format: hold.format || 'Picture Book',
    coverUrl: hold.coverUrl || '',
    status: hold.status || 'in_transit',
    pickupBranch: 'main',
    pickupBy: hold.pickupBy || null,
    queuePosition: hold.queuePosition ?? null,
    totalHolds: hold.totalHolds ?? null,
    grabbed: false,
    catalogUrl: hold.catalogUrl || `${LIBRARY_CONFIG.catalogBaseUrl}/v2/search?query=${encodeURIComponent(hold.title)}`,
    updatedAt: new Date().toISOString(),
    isDemo: Boolean(hold.isDemo),
  };
  s.holds.unshift(record);
  persist();
  return record;
}

export function toggleHoldGrabbed(holdId, grabbed) {
  const s = loadStore();
  const hold = s.holds.find((h) => h.id === holdId);
  if (!hold) return null;
  hold.grabbed = typeof grabbed === 'boolean' ? grabbed : !hold.grabbed;
  hold.updatedAt = new Date().toISOString();
  if (hold.grabbed) {
    s.history.unshift({
      id: `hist_${crypto.randomBytes(4).toString('hex')}`,
      title: hold.title,
      author: hold.author,
      pickupBranch: 'main',
      grabbedAt: new Date().toISOString(),
    });
    s.history = s.history.slice(0, 40);
  }
  persist();
  return hold;
}

export function updateHoldStatus(holdId, patch) {
  const s = loadStore();
  const hold = s.holds.find((h) => h.id === holdId);
  if (!hold) return null;
  Object.assign(hold, patch, { updatedAt: new Date().toISOString() });
  persist();
  return hold;
}

export function removeHoldRecord(holdId) {
  const s = loadStore();
  const idx = s.holds.findIndex((h) => h.id === holdId);
  if (idx === -1) return null;
  const [removed] = s.holds.splice(idx, 1);
  persist();
  return removed;
}

export function addQueueItem(item) {
  const s = loadStore();
  const record = {
    id: `q_${crypto.randomBytes(6).toString('hex')}`,
    title: String(item.title || '').trim(),
    author: String(item.author || '').trim(),
    format: item.format || 'Picture Book',
    coverUrl: item.coverUrl || '',
    bibId: item.bibId || '',
    requestedBy: String(item.requestedBy || '4-Year-Old').trim(),
    preferredBranch: 'main',
    targetCardId: item.targetCardId || s.cards[0]?.id || '',
    notes: String(item.notes || '').trim(),
    catalogUrl:
      item.catalogUrl ||
      `${LIBRARY_CONFIG.catalogBaseUrl}/v2/search?query=${encodeURIComponent(item.title || '')}&searchType=smart`,
    addedAt: new Date().toISOString(),
  };
  s.queue.unshift(record);
  persist();
  return record;
}

export function removeQueueItem(queueId) {
  const s = loadStore();
  const idx = s.queue.findIndex((q) => q.id === queueId);
  if (idx === -1) return null;
  const [removed] = s.queue.splice(idx, 1);
  persist();
  return removed;
}

/* ==========================================================================
   Family Book Log (Vetted NYT/B&N/Caldecott + Favorites + Monthly Scout)
   ========================================================================== */

export function upsertBookLogEntry(entry) {
  const s = loadStore();
  const title = String(entry.title || '').trim();
  if (!title) throw new Error('Book title is required.');

  const norm = normalizeBookTitle(title);
  const existing = s.bookLog.find((b) => normalizeBookTitle(b.title) === norm);

  if (existing) {
    if (entry.author) existing.author = String(entry.author).trim();
    if (entry.reader) existing.reader = String(entry.reader).trim();
    if (entry.status) existing.status = normalizeStatus(entry.status);
    if (entry.source) existing.source = String(entry.source).trim();
    if (entry.theme) existing.theme = String(entry.theme).trim();
    if (entry.notes !== undefined) existing.notes = String(entry.notes).trim();
    if (entry.coverUrl) existing.coverUrl = entry.coverUrl;
    if (entry.catalogUrl) existing.catalogUrl = entry.catalogUrl;
    if (entry.bibId) existing.bibId = entry.bibId;
    if (entry.smplAvailability) existing.smplAvailability = entry.smplAvailability;
    existing.date = entry.date || new Date().toISOString().slice(0, 10);
    persist();
    return existing;
  }

  const created = {
    id: `log_${crypto.randomBytes(6).toString('hex')}`,
    date: entry.date || new Date().toISOString().slice(0, 10),
    title,
    author: String(entry.author || '').trim(),
    reader: String(entry.reader || '4-Year-Old').trim(),
    status: normalizeStatus(entry.status || 'to_borrow'),
    source: String(entry.source || 'Added by Us').trim(),
    theme: String(entry.theme || 'Picture Book').trim(),
    notes: String(entry.notes || '').trim(),
    coverUrl: String(entry.coverUrl || '').trim(),
    catalogUrl:
      entry.catalogUrl ||
      `${LIBRARY_CONFIG.catalogBaseUrl}/v2/search?query=${encodeURIComponent(title)}&searchType=smart`,
    bibId: String(entry.bibId || '').trim(),
    smplAvailability: entry.smplAvailability || null,
  };

  s.bookLog.unshift(created);
  persist();
  return created;
}

export function patchBookLogEntry(id, patch) {
  const s = loadStore();
  const entry = s.bookLog.find((b) => b.id === id);
  if (!entry) return null;
  if (patch.status) entry.status = normalizeStatus(patch.status);
  if (patch.notes !== undefined) entry.notes = String(patch.notes).trim();
  if (patch.theme) entry.theme = String(patch.theme).trim();
  if (patch.reader) entry.reader = String(patch.reader).trim();
  persist();
  return entry;
}

export function applyAvailabilityUpdates(updatesMap) {
  const s = loadStore();
  let changed = 0;
  for (const entry of s.bookLog) {
    const avail = updatesMap.get(entry.id);
    if (!avail) continue;
    entry.smplAvailability = avail;
    if (avail.bibId) entry.bibId = avail.bibId;
    if (avail.coverUrl) entry.coverUrl = avail.coverUrl;
    if (avail.catalogUrl) entry.catalogUrl = avail.catalogUrl;
    changed += 1;
  }
  if (changed > 0) persist();
  return changed;
}

export function bulkMergeBookLog(rows) {
  let added = 0;
  let updated = 0;
  const s = loadStore();
  for (const row of rows) {
    if (!row?.title) continue;
    const norm = normalizeBookTitle(row.title);
    const exists = s.bookLog.some((b) => normalizeBookTitle(b.title) === norm);
    upsertBookLogEntry(row);
    if (exists) updated += 1;
    else added += 1;
  }
  return { added, updated, total: s.bookLog.length };
}

export function deleteBookLogEntry(id) {
  const s = loadStore();
  const idx = s.bookLog.findIndex((b) => b.id === id);
  if (idx === -1) return null;
  const [removed] = s.bookLog.splice(idx, 1);
  persist();
  return removed;
}

export function getBookLogMap() {
  const s = loadStore();
  const map = new Map();
  for (const entry of s.bookLog) {
    map.set(normalizeBookTitle(entry.title), entry.status);
  }
  return map;
}

export function getLovedBooks(readerFilter = null) {
  const s = loadStore();
  return s.bookLog.filter((b) => {
    const isFav = b.status === 'loved' || b.status === 'liked';
    if (!isFav) return false;
    if (!readerFilter) return true;
    return String(b.reader || '').toLowerCase().includes(readerFilter.toLowerCase());
  });
}

export function updateSettings(patch) {
  const s = loadStore();
  if (patch.familyName !== undefined) {
    s.settings.familyName = String(patch.familyName).trim() || 'Our Family';
  }
  s.settings.defaultBranch = 'main';
  if (patch.autoSyncMinutes !== undefined) {
    const mins = Number(patch.autoSyncMinutes);
    if (Number.isFinite(mins) && mins >= 0 && mins <= 1440) {
      s.settings.autoSyncMinutes = mins;
    }
  }
  if (patch.autoScoutMonthly !== undefined) {
    s.settings.autoScoutMonthly = Boolean(patch.autoScoutMonthly);
  }
  persist();
  return getPublicSettings();
}
