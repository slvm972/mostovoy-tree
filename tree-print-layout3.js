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
//
// ── ИЗВЕСТНОЕ ОГРАНИЧЕНИЕ (принято как ожидаемое поведение, НЕ баг) ──
// Пары, у которых оба супруга — «корни» независимых, структурно не
// связанных до этого момента поддеревьев (то есть их родительские ветки
// впервые встречаются друг с другом только через собственный брак этой
// пары, а не раньше), могут получить большой горизонтальный разрыв между
// собой. Причина: к моменту, когда placeFamiliesInRow() обрабатывает их
// как пару, оба уже «владельцы» своих координат (получены как чьи-то дети
// в СВОИХ, географически далёких друг от друга родительских семьях), и
// оба поддерева — общие дети этой пары — имеют одинаковый «вес» (симметричный
// набор потомков). Программное сближение любой стороны потребовало бы
// каскадного пересчёта позиций уже размещённого поддерева — а это именно
// тот тип «архитектурного» фикса, который в четырёх предыдущих попытках
// (footprint-подход → occupiedByRow → курсоры → эта диагностика) каждый раз
// чинил один класс проблем и создавал регрессию в других, ранее корректно
// работающих парах. Решение: не пытаться сблизить такие пары программно —
// рисовать между ними честную (пусть и длинную) соединительную линию при
// отрисовке edges. На тестовой компоненте (130 персон) таких пар 4 из 40
// (10%): F1 (P1↔P2), F5 (P11↔P6), F2 (P4↔P7). Пятая пара с большим
// разрывом в том же тесте, F107/F109 (P310↔P174), — это ОТДЕЛЬНЫЙ случай,
// не архитектурная проблема, а дубль family-записи в самих данных
// (см. TODO_data_issues.md).

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
  for (const pos of Object.values(placedPositions)) {
    if (pos.y === y) newPairCursor = Math.max(newPairCursor, pos.x + CW + SIBLING_GAP);
  }
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

