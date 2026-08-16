// src/index.js — Cloudflare Worker для семейного дерева Мостовых

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Password, x-password',
};

// ── Helpers ────────────────────────────────────────────

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function err(msg, status = 400) {
  return json({ ok: false, error: msg }, status);
}

async function sha256(str) {
  const buf  = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2,'0')).join('');
}

async function checkPassword(provided, storedHash) {
  if(!provided) return false;
  const h = await sha256(provided);
  return h === storedHash;
}

// ── Cycle guard ─────────────────────────────────────────
// Prevents a person from becoming their own ancestor or descendant
// (e.g. "add my father as my child") when linking family relations.
// Walks IDX.relatives in both directions from `candidateId` and
// returns true if `targetId` is found among its ancestors or
// descendants (which would make targetId<->candidateId a cycle).
function isAncestorOrDescendant(IDX, targetId, candidateId) {
  if(!targetId || !candidateId) return false;
  if(targetId === candidateId) return true;

  const visited = new Set();
  const stack = [candidateId];
  // Walk descendants of candidateId
  while(stack.length) {
    const cur = stack.pop();
    if(visited.has(cur)) continue;
    visited.add(cur);
    if(cur === targetId) return true;
    const rel = IDX.relatives[cur];
    if(rel && rel.children) for(const c of rel.children) stack.push(c);
  }

  visited.clear();
  stack.push(candidateId);
  // Walk ancestors of candidateId
  while(stack.length) {
    const cur = stack.pop();
    if(visited.has(cur)) continue;
    visited.add(cur);
    if(cur === targetId) return true;
    const rel = IDX.relatives[cur];
    if(rel && rel.parents) for(const p of rel.parents) stack.push(p);
  }

  return false;
}

// Checks whether making `childId` a child of `parentId` would create
// a cycle (parentId is already a descendant of childId, or they're
// the same person). Returns an error message string, or null if safe.
function checkParentChildCycle(IDX, parentId, childId) {
  if(!parentId || !childId) return null;
  if(parentId === childId) {
    return 'Персона не может быть собственным родителем/ребёнком';
  }
  if(isAncestorOrDescendant(IDX, parentId, childId)) {
    return 'Эта связь создала бы цикл: ' + (IDX.nodes[parentId]?.name || parentId) +
      ' уже является потомком ' + (IDX.nodes[childId]?.name || childId);
  }
  return null;
}

// ── Additional data-integrity guards ────────────────────
// These catch corruption that is NOT a graph cycle (so
// checkParentChildCycle wouldn't see it) but is still
// biologically/structurally impossible.

// A person may only be a "child" (have parents) in ONE family.
// Catches the case where the same person gets attached as a child
// in two different families (e.g. once by mistake, once correctly).
function checkAlreadyHasFamily(IDX, childId, famId) {
  const existing = IDX.child_of[childId];
  if(existing && existing !== famId) {
    const existingFam = IDX.families[existing];
    const existingParents = existingFam
      ? [existingFam.husband, existingFam.wife].filter(Boolean).map(pid => IDX.nodes[pid]?.name || pid).join(' и ')
      : existing;
    return (IDX.nodes[childId]?.name || childId) +
      ' уже привязан(а) как ребёнок в другой семье (родители: ' + (existingParents || existing) +
      '). Сначала отвяжите (✕) от старой семьи, прежде чем привязывать к новой.';
  }
  return null;
}

// A child cannot be born before (or in the same year as) their parent.
// Only fires when BOTH birth years are known — absence of a date is
// not itself an error, just means this check can't confirm either way.
function parseBirthYear(str) {
  const m = str && String(str).match(/\d{4}/);
  return m ? parseInt(m[0], 10) : null;
}
function checkBirthYearOrder(IDX, parentId, childId) {
  const py = parseBirthYear(IDX.nodes[parentId]?.birth);
  const cy = parseBirthYear(IDX.nodes[childId]?.birth);
  if(py != null && cy != null && cy <= py) {
    return (IDX.nodes[childId]?.name || childId) + ' (' + cy + ') не может быть ребёнком ' +
      (IDX.nodes[parentId]?.name || parentId) + ' (' + py + ') — родился(ась) раньше или в тот же год';
  }
  return null;
}

// A child's generation number must be strictly greater than their
// parent's (gen: 0 = eldest ancestors, increases downward). Unlike
// birth years, `gen` is set on almost every person, so this catches
// cases where birth dates are missing (e.g. a spouse with no known
// birth date) but still forms an impossible generation order.
function checkGenOrder(IDX, parentId, childId) {
  const pg = IDX.nodes[parentId]?.gen;
  const cg = IDX.nodes[childId]?.gen;
  if(pg != null && cg != null && cg <= pg) {
    return (IDX.nodes[childId]?.name || childId) + ' (поколение ' + cg + ') не может быть ребёнком ' +
      (IDX.nodes[parentId]?.name || parentId) + ' (поколение ' + pg + ') — поколение ребёнка должно быть больше';
  }
  return null;
}

// ── Auto-fill missing generation numbers ────────────────
// A person created without an explicit `gen` gets `gen: null` (see
// POST /api/person below) instead of silently defaulting to 0 — 0 is
// a legitimate value for real eldest ancestors, so guessing 0 for
// "unspecified" would be indistinguishable from a real great-grandparent
// and slip past checkGenOrder undetected (exactly the bug that caused
// the Sveta/Sasha Kulnitsky case).
//
// Instead, whenever a family gets a parent/child link established
// (POST /api/family, addChild, addParent, setSlot), this fills in
// any still-missing gen using whoever ELSE in that same family already
// has a known gen: children = parents' gen + 1, parents = children's
// gen - 1 (or match the other parent's gen if that's what's known).
// If nobody in the family has a known gen yet, nothing is set — that
// rare case still needs a human to specify it once, but doesn't
// silently corrupt data with a fake 0.
function autoFillGen(IDX, famId) {
  const fam = IDX.families[famId];
  if(!fam) return;
  const parents  = [fam.husband, fam.wife].filter(Boolean);
  const children = fam.children || [];

  const knownParentGen = parents
    .map(p => IDX.nodes[p]?.gen)
    .find(g => g !== null && g !== undefined);
  const knownChildGen = children
    .map(c => IDX.nodes[c]?.gen)
    .find(g => g !== null && g !== undefined);

  let parentGen = knownParentGen;
  if(parentGen === undefined && knownChildGen !== undefined) parentGen = knownChildGen - 1;

  let childGen = knownChildGen;
  if(childGen === undefined && parentGen !== undefined) childGen = parentGen + 1;

  if(parentGen !== undefined){
    for(const p of parents){
      if(IDX.nodes[p] && (IDX.nodes[p].gen === null || IDX.nodes[p].gen === undefined)) {
        IDX.nodes[p].gen = parentGen;
      }
    }
  }
  if(childGen !== undefined){
    for(const c of children){
      if(IDX.nodes[c] && (IDX.nodes[c].gen === null || IDX.nodes[c].gen === undefined)) {
        IDX.nodes[c].gen = childGen;
      }
    }
  }
}

