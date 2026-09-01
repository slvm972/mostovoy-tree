// tree-layout.js — алгоритм расстановки карточек дерева на экране
// (функции построения layout, отрисовки связей и рендера SVG)
// Вынесено из tree_a4a.html для уменьшения размера основного файла
const NS  = 'http://www.w3.org/2000/svg';

// ── constants ─────────────────────────────────────────────
const CW = 150, CH = 100;
const COUPLE_GAP  = 12;   // gap between focal and spouse
const SIBLING_GAP = 22;   // gap between siblings / focal+spouse and sibling
const LEVEL_H     = 168;  // vertical distance between generation rows

// ── helpers ───────────────────────────────────────────────
function py(s){ const m = s && s.match(/\d{4}/); return m ? +m[0] : 9999; }

function svgEl(tag, attrs, parent){
  const e = document.createElementNS(NS, tag);
  for(const [k,v] of Object.entries(attrs)) e.setAttribute(k,v);
  if(parent) parent.appendChild(e);
  return e;
}

// ── CARD COLORS ───────────────────────────────────────────
function cardCol(id, role){
  if(role === 'focal') return {fill:'#1C4060', stroke:'#0C2840'};
  const n = IDX.nodes[id];
  if(!n) return {fill:'#888', stroke:'#555'};
  const dead = !!(n.death && n.death !== '' && n.death !== 'ум.');
  if(dead) return {fill:'#3A4A55', stroke:'#1A2A35'};
  return n.sex === 'M'
    ? {fill:'#1E4870', stroke:'#122840'}
    : {fill:'#701838', stroke:'#400C20'};
}

// ── NAME SPLIT ────────────────────────────────────────────
function splitName(name){
  if(name.length <= 14) return [name];
  const words = name.split(' ');
  if(words.length < 2) return [name.slice(0,13)+'…'];
  let bi=0, bd=Infinity;
  for(let i=0;i<words.length-1;i++){
    const L1=words.slice(0,i+1).join(' ').length;
    const L2=words.slice(i+1).join(' ').length;
    const d=Math.abs(L1-L2);
    if(d<bd&&L1<=16&&L2<=16){bd=d;bi=i;}
  }
  let l1=words.slice(0,bi+1).join(' ');
  let l2=words.slice(bi+1).join(' ');
  if(l1.length>15) l1=l1.slice(0,14)+'…';
  if(l2.length>15) l2=l2.slice(0,14)+'…';
  return [l1,l2];
}

// ── place a couple centered on anchorX at given y ─────────
// returns [{id, x, y, role}]
function placeCouple(husband, wife, anchorX, y, role){
  // Guard against ghost cards: only place IDs that actually exist in
  // IDX.nodes. Stale entries in derived caches (grandparents/relatives)
  // can point at persons removed via merge/delete — without this filter
  // they'd render as grey "P47"-style placeholder cards.
  const people = [husband, wife].filter(Boolean).filter(id => IDX.nodes[id]);
  const totalW = people.length * CW + (people.length - 1) * COUPLE_GAP;
  let x = anchorX - totalW / 2;
  return people.map(id => {
    const node = {id, x, y, role};
    x += CW + COUPLE_GAP;
    return node;
  });
}

