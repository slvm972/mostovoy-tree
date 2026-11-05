// node test-data/reminders-test.js
const fs = require('fs');
const path = require('path');
const R = require('../public/tree-reminders.js');

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) { passed++; console.log('PASS  ' + name); }
  else { failed++; console.log('FAIL  ' + name); }
}
function eq(a, b, name) { ok(a === b, name + ' (got ' + a + ', want ' + b + ')'); }

function mk(persons, fams) {
  const idx = { nodes: {}, families: {}, child_of: {}, parent_in: {}, relatives: {}, grandparents: {} };
  persons.forEach(id => { idx.nodes[id] = { id: id, name: id, sex: 'M', birth: '', death: '' }; });
  fams.forEach((f, i) => {
    const fid = 'F' + (i + 1);
    idx.families[fid] = { id: fid, husband: f[0], wife: f[1], children: f[2] };
    if (f[3]) idx.families[fid].status = f[3];
    if (f[0] && idx.nodes[f[0]]) idx.nodes[f[0]].sex = 'M';
    if (f[1] && idx.nodes[f[1]]) idx.nodes[f[1]].sex = 'F';
    f[2].forEach(c => { idx.child_of[c] = fid; });
  });
  return idx;
}

// ---- synthetic tree ----
const idx = mk(
  ['G1','G2','A','B','U','UW','ME','SIB','SW','NEPH','W','WP1','WP2','WS','KID','COUSIN','CW','COUSKID','LONE'],
  [
    ['G1','G2',['A','U']],
    ['A','B',['ME','SIB']],
    ['ME','W',['KID']],
    ['WP1','WP2',['W','WS']],
    ['SIB','SW',['NEPH']],
    ['U','UW',['COUSIN']],
    ['COUSIN','CW',['COUSKID']]
  ]
);
const L = R.kinshipLevels(idx, 'ME');
const want = { ME:0, W:0, KID:1, A:1, B:1, SIB:1, WP1:1, WP2:1, WS:1,
               G1:2, G2:2, U:2, UW:2, COUSIN:2, CW:2, NEPH:2, SW:1, COUSKID:3 };
Object.keys(want).forEach(k => eq(L[k], want[k], 'level ' + k));
eq(L.LONE, undefined, 'unconnected person has no level');
eq(Object.keys(R.kinshipLevels(idx, 'NOPE')).length, 0, 'unknown me -> empty');

// ---- incomplete family: one parent only ----
const idx2 = mk(['X','M2','S2','Y'], [['X', null, ['M2','S2']]]);
const L2 = R.kinshipLevels(idx2, 'M2');
eq(L2.X, 1, 'single parent family: parent = 1');
eq(L2.S2, 1, 'single parent family: sibling = 1');
eq(L2.Y, undefined, 'single parent family: stranger has no level');

// ---- step parent (depends on tree-kinship step detection) ----
const idx3 = mk(['A3','B3','ME3','SIB3','STEP'], [['A3','B3',['ME3','SIB3']], ['STEP','B3',[]]]);
const L3 = R.kinshipLevels(idx3, 'ME3');
eq(L3.STEP, 1, 'step parent = 1');

// ---- reminderMode ----
const P = (o) => Object.assign({ me: 'ME', near: 1, far: 2, pinned: [], muted: [] }, o || {});
eq(R.reminderMode('A', idx, P(), L, 'greg'), 'full', 'mode: level 1 <= near -> full');
eq(R.reminderMode('U', idx, P(), L, 'greg'), 'quiet', 'mode: level 2 <= far -> quiet');
eq(R.reminderMode('COUSKID', idx, P(), L, 'greg'), 'skip', 'mode: level 3 > far -> skip');
eq(R.reminderMode('LONE', idx, P(), L, 'greg'), 'skip', 'mode: no level -> skip');
eq(R.reminderMode('LONE', idx, P({ far: 'all' }), L, 'greg'), 'quiet', 'mode: far=all, no level -> quiet');
eq(R.reminderMode('COUSKID', idx, P({ far: 'all' }), L, 'greg'), 'quiet', 'mode: far=all, far person -> quiet');
eq(R.reminderMode('W', idx, P({ near: 0, far: 0 }), L, 'greg'), 'full', 'mode: level 0 with near=0');
eq(R.reminderMode('A', idx, P({ near: 0, far: 0 }), L, 'greg'), 'skip', 'mode: level 1 with near=far=0');
eq(R.reminderMode('LONE', idx, P({ pinned: ['LONE'] }), L, 'greg'), 'full', 'mode: pinned -> full');
eq(R.reminderMode('A', idx, P({ muted: ['A'] }), L, 'greg'), 'skip', 'mode: muted -> skip');
eq(R.reminderMode('A', idx, P({ muted: ['A'], pinned: ['A'] }), L, 'greg'), 'skip', 'mode: muted beats pinned');
eq(R.reminderMode('LONE', idx, P({ me: '' }), L, 'greg'), 'full', 'mode: no me -> full (filter off)');
eq(R.reminderMode('LONE', idx, P({ me: 'GONE' }), L, 'greg'), 'full', 'mode: me not in tree -> full');
eq(R.reminderMode('LONE', idx, null, L, 'greg'), 'full', 'mode: no prefs -> full');
eq(R.reminderMode('U', idx, P(), L, 'he'), R.reminderMode('U', idx, P(), L, 'greg'), 'mode: calendar flag does not change result');
eq(R.reminderMode('U', idx, { me: 'ME', pinned: [], muted: [] }, L, 'greg'), 'full', 'mode: defaults near 2 far 4 -> level 2 is full');

