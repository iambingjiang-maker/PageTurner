# PageTurner — San Mateo Main Library Grab & Go

A private, mobile-first web app for your family to discover great new books, reserve them at **San Mateo Main Library (55 W. Third Ave)**, and check them off on a **Grab & Go** pickup dashboard—so you can walk in, grab your holds off the shelf, and leave.

---

## Features Built for Your Family

- **Grab & Go Pickup Dashboard** — Shows everything ready on the San Mateo Main Library hold shelf (with pickup deadlines and shelf name), live open/closing status, 2-hour underground parking info, and one-tap **Mark Grabbed** checkoffs.
- **Discover Great Books** — Queries San Mateo Main Library's live catalog (`7S`) to show:
  - **Curated Aisles**: *Top-Rated Kids*, *New Kids Arrivals*, *Kids Graphic Novels*, *Award Winners*, *Top Adult Fiction*, *New Adult Arrivals*, and *Cookbooks & Food*—filtered by **On the Shelf at Main Now** so you can skip long waitlists.
  - **Find Books Like…**: Enter any book your family loved (e.g., *The Wild Robot*, *Dog Man*, *Percy Jackson*) to surface next books in the series, same-author reads, and similar highly rated titles sitting at San Mateo Main.
  - **Instant Search & 1-Tap Reserve at Main**.
- **Family Book List** — Drop book ideas anytime and reserve them individually or hit **Reserve All at Main**.
- **Works 24/7 Even When Your Laptop Is Off** — Host privately on Render, Railway, or Fly.io and tap **Add to Home Screen** on your phone.

## Privacy & Security (Zero Secrets on GitHub)

- `.env` and `data/` (where your encrypted library card vault lives) are strictly ignored in `.gitignore`.
- Library card numbers and PINs are encrypted at rest with **AES-256-GCM** using `ENCRYPTION_SECRET`.
- Set `APP_PASSCODE` on your cloud host to lock the entire app behind a private family passcode (signed HttpOnly cookie sessions).

---

## Quick Start (Local)

```bash
npm install
cp .env.example .env
npm start
```

Open `http://localhost:3000`. Go to **Library Card** to connect your San Mateo Public Library card(s) for live automatic syncing.

## Deploy Privately (24/7 Access on Phones)

### Option A: Render (`render.yaml`)
1. Connect your **private** `PageTurner` GitHub repository on [Render](https://render.com) as a Blueprint.
2. Set `APP_PASSCODE` in Render's **Environment** tab to your chosen family passcode (`ENCRYPTION_SECRET` is generated automatically).
3. Open your private Render URL on your phone, unlock with your passcode, and connect your San Mateo Public Library card in **Library Card**.

### Option B: Railway / Fly.io (`Dockerfile`)
1. Deploy directly from your private GitHub repo using `Dockerfile` with a persistent volume at `/app/data`.
2. Set `APP_PASSCODE` and `ENCRYPTION_SECRET` as secret environment variables.

## Running Tests

```bash
npm test
```
