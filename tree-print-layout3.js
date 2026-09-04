// tree-print-layout3.js — раскладка семей по row на принципе getCenteredLayout()
// (familyGroups + сортировка по anchorX + prevRight/GROUP_GAP), БЕЗ отдельного
// реестра занятости (occupiedByRow) и БЕЗ рекурсивного footprint на много
// поколений вперёд.
//
// Это НЕ замена tree-print-layout2.js (findConnectedComponents/assignRows/
// computeFootprint/layoutComponent там остаются как контрольная точка с
// известными ограничениями) — это отдельный, параллельный эксперимент
// (Вариант B), который в этой сессии тестируется ИЗОЛИРОВАННО, без интеграции
// в компонентный цикл.

// ── константы (те же, что в getCenteredLayout, tree-layout.js) ──
const CW = 150;
const CH = 100;
const COUPLE_GAP = 12;
const SIBLING_GAP = 22;
const LEVEL_H = 168;

// ── findConnectedComponents / assignRows ────────────────────────────────
// Дублированы сюда напрямую (не восстанавливаем tree-print-layout2.js —
// он удалён из репозитория в коммите dcc43ee, решение отказаться от
// Варианта A уже принято). Логика не менялась с прошлой протестированной
// версии: BFS-компоненты связности + прямое чтение gen как row.
function findConnectedComponents(IDX) {
  const nodeIds = Object.keys(IDX.nodes || {});
  const adjacency = new Map();
  for (const id of nodeIds) adjacency.set(id, new Set());

  function addEdge(a, b) {
    if (!a || !b) return;
    if (!adjacency.has(a) || !adjacency.has(b)) return;
    adjacency.get(a).add(b);
    adjacency.get(b).add(a);
  }

  for (const fam of Object.values(IDX.families || {})) {
    const husband = fam.husband || null;
    const wife = fam.wife || null;
    if (husband && wife) addEdge(husband, wife);
    const parentRef = husband || wife || null;
    for (const childId of fam.children || []) {
      if (husband) addEdge(husband, childId);
      if (wife) addEdge(wife, childId);
      if (!husband && !wife && parentRef) addEdge(parentRef, childId);
    }
    if (!husband && !wife && (fam.children || []).length > 1) {
      const kids = fam.children;
      for (let i = 1; i < kids.length; i++) addEdge(kids[0], kids[i]);
    }
  }

  const visited = new Set();
  const components = [];
  for (const startId of nodeIds) {
    if (visited.has(startId)) continue;
    const component = [];
    const queue = [startId];
    visited.add(startId);
    while (queue.length) {
      const current = queue.shift();
      component.push(current);
      for (const neighbor of adjacency.get(current) || []) {
        if (!visited.has(neighbor)) { visited.add(neighbor); queue.push(neighbor); }
      }
    }
    components.push(component);
  }
  return components;
}

function assignRows(IDX) {
  const rowsOut = {};
  for (const [id, node] of Object.entries(IDX.nodes || {})) {
    const gen = node && node.gen;
    if (gen === undefined || gen === null) continue;
    rowsOut[id] = gen;
  }
  return rowsOut;
}

// ── placeCouple — переиспользована буквально из tree-layout.js (строки 55-68),
// единственное отличие: IDX передаётся параметром вместо чтения глобальной
// переменной (там она браузерный global, здесь модуль тестируется в Node).
function placeCouple(husband, wife, anchorX, y, role, IDX) {
  const people = [husband, wife].filter(Boolean).filter(id => IDX.nodes[id]);
  const totalW = people.length * CW + (people.length - 1) * COUPLE_GAP;
  let x = anchorX - totalW / 2;
  return people.map(id => {
    const node = { id, x, y, role };
    x += CW + COUPLE_GAP;
    return node;
  });
}

