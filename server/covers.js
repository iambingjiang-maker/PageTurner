import crypto from 'node:crypto';
import { LIBRARY_CONFIG } from './config.js';

/**
 * Multi-source verified book front-cover resolver.
 *
 * Detects and rejects BOTH:
 *   - Silent 1x1 transparent pixels (< 1.5 KB from Open Library / CDNs)
 *   - Known generic placeholder icons (e.g., Syndetics's gray circle-book icon by SHA-256 hash)
 *
 * Cascades automatically across:
 *   1. Provided candidate URLs (verified real front cover, not placeholder)
 *   2. BookSense / Bookshop.org official US publisher cover CDN (via ISBN-13)
 *   3. San Mateo Public Library BiblioCommons catalog (extracts real ISBN-13 -> BookSense + Syndetics)
 *   4. Open Library (?default=false by ISBN and search by title/author cover_i)
 *   5. Apple Books high-res cover (strict title + author match)
 *   6. Google Books API (skipped cleanly if rate-limited)
 */

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const MIN_VALID_IMAGE_BYTES = 1500;

// Exact SHA-256 hashes of known generic placeholder images (Syndetics gray circle-book icons)
const PLACEHOLDER_SHA256 = new Set([
  '17729bc9a6a67b82989771339191fdc6ff3ef6ec7c1b86d9f5d9a44696914965', // Syndetics MC.GIF generic book icon (6,662 B)
  '1f150adab6137b663deda51e23691d174a7a7817f115bb7e4ff74d7254feb275', // Syndetics LC.JPG generic book icon (17,804 B)
]);

const urlValidityCache = new Map();
const titleCoverCache = new Map();