// ---- storage with a fake localStorage ----
const mem = {};
global.localStorage = {
  getItem: k => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: k => { delete mem[k]; }
};
eq(R.loadReminderPrefs(idx), null, 'storage: nothing saved -> null');
ok(R.saveReminderPrefs({ me: 'ME', near: 1, far: 'all', pinned: ['LONE', 'GHOST'], muted: ['A'] }), 'storage: save ok');
const back = R.loadReminderPrefs(idx);
eq(back.me, 'ME', 'storage: me restored');
eq(back.far, 'all', 'storage: far=all restored');
eq(back.pinned.join(','), 'LONE', 'storage: unknown id ignored on read');
eq(back.muted.join(','), 'A', 'storage: muted restored');
R.dropReminderPerson('A');
eq(R.loadReminderPrefs(null).muted.length, 0, 'storage: deleted person removed from muted');
mem[Object.keys(mem)[0]] = '{broken';
eq(R.loadReminderPrefs(idx), null, 'storage: broken JSON -> null');
R.saveReminderPrefs({ me: 'ME', near: 99, far: 'x', pinned: [], muted: [] });
const norm = R.loadReminderPrefs(idx);
eq(norm.near, R.REMINDER_DEFAULTS.near, 'storage: bad near -> default');
eq(norm.far, R.REMINDER_DEFAULTS.far, 'storage: bad far -> default');
R.clearReminderPrefs();
eq(R.loadReminderPrefs(idx), null, 'storage: reset -> null');
delete global.localStorage;

// ---- real tree, me = P3 ----
const fb = path.join(__dirname, '..', 'tools', 'tree-fallback.json');
if (fs.existsSync(fb)) {
  const real = JSON.parse(fs.readFileSync(fb, 'utf8'));
  if (real.nodes && real.nodes.P3) {
    const RL = R.kinshipLevels(real, 'P3');
    ['P1','P2','P6','P11'].forEach(k => eq(RL[k], 1, 'real P3: ' + k + ' = 1'));
    ['P4','P7','P8','P9','P10','P28','P12'].forEach(k => eq(RL[k], 2, 'real P3: ' + k + ' = 2'));
    eq(RL.P3, 0, 'real P3: me = 0');
  }
} else {
  console.log('SKIP  tools/tree-fallback.json not found');
}

// ---- Hebrew calendar: birthdayMode (full / quiet / skip) ----
{
  const HB = require('../public/tree-hebrew.js');
  if (HB.isSupported()) {
    const raw = HB.formatHebrewDate({ day: 13, monthKey: 'nisan', year: 5731 });
    const nodes = {
      A: { id: 'A', name: 'A', birth_he: raw, death: '' },
      B: { id: 'B', name: 'B', birth_he: raw, death: '' },
      C: { id: 'C', name: 'C', birth_he: raw, death: '' }
    };
    const run = (mode) => HB.buildHebrewIcs({ nodes: nodes, nowYear: 2026, years: 1, birthdayMode: mode,
      nameOf: id => id, labels: {}, stamp: '20260101T000000Z' });
    const alarms = (r) => (r.ics.match(/BEGIN:VALARM/g) || []).length;
    const r0 = run(null);
    eq(r0.birthdayEvents, 3, 'hebrew circles: no filter -> 3 birthdays');
    eq(alarms(r0), 3, 'hebrew circles: no filter -> 3 alarms');
    eq(run(undefined).ics, r0.ics, 'hebrew circles: undefined mode = same file');
    const r1 = run(id => id === 'A' ? 'full' : (id === 'B' ? 'quiet' : 'skip'));
    eq(r1.birthdayEvents, 2, 'hebrew circles: skip removes the event');
    eq(r1.quietEvents, 1, 'hebrew circles: one quiet event');
    eq(alarms(r1), 1, 'hebrew circles: quiet event has no alarm');
    eq(r1.skipped, 0, 'hebrew circles: skipped by circles is not "unreadable"');
    ok(r1.ics.indexOf('SUMMARY:') > 0 && r1.ics.indexOf('hebrew-C-birthday') < 0, 'hebrew circles: skipped person is absent');
  } else {
    console.log('SKIP  Intl Hebrew calendar not available');
  }
}

