// test-data/hebrew-test.js -- checks for tree-hebrew.js.   Run: node test-data\hebrew-test.js
// Pure ASCII. All dates are synthetic. Hebrew dates are verified by converting the result back through Intl.
'use strict';
var path = require('path');
var H = require(path.join(__dirname, '..', 'public', 'tree-hebrew.js'));

var total = 0, bad = 0;
function check(name, ok, info) {
  total++;
  if (!ok) bad++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok ? '' : '   ' + (info || '')));
}
function eq(name, got, exp) { check(name, got === exp, 'got ' + got + ' expected ' + exp); }
var J = JSON.stringify;
function pj(s) { var r = H.parseHebrewDate(s); return r ? J(r) : 'null'; }
function E(d, k, y) { return J({ day: d, monthKey: k, year: y }); }
function hebOf(ts) { return H.gregToHebrew(new Date(ts)); }

// ---- parser and formatter ----
var A13 = '\u05D9\u05D2 \u05E0\u05D9\u05E1\u05DF \u05EA\u05E9\u05DC\u05F4\u05D0';
eq('ordinary date 13 Nisan 5731', pj(A13), E(13, 'nisan', 5731));
eq('Adar II with geresh', pj('\u05D8 \u05D0\u05D3\u05E8 \u05D1\u05F3 \u05EA\u05E9\u05E1\u05F4\u05D4'), E(9, 'adar2', 5765));
eq('year with thousands', pj('\u05D9\u05D2 \u05E0\u05D9\u05E1\u05DF \u05D4\u05F3\u05EA\u05E9\u05DC\u05F4\u05D0'), E(13, 'nisan', 5731));
eq('Latin string -> null', pj('Nisan 13 5731'), 'null');
eq('empty string -> null', pj(''), 'null');
eq('numeric parenthetical agrees', pj(A13 + ' (13 \u05D1\u05E0\u05D9\u05E1\u05DF 5731)'), E(13, 'nisan', 5731));
eq('numeric parenthetical differs -> null', pj(A13 + ' (14 \u05D1\u05E0\u05D9\u05E1\u05DF 5731)'), 'null');
eq('format 13 Nisan 5731', H.formatHebrewDate({ day: 13, monthKey: 'nisan', year: 5731 }), A13);
eq('format 15 Tishri 5786', H.formatHebrewDate({ day: 15, monthKey: 'tishri', year: 5786 }), '\u05D8\u05D5 \u05EA\u05E9\u05E8\u05D9 \u05EA\u05E9\u05E4\u05F4\u05D5');
[{ day: 16, monthKey: 'tishri', year: 5785 }, { day: 30, monthKey: 'shevat', year: 5785 }, { day: 9, monthKey: 'adar2', year: 5787 }].forEach(function (o) {
  eq('round trip ' + J(o), pj(H.formatHebrewDate(o)), J(o));
});

// ---- Intl anchors and leap years ----
check('Intl Hebrew calendar is available', H.isSupported());
eq('8 APR 1971 = 13 Nisan 5731', J(H.gregToHebrew(H.parseGreg('8 APR 1971'))), E(13, 'nisan', 5731));
eq('25 JAN 2021 = 12 Shevat 5781', J(H.gregToHebrew(H.parseGreg('25 JAN 2021'))), E(12, 'shevat', 5781));
eq('5787 is a leap year', H.isLeapYear(5787), true);
eq('5786 is not a leap year', H.isLeapYear(5786), false);
eq('5784 is a leap year', H.isLeapYear(5784), true);
var leaps = 0;
for (var y = 5780; y < 5799; y++) { if (H.isLeapYear(y)) leaps++; }
eq('7 leap years in a 19-year cycle', leaps, 7);

// ---- calendar window 2020..2040 ----
var cal = H.createCalendar(2020, 21);

