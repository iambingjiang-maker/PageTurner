/* ==========================================================================
   PageTurner — San Mateo Main Library Family App Frontend (iPhone 15 Ready)
   ========================================================================== */

const state = {
  dashboard: null,
  activeView: 'grab',
  discoverMode: 'foryou',
  activeAisle: 'age4_picture',
  aislePage: 1,
  forYouOffset: 0,
  mainOnly: true,
  hideRead: true,
  logFilter: 'to_borrow',
  selectedLogIds: new Set(),
  discoverResults: [],
  discoverSourceLabel: '',
  isSyncing: false,
  isCheckingAvail: false,
  isScouting: false,
};

let toastTimer = null;

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function showToast(message, link = null) {
  const el = document.getElementById('toast');
  if (!el) return;
  if (toastTimer) clearTimeout(toastTimer);
  el.innerHTML = link
    ? `<span>${esc(message)}</span><a href="${esc(link.url)}" target="_blank" rel="noopener noreferrer">${esc(link.label)} ↗</a>`
    : `<span>${esc(message)}</span>`;
  el.classList.remove('hidden');
  toastTimer = setTimeout(() => el.classList.add('hidden'), link ? 6500 : 3800);
}

async function api(url, options = {}) {
  const opts = {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  };
  if (opts.body && typeof opts.body !== 'string') {
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.locked) {
    showPasscodeLock();
    throw new Error('Family passcode required');
  }
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.fallbackUrl = data.fallbackUrl || null;
    throw err;
  }
  return data;
}

function formatDateFriendly(isoDate) {
  if (!isoDate) return null;
  const parts = String(isoDate).slice(0, 10).split('-').map(Number);
  if (parts.length !== 3) return { label: isoDate, urgent: false };
  const target = new Date(parts[0], parts[1] - 1, parts[2]);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((target - today) / (1000 * 60 * 60 * 24));
  const label = target.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  if (diffDays < 0) return { label: `Expired (${label})`, urgent: true };
  if (diffDays === 0) return { label: `Pickup TODAY (${label})`, urgent: true };
  if (diffDays === 1) return { label: `Pickup by tomorrow (${label})`, urgent: true };
  if (diffDays <= 2) return { label: `Pickup by ${label} (${diffDays}d left)`, urgent: true };
  return { label: `Pickup by ${label}`, urgent: false };
}

