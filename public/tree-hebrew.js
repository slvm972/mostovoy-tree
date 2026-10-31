/**
 * tree-hebrew.js -- Hebrew dates for the family tree (pure ASCII file).
 *
 * API (browser: window.TreeHebrew, Node: module.exports):
 *   parseHebrewDate(str)          -> { day, monthKey, year } | null
 *   parseDetailed(str)            -> { ok:true, value, hadNumeric? } | { ok:false, reason }
 *   formatHebrewDate({day,monthKey,year}) -> canonical Hebrew text | null
 *   gregToHebrew(date)            -> { day, monthKey, year } (via Intl, UTC)
 *   parseGreg('D MON YYYY')       -> Date (UTC noon) | null
 *   isLeapYear(hebYear)           -> boolean
 *   createCalendar(startYear, years, rulesOverride?) -> calendar object (see below)
 *   toYMD(timestamp)              -> 'YYYYMMDD'
 *   isSupported()                 -> boolean (Intl Hebrew calendar available)
 *   DEFAULT_RULES                 -> the special-case rules (see below)
 *
 * monthKey is one of: tishri heshvan kislev tevet shevat adar adar1 adar2 nisan iyar sivan tamuz av elul.
 * 'adar' = plain Adar as written without a / b (it is never guessed to be adar1/adar2 when parsing).
 *
 * calendar.occurrences(rec) -> [{ ts, ymd, hebYear, monthKey, day }]
 *   rec = { day, monthKey, year } is the ORIGINAL Hebrew date (birth or death).
 *   Returns the dates (inside the window startYear-01-01 .. startYear+years-1-12-31) on which the
 *   anniversary falls. The first event is never earlier than the Hebrew year AFTER rec.year.
 *   The window and the Hebrew dates are computed only through Intl ('en-u-ca-hebrew'); there is no own table.
 *
 * buildHebrewIcs(opts) -> { ics, events, birthdayEvents, yahrzeitEvents, yahrzeitPersons, skipped, skippedIds, tooOld }
 *   opts: nodes (IDX.nodes), yahrzeitIds (personal choice), nowYear, years (default 5), uidDomain, prodId,
 *         nameOf(id), labels { calName, yahrzeit, alarmBirth, alarmYahrzeit, descBirth, descDeath }, rules?, stamp?
 *   Living persons with birth_he get a birthday event per year; deceased persons get a yahrzeit event ONLY if their
 *   id is in yahrzeitIds and they have death_he. Unreadable Hebrew dates are counted in "skipped" (no guessing).
 *   Living persons more than 100 Hebrew years old are left out silently ("tooOld"). No RRULE: one VEVENT per date.
 *
 * SPECIAL-CASE RULES (agree with the owner of the tree before changing):
 *   ADAR_PLAIN_IN_LEAP   'adar2' | 'adar1'   plain "Adar" in a leap year is kept in Adar II (default)
 *                        (Adar I stays Adar I in a leap year; Adar I and Adar II in a common year -> Adar)
 *   DAY30_SHORT_MONTH    'day29' | 'next_day1'
 *                        day 30 of Heshvan / Kislev in a year when that month has only 29 days:
 *                        'day29' = the 29th (Rema, default), 'next_day1' = the 1st of the next month.
 *   For any other month that lacks the requested day the last day of the month is used.
 */