// ---- v2: former marriages ----
{
  const idx4 = mk(['ME4','W4','X4','XF4','XM4','C4','KID4'],
    [['ME4','W4',['KID4']], ['ME4','X4',['C4'],'divorced'], ['XF4','XM4',['X4']]]);
  const L4 = R.kinshipLevels(idx4, 'ME4');
  eq(L4.W4, 0, 'former: current spouse = 0');
  eq(L4.KID4, 1, 'former: child of current marriage = 1');
  eq(L4.C4, 1, 'former: child of former marriage = 1');
  eq(L4.X4, 1, 'former: ex-spouse with a common child = 1');
  eq(L4.XF4, undefined, 'former: ex-spouse father is not counted');
  eq(L4.XM4, undefined, 'former: ex-spouse mother is not counted');
  const idx5 = mk(['ME5','X5','XP5','XQ5'], [['ME5','X5',[],'divorced'], ['XP5','XQ5',['X5']]]);
  const L5 = R.kinshipLevels(idx5, 'ME5');
  eq(L5.X5, undefined, 'former: ex-spouse without children has no level');
  eq(L5.XP5, undefined, 'former: her parents have no level');
  const idx6 = mk(['ME6','W6','WP6','WQ6'], [['ME6','W6',[]], ['WP6','WQ6',['W6']]]);
  const L6 = R.kinshipLevels(idx6, 'ME6');
  eq(L6.WP6, 1, 'current spouse: her parents = 1');
}

// ---- v2: personal decisions ----
{
  const PP = (o) => Object.assign({ me: 'ME', near: 1, far: 2, personal: {}, events: R.EVENT_DEFAULTS }, o || {});
  const pr = PP({ personal: { U: 'always', A: 'never', LONE: 'quiet', COUSKID: 'quiet' } });
  eq(R.reminderMode('U', idx, pr, L, 'greg'), 'full', 'personal: always beats radius');
  eq(R.reminderMode('A', idx, pr, L, 'greg'), 'skip', 'personal: never beats radius');
  eq(R.reminderMode('LONE', idx, pr, L, 'greg'), 'quiet', 'personal: quiet for an unconnected person');
  eq(R.reminderMode('COUSKID', idx, pr, L, 'greg'), 'quiet', 'personal: quiet for a far person');
  eq(R.reminderMode('SIB', idx, pr, L, 'greg'), 'full', 'personal: others follow the radius');
  eq(R.personState(pr, 'U'), 'always', 'personState always');
  eq(R.personState(pr, 'NOBODY'), '', 'personState empty');
}

// ---- v2: event types ----
{
  eq(R.eventEnabled(null, 'birthday_greg'), true, 'events: no settings -> birthdays by regular date');
  eq(R.eventEnabled(null, 'birthday_he'), true, 'events: no settings -> birthdays by Hebrew date (as before)');
  eq(R.eventEnabled(null, 'death_he'), false, 'events: no settings -> no Hebrew death anniversaries');
  eq(R.eventEnabled(null, 'death_greg'), false, 'events: no settings -> no regular death anniversaries');
  const e1 = { events: { birthdays: true, birthdayCal: 'he', deathHe: true, deathGreg: false } };
  eq(R.eventEnabled(e1, 'birthday_greg'), false, 'events: cal=he -> no regular birthdays');
  eq(R.eventEnabled(e1, 'birthday_he'), true, 'events: cal=he -> Hebrew birthdays');
  eq(R.eventEnabled(e1, 'death_he'), true, 'events: deathHe on');
  eq(R.eventEnabled(e1, 'death_greg'), false, 'events: deathGreg off');
  const e2 = { events: { birthdays: false, birthdayCal: 'both', deathHe: false, deathGreg: true } };
  eq(R.eventEnabled(e2, 'birthday_greg'), false, 'events: birthdays off -> no regular birthdays');
  eq(R.eventEnabled(e2, 'birthday_he'), false, 'events: birthdays off -> no Hebrew birthdays');
  eq(R.eventEnabled(e2, 'death_greg'), true, 'events: deathGreg on');
}

