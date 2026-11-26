import { LIBRARY_CONFIG, MAIN_BRANCH } from './config.js';
import { normalizeBookTitle } from './sheets.js';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * Curated live discovery aisles tailored for a 4-year-old + parents at San Mateo Main Library (7S).
 */
export const DISCOVER_AISLES = [
  {
    id: 'age4_picture',
    label: 'Age 4 Picture Books',
    subtitle: '4+ star English picture books sitting on the shelf at San Mateo Main right now',
    params: {
      query: 'picture book',
      searchType: 'smart',
      f_FORMAT: 'BK',
      f_AUDIENCE: 'juvenile',
      f_PRIMARY_LANGUAGE: 'eng',
      f_UGC_RATING: 'FOUR_PLUS_STARS',
      sort: 'ugc_rating',
    },
  },
  {
    id: 'new_picture',
    label: 'New Picture Books',
    subtitle: 'Brand-new 2025–2026 children’s arrivals just added to San Mateo Main',
    params: {
      query: 'formatcode:(BK)',
      searchType: 'bl',
      f_AUDIENCE: 'juvenile',
      f_PRIMARY_LANGUAGE: 'eng',
      f_NEWLY_ACQUIRED: 'PAST_60_DAYS',
      sort: 'newly_acquired',
    },
  },
  {
    id: 'funny_aloud',
    label: 'Funny Read-Alouds',
    subtitle: 'Silly, giggle-inducing picture books 4-year-olds ask to read over and over',
    params: {
      query: 'funny picture book humorous stories',
      searchType: 'smart',
      f_FORMAT: 'BK',
      f_AUDIENCE: 'juvenile',
      f_PRIMARY_LANGUAGE: 'eng',
      f_UGC_RATING: 'FOUR_PLUS_STARS',
      sort: 'relevancy',
    },
  },
  {
    id: 'bedtime',
    label: 'Bedtime & Cozy',
    subtitle: 'Gentle, rhythmic wind-down stories for cozy bedtime reading',
    params: {
      query: 'bedtime goodnight sleep',
      searchType: 'smart',
      f_FORMAT: 'BK',
      f_AUDIENCE: 'juvenile',
      f_PRIMARY_LANGUAGE: 'eng',
      f_UGC_RATING: 'FOUR_PLUS_STARS',
      sort: 'relevancy',
    },
  },
  {
    id: 'trucks_dinos',
    label: 'Trucks, Dinos & Animals',
    subtitle: 'Excavators, trains, dinosaurs, and animals for curious preschoolers',
    params: {
      query: 'trucks OR dinosaurs OR trains',
      searchType: 'smart',
      f_FORMAT: 'BK',
      f_AUDIENCE: 'juvenile',
      f_PRIMARY_LANGUAGE: 'eng',
      f_UGC_RATING: 'FOUR_PLUS_STARS',
      sort: 'relevancy',
    },
  },
  {
    id: 'caldecott',
    label: 'Caldecott & Classics',
    subtitle: 'Award-winning illustrated books and timeless favorites',
    params: {
      query: 'Caldecott Medal',
      searchType: 'smart',
      f_FORMAT: 'BK',
      f_AUDIENCE: 'juvenile',
      f_PRIMARY_LANGUAGE: 'eng',
      f_UGC_RATING: 'FOUR_PLUS_STARS',
      sort: 'relevancy',
    },
  },
  {
    id: 'parents_picks',
    label: 'Parents’ Picks',
    subtitle: '4+ star adult fiction & nonfiction ready on the shelf at Main',
    params: {
      query: 'formatcode:(BK)',
      searchType: 'bl',
      f_AUDIENCE: 'adult',
      f_FICTION_TYPE: 'FICTION',
      f_PRIMARY_LANGUAGE: 'eng',
      f_UGC_RATING: 'FOUR_PLUS_STARS',
      sort: 'ugc_rating',
    },
  },
];

