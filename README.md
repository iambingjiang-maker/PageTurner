# PageTurner — San Mateo Main Library Grab & Go

A private, **\$0/month** iPhone 15-ready web app for your family to manage a curated **NYT / Barnes & Noble / Caldecott Book Log** backed by **Google Sheets**, check live **San Mateo Main Library** shelf availability, **1-click batch reserve**, and walk in for **Grab & Go** pickup—even when your laptop is off.

---

## Go Live for \$0/Month on Vercel (3 Minutes)

Your **Google Sheet** acts as the permanent cloud database, and **Vercel Free (Hobby)** runs the private backend + automatic monthly book scout for **\$0/month** with instant iPhone loading.

### Step 1: Turn On Your Google Sheet Cloud Bridge (1 Minute)
1. Open your **PageTurner — Family Book Log** Google Sheet.
2. Click **Extensions → Apps Script**.
3. Delete any default code, paste the entire contents of [`google-apps-script/Code.gs`](google-apps-script/Code.gs), and click **Save**.
4. Click **Deploy → New deployment → Web app**:
   - **Execute as:** `Me`
   - **Who has access:** `Anyone` *(your sheet itself remains completely private—only this random URL can talk to it)*.
5. Copy the **Web app URL** (`https://script.google.com/macros/s/.../exec`).

### Step 2: Deploy Free on Vercel (3 Clicks)
1. Go to [vercel.com](https://vercel.com) → **Continue with GitHub**.
2. Click **Add New… → Project** → import **`iambingjiang-maker/PageTurner`**.
3. Open **Environment Variables** and add these private variables *(they stay locked inside Vercel and are NEVER stored in GitHub)*:

| Variable | Value |
| --- | --- |
| `APP_PASSCODE` | Your private family passcode to open the app |
| `ENCRYPTION_SECRET` | Any random long secret phrase (32+ characters) |
| `SMPL_CARD_NUMBER` | Your 14-digit San Mateo Public Library barcode |
| `SMPL_PIN` | Your library PIN |
| `SMPL_SHELF_NAME` | Last name on the San Mateo Main hold shelf (e.g. `JIANG`) |
| `GOOGLE_SHEET_URL` | Your Google Sheet `/edit` link |
| `GOOGLE_SHEET_WEBHOOK_URL` | The Apps Script Web app URL from Step 1 |

4. Click **Deploy**! In ~30 seconds, your private app is live at `https://page-turner-....vercel.app`.

> **Automatic Monthly New-Book Scout:** [`vercel.json`](vercel.json) automatically triggers `/api/cron/monthly-scout` on the **1st of every month** to check San Mateo Main Library's newest 4+ star kids books & favorite authors and append fresh unread picks straight to your Google Sheet.

### Step 3: Install on iPhone 15
1. Open your Vercel URL in **Safari** on your iPhone 15.
2. Enter your family passcode (stays signed in for 30 days).
3. Tap **Share** (square with arrow) → **Add to Home Screen**.

---

## Local Development

```bash
npm install
cp .env.example .env
npm start
```

Run tests:

```bash
npm test
```
