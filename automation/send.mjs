#!/usr/bin/env node
// ============================================================
// The Monthly Close — send driver (Brevo)
//
// Reads the rendered per-segment drafts for a target month and,
// for each ACTIVE segment in emails/segments.json, plans a Brevo
// "classic" email campaign scheduled for the send date.
//
//   DRY RUN IS THE DEFAULT. Nothing is created and no email is
//   sent unless you pass --send AND provide BREVO_API_KEY.
//
// Usage:
//   node automation/send.mjs                 # dry run, next month
//   node automation/send.mjs --month=2026-07 # dry run, explicit month
//   node automation/send.mjs --date=2026-06-29 --time=09:00
//   node automation/send.mjs --month=2026-07 --send   # LIVE (needs BREVO_API_KEY)
//
// Config (non-secret): automation/brevo.config.json
// Secret: BREVO_API_KEY env var (GitHub Actions secret) — never committed.
// See automation/SEND.md.
// ============================================================

import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

// ---------- args ----------
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);
const LIVE = args.send === true;
const MONTH = args.month || process.env.SEND_MONTH || nextMonth();

if (args.help) {
  console.log('Usage: node automation/send.mjs [--month=YYYY-MM] [--date=YYYY-MM-DD] [--time=HH:MM] [--send]');
  process.exit(0);
}

// ---------- helpers ----------
function nextMonth(d = new Date()) {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth(); // 0-11
  const ny = m === 11 ? y + 1 : y;
  const nm = m === 11 ? 1 : m + 2; // 1-12 of the following month
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&rsquo;/g, '’')
    .replace(/&lsquo;/g, '‘')
    .replace(/&ldquo;/g, '“')
    .replace(/&rdquo;/g, '”')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractSubject(html) {
  const m = html.match(/<title>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1]) : null;
}

// Allowed source placeholder. Anything else means an unrendered template.
const ALLOWED_PLACEHOLDER = 'UNSUBSCRIBE_URL';
function findStrayPlaceholders(html) {
  const found = html.match(/\{\{\s*[^}]+\s*\}\}/g) || [];
  return found.filter((p) => !p.replace(/[{}\s]/g, '').includes(ALLOWED_PLACEHOLDER));
}

// Swap our placeholder for Brevo's managed unsubscribe tag.
function prepareHtml(html) {
  return html.replace(/\{\{\s*UNSUBSCRIBE_URL\s*\}\}/g, '{{ unsubscribe }}');
}

// Compute "YYYY-MM-DDTHH:MM:00±HH:MM" for a timezone. Safe for non-DST-edge times.
function buildScheduledAt(dateStr, timeStr, timeZone) {
  const probe = new Date(`${dateStr}T${timeStr}:00Z`);
  let offset = '+00:00';
  try {
    const tzName = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(probe)
      .find((p) => p.type === 'timeZoneName')?.value;
    const mm = tzName && tzName.match(/GMT([+-]\d{2}):?(\d{2})?/);
    if (mm) offset = `${mm[1]}:${mm[2] || '00'}`;
  } catch {
    /* fall back to UTC */
  }
  return `${dateStr}T${timeStr}:00${offset}`;
}

function bytes(n) {
  return n.toLocaleString('en-US') + ' bytes';
}

// ---------- load config + segments ----------
const cfgPath = join(HERE, 'brevo.config.json');
if (!existsSync(cfgPath)) {
  console.error(`ERROR: missing config ${cfgPath}`);
  process.exit(1);
}
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
const segDoc = JSON.parse(readFileSync(join(REPO, 'emails', 'segments.json'), 'utf8'));
const active = (segDoc.segments || []).filter((s) => s.active);

const sendDate = args.date || `${MONTH}-01`;
const sendTime = args.time || cfg.sendTime || '09:00';
const tz = cfg.timezone || 'America/Los_Angeles';
const scheduledAt = buildScheduledAt(sendDate, sendTime, tz);
const draftsDir = join(REPO, 'emails', 'drafts', MONTH);

// ---------- header ----------
console.log('');
console.log('  The Monthly Close — send driver (Brevo)');
console.log('  ' + '-'.repeat(52));
console.log(`  mode        : ${LIVE ? 'LIVE SEND' : 'DRY RUN (no campaigns created, nothing sent)'}`);
console.log(`  month       : ${MONTH}`);
console.log(`  drafts dir  : emails/drafts/${MONTH}/`);
console.log(`  scheduledAt : ${scheduledAt}  (${tz})`);
console.log(`  sender      : ${cfg.sender?.name} <${cfg.sender?.email}>`);
console.log(`  active segs : ${active.length}`);
console.log('');

