// node test-kinship.js [path-to-tree_a4a.html|tree-fallback.json]
// Берёт FALLBACK_DATA из html или JSON, прогоняет таблицу ожиданий и полный перебор пар.
const fs = require('fs');
const path = require('path');
const K = require('../public/tree-kinship.js');

const file = process.argv[2] || 'tree-fallback.json';
const raw = fs.readFileSync(file, 'utf8');
let idx;
if (file.endsWith('.json')) {
  idx = JSON.parse(raw);
} else {
  const m = raw.match(/FALLBACK_DATA\s*=\s*({[\s\S]*?});\n/);
  if (!m) {
    const fb = path.join(path.dirname(file), 'tree-fallback.json');
    if (fs.existsSync(fb)) {
      idx = JSON.parse(fs.readFileSync(fb, 'utf8'));
    } else {
      console.log('FALLBACK_DATA not found and no tree-fallback.json');
      process.exit(2);
    }
  } else {
    idx = JSON.parse(m[1]);
  }
}
const ids = Object.keys(idx.nodes);
const G = K.buildGraph(idx);   // граф строится один раз на весь перебор
const T0 = Date.now();

const T = [ // [A, B, lang, expected substring]
  ['P1','P3','ru','отец'], ['P4','P3','ru','дедушка'], ['P42','P3','ru','прадедушка'],
  ['P8','P3','ru','тётя'], ['P3','P8','ru','племянник'], ['P9','P3','ru','двоюродный брат'],
  ['P12','P3','ru','племянник'], ['P11','P3','ru','зять'], ['P28','P3','ru','дядя'],
  ['P6','P1','ru','дочь'], ['P2','P1','ru','жена'], ['P1','P2','ru','муж'],
  ['P3','P3','ru','один и тот же'], ['P66','P68','ru','единокровная сестра'],
  ['P68','P66','ru','единокровный брат'], ['P275','P68','ru','единоутробная сестра'],
  ['P275','P63','ru','падчерица'], ['P63','P275','ru','отчим'], ['P66','P275','ru','сводная сестра'],
  ['P93','P120','ru','бывшая жена'], ['P100','P3','ru','не найдено'],
  ['P9','P3','en','first cousin'], ['P1','P3','he','אבא'],
  // --- добавлено: свойство, пра-, боковые линии со сдвигом ---
  ['P24','P1','ru','тёща'],            // мать жены → муж
  ['P4','P2','ru','свёкор'],            // отец мужа → жена
  ['P18','P6','ru','свёкор'], ['P1','P11','ru','тесть'], ['P248','P6','ru','свекровь'],
  ['P306','P3','ru','прапрадедушка'], ['P3','P306','ru','праправнук'],   // 4 поколения
  ['P80','P3','ru','двоюродная бабушка'], ['P3','P80','ru','внучатый племянник'],
  ['P111','P3','ru','двоюродный дядя'], ['P3','P111','ru','двоюродный племянник'],
  ['P233','P3','ru','двоюродная тётя'], ['P3','P233','ru','двоюродный племянник'],
  ['P3','P28','ru','племянник'], ['P27','P1','ru','племянница'],
];
let fail = 0, skipped = 0; const failList = [];
for (const [a,b,l,exp] of T) {
  if (!idx.nodes[a] || !idx.nodes[b]) { skipped++; continue; }
  const r = K.computeKinship(idx, a, b, l);
  const ok = r.term.includes(exp);
  if (!ok) { fail++; failList.push('FAIL '+a+'->'+b+' '+JSON.stringify(r.term)+' (ждали '+exp+')'); }
  console.log((ok?'OK  ':'FAIL'), a, '->', b, l, '=', JSON.stringify(r.term), ok?'':'(ожидалось: '+exp+')');
}
const stats = {}; let thrown = 0, asym = 0, distant = 0;
const sym = {ancestor:'descendant',descendant:'ancestor',sibling:'sibling',cousin:'cousin',uncle:'nibling',nibling:'uncle'};
const res = {};
for (const a of ids) for (const b of ids) {
  try { res[a+'|'+b] = K.computeKinshipWithGraph(idx, G, a, b, 'ru'); } catch (e) { thrown++; console.log('THROW', a, b, e.message); }
}
for (const a of ids) for (const b of ids) {
  const r = res[a+'|'+b], q = res[b+'|'+a]; if (!r || !q) continue;
  stats[r.type] = (stats[r.type]||0)+1;
  if (r.found !== q.found) { asym++; failList.push('ASYM found '+a+'/'+b); if (asym<=8) console.log('ASYM found', a, b, r.term, '|', q.term); }
  else if ((r.type==='blood'||r.type==='affine') && (q.type==='blood'||q.type==='affine') && sym[r.kind] && (sym[r.kind]!==q.kind || r.a!==q.b || r.b!==q.a)) {
    asym++; failList.push('ASYM kind '+a+'/'+b); if (asym<=8) console.log('ASYM kind', a, b, r.term, '|', q.term);
  }
  if (r.term.startsWith('дальн')) distant++;
}
console.log('persons', ids.length, 'pairs', ids.length**2, 'stats', JSON.stringify(stats), 'thrown', thrown, 'asym', asym, 'distant', distant, 'skipped', skipped);
console.log('time_sec', ((Date.now()-T0)/1000).toFixed(2));
const total = fail + asym + thrown;
console.log(total ? 'FAILED ' + total + ': ' + (failList.length ? failList.slice(0,12).join('; ') : '') : 'ALL OK');
process.exit(total ? 1 : 0);