// ════════════════════════════════════════════════════════
//  getCenteredLayout  —  LEVELS −2, −1, 0  (A2b)
// ════════════════════════════════════════════════════════
function getCenteredLayout(focalId){
  const nmap = IDX.nodes;
  const rel  = IDX.relatives[focalId];
  const gps  = IDX.grandparents[focalId] || [];
  const fams = IDX.families;
  if(!rel) {
    console.warn('[getCenteredLayout] IDX.relatives[' + focalId + '] отсутствует — '
      + 'дерево для этого узла построить нельзя. Обычно это значит, что кэш '
      + 'relatives не был пересоздан при ручной правке JSON соседних персон.');
    return {nodes:[], focalId, coupleAnchorX: 0, _missingRel: true};
  }

  const placed = new Set();  // avoid placing same person twice
  const nodes  = [];
  const MAX_GC = Infinity; // без ограничения — показываем всех внуков
  // FIX-GUARD:MAXGC-INFINITY — MAX_GC must stay Infinity. If it becomes a
  // finite number again, that is a REGRESSION — see runDiagnostics().

  function add(n){
    if(placed.has(n.id)) return;
    placed.add(n.id);
    nodes.push(n);
  }

  // ── LEVEL 0: siblings + focal + spouses ───────────────
  const siblings = [...rel.siblings].sort(
    (a,b) => py(nmap[a]?.birth) - py(nmap[b]?.birth)
  );
  const focalBY  = py(nmap[focalId]?.birth);
  const leftSibs  = siblings.filter(s => py(nmap[s]?.birth) <= focalBY);
  const rightSibs = siblings.filter(s => py(nmap[s]?.birth) >  focalBY);

  // Spouses: with 2+ marriages, alternate left/right of focal (1st spouse
  // stays right as before — unchanged for the common single-marriage case —
  // 2nd spouse goes left, 3rd further right, etc.) so each marriage's
  // children can later be laid out under their own couple without
  // overlapping or crossing the other marriage's group.
  // NOTE: order is taken directly from rel.spouses (reflects the order
  // marriages were recorded — typically chronological), NOT sorted by the
  // spouse's own birth year, since that's unreliable when a spouse's birth
  // date is unknown (it would wrongly push them to the end).
  // Separate "below_husband" spouses (childless marriages displayed below focal)
  const belowSpouses = rel.spouses.filter(spId => {
    return Object.values(IDX.families).some(f =>
      f.display === 'below_husband' &&
      (f.husband === focalId || f.wife === focalId) &&
      (f.husband === spId    || f.wife === spId)
    );
  });
  const spousesSorted = rel.spouses.filter(spId => !belowSpouses.includes(spId));
  const rightSpouses = [];
  const leftSpouses  = [];
  spousesSorted.forEach((spId, i) => {
    if(i % 2 === 0) rightSpouses.push(spId);   // 1st, 3rd, 5th... → right (default side)
    else            leftSpouses.push(spId);    // 2nd, 4th...      → left
  });

  // Left side: siblings further out, left-spouses closest to focal
  let x = -(leftSpouses.length * (CW + COUPLE_GAP) + leftSibs.length * (CW + SIBLING_GAP));
  for(const sid of leftSibs){ add({id:sid, x, y:0, role:'sibling'}); x += CW+SIBLING_GAP; }
  for(const spId of leftSpouses){ add({id:spId, x, y:0, role:'spouse'}); x += CW+COUPLE_GAP; }

  add({id:focalId, x, y:0, role:'focal'});
  x += CW;
  for(const spId of rightSpouses){ x+=COUPLE_GAP; add({id:spId,x,y:0,role:'spouse'}); x+=CW; }
  // "below" spouses go to the far right at the same Y level (not overlapping focal)
  for(const spId of belowSpouses){ x+=COUPLE_GAP; add({id:spId,x,y:0,role:'spouse'}); x+=CW; }
  for(const sid of rightSibs){ x+=SIBLING_GAP; add({id:sid,x,y:0,role:'sibling'}); x+=CW; }

  // couple anchor for centering parent/child levels (use first marriage as primary anchor)
  const fNode     = nodes.find(n => n.id === focalId);
  const lastSp    = spousesSorted.length > 0
    ? nodes.find(n => n.id === spousesSorted[0])
    : null;
  const coupleAnchorX = lastSp
    ? (fNode.x + CW/2 + lastSp.x + CW/2) / 2
    : fNode.x + CW/2;

  // ── LEVEL −1: parents ─────────────────────────────────
  // parents are rel.parents = [fatherId, motherId] (0–2 entries)
  // place them as a couple centred over coupleAnchorX
  const [fatherId, motherId] = rel.parents;
  const parentNodes = placeCouple(fatherId, motherId, coupleAnchorX, -LEVEL_H, 'parent');
  parentNodes.forEach(n => add(n));

  // build map: parentId → their x centre (for GP anchoring)
  const parentCX = {};
  for(const pn of parentNodes) parentCX[pn.id] = pn.x + CW/2;

  // ── LEVEL −2: grandparents ────────────────────────────
  // For each grandparent family, centre above the parent who is their child
  // First compute raw positions
  const gpRaw = []; // [{nodes: [{id,x,y,role}], left, right}]
  for(const gp of gps){
    const parId = rel.parents.find(p => IDX.child_of[p] === gp.family);
    if(!parId || !(parId in parentCX)) continue;
    const anchor = parentCX[parId];
    const gpNodes = placeCouple(gp.husband, gp.wife, anchor, -2*LEVEL_H, 'grandparent');
    if(!gpNodes.length) continue; // both grandparents missing from nodes — nothing to draw
    gpRaw.push({
      nodes: gpNodes,
      left:  gpNodes[0].x,
      right: gpNodes[gpNodes.length-1].x + CW
    });
  }

  // Overlap fix: if two GP families overlap, push the right one further right
  // (keeps left family in place, shifts right family)
  const MIN_GAP = 20; // minimum gap between GP families
  for(let i = 1; i < gpRaw.length; i++){
    const prev = gpRaw[i-1];
    const curr = gpRaw[i];
    const overlap = prev.right + MIN_GAP - curr.left;
    if(overlap > 0){
      const shift = overlap;
      curr.nodes.forEach(n => { n.x += shift; });
      curr.left  += shift;
      curr.right += shift;
    }
  }

  // Add all GP nodes (skip duplicates)
  for(const family of gpRaw) family.nodes.forEach(n => add(n));

  // ── Пре-расчёт "footprint": сколько горизонтального места
  //    понадобится каждому ребёнку под его собственных детей (внуков
  //    фокальной персоны), чтобы на LEVEL +1 их можно было расставить
  //    заранее с нужным запасом, не толкая друг друга постфактум.
  const childFootprint = {}; // childId -> requiredWidth (px)
  for(const cId of rel.children){
    const cRel = IDX.relatives[cId];
    if(!cRel || !cRel.children.length){ childFootprint[cId] = CW; continue; }
    const cFamChildren = Object.values(fams)
      .filter(f => f.husband === cId || f.wife === cId)
      .flatMap(f => f.children || []);
    const gcSource = cFamChildren.length > 0 ? cFamChildren : cRel.children;
    const gcCount = [...new Set(gcSource)]
      .filter(gc => IDX.nodes[gc])
      .slice(0, MAX_GC).length;
    childFootprint[cId] = gcCount > 0
      ? Math.max(CW, gcCount * CW + (gcCount - 1) * SIBLING_GAP)
      : CW;
  }

  // ── LEVEL +1: children ────────────────────────────────
  // Group children by which marriage/family they belong to,
  // so each spouse's children are positioned under THAT couple,
  // not all mixed under one shared centre point.
  //
  // Find all families where focal is husband or wife (handles polygamy/remarriage)
  const focalFamilies = Object.entries(fams)
    .filter(([, f]) => f.husband === focalId || f.wife === focalId)
    .map(([fid, f]) => f);

  if(focalFamilies.length > 0){
    // Build couple anchor X for EACH marriage (focal + that specific spouse)
    const familyGroups = [];
    for(const fam of focalFamilies){
      const otherSpouse = fam.husband === focalId ? fam.wife : fam.husband;
      const spouseNode  = otherSpouse ? nodes.find(n => n.id === otherSpouse) : null;
      // anchor: midpoint between focal and this specific spouse (or focal alone if no spouse)
      const anchorX = spouseNode
        ? (fNode.x + CW/2 + spouseNode.x + CW/2) / 2
        : fNode.x + CW/2;
      const kids = [...(fam.children||[])]
        .filter(c => !placed.has(c))
        .sort((a,b) => py(nmap[a]?.birth) - py(nmap[b]?.birth));
      if(kids.length) familyGroups.push({ anchorX, kids });
    }

    // Sort groups left-to-right by anchor so layout reads naturally
    familyGroups.sort((a,b) => a.anchorX - b.anchorX);

    // Lay out each group's children centred under ITS OWN anchor,
    // then resolve horizontal overlaps between groups left→right.
    const GROUP_GAP = SIBLING_GAP * 2;
    let prevRight = -Infinity;

    for(const group of familyGroups){
      // ширина слота под каждого ребёнка теперь учитывает его собственный
      // footprint (место под будущих внуков), а не фиксированную CW —
      // это резервирует место заранее и убирает необходимость толкать
      // соседей после факта
      const widths = group.kids.map(cId => Math.max(CW, childFootprint[cId] || CW));
      const totalW = widths.reduce((s,w) => s+w, 0) + (group.kids.length - 1) * SIBLING_GAP;
      let cx = group.anchorX - totalW / 2;
      if(cx < prevRight + GROUP_GAP) cx = prevRight + GROUP_GAP;
      group.kids.forEach((cId, i) => {
        const w = widths[i];
        // сама карточка ребёнка остаётся по центру выделенного ему слота
        add({id: cId, x: cx + (w - CW) / 2, y: LEVEL_H, role: 'child'});
        cx += w + SIBLING_GAP;
      });
      prevRight = cx - SIBLING_GAP;
    }

    // ── Fallback: children in rel.children but missing from any family ──
    // This handles data inconsistencies where rel.children has entries
    // not reflected in families (e.g. after structural edits)
    const unplacedChildren = rel.children.filter(c => !placed.has(c));
    if(unplacedChildren.length > 0){
      const totalW = unplacedChildren.length * CW + (unplacedChildren.length - 1) * SIBLING_GAP;
      let cx = (fNode.x + CW/2) - totalW / 2;
      if(cx < prevRight + GROUP_GAP) cx = prevRight + GROUP_GAP;
      for(const cId of unplacedChildren){
        add({id: cId, x: cx, y: LEVEL_H, role: 'child'});
        cx += CW + SIBLING_GAP;
      }
    }
  } else {
    // No families at all — place children from rel.children directly
    const fallbackChildren = rel.children
      .filter(c => !placed.has(c))
      .sort((a,b) => py(nmap[a]?.birth) - py(nmap[b]?.birth));
    if(fallbackChildren.length > 0){
      const totalW = fallbackChildren.length * CW + (fallbackChildren.length - 1) * SIBLING_GAP;
      let cx = (fNode ? fNode.x + CW/2 : 0) - totalW / 2;
      for(const cId of fallbackChildren){
        add({id: cId, x: cx, y: LEVEL_H, role: 'child'});
        cx += CW + SIBLING_GAP;
      }
    }
  }

  // ── LEVEL +2: grandchildren ──────────────────────────
  // Use nodes actually placed at LEVEL+1, not rel.children
  // (some children may have been added via fallback path)
  const placedChildren = nodes
    .filter(n => n.y === LEVEL_H && n.id !== focalId)
    .sort((a,b) => a.x - b.x);  // left to right order

  let prevRightGC = -Infinity; // track right edge of last placed grandchildren group

  for(const cNode of placedChildren){
    const cId  = cNode.id;
    const cRel = IDX.relatives[cId];
    if(!cRel || !cRel.children.length) continue;

    // Get children of this child — from families first (authoritative),
    // fallback to rel.children if family data missing
    const cFamChildren = Object.values(IDX.families)
      .filter(f => f.husband === cId || f.wife === cId)
      .flatMap(f => f.children || []);
    const gcSource = cFamChildren.length > 0
      ? cFamChildren
      : cRel.children;

    const gcList = [...new Set(gcSource)]
      .filter(gc => IDX.nodes[gc] && !placed.has(gc))
      .sort((a,b) => py(nmap[a]?.birth) - py(nmap[b]?.birth))
      .slice(0, MAX_GC);

    if(!gcList.length) continue;

    const gcW     = gcList.length * CW + (gcList.length - 1) * SIBLING_GAP;
    const childCX = cNode.x + CW / 2;
    let gx = childCX - gcW / 2;
    // Anti-overlap: a wide grandchildren group under this child can start
    // to the left of where the previous child's own (possibly narrower or
    // wider) grandchildren group already ended. Clamp forward so groups
    // never overlap, at the cost of drifting right of the "ideal" center
    // under a densely-populated branch.
    if(gx < prevRightGC + SIBLING_GAP) gx = prevRightGC + SIBLING_GAP;

    for(const gcId of gcList){
      add({id: gcId, x: gx, y: 2 * LEVEL_H, role: 'grandchild'});
      gx += CW + SIBLING_GAP;
    }
    prevRightGC = gx - SIBLING_GAP;
  }

  return { nodes, focalId, coupleAnchorX };
}

