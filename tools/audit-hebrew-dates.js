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
function parseLetters(raw) {
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

// Numeric tail inside parentheses, e.g. "(16 <month in Hebrew letters> 5763)".
// Day = 1-2 digits, optional space, month in Hebrew letters (optional bet prefix), space, 4-digit year.
function parseNumericPart(str) {
  const s = normalize(str);
  const m = /^(\d{1,2})\s*([\u05D0-\u05EA ]+?)\s+(\d{4})$/.exec(s);
  if (!m) return null;
  const day = +m[1];
  const tokens = toCode(m[2]).split(' ');
  const mm = matchMonth(tokens, 0);
  if (!mm || mm.len !== tokens.length) return null;
  if (day < 1 || day > MONTH_MAX_DAYS[mm.key]) return null;
  return { day: day, monthKey: mm.key, year: +m[3] };
}

// Public detailed parser. Letters part is parsed by parseLetters. If the string ends with a
// parenthesis that contains digits, that numeric part must agree with the letters part:
//   agree -> ok, hadNumeric: true | differ -> numeric_mismatch | unreadable -> bad_parenthetical
// Parentheses without digits behave exactly as before.
function parseDetailed(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, reason: 'empty' };
  const clean = raw.replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '');
  const pm = /\(([^)]*)\)\s*$/.exec(clean);
  if (!pm || !/[0-9]/.test(pm[1])) return parseLetters(raw);
  const res = parseLetters(clean.slice(0, pm.index));
  if (!res.ok) return res;
  const inner = parseNumericPart(pm[1]);
  if (!inner) return { ok: false, reason: 'bad_parenthetical' };
  const v = res.value;
  if (inner.day !== v.day || inner.monthKey !== v.monthKey || inner.year !== v.year) return { ok: false, reason: 'numeric_mismatch' };
  res.hadNumeric = true;
  return res;
}

// ---- formatter: {day, monthKey, year} -> canonical Hebrew text, e.g. 13 Nisan 5731 ----
// Day: letters only, no punctuation. Year: without thousands, gershayim before the last letter.
const MONTH_CODE = { tishri: 'TSry', heshvan: 'xSwwn', kislev: 'kslw', tevet: 'tbT', shevat: 'Sbt', adar: 'adr', adar1: 'adr a', adar2: 'adr b', nisan: 'nysn', iyar: 'ayyr', sivan: 'sywwn', tamuz: 'Tmwz', av: 'ab', elul: 'alwl' };
const FINAL = { n: '\u05DF', m: '\u05DD', k: '\u05DA', p: '\u05E3', c: '\u05E5' };
const HUNDREDS = [['T', 400], ['S', 300], ['r', 200], ['q', 100]];
const TENS = [['c', 90], ['p', 80], ['e', 70], ['s', 60], ['n', 50], ['m', 40], ['l', 30], ['k', 20], ['y', 10]];