// ── Name transliteration (RU → EN / HE) ─────────────────
// Mechanical, offline transliteration for auto-populating IDX.names
// when a new person is created without translations. Deliberately
// simple (letter-by-letter mapping) rather than calling an external
// translation API — no API key, no cost, no network dependency, at
// the price of lower quality (especially for Hebrew, which doesn't
// map cleanly from Cyrillic phonetics). Good enough for browsing;
// can always be corrected by hand afterward like any other field.
const TRANSLIT_EN = {
  'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'yo','ж':'zh',
  'з':'z','и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o',
  'п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts',
  'ч':'ch','ш':'sh','щ':'shch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya',
};
const TRANSLIT_HE = {
  'а':'א','б':'ב','в':'ב','г':'ג','д':'ד','е':'ה','ё':'יו','ж':"ז'",
  'з':'ז','и':'י','й':'י','к':'ק','л':'ל','м':'מ','н':'נ','о':'ו',
  'п':'פ','р':'ר','с':'ס','т':'ט','у':'ו','ф':'פ','х':'ח','ц':'צ',
  'ч':"צ'",'ш':'ש','щ':'שץ','ъ':'','ы':'י','ь':'','э':'א','ю':'יו','я':'יה',
};
// Hebrew final-letter forms, applied when the mapped letter ends a word
const HE_FINALS = { 'מ':'ם', 'נ':'ן', 'צ':'ץ', 'פ':'ף', 'כ':'ך' };

function transliterateWord(word, map) {
  let out = '';
  for(const ch of word.toLowerCase()) {
    out += (map[ch] !== undefined) ? map[ch] : ch;
  }
  return out;
}
function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

function transliterateToEn(fullName) {
  return fullName.split(' ')
    .map(w => capitalize(transliterateWord(w, TRANSLIT_EN)))
    .join(' ');
}
function transliterateToHe(fullName) {
  return fullName.split(' ')
    .map(w => {
      let t = transliterateWord(w, TRANSLIT_HE);
      const last = t.slice(-1);
      if(HE_FINALS[last]) t = t.slice(0, -1) + HE_FINALS[last];
      return t;
    })
    .join(' ');
}

// ── Route handler ──────────────────────────────────────

