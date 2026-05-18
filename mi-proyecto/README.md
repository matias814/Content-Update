# Intercom Campaign Deadline Sync

Reads every **internal article** in your Intercom workspace, parses the
deadline date embedded in each title, and keeps a single summary article called
**"Campaign deadline dates"** up to date so Fin can answer deadline questions
reliably.

---

## How it works

1. On startup (and daily at **06:00 UTC**) `index.js` calls `sync.js`.
2. All internal articles are fetched from `GET /internal_articles` with full
   pagination support (`Intercom-Version: 2.14`).
3. Each title is scanned for a date in any of these formats:

   | Format | Example title | Parsed as |
   |---|---|---|
   | `YYYY-MM-DD` | `Ark Naturals - 2026-06-02` | `2026-06-02` |
   | `MM/DD` / `M/D` | `Ancient Organics - 05/26` | `2026-05-26` |
   | `MM/YY` (> 31) | `Some Brand - 05/35` | `2035-05-01` |
   | `M/D/YYYY` | `Some Brand - 5/5/2026` | `2026-05-05` |
   | `MM/DD/YY` | `Some Brand - 05/26/26` | `2026-05-26` |

4. Results are sorted soonest-first and written as:
   ```
   Campaign Name | Deadline: YYYY-MM-DD
   ```
5. The summary article is updated in place (or created on the very first run).

> **MM/YY vs MM/DD ambiguity** — when the second slash token is ≤ 31 it is
> treated as a **day** (MM/DD) and the year is inferred. If your titles use
> e.g. `05/26` to mean *May 2026* rather than *May 26th*, open `sync.js` and
> set `PREFER_MMYY = true`; tokens ≥ 25 will then be read as 2-digit years.

---

## Local setup

```bash
# 1. Install dependencies
npm install

# 2. Create your env file
cp .env.example .env
# Edit .env — at minimum set INTERCOM_TOKEN

# 3. Run a one-off sync
npm run sync
# → on first run the script creates the article and prints its ID

# 4. Copy the printed ARTICLE_ID into .env

# 5. Start the scheduler (immediate sync + daily cron)
npm start
```

---

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `INTERCOM_TOKEN` | **Yes** | — | Intercom Access Token (Settings → Developers → Access Token) |
| `ARTICLE_ID` | No* | — | ID of the "Campaign deadline dates" article. Set after first run to ensure the same article is always updated. |
| `CRON_SCHEDULE` | No | `0 6 * * *` | Cron expression for sync schedule. |
| `CRON_TIMEZONE` | No | `UTC` | Timezone for the schedule. Example: `America/New_York`. |

> *If `ARTICLE_ID` is unset the script searches fetched articles for the
> exact title "Campaign deadline dates". If still not found, a new article is
> created and its ID is printed — set it before the next run.

---

## Deploy on Railway

### 1 — Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
# Create a repo on GitHub, then:
git remote add origin https://github.com/YOUR_USERNAME/intercom-campaign-sync.git
git push -u origin main
```

### 2 — Create a Railway project

1. Go to [railway.app](https://railway.app) and sign in.
2. **New Project → Deploy from GitHub repo** → select your repository.
3. Railway detects Node.js automatically and runs `npm start`.

### 3 — Set environment variables

In your Railway service open the **Variables** tab and add:

| Key | Value |
|---|---|
| `INTERCOM_TOKEN` | your token |
| `ARTICLE_ID` | *(leave blank — fill in after first deploy)* |

### 4 — First deploy

Click **Deploy**. Railway will install dependencies and start the process.
The startup sync runs immediately. Open the **Logs** tab and look for:

```
ACTION REQUIRED — add this to your .env / Railway:
  ARTICLE_ID=<number>
```

### 5 — Set ARTICLE_ID and redeploy

Add `ARTICLE_ID=<number>` in the Variables tab, then click **Redeploy**.
All future runs (startup + daily cron) will update that same article.

---

## Manual one-off sync

```bash
# Locally
npm run sync

# On Railway (via CLI)
railway run npm run sync
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `INTERCOM_TOKEN is not set` | Variable name must match exactly — check the Railway Variables tab. |
| `HTTP 401` | Token is invalid or expired — generate a new one in Intercom. |
| `HTTP 404` on update | The stored `ARTICLE_ID` no longer exists — clear it so a new article is created. |
| Duplicate summary articles | Set `ARTICLE_ID` after the first run. |
| Campaigns missing from list | Their titles contain no parseable date — check the "Skipped N articles" log line. |
| Wrong cron time | Set `CRON_TIMEZONE` to your local tz (e.g. `America/Chicago`). |