if (!existsSync(draftsDir)) {
  console.error(`ERROR: drafts directory not found: emails/drafts/${MONTH}/`);
  console.error('       (run the drafting pipeline for this month first)');
  process.exit(1);
}

// ---------- per-segment plan ----------
let errors = 0;
let warnings = 0;
let ready = 0;
const plans = [];

for (const seg of active) {
  const id = seg.id;
  const file = join(draftsDir, `${id}.html`);
  const rel = `emails/drafts/${MONTH}/${id}.html`;
  const listId = cfg.lists?.[id] ?? null;
  const segErrors = [];
  const segWarnings = [];

  if (!existsSync(file)) {
    segErrors.push(`draft file missing (${rel})`);
    console.log(`  ✗ ${id}`);
    segErrors.forEach((e) => console.log(`      ERROR: ${e}`));
    console.log('');
    errors++;
    continue;
  }

  const html = readFileSync(file, 'utf8');
  const subject = extractSubject(html);
  const strays = findStrayPlaceholders(html);
  const hasUnsub = /\{\{\s*UNSUBSCRIBE_URL\s*\}\}/.test(html);
  const size = statSync(file).size;

  if (!subject) segErrors.push('no <title> / subject found');
  if (strays.length) segErrors.push(`unrendered placeholder(s): ${strays.join(', ')}`);
  if (!hasUnsub) segWarnings.push('no {{UNSUBSCRIBE_URL}} found — Brevo will append its own footer');
  if (listId == null) segWarnings.push('no Brevo list id configured (set lists.' + id + ' in brevo.config.json)');
  if (cfg.sender?.email?.includes('REPLACE_ME')) segWarnings.push('sender email is still a placeholder');

  const ok = segErrors.length === 0;
  if (ok) ready++;
  errors += segErrors.length;
  warnings += segWarnings.length;

  console.log(`  ${ok ? '●' : '✗'} ${id}  →  Brevo list ${listId ?? '(UNSET)'}`);
  console.log(`      subject : ${subject || '(none)'}`);
  console.log(`      file    : ${rel} (${bytes(size)})`);
  console.log(`      checks  : unsubscribe ${hasUnsub ? '✓' : '—'}  ·  placeholders ${strays.length ? '✗' : '✓ clean'}  ·  subject ${subject ? '✓' : '✗'}`);
  segErrors.forEach((e) => console.log(`      ERROR  : ${e}`));
  segWarnings.forEach((w) => console.log(`      warn   : ${w}`));
  console.log('');

  plans.push({ seg, file, subject, listId, ok, html: prepareHtml(html) });
}

// ---------- summary ----------
console.log('  ' + '-'.repeat(52));
console.log(`  ${active.length} active · ${ready} ready · ${warnings} warning(s) · ${errors} error(s)`);

if (errors) {
  console.log('');
  console.log('  ✗ Errors must be fixed before sending. Exiting non-zero.');
  process.exit(1);
}

// ---------- live send (gated) ----------
if (!LIVE) {
  console.log('');
  console.log('  DRY RUN complete — nothing was created and no email was sent.');
  console.log('  Re-run with --send (and BREVO_API_KEY set) to schedule for real.');
  console.log('');
  process.exit(0);
}

// From here on: LIVE. Requires an API key and a list id per segment.
const apiKey = process.env.BREVO_API_KEY;
if (!apiKey) {
  console.error('  ✗ --send given but BREVO_API_KEY is not set. Refusing to continue.');
  process.exit(1);
}
const unconfigured = plans.filter((p) => p.listId == null);
if (unconfigured.length) {
  console.error(`  ✗ ${unconfigured.length} segment(s) have no Brevo list id. Fill brevo.config.json first.`);
  process.exit(1);
}
if (new Date(scheduledAt).getTime() <= Date.now()) {
  console.error(`  ✗ scheduledAt ${scheduledAt} is not in the future. Refusing to schedule.`);
  process.exit(1);
}

console.log('');
console.log('  LIVE — creating scheduled Brevo campaigns...');
for (const p of plans) {
  const body = {
    name: `The Monthly Close — ${p.seg.label} — ${MONTH}`,
    subject: p.subject,
    sender: cfg.sender,
    type: 'classic',
    htmlContent: p.html,
    recipients: { listIds: [p.listId] },
    scheduledAt,
    ...(cfg.replyTo ? { replyTo: cfg.replyTo } : {}),
  };
  const res = await fetch('https://api.brevo.com/v3/emailCampaigns', {
    method: 'POST',
    headers: { 'api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    console.error(`  ✗ ${p.seg.id}: Brevo API ${res.status} — ${txt}`);
    process.exitCode = 1;
    continue;
  }
  const json = await res.json();
  console.log(`  ✓ ${p.seg.id}: scheduled campaign id ${json.id} for ${scheduledAt}`);
}
console.log('');