(function () {
'use strict';

var DAY_MS = 86400000;

var DEFAULT_RULES = {
  ADAR_PLAIN_IN_LEAP: 'adar2',
  DAY30_SHORT_MONTH: 'day29'
};

// Letter codes used inside the parser:
//   a=alef b=bet g=gimel d=dalet h=he w=vav z=zayin x=het t=tet y=yod k=kaf l=lamed
//   m=mem n=nun s=samekh e=ayin p=pe c=tsadi q=qof r=resh S=shin T=tav
var HEB = { a:'\u05D0', b:'\u05D1', g:'\u05D2', d:'\u05D3', h:'\u05D4', w:'\u05D5', z:'\u05D6', x:'\u05D7', t:'\u05D8', y:'\u05D9', k:'\u05DB', l:'\u05DC', m:'\u05DE', n:'\u05E0', s:'\u05E1', e:'\u05E2', p:'\u05E4', c:'\u05E6', q:'\u05E7', r:'\u05E8', S:'\u05E9', T:'\u05EA' };
var REV = {};
Object.keys(HEB).forEach(function (k) { REV[HEB[k]] = k; });
var VAL = { a:1, b:2, g:3, d:4, h:5, w:6, z:7, x:8, t:9, y:10, k:20, l:30, m:40, n:50, s:60, e:70, p:80, c:90, q:100, r:200, S:300, T:400 };
var UNITS = 'abgdhwzxt';
var FINAL = { n: '\u05DF', m: '\u05DD', k: '\u05DA', p: '\u05E3', c: '\u05E5' };

function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
function toCode(s) { var o = ''; for (var i = 0; i < s.length; i++) { var ch = s.charAt(i); o += (has(REV, ch) ? REV[ch] : ch); } return o; }
function toHebrew(code) { var o = ''; for (var i = 0; i < code.length; i++) { var ch = code.charAt(i); o += (has(HEB, ch) ? HEB[ch] : ch); } return o; }

// ---- normalization: direction marks, niqqud, quotes, punctuation, final letters ----
function normalize(raw) {
  var s = String(raw);
  s = s.replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '');
  s = s.replace(/[\u00A0\u05BE]/g, ' ');
  s = s.replace(/[\u0591-\u05BD\u05BF-\u05C7]/g, '');
  s = s.replace(/[\u05F3\u05F4"'\u2018\u2019\u201C\u201D\u0060\u00B4\u02BC]/g, '');
  s = s.replace(/[.,;:()\[\]\-\u2013\u2014\/\\]+/g, ' ');
  s = s.replace(/\u05DA/g, '\u05DB').replace(/\u05DD/g, '\u05DE').replace(/\u05DF/g, '\u05E0')
       .replace(/\u05E3/g, '\u05E4').replace(/\u05E5/g, '\u05E6');
  return s.replace(/\s+/g, ' ').trim();
}

// ---- days 1..30 in gematria (15 = tet-vav, 16 = tet-zayin) ----
var DAYS = {};
(function () {
  var n;
  for (n = 1; n <= 9; n++) DAYS[UNITS.charAt(n - 1)] = n;
  DAYS['y'] = 10;
  for (n = 11; n <= 19; n++) {
    if (n === 15) DAYS['tw'] = 15;
    else if (n === 16) DAYS['tz'] = 16;
    else DAYS['y' + UNITS.charAt(n - 11)] = n;
  }
  DAYS['k'] = 20;
  for (n = 21; n <= 29; n++) DAYS['k' + UNITS.charAt(n - 21)] = n;
  DAYS['l'] = 30;
})();

// ---- months: accepted spellings (letter codes) -> key ----
var MONTHS = {
  'nysn': 'nisan', 'ayyr': 'iyar', 'ayr': 'iyar', 'sywn': 'sivan', 'sywwn': 'sivan', 'Tmwz': 'tamuz',
  'ab': 'av', 'mnxm ab': 'av', 'alwl': 'elul', 'TSry': 'tishri',
  'xSwn': 'heshvan', 'xSwwn': 'heshvan', 'mrxSwn': 'heshvan', 'mrxSwwn': 'heshvan', 'mr xSwn': 'heshvan', 'mr xSwwn': 'heshvan',
  'kslw': 'kislev', 'kslyw': 'kislev', 'tbT': 'tevet', 'Sbt': 'shevat',
  'adr': 'adar', 'adr a': 'adar1', 'adr raSwn': 'adar1', 'adra': 'adar1',
  'adr b': 'adar2', 'adr Sny': 'adar2', 'adrb': 'adar2'
};
// longest possible month (a day above this is impossible); plain adar = 29 (common year)
var MONTH_MAX_DAYS = { tishri: 30, heshvan: 30, kislev: 30, tevet: 29, shevat: 30, adar: 29, adar1: 30, adar2: 29, nisan: 30, iyar: 29, sivan: 30, tamuz: 29, av: 30, elul: 29 };

function matchMonth(tokens, i) {
  var t0 = tokens[i], t1 = tokens[i + 1];
  var tries = [];
  if (t1 !== undefined) {
    tries.push([t0 + ' ' + t1, 2, false]);
    if (t0.charAt(0) === 'b') tries.push([t0.slice(1) + ' ' + t1, 2, true]);
  }
  tries.push([t0, 1, false]);
  if (t0.length > 1 && t0.charAt(0) === 'b') tries.push([t0.slice(1), 1, true]);
  for (var j = 0; j < tries.length; j++) {
    var tr = tries[j];
    if (has(MONTHS, tr[0])) return { key: MONTHS[tr[0]], len: tr[1], prefixed: tr[2] };
  }
  return null;
}

// year token: optional leading he (= 5000), hundreds (q r S T), then tens/units. Returns full year or null.
function parseYearToken(tok) {
  var rest = tok;
  if (rest.length > 1 && rest.charAt(0) === 'h') rest = rest.slice(1);
  var m = /^([qrST]+)(.*)$/.exec(rest);
  if (!m) return null;
  var sum = 0, prev = 1000, i;
  for (i = 0; i < m[1].length; i++) { var v = VAL[m[1].charAt(i)]; if (v > prev) return null; prev = v; sum += v; }
  if (sum > 900) return null;
  var tail = m[2];
  if (tail) {
    if (!/^(?:tw|tz|[yklmnsepc][abgdhwzxt]?|[abgdhwzxt])$/.test(tail)) return null;
    if (tail === 'tw') sum += 15;
    else if (tail === 'tz') sum += 16;
    else for (i = 0; i < tail.length; i++) sum += VAL[tail.charAt(i)];
  }
  if (sum < 100 || sum > 999) return null;
  return 5000 + sum;
}

// letters-only parse: { ok:true, value, spelling, prefixed } or { ok:false, reason }
function parseLetters(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, reason: 'empty' };
  var s = normalize(raw);
  if (!s) return { ok: false, reason: 'empty' };
  if (!/^[\u05D0-\u05EA ]+$/.test(s)) return { ok: false, reason: 'non_hebrew' };
  var tokens = toCode(s).split(' ');
  var i = 0, m = null;
  for (; i < tokens.length; i++) { m = matchMonth(tokens, i); if (m) break; }
  if (!m) return { ok: false, reason: 'no_month' };
  var before = tokens.slice(0, i);
  var after = tokens.slice(i + m.len);
  if (before.length === 2 && before[1] === 'b') before = [before[0]];   // "13 b-Nisan": bet = "in"
  if (before.length === 0) return { ok: false, reason: 'no_day' };      // glued bet without a day is NOT read as day 2
  if (before.length > 1) return { ok: false, reason: 'extra_tokens' };
  var day = has(DAYS, before[0]) ? DAYS[before[0]] : 0;
  if (!day) return { ok: false, reason: 'bad_day' };
  if (day > MONTH_MAX_DAYS[m.key]) return { ok: false, reason: 'impossible_day' };
  if (after.length === 2 && after[0] === 'h') after = ['h' + after[1]];
  if (after.length === 0) return { ok: false, reason: 'no_year' };
  if (after.length > 1) return { ok: false, reason: 'extra_tokens' };
  var year = parseYearToken(after[0]);
  if (!year) return { ok: false, reason: 'bad_year' };
  return { ok: true, value: { day: day, monthKey: m.key, year: year }, spelling: tokens.slice(i, i + m.len).join(' '), prefixed: m.prefixed };
}

// Numeric tail inside parentheses, e.g. "(16 <month in Hebrew letters> 5763)".
function parseNumericPart(str) {
  var s = normalize(str);
  var m = /^(\d{1,2})\s*([\u05D0-\u05EA ]+?)\s+(\d{4})$/.exec(s);
  if (!m) return null;
  var day = +m[1];
  var tokens = toCode(m[2]).split(' ');
  var mm = matchMonth(tokens, 0);
  if (!mm || mm.len !== tokens.length) return null;
  if (day < 1 || day > MONTH_MAX_DAYS[mm.key]) return null;
  return { day: day, monthKey: mm.key, year: +m[3] };
}

// If the string ends with a parenthesis that contains digits, that numeric part must agree with
// the letters part: agree -> ok (hadNumeric:true), differ -> numeric_mismatch, unreadable -> bad_parenthetical.
// Parentheses without digits behave as if they were not there.
function parseDetailed(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, reason: 'empty' };
  var clean = raw.replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '');
  var pm = /\(([^)]*)\)\s*$/.exec(clean);
  if (!pm || !/[0-9]/.test(pm[1])) return parseLetters(raw);
  var res = parseLetters(clean.slice(0, pm.index));
  if (!res.ok) return res;
  var inner = parseNumericPart(pm[1]);
  if (!inner) return { ok: false, reason: 'bad_parenthetical' };
  var v = res.value;
  if (inner.day !== v.day || inner.monthKey !== v.monthKey || inner.year !== v.year) return { ok: false, reason: 'numeric_mismatch' };
  res.hadNumeric = true;
  return res;
}