const CURATED_FALLBACK_BOOKS = [
  {
    bibId: 'S76C3645337',
    title: 'The Gruffalo',
    author: 'Julia Donaldson',
    year: '1999',
    format: 'Picture Book',
    audience: 'Kids',
    rating: 4.8,
    ratingCount: 410,
    coverUrl: 'https://covers.openlibrary.org/b/isbn/9780142403877-M.jpg',
    status: 'AVAILABLE',
    availableCopies: 8,
    totalCopies: 15,
    holdsCount: 0,
    onShelfAtMain: true,
    description: 'A clever little mouse strolls through the deep dark wood, outsmarting predators with tales of a Gruffalo.',
  },
  {
    bibId: 'S76C3645338',
    title: 'The Day the Crayons Quit',
    author: 'Drew Daywalt',
    year: '2013',
    format: 'Picture Book',
    audience: 'Kids',
    rating: 4.7,
    ratingCount: 620,
    coverUrl: 'https://covers.openlibrary.org/b/isbn/9780399255373-M.jpg',
    status: 'AVAILABLE',
    availableCopies: 6,
    totalCopies: 14,
    holdsCount: 1,
    onShelfAtMain: true,
    description: 'Poor Duncan just wants to color—but when he opens his crayon box, all he finds are hilarious letters of complaint!',
  },
];

function buildSearchUrl(query) {
  return `${LIBRARY_CONFIG.catalogBaseUrl}/v2/search?query=${encodeURIComponent(query)}&searchType=smart`;
}

function buildRecordUrl(bibId, fallbackQuery) {
  if (bibId && /^S\d+C\d+/.test(bibId)) {
    return `${LIBRARY_CONFIG.catalogBaseUrl}/v2/record/${bibId}`;
  }
  return buildSearchUrl(fallbackQuery || '');
}

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  ingest(response) {
    const rawCookies =
      typeof response.headers.getSetCookie === 'function'
        ? response.headers.getSetCookie()
        : response.headers.get('set-cookie')
          ? [response.headers.get('set-cookie')]
          : [];

    for (const line of rawCookies) {
      if (!line) continue;
      const [pair] = line.split(';');
      const eqIdx = pair.indexOf('=');
      if (eqIdx <= 0) continue;
      const name = pair.slice(0, eqIdx).trim();
      const val = pair.slice(eqIdx + 1).trim();
      if (val === '' || val === 'deleted') {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, val);
      }
    }
  }

  header() {
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function formatBiblioFormat(code) {
  const map = {
    BK: 'Book',
    LPRINT: 'Large Print',
    GRAPHIC_NOVEL: 'Graphic Novel',
    AB: 'Audiobook CD',
    BOOK_CD: 'Book + CD',
    DVD: 'DVD',
    BLURAY: 'Blu-ray',
    BOARD_BK: 'Board Book',
    PICTURE_BOOK: 'Picture Book',
    EBOOK: 'eBook',
    EAUDIOBOOK: 'eAudiobook',
  };
  return map[code] || code || 'Book';
}

function isPhysicalFormat(formatCode = '') {
  const digital = new Set(['EBOOK', 'EAUDIOBOOK', 'EMAGAZINE', 'EMUSIC', 'EVIDEO', 'STREAMING_VIDEO', 'STREAMING_MUSIC']);
  return !digital.has(String(formatCode).toUpperCase());
}

function formatAuthorName(authors) {
  const raw = Array.isArray(authors) ? authors[0] : authors;
  if (!raw) return '';
  const parts = String(raw).split(',').map((s) => s.trim());
  if (parts.length === 2 && parts[1] && !/^\d/.test(parts[1])) {
    return `${parts[1]} ${parts[0]}`;
  }
  return String(raw).trim();
}

function parseBiblioResults(json, { physicalOnly = true, onShelfAtMain = false } = {}) {
  const bibsMap = json?.entities?.bibs || {};
  const itemIds = json?.catalogSearch?.results?.map((r) => r.representative) || Object.keys(bibsMap);
  const seenTitles = new Set();
  const parsed = [];

  for (const id of itemIds) {
    const bib = bibsMap[id];
    if (!bib) continue;
    const brief = bib.briefInfo || {};
    const avail = bib.availability || {};
    const fmtCode = brief.format || 'BK';
    if (physicalOnly && !isPhysicalFormat(fmtCode)) continue;

    const title = brief.title || 'Untitled';
    const author = formatAuthorName(brief.authors);
    const dedupeKey = `${title.toLowerCase().trim()}::${author.toLowerCase().trim()}`;
    if (seenTitles.has(dedupeKey)) continue;
    seenTitles.add(dedupeKey);

    const availableCopies = Number(avail.availableCopies ?? 0);
    const totalCopies = Number(avail.totalCopies ?? 0);
    const holdsCount = Number(avail.heldCopies ?? avail.holdsCount ?? 0);
    const status =
      avail.status || (availableCopies > 0 ? 'AVAILABLE' : totalCopies > 0 ? 'CHECKED_OUT' : 'ON_ORDER');

    const rawAvg = Number(brief.rating?.averageRating ?? 0);
    const rating = rawAvg > 0 ? Math.round((rawAvg / 20) * 10) / 10 : null;
    const ratingCount = Number(brief.rating?.totalCount ?? 0);

    parsed.push({
      bibId: bib.id || id,
      title,
      subtitle: brief.subtitle || '',
      author,
      year: brief.publicationDate || '',
      format: formatBiblioFormat(fmtCode),
      formatCode: fmtCode,
      audience: Array.isArray(brief.audiences) ? brief.audiences[0] || '' : '',
      rating,
      ratingCount,
      coverUrl: brief.jacket?.medium || brief.jacket?.large || brief.jacket?.small || '',
      status,
      availableCopies,
      totalCopies,
      holdsCount,
      onShelfAtMain: Boolean(onShelfAtMain),
      subjects: Array.isArray(brief.subjectHeadings) ? brief.subjectHeadings.slice(0, 4) : [],
      series: Array.isArray(brief.series) && brief.series[0]?.name ? brief.series[0].name : '',
      description: brief.description || '',
      catalogUrl: buildRecordUrl(bib.id || id, `${title} ${author}`),
      canDirectHold: true,
    });
  }

  return parsed;
}

async function queryBiblioGateway(paramsObj, { onShelfAtMain = false, physicalOnly = true } = {}) {
  const params = new URLSearchParams(paramsObj);
  if (onShelfAtMain) {
    params.set('f_STATUS', MAIN_BRANCH.statusFilterValue);
  }
  const url = `${LIBRARY_CONFIG.gatewayBaseUrl}/bibs/search?${params.toString()}`;
  const res = await fetchWithTimeout(
    url,
    {
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
        Referer: `${LIBRARY_CONFIG.catalogBaseUrl}/`,
      },
    },
    8500
  );
  if (!res.ok) throw new Error(`Catalog status ${res.status}`);
  const json = await res.json();
  return {
    totalCount: Number(json?.catalogSearch?.pagination?.count ?? 0),
    results: parseBiblioResults(json, { physicalOnly, onShelfAtMain }),
  };
}