function formatRelativeTime(iso) {
  if (!iso) return 'Not yet';
  const diffSec = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 45) return 'just now';
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h ago`;
  return `${Math.round(diffSec / 86400)}d ago`;
}

function formatLogStatusBadge(status) {
  const map = {
    to_borrow: { text: 'To Borrow', cls: 'tag-shelf' },
    on_hold: { text: 'On Hold', cls: 'tag-transit' },
    loved: { text: 'Loved ❤️', cls: 'tag-reason' },
    liked: { text: 'Liked 👍', cls: 'tag-available' },
    read: { text: 'Read', cls: '' },
    skip: { text: "Didn't Love", cls: '' },
  };
  return map[status] || { text: 'To Borrow', cls: '' };
}

window.__healBookCover = async function healBookCover(imgEl) {
  if (!imgEl || imgEl.dataset.healTried === '1') {
    const title = imgEl?.dataset?.coverTitle || 'Book';
    const sizeClass = imgEl?.dataset?.sizeClass || 'book-cover-sm';
    const div = document.createElement('div');
    div.className = `${sizeClass} cover-placeholder`;
    div.textContent = title.slice(0, 24);
    imgEl?.replaceWith(div);
    return;
  }
  imgEl.dataset.healTried = '1';
  const title = imgEl.dataset.coverTitle || '';
  const author = imgEl.dataset.coverAuthor || '';
  const logId = imgEl.dataset.logId || '';
  try {
    const params = new URLSearchParams({ title, author });
    if (logId) params.set('logId', logId);
    const data = await api(`/api/covers/resolve?${params.toString()}`);
    if (data.url && data.url !== imgEl.src) {
      imgEl.src = data.url;
      return;
    }
  } catch {
    // Fall back cleanly to styled bookplate
  }
  const div = document.createElement('div');
  div.className = `${imgEl.dataset.sizeClass || 'book-cover-sm'} cover-placeholder`;
  div.textContent = title.slice(0, 24);
  imgEl.replaceWith(div);
};

function coverMarkup(coverUrl, title, sizeClass = 'book-cover-sm', author = '', logId = '') {
  if (coverUrl) {
    return `<img class="${sizeClass}" src="${esc(coverUrl)}" alt="Cover of ${esc(title)}" loading="lazy" data-cover-title="${esc(title)}" data-cover-author="${esc(author)}" data-log-id="${esc(logId)}" data-size-class="${sizeClass}" onload="if(this.naturalWidth<20||this.naturalHeight<20){window.__healBookCover(this)}" onerror="window.__healBookCover(this)" />`;
  }
  return `<div class="${sizeClass} cover-placeholder">${esc(title.slice(0, 24))}</div>`;
}

/* ==========================================================================
   Navigation & Passcode Gate
   ========================================================================== */

function showPasscodeLock() {
  document.getElementById('passcode-overlay')?.classList.remove('hidden');
  document.getElementById('passcode-input')?.focus();
}

function hidePasscodeLock() {
  document.getElementById('passcode-overlay')?.classList.add('hidden');
}

function switchView(viewName) {
  state.activeView = viewName;
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.getElementById(`view-${viewName}`)?.classList.add('active');

  document.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.nav === viewName);
  });

  if (viewName === 'discover' && state.discoverResults.length === 0) {
    loadCurrentDiscoverMode();
  }
  updateBatchBar();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ==========================================================================
   Rendering: Grab & Go Dashboard
   ========================================================================== */

function renderDashboard() {
  const d = state.dashboard;
  if (!d) return;

  const readyCount = d.summary.readyCount;
  const toBorrowCount = d.summary.toBorrowCount ?? d.summary.logCount ?? 0;
  for (const id of ['badge-desktop-ready', 'badge-mobile-ready']) {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = String(readyCount);
      el.dataset.count = String(readyCount);
    }
  }
  for (const id of ['badge-desktop-log', 'badge-mobile-log']) {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = String(toBorrowCount);
      el.dataset.count = String(toBorrowCount);
    }
  }

  document.getElementById('preview-banner')?.classList.toggle('hidden', d.mode !== 'demo');

  const grabSubtitle = document.getElementById('grab-subtitle');
  if (grabSubtitle) {
    if (readyCount > 0) {
      grabSubtitle.textContent = `${readyCount} ${readyCount === 1 ? 'book is' : 'books are'} waiting on the Main Library hold shelf for ${d.settings.familyName}. Walk in, grab, and go!`;
    } else if (d.summary.transitCount > 0) {
      grabSubtitle.textContent = `Nothing on the shelf yet—${d.summary.transitCount} ${d.summary.transitCount === 1 ? 'book is' : 'books are'} on the way to San Mateo Main.`;
    } else {
      grabSubtitle.textContent = `All caught up! Pick your next vetted books from Book Log and 1-click reserve.`;
    }
  }

  const newestSync = d.cards
    .map((c) => c.lastSyncedAt)
    .filter(Boolean)
    .sort()
    .pop();
  const lastSyncEl = document.getElementById('last-synced-text');
  if (lastSyncEl) {
    lastSyncEl.textContent = d.mode === 'demo' ? 'Preview Mode' : `Synced ${formatRelativeTime(newestSync)}`;
  }

  renderMainLibraryBanner(d.branch);
  renderReadyHolds(d);
  renderWaitingHolds(d);
  renderBookLog(d);
  renderAisleChips(d.aisles || []);
  renderSettings(d);
  populateCardSelector(d);
  updateBatchBar();
}

function renderMainLibraryBanner(branch) {
  const el = document.getElementById('main-library-banner');
  if (!el || !branch) return;
  const dotClass = branch.live.isOpen ? (branch.live.closingSoon ? 'closing' : 'open') : 'closed';

  el.innerHTML = `
    <div class="main-branch-left">
      <div class="main-branch-title-row">
        <span class="main-branch-name">${esc(branch.name)}</span>
        <span class="status-dot-label ${dotClass}">${esc(branch.live.statusLabel)} · ${esc(branch.live.detail)}</span>
      </div>
      <div class="main-branch-meta">${esc(branch.address)} · ${esc(branch.pickupTip)}</div>
    </div>
    <a class="btn btn-secondary btn-sm" href="${esc(branch.mapsUrl)}" target="_blank" rel="noopener noreferrer">
      Directions ↗
    </a>
  `;
}

function renderReadyHolds(d) {
  const container = document.getElementById('ready-holds-container');
  const countLabel = document.getElementById('ready-count-label');
  if (!container) return;

  const readyHolds = d.holds.filter((h) => h.status === 'ready');
  const remainingCount = readyHolds.filter((h) => !h.grabbed).length;
  if (countLabel) {
    countLabel.textContent =
      readyHolds.length === 0 ? '0 ready' : `${remainingCount} left to grab · ${readyHolds.length} total`;
  }

  if (readyHolds.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>No holds waiting on the Main Library shelf yet</h3>
        <p>Open your Book Log, check which NYT/B&amp;N/Caldecott picks are on the shelf at Main, and 1-click reserve them!</p>
        <button type="button" class="btn btn-primary" data-nav="log">Pick Books from Book Log</button>
      </div>
    `;
    return;
  }

  const allGrabbed = readyHolds.every((i) => i.grabbed);
  const rowsHtml = readyHolds
    .map((item) => {
      const deadline = formatDateFriendly(item.pickupBy);
      return `
        <div class="pickup-row ${item.grabbed ? 'grabbed' : ''}" data-hold-id="${esc(item.id)}">
          ${coverMarkup(item.coverUrl, item.title, 'book-cover-sm')}
          <div class="book-info">
            <h3 class="book-title">${esc(item.title)}</h3>
            <p class="book-author">${esc(item.author || 'San Mateo Main Library')}</p>
            <div class="book-badges">
              <span class="tag tag-shelf">Shelf: ${esc(item.shelfName)}</span>
              <span class="tag">${esc(item.format || 'Picture Book')}</span>
              ${
                deadline
                  ? `<span class="tag ${deadline.urgent ? 'tag-urgent' : 'tag-deadline'}">${esc(deadline.label)}</span>`
                  : ''
              }
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <button
              type="button"
              class="rate-pill-btn"
              data-quick-rate-hold="${esc(item.id)}"
              data-rate-val="loved"
              title="Loved it ❤️ — save to Book Log"
            >
              ❤️
            </button>
            <button
              type="button"
              class="rate-pill-btn"
              data-quick-rate-hold="${esc(item.id)}"
              data-rate-val="skip"
              title="Didn't love 👎 — hide from future picks"
            >
              👎
            </button>
            <button
              type="button"
              class="grab-btn ${item.grabbed ? 'grabbed' : ''}"
              data-toggle-grab="${esc(item.id)}"
              aria-pressed="${item.grabbed ? 'true' : 'false'}"
            >
              <span>${item.grabbed ? '✓ Grabbed' : 'Mark Grabbed'}</span>
            </button>
          </div>
        </div>
      `;
    })
    .join('');

  container.innerHTML = `
    <article class="pickup-group">
      ${
        allGrabbed
          ? `<div class="all-grabbed-banner">All ${readyHolds.length} ${readyHolds.length === 1 ? 'book' : 'books'} grabbed! Head to self-checkout on the 1st floor and you’re good to go.</div>`
          : ''
      }
      <div class="pickup-list">${rowsHtml}</div>
    </article>
  `;

  container.querySelectorAll('[data-toggle-grab]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/api/holds/${encodeURIComponent(btn.dataset.toggleGrab)}/grab`, { method: 'PATCH', body: {} });
        await loadDashboard();
      } catch (err) {
        showToast(err.message);
      }
    });
  });

  container.querySelectorAll('[data-quick-rate-hold]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const hold = readyHolds.find((h) => h.id === btn.dataset.quickRateHold);
      const val = btn.dataset.rateVal;
      if (!hold) return;
      try {
        await api('/api/log', {
          method: 'POST',
          body: {
            title: hold.title,
            author: hold.author,
            reader: '4-Year-Old',
            status: val,
            coverUrl: hold.coverUrl,
            catalogUrl: hold.catalogUrl,
            bibId: hold.bibId,
          },
        });
        showToast(val === 'loved' ? `Marked “${hold.title}” as Loved ❤️!` : `Marked “${hold.title}” as Didn’t Love 👎`);
        await loadDashboard();
      } catch (err) {
        showToast(err.message);
      }
    });
  });
}