// ---- v2: storage, migration, moving between devices ----
{
  const mem2 = {};
  global.localStorage = {
    getItem: k => (k in mem2 ? mem2[k] : null),
    setItem: (k, v) => { mem2[k] = String(v); },
    removeItem: k => { delete mem2[k]; }
  };
  const KEY = 'reminder_prefs_mostovoy';
  mem2[KEY] = JSON.stringify({ me: 'ME', near: 1, far: 2, pinned: ['LONE'], muted: ['A'] });
  const m1 = R.loadReminderPrefs(idx);
  eq(m1.personal.LONE, 'always', 'migration: pinned -> always');
  eq(m1.personal.A, 'never', 'migration: muted -> never');
  eq(m1.events.birthdayCal, 'both', 'migration: default calendars = both');
  eq(m1.events.deathHe, false, 'migration: death anniversaries off');
  eq(m1.v, 2, 'migration: version 2');
  m1.personal.U = 'quiet';
  ok(R.saveReminderPrefs(m1), 'v2: save');
  const m2 = R.loadReminderPrefs(idx);
  eq(m2.personal.U, 'quiet', 'v2: quiet decision survives save and load');
  eq(JSON.parse(mem2[KEY]).pinned, undefined, 'v2: stored object has no legacy arrays');
  const ex = R.exportPrefs(m2);
  const im = R.importPrefs(ex, idx);
  eq(im.personal.A, 'never', 'export/import: decision kept');
  eq(im.me, 'ME', 'export/import: me kept');
  eq(R.importPrefs('not json', idx), null, 'import: garbage -> null');
  eq(R.importPrefs('[1,2]', idx), null, 'import: array -> null');
  const imd = R.importPrefs(JSON.stringify({ me: 'GHOST', personal: { GHOST: 'never', A: 'bad', U: 'always' } }), idx);
  eq(imd.me, '', 'import: unknown me ignored');
  eq(imd.personal.GHOST, undefined, 'import: unknown person ignored');
  eq(imd.personal.A, undefined, 'import: bad value ignored');
  eq(imd.personal.U, 'always', 'import: good value kept');
  mem2['yahrzeit_sel_mostovoy'] = JSON.stringify(['A', 'GHOST', 5]);
  eq(R.legacyYahrzeitIds(idx).join(','), 'A', 'legacy yahrzeit list: only known people');
  R.dropReminderPerson('U');
  eq(R.loadReminderPrefs(idx).personal.U, undefined, 'drop: person removed from decisions');
  delete global.localStorage;
}

// ---- v2: former marriages ----
{
  const idx4 = mk(['ME4','W4','X4','XF4','XM4','C4','KID4'],
    [['ME4','W4',['KID4']], ['ME4','X4',['C4'],'divorced'], ['XF4','XM4',['X4']]]);
  const L4 = R.kinshipLevels(idx4, 'ME4');
  eq(L4.W4, 0, 'former: current spouse = 0');
  eq(L4.KID4, 1, 'former: child of current marriage = 1');
  eq(L4.C4, 1, 'former: child of former marriage = 1');
  eq(L4.X4, 1, 'former: ex-spouse with a common child = 1');
  eq(L4.XF4, undefined, 'former: ex-spouse father is not counted');
  eq(L4.XM4, undefined, 'former: ex-spouse mother is not counted');
  const idx5 = mk(['ME5','X5','XP5','XQ5'], [['ME5','X5',[],'divorced'], ['XP5','XQ5',['X5']]]);
  const L5 = R.kinshipLevels(idx5, 'ME5');
  eq(L5.X5, undefined, 'former: ex-spouse without children has no level');
  eq(L5.XP5, undefined, 'former: her parents have no level');
  const idx6 = mk(['ME6','W6','WP6','WQ6'], [['ME6','W6',[]], ['WP6','WQ6',['W6']]]);
  const L6 = R.kinshipLevels(idx6, 'ME6');
  eq(L6.WP6, 1, 'current spouse: her parents = 1');
}