var ordinary = cal.occurrences({ day: 13, monthKey: 'nisan', year: 5731 });
eq('13 Nisan: one event per year, 21 in the window', ordinary.length, 21);
var okOrd = ordinary.every(function (o) {
  var h = hebOf(o.ts);
  return h.day === 13 && h.monthKey === 'nisan' && h.year === o.hebYear;
});
check('13 Nisan: every date converts back to 13 Nisan', okOrd);
check('events stay inside the window', ordinary.every(function (o) { return o.ymd >= '20200101' && o.ymd <= '20401231'; }));

// 30 Heshvan / 30 Kislev (default rule: the 29th in a short month)
['heshvan', 'kislev'].forEach(function (key) {
  var occ = cal.occurrences({ day: 30, monthKey: key, year: 5700 });
  var shortSeen = 0, longSeen = 0, allOk = true;
  occ.forEach(function (o) {
    var len = cal.monthLength(o.hebYear, key);
    var h = hebOf(o.ts);
    if (len === 29) shortSeen++; else if (len === 30) longSeen++;
    var expDay = (len === 30) ? 30 : 29;
    if (h.monthKey !== key || h.day !== expDay) allOk = false;
  });
  check('30 ' + key + ': both short and long months occur in the window', shortSeen > 0 && longSeen > 0, 'short ' + shortSeen + ' long ' + longSeen);
  check('30 ' + key + ': 30th in a long month, 29th in a short month', allOk);
});

// alternative rule: the 1st of the next month
var calAlt = H.createCalendar(2020, 21, { DAY30_SHORT_MONTH: 'next_day1' });
var altOcc = calAlt.occurrences({ day: 30, monthKey: 'heshvan', year: 5700 });
var altOk = altOcc.every(function (o) {
  var len = calAlt.monthLength(o.hebYear, 'heshvan');
  var h = hebOf(o.ts);
  return (len === 30) ? (h.monthKey === 'heshvan' && h.day === 30) : (h.monthKey === 'kislev' && h.day === 1);
});
check('rule next_day1: 30 Heshvan in a short year -> 1 Kislev', altOk);

// Adar in leap and common years
function adarCase(name, rec, leapKey, commonKey) {
  var occ = cal.occurrences(rec);
  var leapSeen = 0, commonSeen = 0, allOk = true;
  occ.forEach(function (o) {
    var leap = H.isLeapYear(o.hebYear);
    if (leap) leapSeen++; else commonSeen++;
    var expKey = leap ? leapKey : commonKey;
    var expDay = Math.min(rec.day, cal.monthLength(o.hebYear, expKey));
    var h = hebOf(o.ts);
    if (h.monthKey !== expKey || h.day !== expDay || h.year !== o.hebYear) allOk = false;
  });
  check(name + ': leap and common years both occur', leapSeen > 0 && commonSeen > 0, 'leap ' + leapSeen + ' common ' + commonSeen);
  check(name + ': month is ' + leapKey + ' in a leap year, ' + commonKey + ' in a common year', allOk);
}
adarCase('Adar II 9', { day: 9, monthKey: 'adar2', year: 5765 }, 'adar2', 'adar');
adarCase('plain Adar 9', { day: 9, monthKey: 'adar', year: 5765 }, 'adar2', 'adar');
adarCase('Adar I 9', { day: 9, monthKey: 'adar1', year: 5765 }, 'adar1', 'adar');
adarCase('Adar I 30 (no 30th in Adar of a common year)', { day: 30, monthKey: 'adar1', year: 5765 }, 'adar1', 'adar');

// plain Adar can be switched to Adar I with one constant
var calA1 = H.createCalendar(2020, 21, { ADAR_PLAIN_IN_LEAP: 'adar1' });
var a1ok = calA1.occurrences({ day: 9, monthKey: 'adar', year: 5765 }).every(function (o) {
  return hebOf(o.ts).monthKey === (H.isLeapYear(o.hebYear) ? 'adar1' : 'adar');
});
check('rule ADAR_PLAIN_IN_LEAP = adar1', a1ok);