export default {
  async fetch(request, env) {
    const url    = new URL(request.url);
    const path   = url.pathname;
    const method = request.method;

    // CORS preflight
    if(method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    // ── POST /api/login ──────────────────────────────
    // Body: { password }
    // Returns: { ok, role: 'guest'|'admin' }
    if(path === '/api/login' && method === 'POST') {
      const { password } = await request.json().catch(() => ({}));
      if(await checkPassword(password, env.ADMIN_PASSWORD_HASH)) {
        return json({ ok: true, role: 'admin' });
      }
      if(await checkPassword(password, env.GUEST_PASSWORD_HASH)) {
        return json({ ok: true, role: 'guest' });
      }
      return err('Неверный пароль', 401);
    }

    // ── GET /api/tree/public ─────────────────────────
    // No auth required — public read-only view of the live tree with
    // sensitive contact fields (phone/email/social) stripped server-side.
    // This lets anonymous visitors (who never logged in) see current
    // data instead of the frozen FALLBACK_DATA snapshot baked into the
    // deployed HTML file at last build time.
    if(path === '/api/tree/public' && method === 'GET') {
      const data = await env.TREE_KV.get('tree_data');
      if(!data) return err('Данные дерева не найдены. Загрузите начальный файл.', 404);

      const IDX = JSON.parse(data);
      const sanitizedNodes = {};
      for(const [id, n] of Object.entries(IDX.nodes || {})){
        const { phone, email, social, ...safe } = n;
        sanitizedNodes[id] = safe;
      }

      const sanitized = { ...IDX, nodes: sanitizedNodes };

      return new Response(JSON.stringify(sanitized), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // ── GET /api/tree ────────────────────────────────
    // Returns current IDX JSON (the family tree data)
    if(path === '/api/tree' && method === 'GET') {
      const auth = await getRole(request, env);
      if(!auth) return err('Требуется авторизация', 401);

      const data = await env.TREE_KV.get('tree_data');
      if(!data) return err('Данные дерева не найдены. Загрузите начальный файл.', 404);
      return new Response(data, {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // ── POST /api/tree ───────────────────────────────
    // Admin only: upload full IDX JSON
    if(path === '/api/tree' && method === 'POST') {
      const auth = await getRole(request, env);
      if(auth !== 'admin') return err('Только для администратора', 403);

      const body = await request.text();
      try { JSON.parse(body); } catch(e) { return err('Невалидный JSON'); }

      // Back up the PREVIOUS tree_data before overwriting — backups exist
      // to allow rollback, so they must capture what was there before this
      // upload, not a duplicate of what's being uploaded now.
      const oldData = await env.TREE_KV.get('tree_data');
      if(oldData) {
        await env.TREE_KV.put('backup_' + Date.now(), oldData);
      }

      await env.TREE_KV.put('tree_data', body);

      // Trim old backups (keep last 10)
      const list = await env.TREE_KV.list({ prefix: 'backup_' });
      const keys = list.keys.map(k => k.name).sort();
      if(keys.length > 10) {
        for(const old of keys.slice(0, keys.length - 10)) {
          await env.TREE_KV.delete(old);
        }
      }

      return json({ ok: true, message: 'Дерево обновлено' });
    }

    // ── POST /api/proposal ───────────────────────────
    // Guest or admin: submit a change proposal
    // Body: { prompt, type, lang, author? }
    if(path === '/api/proposal' && method === 'POST') {
      const auth = await getRole(request, env);
      if(!auth) return err('Требуется авторизация', 401);

      const body = await request.json().catch(() => null);
      if(!body || !body.prompt) return err('Пустой запрос');

      const id = 'proposal_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
      const proposal = {
        id,
        prompt:    body.prompt,
        type:      body.type   || 'unknown',
        lang:      body.lang   || 'ru',
        author:    body.author || 'anonymous',
        role:      auth,
        status:    'pending',   // pending | accepted | rejected
        createdAt: new Date().toISOString(),
      };

      await env.TREE_KV.put(id, JSON.stringify(proposal));

      // Update proposals index
      const idxRaw  = await env.TREE_KV.get('proposals_index');
      const idx     = idxRaw ? JSON.parse(idxRaw) : [];
      idx.unshift(id);
      await env.TREE_KV.put('proposals_index', JSON.stringify(idx.slice(0, 200)));

      return json({ ok: true, id });
    }

    // ── GET /api/proposals ───────────────────────────
    // Admin only: list all proposals
    if(path === '/api/proposals' && method === 'GET') {
      const auth = await getRole(request, env);
      if(auth !== 'admin') return err('Только для администратора', 403);

      const status = url.searchParams.get('status') || 'pending';
      const idxRaw = await env.TREE_KV.get('proposals_index');
      const idx    = idxRaw ? JSON.parse(idxRaw) : [];

      const proposals = [];
      for(const id of idx.slice(0, 50)) {
        const raw = await env.TREE_KV.get(id);
        if(!raw) continue;
        const p = JSON.parse(raw);
        if(status === 'all' || p.status === status) proposals.push(p);
      }

      return json({ ok: true, proposals });
    }

    // ── POST /api/proposal/:id/accept ────────────────
    // Admin only: mark proposal accepted (tree update done externally via Claude)
    if(path.match(/^\/api\/proposal\/.+\/accept$/) && method === 'POST') {
      const auth = await getRole(request, env);
      if(auth !== 'admin') return err('Только для администратора', 403);

      const id  = path.split('/')[3];
      const raw = await env.TREE_KV.get('proposal_' + id) ||
                  await env.TREE_KV.get(id);
      if(!raw) return err('Предложение не найдено', 404);

      const proposal = JSON.parse(raw);
      proposal.status     = 'accepted';
      proposal.resolvedAt = new Date().toISOString();
      await env.TREE_KV.put(proposal.id, JSON.stringify(proposal));

      return json({ ok: true });
    }

    // ── POST /api/proposal/:id/reject ────────────────
    if(path.match(/^\/api\/proposal\/.+\/reject$/) && method === 'POST') {
      const auth = await getRole(request, env);
      if(auth !== 'admin') return err('Только для администратора', 403);

      const id  = path.split('/')[3];
      const raw = await env.TREE_KV.get('proposal_' + id) ||
                  await env.TREE_KV.get(id);
      if(!raw) return err('Предложение не найдено', 404);

      const proposal = JSON.parse(raw);
      proposal.status     = 'rejected';
      proposal.resolvedAt = new Date().toISOString();
      await env.TREE_KV.put(proposal.id, JSON.stringify(proposal));

      return json({ ok: true });
    }

    // ── GET /api/backups ─────────────────────────────
    if(path === '/api/backups' && method === 'GET') {
      const auth = await getRole(request, env);
      if(auth !== 'admin') return err('Только для администратора', 403);

      const list = await env.TREE_KV.list({ prefix: 'backup_' });
      const keys = list.keys.map(k => ({
        key: k.name,
        ts:  parseInt(k.name.replace('backup_','')) || 0,
        date: new Date(parseInt(k.name.replace('backup_',''))).toLocaleString('ru-RU'),
      })).sort((a,b) => b.ts - a.ts);

      return json({ ok: true, backups: keys });
    }

    // ── GET /api/backup/:key ─────────────────────────
    if(path.startsWith('/api/backup/') && method === 'GET') {
      const auth = await getRole(request, env);
      if(auth !== 'admin') return err('Только для администратора', 403);

      const key = decodeURIComponent(path.replace('/api/backup/', ''));
      const data = await env.TREE_KV.get(key);
      if(!data) return err('Резервная копия не найдена', 404);

      return new Response(data, {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // ── GET /calendar.ics ────────────────────────────
    // Public: returns ICS calendar with all birthdays
    // No auth required — shareable subscription link
    if(path === '/calendar.ics' && method === 'GET') {
      const data = await env.TREE_KV.get('tree_data');
      if(!data) return new Response('No tree data', { status: 404, headers: CORS });

      const IDX = JSON.parse(data);
      const nodes = IDX.nodes || {};

      // Parse date string → {month, day, year}
      function parseBirth(s) {
        if(!s) return null;
        // Formats: "9 OCT 1970", "OCT 1970", "1970", "1936"
        const MONTHS = {JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,
                        JUL:7,AUG:8,SEP:9,OCT:10,NOV:11,DEC:12};
        const parts = s.trim().split(/\s+/);
        if(parts.length === 3) {
          // D MON YYYY
          return { day: parseInt(parts[0]), month: MONTHS[parts[1]], year: parseInt(parts[2]) };
        } else if(parts.length === 2 && isNaN(parts[0])) {
          // MON YYYY
          return { day: 1, month: MONTHS[parts[0]], year: parseInt(parts[1]) };
        } else if(parts.length === 1 && !isNaN(parts[0])) {
          // YYYY only
          return { day: 1, month: 1, year: parseInt(parts[0]) };
        }
        return null;
      }

      function pad(n) { return String(n).padStart(2,'0'); }

      function icsDate(y, m, d) {
        return `${y}${pad(m)}${pad(d)}`;
      }

      // Build ICS
      const now = new Date();
      const stamp = now.toISOString().replace(/[-:]/g,'').split('.')[0] + 'Z';

      let ics = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Mostovoy Family Tree//Birthday Calendar//RU',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'X-WR-CALNAME:🎂 Дни рождения — Мостовые',
        'X-WR-CALDESC:Дни рождения семьи Мостовых-Журахинских-Лейцис',
        'X-WR-TIMEZONE:Asia/Jerusalem',
      ];

      for(const [id, n] of Object.entries(nodes)) {
        // Only living persons — skip if death date is set
        if(n.death && n.death.trim() !== '') continue;
        if(!n.birth) continue;
        const b = parseBirth(n.birth);
        if(!b || !b.month) continue;

        // Recurring annual event (RRULE:FREQ=YEARLY)
        const dtstart = `${b.year}${pad(b.month)}${pad(b.day)}`;
        const dtend   = `${b.year}${pad(b.month)}${pad(b.day + 1 > 28 ? b.day : b.day + 1)}`;
        const uid     = `birthday-${id}@mostovoy-tree`;
        const name    = n.name;
        const age_note = b.year ? ` (${now.getFullYear() - b.year} лет)` : '';

        ics.push('BEGIN:VEVENT');
        ics.push(`UID:${uid}`);
        ics.push(`DTSTAMP:${stamp}`);
        ics.push(`DTSTART;VALUE=DATE:${dtstart}`);
        ics.push(`DTEND;VALUE=DATE:${icsDate(b.year, b.month, b.day + 1)}`);
        ics.push(`RRULE:FREQ=YEARLY`);
        ics.push(`SUMMARY:🎂 ${name}${age_note}`);
        ics.push(`DESCRIPTION:День рождения: ${n.birth}${n.birth_he ? ' / ' + n.birth_he : ''}`);
        ics.push(`CATEGORIES:BIRTHDAY`);
        ics.push(`TRANSP:TRANSPARENT`);
        // Reminder 1 day before
        ics.push('BEGIN:VALARM');
        ics.push('TRIGGER:-P1D');
        ics.push('ACTION:DISPLAY');
        ics.push(`DESCRIPTION:Завтра день рождения: ${name}`);
        ics.push('END:VALARM');
        ics.push('END:VEVENT');
      }

      ics.push('END:VCALENDAR');

      return new Response(ics.join('\r\n'), {
        headers: {
          ...CORS,
          'Content-Type': 'text/calendar;charset=utf-8',
          'Content-Disposition': 'inline; filename="mostovoy-birthdays.ics"',
          'Cache-Control': 'max-age=3600',
        }
      });
    }

    // ── GET /contacts.vcf ─────────────────────────────
    // Public: returns VCF with all living persons who have contact data
    if(path === '/contacts.vcf' && method === 'GET') {
      const data = await env.TREE_KV.get('tree_data');
      if(!data) return new Response('No tree data', { status: 404, headers: CORS });

      const IDX  = JSON.parse(data);
      const nodes = IDX.nodes || {};
      const lines = [];

      for(const [id, n] of Object.entries(nodes)){
        if(!n.phone && !n.email && !n.social) continue;
        if(n.death && n.death.trim() !== '') continue;

        const name   = n.name || '';
        const parts  = name.trim().split(/\s+/);
        const last   = parts.length > 1 ? parts[parts.length-1] : '';
        const first  = parts.length > 1 ? parts.slice(0,-1).join(' ') : parts[0]||'';
        const bYear  = n.birth ? (n.birth.match(/\d{4}/)||[''])[0] : '';

        lines.push('BEGIN:VCARD');
        lines.push('VERSION:3.0');
        lines.push('FN:' + name);
        lines.push('N:' + last + ';' + first + ';;;');
        if(n.phone)  lines.push('TEL;TYPE=CELL:' + n.phone);
        if(n.email)  lines.push('EMAIL:' + n.email);
        if(n.social) lines.push('URL:' + n.social);
        if(bYear)    lines.push('BDAY:' + bYear + '0101');
        if(n.rel)    lines.push('NOTE:' + n.rel + ' · ' + id);
        lines.push('ORG:Mostovoy-Zhurakhinsky-Leytsis');
        lines.push('CATEGORIES:Family');
        lines.push('END:VCARD');
        lines.push('');
      }

      return new Response(lines.join('\r\n'), {
        headers: {
          ...CORS,
          'Content-Type': 'text/vcard;charset=utf-8',
          'Content-Disposition': 'attachment; filename="mostovoy-contacts.vcf"',
          'Cache-Control': 'max-age=3600',
        }
      });
    }

    // ── PATCH /api/person/:id ────────────────────────────
    // Admin only: update specific fields of one person
    // Body: { field: value, ... } — only listed fields are changed
    // Special: pass field value as null to clear it
    const patchMatch = path.match(/^\/api\/person\/([^/]+)$/);
    if(patchMatch && method === 'PATCH') {
      const auth = await getRole(request, env);
      if(auth !== 'admin') return err('Только для администратора', 403);

      const personId = patchMatch[1];
      const rawData  = await env.TREE_KV.get('tree_data');
      if(!rawData) return err('Данные дерева не найдены', 404);

      const IDX = JSON.parse(rawData);
      if(!IDX.nodes[personId]) return err('Персона не найдена: ' + personId, 404);

      const updates = await request.json().catch(() => null);
      if(!updates || typeof updates !== 'object') return err('Неверный формат данных');

      // Allowed fields for direct update (guards against injecting structural fields)
      const ALLOWED = ['name','birth','death','birth_he','death_he','hebrew_name',
                       'sex','rel','phone','email','social','bio','photo','missing','genitive',
                       'family_note','other_note',
                       'rel_en','rel_he','family_note_en','family_note_he','other_note_en','other_note_he'];
      const applied = {};
      for(const [field, val] of Object.entries(updates)){
        if(!ALLOWED.includes(field)) continue;
        if(val === null || val === undefined) {
          delete IDX.nodes[personId][field];
        } else {
          IDX.nodes[personId][field] = val;
        }
        applied[field] = val;
      }

      // 'gen' is structural, so it gets its own validated path rather than
      // sitting in the free-form ALLOWED whitelist above.
      if(Object.prototype.hasOwnProperty.call(updates, 'gen')){
        const g = updates.gen;
        if(g === null || g === undefined || g === ''){
          IDX.nodes[personId].gen = null;
          applied.gen = null;
        } else if(Number.isInteger(g) || (typeof g === 'string' && /^-?\d+$/.test(g))){
          IDX.nodes[personId].gen = parseInt(g, 10);
          applied.gen = IDX.nodes[personId].gen;
        } else {
          return err('Поле gen должно быть целым числом или пустым');
        }
      }

      if(Object.keys(applied).length === 0) return err('Нет допустимых полей для обновления');

      // Save backup + updated tree
      const ts = Date.now();
      await env.TREE_KV.put('backup_' + ts, rawData);
      await env.TREE_KV.put('tree_data', JSON.stringify(IDX));

      // Trim old backups (keep last 10)
      const list = await env.TREE_KV.list({ prefix: 'backup_' });
      const keys = list.keys.map(k => k.name).sort();
      if(keys.length > 10) {
        for(const old of keys.slice(0, keys.length - 10)) {
          await env.TREE_KV.delete(old);
        }
      }

      return json({ ok: true, personId, applied });
    }

    // ── POST /api/person ─────────────────────────────────
    // Admin only: create a new person
    // Body: { name, sex, gen, birth?, death?, rel?, phone?, email?, social?, ... }
    if(path === '/api/person' && method === 'POST') {
      const auth = await getRole(request, env);
      if(auth !== 'admin') return err('Только для администратора', 403);

      const rawData = await env.TREE_KV.get('tree_data');
      if(!rawData) return err('Данные дерева не найдены', 404);

      const IDX  = JSON.parse(rawData);
      const body = await request.json().catch(() => null);
      if(!body || !body.name) return err('Поле name обязательно');

      // Generate next person ID
      const maxP = Math.max(0, ...Object.keys(IDX.nodes)
        .filter(k => k.startsWith('P'))
        .map(k => parseInt(k.slice(1))));
      const newId = 'P' + (maxP + 1);

      IDX.nodes[newId] = {
        id:      newId,
        name:    body.name,
        sex:     body.sex    || '',
        gen:     body.gen    ?? null,
        birth:   body.birth  || '',
        death:   body.death  || '',
        rel:     body.rel    || '',
        missing: body.missing || [],
        ...(body.birth_he    ? { birth_he:    body.birth_he }    : {}),
        ...(body.death_he    ? { death_he:    body.death_he }    : {}),
        ...(body.hebrew_name ? { hebrew_name: body.hebrew_name } : {}),
        ...(body.phone       ? { phone:       body.phone }       : {}),
        ...(body.email       ? { email:       body.email }       : {}),
        ...(body.social      ? { social:      body.social }      : {}),
        ...(body.bio         ? { bio:         body.bio }         : {}),
        ...(body.photo       ? { photo:       body.photo }       : {}),
        ...(body.genitive    ? { genitive:    body.genitive }    : {}),
        ...(body.family_note ? { family_note: body.family_note } : {}),
        ...(body.other_note  ? { other_note:  body.other_note }  : {}),
        ...(body.rel_en          ? { rel_en:          body.rel_en }          : {}),
        ...(body.rel_he          ? { rel_he:          body.rel_he }          : {}),
        ...(body.family_note_en  ? { family_note_en:  body.family_note_en }  : {}),
        ...(body.family_note_he  ? { family_note_he:  body.family_note_he }  : {}),
        ...(body.other_note_en   ? { other_note_en:   body.other_note_en }   : {}),
        ...(body.other_note_he   ? { other_note_he:   body.other_note_he }   : {}),
      };

      // Initialize empty relatives entry
      IDX.relatives[newId] = { parents: [], siblings: [], spouses: [], children: [] };

      // Auto-generate EN/HE display-name transliterations and store them
      // in IDX.names (round-trips through GET/POST /api/tree just like
      // everything else — no separate storage or endpoint needed).
      if(!IDX.names) IDX.names = {};
      IDX.names[newId] = {
        en: transliterateToEn(body.name),
        he: transliterateToHe(body.name),
      };

      const ts = Date.now();
      await env.TREE_KV.put('backup_' + ts, rawData);
      await env.TREE_KV.put('tree_data', JSON.stringify(IDX));

      return json({ ok: true, personId: newId, node: IDX.nodes[newId] });
    }

    // ── DELETE /api/person/:id ───────────────────────────
    // Admin only: delete a person (only if they have no children)
    const deleteMatch = path.match(/^\/api\/person\/([^/]+)$/);
    if(deleteMatch && method === 'DELETE') {
      const auth = await getRole(request, env);
      if(auth !== 'admin') return err('Только для администратора', 403);

      const personId = deleteMatch[1];
      const rawData  = await env.TREE_KV.get('tree_data');
      if(!rawData) return err('Данные дерева не найдены', 404);

      const IDX = JSON.parse(rawData);
      if(!IDX.nodes[personId]) return err('Персона не найдена: ' + personId, 404);

      const name = IDX.nodes[personId].name;

      // Remove from nodes and relatives
      delete IDX.nodes[personId];
      delete IDX.relatives[personId];
      delete IDX.child_of[personId];
      delete IDX.parent_in[personId];

      // Remove from siblings lists
      for(const [id, r] of Object.entries(IDX.relatives)){
        r.siblings = (r.siblings||[]).filter(s => s !== personId);
        r.spouses  = (r.spouses ||[]).filter(s => s !== personId);
        r.parents  = (r.parents ||[]).filter(s => s !== personId);
        r.children = (r.children||[]).filter(s => s !== personId);
      }

      // Remove from all family references
      for(const [fid, f] of Object.entries(IDX.families)){
        f.children = (f.children||[]).filter(c => c !== personId);
        if(f.husband === personId) f.husband = null;
        if(f.wife    === personId) f.wife    = null;
      }

      const ts = Date.now();
      await env.TREE_KV.put('backup_' + ts, rawData);
      await env.TREE_KV.put('tree_data', JSON.stringify(IDX));

      return json({ ok: true, deleted: personId, name });
    }

    // ── POST /api/family ─────────────────────────────────
    // Admin only: create a new marriage/family unit
    // Body: { parent1: "P246", parent2: "P254", children?: ["P255"] }
    // Returns: { ok, familyId, family }
    if(path === '/api/family' && method === 'POST') {
      const auth = await getRole(request, env);
      if(auth !== 'admin') return err('Только для администратора', 403);

      const rawData = await env.TREE_KV.get('tree_data');
      if(!rawData) return err('Данные дерева не найдены', 404);

      const IDX  = JSON.parse(rawData);
      const body = await request.json().catch(() => null);
      if(!body) return err('Неверный формат данных');

      const p1 = body.parent1 || null;
      const p2 = body.parent2 || null;
      const children = (body.children || []).filter(c => IDX.nodes[c]);
      if(!p1 && !p2 && children.length === 0) {
        return err('Нужен хотя бы один родитель или хотя бы один ребёнок');
      }
      if(p1 && !IDX.nodes[p1]) return err('Персона не найдена: ' + p1, 404);
      if(p2 && !IDX.nodes[p2]) return err('Персона не найдена: ' + p2, 404);

      // Cycle guard: no parent may already be an ancestor/descendant of
      // any listed child (e.g. "add my father as my child")
      // Duplicate-family guard: none of the children may already belong
      // to a different family (a person has only one set of parents)
      // Birth-order guard: a child cannot be born before/with a parent
      for(const parentId of [p1, p2].filter(Boolean)){
        for(const cid of children){
          const cycleErr = checkParentChildCycle(IDX, parentId, cid);
          if(cycleErr) return err(cycleErr, 409);
          const birthErr = checkBirthYearOrder(IDX, parentId, cid);
          if(birthErr) return err(birthErr, 409);
          const genErr = checkGenOrder(IDX, parentId, cid);
          if(genErr) return err(genErr, 409);
        }
      }
      for(const cid of children){
        const dupErr = checkAlreadyHasFamily(IDX, cid, null);
        if(dupErr) return err(dupErr, 409);
      }

      // Generate next family ID
      const maxF = Math.max(0, ...Object.keys(IDX.families)
        .filter(k => k.startsWith('F'))
        .map(k => parseInt(k.slice(1))));
      const famId = 'F' + (maxF + 1);

      // Determine husband/wife from sex field (fallback: parent1=husband, parent2=wife)
      let husband = null, wife = null;
      if(p1 && p2){
        const s1 = IDX.nodes[p1].sex;
        const s2 = IDX.nodes[p2].sex;
        if(s1 === 'M' && s2 === 'F'){ husband = p1; wife = p2; }
        else if(s1 === 'F' && s2 === 'M'){ husband = p2; wife = p1; }
        else { husband = p1; wife = p2; } // unknown sex: preserve input order
      } else {
        husband = p1 || null;
        wife    = p2 || null;
      }

      IDX.families[famId] = { id: famId, husband, wife, children };

      // Update parent_in and relatives for both parents
      for(const pid of [husband, wife].filter(Boolean)){
        if(!IDX.parent_in[pid]) IDX.parent_in[pid] = [];
        if(!IDX.parent_in[pid].includes(famId)) IDX.parent_in[pid].push(famId);

        if(!IDX.relatives[pid]) IDX.relatives[pid] = { parents:[], siblings:[], spouses:[], children:[] };
        const otherParent = pid === husband ? wife : husband;
        if(otherParent && !IDX.relatives[pid].spouses.includes(otherParent)){
          IDX.relatives[pid].spouses.push(otherParent);
        }
        for(const cid of children){
          if(!IDX.relatives[pid].children.includes(cid)) IDX.relatives[pid].children.push(cid);
        }
      }

      // Update child_of and relatives for children
      for(const cid of children){
        IDX.child_of[cid] = famId;
        if(!IDX.relatives[cid]) IDX.relatives[cid] = { parents:[], siblings:[], spouses:[], children:[] };
        for(const pid of [husband, wife].filter(Boolean)){
          if(!IDX.relatives[cid].parents.includes(pid)) IDX.relatives[cid].parents.push(pid);
        }
        // Update sibling links
        for(const sib of children){
          if(sib !== cid && !IDX.relatives[cid].siblings.includes(sib)){
            IDX.relatives[cid].siblings.push(sib);
          }
        }
      }

      // Fill in missing generation numbers for anyone in this new
      // family who doesn't have one yet (see autoFillGen above)
      autoFillGen(IDX, famId);

      const ts = Date.now();
      await env.TREE_KV.put('backup_' + ts, rawData);
      await env.TREE_KV.put('tree_data', JSON.stringify(IDX));

      return json({ ok: true, familyId: famId, family: IDX.families[famId] });
    }

    // ── PATCH /api/family/:id ────────────────────────────
    // Admin only: add child to family, or add second parent
    // Body: { addChild?: "P260", removeChild?: "P260", parent1?: "P...", parent2?: "P..." }
    const famPatchMatch = path.match(/^\/api\/family\/([^/]+)$/);
    if(famPatchMatch && method === 'PATCH') {
      const auth = await getRole(request, env);
      if(auth !== 'admin') return err('Только для администратора', 403);

      const famId   = famPatchMatch[1];
      const rawData = await env.TREE_KV.get('tree_data');
      if(!rawData) return err('Данные дерева не найдены', 404);

      const IDX = JSON.parse(rawData);
      if(!IDX.families[famId]) return err('Семья не найдена: ' + famId, 404);

      const body = await request.json().catch(() => null);
      if(!body) return err('Неверный формат данных');

      const fam = IDX.families[famId];
      const parents = [fam.husband, fam.wife].filter(Boolean);

      // Add a child to this family
      if(body.addChild) {
        const cid = body.addChild;
        if(!IDX.nodes[cid]) return err('Персона не найдена: ' + cid, 404);

        // Cycle guard: cid must not already be an ancestor of either
        // parent in this family (e.g. "add my father as my child")
        // Duplicate-family guard: cid must not already be a child in
        // a DIFFERENT family (a person has only one set of parents)
        // Birth-order guard: cid cannot be born before/with a parent
        for(const pid of parents){
          const cycleErr = checkParentChildCycle(IDX, pid, cid);
          if(cycleErr) return err(cycleErr, 409);
          const birthErr = checkBirthYearOrder(IDX, pid, cid);
          if(birthErr) return err(birthErr, 409);
          const genErr = checkGenOrder(IDX, pid, cid);
          if(genErr) return err(genErr, 409);
        }
        const dupErr = checkAlreadyHasFamily(IDX, cid, famId);
        if(dupErr) return err(dupErr, 409);

        if(!fam.children.includes(cid)) fam.children.push(cid);

        IDX.child_of[cid] = famId;
        if(!IDX.relatives[cid]) IDX.relatives[cid] = { parents:[], siblings:[], spouses:[], children:[] };

        for(const pid of parents){
          if(!IDX.relatives[cid].parents.includes(pid)) IDX.relatives[cid].parents.push(pid);
          if(!IDX.relatives[pid]) IDX.relatives[pid] = { parents:[], siblings:[], spouses:[], children:[] };
          if(!IDX.relatives[pid].children.includes(cid)) IDX.relatives[pid].children.push(cid);
        }
        // Update sibling links for existing children
        for(const sib of fam.children){
          if(sib === cid) continue;
          if(!IDX.relatives[sib]) continue;
          if(!IDX.relatives[sib].siblings.includes(cid)) IDX.relatives[sib].siblings.push(cid);
          if(!IDX.relatives[cid].siblings.includes(sib)) IDX.relatives[cid].siblings.push(sib);
        }
      }

      // Remove a child from this family
      if(body.removeChild) {
        const cid = body.removeChild;
        fam.children = fam.children.filter(c => c !== cid);
        if(IDX.child_of[cid] === famId) delete IDX.child_of[cid];
        if(IDX.relatives[cid]){
          IDX.relatives[cid].parents  = IDX.relatives[cid].parents.filter(p => !parents.includes(p));
          IDX.relatives[cid].siblings = IDX.relatives[cid].siblings.filter(s => !fam.children.includes(s));
        }
        for(const pid of parents){
          if(IDX.relatives[pid]) IDX.relatives[pid].children = IDX.relatives[pid].children.filter(c => c !== cid);
        }
      }

      // Add second parent (e.g. previously unknown parent discovered)
      if(body.addParent) {
        const pid = body.addParent;
        if(!IDX.nodes[pid]) return err('Персона не найдена: ' + pid, 404);

        // Cycle guard: pid must not already be a descendant of any
        // child in this family (e.g. "add my child as my parent")
        // Birth-order guard: pid must not be born after/with a child
        for(const cid of fam.children){
          const cycleErr = checkParentChildCycle(IDX, pid, cid);
          if(cycleErr) return err(cycleErr, 409);
          const birthErr = checkBirthYearOrder(IDX, pid, cid);
          if(birthErr) return err(birthErr, 409);
          const genErr = checkGenOrder(IDX, pid, cid);
          if(genErr) return err(genErr, 409);
        }

        const sex = IDX.nodes[pid].sex;
        if(!fam.husband && sex !== 'F') fam.husband = pid;
        else if(!fam.wife && sex !== 'M') fam.wife = pid;
        else fam.husband = pid; // fallback

        if(!IDX.parent_in[pid]) IDX.parent_in[pid] = [];
        if(!IDX.parent_in[pid].includes(famId)) IDX.parent_in[pid].push(famId);
        if(!IDX.relatives[pid]) IDX.relatives[pid] = { parents:[], siblings:[], spouses:[], children:[] };
        const otherP = pid === fam.husband ? fam.wife : fam.husband;
        if(otherP && !IDX.relatives[pid].spouses.includes(otherP)) IDX.relatives[pid].spouses.push(otherP);
        if(otherP && !IDX.relatives[otherP].spouses.includes(pid)) IDX.relatives[otherP].spouses.push(pid);
        for(const cid of fam.children){
          if(!IDX.relatives[pid].children.includes(cid)) IDX.relatives[pid].children.push(cid);
          if(IDX.relatives[cid] && !IDX.relatives[cid].parents.includes(pid)) IDX.relatives[cid].parents.push(pid);
        }
      }

      // Fill in missing generation numbers for anyone newly linked
      // into this family who doesn't have one yet (see autoFillGen above)
      autoFillGen(IDX, famId);

      const ts = Date.now();
      await env.TREE_KV.put('backup_' + ts, rawData);
      await env.TREE_KV.put('tree_data', JSON.stringify(IDX));

      return json({ ok: true, familyId: famId, family: IDX.families[famId] });
    }

    // ── DELETE /api/family/:id ───────────────────────────
    // Admin only: delete a family (only if it has no children)
    const famDeleteMatch = path.match(/^\/api\/family\/([^/]+)$/);
    if(famDeleteMatch && method === 'DELETE') {
      const auth = await getRole(request, env);
      if(auth !== 'admin') return err('Только для администратора', 403);

      const famId   = famDeleteMatch[1];
      const rawData = await env.TREE_KV.get('tree_data');
      if(!rawData) return err('Данные дерева не найдены', 404);

      const IDX = JSON.parse(rawData);
      if(!IDX.families[famId]) return err('Семья не найдена: ' + famId, 404);

      const fam = IDX.families[famId];
      if(fam.children && fam.children.length > 0) {
        return err('Нельзя удалить семью с детьми. Сначала переназначьте детей.', 409);
      }

      const parents = [fam.husband, fam.wife].filter(Boolean);
      delete IDX.families[famId];

      // Remove from parent_in and relatives.spouses
      for(const pid of parents){
        if(IDX.parent_in[pid]) IDX.parent_in[pid] = IDX.parent_in[pid].filter(f => f !== famId);
        if(IDX.relatives[pid]){
          const otherP = parents.find(p => p !== pid);
          if(otherP) IDX.relatives[pid].spouses = IDX.relatives[pid].spouses.filter(s => s !== otherP);
        }
      }

      const ts = Date.now();
      await env.TREE_KV.put('backup_' + ts, rawData);
      await env.TREE_KV.put('tree_data', JSON.stringify(IDX));

      return json({ ok: true, deleted: famId });
    }

    // ── POST /api/family ─────────────────────────────────
    // Admin only: create a new marriage/family unit
    // Body: { parent1?, parent2?, children?: [] }
    // Returns: { ok, familyId }
    if(path === '/api/family' && method === 'POST') {
      const auth = await getRole(request, env);
      if(auth !== 'admin') return err('Только для администратора', 403);

      const rawData = await env.TREE_KV.get('tree_data');
      if(!rawData) return err('Данные дерева не найдены', 404);

      const IDX  = JSON.parse(rawData);
      const body = await request.json().catch(() => ({}));

      // Validate referenced persons exist
      const toCheck = [body.parent1, body.parent2, ...(body.children||[])].filter(Boolean);
      for(const pid of toCheck){
        if(!IDX.nodes[pid]) return err('Персона не найдена: ' + pid, 404);
      }

      // Generate next family ID
      const maxF = Math.max(0, ...Object.keys(IDX.families)
        .filter(k => k.startsWith('F'))
        .map(k => parseInt(k.slice(1))));
      const newFid = 'F' + (maxF + 1);

      // Create family (keep husband/wife for compatibility with current renderer)
      const p1 = body.parent1 || null;
      const p2 = body.parent2 || null;
      IDX.families[newFid] = {
        id: newFid,
        husband: p1,
        wife:    p2,
        children: (body.children || []).filter(c => IDX.nodes[c])
      };

      // Update parent_in for both parents
      if(p1){ IDX.parent_in[p1] = [...(IDX.parent_in[p1]||[]), newFid]; }
      if(p2){ IDX.parent_in[p2] = [...(IDX.parent_in[p2]||[]), newFid]; }

      // Update relatives.spouses (mutual)
      if(p1 && p2){
        if(IDX.relatives[p1] && !IDX.relatives[p1].spouses.includes(p2))
          IDX.relatives[p1].spouses.push(p2);
        if(IDX.relatives[p2] && !IDX.relatives[p2].spouses.includes(p1))
          IDX.relatives[p2].spouses.push(p1);
      }

      // Update child_of and relatives for each child
      for(const cid of IDX.families[newFid].children){
        IDX.child_of[cid] = newFid;
        if(p1 && IDX.relatives[cid] && !IDX.relatives[cid].parents.includes(p1))
          IDX.relatives[cid].parents.push(p1);
        if(p2 && IDX.relatives[cid] && !IDX.relatives[cid].parents.includes(p2))
          IDX.relatives[cid].parents.push(p2);
        if(p1 && IDX.relatives[p1] && !IDX.relatives[p1].children.includes(cid))
          IDX.relatives[p1].children.push(cid);
        if(p2 && IDX.relatives[p2] && !IDX.relatives[p2].children.includes(cid))
          IDX.relatives[p2].children.push(cid);
      }

      const ts = Date.now();
      await env.TREE_KV.put('backup_' + ts, rawData);
      await env.TREE_KV.put('tree_data', JSON.stringify(IDX));

      return json({ ok: true, familyId: newFid, family: IDX.families[newFid] });
    }

    // ── PATCH /api/family/:id ────────────────────────────
    // Admin only: add a child to existing family, or update parents
    // Body: { addChild?, removeChild?, parent1?, parent2? }
    const patchFamMatch = path.match(/^\/api\/family\/([^/]+)$/);
    if(patchFamMatch && method === 'PATCH') {
      const auth = await getRole(request, env);
      if(auth !== 'admin') return err('Только для администратора', 403);

      const famId   = patchFamMatch[1];
      const rawData = await env.TREE_KV.get('tree_data');
      if(!rawData) return err('Данные дерева не найдены', 404);

      const IDX = JSON.parse(rawData);
      if(!IDX.families[famId]) return err('Семья не найдена: ' + famId, 404);

      const body = await request.json().catch(() => ({}));
      const fam  = IDX.families[famId];
      const changes = [];

      // Add child
      if(body.addChild){
        const cid = body.addChild;
        if(!IDX.nodes[cid]) return err('Персона не найдена: ' + cid, 404);
        if(!fam.children.includes(cid)){
          fam.children.push(cid);
          IDX.child_of[cid] = famId;
          if(IDX.relatives[cid]){
            if(fam.husband && !IDX.relatives[cid].parents.includes(fam.husband))
              IDX.relatives[cid].parents.push(fam.husband);
            if(fam.wife && !IDX.relatives[cid].parents.includes(fam.wife))
              IDX.relatives[cid].parents.push(fam.wife);
          }
          if(fam.husband && IDX.relatives[fam.husband] && !IDX.relatives[fam.husband].children.includes(cid))
            IDX.relatives[fam.husband].children.push(cid);
          if(fam.wife && IDX.relatives[fam.wife] && !IDX.relatives[fam.wife].children.includes(cid))
            IDX.relatives[fam.wife].children.push(cid);
          // Update siblings
          for(const sib of fam.children.filter(id => id !== cid)){
            if(IDX.relatives[cid]  && !IDX.relatives[cid].siblings.includes(sib))
              IDX.relatives[cid].siblings.push(sib);
            if(IDX.relatives[sib]  && !IDX.relatives[sib].siblings.includes(cid))
              IDX.relatives[sib].siblings.push(cid);
          }
          changes.push('addChild:' + cid);
        }
      }

      // Remove child
      if(body.removeChild){
        const cid = body.removeChild;
        fam.children = fam.children.filter(c => c !== cid);
        if(IDX.child_of[cid] === famId) delete IDX.child_of[cid];
        if(IDX.relatives[cid]){
          IDX.relatives[cid].parents  = IDX.relatives[cid].parents.filter(p => p!==fam.husband && p!==fam.wife);
          IDX.relatives[cid].siblings = [];
        }
        if(fam.husband && IDX.relatives[fam.husband])
          IDX.relatives[fam.husband].children = IDX.relatives[fam.husband].children.filter(c=>c!==cid);
        if(fam.wife && IDX.relatives[fam.wife])
          IDX.relatives[fam.wife].children = IDX.relatives[fam.wife].children.filter(c=>c!==cid);
        changes.push('removeChild:' + cid);
      }

      // Update parent1/parent2
      if(body.parent1 !== undefined){
        if(body.parent1 && !IDX.nodes[body.parent1]) return err('Персона не найдена: ' + body.parent1, 404);
        fam.husband = body.parent1 || null;
        if(fam.husband){
          IDX.parent_in[fam.husband] = [...new Set([...(IDX.parent_in[fam.husband]||[]), famId])];
        }
        changes.push('parent1:' + body.parent1);
      }
      if(body.parent2 !== undefined){
        if(body.parent2 && !IDX.nodes[body.parent2]) return err('Персона не найдена: ' + body.parent2, 404);
        fam.wife = body.parent2 || null;
        if(fam.wife){
          IDX.parent_in[fam.wife] = [...new Set([...(IDX.parent_in[fam.wife]||[]), famId])];
        }
        changes.push('parent2:' + body.parent2);
      }

      if(changes.length === 0) return err('Нечего обновлять');

      const ts = Date.now();
      await env.TREE_KV.put('backup_' + ts, rawData);
      await env.TREE_KV.put('tree_data', JSON.stringify(IDX));

      return json({ ok: true, familyId: famId, changes, family: IDX.families[famId] });
    }

    // ── DELETE /api/family/:id ───────────────────────────
    // Admin only: delete a family (only if it has no children)
    const deleteFamMatch = path.match(/^\/api\/family\/([^/]+)$/);
    if(deleteFamMatch && method === 'DELETE') {
      const auth = await getRole(request, env);
      if(auth !== 'admin') return err('Только для администратора', 403);

      const famId   = deleteFamMatch[1];
      const rawData = await env.TREE_KV.get('tree_data');
      if(!rawData) return err('Данные дерева не найдены', 404);

      const IDX = JSON.parse(rawData);
      if(!IDX.families[famId]) return err('Семья не найдена: ' + famId, 404);

      const fam = IDX.families[famId];
      if(fam.children && fam.children.length > 0)
        return err('Нельзя удалить семью с детьми. Сначала переназначьте детей.', 409);

      const p1 = fam.husband, p2 = fam.wife;

      // Remove family
      delete IDX.families[famId];

      // Clean up parent_in
      if(p1) IDX.parent_in[p1] = (IDX.parent_in[p1]||[]).filter(f => f !== famId);
      if(p2) IDX.parent_in[p2] = (IDX.parent_in[p2]||[]).filter(f => f !== famId);

      // Clean up spouses in relatives (only if no other family links them)
      const stillMarried = (pid1, pid2) =>
        Object.values(IDX.families).some(f =>
          (f.husband === pid1 && f.wife === pid2) ||
          (f.husband === pid2 && f.wife === pid1));

      if(p1 && p2 && !stillMarried(p1, p2)){
        if(IDX.relatives[p1]) IDX.relatives[p1].spouses = IDX.relatives[p1].spouses.filter(s => s !== p2);
        if(IDX.relatives[p2]) IDX.relatives[p2].spouses = IDX.relatives[p2].spouses.filter(s => s !== p1);
      }

      const ts = Date.now();
      await env.TREE_KV.put('backup_' + ts, rawData);
      await env.TREE_KV.put('tree_data', JSON.stringify(IDX));

      return json({ ok: true, deleted: famId });
    }

    // ── 404 ──────────────────────────────────────────
    return err('Не найдено', 404);
  }
};

// ── Auth helper ────────────────────────────────────────
async function getRole(request, env) {
  // Accept password via Authorization header: "Bearer <password>"
  // or via X-Password header
  const auth   = request.headers.get('Authorization') || '';
  const xpass  = request.headers.get('X-Password')    || '';
  const pass   = xpass || auth.replace('Bearer ', '');

  if(!pass) return null;
  if(await checkPassword(pass, env.ADMIN_PASSWORD_HASH)) return 'admin';
  if(await checkPassword(pass, env.GUEST_PASSWORD_HASH)) return 'guest';
  return null;
}
