import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LIBRARY_CONFIG, MAIN_BRANCH, getMainBranchWithStatus } from './config.js';
import {
  handlePasscodeLogin,
  handlePasscodeLogout,
  isAuthenticated,
  isPasscodeEnabled,
  requireFamilyAuth,
} from './auth.js';
import {
  addHoldRecord,
  addOrUpdateCard,
  addQueueItem,
  applyAvailabilityUpdates,
  bulkMergeBookLog,
  deleteBookLogEntry,
  deleteCard,
  getBookLogMap,
  getDecryptedCard,
  getLovedBooks,
  getPublicSettings,
  getSheetWebhookUrl,
  getStore,
  hasLiveCard,
  markScoutCompleted,
  markSheetSynced,
  patchBookLogEntry,
  removeHoldRecord,
  removeQueueItem,
  replaceBookLogFromSheet,
  replaceCardHolds,
  sanitizeCard,
  toggleHoldGrabbed,
  updateCardSyncMeta,
  updateHoldStatus,
  updateSettings,
  updateSheetConfig,
  upsertBookLogEntry,
} from './store.js';
import {
  BiblioCommonsClient,
  DISCOVER_AISLES,
  discoverBooks,
  findSimilarBooks,
  recommendFromFavorites,
  searchCatalog,
} from './bibliocommons.js';
import {
  deleteEntryFromSheetWebhook,
  exportBookLogCsv,
  parseBookLogCsv,
  pullFromSheetWebhook,
  pushEntryToSheetWebhook,
} from './sheets.js';
import { checkBooksAvailabilityBatch, runMonthlyNewBookScout } from './scout.js';
import { resolveVerifiedCover } from './covers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

async function syncCardHolds(cardId) {
  const card = getDecryptedCard(cardId);
  if (!card) return { ok: false, error: 'Card not found' };

  if (card.isDemo || !card.cardNumber || !card.pin) {
    updateCardSyncMeta(card.id, { status: 'demo', error: null });
    return { ok: true, mode: 'demo', syncedCount: getStore().holds.filter((h) => h.cardId === card.id).length };
  }

  const client = new BiblioCommonsClient();
  try {
    const loginResult = await client.login(card.cardNumber, card.pin);
    if (!loginResult.ok) {
      updateCardSyncMeta(card.id, { status: 'error', error: loginResult.error });
      return { ok: false, error: loginResult.error, requiresBrowser: Boolean(loginResult.requiresBrowser) };
    }

    const holds = await client.fetchHolds();
    replaceCardHolds(card.id, holds);
    updateCardSyncMeta(card.id, { status: 'synced', error: null });
    return { ok: true, mode: 'live', syncedCount: holds.length };
  } catch (err) {
    const msg = err?.message || 'Unable to reach San Mateo Main Library right now.';
    updateCardSyncMeta(card.id, { status: 'error', error: msg });
    return { ok: false, error: msg };
  }
}