// first event is not earlier than the year AFTER the original year
var after = cal.occurrences({ day: 12, monthKey: 'shevat', year: 5781 });
var minHy = Math.min.apply(null, after.map(function (o) { return o.hebYear; }));
eq('yahrzeit: first event in the year after 5781', minHy, 5782);

// unusable records
eq('unknown month key -> no events', cal.occurrences({ day: 1, monthKey: 'nope', year: 5700 }).length, 0);
eq('null record -> no events', cal.occurrences(null).length, 0);

// ---- buildHebrewIcs (synthetic persons) ----
var SHEVAT12 = '\u05D9\u05D1 \u05E9\u05D1\u05D8 \u05EA\u05E9\u05E4\u05F4\u05D0';       // 12 Shevat 5781
var SHEVAT12_5789 = '\u05D9\u05D1 \u05E9\u05D1\u05D8 \u05EA\u05E9\u05E4\u05F4\u05D8';  // 12 Shevat 5789
var icsNodes = {
  P1: { name: 'Alive', birth_he: A13 },
  P2: { name: 'Gone chosen', death: '1 JAN 2021', death_he: SHEVAT12 },
  P3: { name: 'Gone not chosen', death: '1 JAN 2021', death_he: SHEVAT12 },
  P4: { name: 'Garbage birth', birth_he: 'garbage' },
  P5: { name: 'No Hebrew date' },
  P6: { name: 'Gone garbage', death: '1 JAN 2021', death_he: 'garbage' },
  P8: { name: 'Gone no Hebrew date', death: '1 JAN 2021' },
  P9: { name: 'Gone recently', death: '1 JAN 2029', death_he: SHEVAT12_5789 },
  P10: { name: 'Too old', birth_he: '\u05D9\u05D2 \u05E0\u05D9\u05E1\u05DF \u05EA\u05F4\u05E8' }
};
function icsRun(ids) {
  return H.buildHebrewIcs({
    nodes: icsNodes, yahrzeitIds: ids, nowYear: 2026, years: 5, uidDomain: 'test.local', prodId: 'Test, Family',
    nameOf: function (id) { return 'Name, ' + id; }, stamp: '20260101T000000Z',
    labels: { yahrzeit: 'Yahrzeit', calName: 'Test cal' }
  });
}
var icsRes = icsRun(['P2', 'P6', 'P8', 'P9', 'P999', 'P1']);
var icsLines = icsRes.ics.replace(/\r\n /g, '').split('\r\n');
function icsCount(prefix) { return icsLines.filter(function (l) { return l === prefix; }).length; }
eq('ics: birthday events (13 Nisan x 5 years)', icsRes.birthdayEvents, 5);
eq('ics: yahrzeit events (P2 x5, P9 only the year after 5789)', icsRes.yahrzeitEvents, 6);
eq('ics: persons with yahrzeit events', icsRes.yahrzeitPersons, 2);
eq('ics: skipped persons (garbage birth_he, garbage death_he)', icsRes.skipped, 2);
eq('ics: too-old living person is not counted as skipped', icsRes.tooOld, 1);
eq('ics: total events', icsRes.events, 11);
eq('ics: VEVENT blocks match', icsCount('BEGIN:VEVENT'), 11);
eq('ics: one alarm per event', icsCount('TRIGGER:-P1D'), 11);
eq('ics: starts with BEGIN:VCALENDAR', icsLines[0], 'BEGIN:VCALENDAR');
check('ics: ends with END:VCALENDAR and CRLF', /END:VCALENDAR\r\n$/.test(icsRes.ics));
check('ics: no RRULE', icsRes.ics.indexOf('RRULE') < 0);
var uidLines = icsLines.filter(function (l) { return l.indexOf('UID:') === 0; });
var uidSet = {};
uidLines.forEach(function (l) { uidSet[l] = true; });
eq('ics: all UIDs are unique', Object.keys(uidSet).length, uidLines.length);
check('ics: DTSTAMP is written', icsLines.indexOf('DTSTAMP:20260101T000000Z') >= 0);
check('ics: every date is inside 2026-2030', icsLines.filter(function (l) { return l.indexOf('DTSTART;VALUE=DATE:') === 0; }).every(function (l) {
  var ymd = l.slice(19);
  return ymd >= '20260101' && ymd <= '20301231';
}));
check('ics: comma in a name is escaped', icsRes.ics.replace(/\r\n /g, '').indexOf('SUMMARY:\uD83C\uDF82 Name\\, P1') >= 0);
check('ics: not-chosen person is absent', icsRes.ics.replace(/\r\n /g, '').indexOf('Name\\, P3') < 0);
check('ics: yahrzeit text with label', icsRes.ics.replace(/\r\n /g, '').indexOf('SUMMARY:\uD83D\uDD6F Yahrzeit: Name\\, P2') >= 0);
check('ics: canonical Hebrew date of death in DESCRIPTION', icsRes.ics.replace(/\r\n /g, '').indexOf('DESCRIPTION:Hebrew date of death: ' + H.formatHebrewDate({ day: 12, monthKey: 'shevat', year: 5781 })) >= 0);
check('ics: every line is at most 75 octets', icsRes.ics.split('\r\n').every(function (l) { return Buffer.byteLength(l, 'utf8') <= 75; }));
var icsEmpty = icsRun([]);
eq('ics: empty choice -> no yahrzeit events', icsEmpty.yahrzeitEvents, 0);
eq('ics: empty choice -> birthdays still there', icsEmpty.birthdayEvents, 5);
eq('ics: empty choice -> only the broken birthday is skipped', icsEmpty.skipped, 1);

