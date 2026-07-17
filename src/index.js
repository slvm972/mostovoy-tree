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

      await env.TREE_KV.put('tree_data', body);

      // Save timestamped backup (keep last 10)
      const ts = Date.now();
      await env.TREE_KV.put('backup_' + ts, body);

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
                       'sex','rel','phone','email','social','bio','photo','missing'];
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
        gen:     body.gen    ?? 0,
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
      };

      // Initialize empty relatives entry
      IDX.relatives[newId] = { parents: [], siblings: [], spouses: [], children: [] };

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

      // Safety: refuse if this person is a parent of anyone
      const rel = IDX.relatives[personId];
      if(rel && rel.children && rel.children.length > 0) {
        return err('Нельзя удалить персону с детьми. Сначала переназначьте детей.', 409);
      }

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
