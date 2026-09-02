// tree-print-layout2.js — новая раскладка для печати (v2)
// Изолированный модуль: не подключён ни к tree-print.js, ни к buildAndPrint().
// Содержит функции без побочных эффектов:
//   findConnectedComponents(IDX) — компоненты связности графа "персона-персона"
//   assignRows(IDX)              — прямое сопоставление personId → gen (row)
//   layoutComponent(...)         — раскладка одной компоненты связности (этап 2)

// ── константы раскладки (те же, что в getCenteredLayout, tree_a4a.html) ──
const CW = 150;
const CH = 100;
const COUPLE_GAP = 12;
const SIBLING_GAP = 22;
const LEVEL_H = 168;

// ── findConnectedComponents ─────────────────────────────────────────────
// Строит неориентированный граф:
//   рёбра: husband ↔ wife (если оба заданы в family)
//          husband или wife ↔ каждый ребёнок в family.children
// Возвращает массив компонент связности: [[personId,...], [personId,...], ...]
// Каждый personId из IDX.nodes встречается ровно в одной компоненте.
// Изолированная персона (без единой связи) — компонента из одного элемента.
function findConnectedComponents(IDX) {
  const nodeIds = Object.keys(IDX.nodes || {});
  const adjacency = new Map();
  for (const id of nodeIds) adjacency.set(id, new Set());

  function addEdge(a, b) {
    if (!a || !b) return;
    if (!adjacency.has(a) || !adjacency.has(b)) return; // защищаемся от битых ссылок на несуществующие id
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
      if (!husband && !wife) {
        // родителей нет вовсе — связать детей между собой как братьев/сестёр,
        // чтобы они хотя бы попали в одну компоненту друг с другом
        // (иначе они были бы искусственно раскиданы по разным компонентам)
        if (parentRef) addEdge(parentRef, childId);
      }
    }
    // если в семье несколько детей без родителей — связать их цепочкой
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
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    components.push(component);
  }

  return components;
}

// ── assignRows ───────────────────────────────────────────────────────────
// Прямое чтение gen с персоны, без обращения к family.
// Персоны без gen (undefined/null) в результат не попадают.
function assignRows(IDX) {
  const rows = {};
  for (const [id, node] of Object.entries(IDX.nodes || {})) {
    const gen = node && node.gen;
    if (gen === undefined || gen === null) continue;
    rows[id] = gen;
  }
  return rows;
}