// ---- validity: calendar name with years, created line, service "time to update" event ----
var icsV = H.buildHebrewIcs({
  nodes: icsNodes, yahrzeitIds: ['P2'], nowYear: 2026, years: 5, uidDomain: 'test.local', prodId: 'Test',
  nameOf: function (id) { return 'Name ' + id; }, stamp: '20260101T000000Z',
  createdStr: '31.10.2026', treeUrl: 'https://example.test/tree_a4a.html',
  labels: { yahrzeit: 'Yahrzeit', calName: 'Test cal', createdLine: 'Created: {date}, valid until {to}',
            updateSummary: 'Time to update', updateDesc: 'How to update. Tree: {url}' }
});
var vText = icsV.ics.replace(/\r\n /g, '');
var vLines = vText.split('\r\n');
eq('validity: from', icsV.from, 2026);
eq('validity: to', icsV.to, 2030);
eq('validity: service event is not counted', icsV.events, icsV.birthdayEvents + icsV.yahrzeitEvents);
eq('validity: exactly one extra VEVENT block', vLines.filter(function (l) { return l === 'BEGIN:VEVENT'; }).length, icsV.events + 1);
check('validity: calendar name has the years', vText.indexOf('X-WR-CALNAME:Test cal (2026\u20132030)') >= 0);
check('validity: created line is in DESCRIPTION', vText.indexOf('Created: 31.10.2026\\, valid until 2030') >= 0);
check('validity: service event UID', vLines.indexOf('UID:hebrew-update-2026-2030@test.local') >= 0);
check('validity: service event on 1 October of the last year', vLines.indexOf('DTSTART;VALUE=DATE:20301001') >= 0);
check('validity: service event has the tree address', vText.indexOf('https://example.test/tree_a4a.html') >= 0);
eq('validity: one alarm per event incl. the service one', vLines.filter(function (l) { return l === 'TRIGGER:-P1D'; }).length, icsV.events + 1);
check('validity: every line is at most 75 octets', icsV.ics.split('\r\n').every(function (l) { return Buffer.byteLength(l, 'utf8') <= 75; }));
var icsNoSvc = icsRun(['P2']);
check('validity: without update labels there is no service event', icsNoSvc.ics.indexOf('hebrew-update-') < 0);