function decorateAndFilterLogStatus(results, { logMap = new Map(), hideRead = false } = {}) {
  const enriched = [];
  let hiddenReadCount = 0;

  for (const book of results) {
    const loggedStatus = logMap.get(normalizeBookTitle(book.title)) || null;
    const isAlreadyRead = ['loved', 'liked', 'read', 'skip'].includes(loggedStatus);
    if (hideRead && isAlreadyRead) {
      hiddenReadCount += 1;
      continue;
    }
    enriched.push({ ...book, loggedStatus });
  }
  return { results: enriched, hiddenReadCount };
}

/**
 * Curated Discovery Aisles — live books at San Mateo Main Library!
 */
export async function discoverBooks({
  aisleId = 'age4_picture',
  mainOnly = true,
  page = 1,
  logMap = new Map(),
  hideRead = true,
} = {}) {
  const aisle = DISCOVER_AISLES.find((a) => a.id === aisleId) || DISCOVER_AISLES[0];
  const safePage = Math.max(1, Math.min(20, Number(page) || 1));

  try {
    const { totalCount, results } = await queryBiblioGateway(
      {
        ...aisle.params,
        page: String(safePage),
        limit: '20',
      },
      { onShelfAtMain: mainOnly, physicalOnly: true }
    );

    const filtered = decorateAndFilterLogStatus(results, { logMap, hideRead });

    if (filtered.results.length > 0) {
      return {
        aisle,
        aisles: DISCOVER_AISLES.map(({ id, label, subtitle }) => ({ id, label, subtitle })),
        mainOnly,
        hideRead,
        hiddenReadCount: filtered.hiddenReadCount,
        page: safePage,
        totalCount,
        source: 'smpl_live',
        sourceLabel: mainOnly
          ? `Live at San Mateo Main Library · ${totalCount.toLocaleString()} matches on shelf`
          : `Live Peninsula Library Catalog · ${totalCount.toLocaleString()} matches`,
        results: filtered.results,
      };
    }
  } catch {
    // Fall through cleanly
  }

  const fallback = decorateAndFilterLogStatus(
    CURATED_FALLBACK_BOOKS.map((b) => ({
      ...b,
      catalogUrl: buildSearchUrl(`${b.title} ${b.author}`),
    })),
    { logMap, hideRead }
  );

  return {
    aisle,
    aisles: DISCOVER_AISLES.map(({ id, label, subtitle }) => ({ id, label, subtitle })),
    mainOnly,
    hideRead,
    hiddenReadCount: fallback.hiddenReadCount,
    page: 1,
    totalCount: fallback.results.length,
    source: 'curated_offline',
    sourceLabel: 'Curated San Mateo Main Library Favorites',
    results: fallback.results,
  };
}

