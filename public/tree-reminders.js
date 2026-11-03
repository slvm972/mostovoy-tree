// tree-reminders.js - family reminders: radius of kinship, personal decisions, event types.
// Pure logic, no DOM. Browser: window.TreeReminders. Node: module.exports.
// Uses TreeKinship.buildGraph (tree-kinship.js) so there is one parser of families.
//
// Settings (version 2) are one JSON object, so they can be exported and moved to another
// device later (see exportPrefs / importPrefs). Today they live only in this browser.
(function () {
  'use strict';

  var SLUG = 'mostovoy';                       // template: replace with TREE_CONFIG.fileSlug
  var REMINDER_DEFAULTS = { near: 2, far: 4 }; // owner sets the start point, viewer changes it
  // birthdayCal 'both' keeps both calendar buttons working as before until the user chooses
  var EVENT_DEFAULTS = { birthdays: true, birthdayCal: 'both', deathHe: false, deathGreg: false };
  var PREFS_VERSION = 2;
  var MAX_UP = 12;
  var FORMER = { divorced: 1, former: 1, ended: 1, separated: 1, annulled: 1 };

  function getKinship() {
    if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
      try { return require('./tree-kinship.js'); } catch (e) {}
    }
    if (typeof window !== 'undefined' && window.TreeKinship) return window.TreeKinship;
    return null;
  }

  // distance up to every ancestor; the person itself = 0.
  // step parents get distance d but we do not climb further through them.
  function upDistances(id, g) {
    var dist = {};
    dist[id] = 0;
    var frontier = [id];
    var d = 0;
    while (frontier.length && d < MAX_UP) {
      d++;
      var next = [];
      for (var i = 0; i < frontier.length; i++) {
        var x = frontier[i];
        var ps = g.parentsOf[x] || [];
        for (var j = 0; j < ps.length; j++) {
          if (!(ps[j] in dist)) { dist[ps[j]] = d; next.push(ps[j]); }
        }
        var ss = g.stepParentsOf[x] || [];
        for (var k = 0; k < ss.length; k++) {
          if (!(ss[k] in dist)) dist[ss[k]] = d;
        }
      }
      frontier = next;
    }
    return dist;
  }

  function pairKey(a, b) { return a < b ? a + '|' + b : b + '|' + a; }

  // a marriage is "former" only when every family of that pair is marked as ended
  function marriageInfo(idx) {
    var cur = {}, former = {};
    var fams = idx.families || {};
    Object.keys(fams).forEach(function (fid) {
      var f = fams[fid];
      if (!f || !f.husband || !f.wife) return;
      var k = pairKey(f.husband, f.wife);
      if (FORMER[String(f.status || '').toLowerCase()]) former[k] = true; else cur[k] = true;
    });
    return { isFormer: function (a, b) { var k = pairKey(a, b); return !!former[k] && !cur[k]; } };
  }

  function currentSpouses(g, mi, id) {
    return (g.spousesOf[id] || []).map(function (s) { return s.id; })
      .filter(function (s) { return !mi.isFormer(id, s); });
  }

  // returns { personId: level }. level = generations up to the nearest common ancestor
  // (max of both sides), minimum over "me" and each CURRENT spouse of mine.
  // Rules: a current spouse of a found person gets that person's level;
  // a former spouse is not a root (her relatives are not counted), but a former spouse
  // who has a child with me gets level 1 (parent of my child).
  function kinshipLevels(idx, meId, graph) {
    var out = {};
    if (!idx || !idx.nodes || !meId || !idx.nodes[meId]) return out;
    var K = getKinship();
    if (!K) throw new Error('TreeKinship is not loaded');
    var g = graph || K.buildGraph(idx);
    var mi = marriageInfo(idx);
    var roots = [meId];
    currentSpouses(g, mi, meId).forEach(function (s) { if (idx.nodes[s] && roots.indexOf(s) < 0) roots.push(s); });
    var rootDist = roots.map(function (r) { return upDistances(r, g); });

    Object.keys(idx.nodes).forEach(function (id) {
      var dx = upDistances(id, g);
      var best = Infinity;
      for (var r = 0; r < rootDist.length; r++) {
        var dr = rootDist[r];
        for (var a in dx) {
          if (a in dr) {
            var v = Math.max(dr[a], dx[a]);
            if (v < best) best = v;
          }
        }
      }
      if (best !== Infinity) out[id] = best;
    });

    // current spouse of a found person gets that person's level (not chained further)
    var base = {};
    Object.keys(out).forEach(function (k) { base[k] = out[k]; });
    Object.keys(base).forEach(function (id) {
      currentSpouses(g, mi, id).forEach(function (s) {
        if (!idx.nodes[s]) return;
        if (out[s] === undefined || base[id] < out[s]) out[s] = base[id];
      });
    });

    // former spouse with a common child = parent of my child
    var fams = idx.families || {};
    Object.keys(fams).forEach(function (fid) {
      var f = fams[fid];
      if (!f) return;
      var other = f.husband === meId ? f.wife : (f.wife === meId ? f.husband : null);
      if (!other || !idx.nodes[other]) return;
      var hasKid = (f.children || []).some(function (c) { return idx.nodes[c]; });
      if (!hasKid) return;
      if (out[other] === undefined || out[other] > 1) out[other] = 1;
    });
    return out;
  }

  function limitOf(v) { return v === 'all' ? Infinity : Number(v); }

  // personal decision of one person: 'always' | 'quiet' | 'never' | ''
  function personState(prefs, id) {
    if (!prefs) return '';
    if (prefs.personal && prefs.personal[id]) return prefs.personal[id];
    if (!prefs.personal) {
      if ((prefs.muted || []).indexOf(id) >= 0) return 'never';
      if ((prefs.pinned || []).indexOf(id) >= 0) return 'always';
    }
    return '';
  }

  // 'full' (add with a reminder) | 'quiet' (add without a reminder) | 'skip' (do not add).
  // Applies to every event type of this person. calendar ('greg' | 'he') is kept for later.
  function reminderMode(id, idx, prefs, levels, calendar) {
    if (!prefs) return 'full';
    var st = personState(prefs, id);
    if (st === 'never') return 'skip';
    if (st === 'always') return 'full';
    if (st === 'quiet') return 'quiet';
    if (!prefs.me || !idx || !idx.nodes || !idx.nodes[prefs.me]) return 'full';
    var near = limitOf(prefs.near === undefined ? REMINDER_DEFAULTS.near : prefs.near);
    var far = limitOf(prefs.far === undefined ? REMINDER_DEFAULTS.far : prefs.far);
    if (isNaN(near)) near = REMINDER_DEFAULTS.near;
    if (isNaN(far)) far = REMINDER_DEFAULTS.far;
    var lv = levels ? levels[id] : undefined;
    if (lv === undefined) {
      if (near === Infinity) return 'full';
      return far === Infinity ? 'quiet' : 'skip';
    }
    if (lv <= near) return 'full';
    if (lv <= far) return 'quiet';
    return 'skip';
  }

  // is this kind of event switched on? kinds: birthday_greg, birthday_he, death_he, death_greg
  function eventEnabled(prefs, kind) {
    var ev = (prefs && prefs.events) ? prefs.events : EVENT_DEFAULTS;
    var cal = ev.birthdayCal;
    if (kind === 'birthday_greg') return !!ev.birthdays && (cal === 'greg' || cal === 'both');
    if (kind === 'birthday_he') return !!ev.birthdays && (cal === 'he' || cal === 'both');
    if (kind === 'death_he') return !!ev.deathHe;
    if (kind === 'death_greg') return !!ev.deathGreg;
    return false;
  }

  // ---- settings: normalize, store, move between devices ----
  function storageKey() { return 'reminder_prefs_' + SLUG; }
  function legacyYahrzeitKey() { return 'yahrzeit_sel_' + SLUG; }
  function getStore() {
    try { return (typeof localStorage !== 'undefined') ? localStorage : null; } catch (e) { return null; }
  }
  function validLimit(v, dflt) {
    if (v === 'all') return 'all';
    var n = Number(v);
    return (isFinite(n) && n >= 0 && n <= 7) ? Math.floor(n) : dflt;
  }
  function okId(x, idx) { return typeof x === 'string' && (!idx || !idx.nodes || !!idx.nodes[x]); }
  function cleanIds(arr, idx) {
    if (!Array.isArray(arr)) return [];
    return arr.filter(function (x) { return okId(x, idx); });
  }

  function normalize(o, idx) {
    o = (o && typeof o === 'object') ? o : {};
    var personal = {};
    if (o.personal && typeof o.personal === 'object') {
      Object.keys(o.personal).forEach(function (id) {
        var v = o.personal[id];
        if ((v === 'always' || v === 'quiet' || v === 'never') && okId(id, idx)) personal[id] = v;
      });
    } else {
      // old format (version 1): pinned -> always, muted -> never
      cleanIds(o.pinned, idx).forEach(function (id) { personal[id] = 'always'; });
      cleanIds(o.muted, idx).forEach(function (id) { personal[id] = 'never'; });
    }
    var ev = (o.events && typeof o.events === 'object') ? o.events : {};
    var cal = ev.birthdayCal;
    var events = {
      birthdays: ev.birthdays === undefined ? EVENT_DEFAULTS.birthdays : !!ev.birthdays,
      birthdayCal: (cal === 'greg' || cal === 'he' || cal === 'both') ? cal : EVENT_DEFAULTS.birthdayCal,
      deathHe: ev.deathHe === undefined ? EVENT_DEFAULTS.deathHe : !!ev.deathHe,
      deathGreg: ev.deathGreg === undefined ? EVENT_DEFAULTS.deathGreg : !!ev.deathGreg
    };
    var p = {
      v: PREFS_VERSION,
      me: okId(o.me, idx) ? o.me : '',
      near: validLimit(o.near, REMINDER_DEFAULTS.near),
      far: validLimit(o.far, REMINDER_DEFAULTS.far),
      personal: personal,
      events: events
    };
    deriveLegacy(p);
    return p;
  }
  // arrays for the old window (kept until the new window replaces it)
  function deriveLegacy(p) {
    p.pinned = []; p.muted = [];
    Object.keys(p.personal).forEach(function (id) {
      if (p.personal[id] === 'always') p.pinned.push(id);
      else if (p.personal[id] === 'never') p.muted.push(id);
    });
  }
  function stripDerived(p) {
    return { v: p.v, me: p.me, near: p.near, far: p.far, personal: p.personal, events: p.events };
  }

  function defaultPrefs() { return normalize({}, null); }

  // returns null when nothing is saved (filter off)
  function loadReminderPrefs(idx) {
    var st = getStore();
    if (!st) return null;
    var o = null;
    try { o = JSON.parse(st.getItem(storageKey()) || 'null'); } catch (e) { return null; }
    if (!o || typeof o !== 'object') return null;
    return normalize(o, idx);
  }
  function saveReminderPrefs(p) {
    var st = getStore();
    if (!st || !p) return false;
    try {
      st.setItem(storageKey(), JSON.stringify(stripDerived(normalize(p, null))));
      return true;
    } catch (e) { return false; }
  }
  function clearReminderPrefs() {
    var st = getStore();
    if (!st) return false;
    try { st.removeItem(storageKey()); return true; } catch (e) { return false; }
  }
  // call when a person is deleted from the tree
  function dropReminderPerson(id) {
    var p = loadReminderPrefs(null);
    if (!p) return;
    delete p.personal[id];
    if (p.me === id) p.me = '';
    deriveLegacy(p);
    saveReminderPrefs(p);
  }

  // yahrzeit people chosen with the old checkbox (kept only in this browser)
  function legacyYahrzeitIds(idx) {
    var st = getStore();
    if (!st) return [];
    try {
      var arr = JSON.parse(st.getItem(legacyYahrzeitKey()) || '[]');
      return Array.isArray(arr) ? cleanIds(arr, idx) : [];
    } catch (e) { return []; }
  }

  // for moving settings to another device later: one JSON string
  function exportPrefs(p) { return JSON.stringify(stripDerived(normalize(p, null))); }
  function importPrefs(str, idx) {
    var o = null;
    try { o = JSON.parse(str); } catch (e) { return null; }
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
    return normalize(o, idx);
  }

  var api = {
    kinshipLevels: kinshipLevels, reminderMode: reminderMode, personState: personState,
    eventEnabled: eventEnabled, defaultPrefs: defaultPrefs,
    loadReminderPrefs: loadReminderPrefs, saveReminderPrefs: saveReminderPrefs,
    clearReminderPrefs: clearReminderPrefs, dropReminderPerson: dropReminderPerson,
    legacyYahrzeitIds: legacyYahrzeitIds, exportPrefs: exportPrefs, importPrefs: importPrefs,
    REMINDER_DEFAULTS: REMINDER_DEFAULTS, EVENT_DEFAULTS: EVENT_DEFAULTS, PREFS_VERSION: PREFS_VERSION
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.TreeReminders = api;
})();