// ── layoutComponent ──────────────────────────────────────────────────────
// Раскладывает ОДНУ компоненту связности (массив personId) в мировых
// координатах x/y. Единственный источник истины о позиции — placedPositions:
// как только персона туда попала, её x/y больше никогда не пересчитывается
// (это устраняет проблему "ребёнок vs супруг" из старого layoutFam()).
//
// Возвращает { positions: {personId:{x,y}}, width, maxX }.
function layoutComponent(IDX, componentPersonIds, rows, startX) {
  const componentSet = new Set(componentPersonIds);
  const placedPositions = {};
  // occupiedByRow: row -> [{start, end, id}] — все занятые горизонтальные
  // интервалы в данном row, используются для поиска свободного места вправо.
  const occupiedByRow = new Map();

  // ── 1. Отбор семей, относящихся к этой компоненте ──
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

  // ── numKey/familySortKey: детерминированная сортировка по числовой части id ──
  function numKey(id) {
    if (!id) return Infinity;
    const m = String(id).match(/\d+/);
    return m ? parseInt(m[0], 10) : Infinity;
  }
  function familySortKey(famId) {
    const fam = IDX.families[famId];
    const refId = fam.husband || fam.wife || (fam.children && fam.children[0]) || famId;
    return numKey(refId);
  }

  // ── 3. Группировка семей по row родителя ──
  const familiesByRow = new Map();
  for (const famId of relevantFamilies) {
    const fam = IDX.families[famId];
    let row;
    if (fam.husband && rows[fam.husband] !== undefined) row = rows[fam.husband];
    else if (fam.wife && rows[fam.wife] !== undefined) row = rows[fam.wife];
    else if (fam.children && fam.children.length && rows[fam.children[0]] !== undefined) {
      row = rows[fam.children[0]] - 1;
    } else {
      console.warn('[layoutComponent] Пропущена семья без определяемого row:', famId);
      continue;
    }
    if (!familiesByRow.has(row)) familiesByRow.set(row, []);
    familiesByRow.get(row).push(famId);
  }

  const sortedRows = [...familiesByRow.keys()].sort((a, b) => a - b);

  // ── helpers: поиск свободного места, фиксация позиции ──
  function findFreeX(row, desiredX, width) {
    let x = desiredX;
    const intervals = occupiedByRow.get(row) || [];
    let moved = true;
    let guard = 0;
    while (moved && guard < 10000) {
      moved = false;
      guard++;
      for (const iv of intervals) {
        if (x < iv.end && iv.start < x + width) {
          x = iv.end + SIBLING_GAP;
          moved = true;
        }
      }
    }
    return x;
  }

  function place(id, x, row) {
    if (placedPositions[id]) return placedPositions[id]; // уже зафиксирован — не трогаем
    const y = row * LEVEL_H;
    placedPositions[id] = { x, y };
    if (!occupiedByRow.has(row)) occupiedByRow.set(row, []);
    occupiedByRow.get(row).push({ start: x, end: x + CW, id });
    return placedPositions[id];
  }

  function rowRightEdge(row) {
    const intervals = occupiedByRow.get(row) || [];
    if (!intervals.length) return startX;
    return Math.max(...intervals.map(iv => iv.end)) + SIBLING_GAP;
  }

  // ── 4-6. Обработка по row (от старших поколений к младшим) ──
  for (const row of sortedRows) {
    const famIds = familiesByRow.get(row).slice().sort((a, b) => familySortKey(a) - familySortKey(b));

    for (const famId of famIds) {
      const fam = IDX.families[famId];
      const h = fam.husband || null;
      const w = fam.wife || null;
      const hPlaced = h ? placedPositions[h] : null;
      const wPlaced = w ? placedPositions[w] : null;

      let hPos = null, wPos = null;

      if (h && w) {
        if (hPlaced && wPlaced) {
          // оба уже на месте (пара уже была создана ранее, напр. через
          // проход по детям) — не пересчитываем
          hPos = hPlaced; wPos = wPlaced;
        } else if (hPlaced && !wPlaced) {
          const desired = hPlaced.x + CW + COUPLE_GAP;
          const x = findFreeX(row, desired, CW);
          wPos = place(w, x, row);
          hPos = hPlaced;
        } else if (!hPlaced && wPlaced) {
          const desired = wPlaced.x - CW - COUPLE_GAP;
          // не уходим самопроизвольно далеко влево — ищем свободное место
          // вправо от предпочтительного (правило задания: сдвигаем вправо
          // при коллизии, не трогая чужие уже зафиксированные координаты)
          const x = findFreeX(row, Math.max(desired, startX), CW);
          hPos = place(h, x, row);
          wPos = wPlaced;
        } else {
          // ни один не размещён — новая пара (husband слева, wife справа)
          const pairWidth = CW * 2 + COUPLE_GAP;
          const x = findFreeX(row, rowRightEdge(row), pairWidth);
          hPos = place(h, x, row);
          wPos = place(w, x + CW + COUPLE_GAP, row);
        }
      } else {
        // семья с одним известным родителем (husband=null ИЛИ wife=null)
        const soloId = h || w;
        if (soloId) {
          if (placedPositions[soloId]) {
            hPos = wPos = placedPositions[soloId];
          } else {
            const x = findFreeX(row, rowRightEdge(row), CW);
            hPos = wPos = place(soloId, x, row);
          }
        }
        // если оба husband и wife null — hPos/wPos остаются null,
        // дети (если есть) разместятся ниже как самостоятельный блок
      }

      // ── дети семьи → row+1, центрированы под серединой родителей ──
      const kids = (fam.children || []).filter(cid => componentSet.has(cid));
      if (!kids.length) continue;

      const childRow = row + 1;
      let anchorX;
      if (hPos && wPos) {
        anchorX = (hPos.x + CW / 2 + wPos.x + CW / 2) / 2;
      } else if (hPos || wPos) {
        anchorX = (hPos || wPos).x + CW / 2;
      } else {
        anchorX = null; // полностью безродительская семья — блок детей сам себе якорь
      }

      const unplacedKids = kids.filter(cid => !placedPositions[cid]);
      if (unplacedKids.length) {
        const totalW = unplacedKids.length * CW + (unplacedKids.length - 1) * SIBLING_GAP;
        const desiredStart = (anchorX !== null) ? (anchorX - totalW / 2) : rowRightEdge(childRow);
        let cx = findFreeX(childRow, desiredStart, totalW);
        for (const cid of unplacedKids) {
          place(cid, cx, childRow);
          cx += CW + SIBLING_GAP;
        }
      }
      // уже размещённые дети (сами оказались чьими-то родителями и были
      // обработаны раньше в BFS/row-порядке) — не трогаем, по правилу
    }
  }

  // ── 7. Проверка полноты + доразмещение "осиротевших" (без релевантной семьи) ──
  for (const id of componentPersonIds) {
    if (placedPositions[id]) continue;
    const row = (rows[id] !== undefined) ? rows[id] : (sortedRows.length ? sortedRows[sortedRows.length - 1] : 0);
    const x = findFreeX(row, rowRightEdge(row), CW);
    place(id, x, row);
  }

  const allX = Object.values(placedPositions).map(p => p.x);
  const maxX = allX.length ? Math.max(...allX) + CW : startX;
  const width = maxX - startX;

  return { positions: placedPositions, width, maxX };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { findConnectedComponents, assignRows, layoutComponent };
}