function renderWaitingHolds(d) {
  const container = document.getElementById('waiting-holds-container');
  const countLabel = document.getElementById('waiting-count-label');
  if (!container) return;

  const waiting = d.holds.filter((h) => h.status !== 'ready');
  if (countLabel) {
    countLabel.textContent = `${waiting.length} ${waiting.length === 1 ? 'title' : 'titles'}`;
  }

  if (waiting.length === 0) {
    container.innerHTML = `<p class="meta-caption">No books currently in transit or waiting in line.</p>`;
    return;
  }

  container.innerHTML = waiting
    .map((item) => {
      const statusBadge =
        item.status === 'in_transit'
          ? `<span class="tag tag-transit">In transit to Main Library</span>`
          : item.status === 'paused'
            ? `<span class="tag">Paused</span>`
            : `<span class="tag">${
                item.queuePosition
                  ? `#${item.queuePosition}${item.totalHolds ? ` of ${item.totalHolds}` : ''} in line`
                  : 'Waiting in queue'
              }</span>`;

      return `
        <article class="waiting-card">
          ${coverMarkup(item.coverUrl, item.title, 'book-cover-sm')}
          <div class="waiting-card-body">
            <h3 class="book-title">${esc(item.title)}</h3>
            <p class="book-author">${esc(item.author || 'San Mateo Main Library')}</p>
            <div class="book-badges">
              ${statusBadge}
              <span class="tag">${esc(item.format || 'Picture Book')}</span>
            </div>
            <div class="waiting-card-actions">
              <a class="btn btn-ghost btn-sm" href="${esc(item.catalogUrl)}" target="_blank" rel="noopener noreferrer">
                Catalog ↗
              </a>
              ${
                item.isDemo
                  ? `<button type="button" class="btn btn-ghost btn-sm" data-mark-ready="${esc(item.id)}">Simulate Ready</button>`
                  : ''
              }
              <button type="button" class="btn btn-danger-ghost btn-sm" data-cancel-hold="${esc(item.id)}">
                Cancel
              </button>
            </div>
          </div>
        </article>
      `;
    })
    .join('');

  container.querySelectorAll('[data-cancel-hold]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/api/holds/${encodeURIComponent(btn.dataset.cancelHold)}`, { method: 'DELETE' });
        showToast('Hold cancelled.');
        await loadDashboard();
      } catch (err) {
        showToast(err.message);
      }
    });
  });

  container.querySelectorAll('[data-mark-ready]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/api/holds/${encodeURIComponent(btn.dataset.markReady)}`, {
          method: 'PATCH',
          body: { status: 'ready' },
        });
        showToast('Moved to Ready on Hold Shelf!');
        await loadDashboard();
      } catch (err) {
        showToast(err.message);
      }
    });
  });
}

/* ==========================================================================
   Rendering: Curated Family Book Log (Multi-Select + Live SMPL Availability)
   ========================================================================== */

function updateBatchBar() {
  const bar = document.getElementById('batch-reserve-bar');
  const countEl = document.getElementById('batch-count-text');
  const reserveBtn = document.getElementById('btn-batch-reserve');
  if (!bar) return;

  const count = state.selectedLogIds.size;
  const shouldShow = state.activeView === 'log' && count > 0;
  bar.classList.toggle('hidden', !shouldShow);

  if (countEl) {
    countEl.textContent = `${count} ${count === 1 ? 'book' : 'books'} selected`;
  }
  if (reserveBtn) {
    reserveBtn.textContent = `Reserve ${count} at Main`;
  }
}