/**
 * "Picked for Our 4-Year-Old" — Reads your family's Loved ❤️ books from the Book Log / Google Sheet,
 * finds unread books by those favorite authors & themes sitting on San Mateo Main Library's shelf right now,
 * and automatically hides every book you've already read!
 */
export async function recommendFromFavorites({
  favorites = [],
  logMap = new Map(),
  mainOnly = true,
  offset = 0,
} = {}) {
  if (!favorites || favorites.length === 0) {
    return discoverBooks({ aisleId: 'age4_picture', mainOnly, page: 1, logMap, hideRead: true });
  }

  const readSet = new Set();
  for (const [normTitle, status] of logMap.entries()) {
    if (['loved', 'liked', 'read', 'skip'].includes(status)) readSet.add(normTitle);
  }

  // Rotate through logged favorites so every click on "Fresh Picks" brings new ideas!
  const rotated = [];
  for (let i = 0; i < favorites.length; i += 1) {
    rotated.push(favorites[(i + offset) % favorites.length]);
  }
  const seeds = rotated.slice(0, 3);

  const combined = [];
  const seen = new Set();

  const pushUnique = (items, reason) => {
    for (const item of items) {
      const norm = normalizeBookTitle(item.title);
      if (!norm || readSet.has(norm) || seen.has(norm)) continue;
      seen.add(norm);
      combined.push({ ...item, matchReason: reason, loggedStatus: null });
    }
  };

  for (const fav of seeds) {
    const isKid = !String(fav.reader || '').toLowerCase().includes('parent');
    const audience = isKid ? 'juvenile' : 'adult';

    if (fav.author) {
      const byAuthor = await queryBiblioGateway(
        {
          query: fav.author,
          searchType: 'author',
          f_FORMAT: 'BK',
          f_AUDIENCE: audience,
          f_PRIMARY_LANGUAGE: 'eng',
          limit: '8',
        },
        { onShelfAtMain: mainOnly, physicalOnly: true }
      ).catch(() => ({ results: [] }));
      pushUnique(byAuthor.results, `Because you ❤️ ${fav.title}`);
    }

    const themeQuery =
      fav.theme && fav.theme !== 'Picture Book'
        ? `${fav.theme.replace(/&/g, '')} picture book`
        : `${fav.title}`;

    const byTheme = await queryBiblioGateway(
      {
        query: themeQuery,
        searchType: 'smart',
        f_FORMAT: 'BK',
        f_AUDIENCE: audience,
        f_PRIMARY_LANGUAGE: 'eng',
        f_UGC_RATING: 'FOUR_PLUS_STARS',
        limit: '8',
      },
      { onShelfAtMain: mainOnly, physicalOnly: true }
    ).catch(() => ({ results: [] }));
    pushUnique(byTheme.results, `Similar to ${fav.title}`);
  }

  if (combined.length > 0) {
    return {
      source: 'smpl_live',
      mainOnly,
      basedOn: seeds.map((s) => s.title),
      sourceLabel: `Fresh unread picks based on ${seeds.map((s) => `“${s.title}”`).join(', ')}`,
      results: combined.slice(0, 15),
    };
  }

  return discoverBooks({ aisleId: 'age4_picture', mainOnly, page: (offset % 5) + 1, logMap, hideRead: true });
}

/**
 * "Find Books Like..." — looks up a favorite title in San Mateo's catalog and surfaces
 * next books in the series, same-author gems, and similar subject reads available at Main Library.
 */