// ── тестовый блок ──────────────────────────────────────────────────────
if (typeof require !== 'undefined' && require.main === module) {
  const fs = require('fs');
  const path = require('path');
  const IDX = JSON.parse(fs.readFileSync(path.join(__dirname, 'tree-fallback.json'), 'utf8'));

  const components = findConnectedComponents(IDX);
  const rows = assignRows(IDX);

  const totalPersons = Object.keys(IDX.nodes).length;
  const sumComponentSizes = components.reduce((s, c) => s + c.length, 0);

  const sortedBySize = [...components].sort((a, b) => b.length - a.length);

  console.log('Количество компонент связности:', components.length);
  console.log('Размеры первых 10 компонент (по убыванию):');
  sortedBySize.slice(0, 10).forEach((c, i) => {
    console.log('  #' + (i + 1) + ': ' + c.length + ' персон');
  });
  console.log('Суммарно персон во всех компонентах:', sumComponentSizes, '(должно быть ' + totalPersons + ')');

  const rowsCount = Object.keys(rows).length;
  const missingGenCount = totalPersons - rowsCount;
  const genValues = Object.values(rows);
  const uniqueGenValues = [...new Set(genValues)].sort((a, b) => a - b);

  console.log('Персон без gen (пропущены в assignRows):', missingGenCount);
  console.log('Количество уникальных значений row (gen):', uniqueGenValues.length);
  console.log('Диапазон gen: min=' + Math.min(...genValues) + ', max=' + Math.max(...genValues));

  // ── тест layoutComponent на самой большой компоненте ──
  console.log('');
  console.log('=== layoutComponent: самая большая компонента ===');
  const biggest = sortedBySize[0];
  console.log('Размер самой большой компоненты:', biggest.length);

  const result = layoutComponent(IDX, biggest, rows, 0);
  const placedIds = Object.keys(result.positions);
  console.log('Персон получили позиции:', placedIds.length, '(должно быть ' + biggest.length + ')');

  // поиск дублей координат (два разных id с одинаковыми x И y)
  const byCoord = new Map();
  for (const [id, pos] of Object.entries(result.positions)) {
    const key = pos.x + ',' + pos.y;
    if (!byCoord.has(key)) byCoord.set(key, []);
    byCoord.get(key).push(id);
  }
  const dupCoords = [...byCoord.entries()].filter(([, ids]) => ids.length > 1);
  console.log('Дублей координат (2+ разных id на одном x,y):', dupCoords.length);
  dupCoords.forEach(([key, ids]) => console.log('  ' + key + ' -> ' + ids.join(', ')));

  // P246 и его две семьи (F74/F77) — раньше накладывались друг на друга
  console.log('');
  console.log('Координаты P246 и связанных с ним персон (2 брака, F74/F77):');
  ['P246', 'P247', 'P254', 'P255', 'P256', 'P257', 'P258'].forEach(id => {
    if (biggest.includes(id)) {
      const p = result.positions[id];
      console.log('  ' + id + ' (' + (IDX.nodes[id] && IDX.nodes[id].name) + '): x=' + p.x + ', y=' + p.y);
    } else {
      console.log('  ' + id + ': НЕ входит в эту компоненту');
    }
  });

  const p247 = result.positions.P247;
  const p254 = result.positions.P254;
  if (p247 && p254) {
    const same = p247.x === p254.x && p247.y === p254.y;
    console.log('P247 и P254 на одинаковых координатах?', same ? 'ДА (проблема сохранилась!)' : 'НЕТ (устранено)');
  }
}