function renderBookLog(d) {
  const container = document.getElementById('book-log-list');
  const caption = document.getElementById('log-count-caption');
  const scoutMeta = document.getElementById('scout-meta-text');
  const openSheetBtn = document.getElementById('log-open-sheet-btn');
  if (!container) return;

  if (scoutMeta) {
    scoutMeta.textContent = d.settings.lastScoutAt
      ? `Last scouted ${formatRelativeTime(d.settings.lastScoutAt)} · Auto-adds vetted kids books monthly`
      : `Automatically finds vetted new picture books every month for your Book Log`;
  }

  if (openSheetBtn) {
    if (d.settings.googleSheetUrl) {
      openSheetBtn.href = d.settings.googleSheetUrl;
      openSheetBtn.classList.remove('hidden');
    } else {
      openSheetBtn.classList.add('hidden');
    }
  }

  const all = d.bookLog || [];
  // Prune any selected IDs that are no longer To Borrow
  const validToBorrowIds = new Set(all.filter((b) => b.status === 'to_borrow').map((b) => b.id));
  for (const id of [...state.selectedLogIds]) {
    if (!validToBorrowIds.has(id)) state.selectedLogIds.delete(id);
  }

  const filtered = all.filter((entry) => {
    if (state.logFilter === 'to_borrow') return entry.status === 'to_borrow';
    if (state.logFilter === 'on_shelf_main') {
      return entry.status === 'to_borrow' && entry.smplAvailability?.status === 'on_shelf_main';
    }
    if (state.logFilter === 'awards') {
      return entry.status === 'to_borrow' && /nyt|b&n|caldecott/i.test(entry.source || '');
    }
    if (state.logFilter === 'loved') return entry.status === 'loved' || entry.status === 'liked';
    if (state.logFilter === 'scout') return /scout/i.test(entry.source || '');
    return true;
  });

  // Sort: On shelf at Main first, then Ships fast, then unchecked/waitlist
  const availOrder = { on_shelf_main: 0, available_system: 1, waitlist: 2, not_found: 3 };
  filtered.sort((a, b) => {
    const oa = a.smplAvailability ? availOrder[a.smplAvailability.status] ?? 4 : 4;
    const ob = b.smplAvailability ? availOrder[b.smplAvailability.status] ?? 4 : 4;
    return oa - ob;
  });

  if (caption) {
    const onShelf = d.summary.onShelfAtMainCount || 0;
    caption.textContent = `${filtered.length} shown${onShelf ? ` · ${onShelf} on shelf at Main` : ''}`;
  }

  if (filtered.length === 0) {
    const emptyMsg =
      state.logFilter === 'on_shelf_main'
        ? 'Tap “Check Main Library” above to scan live San Mateo Main Library shelf availability across all your To Borrow books!'
        : state.logFilter === 'scout'
          ? 'Tap “✦ Scout New Books” above to pull fresh vetted picture books from San Mateo Main right now!'
          : 'Add books you love or tap “✦ Scout New Books” to discover fresh picks.';
    container.innerHTML = `
      <div class="empty-state">
        <h3>No books in this filter yet</h3>
        <p>${esc(emptyMsg)}</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered
    .map((entry) => {
      const st = formatLogStatusBadge(entry.status);
      const canSelect = entry.status === 'to_borrow';
      const isSelected = state.selectedLogIds.has(entry.id);
      const avail = entry.smplAvailability;

      let availBadge = '';
      if (avail) {
        if (avail.status === 'on_shelf_main') {
          availBadge = `<span class="tag tag-available">✓ On shelf at Main (${avail.availableCopies || 1} avail)</span>`;
        } else if (avail.status === 'available_system') {
          availBadge = `<span class="tag tag-shelf">Ships fast to Main (${avail.availableCopies || 1} avail)</span>`;
        } else if (avail.status === 'waitlist') {
          availBadge = `<span class="tag tag-transit">Waitlist (${avail.holdsCount || 1} holds)</span>`;
        }
      }

      const ratingBadge =
        avail?.rating && avail.rating > 0 ? `<span class="tag tag-rating">★ ${avail.rating.toFixed(1)}</span>` : '';

      return `
        <article class="log-card ${isSelected ? 'selected' : ''} ${canSelect ? '' : 'no-checkbox'}">
          ${
            canSelect
              ? `
                <label class="select-box-label" aria-label="Select ${esc(entry.title)} to reserve">
                  <input type="checkbox" data-select-log="${esc(entry.id)}" ${isSelected ? 'checked' : ''} />
                </label>
              `
              : ''
          }
          ${coverMarkup(entry.coverUrl, entry.title, 'book-cover-sm', entry.author, entry.id)}
          <div class="book-info">
            <h3 class="book-title">${esc(entry.title)}</h3>
            <p class="book-author">${esc(entry.author || 'Author not listed')}</p>
            <div class="book-badges">
              ${availBadge}
              ${entry.source ? `<span class="tag tag-source">${esc(entry.source)}</span>` : ''}
              ${!canSelect ? `<span class="tag ${st.cls}">${esc(st.text)}</span>` : ''}
              ${ratingBadge}
              ${entry.theme ? `<span class="tag">${esc(entry.theme)}</span>` : ''}
            </div>
            ${entry.notes ? `<p class="log-note">${esc(entry.notes)}</p>` : ''}
          </div>
          <div class="log-card-actions">
            <button
              type="button"
              class="rate-pill-btn ${entry.status === 'loved' ? 'active' : ''}"
              data-rate-log="${esc(entry.id)}"
              data-rate-status="loved"
              title="Mark as Loved ❤️"
            >
              ❤️
            </button>
            <button
              type="button"
              class="rate-pill-btn ${entry.status === 'skip' ? 'active' : ''}"
              data-rate-log="${esc(entry.id)}"
              data-rate-status="skip"
              title="Didn't love 👎"
            >
              👎
            </button>
            ${
              canSelect
                ? `<button type="button" class="btn btn-primary btn-sm" data-log-reserve="${esc(entry.id)}">Reserve</button>`
                : `<button type="button" class="btn btn-secondary btn-sm" data-log-similar="${esc(entry.title)}">Similar</button>`
            }
          </div>
        </article>
      `;
    })
    .join('');

  container.querySelectorAll('[data-select-log]').forEach((cb) => {
    cb.addEventListener('change', () => {
      const id = cb.dataset.selectLog;
      if (cb.checked) state.selectedLogIds.add(id);
      else state.selectedLogIds.delete(id);
      cb.closest('.log-card')?.classList.toggle('selected', cb.checked);
      updateBatchBar();
    });
  });

  container.querySelectorAll('[data-rate-log]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.rateLog;
      const status = btn.dataset.rateStatus;
      try {
        await api(`/api/log/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status } });
        state.selectedLogIds.delete(id);
        showToast(status === 'loved' ? 'Marked Loved ❤️ (syncs to Sheet!)' : 'Marked Didn’t Love 👎');
        await loadDashboard();
      } catch (err) {
        showToast(err.message);
      }
    });
  });

  container.querySelectorAll('[data-log-reserve]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const entry = all.find((b) => b.id === btn.dataset.logReserve);
      if (!entry) return;
      btn.disabled = true;
      btn.textContent = 'Reserving…';
      try {
        const res = await api('/api/holds/place', {
          method: 'POST',
          body: {
            title: entry.title,
            author: entry.author,
            format: entry.theme || 'Picture Book',
            coverUrl: entry.coverUrl,
            bibId: entry.bibId || entry.smplAvailability?.bibId || '',
            catalogUrl: entry.catalogUrl,
          },
        });
        state.selectedLogIds.delete(entry.id);
        showToast(res.message || `Reserved “${entry.title}” at Main Library!`);
        await loadDashboard();
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Reserve';
        showToast(err.message, err.fallbackUrl ? { url: err.fallbackUrl, label: 'Reserve on SMPL' } : null);
      }
    });
  });

  container.querySelectorAll('[data-log-similar]').forEach((btn) => {
    btn.addEventListener('click', () => {
      switchView('discover');
      switchDiscoverMode('similar');
      runSimilarSearch(btn.dataset.logSimilar);
    });
  });
}

/* ==========================================================================
   Rendering: Discover Books
   ========================================================================== */

function populateCardSelector(d) {
  const cardSelect = document.getElementById('reserve-card-select');
  if (!cardSelect) return;
  const prev = cardSelect.value;
  cardSelect.innerHTML = d.cards
    .map((c) => `<option value="${esc(c.id)}">${esc(c.label)} (${esc(c.shelfName)})</option>`)
    .join('');
  if (prev && d.cards.some((c) => c.id === prev)) {
    cardSelect.value = prev;
  }
}