function parseHebrewDate(raw) { var r = parseDetailed(raw); return r.ok ? r.value : null; }

// ---- formatter: {day, monthKey, year} -> canonical Hebrew text, e.g. 13 Nisan 5731 ----
// Day: letters only, no punctuation. Year: without thousands, gershayim before the last letter.
var MONTH_CODE = { tishri: 'TSry', heshvan: 'xSwwn', kislev: 'kslw', tevet: 'tbT', shevat: 'Sbt', adar: 'adr', adar1: 'adr a', adar2: 'adr b', nisan: 'nysn', iyar: 'ayyr', sivan: 'sywwn', tamuz: 'Tmwz', av: 'ab', elul: 'alwl' };
var HUNDREDS = [['T', 400], ['S', 300], ['r', 200], ['q', 100]];
var TENS = [['c', 90], ['p', 80], ['e', 70], ['s', 60], ['n', 50], ['m', 40], ['l', 30], ['k', 20], ['y', 10]];

function numToLetters(n) {
  var rest = n, out = '', i;
  HUNDREDS.forEach(function (h) { while (rest >= h[1]) { out += h[0]; rest -= h[1]; } });
  if (rest === 15) return out + 'tw';
  if (rest === 16) return out + 'tz';
  for (i = 0; i < TENS.length; i++) { if (rest >= TENS[i][1]) { out += TENS[i][0]; rest -= TENS[i][1]; break; } }
  if (rest > 0) out += UNITS.charAt(rest - 1);
  return out;
}
function heWord(code) {
  var last = code.length - 1, o = '';
  for (var i = 0; i < code.length; i++) {
    var ch = code.charAt(i);
    o += (i === last && has(FINAL, ch)) ? FINAL[ch] : (has(HEB, ch) ? HEB[ch] : ch);
  }
  return o;
}
function punctuateYear(h) {
  if (h.length === 1) return h + '\u05F3';
  return h.slice(0, h.length - 1) + '\u05F4' + h.slice(h.length - 1);
}
function formatHebrewDate(d) {
  if (!d || !has(MONTH_CODE, d.monthKey)) return null;
  var day = d.day, year = d.year;
  if (Math.floor(day) !== day || Math.floor(year) !== year) return null;
  if (!(day >= 1 && day <= 30) || !(year >= 5100 && year <= 5999)) return null;
  var dayH = toHebrew(numToLetters(day));
  var monthH = MONTH_CODE[d.monthKey].split(' ').map(function (w) { return heWord(w); }).join(' ');
  if (d.monthKey === 'adar1' || d.monthKey === 'adar2') monthH += '\u05F3';
  return dayH + ' ' + monthH + ' ' + punctuateYear(toHebrew(numToLetters(year - 5000)));
}