export async function findSimilarBooks({ query = '', mainOnly = true, logMap = new Map(), hideRead = true } = {}) {
  const clean = String(query || '').trim();
  if (!clean) {
    return discoverBooks({ aisleId: 'age4_picture', mainOnly, page: 1, logMap, hideRead });
  }

  try {
    const seedSearch = await queryBiblioGateway(
      { query: clean, searchType: 'smart', f_FORMAT: 'BK', f_PRIMARY_LANGUAGE: 'eng', limit: '8' },
      { onShelfAtMain: false, physicalOnly: true }
    );
    const seed = seedSearch.results[0];

    const combined = [];
    const seen = new Set();
    const pushUnique = (items, reason) => {
      for (const item of items) {
        const key = `${item.title.toLowerCase()}::${item.author.toLowerCase()}`;
        if (seen.has(key)) continue;
        if (seed && item.title.toLowerCase() === seed.title.toLowerCase()) continue;
        seen.add(key);
        combined.push({ ...item, matchReason: reason });
      }
    };

    const audienceFilter =
      seed?.audience && /juvenile|children/i.test(seed.audience)
        ? 'juvenile'
        : seed?.audience && /adult/i.test(seed.audience)
          ? 'adult'
          : undefined;

    if (seed?.series) {
      const cleanSeries = seed.series
        .replace(/^[^;]+?\b\d{4}-\s*/i, '')
        .replace(/\s*\(Series\)\s*$/i, '')
        .trim();
      const seriesRes = await queryBiblioGateway(
        {
          query: cleanSeries || seed.series,
          searchType: 'smart',
          f_PRIMARY_LANGUAGE: 'eng',
          ...(audienceFilter ? { f_AUDIENCE: audienceFilter } : {}),
          limit: '8',
        },
        { onShelfAtMain: mainOnly, physicalOnly: true }
      ).catch(() => ({ results: [] }));
      pushUnique(seriesRes.results, `More in ${cleanSeries || 'this series'}`);
    }

    if (seed?.author) {
      const authorRes = await queryBiblioGateway(
        {
          query: seed.author,
          searchType: 'author',
          f_PRIMARY_LANGUAGE: 'eng',
          ...(audienceFilter ? { f_AUDIENCE: audienceFilter } : {}),
          limit: '8',
        },
        { onShelfAtMain: mainOnly, physicalOnly: true }
      ).catch(() => ({ results: [] }));
      pushUnique(authorRes.results, `More by ${seed.author}`);
    }

    let subjectTerm = '';
    try {
      const olRes = await fetchWithTimeout(
        `https://openlibrary.org/search.json?q=${encodeURIComponent(clean)}&limit=1&fields=title,subject`,
        { headers: { 'User-Agent': 'PageTurner-SanMateo/1.0' } },
        4500
      );
      if (olRes.ok) {
        const olJson = await olRes.json();
        const subjects = (olJson.docs?.[0]?.subject || []).filter(
          (s) => s.length >= 4 && s.length <= 28 && !/fiction|accessible|protected|nyt|award|bestseller|juvenile/i.test(s)
        );
        subjectTerm = subjects[0] || '';
      }
    } catch {
      // Optional enrichment
    }

    const readAlikeQuery = subjectTerm || clean;
    const alikeParams = {
      query: readAlikeQuery,
      searchType: 'smart',
      f_FORMAT: seed?.formatCode === 'GRAPHIC_NOVEL' ? 'GRAPHIC_NOVEL' : 'BK',
      f_PRIMARY_LANGUAGE: 'eng',
      f_UGC_RATING: 'FOUR_PLUS_STARS',
      limit: '14',
    };
    if (audienceFilter) alikeParams.f_AUDIENCE = audienceFilter;

    const alikeRes = await queryBiblioGateway(alikeParams, {
      onShelfAtMain: mainOnly,
      physicalOnly: true,
    }).catch(() => ({ results: [] }));

    pushUnique(
      alikeRes.results,
      subjectTerm ? `Similar theme: ${subjectTerm}` : `Readers who liked “${seed?.title || clean}”`
    );

    const filtered = decorateAndFilterLogStatus(combined, { logMap, hideRead });

    if (filtered.results.length > 0) {
      return {
        seedTitle: seed?.title || clean,
        seedAuthor: seed?.author || '',
        mainOnly,
        hideRead,
        hiddenReadCount: filtered.hiddenReadCount,
        source: 'smpl_live',
        sourceLabel: mainOnly
          ? `Books like “${seed?.title || clean}” — on the shelf at San Mateo Main now`
          : `Books like “${seed?.title || clean}” in San Mateo Public Library`,
        results: filtered.results.slice(0, 15),
      };
    }
  } catch {
    // Fall back
  }

  return searchCatalog({ query: clean, mainOnly, logMap, hideRead });
}

/**
 * Direct San Mateo Public Library search (with Main Library on-shelf & hide-already-read options).
 */