function renderAisleChips(aisles) {
  const container = document.getElementById('aisle-chips');
  const subtitle = document.getElementById('aisle-subtitle');
  if (!container || !aisles.length) return;

  container.innerHTML = aisles
    .map(
      (a) => `
      <button type="button" class="aisle-chip ${state.activeAisle === a.id ? 'active' : ''}" data-aisle-id="${esc(a.id)}">
        ${esc(a.label)}
      </button>
    `
    )
    .join('');

  const current = aisles.find((a) => a.id === state.activeAisle) || aisles[0];
  if (subtitle && current) subtitle.textContent = current.subtitle;

  container.querySelectorAll('[data-aisle-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.activeAisle = btn.dataset.aisleId;
      state.aislePage = 1;
      renderAisleChips(aisles);
      loadCuratedAisle(state.activeAisle, 1);
    });
  });
}

function switchDiscoverMode(mode) {
  state.discoverMode = mode;
  document.querySelectorAll('[data-discover-mode]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.discoverMode === mode);
  });
  document.getElementById('panel-foryou')?.classList.toggle('hidden', mode !== 'foryou');
  document.getElementById('panel-aisles')?.classList.toggle('hidden', mode !== 'aisles');
  document.getElementById('similar-form')?.classList.toggle('hidden', mode !== 'similar');
  document.getElementById('catalog-search-form')?.classList.toggle('hidden', mode !== 'search');
  document
    .getElementById('btn-shuffle-picks')
    ?.classList.toggle('hidden', mode !== 'foryou' && mode !== 'aisles');

  if (mode === 'foryou' || mode === 'aisles') {
    loadCurrentDiscoverMode();
  }
}

function loadCurrentDiscoverMode() {
  if (state.discoverMode === 'foryou') loadForYouPicks();
  else if (state.discoverMode === 'aisles') loadCuratedAisle(state.activeAisle, state.aislePage);
  else if (state.discoverMode === 'similar') {
    const q = document.getElementById('similar-query')?.value.trim();
    if (q) runSimilarSearch(q);
  } else if (state.discoverMode === 'search') {
    const q = document.getElementById('catalog-query')?.value.trim();
    if (q) runCatalogSearch(q);
  }
}

async function loadForYouPicks() {
  const container = document.getElementById('discover-results');
  const sourceEl = document.getElementById('discover-source-label');
  if (container) container.innerHTML = `<p class="meta-caption">Matching unread books to your 4-year-old’s ❤️ favorites…</p>`;
  try {
    const data = await api(
      `/api/catalog/for-you?mainOnly=${state.mainOnly}&offset=${state.forYouOffset}`
    );
    state.discoverResults = data.results || [];
    if (sourceEl) sourceEl.textContent = data.sourceLabel || '';
    renderDiscoverResults();
  } catch (err) {
    if (container) container.innerHTML = `<div class="empty-state"><h3>Couldn’t load picks</h3><p>${esc(err.message)}</p></div>`;
  }
}

async function loadCuratedAisle(aisleId, page = 1) {
  const container = document.getElementById('discover-results');
  const sourceEl = document.getElementById('discover-source-label');
  if (container) container.innerHTML = `<p class="meta-caption">Browsing San Mateo Main Library…</p>`;
  try {
    const data = await api(
      `/api/catalog/discover?aisle=${encodeURIComponent(aisleId)}&mainOnly=${state.mainOnly}&hideRead=${state.hideRead}&page=${page}`
    );
    state.discoverResults = data.results || [];
    if (sourceEl) sourceEl.textContent = data.sourceLabel || '';
    renderDiscoverResults();
  } catch (err) {
    if (container) container.innerHTML = `<div class="empty-state"><h3>Couldn’t load shelf</h3><p>${esc(err.message)}</p></div>`;
  }
}

async function runSimilarSearch(queryOverride) {
  const input = document.getElementById('similar-query');
  const query = queryOverride !== undefined ? queryOverride : input?.value || '';
  if (input && queryOverride !== undefined) input.value = queryOverride;
  if (!query.trim()) return;

  const container = document.getElementById('discover-results');
  const sourceEl = document.getElementById('discover-source-label');
  if (container) container.innerHTML = `<p class="meta-caption">Finding fresh books like “${esc(query)}”…</p>`;
  try {
    const data = await api(
      `/api/catalog/similar?q=${encodeURIComponent(query.trim())}&mainOnly=${state.mainOnly}&hideRead=${state.hideRead}`
    );
    state.discoverResults = data.results || [];
    if (sourceEl) sourceEl.textContent = data.sourceLabel || '';
    renderDiscoverResults();
  } catch (err) {
    if (container) container.innerHTML = `<div class="empty-state"><h3>Couldn’t find matches</h3><p>${esc(err.message)}</p></div>`;
  }
}

async function runCatalogSearch(queryOverride) {
  const input = document.getElementById('catalog-query');
  const query = queryOverride !== undefined ? queryOverride : input?.value || '';
  if (input && queryOverride !== undefined) input.value = queryOverride;

  const format = document.getElementById('search-format-select')?.value || 'physical';
  const audience = document.getElementById('search-audience-select')?.value || 'kids';
  const container = document.getElementById('discover-results');
  const sourceEl = document.getElementById('discover-source-label');
  if (container) container.innerHTML = `<p class="meta-caption">Searching San Mateo Main Library…</p>`;

  try {
    const data = await api(
      `/api/catalog/search?q=${encodeURIComponent(query.trim())}&format=${format}&audience=${audience}&mainOnly=${state.mainOnly}&hideRead=${state.hideRead}`
    );
    state.discoverResults = data.results || [];
    if (sourceEl) sourceEl.textContent = data.sourceLabel || '';
    renderDiscoverResults();
  } catch (err) {
    if (container) container.innerHTML = `<div class="empty-state"><h3>Search hiccup</h3><p>${esc(err.message)}</p></div>`;
  }
}