// ---- v2: personal decisions ----
{
  const PP = (o) => Object.assign({ me: 'ME', near: 1, far: 2, personal: {}, events: R.EVENT_DEFAULTS }, o || {});
  const pr = PP({ personal: { U: 'always', A: 'never', LONE: 'quiet', COUSKID: 'quiet' } });
  eq(R.reminderMode('U', idx, pr, L, 'greg'), 'full', 'personal: always beats radius');
  eq(R.reminderMode('A', idx, pr, L, 'greg'), 'skip', 'personal: never beats radius');
  eq(R.reminderMode('LONE', idx, pr, L, 'greg'), 'quiet', 'personal: quiet for an unconnected person');
  eq(R.reminderMode('COUSKID', idx, pr, L, 'greg'), 'quiet', 'personal: quiet for a far person');
  eq(R.reminderMode('SIB', idx, pr, L, 'greg'), 'full', 'personal: others follow the radius');
  eq(R.personState(pr, 'U'), 'always', 'personState always');
  eq(R.personState(pr, 'NOBODY'), '', 'personState empty');
}

// ---- v2: event types ----
{
  eq(R.eventEnabled(null, 'birthday_greg'), true, 'events: no settings -> birthdays by regular date');
  eq(R.eventEnabled(null, 'birthday_he'), true, 'events: no settings -> birthdays by Hebrew date (as before)');
  eq(R.eventEnabled(null, 'death_he'), false, 'events: no settings -> no Hebrew death anniversaries');
  eq(R.eventEnabled(null, 'death_greg'), false, 'events: no settings -> no regular death anniversaries');
  const e1 = { events: { birthdays: true, birthdayCal: 'he', deathHe: true, deathGreg: false } };
  eq(R.eventEnabled(e1, 'birthday_greg'), false, 'events: cal=he -> no regular birthdays');
  eq(R.eventEnabled(e1, 'birthday_he'), true, 'events: cal=he -> Hebrew birthdays');
  eq(R.eventEnabled(e1, 'death_he'), true, 'events: deathHe on');
  eq(R.eventEnabled(e1, 'death_greg'), false, 'events: deathGreg off');
  const e2 = { events: { birthdays: false, birthdayCal: 'both', deathHe: false, deathGreg: true } };
  eq(R.eventEnabled(e2, 'birthday_greg'), false, 'events: birthdays off -> no regular birthdays');
  eq(R.eventEnabled(e2, 'birthday_he'), false, 'events: birthdays off -> no Hebrew birthdays');
  eq(R.eventEnabled(e2, 'death_greg'), true, 'events: deathGreg on');
}

// ---- v2: storage, migration, moving between devices ----
{
  const mem2 = {};
  global.localStorage = {
    getItem: k => (k in mem2 ? mem2[k] : null),
    setItem: (k, v) => { mem2[k] = String(v); },
    removeItem: k => { delete mem2[k]; }
  };
  const KEY = 'reminder_prefs_mostovoy';
  mem2[KEY] = JSON.stringify({ me: 'ME', near: 1, far: 2, pinned: ['LONE'], muted: ['A'] });
  const m1 = R.loadReminderPrefs(idx);
  eq(m1.personal.LONE, 'always', 'migration: pinned -> always');
  eq(m1.personal.A, 'never', 'migration: muted -> never');
  eq(m1.events.birthdayCal, 'both', 'migration: default calendars = both');
  eq(m1.events.deathHe, false, 'migration: death anniversaries off');
  eq(m1.v, 2, 'migration: version 2');
  m1.personal.U = 'quiet';
  ok(R.saveReminderPrefs(m1), 'v2: save');
  const m2 = R.loadReminderPrefs(idx);
  eq(m2.personal.U, 'quiet', 'v2: quiet decision survives save and load');
  eq(JSON.parse(mem2[KEY]).pinned, undefined, 'v2: stored object has no legacy arrays');
  const ex = R.exportPrefs(m2);
  const im = R.importPrefs(ex, idx);
  eq(im.personal.A, 'never', 'export/import: decision kept');
  eq(im.me, 'ME', 'export/import: me kept');
  eq(R.importPrefs('not json', idx), null, 'import: garbage -> null');
  eq(R.importPrefs('[1,2]', idx), null, 'import: array -> null');
  const imd = R.importPrefs(JSON.stringify({ me: 'GHOST', personal: { GHOST: 'never', A: 'bad', U: 'always' } }), idx);
  eq(imd.me, '', 'import: unknown me ignored');
  eq(imd.personal.GHOST, undefined, 'import: unknown person ignored');
  eq(imd.personal.A, undefined, 'import: bad value ignored');
  eq(imd.personal.U, 'always', 'import: good value kept');
  mem2['yahrzeit_sel_mostovoy'] = JSON.stringify(['A', 'GHOST', 5]);
  eq(R.legacyYahrzeitIds(idx).join(','), 'A', 'legacy yahrzeit list: only known people');
  R.dropReminderPerson('U');
  eq(R.loadReminderPrefs(idx).personal.U, undefined, 'drop: person removed from decisions');
  delete global.localStorage;
}

