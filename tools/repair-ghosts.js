// node tools/repair-ghosts.js [--file tree.json] [--url https://...workers.dev] [--apply] [--drop-empty-families]
// Находит и убирает «призраков»: ссылки на несуществующих людей в families / relatives /
// child_of / parent_in / grandparents. По умолчанию только отчёт (ничего не меняет).
// С --apply: сохраняет локальную копию, затем отправляет исправленное дерево на сервер (POST /api/tree).
const fs = require('fs');
const readline = require('readline');

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def; };
const APPLY = args.includes('--apply');
const DROP_EMPTY = args.includes('--drop-empty-families');   // по умолчанию пустые семьи не трогаем
const FILE = opt('--file', null);
const URL_BASE = opt('--url', 'https://mostovoy-tree.slvm972.workers.dev');

function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(q, a => { rl.close(); res(a); }));
}

function repair(tree) {
  const T = JSON.parse(JSON.stringify(tree));          // рабочая копия
  const N = T.nodes || {};
  const ghosts = {};                                   // id -> ["где встречается", ...]
  const note = (id, where) => { if (id && !N[id]) (ghosts[id] = ghosts[id] || []).push(where); };
  const alive = (id) => !!(id && N[id]);
  const removedFamilies = [], emptyFamilies = [];

  // families
  for (const [fid, f] of Object.entries(T.families || {})) {
    if (f.husband && !alive(f.husband)) { note(f.husband, fid + '.husband'); f.husband = null; }
    if (f.wife && !alive(f.wife))       { note(f.wife,    fid + '.wife');    f.wife = null; }
    const kids = (f.children || []);
    for (const c of kids) if (!alive(c)) note(c, fid + '.children');
    f.children = kids.filter(alive);
    if (!f.husband && !f.wife && f.children.length === 0) {
      emptyFamilies.push(fid);
      if (DROP_EMPTY) { removedFamilies.push(fid); delete T.families[fid]; }
    }
  }
  const famOk = (fid) => !!(T.families && T.families[fid]);

  // child_of / parent_in
  for (const [pid, fid] of Object.entries(T.child_of || {})) {
    if (!alive(pid)) { note(pid, 'child_of'); delete T.child_of[pid]; }
    else if (!famOk(fid)) delete T.child_of[pid];
  }
  for (const [pid, list] of Object.entries(T.parent_in || {})) {
    if (!alive(pid)) { note(pid, 'parent_in'); delete T.parent_in[pid]; }
    else T.parent_in[pid] = (list || []).filter(famOk);
  }

  // relatives
  for (const [pid, r] of Object.entries(T.relatives || {})) {
    if (!alive(pid)) { note(pid, 'relatives'); delete T.relatives[pid]; continue; }
    for (const k of ['parents', 'siblings', 'spouses', 'children']) {
      const arr = r[k] || [];
      for (const x of arr) if (!alive(x)) note(x, 'relatives[' + pid + '].' + k);
      r[k] = arr.filter(alive);
    }
  }

  // grandparents (кэш)
  for (const [pid, list] of Object.entries(T.grandparents || {})) {
    if (!alive(pid)) { note(pid, 'grandparents'); delete T.grandparents[pid]; continue; }
    T.grandparents[pid] = (list || []).map(g => {
      if (g.husband && !alive(g.husband)) { note(g.husband, 'grandparents[' + pid + ']'); g = { ...g, husband: null }; }
      if (g.wife && !alive(g.wife))       { note(g.wife,    'grandparents[' + pid + ']'); g = { ...g, wife: null }; }
      return g;
    }).filter(g => famOk(g.family) && (g.husband || g.wife));
  }
  return { fixed: T, ghosts, removedFamilies, emptyFamilies };
}

(async () => {
  let tree, pwd = process.env.TREE_PASSWORD || '';
  if (FILE) {
    tree = JSON.parse(fs.readFileSync(FILE, 'utf8').replace(/^\uFEFF/, ''));
  } else {
    if (!pwd) pwd = await ask('Пароль администратора: ');
    const r = await fetch(URL_BASE + '/api/tree', { headers: { 'X-Password': pwd } });
    if (!r.ok) { console.log('Не удалось загрузить дерево:', r.status); process.exit(2); }
    tree = await r.json();
  }
  const { fixed, ghosts, removedFamilies, emptyFamilies } = repair(tree);
  const ids = Object.keys(ghosts);
  console.log('Персон в дереве:', Object.keys(tree.nodes).length, '| Семей:', Object.keys(tree.families).length);
  console.log('Призраков (ссылок на несуществующих людей):', ids.length);
  for (const id of ids) {
    const w = ghosts[id];
    console.log('  ' + id + '  встречается ' + w.length + ' раз(а): ' + w.slice(0, 4).join(', ') + (w.length > 4 ? ' …' : ''));
  }
  if (emptyFamilies.length) console.log('Пустых семей (без мужа, жены и детей): ' + emptyFamilies.length + (DROP_EMPTY ? ' — будут удалены: ' : ' — не трогаю (для удаления добавьте --drop-empty-families): ') + emptyFamilies.join(', '));
  if (!ids.length && !removedFamilies.length) { console.log('Призраков нет, менять нечего.'); return; }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync('tree-before-repair-' + stamp + '.json', JSON.stringify(tree));
  fs.writeFileSync('tree-repaired-' + stamp + '.json', JSON.stringify(fixed));
  console.log('Сохранено: tree-before-repair-' + stamp + '.json (копия «до») и tree-repaired-' + stamp + '.json («после»).');
  if (!APPLY) { console.log('Это был пробный запуск. Для применения запустите с ключом --apply'); return; }
  if (FILE) { console.log('--apply работает только без --file (с загрузкой с сервера).'); return; }
  const r = await fetch(URL_BASE + '/api/tree', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Password': pwd }, body: JSON.stringify(fixed) });
  const d = await r.json().catch(() => ({}));
  console.log(r.ok && d.ok ? 'Готово: исправленное дерево загружено на сервер (сервер сам сделал резервную копию).' : 'Ошибка при загрузке: ' + (d.error || r.status));
})();
