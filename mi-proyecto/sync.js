'use strict';

require('dotenv').config();
const axios = require('axios');

const SUMMARY_TITLE = 'Campaign deadline dates';
const BASE_URL = 'https://api.intercom.io';
const INTERCOM_VERSION = '2.14';

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------

const api = axios.create({
  baseURL: BASE_URL,
  headers: {
    Authorization: `Bearer ${process.env.INTERCOM_TOKEN}`,
    'Intercom-Version': INTERCOM_VERSION,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  },
});

// ---------------------------------------------------------------------------
// Fetch all internal articles (handles pagination)
// ---------------------------------------------------------------------------

async function fetchAllInternalArticles() {
  const articles = [];
  let page = 1;

  while (true) {
    const { data } = await api.get('/internal_articles', {
      params: { page, per_page: 150 },
    });

    const items = data.data ?? data.articles ?? [];
    if (items.length === 0) break;

    articles.push(...items);

    // Support both cursor-based and page-based pagination shapes
    const totalPages = data.pages?.total_pages ?? data.total_pages ?? 1;
    if (page >= totalPages) break;
    page++;
  }

  return articles;
}

// ---------------------------------------------------------------------------
// Date parsing
//
// Supported formats (anywhere inside the title string):
//   YYYY-MM-DD        2026-06-02
//   M/D  or  MM/DD   5/5   05/26   (day ≤ 31; year inferred from context)
//   MM/YY             05/26  when the second token is > 12 *and* looks like a
//                     two-digit year (see disambiguation note below)
//   M/D/YYYY          5/5/2026
//   MM/DD/YY          05/26/26
//
// Disambiguation  M/D  vs  MM/YY:
//   The slash format is inherently ambiguous when the second token is 1-31
//   (valid both as a day and a 2-digit year for 2001-2031).
//   Rule applied here:
//     • second token > 31  → definitely MM/YY  (e.g. 05/35 = May 2035)
//     • second token 1-31  → treated as a DAY  (MM/DD)
//       Year is then inferred: current year, unless that date is already
//       more than 7 days in the past, in which case next year.
//
//   If your titles use "05/26" to mean "May 2026" rather than "May 26th",
//   change the PREFER_MMYY constant below to true so that second tokens
//   in the range 25-31 are also treated as 2-digit years.
// ---------------------------------------------------------------------------

const PREFER_MMYY = false; // flip to true if MM/YY is the dominant format

function parseDeadline(title) {
  // 1. ISO  YYYY-MM-DD
  const iso = title.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // 2. Slash formats
  const slash = title.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (!slash) return null;

  const mm  = slash[1].padStart(2, '0');
  const raw = parseInt(slash[2], 10);

  // Explicit year supplied  →  M/D/YYYY or MM/DD/YY
  if (slash[3]) {
    const dd   = String(raw).padStart(2, '0');
    const yRaw = slash[3];
    const year = yRaw.length === 2 ? `20${yRaw}` : yRaw;
    return `${year}-${mm}-${dd}`;
  }

  // Decide: treat second token as a year or as a day
  const treatAsYear =
    raw > 31 || (PREFER_MMYY && raw >= 25 && raw <= 31);

  if (treatAsYear) {
    // MM/YY  →  first of that month
    const year = raw < 100 ? `20${String(raw).padStart(2, '0')}` : String(raw);
    return `${year}-${mm}-01`;
  }

  // MM/DD  →  infer year
  const dd        = String(raw).padStart(2, '0');
  const now       = new Date();
  const thisYear  = now.getFullYear();
  const candidate = new Date(`${thisYear}-${mm}-${dd}`);
  const cutoff    = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const year      = candidate < cutoff ? thisYear + 1 : thisYear;
  return `${year}-${mm}-${dd}`;
}

// ---------------------------------------------------------------------------
// Campaign name  (everything before the trailing " - <date>" suffix)
// ---------------------------------------------------------------------------