// ── placeChildrenOfFamiliesInRow ─────────────────────────────────────────
// row: номер row родителей (детей размещаем на row+1)
// familiesOfThisRow: тот же список famId, что передавался в placeFamiliesInRow
//   для этого row (полный список relevantFamilies этого row — включая
//   семьи с одним известным родителем и полностью безродительские семьи
//   с детьми — placeFamiliesInRow их сам молча игнорирует, здесь же они
//   как раз и обрабатываются)
// placedPositions: {personId: {x,y}} — мутируется этим вызовом
// IDX: полные данные дерева
//
// Принцип: childFootprint-стиль из getCenteredLayout (tree-layout.js,
// ~197-267) — НО только 1 уровень вперёд: ширина блока детей семьи —
// просто kids.length*CW + gaps, БЕЗ рекурсивного footprint под будущих
// внуков. Один общий проход "собрать все блоки → отсортировать по
// желаемому x → пройти слева направо, раздвигая коллизии через
// prevRight/SIBLING_GAP" — тот же паттерн, что уже в placeFamiliesInRow.
// Никакого отдельного реестра занятости.
function placeChildrenOfFamiliesInRow(row, familiesOfThisRow, placedPositions, IDX) {
  const childRow = row + 1;
  const y = childRow * LEVEL_H;

  function numKey(id) {
    if (!id) return Infinity;
    const m = String(id).match(/\d+/);
    return m ? parseInt(m[0], 10) : Infinity;
  }
  function familyNumKey(famId) {
    const fam = IDX.families[famId];
    return numKey(fam.husband || fam.wife || (fam.children && fam.children[0]) || famId);
  }

  const tasks = []; // {famId, x, width, kids, anchorNull}

  for (const famId of familiesOfThisRow) {
    const fam = IDX.families[famId];
    const h = fam.husband || null;
    const w = fam.wife || null;
    const kids = (fam.children || []).filter(cid => IDX.nodes[cid]);
    if (!kids.length) continue; // у семьи нет детей — размещать нечего

    const hPos = h ? placedPositions[h] : null;
    const wPos = w ? placedPositions[w] : null;

    let anchorX = null;
    let anchorNull = false;

    if (h && w) {
      // оба родителя известны — нужен хотя бы один размещённый, иначе
      // пропускаем эту семью в этом проходе (её очередь ещё не пришла)
      if (!hPos && !wPos) continue;
      anchorX = (hPos && wPos)
        ? (hPos.x + CW / 2 + wPos.x + CW / 2) / 2
        : (hPos || wPos).x + CW / 2;
    } else if (h || w) {
      // один известный родитель — берём его позицию, если он уже размещён
      const soloPos = hPos || wPos;
      if (!soloPos) continue; // единственный известный родитель ещё не размещён — пропускаем
      anchorX = soloPos.x + CW / 2;
    } else {
      // husband=null И wife=null — блок детей сам себе якорь
      anchorNull = true;
    }

    // Только 1 уровень вперёд: ширина блока = число детей этой семьи,
    // БЕЗ рекурсии на footprint внуков (childFootprint-стиль, но урезанный
    // до одного уровня по прямому указанию задания).
    const sortedKids = kids.slice().sort((a, b) => numKey(a) - numKey(b));
    const width = sortedKids.length * CW + (sortedKids.length - 1) * SIBLING_GAP;

    tasks.push({
      famId,
      anchorNull,
      x: anchorNull ? null : (anchorX - width / 2),
      width,
      kids: sortedKids
    });
  }

  // ── безродительские блоки — desired x через курсор, тот же наивный
  // приём, что newPairCursor в placeFamiliesInRow (начинается с 0, финальная
  // сортировка+развод коллизий сама расставит их относительно остальных) ──
  const selfAnchored = tasks.filter(t => t.anchorNull)
    .sort((a, b) => familyNumKey(a.famId) - familyNumKey(b.famId));
  let selfCursor = 0;
  for (const pos of Object.values(placedPositions)) {
    if (pos.y === y) selfCursor = Math.max(selfCursor, pos.x + CW + SIBLING_GAP);
  }
  for (const t of selfAnchored) {
    t.x = selfCursor;
    selfCursor += t.width + SIBLING_GAP;
  }

  // ── единый проход слева направо: сортировка по x, prevRight/SIBLING_GAP развод ──
  tasks.sort((a, b) => a.x - b.x);
  let prevRight = -Infinity;
  for (const task of tasks) {
    let finalStart = task.x;
    if (finalStart < prevRight + SIBLING_GAP) finalStart = prevRight + SIBLING_GAP;
    let cx = finalStart;
    for (const cid of task.kids) {
      // Ребёнок мог уже оказаться размещённым (напр. если тем же вызовом
      // ранее его "занял" другой блок из-за дублирующейся ссылки в данных) —
      // не перезаписываем, но остальных детей того же блока это не
      // затрагивает: курсор блока идёт дальше как обычно.
      if (!placedPositions[cid]) {
        placedPositions[cid] = { x: cx, y };
      }
      cx += CW + SIBLING_GAP;
    }
    prevRight = finalStart + task.width;
  }
}

