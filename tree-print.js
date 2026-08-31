// tree-print.js — логика печати дерева на большом листе (A0/A1/A2)
// Вынесено из tree_a4a.html для уменьшения размера основного файла
// ════════════════════════════════════════════════════════
//  PRINT — full tree on A1/A0/A2
// ════════════════════════════════════════════════════════

// Paper sizes in mm (landscape)
const PAPER = {
  A0L: { w: 1189, h: 841, label: 'A0 альбом' },
  A1L: { w: 841,  h: 594, label: 'A1 альбом' },
  A2L: { w: 594,  h: 420, label: 'A2 альбом' },
};
let printFmt = 'A1L';

// tree-print.js подключается через <script src> в <head> и выполняется
// ДО парсинга <body> — на этот момент кнопок печати ещё нет в DOM.
// Регистрацию обработчиков откладываем до готовности DOM.
document.addEventListener('DOMContentLoaded', () => {
  // Format selector
  document.querySelectorAll('.print-opt').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.print-opt').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      printFmt = btn.dataset.fmt;
    });
  });

  // ── Open print dialog ───────────────────────────────────
  document.getElementById('btn-print').addEventListener('click', () => {
    if(!IDX){ showToast('Данные не загружены', true); return; }
    const n = Object.keys(IDX.nodes).length;
    const f = Object.keys(IDX.families).length;
    const stats = document.getElementById('print-stats');
    stats.style.color = '';
    stats.style.fontWeight = '';
    stats.textContent = `В дереве: ${n} персон, ${f} семей`;
    document.getElementById('print-overlay').classList.add('open');
  });
  document.getElementById('print-cancel').addEventListener('click', () => {
    document.getElementById('print-overlay').classList.remove('open');
  });

  // Build full tree SVG and print
  document.getElementById('print-go').addEventListener('click', () => {
    document.getElementById('print-overlay').classList.remove('open');
    setTimeout(buildAndPrint, 80);
  });
});