// ── placeFamiliesInRow ───────────────────────────────────────────────────
// row: номер row (person.gen), для которого сейчас размещаются семьи
// familiesOfThisRow: familyId, чей родитель(и) уже размещены в
//   placedPositions с предыдущего прохода, ЛИБО ещё не размещены вообще
// placedPositions: {personId: {x,y}} — мутируется этим вызовом
// IDX: полные данные дерева
//
// Принцип (перенос familyGroups из getCenteredLayout, level+1, строки 227-267
// tree-layout.js): вместо ОДНОГО фокала с несколькими браками — ЛЮБАЯ уже
// размещённая персона на этом row с несколькими браками; вместо ОДНОГО вызова,
// монопольно строящего весь ряд — общий проход "собрать все задачи
// размещения → отсортировать по желаемому anchorX → пройти слева направо,
// раздвигая коллизии через prevRight/SIBLING_GAP". Никакого отдельного
// occupiedByRow/findFreeX — вся "занятость" это только placedPositions плюс
// локальный prevRight, который живёт ТОЛЬКО внутри этого вызова.
function placeFamiliesInRow(row, familiesOfThisRow, placedPositions, IDX) {
  const y = row * LEVEL_H;

  function numKey(id) {
    if (!id) return Infinity;
    const m = String(id).match(/\d+/);
    return m ? parseInt(m[0], 10) : Infinity;
  }
  function familyNumKey(famId) {
    const fam = IDX.families[famId];
    return numKey(fam.husband || fam.wife || famId);
  }

  const onePlaced = [];    // {famId, ownerId, spouseId} — один супруг уже размещён
  const neitherPlaced = []; // famId — новая независимая пара

  for (const famId of familiesOfThisRow) {
    const fam = IDX.families[famId];
    const h = fam.husband || null;
    const w = fam.wife || null;
    if (!h || !w) continue; // семьи с одним известным родителем вне скопа этого теста
    const hPlaced = placedPositions[h];
    const wPlaced = placedPositions[w];
    if (hPlaced && wPlaced) continue; // оба уже на месте — ничего не делаем
    if (hPlaced && !wPlaced) { onePlaced.push({ famId, ownerId: h, spouseId: w }); continue; }
    if (!hPlaced && wPlaced) { onePlaced.push({ famId, ownerId: w, spouseId: h }); continue; }
    neitherPlaced.push(famId);
  }

  // ── группировка "один супруг уже размещён" по владельцу ──
  // Внутри владельца: браки обрабатываются по возрастанию числового id семьи
  // (детерминированно), и каждый следующий брак того же владельца получает
  // anchorX ПРАВЕЕ предыдущего (ownerRightEdge накапливается) — именно это
  // "второй, третий брак уходит ещё правее первого" из задания.
  const byOwner = new Map();
  for (const item of onePlaced) {
    if (!byOwner.has(item.ownerId)) byOwner.set(item.ownerId, []);
    byOwner.get(item.ownerId).push(item);
  }
  // группы-владельцы сортируются по их собственной уже зафиксированной x —
  // чисто для детерминированности порядка построения задач (итоговый порядок
  // всё равно определит финальная сортировка по anchorX ниже)
  const ownerIds = [...byOwner.keys()].sort(
    (a, b) => placedPositions[a].x - placedPositions[b].x
  );

  const tasks = []; // {x, width, apply(finalX)}

  const ownerRightEdge = {};
  for (const ownerId of ownerIds) {
    const items = byOwner.get(ownerId).slice()
      .sort((a, b) => familyNumKey(a.famId) - familyNumKey(b.famId));
    ownerRightEdge[ownerId] = placedPositions[ownerId].x + CW;
    for (const item of items) {
      const desiredX = ownerRightEdge[ownerId] + COUPLE_GAP;
      tasks.push({
        x: desiredX,
        width: CW,
        apply: (finalX) => { placedPositions[item.spouseId] = { x: finalX, y }; }
      });
      ownerRightEdge[ownerId] = desiredX + CW; // следующий брак того же владельца — ещё правее
    }
  }

  // ── независимые новые пары — по числовому id, детерминированно ──
  const sortedNeither = neitherPlaced.slice()
    .sort((a, b) => familyNumKey(a) - familyNumKey(b));
  let newPairCursor = 0;
  for (const famId of sortedNeither) {
    const fam = IDX.families[famId];
    const pairWidth = CW * 2 + COUPLE_GAP;
    const x = newPairCursor;
    tasks.push({
      x,
      width: pairWidth,
      apply: (finalX) => {
        placedPositions[fam.husband] = { x: finalX, y };
        placedPositions[fam.wife] = { x: finalX + CW + COUPLE_GAP, y };
      }
    });
    newPairCursor += pairWidth + SIBLING_GAP;
  }

  // ── единый проход слева направо: сортировка по x, prevRight/SIBLING_GAP развод ──
  // (тот же приём, что в getCenteredLayout, tree-layout.js:227-267 — там он
  // разводит familyGroups одного фокала, здесь — все задачи размещения
  // этого row целиком)
  tasks.sort((a, b) => a.x - b.x);
  let prevRight = -Infinity;
  for (const task of tasks) {
    let finalX = task.x;
    if (finalX < prevRight + SIBLING_GAP) finalX = prevRight + SIBLING_GAP;
    task.apply(finalX);
    prevRight = finalX + task.width;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CW, CH, COUPLE_GAP, SIBLING_GAP, LEVEL_H, placeCouple, placeFamiliesInRow, findConnectedComponents, assignRows };
}