async function placeSingleHold({ title, author, format, coverUrl, bibId, cardId, catalogUrl, queueItemId }) {
  const store = getStore();
  const card = getDecryptedCard(cardId || store.cards[0]?.id);
  if (!card) {
    return { ok: false, statusCode: 400, error: 'No library card configured.' };
  }

  const logAndPush = async (record) => {
    const entry = upsertBookLogEntry({
      title: record.title,
      author: record.author,
      reader: '4-Year-Old',
      status: 'on_hold',
      coverUrl: record.coverUrl,
      catalogUrl: record.catalogUrl,
      bibId: record.bibId,
    });
    const webhookUrl = getSheetWebhookUrl();
    if (webhookUrl) {
      await pushEntryToSheetWebhook(webhookUrl, entry).catch(() => {});
    }
  };

  if (card.isDemo || !card.cardNumber || !card.pin) {
    const newHold = addHoldRecord({
      cardId: card.id,
      bibId: bibId || '',
      title: String(title).trim(),
      author: String(author || '').trim(),
      format: format || 'Picture Book',
      coverUrl: coverUrl || '',
      status: 'ready',
      pickupBranch: 'main',
      pickupBy: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      catalogUrl,
      isDemo: true,
    });
    if (queueItemId) removeQueueItem(queueItemId);
    await logAndPush(newHold);
    return {
      ok: true,
      mode: 'demo',
      message: `Reserved “${newHold.title}” for San Mateo Main Library pickup!`,
      hold: newHold,
    };
  }

  const client = new BiblioCommonsClient();
  try {
    const loginRes = await client.login(card.cardNumber, card.pin);
    if (!loginRes.ok) {
      updateCardSyncMeta(card.id, { status: 'error', error: loginRes.error });
      return {
        ok: false,
        statusCode: 502,
        error: loginRes.error,
        requiresBrowser: Boolean(loginRes.requiresBrowser),
        fallbackUrl:
          catalogUrl ||
          `${LIBRARY_CONFIG.catalogBaseUrl}/v2/search?query=${encodeURIComponent(title)}&searchType=smart`,
      };
    }

    const placeRes = await client.placeHold({ bibId, title });
    if (!placeRes.ok) {
      return {
        ok: false,
        statusCode: 502,
        error: placeRes.error,
        fallbackUrl: placeRes.fallbackUrl,
      };
    }

    const newHold = addHoldRecord({
      holdId: placeRes.holdId,
      cardId: card.id,
      bibId: placeRes.bibId || bibId || '',
      title: String(title).trim(),
      author: String(author || '').trim(),
      format: format || 'Picture Book',
      coverUrl: coverUrl || '',
      status: 'in_transit',
      pickupBranch: 'main',
      catalogUrl: placeRes.catalogUrl || catalogUrl,
      isDemo: false,
    });
    if (queueItemId) removeQueueItem(queueItemId);
    await logAndPush(newHold);

    if (process.env.VERCEL) {
      await syncCardHolds(card.id).catch(() => {});
    } else {
      syncCardHolds(card.id).catch(() => {});
    }

    return {
      ok: true,
      mode: 'live',
      message: `Reserved “${newHold.title}” at San Mateo Main Library!`,
      hold: newHold,
    };
  } catch (err) {
    return {
      ok: false,
      statusCode: 502,
      error: err?.message || 'Failed to place hold with San Mateo Main Library.',
      fallbackUrl:
        catalogUrl ||
        `${LIBRARY_CONFIG.catalogBaseUrl}/v2/search?query=${encodeURIComponent(title)}&searchType=smart`,
    };
  }
}

/**
 * Keeps stateless serverless instances (Vercel) automatically in sync with your Google Sheet
 * and live San Mateo Main Library holds on cold starts.
 */
async function ensureCloudHydrated({ forceSheet = false } = {}) {
  const store = getStore();

  // 1. Hydrate Book Log from Google Sheet if webhook configured and stale (> 5 min)
  const webhookUrl = getSheetWebhookUrl();
  if (webhookUrl) {
    const lastSheet = store.settings.lastSheetSyncAt ? new Date(store.settings.lastSheetSyncAt).getTime() : 0;
    if (forceSheet || !lastSheet || Date.now() - lastSheet > 5 * 60 * 1000) {
      try {
        const rows = await pullFromSheetWebhook(webhookUrl);
        if (rows.length > 0) replaceBookLogFromSheet(rows);
      } catch {
        // Keep cached/starter bookLog if sheet is momentarily unreachable
      }
    }
  }

  // 2. Refresh live holds from San Mateo Main Library on cold start (> 15 min stale)
  for (const c of store.cards) {
    if (c.isDemo || !c.cardNumberEnc || !c.pinEnc) continue;
    const lastSync = c.lastSyncedAt ? new Date(c.lastSyncedAt).getTime() : 0;
    if (!lastSync || Date.now() - lastSync > 15 * 60 * 1000) {
      await syncCardHolds(c.id).catch(() => {});
    }
  }
}