export async function searchCatalog({
  query = '',
  format = 'physical',
  audience = 'all',
  mainOnly = false,
  logMap = new Map(),
  hideRead = false,
} = {}) {
  const cleanQuery = String(query || '').trim();
  if (!cleanQuery) {
    return discoverBooks({ aisleId: 'age4_picture', mainOnly, logMap, hideRead });
  }

  try {
    const params = {
      query: cleanQuery,
      searchType: 'smart',
      f_PRIMARY_LANGUAGE: 'eng',
      page: '1',
      limit: '18',
    };
    if (format === 'book') params.f_FORMAT = 'BK';
    else if (format === 'graphic_novel') params.f_FORMAT = 'GRAPHIC_NOVEL';
    else if (format === 'audiobook') params.f_FORMAT = 'AB';

    if (audience === 'kids') params.f_AUDIENCE = 'juvenile';
    else if (audience === 'teen') params.f_AUDIENCE = 'young_adult';
    else if (audience === 'adult') params.f_AUDIENCE = 'adult';

    const { results } = await queryBiblioGateway(params, {
      onShelfAtMain: mainOnly,
      physicalOnly: format === 'physical' || format === 'book' || format === 'graphic_novel' || format === 'audiobook',
    });

    const filtered = decorateAndFilterLogStatus(results, { logMap, hideRead });

    if (filtered.results.length > 0) {
      return {
        source: 'smpl_live',
        hiddenReadCount: filtered.hiddenReadCount,
        sourceLabel: mainOnly
          ? 'Live at San Mateo Main Library (On Shelf Now)'
          : 'Live San Mateo Public Library Catalog',
        results: filtered.results,
      };
    }
  } catch {
    // Fall through gracefully
  }

  try {
    const olUrl = `https://openlibrary.org/search.json?q=${encodeURIComponent(cleanQuery)}&limit=12&fields=key,title,author_name,first_publish_year,cover_i,isbn`;
    const olRes = await fetchWithTimeout(olUrl, { headers: { 'User-Agent': 'PageTurner-SanMateo/1.0' } }, 6500);
    if (olRes.ok) {
      const olJson = await olRes.json();
      const docs = Array.isArray(olJson.docs) ? olJson.docs : [];
      const results = docs.map((doc) => {
        const author = Array.isArray(doc.author_name) ? doc.author_name[0] : '';
        const coverUrl = doc.cover_i
          ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`
          : doc.isbn?.[0]
            ? `https://covers.openlibrary.org/b/isbn/${doc.isbn[0]}-M.jpg`
            : '';
        return {
          bibId: '',
          title: doc.title || 'Untitled',
          author,
          year: doc.first_publish_year ? String(doc.first_publish_year) : '',
          format: 'Book',
          rating: null,
          ratingCount: 0,
          coverUrl,
          status: 'CATALOG_LOOKUP',
          availableCopies: null,
          totalCopies: null,
          holdsCount: null,
          onShelfAtMain: false,
          description: '',
          catalogUrl: buildSearchUrl(`${doc.title} ${author}`.trim()),
          canDirectHold: false,
        };
      });
      const filtered = decorateAndFilterLogStatus(results, { logMap, hideRead });
      if (filtered.results.length > 0) {
        return {
          source: 'open_library',
          hiddenReadCount: filtered.hiddenReadCount,
          sourceLabel: 'Book Search · Links to San Mateo Main Library',
          results: filtered.results,
        };
      }
    }
  } catch {
    // Offline fallback
  }

  const fallback = decorateAndFilterLogStatus(
    CURATED_FALLBACK_BOOKS.map((b) => ({
      ...b,
      catalogUrl: buildSearchUrl(`${b.title} ${b.author}`),
    })),
    { logMap, hideRead }
  );

  return {
    source: 'curated_offline',
    hiddenReadCount: fallback.hiddenReadCount,
    sourceLabel: 'Curated San Mateo Main Library Favorites',
    results: fallback.results,
  };
}

/**
 * Authenticated San Mateo Public Library (BiblioCommons) patron session client.
 * Respects all library auth & security checks cleanly; never bypasses anti-bot challenges.
 */
export class BiblioCommonsClient {
  constructor() {
    this.jar = new CookieJar();
    this.accountId = null;
    this.mainBranchCode = MAIN_BRANCH.biblioCode;
  }