// ── layoutComponentV3 ─────────────────────────────────────────────────────
// Раскладывает ОДНУ компоненту связности целиком: супруги (placeFamiliesInRow)
// + дети (placeChildrenOfFamiliesInRow), обрабатывая row по возрастанию.
// Отбор relevantFamilies и группировка familiesByRow — та же логика, что
// уже проверена в tree-print-layout2.js layoutComponent (для совместимости
// сигнатуры и поведения на семьях с одним/без родителей).
// Возвращает { positions, width, maxX } — та же форма, что старый layoutComponent.
function layoutComponentV3(IDX, componentPersonIds, rows, startX) {
  const componentSet = new Set(componentPersonIds);
  const placedPositions = {};

  // ── 1. Отбор семей, относящихся к этой компоненте (как в layoutComponent) ──
  const relevantFamilies = [];
  for (const [famId, fam] of Object.entries(IDX.families || {})) {
    const h = fam.husband || null;
    const w = fam.wife || null;
    const hInComp = h && componentSet.has(h);
    const wInComp = w && componentSet.has(w);
    const noParents = !h && !w;
    const hasChildInComp = (fam.children || []).some(cid => componentSet.has(cid));
    if (hInComp || wInComp || (noParents && hasChildInComp)) {
      relevantFamilies.push(famId);
    }
  }

  // ── 2. Группировка семей по row родителя (как в layoutComponent) ──
  const familiesByRow = new Map();
  for (const famId of relevantFamilies) {
    const fam = IDX.families[famId];
    let row;
    if (fam.husband && rows[fam.husband] !== undefined) row = rows[fam.husband];
    else if (fam.wife && rows[fam.wife] !== undefined) row = rows[fam.wife];
    else if (fam.children && fam.children.length && rows[fam.children[0]] !== undefined) {
      row = rows[fam.children[0]] - 1;
    } else {
      console.warn('[layoutComponentV3] Пропущена семья без определяемого row:', famId);
      continue;
    }
    if (!familiesByRow.has(row)) familiesByRow.set(row, []);
    familiesByRow.get(row).push(famId);
  }

  const sortedRows = [...familiesByRow.keys()].sort((a, b) => a - b);

  // ── 3. Обработка по row: сначала супруги, потом их дети ──
  for (const row of sortedRows) {
    const famIds = familiesByRow.get(row);
    placeFamiliesInRow(row, famIds, placedPositions, IDX);
    placeChildrenOfFamiliesInRow(row, famIds, placedPositions, IDX);
  }

  // ── 4. Доразмещение персон компоненты, оставшихся без позиции
  //    (изолированные внутри компоненты — напр. без релевантной семьи) ──
  function numKey(id) { const m = id && String(id).match(/\d+/); return m ? parseInt(m[0], 10) : Infinity; }
  const leftoverIds = componentPersonIds
    .filter(id => !placedPositions[id])
    .sort((a, b) => numKey(a) - numKey(b));
  for (const id of leftoverIds) {
    const row = (rows[id] !== undefined) ? rows[id] : (sortedRows.length ? sortedRows[sortedRows.length - 1] : 0);
    const y = row * LEVEL_H;
    let x = 0;
    for (const pos of Object.values(placedPositions)) {
      if (pos.y === y) x = Math.max(x, pos.x + CW + SIBLING_GAP);
    }
    placedPositions[id] = { x, y };
  }

  const allX = Object.values(placedPositions).map(p => p.x);
  const maxX = allX.length ? Math.max(...allX) + CW : startX;
  const width = maxX - startX;

  return { positions: placedPositions, width, maxX };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CW, CH, COUPLE_GAP, SIBLING_GAP, LEVEL_H,
    placeCouple, placeFamiliesInRow, placeChildrenOfFamiliesInRow, layoutComponentV3,
    findConnectedComponents, assignRows
  };
}