// Matches emoji codepoints plus the invisible glue characters used in
// multi-codepoint sequences: ZWJ (U+200D), variation selector-16 (U+FE0F),
// and combining enclosing keycap (U+20E3). Without these, characters like
// 🧚‍♀️ or ☁️ leave behind invisible residue that appears as stray characters.
const EMOJI_RE = /[\p{Emoji_Presentation}\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu;

function extractName(title) {
  const lastDash = title.lastIndexOf(' - ');
  if (lastDash === -1) return title.trim();

  const suffix = title.slice(lastDash + 3).trim();
  const looksLikeDate =
    /^\d{4}-\d{2}-\d{2}$/.test(suffix) ||
    /^\d{1,2}\/\d{1,2}(\/\d{2,4})?$/.test(suffix);

  const name = looksLikeDate ? title.slice(0, lastDash).trim() : title.trim();
  return name.replace(EMOJI_RE, '').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Build article body (HTML)
// ---------------------------------------------------------------------------

function buildBody(campaigns) {
  const today = new Date().toISOString().split('T')[0];

  const rows = campaigns
    .map(({ name, deadline }) => `<p>${name} | Deadline: ${deadline}</p>`)
    .join('\n');

  return (
    `<p><em>Last updated: ${today} — ${campaigns.length} active campaigns</em></p>\n` +
    rows
  );
}

// ---------------------------------------------------------------------------
// Intercom write helpers
// ---------------------------------------------------------------------------

async function getAuthorId() {
  const { data } = await api.get('/me');
  return data.id;
}

async function createArticle(body, authorId) {
  const { data } = await api.post('/internal_articles', {
    title:     SUMMARY_TITLE,
    body,
    author_id: authorId,
    state:     'published',
  });
  return data;
}

async function updateArticle(id, body) {
  const { data } = await api.put(`/internal_articles/${id}`, {
    title: SUMMARY_TITLE,
    body,
    state: 'published',
  });
  return data;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function sync() {
  if (!process.env.INTERCOM_TOKEN) {
    throw new Error('INTERCOM_TOKEN is not set — check your .env file');
  }

  const ts = () => new Date().toISOString();
  console.log(`[${ts()}] Starting sync…`);

  // ── 1. Fetch ──────────────────────────────────────────────────────────────
  const all = await fetchAllInternalArticles();
  console.log(`  Fetched ${all.length} internal articles`);

  // ── 2. Parse ──────────────────────────────────────────────────────────────
  const campaigns = [];
  let skipped = 0;

  for (const article of all) {
    const title = (article.title || '').trim();
    if (title === SUMMARY_TITLE) continue; // never include the summary itself

    const deadline = parseDeadline(title);
    if (!deadline) { skipped++; continue; }

    campaigns.push({ name: extractName(title), deadline });
  }

  // Sort: soonest deadline first
  campaigns.sort((a, b) => a.deadline.localeCompare(b.deadline));

  console.log(`  Parsed  ${campaigns.length} campaigns with dates`);
  if (skipped > 0) {
    console.log(`  Skipped ${skipped} articles — no recognisable date in title`);
  }

  // ── 3. Write ──────────────────────────────────────────────────────────────
  const body = buildBody(campaigns);

  // Priority: ARTICLE_ID env var → title search in fetched list → create new
  let articleId = process.env.ARTICLE_ID?.trim() || null;

  if (!articleId) {
    const found = all.find(a => (a.title || '').trim() === SUMMARY_TITLE);
    if (found) articleId = String(found.id);
  }

  if (articleId) {
    await updateArticle(articleId, body);
    console.log(`  Updated article ID ${articleId}`);
  } else {
    const authorId = await getAuthorId();
    const created  = await createArticle(body, authorId);
    articleId      = String(created.id);
    console.log(`  Created article ID ${articleId}`);
    console.log(`\n  ┌─────────────────────────────────────────────────────┐`);
    console.log(`  │  ACTION REQUIRED — add this to your .env / Railway:  │`);
    console.log(`  │                                                       │`);
    console.log(`  │    ARTICLE_ID=${articleId.padEnd(38)}│`);
    console.log(`  └─────────────────────────────────────────────────────┘\n`);
  }

  console.log(`[${ts()}] Done — ${campaigns.length} campaigns written to article ${articleId}`);
}

module.exports = sync;