// ════════════════════════════════════════════════════════
//  drawEdges  —  lines between all visible family units
// ════════════════════════════════════════════════════════
function drawEdges(layout, parent, focalId){
  const LCOL = '#C09828';
  const LW   = '1.8';
  const OPACITY = '.72';

  const pos = {};
  for(const n of layout.nodes) pos[n.id] = {x: n.x, y: n.y};

  function line(x1,y1,x2,y2){
    svgEl('line',{x1,y1,x2,y2,stroke:LCOL,'stroke-width':LW,
                  opacity:OPACITY,class:'eline'},parent);
  }
  function heart(x,y){
    const t = svgEl('text',{x,y,
      'text-anchor':'middle','font-size':'10',
      fill:LCOL,opacity:'.9','pointer-events':'none'},parent);
    t.textContent = '♥';
  }

  // ── Pass 1: collect renderable family units ──────────
  const units = [];
  for(const [, fam] of Object.entries(IDX.families)){
    const h = fam.husband, w = fam.wife;
    const hIn = h && pos[h], wIn = w && pos[w];
    const visCh = (fam.children || []).filter(c => pos[c]);
    if(!hIn && !wIn) continue;

    const parentRowY = Math.max(hIn ? pos[h].y : 0, wIn ? pos[w].y : 0);
    const coupleLineY = parentRowY + CH / 2;

    let anchorX;
    if(hIn && wIn){
      anchorX = (pos[h].x + CW/2 + pos[w].x + CW/2) / 2;
    } else {
      anchorX = hIn ? pos[h].x + CW/2 : pos[w].x + CW/2;
    }

    units.push({h, w, hIn, wIn, visCh, parentRowY, coupleLineY, anchorX});
  }

  // ── Pass 2: couple connectors (bars + hearts) — unaffected by lanes ──
  for(const u of units){
    if(u.hIn && u.wIn){
      const leftCX  = Math.min(pos[u.h].x, pos[u.w].x) + CW;
      const rightCX = Math.max(pos[u.h].x, pos[u.w].x);
      if(rightCX > leftCX) line(leftCX, u.coupleLineY, rightCX, u.coupleLineY);
      heart(u.anchorX, u.coupleLineY + 5);
    }
  }

  // ── Pass 3: group families-with-children sharing the same
  //    (parentRowY, childRowY) pair, so overlapping marriages of the
  //    same focal person get separated onto vertical "lanes" instead
  //    of drawing their crossbars at an identical height.
  const withChildren = units.filter(u => u.visCh.length > 0);
  const groups = {};
  for(const u of withChildren){
    const childRowY = pos[u.visCh[0]].y;
    const key = u.parentRowY + '|' + childRowY;
    (groups[key] = groups[key] || []).push({...u, childRowY});
  }

  const LANE_STEP   = 10;  // px vertical offset between overlapping crossbars
  const LANE_GAP_PX = 6;   // min horizontal gap to treat footprints as non-overlapping

  for(const key of Object.keys(groups)){
    const group = groups[key].slice().sort((a,b) => {
      const aMin = Math.min(a.anchorX, ...a.visCh.map(c=>pos[c].x+CW/2));
      const bMin = Math.min(b.anchorX, ...b.visCh.map(c=>pos[c].x+CW/2));
      return aMin - bMin;
    });

    const laneEnds = [];
    for(const u of group){
      const childXs = u.visCh.map(c => pos[c].x + CW/2);
      const footL = Math.min(u.anchorX, ...childXs);
      const footR = Math.max(u.anchorX, ...childXs);
      let lane = laneEnds.findIndex(end => end + LANE_GAP_PX < footL);
      if(lane === -1){ lane = laneEnds.length; laneEnds.push(footR); }
      else laneEnds[lane] = footR;
      u.lane = lane;
    }
    const numLanes = laneEnds.length;

    for(const u of group){
      const { visCh, anchorX, parentRowY, childRowY, lane } = u;
      const junctionY     = parentRowY + CH + 10;
      const baseCrossbarY = childRowY - 12;
      const crossbarY = numLanes > 1 ? baseCrossbarY - lane * LANE_STEP : baseCrossbarY;

      const childXs = visCh.map(c => pos[c].x + CW/2);
      const crossL  = Math.min(...childXs);
      const crossR  = Math.max(...childXs);

      line(anchorX, junctionY, anchorX, crossbarY);

      if(anchorX < crossL){
        line(anchorX, crossbarY, crossL, crossbarY);
      } else if(anchorX > crossR){
        line(crossR, crossbarY, anchorX, crossbarY);
      }

      if(visCh.length > 1){
        line(crossL, crossbarY, crossR, crossbarY);
      }

      for(const cId of visCh){
        line(pos[cId].x + CW/2, crossbarY, pos[cId].x + CW/2, childRowY);
      }
    }
  }
}