function buildAndPrint() {
  // ── Card and gap sizes for print ──────────────────────
  const PCW = 170, PCH = 110, PGAPX = 24, PGAPY = 100;
  const PCOUP = 14;  // gap between couple cards

  // ── 1. Family-tree BFS layout ─────────────────────────
  // Start from gen=0 roots, lay out families top-down
  // preserving actual parent→child structure from IDX

  const pos = {};      // id → {x, y}
  const placed = new Set();

  // Find all gen=0 nodes as roots
  const minGen = Math.min(...Object.values(IDX.nodes).map(n => n.gen ?? 0));
  const roots = Object.keys(IDX.nodes).filter(id => (IDX.nodes[id].gen ?? 0) === minGen);

  // BFS: process families level by level
  // Level-by-level: collect families per generation level
  const famsByLevel = {};  // level → [famId]
  for (const [famId, fam] of Object.entries(IDX.families)) {
    // Determine level from husband or wife gen
    let refId = fam.husband || fam.wife;
    if (!refId && fam.children.length > 0) refId = fam.children[0];
    if (!refId) continue;
    const g = IDX.nodes[refId]?.gen ?? 0;
    if (!famsByLevel[g]) famsByLevel[g] = [];
    famsByLevel[g].push(famId);
  }

  const levels = Object.keys(famsByLevel).map(Number).sort((a,b)=>a-b);

  // Pass 1: count children per family to allocate horizontal space
  function subtreeWidth(famId, level) {
    const fam = IDX.families[famId];
    if (!fam || !fam.children.length) return PCW * 2 + PCOUP;
    // sum child subtrees
    let total = 0;
    for (const cid of fam.children) {
      const childFams = (IDX.parent_in[cid] || []);
      if (childFams.length) {
        for (const cf of childFams) total += subtreeWidth(cf, level + 1) + PGAPX;
        total -= PGAPX;
      } else {
        total += PCW + PGAPX;
      }
    }
    total -= PGAPX;
    return Math.max(total, PCW * 2 + PCOUP);
  }

  // Pass 2: layout top-down
  // Find root families (gen = minGen)
  const rootFams = famsByLevel[minGen] || [];
  let curX = 0;
  const famPos = {};  // famId → centerX

  function layoutFam(famId, centerX, level) {
    const fam = IDX.families[famId];
    if (!fam) return;
    const y = (level - minGen) * (PCH + PGAPY);

    // Place parents
    const members = [fam.husband, fam.wife].filter(Boolean);
    const pw = members.length * PCW + (members.length - 1) * PCOUP;
    let px = centerX - pw / 2;
    for (const id of members) {
      if (!placed.has(id)) {
        pos[id] = { x: px, y };
        placed.add(id);
      }
      px += PCW + PCOUP;
    }
    famPos[famId] = centerX;

    // Layout children
    if (!fam.children.length) return;
    const children = [...fam.children].sort((a,b) =>
      (IDX.nodes[a]?.birth||'').localeCompare(IDX.nodes[b]?.birth||''));

    // Compute total width needed for children
    const childWidths = children.map(cid => {
      const childFams = (IDX.parent_in[cid] || []);
      if (childFams.length) {
        return childFams.reduce((s, cf) => s + subtreeWidth(cf, level+1) + PGAPX, -PGAPX);
      }
      return PCW;
    });
    const totalChildW = childWidths.reduce((s,w) => s + w + PGAPX, -PGAPX);
    let cx = centerX - totalChildW / 2;
    const childLevel = level + 1;

    for (let i = 0; i < children.length; i++) {
      const cid = children[i];
      const cw = childWidths[i];
      const childCenter = cx + cw / 2;

      if (!placed.has(cid)) {
        pos[cid] = { x: childCenter - PCW/2, y: (childLevel - minGen) * (PCH + PGAPY) };
        placed.add(cid);
      }

      // Recurse into child's own families
      const childFams = (IDX.parent_in[cid] || []);
      for (const cf of childFams) {
        layoutFam(cf, childCenter, childLevel);
      }

      cx += cw + PGAPX;
    }
  }

  // Layout root families side by side
  for (const famId of rootFams) {
    const fam = IDX.families[famId];
    const isParentless = !fam.husband && !fam.wife;
    const layoutLevel = isParentless ? minGen - 1 : minGen;
    const w = subtreeWidth(famId, layoutLevel);
    layoutFam(famId, curX + w/2, layoutLevel);
    curX += w + PGAPX * 2;
  }

  // Place any remaining unplaced nodes (orphans, single roots)
  for (const [id, n] of Object.entries(IDX.nodes)) {
    if (!placed.has(id)) {
      const y = ((n.gen ?? 0) - minGen) * (PCH + PGAPY);
      pos[id] = { x: curX, y };
      curX += PCW + PGAPX;
    }
  }

  // ── 2. Compute bounding box ────────────────────────────
  const allX = Object.values(pos).map(p => p.x);
  const allY = Object.values(pos).map(p => p.y);
  const minX = Math.min(...allX) - 30;
  const minY = Math.min(...allY) - 60;
  const maxX = Math.max(...allX) + PCW + 30;
  const maxY = Math.max(...allY) + PCH + 30;
  const treeW = maxX - minX;
  const treeH = maxY - minY;

  // ── 3. Scale to paper ─────────────────────────────────
  const paper = PAPER[printFmt];
  const pageSize = printFmt === 'A0L' ? 'A0' : printFmt === 'A2L' ? 'A2' : 'A1';
  const MM2PX = 3.7795;
  const printW = paper.w * MM2PX;
  const printH = paper.h * MM2PX;
  const MARGIN = 40;
  const titleH = 55;
  const scaleX = (printW - MARGIN*2) / treeW;
  const scaleY = (printH - MARGIN*2 - titleH) / treeH;

  // ══════════════════════════════════════════════════════
  //  Построчное (по gen) масштабирование КАРТОЧЕК: плотная
  //  упаковка внутри ряда вместо унаследованной мировой
  //  ширины поддерева. Линии (edges) ниже по-прежнему
  //  используют старые pos[id] / scaleX,scaleY.
  // ══════════════════════════════════════════════════════
  const BASE_GAP = 40;
  const baseScale = Math.min(scaleX, scaleY);

  const rowsMap = {};
  for (const id of Object.keys(pos)) {
    const g = IDX.nodes[id]?.gen ?? 0;
    if (!rowsMap[g]) rowsMap[g] = [];
    rowsMap[g].push(id);
  }
  const rowGens = Object.keys(rowsMap).map(Number).sort((a,b)=>a-b);

  const GAP_COMPRESSION = 0.2; // доля исходного мирового зазора, которая сохраняется
  const rows = rowGens.map(g => {
    const ids = rowsMap[g].slice().sort((a,b) => pos[a].x - pos[b].x);
    const count = ids.length;

    const gaps = [];
    for (let i = 1; i < ids.length; i++) {
      const prevRight = pos[ids[i-1]].x + PCW;
      const worldGap = Math.max(0, pos[ids[i]].x - prevRight);
      gaps.push(PGAPX + worldGap * GAP_COMPRESSION);
    }

    const requiredWidth = count * PCW + gaps.reduce((s,g) => s+g, 0);
    let rowScale = (printW - MARGIN*2) / requiredWidth;
    rowScale = Math.min(rowScale, baseScale * 4); // защита от раздутых карточек в мелких рядах

    const localX = {};
    let cursorX = 0;
    ids.forEach((id, i) => {
      if (i > 0) cursorX += gaps[i-1];
      localX[id] = cursorX;
      cursorX += PCW;
    });

    return { gen: g, ids, requiredWidth, localX, rowScale };
  });

  for (const r of rows) r.rowHeight = PCH * r.rowScale;

  let totalStackHeight = rows.reduce((s,r) => s + r.rowHeight, 0) + (rows.length - 1) * BASE_GAP;
  const availableHeight = printH - MARGIN*2 - titleH;

  let gapUsed;
  if (totalStackHeight > availableHeight) {
    const shrinkFactor = availableHeight / totalStackHeight;
    for (const r of rows) { r.rowScale *= shrinkFactor; r.rowHeight *= shrinkFactor; }
    gapUsed = BASE_GAP;
  } else {
    const leftover = availableHeight - totalStackHeight;
    const extraGapPerGap = rows.length > 1 ? leftover / (rows.length - 1) : 0;
    gapUsed = BASE_GAP + extraGapPerGap;
  }

  let curY = titleH + MARGIN;
  for (const r of rows) {
    r.pageY = curY;
    r.rowTranslateX = MARGIN + (printW - MARGIN*2 - r.requiredWidth * r.rowScale) / 2;
    r.rowTranslateY = r.pageY;
    curY += r.rowHeight + gapUsed;
  }

  // ── Финальная абсолютная карта позиций (для C2, edges пока не трогаем) ──
  const finalPos = {};
  for (const r of rows) {
    for (const id of r.ids) {
      const cardTop = r.rowTranslateY;
      const cardLeft = r.rowTranslateX + r.localX[id] * r.rowScale;
      finalPos[id] = {
        x: cardLeft + (PCW * r.rowScale) / 2,      // горизонтальный центр карточки
        top: cardTop,                                // верхний край
        bottom: cardTop + PCH * r.rowScale,           // нижний край
        cy: cardTop + (PCH * r.rowScale) / 2,         // вертикальный центр
        scale: r.rowScale                             // масштаб этого ряда (пригодится в C2)
      };
    }
  }

  // ── 4. Build SVG ───────────────────────────────────────
  const SEX_FILL = { M:'#1E4870', F:'#701838' };
  const today = new Date().toLocaleDateString('ru-RU');
  const title = '🌳 Мостовые · Журахинские · Лейцис';

  let edges = '';
  const parentStroke = 'stroke="#C09828" stroke-width="1.5" opacity="0.6"';
  const spouseStroke = 'stroke="#C09828" stroke-width="1" stroke-dasharray="3,3" opacity="0.6"';

  // Draw edges
  const normalFams = [];
  for (const [, fam] of Object.entries(IDX.families)) {
    if (!fam.husband && !fam.wife && fam.children.length > 0) {
      const visCh = fam.children.filter(id => finalPos[id]);
      if (visCh.length > 1) {
        const cxs = visCh.map(id => finalPos[id].x);
        const minCX = Math.min(...cxs), maxCX = Math.max(...cxs);
        const childTop = finalPos[visCh[0]].top;
        const bracketY = childTop - gapUsed / 2;
        edges += `<line x1="${minCX}" y1="${bracketY}" x2="${maxCX}" y2="${bracketY}" ${parentStroke}/>`;
        for (const cid of visCh) {
          edges += `<line x1="${finalPos[cid].x}" y1="${bracketY}" x2="${finalPos[cid].x}" y2="${finalPos[cid].top}" ${parentStroke}/>`;
        }
      }
      continue;
    }
    const pars = [fam.husband, fam.wife].filter(id => id && finalPos[id]);
    if (!pars.length || !fam.children.length) continue;
    const visCh = fam.children.filter(id => finalPos[id]);
    if (!visCh.length) continue;

    const parMidX = pars.reduce((s,id) => s + finalPos[id].x, 0) / pars.length;
    const parY    = finalPos[pars[0]].bottom;
    const cxs   = visCh.map(id => finalPos[id].x);
    const minCX = Math.min(...cxs), maxCX = Math.max(...cxs);
    const childTop = finalPos[visCh[0]].top;

    const footprintMin = Math.min(parMidX, minCX);
    const footprintMax = Math.max(parMidX, maxCX);

    if (parY >= childTop) continue; // повреждённые данные (gen ребёнка <= gen родителя) — пропускаем линию, не рисуем сломанную
    normalFams.push({ pars, parMidX, parY, visCh, minCX, maxCX, childTop, footprintMin, footprintMax });
  }

  const byGap = {};
  for (const f of normalFams) {
    const key = f.parY + '|' + f.childTop;
    if (!byGap[key]) byGap[key] = [];
    byGap[key].push(f);
  }

  const LANE_MARGIN = 0.15;
  const LANE_GAP_PX = 6;
  for (const key of Object.keys(byGap)) {
    const group = byGap[key].slice().sort((a,b) => a.footprintMin - b.footprintMin);
    const laneEnds = [];
    for (const f of group) {
      let laneIdx = laneEnds.findIndex(end => end + LANE_GAP_PX < f.footprintMin);
      if (laneIdx === -1) { laneIdx = laneEnds.length; laneEnds.push(f.footprintMax); }
      else { laneEnds[laneIdx] = f.footprintMax; }
      f.lane = laneIdx;
    }
    const numLanes = laneEnds.length;
    const { parY, childTop } = group[0];
    const gapSpan = childTop - parY;
    for (const f of group) {
      const t = numLanes > 1
        ? LANE_MARGIN + (f.lane / (numLanes - 1)) * (1 - 2*LANE_MARGIN)
        : 0.5;
      f.midY = parY + gapSpan * t;
    }
    console.log('[E1] gap ' + key + ' → ' + group.length + ' families, ' + numLanes + ' lanes');
  }

  for (const f of normalFams) {
    const { pars, parMidX, parY, visCh, minCX, maxCX, midY } = f;
    edges += `<line x1="${parMidX}" y1="${parY}" x2="${parMidX}" y2="${midY}" ${parentStroke}/>`;
    if (visCh.length > 1) edges += `<line x1="${minCX}" y1="${midY}" x2="${maxCX}" y2="${midY}" ${parentStroke}/>`;
    if (parMidX < minCX) edges += `<line x1="${parMidX}" y1="${midY}" x2="${minCX}" y2="${midY}" ${parentStroke}/>`;
    if (parMidX > maxCX) edges += `<line x1="${maxCX}" y1="${midY}" x2="${parMidX}" y2="${midY}" ${parentStroke}/>`;
    for (const cid of visCh) {
      edges += `<line x1="${finalPos[cid].x}" y1="${midY}" x2="${finalPos[cid].x}" y2="${finalPos[cid].top}" ${parentStroke}/>`;
    }

    // Couple connector — пунктир + ♥, визуально отличается от сплошной
    // линии родитель→ребёнок
    if (pars.length === 2) {
      const p0 = finalPos[pars[0]], p1 = finalPos[pars[1]];
      const halfW = (PCW * p0.scale) / 2;
      const lx = Math.min(p0.x, p1.x) + halfW;
      const rx = Math.max(p0.x, p1.x) - halfW;
      const cy = p0.cy;
      if (rx > lx) {
        edges += `<line x1="${lx}" y1="${cy}" x2="${rx}" y2="${cy}" ${spouseStroke}/>`;
        edges += `<text x="${(lx+rx)/2}" y="${cy+4}" font-family="Segoe UI,Arial,sans-serif" font-size="10" fill="#C09828" text-anchor="middle">♥</text>`;
      }
    }
  }

  // Draw cards — по рядам (каждый ряд в своей <g> со своим
  // translate+scale, плотно упакован по PCW/PGAPX)
  let cardsHTML = '';
  for (const r of rows) {
    let rowCards = '';
    for (const id of r.ids) {
      const n = IDX.nodes[id];
      const x = r.localX[id];
      const y = 0;
      const dead = !!(n.death && n.death !== '' && n.death !== 'ум.');
      const fill = dead ? '#3A4A55' : (SEX_FILL[n.sex] || '#444');
      const name = pname(id);
      const parts = name.split(' ');
      const mid = Math.ceil(parts.length / 2);
      const l1 = parts.slice(0, mid).join(' ');
      const l2 = parts.slice(mid).join(' ');
      const by = n.birth ? (n.birth.match(/\d{4}/)||[''])[0] : '';
      const dy = dead ? (n.death.match(/\d{4}/)||[''])[0] : '';
      const bhe = n.birth_he || '';
      const dhe = n.death_he || '';

      rowCards += `<rect x="${x}" y="${y}" width="${PCW}" height="${PCH}" rx="6"
        fill="${fill}" stroke="rgba(237,216,144,.35)" stroke-width="1.2"
        stroke-dasharray="${dead ? '5,3' : 'none'}"/>
      <rect x="${x}" y="${y}" width="${PCW}" height="5" rx="6" fill="rgba(237,216,144,.4)"/>
      ${n.sex === 'M' ? `<text x="${x+PCW-12}" y="${y+16}" font-family="Segoe UI,Arial,sans-serif" fill="rgba(237,216,144,.85)" font-size="11" font-weight="700" text-anchor="middle">♂</text>` : n.sex === 'F' ? `<text x="${x+PCW-12}" y="${y+16}" font-family="Segoe UI,Arial,sans-serif" fill="rgba(237,216,144,.85)" font-size="11" font-weight="700" text-anchor="middle">♀</text>` : ''}
      <text font-family="Segoe UI,Arial,sans-serif" fill="#EDD890" font-size="10" font-weight="700" text-anchor="middle">
        <tspan x="${x+PCW/2}" y="${y+32}">${l1}</tspan>
        ${l2 ? `<tspan x="${x+PCW/2}" dy="14">${l2}</tspan>` : ''}
      </text>`;
      let dateY = y + (l2 ? 68 : 58);
      if (by) { rowCards += `<text x="${x+PCW/2}" y="${dateY}" font-family="Segoe UI,Arial,sans-serif" fill="rgba(237,216,144,.7)" font-size="8.5" text-anchor="middle">р. ${by}${dy ? '  † '+dy : ''}</text>`; dateY += 13; }
      else if (dy) { rowCards += `<text x="${x+PCW/2}" y="${dateY}" font-family="Segoe UI,Arial,sans-serif" fill="rgba(237,216,144,.5)" font-size="8.5" text-anchor="middle">† ${dy}</text>`; dateY += 13; }
      if (bhe || dhe) {
        const heStr = [bhe, dhe ? '† '+dhe : ''].filter(Boolean).join('  ');
        rowCards += `<text x="${x+PCW/2}" y="${y+PCH-7}" font-family="Segoe UI,Arial,sans-serif" fill="rgba(237,216,144,.5)" font-size="7.5" text-anchor="middle" direction="rtl">${heStr}</text>`;
      }
    }
    cardsHTML += `<g transform="translate(${r.rowTranslateX},${r.rowTranslateY}) scale(${r.rowScale})">${rowCards}</g>`;
  }

  const svgBody = `
  <text x="${printW/2}" y="30" font-family="Segoe UI,Arial,sans-serif" font-size="20" font-weight="700" fill="#28180A" text-anchor="middle">${title}</text>
  <text x="${printW/2}" y="50" font-family="Segoe UI,Arial,sans-serif" font-size="11" fill="#888" text-anchor="middle">${today} · ${Object.keys(IDX.nodes).length} персон</text>
  ${edges}
  ${cardsHTML}`;

  // ── 5. Build full HTML and download ───────────────────
  const fullHTML = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<title>Семейное дерево — ${pageSize}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;overflow:hidden;background:#FAF7F0;font-family:Segoe UI,Arial,sans-serif}
#toolbar{position:fixed;top:0;left:0;right:0;height:36px;background:#1C1208;display:flex;
  align-items:center;gap:8px;padding:0 12px;z-index:10;color:#EDD890;font-size:13px}
#toolbar button{background:rgba(237,216,144,.15);border:1px solid rgba(237,216,144,.35);
  color:#EDD890;padding:3px 10px;border-radius:3px;cursor:pointer;font-size:12px}
#toolbar button:hover{background:rgba(237,216,144,.3)}
#hint{margin-left:auto;font-size:11px;opacity:.55}
#canvas{position:fixed;top:36px;left:0;right:0;bottom:0;overflow:hidden;cursor:grab}
#canvas.grabbing{cursor:grabbing}
#svg-wrap{transform-origin:0 0;will-change:transform}
@media print{
  #toolbar{display:none!important}
  #canvas{position:static;overflow:visible}
  #svg-wrap{transform:none!important}
  svg{width:100vw;height:100vh}
  @page{size:${pageSize} landscape;margin:4mm}
}
</style></head>
<body>
<div id="toolbar">
  🌳 Семейное дерево — ${pageSize}
  <button onclick="resetZoom()">⊡ Вписать</button>
  <button onclick="zoomIn()">＋</button>
  <button onclick="zoomOut()">－</button>
  <button onclick="window.print()" style="background:rgba(237,216,144,.3);font-weight:600">🖨 Печать / PDF</button>
  <span id="hint">Колесо мыши — масштаб · Тяни — перемещение</span>
</div>
<div id="canvas">
  <div id="svg-wrap">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${printW} ${printH}"
         width="${printW}" height="${printH}">
      <rect width="${printW}" height="${printH}" fill="#FAF7F0"/>
      ${svgBody}
    </svg>
  </div>
</div>
<script>
var wrap = document.getElementById('svg-wrap');
var canvas = document.getElementById('canvas');
var scale = 1, tx = 0, ty = 0;
var dragging = false, lastX = 0, lastY = 0;

function applyTransform(){
  wrap.style.transform = 'translate('+tx+'px,'+ty+'px) scale('+scale+')';
}

function resetZoom(){
  var cw = canvas.clientWidth, ch = canvas.clientHeight;
  var sw = ${printW}, sh = ${printH};
  scale = Math.min(cw/sw, ch/sh) * 0.96;
  tx = (cw - sw*scale)/2;
  ty = (ch - sh*scale)/2;
  applyTransform();
}

function zoomIn(){ scale=Math.min(scale*1.25,8); applyTransform(); }
function zoomOut(){ scale=Math.max(scale*0.8,0.05); applyTransform(); }

canvas.addEventListener('wheel', function(e){
  e.preventDefault();
  var rect = canvas.getBoundingClientRect();
  var mx = e.clientX - rect.left, my = e.clientY - rect.top;
  var delta = e.deltaY < 0 ? 1.12 : 0.89;
  tx = mx - (mx-tx)*delta;
  ty = my - (my-ty)*delta;
  scale *= delta;
  applyTransform();
}, {passive:false});

canvas.addEventListener('mousedown', function(e){
  dragging=true; lastX=e.clientX; lastY=e.clientY;
  canvas.classList.add('grabbing');
});
window.addEventListener('mousemove', function(e){
  if(!dragging) return;
  tx+=e.clientX-lastX; ty+=e.clientY-lastY;
  lastX=e.clientX; lastY=e.clientY;
  applyTransform();
});
window.addEventListener('mouseup', function(){
  dragging=false; canvas.classList.remove('grabbing');
});

// Touch support
var lastDist=0, lastTx=0, lastTy=0;
canvas.addEventListener('touchstart', function(e){
  if(e.touches.length===1){dragging=true;lastX=e.touches[0].clientX;lastY=e.touches[0].clientY;}
  if(e.touches.length===2){dragging=false;lastDist=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);}
  e.preventDefault();
},{passive:false});
canvas.addEventListener('touchmove', function(e){
  if(e.touches.length===1&&dragging){tx+=e.touches[0].clientX-lastX;ty+=e.touches[0].clientY-lastY;lastX=e.touches[0].clientX;lastY=e.touches[0].clientY;applyTransform();}
  if(e.touches.length===2){var d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);scale*=d/lastDist;lastDist=d;applyTransform();}
  e.preventDefault();
},{passive:false});
canvas.addEventListener('touchend',function(){dragging=false;});

window.onload = resetZoom;
<\/script>
</body></html>`;

  // ── 6. Download via data URI ───────────────────────────
  const encoded = btoa(unescape(encodeURIComponent(fullHTML)));
  const a = document.createElement('a');
  a.href = 'data:text/html;base64,' + encoded;
  a.download = 'family-tree-' + pageSize + '-print.html';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  const info = document.getElementById('print-stats');
  info.style.color = '#C09828';
  info.style.fontWeight = '600';
  info.textContent = '✓ Файл скачан. Откройте его в браузере → Ctrl+P → Печать / PDF';
  document.getElementById('print-overlay').classList.add('open');
}