function renderDiscoverResults() {
  const container = document.getElementById('discover-results');
  if (!container) return;

  if (state.discoverResults.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <h3>No new unread matches on this shelf</h3>
        <p>Tap “↻ Fresh Picks” or turn off “On shelf at Main now” to include books shipped free from nearby branches.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = state.discoverResults
    .map((book, idx) => {
      let availBadge = `<span class="tag">San Mateo Catalog</span>`;
      if (book.onShelfAtMain) {
        availBadge = `<span class="tag tag-available">✓ On shelf at Main${book.availableCopies ? ` · ${book.availableCopies} avail` : ''}</span>`;
      } else if (book.status === 'AVAILABLE' && book.availableCopies != null) {
        availBadge = `<span class="tag tag-available">${book.availableCopies} available</span>`;
      } else if (book.status === 'CHECKED_OUT') {
        availBadge = `<span class="tag tag-transit">Waitlist · ${book.holdsCount ?? 0} holds</span>`;
      }

      const ratingBadge =
        book.rating && book.rating > 0
          ? `<span class="tag tag-rating">★ ${book.rating.toFixed(1)}${book.ratingCount ? ` (${book.ratingCount})` : ''}</span>`
          : '';
      const reasonBadge = book.matchReason ? `<span class="tag tag-reason">${esc(book.matchReason)}</span>` : '';

      return `
        <article class="book-card">
          <div class="book-card-top">
            ${coverMarkup(book.coverUrl, book.title, 'book-cover-md', book.author)}
            <div class="book-info">
              <h3 class="book-title">${esc(book.title)}</h3>
              <p class="book-author">${esc(book.author || 'San Mateo Public Library')}${book.year ? ` · ${esc(book.year)}` : ''}</p>
              <div class="book-badges">
                ${reasonBadge}
                ${availBadge}
                ${ratingBadge}
                <span class="tag">${esc(book.format || 'Book')}</span>
              </div>
              ${book.description ? `<p class="book-desc">${esc(book.description)}</p>` : ''}
            </div>
          </div>
          <div class="book-card-actions">
            <button type="button" class="btn btn-primary btn-sm" data-reserve-idx="${idx}">
              Reserve at Main
            </button>
            <button type="button" class="btn btn-secondary btn-sm" data-addlog-idx="${idx}" title="Save to Book Log as To Borrow">
              + Book Log
            </button>
            <button type="button" class="btn btn-ghost btn-sm" data-love-idx="${idx}" title="Already read & loved ❤️">
              ❤️
            </button>
          </div>
        </article>
      `;
    })
    .join('');

  container.querySelectorAll('[data-reserve-idx]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const book = state.discoverResults[Number(btn.dataset.reserveIdx)];
      if (!book) return;
      const cardId = document.getElementById('reserve-card-select')?.value || '';
      btn.disabled = true;
      btn.textContent = 'Reserving…';
      try {
        const res = await api('/api/holds/place', {
          method: 'POST',
          body: {
            title: book.title,
            author: book.author,
            format: book.format,
            coverUrl: book.coverUrl,
            bibId: book.bibId,
            catalogUrl: book.catalogUrl,
            cardId,
          },
        });
        btn.textContent = '✓ Reserved';
        showToast(res.message || 'Reserved at San Mateo Main Library!');
        await loadDashboard();
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Reserve at Main';
        showToast(err.message, err.fallbackUrl ? { url: err.fallbackUrl, label: 'Place hold on SMPL' } : null);
      }
    });
  });

  container.querySelectorAll('[data-addlog-idx]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const book = state.discoverResults[Number(btn.dataset.addlogIdx)];
      if (!book) return;
      try {
        await api('/api/log', {
          method: 'POST',
          body: {
            title: book.title,
            author: book.author,
            reader: '4-Year-Old',
            status: 'to_borrow',
            source: 'Added by Us',
            theme: 'Picture Book',
            coverUrl: book.coverUrl,
            catalogUrl: book.catalogUrl,
            bibId: book.bibId,
          },
        });
        btn.textContent = '✓ In Log';
        btn.disabled = true;
        showToast(`Added “${book.title}” to your Book Log!`);
        await loadDashboard();
      } catch (err) {
        showToast(err.message);
      }
    });
  });

  container.querySelectorAll('[data-love-idx]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const book = state.discoverResults[Number(btn.dataset.loveIdx)];
      if (!book) return;
      try {
        await api('/api/log', {
          method: 'POST',
          body: {
            title: book.title,
            author: book.author,
            reader: '4-Year-Old',
            status: 'loved',
            source: 'Added by Us',
            theme: 'Picture Book',
            coverUrl: book.coverUrl,
            catalogUrl: book.catalogUrl,
            bibId: book.bibId,
          },
        });
        btn.disabled = true;
        showToast(`Logged “${book.title}” as Loved ❤️!`);
        await loadDashboard();
      } catch (err) {
        showToast(err.message);
      }
    });
  });
}

/* ==========================================================================
   Rendering: Settings & Vault
   ========================================================================== */