  async request(url, { method = 'GET', headers = {}, body, redirect = 'manual' } = {}) {
    let currentUrl = url;
    let currentMethod = method;
    let currentBody = body;

    for (let hops = 0; hops < 6; hops += 1) {
      const reqHeaders = {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        ...headers,
      };
      const cookieHeader = this.jar.header();
      if (cookieHeader) reqHeaders.Cookie = cookieHeader;

      const res = await fetchWithTimeout(
        currentUrl,
        {
          method: currentMethod,
          headers: reqHeaders,
          body: currentBody,
          redirect: 'manual',
        },
        12000
      );
      this.jar.ingest(res);

      if (redirect === 'follow' && [301, 302, 303, 307, 308].includes(res.status)) {
        const loc = res.headers.get('location');
        if (!loc) return res;
        currentUrl = new URL(loc, currentUrl).toString();
        if (res.status === 303 || (res.status === 302 && currentMethod === 'POST')) {
          currentMethod = 'GET';
          currentBody = undefined;
          delete headers['Content-Type'];
        }
        continue;
      }
      return res;
    }
    throw new Error('Too many redirects while talking to San Mateo Public Library.');
  }

  detectChallenge(html = '', status = 200) {
    const lower = html.toLowerCase();
    return (
      status === 403 ||
      lower.includes('cf-turnstile') ||
      lower.includes('just a moment') ||
      lower.includes('g-recaptcha') ||
      lower.includes('verify you are human')
    );
  }