async function executeMonthlyScout(maxAdd = 8) {
  await ensureCloudHydrated({ forceSheet: true });
  const store = getStore();
  const discovered = await runMonthlyNewBookScout({
    existingLog: store.bookLog,
    maxAdd,
  });

  const addedEntries = [];
  const webhookUrl = getSheetWebhookUrl();

  for (const item of discovered) {
    const saved = upsertBookLogEntry(item);
    addedEntries.push(saved);
    if (webhookUrl) {
      await pushEntryToSheetWebhook(webhookUrl, saved).catch(() => {});
    }
  }

  markScoutCompleted();
  return { addedCount: addedEntries.length, books: addedEntries };
}

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, app: 'PageTurner', library: LIBRARY_CONFIG.name, vercel: Boolean(process.env.VERCEL) });
  });

  // Scheduled Monthly New-Book Scout endpoint (triggered automatically by vercel.json Cron)
  app.get('/api/cron/monthly-scout', async (req, res) => {
    const expected = process.env.CRON_SECRET?.trim();
    if (expected) {
      const authHeader = String(req.headers.authorization || '');
      if (authHeader !== `Bearer ${expected}`) {
        return res.status(401).json({ error: 'Unauthorized cron request' });
      }
    }
    try {
      const outcome = await executeMonthlyScout(6);
      return res.json({ ok: true, ...outcome });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/auth/status', (req, res) => {
    res.json({
      passcodeEnabled: isPasscodeEnabled(),
      authenticated: isAuthenticated(req),
      libraryName: LIBRARY_CONFIG.name,
    });
  });
  app.post('/api/auth/login', handlePasscodeLogin);
  app.post('/api/auth/logout', handlePasscodeLogout);

  app.use('/api', requireFamilyAuth);

  // Main bootstrap payload for the UI
  app.get('/api/dashboard', async (_req, res) => {
    await ensureCloudHydrated();
    const store = getStore();
    const branch = getMainBranchWithStatus();
    const cards = store.cards.map(sanitizeCard);
    const cardMap = Object.fromEntries(cards.map((c) => [c.id, c]));

    const enrichedHolds = store.holds.map((h) => ({
      ...h,
      branch: MAIN_BRANCH,
      cardLabel: cardMap[h.cardId]?.label || 'Family Card',
      shelfName: cardMap[h.cardId]?.shelfName || 'FAMILY',
      avatarColor: cardMap[h.cardId]?.avatarColor || '#1F5E4B',
    }));

    const readyCount = enrichedHolds.filter((h) => h.status === 'ready' && !h.grabbed).length;
    const transitCount = enrichedHolds.filter((h) => h.status === 'in_transit').length;
    const waitingCount = enrichedHolds.filter((h) => h.status === 'waiting' || h.status === 'paused').length;
    const toBorrowCount = store.bookLog.filter((b) => b.status === 'to_borrow').length;
    const lovedCount = store.bookLog.filter((b) => b.status === 'loved' || b.status === 'liked').length;
    const onShelfAtMainCount = store.bookLog.filter(
      (b) => b.status === 'to_borrow' && b.smplAvailability?.status === 'on_shelf_main'
    ).length;

    res.json({
      library: LIBRARY_CONFIG,
      mode: hasLiveCard() ? 'live' : 'demo',
      passcodeEnabled: isPasscodeEnabled(),
      settings: getPublicSettings(),
      branch,
      branches: [branch],
      aisles: DISCOVER_AISLES.map(({ id, label, subtitle }) => ({ id, label, subtitle })),
      cards,
      holds: enrichedHolds,
      queue: store.queue,
      bookLog: store.bookLog,
      history: store.history.slice(0, 12),
      summary: {
        readyCount,
        transitCount,
        waitingCount,
        toBorrowCount,
        lovedCount,
        onShelfAtMainCount,
        logCount: store.bookLog.length,
      },
    });
  });

  // Live personalized recommendations based on Logged ❤️ Favorites
  app.get('/api/catalog/for-you', async (req, res) => {
    const { mainOnly = 'true', offset = '0' } = req.query;
    const kidFavorites = getLovedBooks('4');
    const favorites = kidFavorites.length > 0 ? kidFavorites : getLovedBooks();
    const data = await recommendFromFavorites({
      favorites,
      logMap: getBookLogMap(),
      mainOnly: mainOnly !== 'false',
      offset: Number(offset) || 0,
    });
    res.json(data);
  });

  // Live curated discovery aisles
  app.get('/api/catalog/discover', async (req, res) => {
    const { aisle = 'age4_picture', mainOnly = 'true', hideRead = 'true', page = '1' } = req.query;
    const data = await discoverBooks({
      aisleId: String(aisle),
      mainOnly: mainOnly !== 'false',
      hideRead: hideRead !== 'false',
      page: Number(page) || 1,
      logMap: getBookLogMap(),
    });
    res.json(data);
  });

  // "Find Books Like..."
  app.get('/api/catalog/similar', async (req, res) => {
    const { q = '', mainOnly = 'true', hideRead = 'true' } = req.query;
    const data = await findSimilarBooks({
      query: String(q),
      mainOnly: mainOnly !== 'false',
      hideRead: hideRead !== 'false',
      logMap: getBookLogMap(),
    });
    res.json(data);
  });

  // Direct catalog search
  app.get('/api/catalog/search', async (req, res) => {
    const { q = '', format = 'physical', audience = 'all', mainOnly = 'false', hideRead = 'false' } = req.query;
    const data = await searchCatalog({
      query: String(q),
      format: String(format),
      audience: String(audience),
      mainOnly: mainOnly === 'true',
      hideRead: hideRead === 'true',
      logMap: getBookLogMap(),
    });
    res.json(data);
  });

  // Sync holds across one or all cards
  app.post('/api/holds/sync', async (req, res) => {
    const store = getStore();
    const { cardId } = req.body || {};
    const targetCards = cardId ? store.cards.filter((c) => c.id === cardId) : store.cards;
    const results = [];
    for (const c of targetCards) {
      const outcome = await syncCardHolds(c.id);
      results.push({ cardId: c.id, label: c.label, ...outcome });
    }
    res.json({ ok: results.every((r) => r.ok), results });
  });

  // Place a single hold
  app.post('/api/holds/place', async (req, res) => {
    const { title } = req.body || {};
    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: 'Book title is required.' });
    }
    const result = await placeSingleHold(req.body || {});
    if (!result.ok) {
      return res.status(result.statusCode || 502).json(result);
    }
    return res.json(result);
  });

  // 1-Click Batch Reserve Selected Books from Book Log!
  app.post('/api/holds/place-batch', async (req, res) => {
    const { logIds = [], cardId } = req.body || {};
    if (!Array.isArray(logIds) || logIds.length === 0) {
      return res.status(400).json({ error: 'Select at least one book to reserve.' });
    }

    const store = getStore();
    const results = [];
    for (const id of logIds) {
      const entry = store.bookLog.find((b) => b.id === id);
      if (!entry) continue;
      const outcome = await placeSingleHold({
        title: entry.title,
        author: entry.author,
        format: entry.theme || 'Picture Book',
        coverUrl: entry.coverUrl,
        bibId: entry.bibId || entry.smplAvailability?.bibId || '',
        catalogUrl: entry.catalogUrl,
        cardId,
      });
      results.push({ id: entry.id, title: entry.title, ...outcome });
    }

    const succeeded = results.filter((r) => r.ok).length;
    res.json({
      ok: succeeded > 0,
      succeeded,
      total: results.length,
      results,
      message: `Reserved ${succeeded} of ${results.length} ${results.length === 1 ? 'book' : 'books'} at San Mateo Main Library!`,
    });
  });

  app.patch('/api/holds/:id/grab', (req, res) => {
    const hold = toggleHoldGrabbed(req.params.id, req.body?.grabbed);
    if (!hold) return res.status(404).json({ error: 'Hold not found' });
    res.json({ ok: true, hold });
  });

  app.patch('/api/holds/:id', (req, res) => {
    const allowed = {};
    if (['ready', 'in_transit', 'waiting', 'paused'].includes(req.body?.status)) {
      allowed.status = req.body.status;
    }
    const hold = updateHoldStatus(req.params.id, allowed);
    if (!hold) return res.status(404).json({ error: 'Hold not found' });
    res.json({ ok: true, hold });
  });

  app.delete('/api/holds/:id', async (req, res) => {
    const store = getStore();
    const existing = store.holds.find((h) => h.id === req.params.id);
    if (!existing) return res.status(404).json({ error: 'Hold not found' });

    const card = getDecryptedCard(existing.cardId);
    if (card && !card.isDemo && card.cardNumber && card.pin && existing.holdId) {
      try {
        const client = new BiblioCommonsClient();
        const loginRes = await client.login(card.cardNumber, card.pin);
        if (loginRes.ok) {
          await client.cancelHold({ holdId: existing.holdId, bibId: existing.bibId });
        }
      } catch {
        // Allow local cleanup
      }
    }

    removeHoldRecord(req.params.id);
    res.json({ ok: true });
  });

  // Queue endpoints (kept for backward compatibility)
  app.post('/api/queue', (req, res) => {
    if (!req.body?.title || !String(req.body.title).trim()) {
      return res.status(400).json({ error: 'Title is required.' });
    }
    const item = addQueueItem(req.body);
    res.status(201).json({ ok: true, item });
  });

  app.delete('/api/queue/:id', (req, res) => {
    const removed = removeQueueItem(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Queue item not found' });
    res.json({ ok: true });
  });

  // =========================================================================
  // Family Book Log, Live San Mateo Availability Check & Monthly Scout
  // =========================================================================

  // Self-healing cover endpoint: checks multi-source cascade and caches verified cover back into Book Log
  app.get('/api/covers/resolve', async (req, res) => {
    const { title = '', author = '', logId = '' } = req.query;
    if (!title) return res.status(400).json({ url: '' });
    const found = await resolveVerifiedCover({
      title: String(title),
      author: String(author),
      candidateUrls: [],
    });
    if (found.url && logId) {
      const store = getStore();
      const entry = store.bookLog.find((b) => b.id === String(logId));
      if (entry) {
        entry.coverUrl = found.url;
        upsertBookLogEntry(entry);
      }
    }
    res.json({ ok: Boolean(found.url), url: found.url, source: found.source });
  });

  app.post('/api/log', async (req, res) => {
    try {
      const payload = { ...(req.body || {}) };
      if (payload.title && !payload.coverUrl) {
        const resolved = await resolveVerifiedCover({
          title: payload.title,
          author: payload.author || '',
          candidateUrls: [],
        }).catch(() => ({ url: '' }));
        if (resolved.url) payload.coverUrl = resolved.url;
      }
      const entry = upsertBookLogEntry(payload);
      const webhookUrl = getSheetWebhookUrl();
      let sheetPushed = false;
      if (webhookUrl) {
        const pushRes = await pushEntryToSheetWebhook(webhookUrl, entry);
        sheetPushed = Boolean(pushRes.ok);
        if (sheetPushed) markSheetSynced();
      }
      res.status(201).json({ ok: true, entry, sheetPushed });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.patch('/api/log/:id', async (req, res) => {
    const updated = patchBookLogEntry(req.params.id, req.body || {});
    if (!updated) return res.status(404).json({ error: 'Log entry not found' });
    const webhookUrl = getSheetWebhookUrl();
    if (webhookUrl) {
      await pushEntryToSheetWebhook(webhookUrl, updated).catch(() => {});
    }
    res.json({ ok: true, entry: updated });
  });

  app.delete('/api/log/:id', async (req, res) => {
    const removed = deleteBookLogEntry(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Log entry not found' });
    const webhookUrl = getSheetWebhookUrl();
    if (webhookUrl) {
      await deleteEntryFromSheetWebhook(webhookUrl, removed.title).catch(() => {});
    }
    res.json({ ok: true });
  });

  // Check San Mateo Main Library live availability across To Borrow books in Book Log
  app.post('/api/log/check-availability', async (req, res) => {
    const store = getStore();
    const force = Boolean(req.body?.force);
    const targets = store.bookLog.filter((b) => b.status === 'to_borrow');
    const updates = await checkBooksAvailabilityBatch(targets, { force, concurrency: 6 });
    const checkedCount = applyAvailabilityUpdates(updates);
    const onShelfMain = store.bookLog.filter(
      (b) => b.status === 'to_borrow' && b.smplAvailability?.status === 'on_shelf_main'
    ).length;
    res.json({
      ok: true,
      checkedCount,
      totalToBorrow: targets.length,
      onShelfMain,
    });
  });

  // Run Monthly New-Book Scout on demand
  app.post('/api/scout/run', async (req, res) => {
    try {
      const maxAdd = Math.max(1, Math.min(12, Number(req.body?.maxAdd) || 6));
      const outcome = await executeMonthlyScout(maxAdd);
      res.json({
        ok: true,
        ...outcome,
        message:
          outcome.addedCount > 0
            ? `Scout found ${outcome.addedCount} new vetted books on the shelf at San Mateo Main and added them to your Book Log!`
            : 'Your Book Log is already up to date with the latest San Mateo Main picks!',
      });
    } catch (err) {
      res.status(502).json({ error: err.message || 'Scout could not reach San Mateo Main Library right now.' });
    }
  });

  app.post('/api/log/import-csv', (req, res) => {
    const csvText = req.body?.csv || '';
    const rows = parseBookLogCsv(csvText);
    if (rows.length === 0) {
      return res.status(400).json({ error: 'No book titles found in the pasted CSV or list.' });
    }
    const summary = bulkMergeBookLog(rows);
    res.json({ ok: true, ...summary });
  });

  app.get('/api/log/export.csv', (_req, res) => {
    const csv = exportBookLogCsv(getStore().bookLog);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="pageturner-book-log.csv"');
    res.send(csv);
  });

  app.put('/api/sheets/config', (req, res) => {
    const updated = updateSheetConfig(req.body || {});
    res.json({ ok: true, settings: updated });
  });

  app.post('/api/sheets/sync', async (_req, res) => {
    const webhookUrl = getSheetWebhookUrl();
    if (!webhookUrl) {
      return res.status(400).json({
        error: 'Add your Google Sheet Apps Script Web App URL in Vercel Env Vars or Card & Sheet first.',
      });
    }
    try {
      const rows = await pullFromSheetWebhook(webhookUrl);
      const summary = replaceBookLogFromSheet(rows);
      markSheetSynced();
      res.json({ ok: true, added: 0, updated: summary.total, total: summary.total });
    } catch (err) {
      res.status(502).json({ error: err.message || 'Could not sync with Google Sheet.' });
    }
  });

  // Cards & Settings
  app.post('/api/cards', async (req, res) => {
    try {
      const saved = addOrUpdateCard(req.body || {});
      let syncResult = null;
      if (req.body?.testAndSync !== false && saved.hasCredentials) {
        syncResult = await syncCardHolds(saved.id);
      }
      res.status(201).json({ ok: true, card: saved, syncResult });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.put('/api/cards/:id', (req, res) => {
    try {
      const saved = addOrUpdateCard({ ...(req.body || {}), id: req.params.id });
      res.json({ ok: true, card: saved });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/cards/:id', (req, res) => {
    deleteCard(req.params.id);
    res.json({ ok: true });
  });

  app.put('/api/settings', (req, res) => {
    const updated = updateSettings(req.body || {});
    res.json({ ok: true, settings: updated });
  });

  app.use(express.static(PUBLIC_DIR));

  app.get('/{*splat}', (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });

  return app;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isMain) {
  const PORT = Number(process.env.PORT || 3000);
  const app = createApp();

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`PageTurner (San Mateo Main Library) running on http://localhost:${PORT}`);
  });

  const store = getStore();
  const intervalMins = Number(store.settings.autoSyncMinutes ?? 30);
  if (intervalMins > 0) {
    setInterval(() => {
      const current = getStore();
      for (const c of current.cards) {
        if (!c.isDemo && c.cardNumberEnc && c.pinEnc) {
          syncCardHolds(c.id).catch(() => {});
        }
      }
    }, intervalMins * 60 * 1000).unref();
  }

  // Monthly New-Book Scout scheduler (checks daily if 30+ days have elapsed since last scout)
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  setInterval(() => {
    const current = getStore();
    if (current.settings.autoScoutMonthly === false) return;
    const last = current.settings.lastScoutAt ? new Date(current.settings.lastScoutAt).getTime() : 0;
    if (last && Date.now() - last < THIRTY_DAYS_MS) return;
    executeMonthlyScout(6).catch(() => {});
  }, 24 * 60 * 60 * 1000).unref();
}