function renderSettings(d) {
  const passcodeLine = document.getElementById('passcode-status-line');
  if (passcodeLine) {
    passcodeLine.innerHTML = d.passcodeEnabled
      ? `<strong>Family Passcode Gate:</strong> Active — only family members with your passcode can open this app.`
      : `<strong>Family Passcode Gate:</strong> Set <code>APP_PASSCODE</code> on your cloud host before sharing the URL.`;
  }

  const sheetUrlInput = document.getElementById('sheet-url-input');
  const openSheetLink = document.getElementById('open-google-sheet-link');
  if (sheetUrlInput && document.activeElement !== sheetUrlInput) {
    sheetUrlInput.value = d.settings.googleSheetUrl || '';
  }
  if (openSheetLink) {
    if (d.settings.googleSheetUrl) {
      openSheetLink.href = d.settings.googleSheetUrl;
      openSheetLink.classList.remove('hidden');
    } else {
      openSheetLink.classList.add('hidden');
    }
  }

  const famName = document.getElementById('pref-family-name');
  const prefSync = document.getElementById('pref-sync-mins');
  const prefScout = document.getElementById('pref-auto-scout');
  if (famName && document.activeElement !== famName) famName.value = d.settings.familyName || 'Our Family';
  if (prefSync) prefSync.value = String(d.settings.autoSyncMinutes ?? 30);
  if (prefScout) prefScout.checked = d.settings.autoScoutMonthly !== false;

  const cardsList = document.getElementById('cards-list');
  if (cardsList) {
    cardsList.innerHTML = d.cards
      .map(
        (c) => `
        <div class="vault-card-row">
          <div class="vault-card-identity">
            <div class="card-avatar" style="background:${esc(c.avatarColor)}">${esc(c.label.slice(0, 1).toUpperCase())}</div>
            <div>
              <strong>${esc(c.label)}</strong>
              <div class="meta-caption">
                ${esc(c.maskedCardNumber)} · Shelf: <strong>${esc(c.shelfName)}</strong>
                ${c.lastSyncedAt ? ` · Synced ${esc(formatRelativeTime(c.lastSyncedAt))}` : ''}
              </div>
              ${c.lastSyncError ? `<div class="form-error">${esc(c.lastSyncError)}</div>` : ''}
            </div>
          </div>
          <div>
            ${
              !c.isDemo
                ? `<button type="button" class="btn btn-secondary btn-sm" data-sync-card="${esc(c.id)}">Sync</button>`
                : `<span class="tag">Sample Card</span>`
            }
            ${
              !c.fromEnv && !c.isDemo
                ? `<button type="button" class="btn btn-danger-ghost btn-sm" data-delete-card="${esc(c.id)}">Remove</button>`
                : ''
            }
          </div>
        </div>
      `
      )
      .join('');

    cardsList.querySelectorAll('[data-sync-card]').forEach((btn) => {
      btn.addEventListener('click', () => triggerSync(btn.dataset.syncCard));
    });
    cardsList.querySelectorAll('[data-delete-card]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Remove this library card from your private server vault?')) return;
        await api(`/api/cards/${encodeURIComponent(btn.dataset.deleteCard)}`, { method: 'DELETE' });
        showToast('Card removed from vault.');
        await loadDashboard();
      });
    });
  }

  const dir = document.getElementById('branch-directory');
  if (dir && d.branch) {
    const b = d.branch;
    const dotClass = b.live.isOpen ? (b.live.closingSoon ? 'closing' : 'open') : 'closed';
    dir.innerHTML = `
      <p><span class="status-dot-label ${dotClass}">${esc(b.live.statusLabel)} · ${esc(b.live.detail)}</span></p>
      <p><strong>Address:</strong> ${esc(b.address)}</p>
      <p><strong>Phone:</strong> ${esc(b.phone)}</p>
      <p><strong>Hours:</strong> ${esc(b.hoursSummary)}</p>
      <p><strong>Parking &amp; Pickup:</strong> ${esc(b.pickupTip)}</p>
    `;
  }
}

/* ==========================================================================
   Actions & Event Wiring
   ========================================================================== */

async function loadDashboard() {
  state.dashboard = await api('/api/dashboard');
  renderDashboard();
}

async function triggerSync(cardId = null) {
  if (state.isSyncing) return;
  state.isSyncing = true;
  const headerBtn = document.getElementById('btn-sync-header');
  headerBtn?.classList.add('spinning');
  if (headerBtn) headerBtn.disabled = true;

  try {
    const res = await api('/api/holds/sync', { method: 'POST', body: cardId ? { cardId } : {} });
    await loadDashboard();
    if (state.dashboard?.mode === 'demo') {
      showToast('Preview Mode active — connect your SMPL card in Card & Sheet for live sync.');
    } else if (res.ok) {
      const total = res.results.reduce((acc, r) => acc + (r.syncedCount || 0), 0);
      showToast(`Synced ${total} ${total === 1 ? 'hold' : 'holds'} from San Mateo Main Library!`);
    } else {
      const firstErr = res.results.find((r) => !r.ok)?.error || 'Sync returned a library notice.';
      showToast(firstErr, { url: 'https://smplibrary.bibliocommons.com/v2/holds', label: 'Open SMPL Holds' });
    }
  } catch (err) {
    showToast(err.message);
  } finally {
    state.isSyncing = false;
    headerBtn?.classList.remove('spinning');
    if (headerBtn) headerBtn.disabled = false;
  }
}

async function triggerAvailabilityCheck(force = true) {
  if (state.isCheckingAvail) return;
  state.isCheckingAvail = true;
  const btn = document.getElementById('btn-check-main-avail');
  const orig = btn?.textContent;
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Checking Main…';
  }
  try {
    const res = await api('/api/log/check-availability', { method: 'POST', body: { force } });
    await loadDashboard();
    showToast(`Checked San Mateo Main! ${res.onShelfMain} of your To Borrow books are on the shelf right now.`);
  } catch (err) {
    showToast(err.message);
  } finally {
    state.isCheckingAvail = false;
    if (btn) {
      btn.disabled = false;
      btn.textContent = orig || 'Check Main Library';
    }
  }
}

async function triggerMonthlyScout() {
  if (state.isScouting) return;
  state.isScouting = true;
  const btn = document.getElementById('btn-run-scout');
  const orig = btn?.textContent;
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Scouting…';
  }
  try {
    const res = await api('/api/scout/run', { method: 'POST', body: { maxAdd: 6 } });
    await loadDashboard();
    showToast(res.message || `Added ${res.addedCount} new books to your Book Log!`);
  } catch (err) {
    showToast(err.message);
  } finally {
    state.isScouting = false;
    if (btn) {
      btn.disabled = false;
      btn.textContent = orig || '✦ Scout New Books';
    }
  }
}

async function triggerBatchReserve() {
  const ids = [...state.selectedLogIds];
  if (ids.length === 0) return;
  const btn = document.getElementById('btn-batch-reserve');
  if (btn) {
    btn.disabled = true;
    btn.textContent = `Reserving ${ids.length}…`;
  }
  try {
    const cardId = document.getElementById('reserve-card-select')?.value || '';
    const res = await api('/api/holds/place-batch', { method: 'POST', body: { logIds: ids, cardId } });
    state.selectedLogIds.clear();
    await loadDashboard();
    showToast(res.message || `Reserved ${res.succeeded} books at San Mateo Main Library!`);
    switchView('grab');
  } catch (err) {
    showToast(err.message);
  } finally {
    if (btn) btn.disabled = false;
    updateBatchBar();
  }
}

async function triggerSheetSync() {
  try {
    const res = await api('/api/sheets/sync', { method: 'POST', body: {} });
    await loadDashboard();
    showToast(`Google Sheet synced! ${res.added} new, ${res.updated} updated (${res.total} total).`);
  } catch (err) {
    showToast(err.message);
  }
}