// ── тестовый блок ──────────────────────────────────────────────────────
if (typeof require !== 'undefined' && require.main === module) {
  const fs = require('fs');
  const path = require('path');
  const IDX = JSON.parse(fs.readFileSync(path.join(__dirname, 'tree-fallback.json'), 'utf8'));

  const rows = assignRows(IDX);
  const components = findConnectedComponents(IDX);
  const sortedBySize = [...components].sort((a, b) => b.length - a.length);

  function runComponentTest(component, label) {
    console.log('');
    console.log('══════════════════════════════════════════════════════════');
    console.log('=== layoutComponentV3: ' + label + ' (' + component.length + ' персон) ===');
    console.log('══════════════════════════════════════════════════════════');

    const result = layoutComponentV3(IDX, component, rows, 0);
    const placedIds = Object.keys(result.positions);
    console.log('Персон получили позиции:', placedIds.length, '(цель: ' + component.length + ' из ' + component.length + ')');

    // дубли координат
    const byCoord = new Map();
    for (const [id, pos] of Object.entries(result.positions)) {
      const key = pos.x + ',' + pos.y;
      if (!byCoord.has(key)) byCoord.set(key, []);
      byCoord.get(key).push(id);
    }
    const dupCoords = [...byCoord.entries()].filter(([, ids]) => ids.length > 1);
    console.log('Дублей координат:', dupCoords.length, '(цель: 0)');
    dupCoords.forEach(([key, ids]) => console.log('  ' + key + ' -> ' + ids.join(', ')));

    // все пары husband+wife одного row: разрыв
    const componentSet = new Set(component);
    const gaps = [];
    for (const [famId, fam] of Object.entries(IDX.families)) {
      const h = fam.husband, w = fam.wife;
      if (!h || !w) continue;
      if (!componentSet.has(h) || !componentSet.has(w)) continue;
      const hp = result.positions[h], wp = result.positions[w];
      if (!hp || !wp) { console.log('  ' + famId + ': ' + h + '/' + w + ' — НЕ размещены'); continue; }
      if (hp.y !== wp.y) { gaps.push({ famId, h, w, gap: null, sameRow: false }); continue; }
      gaps.push({ famId, h, w, gap: Math.abs(wp.x - hp.x) - CW, sameRow: true });
    }
    const sameRowGaps = gaps.filter(g => g.sameRow);
    console.log('');
    console.log('Пар husband+wife (обе в компоненте):', gaps.length, '— из них одного row:', sameRowGaps.length);
    const gapCounts = new Map();
    sameRowGaps.forEach(g => {
      const key = g.gap.toFixed(0);
      gapCounts.set(key, (gapCounts.get(key) || 0) + 1);
    });
    console.log('Распределение разрывов (gap → сколько пар):');
    [...gapCounts.entries()].sort((a, b) => +a[0] - +b[0]).forEach(([gap, cnt]) => console.log('  gap=' + gap + ': ' + cnt + ' пар'));

    const suspicious = sameRowGaps.filter(g => g.gap > 300).sort((a, b) => b.gap - a.gap);
    console.log('Пар с разрывом > 300 единиц:', suspicious.length, '(цель: 0 или единицы с понятным объяснением)');
    suspicious.forEach(g => console.log('  ' + g.famId + ': ' + g.h + '↔' + g.w + ' gap=' + g.gap.toFixed(0)));
    const diffRow = gaps.filter(g => !g.sameRow);
    if (diffRow.length) {
      console.log('Пар husband+wife на РАЗНЫХ row (gap не определён):', diffRow.length);
      diffRow.forEach(g => console.log('  ' + g.famId + ': ' + g.h + '↔' + g.w));
    }

    // P246 — оба брака (F74, F77) — только для компоненты, где он есть
    if (componentSet.has('P246')) {
      console.log('');
      console.log('=== P246: оба брака (F74/F77 → P247, F77 → P254) ===');
      const p246 = result.positions.P246;
      console.log('P246: x=' + (p246 ? p246.x.toFixed(0) : 'не размещён'));
      ['P247', 'P254'].forEach(id => {
        const p = result.positions[id];
        if (p && p246) {
          console.log('  ' + id + ': x=' + p.x.toFixed(0) + ', y=' + p.y + ', разрыв от P246=' +
            (p.y === p246.y ? (p.x - p246.x - CW).toFixed(0) : 'РАЗНЫЕ ROW'));
        } else {
          console.log('  ' + id + ': не размещён или P246 не размещён');
        }
      });
    }

    return { result, dupCoords, suspicious };
  }

  const biggest = sortedBySize[0];
  const second = sortedBySize[1];

  runComponentTest(biggest, 'самая большая компонента');
  runComponentTest(second, 'вторая по размеру компонента');
}