// ---- stage B: 29 February and calendar dates ----
{
  const c1 = R.calendarDate(2026, 2, 29);
  eq(c1.start, '20260228', 'feb29: non-leap year start = 28 Feb');
  eq(c1.end, '20260301', 'feb29: non-leap year end = 1 Mar');
  const c2 = R.calendarDate(2028, 2, 29);
  eq(c2.start, '20280228', 'feb29: leap year start = 28 Feb (same rule every year)');
  eq(c2.end, '20280229', 'feb29: leap year end = 29 Feb (day after start)');
  eq(R.calendarDate(2026, 12, 31).end, '20270101', 'date: 31 Dec ends on 1 Jan of next year');
  eq(R.calendarDate(2026, 3, 1).start, '20260301', 'date: ordinary date start');
  eq(R.calendarDate(2026, 3, 1).end, '20260302', 'date: ordinary date end');
  eq(R.calendarDate(2026, 4, 31), null, 'date: 31 April does not exist');
  eq(R.calendarDate(2026, 13, 1), null, 'date: month 13 does not exist');
}

// ---- stage B: regular-date file ----
{
  const gn = {
    P1: { id: 'P1', birth: '9 OCT 1970', death: '' },
    P2: { id: 'P2', birth: '1970', death: '' },
    P3: { id: 'P3', birth: '29 FEB 1980', death: '' },
    P4: { id: 'P4', birth: '', death: '25 JAN 2021' },
    P5: { id: 'P5', birth: '', death: 'OCT 1942' },
    P6: { id: 'P6', birth: '1 JAN 1990', death: '' },
    P7: { id: 'P7', birth: '5 MAR 1995', death: '' },
    P8: { id: 'P8', birth: '29 FEB 2000', death: '' }
  };
  const gidx = { nodes: gn, families: {}, child_of: {}, parent_in: {}, relatives: {}, grandparents: {} };
  const base = { idx: gidx, nowYear: 2026, maxAge: 100, nameOf: id => id, ageText: n => n + 'y', relOf: p => '', uidDomain: 't',
    labels: { alarmBirth: 'AB: ', deathTitle: 'DT', deathDesc: 'DD: ', alarmDeath: 'AD: ' } };
  const text = (r) => r.lines.join('\n');
  const alarms = (r) => r.lines.filter(l => l === 'BEGIN:VALARM').length;
  const pr = { me: '', near: 2, far: 4, eventsExplicit: true, personal: { P6: 'never', P7: 'quiet' },
    events: { birthdays: true, birthdayCal: 'greg', deathHe: false, deathGreg: true } };
  const g1 = R.buildGregorianEvents(Object.assign({}, base, { prefs: pr }));
  eq(g1.count, 4, 'greg file: birthdays P1, P3, P7, P8 (P2 has only a year, P6 is never)');
  eq(g1.deathCount, 1, 'greg file: one death anniversary (P4)');
  eq(g1.skippedYear, 2, 'greg file: year-only birth and month-year death are skipped and counted');
  eq(g1.quietCount, 1, 'greg file: one quiet event (P7)');
  eq(alarms(g1), 4, 'greg file: quiet event has no alarm, others have (P1, P3, P8, P4)');
  ok(text(g1).indexOf('UID:birthday-P6@t') < 0, 'greg file: never -> no event at all');
  ok(text(g1).indexOf('UID:birthday-P2@t') < 0, 'greg file: year-only birth -> no event');
  ok(text(g1).indexOf('UID:birthday-P7@t') > 0, 'greg file: quiet person still has the event');
  ok(text(g1).indexOf('SUMMARY:\uD83D\uDD6F DT: P4') > 0, 'greg file: death anniversary title');
  ok(text(g1).indexOf('DESCRIPTION:DD: 25 JAN 2021') > 0, 'greg file: death date in the description');
  ok(text(g1).indexOf('DTSTART;VALUE=DATE:20261009') > 0, 'greg file: ordinary birthday date');
  ok(text(g1).indexOf('DTSTART;VALUE=DATE:20260228\nDTEND;VALUE=DATE:20260301') > 0, 'greg file: 29 Feb -> 28 Feb with DTEND 1 Mar');
  const g2 = R.buildGregorianEvents(Object.assign({}, base, { nowYear: 2028, prefs: pr }));
  ok(text(g2).indexOf('DTSTART;VALUE=DATE:20280228\nDTEND;VALUE=DATE:20280229') > 0, 'greg file: leap year, 29 Feb -> 28 Feb with DTEND 29 Feb');
  const g3 = R.buildGregorianEvents(Object.assign({}, base, { prefs: null }));
  eq(g3.count, 5, 'greg file: no settings -> all full birthdays (year-only still skipped)');
  eq(g3.deathCount, 0, 'greg file: no settings -> no death anniversaries');
  eq(alarms(g3), 5, 'greg file: no settings -> every event has an alarm');
  const pr2 = Object.assign({}, pr, { events: { birthdays: false, birthdayCal: 'greg', deathHe: false, deathGreg: true } });
  const g4 = R.buildGregorianEvents(Object.assign({}, base, { prefs: pr2 }));
  eq(g4.count, 0, 'greg file: birthdays switched off -> none');
  eq(g4.deathCount, 1, 'greg file: death anniversaries still there');
}

