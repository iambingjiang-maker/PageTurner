import { LIBRARY_CONFIG, MAIN_BRANCH } from './config.js';
import { normalizeBookTitle } from './sheets.js';
import { resolveVerifiedCover } from './covers.js';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function fetchJson(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
        Referer: `${LIBRARY_CONFIG.catalogBaseUrl}/`,
      },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function isPhysical(formatCode = '') {
  const digital = new Set(['EBOOK', 'EAUDIOBOOK', 'EMAGAZINE', 'EMUSIC', 'EVIDEO', 'STREAMING_VIDEO', 'STREAMING_MUSIC']);
  return !digital.has(String(formatCode).toUpperCase());
}

function formatAuthor(authors) {
  const raw = Array.isArray(authors) ? authors[0] : authors;
  if (!raw) return '';
  const parts = String(raw).split(',').map((s) => s.trim());
  if (parts.length === 2 && parts[1] && !/^\d/.test(parts[1])) {
    return `${parts[1]} ${parts[0]}`;
  }
  return String(raw).trim();
}

function pickBestPhysicalBib(json, targetTitle) {
  const bibsMap = json?.entities?.bibs || {};
  const ids = json?.catalogSearch?.results?.map((r) => r.representative) || Object.keys(bibsMap);
  const targetNorm = normalizeBookTitle(targetTitle);
  const targetWords = targetNorm.split(' ').filter((w) => w.length > 2);

  for (const id of ids) {
    const bib = bibsMap[id];
    if (!bib) continue;
    const brief = bib.briefInfo || {};
    if (!isPhysical(brief.format || 'BK')) continue;

    const candNorm = normalizeBookTitle(brief.title || '');
    const exactMatch =
      candNorm === targetNorm || candNorm.startsWith(targetNorm) || targetNorm.startsWith(candNorm);
    if (exactMatch) return bib;

    // Also allow high word overlap (e.g., subtitle differences) without matching a different book in the series
    if (targetWords.length >= 2) {
      const matched = targetWords.filter((w) => candNorm.includes(w)).length;
      if (matched === targetWords.length) return bib;
    }
  }
  return null;
}

/**
 * Checks a single Book Log entry against San Mateo Main Library (7S) live availability
 * and guarantees a verified non-blank front cover JPEG/PNG via multi-source fallback.
 */
