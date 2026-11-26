# PageTurner

A mobile-first Progressive Web App (PWA) for discovering high-signal children's books, checking real-time public library shelf availability, placing **1-click batch holds**, and managing quick **Grab & Go** pickup—backed by **Google Sheets** and deployed for **$0/month** on **Vercel Serverless**.

---

## Why This Exists

Borrowing picture books from a local library usually has two friction points:
1. **Discovery fatigue** — sorting through thousands of titles to avoid duds and consistently find engaging books.
2. **Checkout friction** — checking shelf availability one title at a time, placing individual holds, and tracking what's actually ready for pickup.

PageTurner connects a curated reading log directly to the **BiblioCommons v2 Gateway API** (configured out of the box for San Mateo Main Library, adaptable to any BiblioCommons library system) so you can maintain a vetted wishlist, see what's physically on the shelf right now, batch-reserve in one tap, and walk in for pickup.

---

## Key Features

- **Curated Book Log + 2-Way Google Sheets Sync:** Uses Google Sheets + Apps Script as a zero-cost, human-editable cloud database with CSV import/export, quick `Loved` / `Liked` / `Skip` ratings, and automatic deduplication.
- **Live Shelf Availability & 1-Click Batch Holds:** Batch-queries real-time physical branch inventory, surfaces exact shelf status, and authenticates via the BiblioCommons v2 session API to place multiple holds in a single tap (with graceful 1-tap catalog fallback links).
- **Grab & Go Pickup Dashboard:** Tracks live holds (`Ready for Pickup`, `In Transit`, `Waiting`), hold expiration dates, live Pacific Time open/closing hours, and a tap-to-checkoff shelf checklist.
- **Automated Monthly New-Book Scout:** Scheduled via Vercel Cron to scan newly acquired 4+ star children's books and unread titles by favorite authors, automatically appending fresh picks to the Book Log.
- **6-Tier Self-Healing Book Cover Pipeline:** Resolves verified publisher cover art across BookSense, BiblioCommons catalog ISBNs, Open Library, Apple Books, and Google Books—rejecting 1×1 tracking pixels and known generic placeholder hashes via SHA-256 fingerprinting.
- **Mobile-First iOS PWA & Security:** Built for iPhone Home Screen installation (`viewport-fit=cover`, safe-area insets, 44px tap targets), protected by an HMAC-signed 30-day passcode gate and AES-256-GCM runtime secret encryption.

---

## Architecture & Tech Stack

```text
iPhone / Browser PWA (Vanilla HTML/CSS/JS, Service Worker)
        │
        ▼
Express 5 API on Vercel Serverless (/api/index.js)
  ├── Auth & Crypto: HMAC-SHA256 HttpOnly sessions + AES-256-GCM
  ├── BiblioCommons v2 Client: Live search, branch status, JSON session auth, holds CRUD
  ├── Cover Art Resolver: 6-tier fallback + SHA-256 placeholder rejection
  ├── Monthly Scout Cron: Automated discovery via vercel.json cron
  └── Google Sheets Cloud Bridge: 2-way JSON sync via Google Apps Script
```

- **Runtime:** Node.js 20+ (ESM), Express 5, zero heavy frontend frameworks
- **Hosting & Scheduling:** Vercel Serverless Functions + Vercel Cron (**$0/month** Hobby tier)
- **Persistence:** Google Sheets + Apps Script Web App (`google-apps-script/Code.gs`)
- **Testing:** Built-in Node.js test runner (`node --test`)

---

## Deploy Your Own ($0/Month)

### 1. Set Up Your Google Sheet Bridge
1. Create a Google Sheet with a `BookLog` tab (`Date | Title | Author | Reader | Status | Source | Theme | Notes | SMPL Link | BibID`).
2. Open **Extensions → Apps Script**, paste [`google-apps-script/Code.gs`](google-apps-script/Code.gs), and save.
3. Click **Deploy → New deployment → Web app**:
   - **Execute as:** `Me`
   - **Who has access:** `Anyone` *(the spreadsheet itself stays private; only the random Web App URL can reach the script)*.
4. Copy the generated Web App URL (`https://script.google.com/macros/s/.../exec`).

### 2. Deploy on Vercel
1. Fork or import this repository into [Vercel](https://vercel.com).
2. Add the following private **Environment Variables** in Project Settings *(never commit credentials to Git)*:

| Variable | Description |
| --- | --- |
| `APP_PASSCODE` | Private passcode required to unlock the app |
| `ENCRYPTION_SECRET` | Random 32+ character secret used for AES-256-GCM & cookie signing |
| `SMPL_CARD_NUMBER` | Library card barcode *(optional — runs in Demo Mode if omitted)* |
| `SMPL_PIN` | Library card PIN |
| `SMPL_SHELF_NAME` | Last name printed on library hold slips (e.g. `SMITH`) |
| `GOOGLE_SHEET_URL` | Link to your Google Sheet |
| `GOOGLE_SHEET_WEBHOOK_URL` | Apps Script Web App URL from Step 1 |

3. Deploy! Open the live URL in Safari on iOS and tap **Share → Add to Home Screen** to install as a standalone app.

---

## Local Development & Testing

```bash
npm install
cp .env.example .env
npm start
```

Run the test suite:

```bash
npm test
```

Without library credentials configured, PageTurner starts cleanly in **Demo Mode** so you can explore the full UI, Book Log, live catalog discovery, and Grab & Go workflow locally.