// ---- stage B: Hebrew file plan ----
{
  const HB = require('../public/tree-hebrew.js');
  if (HB.isSupported()) {
    const rawB = HB.formatHebrewDate({ day: 13, monthKey: 'nisan', year: 5731 });
    const rawD = HB.formatHebrewDate({ day: 12, monthKey: 'shevat', year: 5781 });
    const hn = {
      A: { id: 'A', name: 'A', birth_he: rawB, death: '' },
      D: { id: 'D', name: 'D', birth: '', death: '25 JAN 2021', death_he: rawD },
      E: { id: 'E', name: 'E', birth: '', death: '25 JAN 2021', death_he: rawD },
      F: { id: 'F', name: 'F', birth: '', death: '25 JAN 2021', death_he: rawD }
    };
    const hidx = { nodes: hn, families: {}, child_of: {}, parent_in: {}, relatives: {}, grandparents: {} };
    const alarmsH = (r) => (r.ics.match(/BEGIN:VALARM/g) || []).length;
    const gen = (plan, extraLabels) => HB.buildHebrewIcs({ nodes: hn, nowYear: 2026, years: 1, nameOf: id => id,
      labels: Object.assign({}, extraLabels || {}), stamp: '20260101T000000Z',
      yahrzeitIds: plan.yzIds, yahrzeitMode: plan.yahrzeitMode, birthdayMode: plan.birthdayMode });
    const has = (r, id) => r.ics.indexOf('hebrew-' + id + '-yahrzeit') >= 0;

    // legacy mode: no settings at all, old checkbox list is used
    const p1 = R.planHebrew(hidx, null, ['D']);
    eq(p1.yzIds.join(','), 'D', 'plan: no settings -> only the old list');
    const r1 = gen(p1);
    ok(has(r1, 'D') && !has(r1, 'E'), 'plan: no settings -> yahrzeit only for the old list');
    eq(alarmsH(r1), 2, 'plan: no settings -> birthday and legacy yahrzeit have alarms');

    // events chosen explicitly, death_he switched off: the old list must not leak in
    const off = R.importPrefs(JSON.stringify({ me: '', events: { birthdays: true, birthdayCal: 'both', deathHe: false, deathGreg: false } }), hidx);
    eq(off.eventsExplicit, true, 'explicit flag: set when events are present');
    const p2 = R.planHebrew(hidx, off, ['D']);
    eq(p2.yzIds.length, 0, 'plan: death_he off + old list -> nothing');
    eq(gen(p2).yahrzeitEvents, 0, 'plan: death_he off -> no yahrzeit events in the file');

    // not explicit (old window): personal decisions beat the old list
    const old1 = R.importPrefs(JSON.stringify({ me: '', personal: { D: 'quiet' } }), hidx);
    eq(old1.eventsExplicit, false, 'explicit flag: not set without events');
    const p3 = R.planHebrew(hidx, old1, ['D']);
    eq(p3.yahrzeitMode('D'), 'quiet', 'priority: personal quiet beats the old list');
    const r3 = gen(p3);
    ok(has(r3, 'D'), 'priority: quiet person still has the event');
    eq(alarmsH(r3), 1, 'priority: quiet yahrzeit has no alarm (only the birthday has one)');
    const old2 = R.importPrefs(JSON.stringify({ me: '', personal: { D: 'never' } }), hidx);
    const p4 = R.planHebrew(hidx, old2, ['D']);
    eq(p4.yahrzeitMode('D'), 'skip', 'priority: personal never beats the old list');
    ok(!has(gen(p4), 'D'), 'priority: never -> no event in the file');
    const old3 = R.importPrefs(JSON.stringify({ me: '', personal: { D: 'always' } }), hidx);
    eq(R.planHebrew(hidx, old3, ['D']).yahrzeitMode('D'), 'full', 'priority: personal always -> full');
    const old4 = R.importPrefs(JSON.stringify({ me: '', personal: {} }), hidx);
    eq(R.planHebrew(hidx, old4, ['D']).yahrzeitMode('D'), 'full', 'priority: no personal decision, old list -> full');

    // explicit: death_he on, radius decides, personal decisions apply, old list ignored
    const on = R.importPrefs(JSON.stringify({ me: '', personal: { E: 'never', F: 'quiet' },
      events: { birthdays: true, birthdayCal: 'greg', deathHe: true, deathGreg: false } }), hidx);
    const p5 = R.planHebrew(hidx, on, []);
    eq(p5.yzIds.join(','), 'D,F', 'plan: death_he on -> everyone except never');
    const r5 = gen(p5);
    ok(has(r5, 'D') && has(r5, 'F') && !has(r5, 'E'), 'plan: never person is absent');
    eq(r5.quietEvents, 1, 'plan: quiet person counted as quiet');
    eq(R.planHebrew(hidx, on, ['E']).yzIds.indexOf('E'), -1, 'plan: old list is ignored once events are explicit');
    eq(R.planHebrew(hidx, on, []).suffix, false, 'suffix: calendar greg -> no suffix');
    const both = R.importPrefs(JSON.stringify({ me: '', events: { birthdays: true, birthdayCal: 'both', deathHe: false, deathGreg: false } }), hidx);
    eq(R.planHebrew(hidx, both, []).suffix, true, 'suffix: explicit both -> suffix on');
    eq(R.planHebrew(hidx, R.importPrefs(JSON.stringify({ me: '' }), hidx), []).suffix, false, 'suffix: not explicit -> no suffix');
    const nb = R.importPrefs(JSON.stringify({ me: '', events: { birthdays: false, birthdayCal: 'both', deathHe: false, deathGreg: false } }), hidx);
    eq(gen(R.planHebrew(hidx, nb, [])).birthdayEvents, 0, 'plan: birthdays off -> no Hebrew birthdays');
  }
}