function numToLetters(n) {
  let rest = n, out = '';
  HUNDREDS.forEach(function (h) { while (rest >= h[1]) { out += h[0]; rest -= h[1]; } });
  if (rest === 15) return out + 'tw';
  if (rest === 16) return out + 'tz';
  for (let i = 0; i < TENS.length; i++) { if (rest >= TENS[i][1]) { out += TENS[i][0]; rest -= TENS[i][1]; break; } }
  if (rest > 0) out += UNITS[rest - 1];
  return out;
}
function heWord(code) {
  const a = Array.from(code);
  const last = a.length - 1;
  return a.map(function (ch, i) { return (i === last && has(FINAL, ch)) ? FINAL[ch] : (has(HEB, ch) ? HEB[ch] : ch); }).join('');
}
function punctuateYear(h) {
  const a = Array.from(h);
  if (a.length === 1) return a[0] + '\u05F3';
  a.splice(a.length - 1, 0, '\u05F4');
  return a.join('');
}
function formatHebrewDate(d) {
  if (!d || !has(MONTH_CODE, d.monthKey)) return null;
  const day = d.day, year = d.year;
  if (Math.floor(day) !== day || Math.floor(year) !== year) return null;
  if (!(day >= 1 && day <= 30) || !(year >= 5100 && year <= 5999)) return null;
  const dayH = toHebrew(numToLetters(day));
  let monthH = MONTH_CODE[d.monthKey].split(' ').map(function (w) { return heWord(w); }).join(' ');
  if (d.monthKey === 'adar1' || d.monthKey === 'adar2') monthH += '\u05F3';
  return dayH + ' ' + monthH + ' ' + punctuateYear(toHebrew(numToLetters(year - 5000)));
}

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
  let extra = 0;
  const eq = function (name, got, expected) {
    extra++;
    const ok = got === expected;
    if (!ok) bad++;
    console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok ? '' : '   got ' + got + ' expected ' + expected));
  };
  const pj = function (s) { const r = parseHebrewDate(s); return r ? JSON.stringify(r) : 'null'; };
  const pr = function (s) { const r = parseDetailed(s); return r.ok ? 'ok' : r.reason; };
  const A13 = '\u05D9\u05D2 \u05E0\u05D9\u05E1\u05DF \u05EA\u05E9\u05DC\u05F4\u05D0';
  const BN = '\u05D1\u05E0\u05D9\u05E1\u05DF';
  const want13 = E(13, 'nisan', 5731);
  eq('numeric part matches (with space)', pj(A13 + ' (13 ' + BN + ' 5731)'), want13);
  eq('numeric part matches (glued, no space)', pj(A13 + ' (13' + BN + ' 5731)'), want13);
  eq('numeric day differs -> numeric_mismatch', pr(A13 + ' (14 ' + BN + ' 5731)'), 'numeric_mismatch');
  eq('numeric year differs -> numeric_mismatch', pr(A13 + ' (13 ' + BN + ' 5732)'), 'numeric_mismatch');
  eq('unreadable numeric part -> bad_parenthetical', pr(A13 + ' (13 xx 5731)'), 'bad_parenthetical');
  eq('parentheses with Latin junk, no digits -> old behaviour', pr(A13 + ' (abc)'), 'non_hebrew');
  eq('empty parentheses -> old behaviour (parsed)', pj(A13 + ' ()'), want13);
  eq('hadNumeric flag is set', String(parseDetailed(A13 + ' (13 ' + BN + ' 5731)').hadNumeric), 'true');
  eq('format 15 Tishri 5786', formatHebrewDate({ day: 15, monthKey: 'tishri', year: 5786 }), '\u05D8\u05D5 \u05EA\u05E9\u05E8\u05D9 \u05EA\u05E9\u05E4\u05F4\u05D5');
  eq('format 13 Nisan 5731', formatHebrewDate({ day: 13, monthKey: 'nisan', year: 5731 }), A13);
  eq('format 1 Tishri 5785', formatHebrewDate({ day: 1, monthKey: 'tishri', year: 5785 }), '\u05D0 \u05EA\u05E9\u05E8\u05D9 \u05EA\u05E9\u05E4\u05F4\u05D4');
  [
    { day: 15, monthKey: 'nisan', year: 5785 },
    { day: 16, monthKey: 'tishri', year: 5785 },
    { day: 30, monthKey: 'shevat', year: 5785 },
    { day: 9, monthKey: 'adar2', year: 5787 },
    { day: 29, monthKey: 'elul', year: 5785 },
    { day: 12, monthKey: 'adar1', year: 5787 }
  ].forEach(function (o) { eq('round trip ' + JSON.stringify(o), pj(formatHebrewDate(o)), JSON.stringify(o)); });
  console.log(bad === 0 ? 'SELFTEST: all ' + (cases.length + g.length + extra) + ' passed' : 'SELFTEST: ' + bad + ' FAILED');
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
  const S = { total: 0, living: 0, dead: 0, birthHe: 0, deathHe: 0, parsed: 0, failed: 0, odd: 0, yearOnly: 0, yearOnlyWithHe: 0, livingFullNoHe: 0, numParen: 0, numOk: 0, numMismatch: 0, nonCanon: 0 };
  const reasons = {}, monthFreq = {}, quotes = {}, cmp = {};
  const weird = { latin: 0, cyrillic: 0, digits: 0, direction_marks: 0 };
  const unrec = [], big = [], cmpNote = [], numMismatchIds = [], nonCanonList = [];
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
      if (/\([^)]*[0-9][^)]*\)\s*$/.test(str.replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, ''))) S.numParen++;

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
        if (res.reason === 'numeric_mismatch') { S.numMismatch++; numMismatchIds.push(id + ' ' + field); }
        unrec.push({ id: id, field: field, value: str, reason: res.reason });
        continue;
      }
      S.parsed++;
      if (res.hadNumeric) S.numOk++;
      { const canon = formatHebrewDate(res.value); if (canon !== str.trim()) { S.nonCanon++; nonCanonList.push(id + ' ' + field); } }
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
  say('--- parenthetical numeric part and canonical form ---');
  say('  values with a numeric part in parentheses: ' + S.numParen + ' (recognized ' + S.numOk + ', numeric_mismatch ' + S.numMismatch + ')');
  say('  recognized values that differ from the canonical form: ' + S.nonCanon + ' of ' + S.parsed + '  (size of a future format migration)');
  if (numMismatchIds.length) say('  numeric_mismatch ids: ' + numMismatchIds.join(', '));
  if (nonCanonList.length) say('  non-canonical ids (first 20 of ' + nonCanonList.length + '): ' + nonCanonList.slice(0, 20).join(', '));
  nonCanonList.slice(20).forEach(function (x) { rep.push('non-canonical: ' + x); });

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
module.exports = { parseHebrewDate: parseHebrewDate, parseDetailed: parseDetailed, normalize: normalize, toCode: toCode, toHebrew: toHebrew, parseGreg: parseGreg, gregToHebrew: gregToHebrew, compareToGreg: compareToGreg, formatHebrewDate: formatHebrewDate, parseNumericPart: parseNumericPart };