  async login(cardNumber, pin) {
    const loginUrl = `${LIBRARY_CONFIG.catalogBaseUrl}/user/login`;
    const getRes = await this.request(loginUrl, { redirect: 'follow' });
    const getHtml = await getRes.text();

    if (this.detectChallenge(getHtml, getRes.status)) {
      return {
        ok: false,
        requiresBrowser: true,
        error:
          'San Mateo Public Library requested a browser security check. Use the 1-tap catalog link to sign in directly.',
      };
    }

    const tokenMatch =
      getHtml.match(/name="authenticity_token"[^>]*value="([^"]+)"/i) ||
      getHtml.match(/name="csrf-token"[^>]*content="([^"]+)"/i);
    const authenticityToken = tokenMatch ? tokenMatch[1] : '';

    const form = new URLSearchParams({
      utf8: '✓',
      name: String(cardNumber).trim(),
      user_pin: String(pin).trim(),
      remember_me: '1',
    });
    if (authenticityToken) form.set('authenticity_token', authenticityToken);

    const postRes = await this.request(loginUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: LIBRARY_CONFIG.catalogBaseUrl,
        Referer: loginUrl,
      },
      body: form.toString(),
      redirect: 'follow',
    });

    const postHtml = await postRes.text();
    if (this.detectChallenge(postHtml, postRes.status)) {
      return {
        ok: false,
        requiresBrowser: true,
        error: 'San Mateo Public Library requested a browser security check during sign-in.',
      };
    }

    if (postHtml.includes('Invalid barcode') || postHtml.includes('incorrect') || postRes.url?.includes('/user/login')) {
      return {
        ok: false,
        error: 'San Mateo Public Library did not accept that card number or PIN. Please double-check them in Library Card settings.',
      };
    }

    const acctMatch =
      postHtml.match(/"accountId"\s*:\s*"?(\d+)"?/) ||
      postHtml.match(/"userId"\s*:\s*"?(\d+)"?/) ||
      postHtml.match(/\/v2\/holds\?[^"]*accountId=(\d+)/);
    if (acctMatch) {
      this.accountId = acctMatch[1];
    }

    return { ok: true, accountId: this.accountId };
  }

  async fetchHolds() {
    if (this.accountId) {
      const apiUrl = `${LIBRARY_CONFIG.gatewayBaseUrl}/holds?accountId=${encodeURIComponent(this.accountId)}&size=50&page=1`;
      const res = await this.request(apiUrl, {
        headers: {
          Accept: 'application/json',
          Referer: `${LIBRARY_CONFIG.catalogBaseUrl}/v2/holds`,
        },
      });
      if (res.ok) {
        const json = await res.json();
        return this.parseGatewayHolds(json);
      }
    }

    const pageUrl = `${LIBRARY_CONFIG.catalogBaseUrl}/v2/holds`;
    const res = await this.request(pageUrl, { redirect: 'follow' });
    const html = await res.text();
    if (this.detectChallenge(html, res.status)) {
      throw new Error('Library requested a browser verification check while refreshing holds.');
    }

    const stateMatch = html.match(/<script[^>]*data-iso-key="_0"[^>]*>([\s\S]*?)<\/script>/i);
    if (stateMatch) {
      const parsed = JSON.parse(stateMatch[1]);
      if (parsed?.app?.coreAssets?.accountId && !this.accountId) {
        this.accountId = String(parsed.app.coreAssets.accountId);
      }
      return this.parseGatewayHolds(parsed);
    }

    return [];
  }

  parseGatewayHolds(json) {
    const holdsObj = json?.entities?.holds || {};
    const bibsObj = json?.entities?.bibs || {};
    const branchesObj = json?.entities?.branches || {};

    for (const branch of Object.values(branchesObj)) {
      if (branch?.code && /san mateo.*main/i.test(branch?.name || '')) {
        this.mainBranchCode = branch.code;
      }
    }

    const results = [];
    for (const h of Object.values(holdsObj)) {
      if (!h || !h.metadataId) continue;
      const bib = bibsObj[h.metadataId] || {};
      const brief = bib.briefInfo || {};
      const rawStatus = String(h.status || '').toUpperCase();

      let status = 'waiting';
      if (rawStatus.includes('READY')) status = 'ready';
      else if (rawStatus.includes('TRANSIT')) status = 'in_transit';
      else if (rawStatus.includes('PAUSED') || rawStatus.includes('SUSPENDED')) status = 'paused';

      results.push({
        holdId: String(h.holdsId || h.id || h.metadataId),
        bibId: h.metadataId,
        title: brief.title || h.bibTitle || 'Untitled Hold',
        author: formatAuthorName(brief.authors),
        format: formatBiblioFormat(brief.format || 'BK'),
        coverUrl: brief.jacket?.medium || brief.jacket?.small || '',
        status,
        pickupBranch: 'main',
        pickupBy: h.expiryDate ? String(h.expiryDate).slice(0, 10) : null,
        queuePosition: h.holdsPosition != null ? Number(h.holdsPosition) : null,
        totalHolds: bib.availability?.heldCopies != null ? Number(bib.availability.heldCopies) : null,
        catalogUrl: buildRecordUrl(h.metadataId, brief.title || ''),
        isDemo: false,
      });
    }

    return results;
  }

  async placeHold({ bibId, title }) {
    let targetBibId = bibId;
    if (!targetBibId && title) {
      const lookup = await searchCatalog({ query: title, format: 'physical' });
      const firstLive = lookup.results.find((r) => r.bibId && /^S\d+C\d+/.test(r.bibId));
      if (firstLive) targetBibId = firstLive.bibId;
    }

    if (!targetBibId) {
      return {
        ok: false,
        fallbackUrl: buildSearchUrl(title || ''),
        error: 'Could not find an exact San Mateo catalog record ID for this book. Tap below to reserve on the library site.',
      };
    }

    const endpoint = `${LIBRARY_CONFIG.gatewayBaseUrl}/holds`;
    const res = await this.request(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Origin: LIBRARY_CONFIG.catalogBaseUrl,
        Referer: buildRecordUrl(targetBibId, title),
      },
      body: JSON.stringify({
        metadataId: targetBibId,
        materialType: 'PHYSICAL',
        accountId: this.accountId ? Number(this.accountId) : undefined,
        enableSingleClickHolds: false,
        materialParams: {
          branchId: this.mainBranchCode,
          expiryDate: null,
          errorMessageLocale: 'en-US',
        },
      }),
    });

    const text = await res.text();
    if (res.ok) {
      let data = {};
      try {
        data = JSON.parse(text);
      } catch {
        // ok
      }
      return {
        ok: true,
        bibId: targetBibId,
        holdId: data?.holds?.[0]?.holdsId || data?.id || null,
        branchId: 'main',
        catalogUrl: buildRecordUrl(targetBibId, title),
      };
    }

    return {
      ok: false,
      fallbackUrl: buildRecordUrl(targetBibId, title),
      error: `San Mateo Main Library returned status ${res.status} when placing this hold. Complete it in 1 tap on the catalog page.`,
    };
  }

  async cancelHold({ holdId, bibId }) {
    if (!holdId || !this.accountId) {
      return { ok: false, error: 'Hold ID or account session unavailable.' };
    }
    const endpoint = `${LIBRARY_CONFIG.gatewayBaseUrl}/holds`;
    const res = await this.request(endpoint, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Origin: LIBRARY_CONFIG.catalogBaseUrl,
        Referer: `${LIBRARY_CONFIG.catalogBaseUrl}/v2/holds`,
      },
      body: JSON.stringify({
        accountId: Number(this.accountId),
        holdIds: [String(holdId)],
        metadataIds: bibId ? [String(bibId)] : [],
      }),
    });
    return { ok: res.ok, status: res.status };
  }
}