// ---- Hebrew builder: yahrzeitMode and birthday suffix ----
{
  const HB = require('../public/tree-hebrew.js');
  if (HB.isSupported()) {
    const rawB = HB.formatHebrewDate({ day: 13, monthKey: 'nisan', year: 5731 });
    const rawD = HB.formatHebrewDate({ day: 12, monthKey: 'shevat', year: 5781 });
    const nodes = {
      A: { id: 'A', name: 'A', birth_he: rawB, death: '' },
      D: { id: 'D', name: 'D', birth: '', death: '25 JAN 2021', death_he: rawD },
      E: { id: 'E', name: 'E', birth: '', death: '25 JAN 2021', death_he: rawD }
    };
    const run = (extra, labels) => HB.buildHebrewIcs(Object.assign({ nodes: nodes, nowYear: 2026, years: 1,
      nameOf: id => id, labels: labels || {}, stamp: '20260101T000000Z' }, extra));
    const alarms = (r) => (r.ics.match(/BEGIN:VALARM/g) || []).length;
    const r1 = run({ yahrzeitIds: ['D', 'E'], yahrzeitMode: id => id === 'D' ? 'quiet' : 'skip' });
    eq(r1.yahrzeitEvents, 1, 'hebrew yahrzeit mode: skip removes E');
    eq(r1.quietEvents, 1, 'hebrew yahrzeit mode: D is quiet');
    eq(alarms(r1), 1, 'hebrew yahrzeit mode: only the birthday has an alarm');
    const r2 = run({ yahrzeitIds: ['D', 'E'] });
    eq(r2.yahrzeitEvents, 2, 'hebrew yahrzeit mode: no mode function -> both events');
    eq(alarms(r2), 3, 'hebrew yahrzeit mode: no mode function -> all alarms');
    const r3 = run({ yahrzeitIds: [] }, { birthdaySuffix: ' - SUFFIX' });
    ok(r3.ics.indexOf(' - SUFFIX') > 0, 'hebrew suffix: birthday title gets the suffix');
    const r4 = run({ yahrzeitIds: [] }, {});
    ok(r4.ics.indexOf('SUFFIX') < 0, 'hebrew suffix: no suffix by default');
  }
}

console.log(failed ? ('REMINDERS TEST: FAILED ' + failed + ', passed ' + passed) : ('REMINDERS TEST: all ' + passed + ' passed'));
process.exit(failed ? 1 : 0);