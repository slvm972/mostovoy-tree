// tools/audit-hebrew-dates.js
// Audit of Hebrew dates (birth_he / death_he) in a family-tree export.
//   node tools\audit-hebrew-dates.js tmp\tree.json
//   node tools\audit-hebrew-dates.js --selftest
// No dependencies. Prints only counters and person IDs (never names, phones, e-mails).
//
// This file is pure ASCII on purpose (Hebrew only as \u escapes / letter codes),
// so it cannot be damaged by a wrong text encoding. Letter codes used inside the parser:
//   a=alef b=bet g=gimel d=dalet h=he w=vav z=zayin x=het t=tet y=yod k=kaf l=lamed
//   m=mem n=nun s=samekh e=ayin p=pe c=tsadi q=qof r=resh S=shin T=tav
// (final letters are converted to normal ones before parsing)
//
// parseHebrewDate(str) -> { day, monthKey, year } | null
//   year is the full Hebrew year (5731), monthKey is one of:
//   tishri heshvan kislev tevet shevat adar adar1 adar2 nisan iyar sivan tamuz av elul
//   monthKey 'adar' = plain Adar (as written without a / b), it is NOT guessed to be adar1/adar2.
'use strict';
const fs = require('fs');
const path = require('path');

const HEB = { a:'\u05D0', b:'\u05D1', g:'\u05D2', d:'\u05D3', h:'\u05D4', w:'\u05D5', z:'\u05D6', x:'\u05D7', t:'\u05D8', y:'\u05D9', k:'\u05DB', l:'\u05DC', m:'\u05DE', n:'\u05E0', s:'\u05E1', e:'\u05E2', p:'\u05E4', c:'\u05E6', q:'\u05E7', r:'\u05E8', S:'\u05E9', T:'\u05EA' };
const REV = {};
Object.keys(HEB).forEach(function (k) { REV[HEB[k]] = k; });
const VAL = { a:1, b:2, g:3, d:4, h:5, w:6, z:7, x:8, t:9, y:10, k:20, l:30, m:40, n:50, s:60, e:70, p:80, c:90, q:100, r:200, S:300, T:400 };

function toCode(s) { let o = ''; for (const ch of s) o += (REV[ch] !== undefined ? REV[ch] : ch); return o; }
function toHebrew(code) { let o = ''; for (const ch of code) o += (HEB[ch] !== undefined ? HEB[ch] : ch); return o; }

// ---- normalization: direction marks, niqqud, quotes, punctuation, final letters ----
function normalize(raw) {
  let s = String(raw);
  s = s.replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '');
  s = s.replace(/[\u00A0\u05BE]/g, ' ');
  s = s.replace(/[\u0591-\u05BD\u05BF-\u05C7]/g, '');
  s = s.replace(/[\u05F3\u05F4"'\u2018\u2019\u201C\u201D\u0060\u00B4\u02BC]/g, '');
  s = s.replace(/[.,;:()\[\]\-\u2013\u2014\/\\]+/g, ' ');
  s = s.replace(/\u05DA/g, '\u05DB').replace(/\u05DD/g, '\u05DE').replace(/\u05DF/g, '\u05E0')
       .replace(/\u05E3/g, '\u05E4').replace(/\u05E5/g, '\u05E6');
  return s.replace(/\s+/g, ' ').trim();
}

// ---- days 1..30 in gematria (canonical forms only; 15 = tet-vav, 16 = tet-zayin) ----
const UNITS = 'abgdhwzxt';
const DAYS = {};
(function () {
  for (let n = 1; n <= 9; n++) DAYS[UNITS[n - 1]] = n;
  DAYS['y'] = 10;
  for (let n = 11; n <= 19; n++) {
    if (n === 15) DAYS['tw'] = 15;
    else if (n === 16) DAYS['tz'] = 16;
    else DAYS['y' + UNITS[n - 11]] = n;
  }
  DAYS['k'] = 20;
  for (let n = 21; n <= 29; n++) DAYS['k' + UNITS[n - 21]] = n;
  DAYS['l'] = 30;
})();

// ---- months: all accepted spellings (letter codes) -> key ----
const MONTHS = {
  'nysn': 'nisan', 'ayyr': 'iyar', 'ayr': 'iyar', 'sywn': 'sivan', 'sywwn': 'sivan', 'Tmwz': 'tamuz',
  'ab': 'av', 'mnxm ab': 'av', 'alwl': 'elul', 'TSry': 'tishri',
  'xSwn': 'heshvan', 'xSwwn': 'heshvan', 'mrxSwn': 'heshvan', 'mrxSwwn': 'heshvan', 'mr xSwn': 'heshvan', 'mr xSwwn': 'heshvan',
  'kslw': 'kislev', 'kslyw': 'kislev', 'tbT': 'tevet', 'Sbt': 'shevat',
  'adr': 'adar', 'adr a': 'adar1', 'adr raSwn': 'adar1', 'adra': 'adar1',
  'adr b': 'adar2', 'adr Sny': 'adar2', 'adrb': 'adar2'
};
// longest possible month (a day above this is impossible); plain adar = 29 (non-leap year)
const MONTH_MAX_DAYS = { tishri: 30, heshvan: 30, kislev: 30, tevet: 29, shevat: 30, adar: 29, adar1: 30, adar2: 29, nisan: 30, iyar: 29, sivan: 30, tamuz: 29, av: 30, elul: 29 };

const has = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };

function matchMonth(tokens, i) {
  const t0 = tokens[i], t1 = tokens[i + 1];
  const tries = [];
  if (t1 !== undefined) {
    tries.push([t0 + ' ' + t1, 2, false]);
    if (t0[0] === 'b') tries.push([t0.slice(1) + ' ' + t1, 2, true]);
  }
  tries.push([t0, 1, false]);
  if (t0.length > 1 && t0[0] === 'b') tries.push([t0.slice(1), 1, true]);
  for (const tr of tries) {
    if (has(MONTHS, tr[0])) return { key: MONTHS[tr[0]], len: tr[1], prefixed: tr[2] };
  }
  return null;
}

// year token: optional leading he (= 5000), hundreds (q r S T), then tens/units. Returns full year or null.
function parseYearToken(tok) {
  let rest = tok;
  if (rest.length > 1 && rest[0] === 'h') rest = rest.slice(1);
  const m = /^([qrST]+)(.*)$/.exec(rest);
  if (!m) return null;
  let sum = 0, prev = 1000;
  for (const ch of m[1]) { const v = VAL[ch]; if (v > prev) return null; prev = v; sum += v; }
  if (sum > 900) return null;
  const tail = m[2];
  if (tail) {
    if (!/^(?:tw|tz|[yklmnsepc][abgdhwzxt]?|[abgdhwzxt])$/.test(tail)) return null;
    if (tail === 'tw') sum += 15;
    else if (tail === 'tz') sum += 16;
    else for (const ch of tail) sum += VAL[ch];
  }
  if (sum < 100 || sum > 999) return null;
  return 5000 + sum;
}

// detailed parse: { ok:true, value, spelling, prefixed } or { ok:false, reason }
function parseDetailed(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, reason: 'empty' };
  const s = normalize(raw);
  if (!s) return { ok: false, reason: 'empty' };
  if (!/^[\u05D0-\u05EA ]+$/.test(s)) return { ok: false, reason: 'non_hebrew' };
  const tokens = toCode(s).split(' ');
  let i = 0, m = null;
  for (; i < tokens.length; i++) { m = matchMonth(tokens, i); if (m) break; }
  if (!m) return { ok: false, reason: 'no_month' };
  let before = tokens.slice(0, i);
  let after = tokens.slice(i + m.len);
  if (before.length === 2 && before[1] === 'b') before = [before[0]];   // "13 b-Nisan": bet = "in"
  if (before.length === 0) return { ok: false, reason: 'no_day' };      // glued bet without a day is NOT read as day 2
  if (before.length > 1) return { ok: false, reason: 'extra_tokens' };
  const day = has(DAYS, before[0]) ? DAYS[before[0]] : 0;
  if (!day) return { ok: false, reason: 'bad_day' };
  if (day > MONTH_MAX_DAYS[m.key]) return { ok: false, reason: 'impossible_day' };
  if (after.length === 2 && after[0] === 'h') after = ['h' + after[1]];
  if (after.length === 0) return { ok: false, reason: 'no_year' };
  if (after.length > 1) return { ok: false, reason: 'extra_tokens' };
  const year = parseYearToken(after[0]);
  if (!year) return { ok: false, reason: 'bad_year' };
  return { ok: true, value: { day: day, monthKey: m.key, year: year }, spelling: tokens.slice(i, i + m.len).join(' '), prefixed: m.prefixed };
}

function parseHebrewDate(raw) { const r = parseDetailed(raw); return r.ok ? r.value : null; }

// ---- Gregorian side ----
const GMON = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
function parseGreg(s) {
  const m = /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/.exec(String(s || '').trim());
  if (!m) return null;
  const mo = GMON[m[2].toUpperCase()];
  if (mo === undefined) return null;
  const d = +m[1], y = +m[3];
  const dt = new Date(Date.UTC(2000, mo, d, 12));
  dt.setUTCFullYear(y);
  if (dt.getUTCDate() !== d || dt.getUTCMonth() !== mo) return null;
  return dt;
}