var yi86 = H.hebrewYearInfo(5786), yi87 = H.hebrewYearInfo(5787);
function yiHas(info, key) { return info.months.some(function (m) { return m.key === key; }); }
function yiDays(info, key) { return info.months.filter(function (m) { return m.key === key; })[0].days; }
function yiSum(info) { return info.months.reduce(function (s, m) { return s + m.days; }, 0); }
check('year info: 5786 found, not leap, 12 months', !!yi86 && !yi86.leap && yi86.months.length === 12);
check('year info: 5787 found, leap, 13 months', !!yi87 && yi87.leap && yi87.months.length === 13);
check('year info: 5786 has 353-355 days', [353, 354, 355].indexOf(yiSum(yi86)) >= 0, String(yiSum(yi86)));
check('year info: 5787 has 383-385 days', [383, 384, 385].indexOf(yiSum(yi87)) >= 0, String(yiSum(yi87)));
check('year info: plain Adar only in a common year', yiHas(yi86, 'adar') && !yiHas(yi87, 'adar'));
check('year info: Adar I and Adar II only in a leap year', yiHas(yi87, 'adar1') && yiHas(yi87, 'adar2') && !yiHas(yi86, 'adar1') && !yiHas(yi86, 'adar2'));
check('year info: every month has 29 or 30 days (several years)', [5460, 5700, 5731, 5765, 5781, 5785, 5790].every(function (y) {
  var i = H.hebrewYearInfo(y);
  return i && i.months.every(function (m) { return m.days === 29 || m.days === 30; });
}));
eq('year info: Nisan has 30 days', yiDays(yi86, 'nisan'), 30);
eq('year info: Iyar has 29 days', yiDays(yi86, 'iyar'), 29);
eq('day letters 13', H.dayLetters(13), '\u05D9\u05D2');
eq('day letters 15', H.dayLetters(15), '\u05D8\u05D5');
eq('day letters 16', H.dayLetters(16), '\u05D8\u05D6');
eq('day letters 30', H.dayLetters(30), '\u05DC');
eq('year letters 5731', H.formatHebrewYear(5731), '\u05EA\u05E9\u05DC\u05F4\u05D0');
eq('year letters 5785', H.formatHebrewYear(5785), '\u05EA\u05E9\u05E4\u05F4\u05D4');
eq('month name Adar II', H.monthNameHe('adar2'), '\u05D0\u05D3\u05E8 \u05D1\u05F3');
eq('month name Heshvan', H.monthNameHe('heshvan'), '\u05D7\u05E9\u05D5\u05D5\u05DF');
eq('compare: 13 Nisan 5731 vs 8 APR 1971 = match', H.compareHebrewToGreg({ day: 13, monthKey: 'nisan', year: 5731 }, H.parseGreg('8 APR 1971')), 'match');
eq('compare: one day off', H.compareHebrewToGreg({ day: 13, monthKey: 'nisan', year: 5731 }, H.parseGreg('9 APR 1971')), 'off1');
eq('compare: far apart', H.compareHebrewToGreg({ day: 13, monthKey: 'nisan', year: 5731 }, H.parseGreg('20 APR 1971')), 'big');
eq('compare: 7 Tamuz 5785 vs 7 MAR 2025 is a big difference', H.compareHebrewToGreg({ day: 7, monthKey: 'tamuz', year: 5785 }, H.parseGreg('7 MAR 2025')), 'big');
eq('compare: plain Adar in a leap year is not an error', H.compareHebrewToGreg({ day: 9, monthKey: 'adar', year: 5787 }, H.parseGreg('18 FEB 2027')), 'big');

console.log(bad === 0 ? ('HEBREW TEST: all ' + total + ' passed') : ('HEBREW TEST: ' + bad + ' of ' + total + ' FAILED'));
process.exitCode = bad === 0 ? 0 : 1;