function wireEvents() {
  document.addEventListener('click', (e) => {
    const navTarget = e.target.closest('[data-nav]');
    if (!navTarget) return;
    e.preventDefault();
    switchView(navTarget.dataset.nav);
  });

  document.getElementById('btn-sync-header')?.addEventListener('click', () => triggerSync());
  document.getElementById('btn-sync-all-settings')?.addEventListener('click', () => triggerSync());
  document.getElementById('btn-check-main-avail')?.addEventListener('click', () => triggerAvailabilityCheck(true));
  document.getElementById('btn-run-scout')?.addEventListener('click', () => triggerMonthlyScout());
  document.getElementById('btn-batch-reserve')?.addEventListener('click', () => triggerBatchReserve());
  document.getElementById('btn-batch-clear')?.addEventListener('click', () => {
    state.selectedLogIds.clear();
    renderBookLog(state.dashboard);
    updateBatchBar();
  });

  document.getElementById('btn-sync-sheet-top')?.addEventListener('click', () => triggerSheetSync());
  document.getElementById('btn-sync-sheet-settings')?.addEventListener('click', () => triggerSheetSync());

  // Book Log filters
  document.querySelectorAll('#log-filters .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      state.logFilter = chip.dataset.logFilter;
      document.querySelectorAll('#log-filters .chip').forEach((c) => c.classList.toggle('active', c === chip));
      renderBookLog(state.dashboard);
    });
  });

  // Add to Book Log
  document.getElementById('log-add-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('log-title').value.trim();
    if (!title) return;
    try {
      const res = await api('/api/log', {
        method: 'POST',
        body: {
          title,
          author: document.getElementById('log-author').value.trim(),
          reader: '4-Year-Old',
          status: document.getElementById('log-status').value,
          source: 'Added by Us',
          theme: document.getElementById('log-theme').value,
          notes: document.getElementById('log-notes').value.trim(),
        },
      });
      e.target.reset();
      showToast(res.sheetPushed ? `Saved “${title}” & synced to Google Sheet!` : `Saved “${title}” to Book Log!`);
      await loadDashboard();
    } catch (err) {
      showToast(err.message);
    }
  });

  document.getElementById('csv-import-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = document.getElementById('csv-import-text').value.trim();
    if (!text) return;
    try {
      const res = await api('/api/log/import-csv', { method: 'POST', body: { csv: text } });
      document.getElementById('csv-import-text').value = '';
      showToast(`Imported ${res.added} new books (${res.total} total in Book Log)!`);
      await loadDashboard();
    } catch (err) {
      showToast(err.message);
    }
  });

  // Discover events
  document.querySelectorAll('[data-discover-mode]').forEach((btn) => {
    btn.addEventListener('click', () => switchDiscoverMode(btn.dataset.discoverMode));
  });
  document.getElementById('toggle-main-only')?.addEventListener('change', (e) => {
    state.mainOnly = e.target.checked;
    loadCurrentDiscoverMode();
  });
  document.getElementById('toggle-hide-read')?.addEventListener('change', (e) => {
    state.hideRead = e.target.checked;
    loadCurrentDiscoverMode();
  });
  document.getElementById('btn-shuffle-picks')?.addEventListener('click', () => {
    if (state.discoverMode === 'foryou') {
      state.forYouOffset += 1;
      loadForYouPicks();
    } else {
      state.aislePage = (state.aislePage % 6) + 1;
      loadCuratedAisle(state.activeAisle, state.aislePage);
    }
  });
  document.getElementById('similar-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    runSimilarSearch();
  });
  document.querySelectorAll('[data-similar-pick]').forEach((btn) => {
    btn.addEventListener('click', () => runSimilarSearch(btn.dataset.similarPick));
  });
  document.getElementById('catalog-search-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    runCatalogSearch();
  });
  for (const id of ['search-format-select', 'search-audience-select']) {
    document.getElementById(id)?.addEventListener('change', () => {
      if (document.getElementById('catalog-query')?.value.trim()) runCatalogSearch();
    });
  }

  // Settings forms
  document.getElementById('sheet-config-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const body = { googleSheetUrl: document.getElementById('sheet-url-input').value.trim() };
      const webhookVal = document.getElementById('sheet-webhook-input').value.trim();
      if (webhookVal) body.webhookUrl = webhookVal;
      await api('/api/sheets/config', { method: 'PUT', body });
      document.getElementById('sheet-webhook-input').value = '';
      showToast('Google Sheet connection saved securely!');
      await loadDashboard();
    } catch (err) {
      showToast(err.message);
    }
  });

  document.getElementById('add-card-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-save-card');
    btn.disabled = true;
    btn.textContent = 'Encrypting & Syncing…';
    try {
      const res = await api('/api/cards', {
        method: 'POST',
        body: {
          label: document.getElementById('card-label').value.trim(),
          shelfName: document.getElementById('card-shelf-name').value.trim(),
          cardNumber: document.getElementById('card-number').value.trim(),
          pin: document.getElementById('card-pin').value.trim(),
        },
      });
      e.target.reset();
      await loadDashboard();
      showToast(
        res.syncResult && !res.syncResult.ok
          ? `Card saved! Sync note: ${res.syncResult.error}`
          : 'Library card encrypted on server & synced with San Mateo Main Library!'
      );
    } catch (err) {
      showToast(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save Encrypted & Sync Holds';
    }
  });

  document.getElementById('family-prefs-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/settings', {
        method: 'PUT',
        body: {
          familyName: document.getElementById('pref-family-name').value.trim(),
          autoSyncMinutes: Number(document.getElementById('pref-sync-mins').value),
          autoScoutMonthly: document.getElementById('pref-auto-scout').checked,
        },
      });
      showToast('Preferences saved!');
      await loadDashboard();
    } catch (err) {
      showToast(err.message);
    }
  });

  document.getElementById('passcode-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('passcode-input');
    const errEl = document.getElementById('passcode-error');
    errEl?.classList.add('hidden');
    try {
      await api('/api/auth/login', { method: 'POST', body: { passcode: input.value } });
      input.value = '';
      hidePasscodeLock();
      await loadDashboard();
    } catch (err) {
      if (errEl) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
      }
    }
  });
}

async function init() {
  wireEvents();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  try {
    const auth = await api('/api/auth/status');
    if (auth.passcodeEnabled && !auth.authenticated) {
      showPasscodeLock();
      return;
    }
    await loadDashboard();
  } catch (err) {
    if (err.message !== 'Family passcode required') {
      showToast('Unable to connect to PageTurner server.');
    }
  }
}

init();