// ---- Gregorian side and Intl conversion ----
var GMON = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
function parseGreg(s) {
  var m = /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/.exec(String(s || '').trim());
  if (!m) return null;
  var mo = GMON[m[2].toUpperCase()];
  if (mo === undefined) return null;
  var d = +m[1], y = +m[3];
  var dt = new Date(Date.UTC(2000, mo, d, 12));
  dt.setUTCFullYear(y);
  if (dt.getUTCDate() !== d || dt.getUTCMonth() !== mo) return null;
  return dt;
}

var INTL_MONTH = { 'Tishri': 'tishri', 'Heshvan': 'heshvan', 'Kislev': 'kislev', 'Tevet': 'tevet', 'Shevat': 'shevat', 'Adar': 'adar', 'Adar I': 'adar1', 'Adar II': 'adar2', 'Nisan': 'nisan', 'Iyar': 'iyar', 'Sivan': 'sivan', 'Tamuz': 'tamuz', 'Av': 'av', 'Elul': 'elul' };
var HF = null;
function getFormatter() {
  if (!HF) HF = new Intl.DateTimeFormat('en-u-ca-hebrew', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  return HF;
}
function isSupported() {
  try {
    var parts = getFormatter().formatToParts(new Date(Date.UTC(2026, 3, 1, 12)));
    var seen = {};
    parts.forEach(function (p) { seen[p.type] = true; });
    return !!(seen.day && seen.month && seen.year);
  } catch (e) { return false; }
}
function gregToHebrew(dt) {
  var p = {};
  getFormatter().formatToParts(dt).forEach(function (x) { p[x.type] = x.value; });
  var key = has(INTL_MONTH, p.month) ? INTL_MONTH[p.month] : null;
  if (!key) return null;
  return { day: +p.day, monthKey: key, year: parseInt(p.year, 10) };
}

function isLeapYear(y) { return ((7 * y + 1) % 19) < 7; }
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function toYMD(ts) {
  var d = new Date(ts);
  return String(d.getUTCFullYear()) + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate());
}

