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

console.log(failed ? ('REMINDERS TEST: FAILED ' + failed + ', passed ' + passed) : ('REMINDERS TEST: all ' + passed + ' passed'));
process.exit(failed ? 1 : 0);