// ── RENDER ────────────────────────────────────────────────
function render(focalId){
  const layout = getCenteredLayout(focalId);
  const svg    = document.getElementById('svg');
  svg.innerHTML = '';

  // size the SVG around ALL nodes (including negative y)
  if(!layout.nodes.length){
    if(layout._missingRel){
      console.warn('[render] Пустой canvas для focalId=' + focalId
        + ': отсутствует IDX.relatives[' + focalId + ']. Нужно починить данные '
        + '(см. предупреждение выше от getCenteredLayout).');
      const msg = currentLang==='he'
        ? '⚠ נתונים פגומים עבור ' + focalId + ' — לא ניתן לבנות עץ. פנה למנהל.'
        : currentLang==='en'
        ? '⚠ Corrupted data for ' + focalId + ' — tree cannot be built. Contact the admin.'
        : '⚠ Повреждены данные для ' + focalId + ' — дерево не может быть построено. Сообщите администратору.';
      document.getElementById('info').textContent = msg;
    } else {
      document.getElementById('info').textContent = t('no_data')||'—';
    }
    return;
  }
  const xs   = layout.nodes.map(n => n.x);
  const ys   = layout.nodes.map(n => n.y);
  const minX = Math.min(...xs) - 60;
  const maxX = Math.max(...xs) + CW + 60;
  const minY = Math.min(...ys) - 40;
  const maxY = Math.max(...ys) + CH + 40;
  const W = maxX - minX, H = maxY - minY;
  svg.setAttribute('width', W);
  svg.setAttribute('height', H);

  // offset: shift all coords into positive SVG space
  const offX = -minX, offY = -minY;

  // ── Layer 1: edges (drawn first, behind cards) ────────
  // Translate the layout nodes by offset for drawEdges
  const offsetLayout = {
    ...layout,
    nodes: layout.nodes.map(n => ({...n, x: n.x + offX, y: n.y + offY}))
  };
  const edgeG = svgEl('g', {id:'edges'}, svg);
  // Temporarily redirect drawing to use offset coords
  const origLayout = layout;
  drawEdges(offsetLayout, edgeG, focalId);

  // ── Layer 2: cards (drawn on top) ─────────────────────
  const cardG = svgEl('g', {id:'cards'}, svg);

  for(const n of layout.nodes){
    const {fill, stroke} = cardCol(n.id, n.role);
    const nx = n.x + offX, ny = n.y + offY;
    const ndata = IDX.nodes[n.id] || {};
    const lines = splitName(pname(n.id) || n.id);
    const isFocal = n.role === 'focal';

    const g = svgEl('g',{
      'data-nodeid': n.id,
      style: n.role === 'focal' ? 'cursor:default' : 'cursor:pointer'
    }, cardG);

    // click + touch: navigate to this person (non-focal only)
    if(n.role !== 'focal'){
      const cardId = n.id;
      const onActivate = () => {
        showPanel(cardId);
        navigateTo(cardId);
      };
      g.addEventListener('click', onActivate);
      // Touch: fire on touchend only if no significant move (not a pan gesture)
      let touchStartX = 0, touchStartY = 0;
      g.addEventListener('touchstart', e => {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
      }, { passive: true });
      g.addEventListener('touchend', e => {
        const dx = Math.abs(e.changedTouches[0].clientX - touchStartX);
        const dy = Math.abs(e.changedTouches[0].clientY - touchStartY);
        if(dx < 8 && dy < 8){   // tap, not swipe
          e.preventDefault();
          onActivate();
        }
      }, { passive: false });
    }

    // shadow
    svgEl('rect',{x:nx+2,y:ny+3,width:CW,height:CH,rx:5,
                  fill:'rgba(0,0,0,.22)'},g);
    // body
    svgEl('rect',{x:nx,y:ny,width:CW,height:CH,rx:5,
                  fill, stroke,
                  'stroke-width': isFocal ? '3' : '1.2',
                  'stroke-dasharray': (ndata.death&&ndata.death!=='') ? '5,3' : 'none'},g);
    // accent bar
    svgEl('rect',{x:nx,y:ny,width:CW,height:4,rx:5,fill:stroke,opacity:'.9'},g);

    // role label
  const ROLE_LABELS = {
    focal: tr('focal'), spouse: tr('spouse'), sibling: tr('sibling')||'~',
    parent: tr('parent'), grandparent: tr('grandparent'),
    child: tr('child'), grandchild: tr('grandchild')
  };
    const rl = svgEl('text',{x:nx+CW/2,y:ny+14,'text-anchor':'middle',
                             'font-size':'8','font-family':'Segoe UI,sans-serif',
                             fill:'rgba(255,255,255,.5)','pointer-events':'none'},g);
    rl.textContent = ROLE_LABELS[n.role] || n.role;

    // social media indicator (top-left corner) — only for authenticated users
    if(ndata.social && _sessionPassword){
      const si = svgEl('text',{x:nx+8,y:ny+15,'font-size':'11',
                               'pointer-events':'none'},g);
      si.textContent = '🔗';
    }

    // name
    const nameY0 = lines.length===2 ? ny+28 : ny+36;
    for(let i=0;i<lines.length;i++){
      const t = svgEl('text',{x:nx+CW/2,y:nameY0+i*14,'text-anchor':'middle',
                              'font-size':'11','font-weight':'bold',
                              'font-family':'Segoe UI,sans-serif',
                              fill:'white','pointer-events':'none'},g);
      t.textContent = lines[i];
    }

    // birth year + death year + Hebrew dates
    const by = ndata.birth ? (ndata.birth.match(/\d{4}/)||[''])[0] : '';
    const dy = ndata.death && ndata.death !== 'ум.' ? (ndata.death.match(/\d{4}/)||[''])[0] : '';
    const bhe = ndata.birth_he || '';
    const dhe = ndata.death_he || '';

    // date line Y: starts at bottom area of card
    let dateY = ny + CH - (dy ? 28 : 20) - (bhe||dhe ? 10 : 0);

    if(by){
      const dt = svgEl('text',{x:nx+CW/2, y:dateY,
                               'text-anchor':'middle','font-size':'9',
                               'font-family':'Segoe UI,sans-serif',
                               fill:'rgba(255,255,255,.65)','pointer-events':'none'},g);
      dt.textContent = t('born_abbr') + ' ' + by;
      dateY += 12;
    }
    if(dy){
      const dt = svgEl('text',{x:nx+CW/2, y:dateY,
                               'text-anchor':'middle','font-size':'9',
                               'font-family':'Segoe UI,sans-serif',
                               fill:'rgba(255,255,255,.45)','pointer-events':'none'},g);
      dt.textContent = '† ' + dy;
      dateY += 12;
    }
    if(bhe || dhe){
      const heText = [bhe ? bhe : null, dhe ? '† '+dhe : null].filter(Boolean).join('  ');
      const ht = svgEl('text',{x:nx+CW/2, y:ny+CH-6,
                               'text-anchor':'middle','font-size':'7.5',
                               'font-family':'Segoe UI,Arial,sans-serif',
                               'direction':'rtl',
                               fill:'rgba(237,216,144,.55)','pointer-events':'none'},g);
      ht.textContent = heText;
    }
  }

  // centre viewport: return pan params for caller to apply
  const fNodeR = layout.nodes.find(n => n.id === focalId);
  const vW = window.innerWidth, vH = window.innerHeight - 44;
  const sc = 1.2;
  const panTx = vW/2 - (fNodeR.x + offX + CW/2)*sc;
  const panTy = vH/2 - (fNodeR.y + offY + CH/2)*sc;
  return { tx: panTx, ty: panTy, sc };

  // info bar
  const n = layout.nodes.length;
  const roles = layout.nodes.map(x=>x.role).join(', ');
  document.getElementById('info').textContent =
    `Узлов: ${n} | ${focalId} | ${roles}`;

  // console test
  console.log('getCenteredLayout(' + focalId + ') →', layout.nodes.length, 'nodes');
}