export async function lookupBookAtSanMateoMain(entry) {
  const query = `${entry.title} ${entry.author || ''}`.trim();

  // 1. Check specifically if a physical copy is ON THE SHELF at San Mateo Main Library (f_STATUS=7S) right now!
  const mainParams = new URLSearchParams({
    query,
    searchType: 'smart',
    f_PRIMARY_LANGUAGE: 'eng',
    f_STATUS: MAIN_BRANCH.statusFilterValue,
    limit: '6',
  });
  const mainJson = await fetchJson(`${LIBRARY_CONFIG.gatewayBaseUrl}/bibs/search?${mainParams.toString()}`);
  const mainBib = pickBestPhysicalBib(mainJson, entry.title);

  if (mainBib) {
    const brief = mainBib.briefInfo || {};
    const avail = mainBib.availability || {};
    const rawAvg = Number(brief.rating?.averageRating ?? 0);
    const verifiedCover = await resolveVerifiedCover({
      title: entry.title,
      author: entry.author,
      candidateUrls: [brief.jacket?.medium, brief.jacket?.large, brief.jacket?.small, entry.coverUrl],
    });
    return {
      status: 'on_shelf_main',
      label: 'On shelf at Main',
      availableCopies: Number(avail.availableCopies ?? 1),
      totalCopies: Number(avail.totalCopies ?? 1),
      holdsCount: Number(avail.heldCopies ?? 0),
      rating: rawAvg > 0 ? Math.round((rawAvg / 20) * 10) / 10 : null,
      ratingCount: Number(brief.rating?.totalCount ?? 0),
      bibId: mainBib.id,
      coverUrl: verifiedCover.url,
      catalogUrl: `${LIBRARY_CONFIG.catalogBaseUrl}/v2/record/${mainBib.id}`,
      checkedAt: new Date().toISOString(),
    };
  }

  // 2. Otherwise check Peninsula Library System availability (can be shipped free to San Mateo Main!)
  const sysParams = new URLSearchParams({
    query,
    searchType: 'smart',
    f_PRIMARY_LANGUAGE: 'eng',
    limit: '6',
  });
  const sysJson = await fetchJson(`${LIBRARY_CONFIG.gatewayBaseUrl}/bibs/search?${sysParams.toString()}`);
  const sysBib = pickBestPhysicalBib(sysJson, entry.title);

  if (sysBib) {
    const brief = sysBib.briefInfo || {};
    const avail = sysBib.availability || {};
    const availableCopies = Number(avail.availableCopies ?? 0);
    const totalCopies = Number(avail.totalCopies ?? 0);
    const holdsCount = Number(avail.heldCopies ?? 0);
    const rawAvg = Number(brief.rating?.averageRating ?? 0);
    const isAvail = availableCopies > 0 || avail.status === 'AVAILABLE';
    const verifiedCover = await resolveVerifiedCover({
      title: entry.title,
      author: entry.author,
      candidateUrls: [brief.jacket?.medium, brief.jacket?.large, brief.jacket?.small, entry.coverUrl],
    });

    return {
      status: isAvail ? 'available_system' : 'waitlist',
      label: isAvail ? 'Ships fast to Main' : `Waitlist (${holdsCount} holds)`,
      availableCopies,
      totalCopies,
      holdsCount,
      rating: rawAvg > 0 ? Math.round((rawAvg / 20) * 10) / 10 : null,
      ratingCount: Number(brief.rating?.totalCount ?? 0),
      bibId: sysBib.id,
      coverUrl: verifiedCover.url,
      catalogUrl: `${LIBRARY_CONFIG.catalogBaseUrl}/v2/record/${sysBib.id}`,
      checkedAt: new Date().toISOString(),
    };
  }

  const fallbackCover = await resolveVerifiedCover({
    title: entry.title,
    author: entry.author,
    candidateUrls: [entry.coverUrl],
  });

  return {
    status: 'not_found',
    label: 'Check catalog',
    availableCopies: 0,
    totalCopies: 0,
    holdsCount: 0,
    rating: null,
    ratingCount: 0,
    bibId: entry.bibId || '',
    coverUrl: fallbackCover.url,
    catalogUrl:
      entry.catalogUrl ||
      `${LIBRARY_CONFIG.catalogBaseUrl}/v2/search?query=${encodeURIComponent(query)}&searchType=smart`,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Checks San Mateo Main Library availability across multiple Book Log entries in fast parallel batches.
 */
export async function checkBooksAvailabilityBatch(entries, { concurrency = 5, maxCacheAgeMs = 2 * 60 * 60 * 1000, force = false } = {}) {
  const now = Date.now();
  const toCheck = entries.filter((e) => {
    if (force) return true;
    const checkedAt = e.smplAvailability?.checkedAt ? new Date(e.smplAvailability.checkedAt).getTime() : 0;
    return !checkedAt || now - checkedAt > maxCacheAgeMs;
  });

  const updates = new Map();
  for (let i = 0; i < toCheck.length; i += concurrency) {
    const chunk = toCheck.slice(i, i + concurrency);
    const results = await Promise.all(
      chunk.map(async (entry) => ({
        id: entry.id,
        availability: await lookupBookAtSanMateoMain(entry),
      }))
    );
    for (const r of results) {
      updates.set(r.id, r.availability);
    }
  }
  return updates;
}

/**
 * Monthly New-Book Scout:
 * Discovers fresh, vetted, unread kids' picture books & early graphic novels on San Mateo Main Library's shelves
 * using (1) your 4-year-old's favorite authors, (2) newest 4+ star acquisitions, and (3) award-winning picture books.
 */
export async function runMonthlyNewBookScout({ existingLog = [], maxAdd = 8 } = {}) {
  const existingTitles = new Set(existingLog.map((b) => normalizeBookTitle(b.title)));
  const today = new Date().toISOString().slice(0, 10);
  const monthLabel = new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  const sourceLabel = `Monthly Scout · ${monthLabel}`;

  // Collect favorite authors from Loved ❤️ / Liked 👍 entries + vetted superstar picture-book creators
  const favAuthors = [];
  for (const b of existingLog) {
    if ((b.status === 'loved' || b.status === 'liked') && b.author) {
      favAuthors.push(b.author);
    }
  }
  const extraTrustedAuthors = [
    'Jory John',
    'Ryan T. Higgins',
    'Mac Barnett',
    'Jon Klassen',
    'Drew Daywalt',
    'Mo Willems',
    'Aaron Reynolds',
    'Julia Donaldson',
  ];
  const uniqueAuthors = Array.from(new Set([...favAuthors, ...extraTrustedAuthors]));

  // Rotate which authors we scout based on current month + log size so each monthly run brings fresh gems
  const startIdx = (new Date().getMonth() + existingLog.length) % uniqueAuthors.length;
  const scoutAuthors = [
    uniqueAuthors[startIdx],
    uniqueAuthors[(startIdx + 1) % uniqueAuthors.length],
    uniqueAuthors[(startIdx + 2) % uniqueAuthors.length],
  ];

  const queries = [
    // 1. Freshly acquired kids books physically on the shelf at San Mateo Main right now
    {
      notePrefix: 'New arrival at San Mateo Main Library',
      theme: 'Picture Book',
      params: {
        query: 'formatcode:(BK)',
        searchType: 'bl',
        f_AUDIENCE: 'juvenile',
        f_PRIMARY_LANGUAGE: 'eng',
        f_STATUS: MAIN_BRANCH.statusFilterValue,
        f_NEWLY_ACQUIRED: 'PAST_60_DAYS',
        sort: 'newly_acquired',
        limit: '10',
      },
    },
    // 2. High-rated picture books on shelf at Main matching award / humor tags
    {
      notePrefix: '4+ star reader favorite at San Mateo Main',
      theme: 'Funny & Silly',
      params: {
        query: 'picture book funny dragon OR monkey OR truck',
        searchType: 'smart',
        f_FORMAT: 'BK',
        f_AUDIENCE: 'juvenile',
        f_PRIMARY_LANGUAGE: 'eng',
        f_STATUS: MAIN_BRANCH.statusFilterValue,
        f_UGC_RATING: 'FOUR_PLUS_STARS',
        sort: 'ugc_rating',
        limit: '10',
      },
    },
    // 3. Unread books by your 4-year-old's favorite authors on shelf at Main!
    ...scoutAuthors.map((author) => ({
      notePrefix: `By favorite author ${author}`,
      theme: 'Picture Book',
      params: {
        query: author,
        searchType: 'author',
        f_FORMAT: 'BK',
        f_AUDIENCE: 'juvenile',
        f_PRIMARY_LANGUAGE: 'eng',
        f_STATUS: MAIN_BRANCH.statusFilterValue,
        limit: '8',
      },
    })),
  ];

  const discovered = [];
  const seen = new Set(existingTitles);

  for (const q of queries) {
    if (discovered.length >= maxAdd) break;
    const p = new URLSearchParams(q.params);
    const json = await fetchJson(`${LIBRARY_CONFIG.gatewayBaseUrl}/bibs/search?${p.toString()}`);
    if (!json) continue;

    const bibsMap = json?.entities?.bibs || {};
    const ids = json?.catalogSearch?.results?.map((r) => r.representative) || Object.keys(bibsMap);

    let addedFromQuery = 0;
    for (const id of ids) {
      if (discovered.length >= maxAdd || addedFromQuery >= 2) break;
      const bib = bibsMap[id];
      if (!bib) continue;
      const brief = bib.briefInfo || {};
      const avail = bib.availability || {};
      if (!isPhysical(brief.format || 'BK')) continue;

      const title = String(brief.title || '').trim();
      const author = formatAuthor(brief.authors);
      const norm = normalizeBookTitle(title);
      if (!title || !author || !norm || seen.has(norm)) continue;

      const rawAvg = Number(brief.rating?.averageRating ?? 0);
      const rating = rawAvg > 0 ? Math.round((rawAvg / 20) * 10) / 10 : null;
      const ratingCount = Number(brief.rating?.totalCount ?? 0);

      // Avoid low-rated books (never add anything rated below 3.8 stars)
      if (rating !== null && rating < 3.8) continue;

      seen.add(norm);
      addedFromQuery += 1;

      const verifiedCover = await resolveVerifiedCover({
        title,
        author,
        candidateUrls: [brief.jacket?.medium, brief.jacket?.large, brief.jacket?.small],
      });

      discovered.push({
        date: today,
        title,
        author,
        reader: '4-Year-Old',
        status: 'to_borrow',
        source: sourceLabel,
        theme: q.theme,
        notes: `${q.notePrefix}${rating ? ` · ★ ${rating.toFixed(1)}` : ''}${brief.description ? ` — ${brief.description.slice(0, 110)}` : ''}`,
        coverUrl: verifiedCover.url,
        catalogUrl: `${LIBRARY_CONFIG.catalogBaseUrl}/v2/record/${bib.id || id}`,
        bibId: bib.id || id,
        smplAvailability: {
          status: 'on_shelf_main',
          label: 'On shelf at Main',
          availableCopies: Number(avail.availableCopies ?? 1),
          totalCopies: Number(avail.totalCopies ?? 1),
          holdsCount: Number(avail.heldCopies ?? 0),
          rating,
          ratingCount,
          bibId: bib.id || id,
          coverUrl: verifiedCover.url,
          catalogUrl: `${LIBRARY_CONFIG.catalogBaseUrl}/v2/record/${bib.id || id}`,
          checkedAt: new Date().toISOString(),
        },
      });
    }
  }

  return discovered;
}