function mergeRules(over) {
  var r = {};
  Object.keys(DEFAULT_RULES).forEach(function (k) { r[k] = DEFAULT_RULES[k]; });
  if (over) {
    Object.keys(over).forEach(function (k) {
      if (!has(DEFAULT_RULES, k)) throw new Error('Unknown rule: ' + k);
      r[k] = over[k];
    });
  }
  if (r.ADAR_PLAIN_IN_LEAP !== 'adar1' && r.ADAR_PLAIN_IN_LEAP !== 'adar2') throw new Error('Bad ADAR_PLAIN_IN_LEAP');
  if (r.DAY30_SHORT_MONTH !== 'day29' && r.DAY30_SHORT_MONTH !== 'next_day1') throw new Error('Bad DAY30_SHORT_MONTH');
  return r;
}

// index of every Gregorian day in [fromTs, toTs] -> Hebrew date (only through Intl)
function buildIndex(fromTs, toTs) {
  var map = {}, len = {};
  for (var t = fromTs; t <= toTs; t += DAY_MS) {
    var h = gregToHebrew(new Date(t));
    if (!h) continue;
    map[h.year + '|' + h.monthKey + '|' + h.day] = t;
    var k = h.year + '|' + h.monthKey;
    if (!len[k] || h.day > len[k]) len[k] = h.day;
  }
  return { map: map, len: len };
}

