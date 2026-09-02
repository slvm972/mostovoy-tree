// tree-print-layout2.js — новая раскладка для печати (v2), этап 1
// Изолированный модуль: не подключён ни к tree-print.js, ни к buildAndPrint().
// Содержит две чистые функции без побочных эффектов:
//   findConnectedComponents(IDX) — компоненты связности графа "персона-персона"
//   assignRows(IDX)              — прямое сопоставление personId → gen (row)

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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { findConnectedComponents, assignRows };
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
}