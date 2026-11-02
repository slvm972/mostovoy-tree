// tree-reminders.js - reminder circles (kinship level + quiet mode) for calendars.
// Pure logic, no DOM. Browser: window.TreeReminders. Node: module.exports.
// Uses TreeKinship.buildGraph (tree-kinship.js) so there is one parser of families.
(function () {
  'use strict';

  var SLUG = 'mostovoy';                       // template: replace with TREE_CONFIG.fileSlug
  var REMINDER_DEFAULTS = { near: 2, far: 4 }; // owner sets the start point, viewer changes it
  var MAX_UP = 12;

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

  function spouseIds(g, id) {
    return (g.spousesOf[id] || []).map(function (s) { return s.id; });
  }

  // returns { personId: level }. level = generations up to the nearest common ancestor
  // (max of both sides), minimum over "me" and each spouse of mine.
  function kinshipLevels(idx, meId, graph) {
    var out = {};
    if (!idx || !idx.nodes || !meId || !idx.nodes[meId]) return out;
    var K = getKinship();
    if (!K) throw new Error('TreeKinship is not loaded');
    var g = graph || K.buildGraph(idx);
    var roots = [meId];
    spouseIds(g, meId).forEach(function (s) { if (idx.nodes[s] && roots.indexOf(s) < 0) roots.push(s); });
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

    // spouse of a found person gets that person's level (not chained further)
    var base = {};
    Object.keys(out).forEach(function (k) { base[k] = out[k]; });
    Object.keys(base).forEach(function (id) {
      spouseIds(g, id).forEach(function (s) {
        if (!idx.nodes[s]) return;
        if (out[s] === undefined || base[id] < out[s]) out[s] = base[id];
      });
    });
    return out;
  }

  function limitOf(v) { return v === 'all' ? Infinity : Number(v); }

  // 'full' | 'quiet' | 'skip'. calendar ('greg' | 'he') does not change behavior yet.
  function reminderMode(id, idx, prefs, levels, calendar) {
    if (!prefs) return 'full';
    var muted = prefs.muted || [], pinned = prefs.pinned || [];
    if (muted.indexOf(id) >= 0) return 'skip';
    if (pinned.indexOf(id) >= 0) return 'full';
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

  // ---- personal settings, stored only in this browser ----
  function storageKey() { return 'reminder_prefs_' + SLUG; }
  function getStore() {
    try { return (typeof localStorage !== 'undefined') ? localStorage : null; } catch (e) { return null; }
  }
  function validLimit(v, dflt) {
    if (v === 'all') return 'all';
    var n = Number(v);
    return (isFinite(n) && n >= 0 && n <= 7) ? Math.floor(n) : dflt;
  }
  function cleanIds(arr, idx) {
    if (!Array.isArray(arr)) return [];
    return arr.filter(function (x) {
      return typeof x === 'string' && (!idx || !idx.nodes || idx.nodes[x]);
    });
  }
  // returns null when nothing is saved (filter off)
  function loadReminderPrefs(idx) {
    var st = getStore();
    if (!st) return null;
    var o = null;
    try { o = JSON.parse(st.getItem(storageKey()) || 'null'); } catch (e) { return null; }
    if (!o || typeof o !== 'object') return null;
    var me = (typeof o.me === 'string' && (!idx || !idx.nodes || idx.nodes[o.me])) ? o.me : '';
    return {
      me: me,
      near: validLimit(o.near, REMINDER_DEFAULTS.near),
      far: validLimit(o.far, REMINDER_DEFAULTS.far),
      pinned: cleanIds(o.pinned, idx),
      muted: cleanIds(o.muted, idx)
    };
  }
  function saveReminderPrefs(p) {
    var st = getStore();
    if (!st || !p) return false;
    try {
      st.setItem(storageKey(), JSON.stringify({
        me: p.me || '', near: p.near, far: p.far,
        pinned: p.pinned || [], muted: p.muted || []
      }));
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
    p.pinned = p.pinned.filter(function (x) { return x !== id; });
    p.muted = p.muted.filter(function (x) { return x !== id; });
    if (p.me === id) p.me = '';
    saveReminderPrefs(p);
  }

  var api = {
    kinshipLevels: kinshipLevels, reminderMode: reminderMode,
    loadReminderPrefs: loadReminderPrefs, saveReminderPrefs: saveReminderPrefs,
    clearReminderPrefs: clearReminderPrefs, dropReminderPerson: dropReminderPerson,
    REMINDER_DEFAULTS: REMINDER_DEFAULTS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.TreeReminders = api;
})();