async function fetchWithTimeout(url, options = {}, timeoutMs = 6500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function normText(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function buildBookSenseUrl(isbn13) {
  const clean = String(isbn13 || '').replace(/[^0-9]/g, '');
  if (clean.length !== 13) return '';
  return `https://images.booksense.com/images/${clean.slice(-3)}/${clean.slice(-6, -3)}/${clean}.jpg`;
}

function extractIsbn13(text) {
  const m = String(text || '').match(/\b(97[89]\d{10})\b/);
  return m ? m[1] : '';
}

/**
 * Verifies that a URL returns a real front-cover image (not 404, not HTML,
 * not a tiny 1x1 blank pixel, and not Syndetics's generic gray book icon).
 */
export async function isValidCoverImage(url) {
  if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;
  if (urlValidityCache.has(url)) return urlValidityCache.get(url);

  try {
    const res = await fetchWithTimeout(
      url,
      {
        method: 'GET',
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'image/avif,image/webp,image/apng,image/jpeg,image/png,image/*,*/*;q=0.8',
        },
        redirect: 'follow',
      },
      6000
    );

    if (!res.ok) {
      urlValidityCache.set(url, false);
      return false;
    }

    const contentType = String(res.headers.get('content-type') || '').toLowerCase();
    if (!contentType.startsWith('image/')) {
      urlValidityCache.set(url, false);
      return false;
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength < MIN_VALID_IMAGE_BYTES) {
      urlValidityCache.set(url, false);
      return false;
    }

    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    if (PLACEHOLDER_SHA256.has(sha)) {
      urlValidityCache.set(url, false);
      return false;
    }

    urlValidityCache.set(url, true);
    return true;
  } catch {
    urlValidityCache.set(url, false);
    return false;
  }
}

async function tryBookSenseByIsbn(isbn13) {
  const bsUrl = buildBookSenseUrl(isbn13);
  if (bsUrl && (await isValidCoverImage(bsUrl))) {
    return { url: bsUrl, source: 'booksense_publisher' };
  }
  return null;
}

async function findSanMateoCatalogCover({ title, author }) {
  if (!title) return null;
  try {
    const q = `${title} ${author || ''}`.trim();
    const params = new URLSearchParams({
      query: q,
      searchType: 'smart',
      f_PRIMARY_LANGUAGE: 'eng',
      limit: '6',
    });
    const res = await fetchWithTimeout(
      `${LIBRARY_CONFIG.gatewayBaseUrl}/bibs/search?${params.toString()}`,
      {
        headers: {
          Accept: 'application/json',
          'User-Agent': USER_AGENT,
          Referer: `${LIBRARY_CONFIG.catalogBaseUrl}/`,
        },
      },
      7000
    );
    if (!res.ok) return null;
    const json = await res.json();
    const bibsMap = json?.entities?.bibs || {};
    const ids = json?.catalogSearch?.results?.map((r) => r.representative) || Object.keys(bibsMap);
    const targetNorm = normText(title);

    for (const id of ids) {
      const bib = bibsMap[id];
      const brief = bib?.briefInfo;
      if (!brief) continue;
      const candNorm = normText(brief.title || '');
      if (!(candNorm === targetNorm || candNorm.startsWith(targetNorm) || targetNorm.startsWith(candNorm))) {
        continue;
      }

      // First try BookSense high-res cover using the record's exact ISBN-13
      const isbns = [
        ...(Array.isArray(brief.isbns) ? brief.isbns : []),
        extractIsbn13(brief.jacket?.medium || brief.jacket?.large || ''),
      ].filter(Boolean);

      for (const isbn of isbns) {
        const bs = await tryBookSenseByIsbn(isbn);
        if (bs) return bs;
      }

      // Next try BiblioCommons Syndetics cover (automatically rejecting generic gray icon!)
      const jacket = brief.jacket || {};
      for (const cand of [jacket.medium, jacket.large, jacket.small]) {
        if (cand && (await isValidCoverImage(cand))) {
          return { url: cand, source: 'smpl_syndetics' };
        }
      }
    }
  } catch {
    // Fall through
  }
  return null;
}

async function findOpenLibraryCover({ title, author, isbn }) {
  if (isbn) {
    const cleanIsbn = String(isbn).replace(/[^0-9X]/gi, '');
    const bs = await tryBookSenseByIsbn(cleanIsbn);
    if (bs) return bs;
    const isbnUrl = `https://covers.openlibrary.org/b/isbn/${cleanIsbn}-M.jpg?default=false`;
    if (await isValidCoverImage(isbnUrl)) {
      return { url: isbnUrl, source: 'open_library_isbn' };
    }
  }

  if (title) {
    try {
      const params = new URLSearchParams({
        title,
        limit: '5',
        fields: 'title,author_name,cover_i,isbn',
      });
      if (author) params.set('author', author);
      const res = await fetchWithTimeout(
        `https://openlibrary.org/search.json?${params.toString()}`,
        { headers: { 'User-Agent': 'PageTurner-SanMateo/1.0' } },
        6500
      );
      if (res.ok) {
        const json = await res.json();
        const docs = Array.isArray(json.docs) ? json.docs : [];
        for (const doc of docs) {
          if (Array.isArray(doc.isbn)) {
            for (const candIsbn of doc.isbn.slice(0, 4)) {
              const bs = await tryBookSenseByIsbn(candIsbn);
              if (bs) return bs;
            }
          }
          if (doc.cover_i) {
            const idUrl = `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg?default=false`;
            if (await isValidCoverImage(idUrl)) {
              return { url: idUrl, source: 'open_library_id' };
            }
          }
          if (Array.isArray(doc.isbn)) {
            for (const candIsbn of doc.isbn.slice(0, 3)) {
              const candUrl = `https://covers.openlibrary.org/b/isbn/${candIsbn}-M.jpg?default=false`;
              if (await isValidCoverImage(candUrl)) {
                return { url: candUrl, source: 'open_library_search_isbn' };
              }
            }
          }
        }
      }
    } catch {
      // Fall through
    }
  }
  return null;
}

async function findAppleBooksCover({ title, author }) {
  if (!title) return null;
  try {
    const term = `${title} ${author || ''}`.trim();
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=ebook&limit=6`;
    const res = await fetchWithTimeout(url, { headers: { 'User-Agent': USER_AGENT } }, 6500);
    if (!res.ok) return null;
    const json = await res.json();
    const results = Array.isArray(json.results) ? json.results : [];
    const targetTitle = normText(title);
    const authorLast = author ? normText(author).split(' ').pop() : '';

    for (const item of results) {
      const candTitle = normText(item.trackName || '');
      const candAuthor = normText(item.artistName || '');
      const titleMatch =
        candTitle === targetTitle ||
        candTitle.startsWith(targetTitle) ||
        targetTitle.startsWith(candTitle);
      const authorMatch = !authorLast || candAuthor.includes(authorLast);
      if (!titleMatch || !authorMatch) continue;

      const art = String(item.artworkUrl100 || '').replace(/100x100bb/i, '400x400bb');
      if (art && (await isValidCoverImage(art))) {
        return { url: art, source: 'apple_books' };
      }
    }
  } catch {
    // Fall through
  }
  return null;
}

function cleanGoogleThumb(rawUrl) {
  if (!rawUrl) return '';
  return String(rawUrl)
    .replace(/^http:\/\//i, 'https://')
    .replace(/&edge=curl/gi, '')
    .replace(/zoom=5/i, 'zoom=1');
}

async function findGoogleBooksCover({ title, author, isbn }) {
  const queries = [];
  if (isbn) queries.push(`isbn:${String(isbn).replace(/[^0-9X]/gi, '')}`);
  if (title && author) queries.push(`intitle:${title} inauthor:${author}`);
  else if (title) queries.push(`intitle:${title}`);

  for (const q of queries) {
    try {
      const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=4&printType=books`;
      const res = await fetchWithTimeout(url, { headers: { 'User-Agent': USER_AGENT } }, 5000);
      if (res.status === 429 || !res.ok) return null;
      const json = await res.json();
      const items = Array.isArray(json.items) ? json.items : [];
      for (const item of items) {
        const links = item?.volumeInfo?.imageLinks || {};
        const candidate = cleanGoogleThumb(
          links.medium || links.thumbnail || links.smallThumbnail || ''
        );
        if (candidate && (await isValidCoverImage(candidate))) {
          return { url: candidate, source: 'google_books' };
        }
      }
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Resolves a guaranteed real front-cover JPEG/PNG across multiple sources.
 */
export async function resolveVerifiedCover({ title = '', author = '', isbn = '', candidateUrls = [] } = {}) {
  const cacheKey = `${normText(title)}::${normText(author)}`;
  if (title && titleCoverCache.has(cacheKey)) {
    return titleCoverCache.get(cacheKey);
  }

  // 1. Check any known ISBN via high-res US publisher BookSense CDN first
  const candidateIsbns = new Set();
  if (isbn) candidateIsbns.add(String(isbn).replace(/[^0-9]/g, ''));
  for (const raw of candidateUrls) {
    const extracted = extractIsbn13(raw);
    if (extracted) candidateIsbns.add(extracted);
  }
  for (const candIsbn of candidateIsbns) {
    const bs = await tryBookSenseByIsbn(candIsbn);
    if (bs) {
      if (title) titleCoverCache.set(cacheKey, bs);
      return bs;
    }
  }

  // 2. Verify any candidate URLs already provided (automatically rejecting Syndetics gray icons & 1x1 pixels!)
  for (const raw of candidateUrls) {
    if (!raw) continue;
    const url = String(raw).trim();
    if (await isValidCoverImage(url)) {
      const hit = { url, source: 'provided' };
      if (title) titleCoverCache.set(cacheKey, hit);
      return hit;
    }
  }

  // 3. San Mateo Public Library catalog (extracts real ISBN-13 -> BookSense + Syndetics)
  const smpl = await findSanMateoCatalogCover({ title, author });
  if (smpl) {
    if (title) titleCoverCache.set(cacheKey, smpl);
    return smpl;
  }

  // 4. Open Library (ISBN -> BookSense -> cover_i -> ?default=false)
  const ol = await findOpenLibraryCover({ title, author, isbn });
  if (ol) {
    if (title) titleCoverCache.set(cacheKey, ol);
    return ol;
  }

  // 5. Apple Books high-res cover (strict title + author match)
  const ab = await findAppleBooksCover({ title, author });
  if (ab) {
    if (title) titleCoverCache.set(cacheKey, ab);
    return ab;
  }

  // 6. Google Books API fallback
  const gb = await findGoogleBooksCover({ title, author, isbn });
  if (gb) {
    if (title) titleCoverCache.set(cacheKey, gb);
    return gb;
  }

  return { url: '', source: 'none' };
}