function createCalendar(startYear, years, overrides) {
  if (!isSupported()) throw new Error('Intl Hebrew calendar is not available');
  var rules = mergeRules(overrides);
  var endYear = startYear + years - 1;
  var winFrom = Date.UTC(startYear, 0, 1, 12);
  var winTo = Date.UTC(endYear, 11, 31, 12);
  // wider range so that month lengths of every needed Hebrew year are complete
  var idx = buildIndex(winFrom - 400 * DAY_MS, winTo + 400 * DAY_MS);
  var hyFrom = gregToHebrew(new Date(winFrom)).year;
  var hyTo = gregToHebrew(new Date(winTo)).year;

  function resolve(rec, hy) {
    var mk = rec.monthKey;
    var leap = isLeapYear(hy);
    if (mk === 'adar') { mk = leap ? rules.ADAR_PLAIN_IN_LEAP : 'adar'; }
    else if (mk === 'adar1' || mk === 'adar2') { if (!leap) mk = 'adar'; }
    var len = idx.len[hy + '|' + mk];
    if (!len) return null;
    var d = rec.day, shift = 0;
    if (d > len) {
      d = len;
      if ((mk === 'heshvan' || mk === 'kislev') && rules.DAY30_SHORT_MONTH === 'next_day1') shift = 1;
    }
    var ts = idx.map[hy + '|' + mk + '|' + d];
    if (ts === undefined) return null;
    return ts + shift * DAY_MS;
  }

  function occurrences(rec) {
    var out = [];
    if (!rec || !has(MONTH_MAX_DAYS, rec.monthKey)) return out;
    for (var hy = hyFrom; hy <= hyTo; hy++) {
      if (hy <= rec.year) continue;   // first event: the Hebrew year after the original one
      var ts = resolve(rec, hy);
      if (ts === null || ts < winFrom || ts > winTo) continue;
      var h = gregToHebrew(new Date(ts));
      out.push({ ts: ts, ymd: toYMD(ts), hebYear: hy, monthKey: h.monthKey, day: h.day });
    }
    return out;
  }

  return {
    rules: rules,
    startYear: startYear,
    endYear: endYear,
    hebYearFrom: hyFrom,
    hebYearTo: hyTo,
    occurrences: occurrences,
    monthLength: function (hy, key) { return idx.len[hy + '|' + key] || 0; }
  };
}

// ---- iCalendar (.ics) builder: birthdays by Hebrew date + yahrzeits chosen by the user ----
var ICON_BIRTHDAY = '\uD83C\uDF82';   // birthday cake
var ICON_CANDLE = '\uD83D\uDD6F';     // candle (yahrzeit)

function icsEscape(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}
function utf8Len(cp) { return cp < 0x80 ? 1 : (cp < 0x800 ? 2 : (cp < 0x10000 ? 3 : 4)); }
// fold a content line to at most 75 octets (UTF-8), never splitting a character
function foldLine(line) {
  var out = '', cur = 0, chars = Array.from(line);
  for (var i = 0; i < chars.length; i++) {
    var l = utf8Len(chars[i].codePointAt(0));
    if (cur + l > 75) { out += '\r\n '; cur = 1; }
    out += chars[i];
    cur += l;
  }
  return out;
}