// ── тестовый блок ──────────────────────────────────────────────────────
if (typeof require !== 'undefined' && require.main === module) {
  const fs = require('fs');
  const path = require('path');
  const IDX = JSON.parse(fs.readFileSync(path.join(__dirname, 'tree-fallback.json'), 'utf8'));

  const rows = assignRows(IDX);
  const components = findConnectedComponents(IDX);
  const biggest = components.sort((a, b) => b.length - a.length)[0];
  const componentSet = new Set(biggest);

  // ── собрать все 35 реальных супружеских пар (husband И wife оба заданы)
  // этой компоненты, сгруппировать по row семьи ──
  // row семьи: rows[husband], если определён, иначе rows[wife] (тот же
  // приоритет, что уже используется в tree-print-layout2.js familiesByRow).
  const familiesOfComponent = [];
  for (const [famId, fam] of Object.entries(IDX.families)) {
    const h = fam.husband, w = fam.wife;
    if (!h || !w) continue;
    if (!componentSet.has(h) || !componentSet.has(w)) continue;
    familiesOfComponent.push(famId);
  }

  const familiesByRow = new Map();
  for (const famId of familiesOfComponent) {
    const fam = IDX.families[famId];
    const row = (rows[fam.husband] !== undefined) ? rows[fam.husband] : rows[fam.wife];
    if (row === undefined) { console.warn('[test] Пропущена семья без row:', famId); continue; }
    if (!familiesByRow.has(row)) familiesByRow.set(row, []);
    familiesByRow.get(row).push(famId);
  }

  const sortedRows = [...familiesByRow.keys()].sort((a, b) => a - b);

  console.log('=== placeFamiliesInRow: тест на 35 супружеских парах самой большой компоненты ===');
  console.log('Всего пар (husband+wife оба в компоненте):', familiesOfComponent.length);
  console.log('Задействовано row:', sortedRows.join(', '));

  const placedPositions = {};
  for (const row of sortedRows) {
    placeFamiliesInRow(row, familiesByRow.get(row), placedPositions, IDX);
  }

  const placedCount = Object.keys(placedPositions).length;
  console.log('');
  console.log('Персон получили позиции:', placedCount);

  // дубли координат
  const byCoord = new Map();
  for (const [id, pos] of Object.entries(placedPositions)) {
    const key = pos.x + ',' + pos.y;
    if (!byCoord.has(key)) byCoord.set(key, []);
    byCoord.get(key).push(id);
  }
  const dupCoords = [...byCoord.entries()].filter(([, ids]) => ids.length > 1);
  console.log('Дублей координат:', dupCoords.length);
  dupCoords.forEach(([key, ids]) => console.log('  ' + key + ' -> ' + ids.join(', ')));

  // все 35 пар: разрыв
  console.log('');
  console.log('=== Все пары: муж, жена, разрыв (x_жены - x_мужа - CW) ===');
  const gapResults = [];
  for (const famId of familiesOfComponent) {
    const fam = IDX.families[famId];
    const hp = placedPositions[fam.husband];
    const wp = placedPositions[fam.wife];
    if (!hp || !wp) { console.log('  ' + famId + ': ' + fam.husband + '/' + fam.wife + ' — НЕ размещены'); continue; }
    const gap = (hp.y === wp.y) ? (wp.x - hp.x - CW) : null; // разные row — разрыв не определён
    gapResults.push({ famId, h: fam.husband, w: fam.wife, gap, sameRow: hp.y === wp.y });
  }
  gapResults.forEach(g => {
    console.log('  ' + g.famId + ': ' + g.h + ' ↔ ' + g.w + '  gap=' + (g.sameRow ? g.gap.toFixed(0) : 'РАЗНЫЕ ROW'));
  });

  const withGap = gapResults.filter(g => g.sameRow);
  const suspicious = withGap.filter(g => Math.abs(g.gap) > 300);
  console.log('');
  console.log('Пар с разрывом > 300 единиц:', suspicious.length, '(цель: 0)');
  suspicious.forEach(g => console.log('  ' + g.famId + ': ' + g.h + '↔' + g.w + ' gap=' + g.gap.toFixed(0)));

  // отдельно P246
  console.log('');
  console.log('=== P246: оба брака (F74, F77) ===');
  const p246 = placedPositions.P246;
  console.log('P246: x=' + (p246 ? p246.x.toFixed(0) : 'не размещён'));
  ['P247', 'P254'].forEach(id => {
    const p = placedPositions[id];
    if (p && p246) {
      console.log('  ' + id + ': x=' + p.x.toFixed(0) + ', разрыв от P246=' + (p.x - p246.x - CW).toFixed(0));
    } else {
      console.log('  ' + id + ': не размещён или P246 не размещён');
    }
  });
}