const HF = new Intl.DateTimeFormat('en-u-ca-hebrew', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const INTL_MONTH = { 'Tishri': 'tishri', 'Heshvan': 'heshvan', 'Kislev': 'kislev', 'Tevet': 'tevet', 'Shevat': 'shevat', 'Adar': 'adar', 'Adar I': 'adar1', 'Adar II': 'adar2', 'Nisan': 'nisan', 'Iyar': 'iyar', 'Sivan': 'sivan', 'Tamuz': 'tamuz', 'Av': 'av', 'Elul': 'elul' };
const INTL_UNKNOWN = {};
function gregToHebrew(dt) {
  const p = {};
  for (const x of HF.formatToParts(dt)) p[x.type] = x.value;
  const key = has(INTL_MONTH, p.month) ? INTL_MONTH[p.month] : null;
  if (!key) { INTL_UNKNOWN[p.month] = true; return null; }
  return { day: +p.day, monthKey: key, year: parseInt(p.year, 10) };
}

// 1 = exact, 2 = same day/year but recorded plain "adar" while the real month is adar1/adar2, 0 = different
function cmpOne(rec, act) {
  if (!act) return 0;
  if (rec.day !== act.day || rec.year !== act.year) return 0;
  if (rec.monthKey === act.monthKey) return 1;
  if (rec.monthKey === 'adar' && (act.monthKey === 'adar1' || act.monthKey === 'adar2')) return 2;
  return 0;
}
// returns: match | off1 | ambiguous_adar | big | intl_unknown | null
function compareToGreg(rec, dt) {
  if (!rec || !dt) return null;
  if (!gregToHebrew(dt)) return 'intl_unknown';
  const r = [0, -1, 1].map(function (off) { return cmpOne(rec, gregToHebrew(new Date(dt.getTime() + off * 86400000))); });
  if (r[0] === 1) return 'match';
  if (r[0] === 2) return 'ambiguous_adar';
  if (r[1] === 1 || r[2] === 1) return 'off1';
  if (r[1] === 2 || r[2] === 2) return 'ambiguous_adar';
  return 'big';
}

// ---- self test ----
function selftest() {
  const E = function (d, k, y) { return JSON.stringify({ day: d, monthKey: k, year: y }); };
  const cases = [
    ['ordinary date 13 Nisan 5731', '\u05D9\u05D2 \u05E0\u05D9\u05E1\u05DF \u05EA\u05E9\u05DC\u05F4\u05D0', E(13, 'nisan', 5731)],
    ['Adar II (bet with geresh)', '\u05D8 \u05D0\u05D3\u05E8 \u05D1\u05F3 \u05EA\u05E9\u05E1\u05F4\u05D4', E(9, 'adar2', 5765)],
    ['no quotation marks', '\u05D9\u05D1 \u05E9\u05D1\u05D8 \u05EA\u05E9\u05E4\u05D0', E(12, 'shevat', 5781)],
    ['year with thousands', '\u05D9\u05D2 \u05E0\u05D9\u05E1\u05DF \u05D4\u05F3\u05EA\u05E9\u05DC\u05F4\u05D0', E(13, 'nisan', 5731)],
    ['Latin string -> null', 'Nisan 13 5731', 'null'],
    ['empty string -> null', '', 'null'],
    ['glued bet before month', '\u05D9\u05F4\u05D2 \u05D1\u05E0\u05D9\u05E1\u05DF \u05EA\u05E9\u05DC\u05F4\u05D0', E(13, 'nisan', 5731)],
    ['day 30 in Iyar -> null', '\u05DC \u05D0\u05D9\u05D9\u05E8 \u05EA\u05E9\u05DC\u05D0', 'null']
  ];
  let bad = 0;
  for (const c of cases) {
    const r = parseHebrewDate(c[1]);
    const got = r ? JSON.stringify(r) : 'null';
    const ok = got === c[2];
    if (!ok) bad++;
    console.log((ok ? 'PASS  ' : 'FAIL  ') + c[0] + (ok ? '' : '   got ' + got + ' expected ' + c[2]));
  }
  const g = [
    ['Gregorian cross-check: 8 APR 1971 = 13 Nisan 5731', '\u05D9\u05D2 \u05E0\u05D9\u05E1\u05DF \u05EA\u05E9\u05DC\u05F4\u05D0', '8 APR 1971'],
    ['Gregorian cross-check: 25 JAN 2021 = 12 Shevat 5781', '\u05D9\u05D1 \u05E9\u05D1\u05D8 \u05EA\u05E9\u05E4\u05F4\u05D0', '25 JAN 2021']
  ];
  for (const c of g) {
    const res = compareToGreg(parseHebrewDate(c[1]), parseGreg(c[2]));
    const ok = res === 'match';
    if (!ok) bad++;
    console.log((ok ? 'PASS  ' : 'FAIL  ') + c[0] + (ok ? '' : '   got ' + res));
  }
  console.log(bad === 0 ? 'SELFTEST: all ' + (cases.length + g.length) + ' passed' : 'SELFTEST: ' + bad + ' FAILED');
  return bad === 0;
}

// ---- main audit ----
function findRoot(j) {
  const cands = [j, j && j.data, j && j.tree_data, j && j.tree, j && j.IDX];
  for (let c of cands) {
    if (typeof c === 'string') { try { c = JSON.parse(c); } catch (e) { continue; } }
    if (c && typeof c === 'object' && c.nodes && typeof c.nodes === 'object') return c;
  }
  return null;
}
const hex = function (s) { return Array.from(s).map(function (c) { return c.charCodeAt(0).toString(16); }).join(' '); };
const inc = function (o, k) { o[k] = (o[k] || 0) + 1; };

function main(argv) {
  const args = argv.slice(2);
  if (args.indexOf('--selftest') >= 0) return selftest() ? 0 : 1;
  const file = args.filter(function (a) { return a.slice(0, 2) !== '--'; })[0];
  if (!file) { console.log('Usage: node tools\\audit-hebrew-dates.js tmp\\tree.json   |   --selftest'); return 2; }
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { console.log('Cannot read file: ' + file + ' (' + e.code + ')'); return 2; }
  text = text.replace(/^\uFEFF/, '');
  let j;
  try { j = JSON.parse(text); } catch (e) { console.log('File is not valid JSON'); return 2; }
  const root = findRoot(j);
  if (!root) { console.log('No "nodes" object found. Top-level keys: ' + Object.keys(j || {}).slice(0, 10).join(', ')); return 2; }

  const nodes = root.nodes;
  const rep = [];
  const say = function (s) { console.log(s); rep.push(s); };
  const S = { total: 0, living: 0, dead: 0, birthHe: 0, deathHe: 0, parsed: 0, failed: 0, odd: 0, yearOnly: 0, yearOnlyWithHe: 0, livingFullNoHe: 0 };
  const reasons = {}, monthFreq = {}, quotes = {}, cmp = {};
  const weird = { latin: 0, cyrillic: 0, digits: 0, direction_marks: 0 };
  const unrec = [], big = [], cmpNote = [];
  let prefixedCount = 0, noGreg = 0;

  for (const id of Object.keys(nodes)) {
    const n = nodes[id] || {};
    S.total++;
    const isDead = !!(n.death && String(n.death).trim());
    if (isDead) S.dead++; else S.living++;
    const birthStr = String(n.birth || '').trim();
    const hasBirthHe = !!(n.birth_he && String(n.birth_he).trim());
    if (/^\d{4}$/.test(birthStr)) { S.yearOnly++; if (hasBirthHe) S.yearOnlyWithHe++; }
    if (!isDead && !hasBirthHe && parseGreg(birthStr)) S.livingFullNoHe++;

    for (const field of ['birth_he', 'death_he']) {
      const raw = n[field];
      if (raw === undefined || raw === null || String(raw).trim() === '') continue;
      const str = String(raw);
      if (field === 'birth_he') S.birthHe++; else S.deathHe++;

      if (/[A-Za-z]/.test(str)) weird.latin++;
      if (/[\u0400-\u04FF]/.test(str)) weird.cyrillic++;
      if (/[0-9]/.test(str)) weird.digits++;
      if (/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/.test(str)) weird.direction_marks++;
      let q = false;
      if (/\u05F4/.test(str)) { inc(quotes, 'gershayim U+05F4'); q = true; }
      if (/"/.test(str)) { inc(quotes, 'ASCII double quote'); q = true; }
      if (/\u05F3/.test(str)) { inc(quotes, 'geresh U+05F3'); q = true; }
      if (/'/.test(str)) { inc(quotes, 'ASCII apostrophe'); q = true; }
      if (/[\u2018\u2019\u201C\u201D]/.test(str)) { inc(quotes, 'curly quotes'); q = true; }
      if (!q) inc(quotes, 'no quote marks');

      const res = parseDetailed(str);
      if (!res.ok) {
        S.failed++; inc(reasons, res.reason);
        unrec.push({ id: id, field: field, value: str, reason: res.reason });
        continue;
      }
      S.parsed++;
      if (res.prefixed) prefixedCount++;
      inc(monthFreq, res.value.monthKey + ' | ' + res.spelling);
      if (res.value.year < 5500 || res.value.year > 5790) S.odd++;

      const gfield = field === 'birth_he' ? 'birth' : 'death';
      const dt = parseGreg(n[gfield]);
      if (!dt) { noGreg++; continue; }
      const c = compareToGreg(res.value, dt);
      inc(cmp, c);
      if (c === 'big') {
        const act = gregToHebrew(dt);
        big.push({ id: id, field: field, rec: res.value, greg: String(n[gfield]).trim(), act: act });
      }
    }
  }

  say('=== SUMMARY ===');
  say('persons: ' + S.total + ' (living ' + S.living + ', deceased ' + S.dead + ')');
  say('birth_he filled: ' + S.birthHe + ' | death_he filled: ' + S.deathHe);
  say('recognized: ' + S.parsed + ' | NOT recognized: ' + S.failed);
  say('values with a bet-prefix before the month (b-Nisan style): ' + prefixedCount);
  say('values with a year outside 5500..5790 (check them): ' + S.odd);
  say('--- why not recognized ---');
  Object.keys(reasons).forEach(function (k) { say('  ' + k + ': ' + reasons[k]); });
  if (!Object.keys(reasons).length) say('  (none)');
  say('--- odd characters (in filled values) ---');
  say('  latin: ' + weird.latin + ', cyrillic: ' + weird.cyrillic + ', digits: ' + weird.digits + ', hidden direction marks: ' + weird.direction_marks);
  say('--- quote marks used (a value can count in several rows) ---');
  Object.keys(quotes).forEach(function (k) { say('  ' + k + ': ' + quotes[k]); });
  say('--- month spellings: key | letter code | count | Hebrew ---');
  Object.keys(monthFreq).sort().forEach(function (k) {
    const code = k.split(' | ')[1];
    say('  ' + k.split(' | ')[0] + ' | ' + code + ' | ' + monthFreq[k] + ' | ' + toHebrew(code));
  });
  say('--- Gregorian birth is a bare year ---');
  say('  persons with 4-digit birth only: ' + S.yearOnly + ' (of them with birth_he filled: ' + S.yearOnlyWithHe + ')');
  say('  living persons with full Gregorian birth but NO birth_he: ' + S.livingFullNoHe);

  say('=== UNRECOGNIZED (first 40 of ' + unrec.length + ') ===');
  unrec.slice(0, 40).forEach(function (u) { say(u.id + ' | ' + u.field + ' | ' + u.reason + ' | ' + u.value + ' | ' + hex(u.value)); });
  if (unrec.length > 40) rep.push('... full list below ...');
  unrec.slice(40).forEach(function (u) { rep.push(u.id + ' | ' + u.field + ' | ' + u.reason + ' | ' + u.value + ' | ' + hex(u.value)); });

  say('=== CHECK AGAINST GREGORIAN DATE ===');
  say('recognized, but no full Gregorian date to compare: ' + noGreg);
  ['match', 'off1', 'ambiguous_adar', 'big', 'intl_unknown'].forEach(function (k) { say('  ' + k + ': ' + (cmp[k] || 0)); });
  say('  (off1 = differs by one day, maybe sunset; ambiguous_adar = plain "adar" in a leap year, not an error)');
  if (Object.keys(INTL_UNKNOWN).length) say('  unknown Intl month names: ' + Object.keys(INTL_UNKNOWN).join(', '));
  say('IDs with a difference of more than one day (first 20 of ' + big.length + '):');
  big.slice(0, 20).forEach(function (b) { say('  ' + b.id + ' ' + b.field); });
  rep.push('--- details of differences (no names) ---');
  big.forEach(function (b) {
    rep.push(b.id + ' | ' + b.field + ' | recorded ' + JSON.stringify(b.rec) + ' | gregorian ' + b.greg + ' | real Hebrew date ' + JSON.stringify(b.act));
  });

  try {
    const dir = path.join(__dirname, '..', 'tmp');
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, 'hebrew-audit-report.txt');
    fs.writeFileSync(out, '\uFEFF' + rep.join('\r\n') + '\r\n', 'utf8');
    console.log('Full report written to: ' + out);
  } catch (e) { console.log('Could not write report file: ' + e.message); }
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv);
module.exports = { parseHebrewDate: parseHebrewDate, parseDetailed: parseDetailed, normalize: normalize, toCode: toCode, toHebrew: toHebrew, parseGreg: parseGreg, gregToHebrew: gregToHebrew, compareToGreg: compareToGreg };