function buildHebrewIcs(opts) {
  var nodes = opts.nodes || {};
  var labels = opts.labels || {};
  var domain = opts.uidDomain || 'family-tree';
  var cal = createCalendar(opts.nowYear, opts.years || 5, opts.rules);
  var selected = {};
  (opts.yahrzeitIds || []).forEach(function (id) { selected[id] = true; });
  var nameOf = opts.nameOf || function (id) { return (nodes[id] && nodes[id].name) || id; };
  var stamp = opts.stamp || (new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z');
  var res = { ics: '', events: 0, birthdayEvents: 0, yahrzeitEvents: 0, yahrzeitPersons: 0, skipped: 0, skippedIds: [], tooOld: 0 };
  var body = [];
  var uids = {};

  Object.keys(nodes).forEach(function (id) {
    var n = nodes[id] || {};
    var heDeath = n.death_he ? String(n.death_he).trim() : '';
    var deceased = !!(n.death && String(n.death).trim()) || !!heDeath;
    var kind, raw;
    if (deceased) {
      if (!has(selected, id) || !heDeath) return;   // not chosen, or no Hebrew date of death: nothing to do
      kind = 'yahrzeit';
      raw = heDeath;
    } else {
      raw = n.birth_he ? String(n.birth_he).trim() : '';
      if (!raw) return;                              // no Hebrew birth date: not counted, not guessed
      kind = 'birthday';
    }
    var rec = parseHebrewDate(raw);
    if (!rec) { res.skipped++; res.skippedIds.push(id); return; }
    if (kind === 'birthday' && cal.hebYearFrom - rec.year > 100) { res.tooOld++; return; }
    var occ = cal.occurrences(rec);
    if (!occ.length) return;
    var name = nameOf(id);
    var canon = formatHebrewDate(rec) || raw;
    var summary = (kind === 'birthday')
      ? (ICON_BIRTHDAY + ' ' + name)
      : (ICON_CANDLE + ' ' + (labels.yahrzeit || 'Yahrzeit') + ': ' + name);
    var desc = ((kind === 'birthday') ? (labels.descBirth || 'Hebrew birth date: ') : (labels.descDeath || 'Hebrew date of death: ')) + canon;
    var alarm = ((kind === 'birthday') ? (labels.alarmBirth || 'Birthday tomorrow: ') : (labels.alarmYahrzeit || 'Yahrzeit tomorrow: ')) + name;
    if (kind === 'yahrzeit') res.yahrzeitPersons++;
    occ.forEach(function (o) {
      var base = 'hebrew-' + id + '-' + kind + '-' + o.ymd.slice(0, 4);
      var uid = base + '@' + domain;
      if (has(uids, uid)) uid = base + '-' + o.hebYear + '@' + domain;   // same Hebrew date twice in one Gregorian year
      uids[uid] = true;
      body.push('BEGIN:VEVENT', 'UID:' + uid, 'DTSTAMP:' + stamp,
        'DTSTART;VALUE=DATE:' + o.ymd, 'DTEND;VALUE=DATE:' + toYMD(o.ts + DAY_MS),
        'SUMMARY:' + icsEscape(summary), 'DESCRIPTION:' + icsEscape(desc), 'TRANSP:TRANSPARENT',
        'BEGIN:VALARM', 'TRIGGER:-P1D', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsEscape(alarm), 'END:VALARM',
        'END:VEVENT');
      if (kind === 'birthday') res.birthdayEvents++; else res.yahrzeitEvents++;
    });
  });

  res.events = res.birthdayEvents + res.yahrzeitEvents;
  var head = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//' + icsEscape(opts.prodId || 'Family Tree') + '//Hebrew reminders//EN',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:' + icsEscape(labels.calName || 'Hebrew dates')];
  res.ics = head.concat(body, ['END:VCALENDAR']).map(foldLine).join('\r\n') + '\r\n';
  return res;
}

var api = {
  parseHebrewDate: parseHebrewDate,
  parseDetailed: parseDetailed,
  formatHebrewDate: formatHebrewDate,
  gregToHebrew: gregToHebrew,
  parseGreg: parseGreg,
  isLeapYear: isLeapYear,
  createCalendar: createCalendar,
  buildHebrewIcs: buildHebrewIcs,
  toYMD: toYMD,
  isSupported: isSupported,
  DEFAULT_RULES: DEFAULT_RULES
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}
if (typeof window !== 'undefined') {
  window.TreeHebrew = api;
}
})();