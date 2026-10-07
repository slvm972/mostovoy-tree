/**
 * tree-kinship.js — вычисление степени родства между двумя персонами.
 *
 * API:
 *   computeKinship(idx, idA, idB, lang) → {
 *     found: boolean,
 *     type:  'self'|'blood'|'affine'|'step'|'inlaw'|'former'|'none',
 *     kind:  'self'|'ancestor'|'descendant'|'sibling'|'cousin'|
 *            'uncle'|'nibling'|'spouse'|'inlaw'|'step'|'former'|'none',
 *     a: number,   // поколений вверх от A до общего предка (для blood)
 *     b: number,   // поколений вверх от B до общего предка
 *     term: string // готовая фраза на ru | en | he
 *   }
 *
 * Смысл term: «A является <term> для B»
 * (P1,P3 → «отец»; P3,P1 → «сын»).
 *
 * CommonJS + browser (window.TreeKinship).
 */

'use strict';

// ─── i18n dictionaries ───────────────────────────────────────────
const TERMS = {
  ru: {
    self: 'один и тот же человек',
    not_found: 'не найдено',
    // blood direct
    father: 'отец', mother: 'мать',
    son: 'сын', daughter: 'дочь',
    grandfather: 'дедушка', grandmother: 'бабушка',
    great_grandfather: 'прадедушка', great_grandmother: 'прабабушка',
    grand_son: 'внук', grand_daughter: 'внучка',
    great_grand_son: 'правнук', great_grand_daughter: 'правнучка',
    // deeper ancestors / descendants (n ≥ 4; n=4 — пра-пра-)
    ancestor_m: (n) => n === 4 ? 'прапрадедушка' : `предок (${n} пок.)`,
    ancestor_f: (n) => n === 4 ? 'прапрабабушка' : `предкиня (${n} пок.)`,
    descendant_m: (n) => n === 4 ? 'праправнук' : `потомок (${n} пок.)`,
    descendant_f: (n) => n === 4 ? 'праправнучка' : `потомкиня (${n} пок.)`,
    // siblings
    brother: 'брат', sister: 'сестра',
    half_brother_p: 'единокровный брат', half_sister_p: 'единокровная сестра',
    half_brother_m: 'единоутробный брат', half_sister_m: 'единоутробная сестра',
    step_brother: 'сводный брат', step_sister: 'сводная сестра',
    // uncle / aunt / nibling
    uncle: 'дядя', aunt: 'тётя',
    nephew: 'племянник', niece: 'племянница',
    // cousins
    cousin_m: 'двоюродный брат', cousin_f: 'двоюродная сестра',
    cousin2_m: 'троюродный брат', cousin2_f: 'троюродная сестра',
    distant: 'дальний родственник',
    // spouses / former
    husband: 'муж', wife: 'жена',
    ex_husband: 'бывший муж', ex_wife: 'бывшая жена',
    // in-laws
    father_in_law: 'свёкор', mother_in_law: 'свекровь',
    father_in_law_w: 'тесть', mother_in_law_w: 'тёща',
    son_in_law: 'зять', daughter_in_law: 'невестка',
    brother_in_law: 'шурин', sister_in_law: 'золовка',
    devar: 'деверь', svoyachenitsa: 'свояченица',
    // боковые линии со сдвигом поколений
    cousin_uncle: 'двоюродный дядя', cousin_aunt: 'двоюродная тётя',
    cousin_nephew: 'двоюродный племянник', cousin_niece: 'двоюродная племянница',
    great_uncle: 'двоюродный дедушка', great_aunt: 'двоюродная бабушка',
    great_great_uncle: 'двоюродный прадедушка', great_great_aunt: 'двоюродная прабабушка',
    grand_nephew: 'внучатый племянник', grand_niece: 'внучатая племянница',
    great_grand_nephew: 'правнучатый племянник', great_grand_niece: 'правнучатая племянница',
    // step
    stepfather: 'отчим', stepmother: 'мачеха',
    stepson: 'пасынок', stepdaughter: 'падчерица',
  },
  en: {
    self: 'the same person',
    not_found: 'not found',
    father: 'father', mother: 'mother',
    son: 'son', daughter: 'daughter',
    grandfather: 'grandfather', grandmother: 'grandmother',
    great_grandfather: 'great-grandfather', great_grandmother: 'great-grandmother',
    grand_son: 'grandson', grand_daughter: 'granddaughter',
    great_grand_son: 'great-grandson', great_grand_daughter: 'great-granddaughter',
    ancestor_m: (n) => n === 4 ? 'great-great-grandfather' : `ancestor (${n} gen.)`,
    ancestor_f: (n) => n === 4 ? 'great-great-grandmother' : `ancestor (${n} gen.)`,
    descendant_m: (n) => n === 4 ? 'great-great-grandson' : `descendant (${n} gen.)`,
    descendant_f: (n) => n === 4 ? 'great-great-granddaughter' : `descendant (${n} gen.)`,
    brother: 'brother', sister: 'sister',
    half_brother_p: 'paternal half-brother', half_sister_p: 'paternal half-sister',
    half_brother_m: 'maternal half-brother', half_sister_m: 'maternal half-sister',
    step_brother: 'stepbrother', step_sister: 'stepsister',
    uncle: 'uncle', aunt: 'aunt',
    nephew: 'nephew', niece: 'niece',
    cousin_m: 'first cousin', cousin_f: 'first cousin',
    cousin2_m: 'second cousin', cousin2_f: 'second cousin',
    distant: 'distant relative',
    husband: 'husband', wife: 'wife',
    ex_husband: 'ex-husband', ex_wife: 'ex-wife',
    father_in_law: 'father-in-law', mother_in_law: 'mother-in-law',
    father_in_law_w: 'father-in-law', mother_in_law_w: 'mother-in-law',
    son_in_law: 'son-in-law', daughter_in_law: 'daughter-in-law',
    brother_in_law: 'brother-in-law', sister_in_law: 'sister-in-law',
    devar: 'brother-in-law', svoyachenitsa: 'sister-in-law',
    cousin_uncle: 'first cousin once removed', cousin_aunt: 'first cousin once removed',
    cousin_nephew: 'first cousin once removed', cousin_niece: 'first cousin once removed',
    great_uncle: 'great-uncle', great_aunt: 'great-aunt',
    great_great_uncle: 'great-great-uncle', great_great_aunt: 'great-great-aunt',
    grand_nephew: 'great-nephew', grand_niece: 'great-niece',
    great_grand_nephew: 'great-great-nephew', great_grand_niece: 'great-great-niece',
    stepfather: 'stepfather', stepmother: 'stepmother',
    stepson: 'stepson', stepdaughter: 'stepdaughter',
  },
  he: {
    self: 'אותו אדם',
    not_found: 'לא נמצא',
    father: 'אבא', mother: 'אמא',
    son: 'בן', daughter: 'בת',
    grandfather: 'סבא', grandmother: 'סבתא',
    great_grandfather: 'סבא רבא', great_grandmother: 'סבתא רבא',
    grand_son: 'נכד', grand_daughter: 'נכדה',
    great_grand_son: 'נין', great_grand_daughter: 'נינה',
    ancestor_m: (n) => n === 4 ? 'אבי סבא רבה' : `אבות (${n})`,
    ancestor_f: (n) => n === 4 ? 'אם סבתא רבתא' : `אמהות (${n})`,
    descendant_m: (n) => n === 4 ? 'בן של נין' : `צאצא (${n})`,
    descendant_f: (n) => n === 4 ? 'בת של נין' : `צאצאית (${n})`,
    brother: 'אח', sister: 'אחות',
    half_brother_p: 'אח למחצה (אב)', half_sister_p: 'אחות למחצה (אב)',
    half_brother_m: 'אח למחצה (אם)', half_sister_m: 'אחות למחצה (אם)',
    step_brother: 'אח חורג', step_sister: 'אחות חורגת',
    uncle: 'דוד', aunt: 'דודה',
    nephew: 'אחיין', niece: 'אחיינית',
    cousin_m: 'בן דוד', cousin_f: 'בת דודה',
    cousin2_m: 'בן דוד שני', cousin2_f: 'בת דודה שנייה',
    distant: 'קרוב רחוק',
    husband: 'בעל', wife: 'אישה',
    ex_husband: 'בעל לשעבר', ex_wife: 'אישה לשעבר',
    father_in_law: 'חם', mother_in_law: 'חמות',
    father_in_law_w: 'חותן', mother_in_law_w: 'חותנת',
    son_in_law: 'חתן', daughter_in_law: 'כלה',
    brother_in_law: 'גיס', sister_in_law: 'גיסה',
    devar: 'גיס', svoyachenitsa: 'גיסה',
    // TODO: уточнить у носителя иврита
    cousin_uncle: 'דוד רחוק', cousin_aunt: 'דודה רחוקה',
    cousin_nephew: 'אחיין רחוק', cousin_niece: 'אחיינית רחוקה',
    great_uncle: 'דוד רחוק', great_aunt: 'דודה רחוקה',
    great_great_uncle: 'דוד רחוק', great_great_aunt: 'דודה רחוקה',
    grand_nephew: 'אחיין רחוק', grand_niece: 'אחיינית רחוקה',
    great_grand_nephew: 'אחיין רחוק', great_grand_niece: 'אחיינית רחוקה',
    stepfather: 'אב חורג', stepmother: 'אם חורגת',
    stepson: 'בן חורג', stepdaughter: 'בת חורגת',
  },
};

function T(lang, key, n) {
  const L = TERMS[lang] || TERMS.ru;
  const v = L[key];
  if (typeof v === 'function') return v(n);
  return v != null ? v : (TERMS.ru[key] || key);
}

// ─── parent graph builders ───────────────────────────────────────

/**
 * Build maps:
 *   parentsOf[id] = [parentId, ...]           (all known parents)
 *   bioParentsOf[id] = { father, mother }     (biological only)
 *   stepParentsOf[id] = [stepParentId, ...]   (step only; derived from marriage to a
 *                                              biological parent + parent_link as extra signal)
 *   childrenOf[id] = [childId, ...]
 *   spousesOf[id] = [{ id, status }]          status: 'married'|'divorced'|...
 */
function buildGraph(idx) {
  const parentsOf = {};
  const bioParentsOf = {};
  const stepParentsOf = {};
  const stepHint = {};      // childId → step-parent id (из parent_link)
  const childrenOf = {};
  const spousesOf = {};

  function addParent(child, parent) {
    if (!child || !parent) return;
    if (!parentsOf[child]) parentsOf[child] = [];
    if (!parentsOf[child].includes(parent)) parentsOf[child].push(parent);
    if (!childrenOf[parent]) childrenOf[parent] = [];
    if (!childrenOf[parent].includes(child)) childrenOf[parent].push(child);
  }

  // 1) families via child_of
  for (const [childId, famId] of Object.entries(idx.child_of || {})) {
    const fam = (idx.families || {})[famId];
    if (!fam) continue;
    const father = fam.husband || null;
    const mother = fam.wife || null;
    const node = (idx.nodes || {})[childId] || {};
    const isStep = node.parent_link === 'step';

    // Default: both biological
    let bioF = father, bioM = mother;
    if (isStep) {
      // parent_link === 'step' — дополнительный сигнал: ребёнок жены от прошлых
      // отношений → жена биологическая мать, муж — отчим (запишется как step ниже).
      bioF = null; bioM = mother;
      if (father) stepHint[childId] = father;
    }

    bioParentsOf[childId] = { father: bioF, mother: bioM };
    // Для поиска общих предков берём только биологических родителей;
    // step-родитель живёт только в stepParentsOf (и в прямых проверках).
    if (bioF) addParent(childId, bioF);
    if (bioM) addParent(childId, bioM);
  }

  // 2) relatives.parents fallback (covers gaps in child_of)
  for (const [pid, rel] of Object.entries(idx.relatives || {})) {
    for (const p of rel.parents || []) {
      if (p && stepHint[pid] === p) continue; // step — не в общий граф
      addParent(pid, p);
      if (!bioParentsOf[pid]) {
        const pn = (idx.nodes || {})[p] || {};
        if (!bioParentsOf[pid]) bioParentsOf[pid] = { father: null, mother: null };
        if (pn.sex === 'M' && !bioParentsOf[pid].father) bioParentsOf[pid].father = p;
        if (pn.sex === 'F' && !bioParentsOf[pid].mother) bioParentsOf[pid].mother = p;
      }
    }
  }

  // 3) grandparents cache → attach each grandparent couple to the correct
  // intermediate parent of `pid`.
  // grandparents[personId] = [{ family, husband, wife }, ...]
  // Matching order:
  //   a) intermediate whose child_of === gp.family
  //   b) otherwise a still-parentless intermediate (not yet claimed)
  // This avoids attaching maternal grandparents onto the father (and vice versa).
  for (const [pid, gps] of Object.entries(idx.grandparents || {})) {
    const inter = parentsOf[pid] || [];
    const claimed = new Set();
    for (const gp of gps || []) {
      const gpIds = [gp.husband, gp.wife].filter(Boolean);
      if (!gpIds.length) continue;

      let target = null;
      if (gp.family) {
        target = inter.find(ip => idx.child_of && idx.child_of[ip] === gp.family);
      }
      if (!target) {
        target = inter.find(ip =>
          !claimed.has(ip) && (parentsOf[ip] || []).length === 0
        );
      }
      if (!target) continue;
      claimed.add(target);
      for (const gpid of gpIds) addParent(target, gpid);
    }
  }

  // 4) spouses from families
  for (const fam of Object.values(idx.families || {})) {
    const h = fam.husband, w = fam.wife;
    if (!h || !w) continue;
    const status = fam.status === 'divorced' ? 'divorced' : 'married';
    if (!spousesOf[h]) spousesOf[h] = [];
    if (!spousesOf[w]) spousesOf[w] = [];
    if (!spousesOf[h].some(s => s.id === w)) spousesOf[h].push({ id: w, status, famId: fam.id });
    if (!spousesOf[w].some(s => s.id === h)) spousesOf[w].push({ id: h, status, famId: fam.id });
  }
  // relatives.spouses fallback
  for (const [pid, rel] of Object.entries(idx.relatives || {})) {
    for (const sid of rel.spouses || []) {
      if (!spousesOf[pid]) spousesOf[pid] = [];
      if (!spousesOf[pid].some(s => s.id === sid)) {
        spousesOf[pid].push({ id: sid, status: 'married', famId: null });
      }
    }
  }

  // 5) step-родители по браку: A — step-родитель B, если A состоит (или состоял)
  //    в браке с биологическим родителем B и сам не его родитель.
  //    Бывший(ая) супруг(а), чей брак с родителем заведомо ПРЕДШЕСТВОВАЛ рождению B
  //    (есть их общий ребёнок, родившийся не позже B), step-родителем не считается.
  const yr = (id) => { const m = (((idx.nodes || {})[id] || {}).birth || '').match(/\d{4}/); return m ? +m[0] : null; };
  for (const childId of Object.keys(bioParentsOf)) {
    const bio = bioParentsOf[childId];
    const bioIds = [bio.father, bio.mother].filter(Boolean);
    const by = yr(childId);
    const steps = [];
    for (const bp of bioIds) {
      for (const sp of spousesOf[bp] || []) {
        if (bioIds.includes(sp.id) || sp.id === childId || steps.includes(sp.id)) continue;
        if (by != null) {
          const jointEarlier = (childrenOf[bp] || []).some(c =>
            c !== childId && (childrenOf[sp.id] || []).includes(c) && yr(c) != null && yr(c) <= by);
          if (jointEarlier) continue;
        }
        steps.push(sp.id);
      }
    }
    if (stepHint[childId] && !steps.includes(stepHint[childId]) && !bioIds.includes(stepHint[childId])) steps.push(stepHint[childId]);
    if (steps.length) stepParentsOf[childId] = steps;
  }

  return { parentsOf, bioParentsOf, stepParentsOf, childrenOf, spousesOf };
}

/** Ancestors map: id → { ancestorId → distance } */
function ancestorDistances(startId, parentsOf, maxDepth = 12) {
  const dist = {};
  const queue = [[startId, 0]];
  const seen = new Set([startId]);
  while (queue.length) {
    const [id, d] = queue.shift();
    if (d >= maxDepth) continue;
    for (const p of parentsOf[id] || []) {
      if (seen.has(p)) continue;
      seen.add(p);
      dist[p] = d + 1;
      queue.push([p, d + 1]);
    }
  }
  return dist;
}

function sexOf(idx, id) {
  return ((idx.nodes || {})[id] || {}).sex || '';
}

function isMale(idx, id) { return sexOf(idx, id) === 'M'; }
function isFemale(idx, id) { return sexOf(idx, id) === 'F'; }

// ─── core classifier ─────────────────────────────────────────────

// Публичная форма: строит граф сама (поведение прежнее, без кэша — IDX мутируется на месте).
function computeKinship(idx, idA, idB, lang) {
  return computeKinshipWithGraph(idx, (idx && idx.nodes) ? buildGraph(idx) : null, idA, idB, lang);
}

// Вариант с готовым графом g = buildGraph(idx): для массовых проверок (тесты, отчёты).
function computeKinshipWithGraph(idx, g, idA, idB, lang) {
  lang = lang || 'ru';
  const empty = (term, type, kind) => ({
    found: type !== 'none',
    type: type || 'none',
    kind: kind || 'none',
    a: 0, b: 0,
    term: term || T(lang, 'not_found'),
  });

  if (!idx || !idx.nodes) return empty(T(lang, 'not_found'), 'none', 'none');
  if (!idx.nodes[idA] || !idx.nodes[idB]) return empty(T(lang, 'not_found'), 'none', 'none');

  // Self
  if (idA === idB) {
    return { found: true, type: 'self', kind: 'self', a: 0, b: 0, term: T(lang, 'self') };
  }

  const { parentsOf, bioParentsOf, stepParentsOf, childrenOf, spousesOf } = g;

  // ── Step parent / step child (explicit parent_link) ──
  const stepA = stepParentsOf[idA] || [];
  const stepB = stepParentsOf[idB] || [];
  if (stepA.includes(idB)) {
    // A is step-child of B → A is stepson/stepdaughter of B
    const term = isFemale(idx, idA) ? T(lang, 'stepdaughter') : T(lang, 'stepson');
    return { found: true, type: 'step', kind: 'step', a: 1, b: 0, term };
  }
  if (stepB.includes(idA)) {
    // A is step-parent of B
    const term = isFemale(idx, idA) ? T(lang, 'stepmother') : T(lang, 'stepfather');
    return { found: true, type: 'step', kind: 'step', a: 0, b: 1, term };
  }

  // ── Spouses (current / former) ──
  const spA = spousesOf[idA] || [];
  const spLink = spA.find(s => s.id === idB);
  if (spLink) {
    if (spLink.status === 'divorced') {
      const term = isFemale(idx, idA) ? T(lang, 'ex_wife') : T(lang, 'ex_husband');
      return { found: true, type: 'former', kind: 'former', a: 0, b: 0, term };
    }
    const term = isFemale(idx, idA) ? T(lang, 'wife') : T(lang, 'husband');
    return { found: true, type: 'affine', kind: 'spouse', a: 0, b: 0, term };
  }

  // ── Blood via common ancestors ──
  const bl = bloodRel(idx, g, idA, idB, lang);
  if (bl) return bl;

  // ── Step-siblings: step-родитель одного — биологический родитель другого ──
  {
    const bioA = bioParentsOf[idA] || {};
    const bioB = bioParentsOf[idB] || {};
    const linked = (steps, bio) => steps.some(p => p === bio.father || p === bio.mother);
    if (linked(stepA, bioB) || linked(stepB, bioA)) {
      const term = isFemale(idx, idA) ? T(lang, 'step_sister') : T(lang, 'step_brother');
      return { found: true, type: 'step', kind: 'sibling', a: 1, b: 1, term };
    }
  }

  // ── In-laws (spouse of blood relative, or blood relative of spouse) ──
  const inlaw = classifyInLaw(idx, idA, idB, g, lang);
  if (inlaw) return inlaw;

  // ── Affinal uncle: spouse of blood aunt/uncle ──
  // e.g. P28 (husband of P8) → P3: P8 is aunt of P3, so P28 is uncle by marriage
  const affByMarriage = affineByMarriage(idx, idA, idB, g, lang);
  if (affByMarriage) return affByMarriage;

  return empty(T(lang, 'not_found'), 'none', 'none');
}

function directAncestorTerm(idx, idA, depth, lang, direction) {
  // direction: 'ancestor' means A is ancestor of B (A older)
  //            'descendant' means A is descendant of B (A younger)
  const male = isMale(idx, idA);
  const female = isFemale(idx, idA);
  let term;
  if (direction === 'ancestor') {
    if (depth === 1) term = female ? T(lang, 'mother') : T(lang, 'father');
    else if (depth === 2) term = female ? T(lang, 'grandmother') : T(lang, 'grandfather');
    else if (depth === 3) term = female ? T(lang, 'great_grandmother') : T(lang, 'great_grandfather');
    else term = female ? T(lang, 'ancestor_f', depth) : T(lang, 'ancestor_m', depth);
    return { found: true, type: 'blood', kind: 'ancestor', a: 0, b: depth, term };
  } else {
    if (depth === 1) term = female ? T(lang, 'daughter') : T(lang, 'son');
    else if (depth === 2) term = female ? T(lang, 'grand_daughter') : T(lang, 'grand_son');
    else if (depth === 3) term = female ? T(lang, 'great_grand_daughter') : T(lang, 'great_grand_son');
    else term = female ? T(lang, 'descendant_f', depth) : T(lang, 'descendant_m', depth);
    return { found: true, type: 'blood', kind: 'descendant', a: depth, b: 0, term };
  }
}

function siblingTerm(idx, idA, idB, bioParentsOf, stepParentsOf, parentsOf, lang) {
  const bioA = bioParentsOf[idA] || {};
  const bioB = bioParentsOf[idB] || {};
  const stepA = stepParentsOf[idA] || [];
  const stepB = stepParentsOf[idB] || [];
  const allA = new Set(parentsOf[idA] || []);
  const allB = new Set(parentsOf[idB] || []);

  const sameBioFather = bioA.father && bioA.father === bioB.father;
  const sameBioMother = bioA.mother && bioA.mother === bioB.mother;

  // Full siblings
  if (sameBioFather && sameBioMother) {
    const term = isFemale(idx, idA) ? T(lang, 'sister') : T(lang, 'brother');
    return { found: true, type: 'blood', kind: 'sibling', a: 1, b: 1, term };
  }

  // Paternal half (единокровные)
  if (sameBioFather && !sameBioMother) {
    const term = isFemale(idx, idA) ? T(lang, 'half_sister_p') : T(lang, 'half_brother_p');
    return { found: true, type: 'blood', kind: 'sibling', a: 1, b: 1, term };
  }

  // Maternal half (единоутробные)
  if (sameBioMother && !sameBioFather) {
    const term = isFemale(idx, idA) ? T(lang, 'half_sister_m') : T(lang, 'half_brother_m');
    return { found: true, type: 'blood', kind: 'sibling', a: 1, b: 1, term };
  }

  // One is step-child sharing a household parent with the other
  // → сводные if they share a parent slot but not both bio
  const shared = [...allA].filter(p => allB.has(p));
  if (shared.length) {
    // If either has step link to the shared parent → step-sibling
    const aStepShared = shared.some(p => stepA.includes(p));
    const bStepShared = shared.some(p => stepB.includes(p));
    if (aStepShared || bStepShared || (!sameBioFather && !sameBioMother)) {
      const term = isFemale(idx, idA) ? T(lang, 'step_sister') : T(lang, 'step_brother');
      return { found: true, type: 'step', kind: 'sibling', a: 1, b: 1, term };
    }
  }

  // Fallback: treat as full sibling if they share any parent
  if (shared.length) {
    const term = isFemale(idx, idA) ? T(lang, 'sister') : T(lang, 'brother');
    return { found: true, type: 'blood', kind: 'sibling', a: 1, b: 1, term };
  }

  const term = isFemale(idx, idA) ? T(lang, 'sister') : T(lang, 'brother');
  return { found: true, type: 'blood', kind: 'sibling', a: 1, b: 1, term };
}

function classifyInLaw(idx, idA, idB, g, lang) {
  const { spousesOf, parentsOf, childrenOf } = g;

  // A is spouse of child of B → A is son/daughter-in-law of B
  for (const sp of spousesOf[idA] || []) {
    const spParents = parentsOf[sp.id] || [];
    if (spParents.includes(idB)) {
      const term = isFemale(idx, idA) ? T(lang, 'daughter_in_law') : T(lang, 'son_in_law');
      return { found: true, type: 'inlaw', kind: 'inlaw', a: 0, b: 0, term };
    }
  }

  // A is parent of spouse of B → A is father/mother-in-law of B
  for (const sp of spousesOf[idB] || []) {
    const spParents = parentsOf[sp.id] || [];
    if (spParents.includes(idA)) {
      // from A's view: B is child-in-law; we need A's term relative to B
      // A is parent-in-law of B
      const bFemale = isFemale(idx, idB);
      // B — женщина → A родитель её мужа → свёкор/свекровь;
      // B — мужчина → A родитель его жены → тесть/тёща.
      const term = isFemale(idx, idA)
        ? (bFemale ? T(lang, 'mother_in_law') : T(lang, 'mother_in_law_w'))
        : (bFemale ? T(lang, 'father_in_law') : T(lang, 'father_in_law_w'));
      return { found: true, type: 'inlaw', kind: 'inlaw', a: 0, b: 0, term };
    }
  }

  // A is spouse of sibling of B → brother/sister-in-law OR зять/невестка
  // Test: P11 (husband of P6, sister of P3) → P3 = «зять»
  // In Russian, sister's husband can be called зять from the sibling's perspective
  // in some dialects; the test expects «зять».
  for (const sp of spousesOf[idA] || []) {
    const spParents = parentsOf[sp.id] || [];
    const bParents = parentsOf[idB] || [];
    // share parents → sp is sibling of B
    const share = spParents.filter(p => bParents.includes(p));
    if (share.length && sp.id !== idB) {
      // A is married to sibling of B
      // Prefer зять/невестка (son/daughter-in-law style) per test expectation
      const term = isFemale(idx, idA) ? T(lang, 'daughter_in_law') : T(lang, 'son_in_law');
      return { found: true, type: 'inlaw', kind: 'inlaw', a: 0, b: 0, term };
    }
  }

  // A is sibling of spouse of B
  for (const sp of spousesOf[idB] || []) {
    const spParents = parentsOf[sp.id] || [];
    const aParents = parentsOf[idA] || [];
    const share = spParents.filter(p => aParents.includes(p));
    if (share.length && idA !== sp.id) {
      // брат/сестра супруга(и) B: жена B → деверь/золовка, муж B → шурин/свояченица
      const bFem = isFemale(idx, idB);
      const term = isFemale(idx, idA)
        ? (bFem ? T(lang, 'sister_in_law') : T(lang, 'svoyachenitsa'))
        : (bFem ? T(lang, 'devar') : T(lang, 'brother_in_law'));
      return { found: true, type: 'inlaw', kind: 'inlaw', a: 0, b: 0, term };
    }
  }

  return null;
}

function affineByMarriage(idx, idA, idB, g, lang) {
  const { spousesOf } = g;
  // (i) супруг(а) A — дядя/тётя B → A дядя/тётя «по браку»
  for (const sp of spousesOf[idA] || []) {
    if (sp.status === 'divorced' || sp.id === idB) continue;
    const bl = bloodRel(idx, g, sp.id, idB, lang);
    if (bl && bl.kind === 'uncle') {
      const lt = lineTerm(idx, idA, bl.a, bl.b, lang);
      return { found: true, type: 'affine', kind: 'uncle', a: bl.a, b: bl.b, term: lt.term };
    }
  }
  // (ii) A — племянник/ца супруга(и) B → A племянник/ца «по браку» (зеркало к (i))
  for (const sp of spousesOf[idB] || []) {
    if (sp.status === 'divorced' || sp.id === idA) continue;
    const bl = bloodRel(idx, g, idA, sp.id, lang);
    if (bl && bl.kind === 'nibling') {
      const lt = lineTerm(idx, idA, bl.a, bl.b, lang);
      return { found: true, type: 'affine', kind: 'nibling', a: bl.a, b: bl.b, term: lt.term };
    }
  }
  return null;
}

// Кровное родство по общему предку. Возвращает результат или null.
function bloodRel(idx, g, idA, idB, lang) {
  const { parentsOf, bioParentsOf, stepParentsOf } = g;
  const ancA = ancestorDistances(idA, parentsOf);
  const ancB = ancestorDistances(idB, parentsOf);
  ancA[idA] = 0;
  ancB[idB] = 0;

  let best = null;
  for (const [anc, da] of Object.entries(ancA)) {
    if (ancB[anc] == null) continue;
    const db = ancB[anc];
    if (da === 0 && db === 0) continue;
    if (!best || da + db < best.da + best.db ||
        (da + db === best.da + best.db && Math.max(da, db) < Math.max(best.da, best.db))) {
      best = { lca: anc, da, db };
    }
  }
  if (!best) return null;
  const { da, db } = best;

  if (da === 0 && db >= 1) return directAncestorTerm(idx, idA, db, lang, 'ancestor');
  if (db === 0 && da >= 1) return directAncestorTerm(idx, idA, da, lang, 'descendant');
  if (da === 1 && db === 1) return siblingTerm(idx, idA, idB, bioParentsOf, stepParentsOf, parentsOf, lang);

  const lt = lineTerm(idx, idA, da, db, lang);
  return { found: true, type: 'blood', kind: lt.kind, a: da, b: db, term: lt.term };
}

// ─── боковые линии: дядя/тётя, племянники, двоюродные и «со сдвигом» ───
// da, db — поколений от A и от B до общего предка.
//   k = min(da,db)-1 — степень двоюродности (0 = дядя/племянник-линия)
//   r = |da-db|      — сдвиг поколений
//   closer = da<db   — A ближе к предку (старшая линия: дядя, дед…)
const RU_PRE = ['', 'двоюродн', 'троюродн', 'четвероюродн', 'пятиюродн'];
const EN_ORD = ['', 'first', 'second', 'third', 'fourth', 'fifth'];

function lineTerm(idx, idA, da, db, lang) {
  const f = isFemale(idx, idA);
  const k = Math.min(da, db) - 1;
  const r = Math.abs(da - db);
  const closer = da < db;
  const distant = { kind: 'cousin', term: T(lang, 'distant') };
  if (k < 0 || k > 4) return distant;
  const lineKind = closer ? 'uncle' : 'nibling';
  const pick = (mKey, fKey) => T(lang, f ? fKey : mKey);

  // k = 0: дядя/тётя, племянники и их «пра-» продолжения
  if (k === 0) {
    if (r === 1) return { kind: lineKind, term: closer ? pick('uncle', 'aunt') : pick('nephew', 'niece') };
    if (r === 2) return { kind: lineKind, term: closer ? pick('great_uncle', 'great_aunt') : pick('grand_nephew', 'grand_niece') };
    if (r === 3) return { kind: lineKind, term: closer ? pick('great_great_uncle', 'great_great_aunt') : pick('great_grand_nephew', 'great_grand_niece') };
    return distant;
  }
  // k = 1, сдвиг 1: двоюродный дядя/тётя (A старше) или двоюродный племянник/ца (A младше)
  if (k === 1 && r === 1) {
    return { kind: 'cousin', term: closer ? pick('cousin_uncle', 'cousin_aunt') : pick('cousin_nephew', 'cousin_niece') };
  }

  if (lang === 'en') {
    const rem = r === 0 ? '' : r === 1 ? ' once removed' : r === 2 ? ' twice removed' : ' ' + r + ' times removed';
    return { kind: 'cousin', term: EN_ORD[k] + ' cousin' + rem };
  }
  if (lang === 'he') {
    if (r === 0 && k === 1) return { kind: 'cousin', term: pick('cousin_m', 'cousin_f') };
    if (r === 0 && k === 2) return { kind: 'cousin', term: pick('cousin2_m', 'cousin2_f') };
    return distant;
  }

  // ru: степень двоюродности + сдвиг
  const pre = (n) => (RU_PRE[n] ? RU_PRE[n] + (f ? 'ая' : 'ый') : null);
  if (r === 0) {
    const p = pre(k);
    return p ? { kind: 'cousin', term: p + ' ' + (f ? 'сестра' : 'брат') } : distant;
  }
  if (r === 1) {
    const p = pre(k);
    if (!p) return distant;
    return { kind: 'cousin', term: p + ' ' + (closer ? (f ? 'тётя' : 'дядя') : (f ? 'племянница' : 'племянник')) };
  }
  if (r === 2) {
    if (closer) {
      const p = pre(k + 1);
      return p ? { kind: 'cousin', term: p + ' ' + (f ? 'бабушка' : 'дедушка') } : distant;
    }
    const p = pre(k);
    return p ? { kind: 'cousin', term: p + ' ' + (f ? 'внучатая племянница' : 'внучатый племянник') } : distant;
  }
  return distant;
}


// ─── human-readable explanation with path ─────────────────────

function pathToAncestor(startId, ancestorId, parentsOf) {
  if (startId === ancestorId) return [startId];
  const prev = {};
  const q = [startId];
  const seen = new Set([startId]);
  while (q.length) {
    const id = q.shift();
    for (const p of parentsOf[id] || []) {
      if (seen.has(p)) continue;
      seen.add(p);
      prev[p] = id;
      if (p === ancestorId) {
        const path = [ancestorId];
        let cur = ancestorId;
        while (cur !== startId) {
          cur = prev[cur];
          if (cur == null) return null;
          path.push(cur);
        }
        return path.reverse(); // start → … → ancestor
      }
      q.push(p);
    }
  }
  return null;
}

/**
 * Build a full explanation string.
 * Uses computeKinship + ancestor path when blood-related.
 */
function explainKinship(idx, idA, idB, lang, nameFn) {
  return explainKinshipWithGraph(idx, (idx && idx.nodes) ? buildGraph(idx) : null, idA, idB, lang, nameFn);
}

function explainKinshipWithGraph(idx, g, idA, idB, lang, nameFn) {
  lang = lang || 'ru';
  nameFn = nameFn || function(id) {
    return ((idx.nodes || {})[id] || {}).name || id;
  };
  const r = computeKinshipWithGraph(idx, g, idA, idB, lang);
  const nameA = nameFn(idA);
  const nameB = nameFn(idB);

  if (!r.found || r.type === 'none') {
    const msg = lang === 'he' ? (nameA + ' ו' + nameB + ' — ' + r.term)
              : lang === 'en' ? (nameA + ' and ' + nameB + ' — ' + r.term)
              : (nameA + ' и ' + nameB + ' — родство ' + r.term);
    return Object.assign({}, r, { message: msg, via: [], viaNames: [] });
  }

  if (r.type === 'self') {
    return Object.assign({}, r, { message: nameA + ' — ' + r.term, via: [], viaNames: [] });
  }

  // Main phrase: "A is <term> of B"
  let message;
  if (lang === 'he') {
    message = nameA + ' — ' + r.term + ' של ' + nameB;
  } else if (lang === 'en') {
    message = nameA + ' is the ' + r.term + ' of ' + nameB;
  } else {
    // Russian: "A — term B-genitive" when genitive available
    // Склонений пока нет — единая форма «A — <term> для B»
    message = nameA + ' — ' + r.term + ' для ' + nameB;
  }

  // Path via common ancestor for blood relations with depth
  let via = [], viaNames = [];
  if (r.type === 'blood' && (r.a + r.b) >= 2) {
    const ancA = ancestorDistances(idA, g.parentsOf);
    const ancB = ancestorDistances(idB, g.parentsOf);
    ancA[idA] = 0; ancB[idB] = 0;
    let lca = null, best = 1e9;
    for (const [anc, da] of Object.entries(ancA)) {
      if (ancB[anc] == null) continue;
      const db = ancB[anc];
      if (da === 0 && db === 0) continue;
      const s = da + db;
      if (s < best) { best = s; lca = anc; }
    }
    if (lca) {
      const pathA = pathToAncestor(idA, lca, g.parentsOf) || [idA];
      const pathB = pathToAncestor(idB, lca, g.parentsOf) || [idB];
      // full chain A → … → LCA → … → B (skip duplicate LCA)
      via = pathA.concat(pathB.slice(0, -1).reverse());
      viaNames = via.map(nameFn);
      if (lang === 'he') {
        message += '\n' + viaNames.join(' ← ');
      } else if (lang === 'en') {
        message += '\nvia: ' + viaNames.join(' → ');
      } else {
        message += '\nчерез: ' + viaNames.join(' → ');
      }
    }
  }

  // For in-laws / affine, mention the linking spouse when possible
  if ((r.type === 'inlaw' || r.type === 'affine') && r.kind !== 'spouse') {
    const spA = g.spousesOf[idA] || [];
    const spB = g.spousesOf[idB] || [];
    let link = null;
    for (const s of spA) {
      // spouse of A is blood-related to B
      const rr = computeKinshipWithGraph(idx, g, s.id, idB, lang);
      if (rr.found && rr.type === 'blood') { link = s.id; break; }
    }
    if (!link) {
      for (const s of spB) {
        const rr = computeKinshipWithGraph(idx, g, idA, s.id, lang);
        if (rr.found && rr.type === 'blood') { link = s.id; break; }
      }
    }
    if (link) {
      const nLink = nameFn(link);
      if (lang === 'he') message += '\nדרך: ' + nLink;
      else if (lang === 'en') message += '\nthrough: ' + nLink;
      else message += '\nчерез: ' + nLink;
      via = [link];
      viaNames = [nLink];
    }
  }

  return Object.assign({}, r, { message: message, via: via, viaNames: viaNames });
}


// ─── exports ─────────────────────────────────────────────────────
const api = { computeKinship, explainKinship, computeKinshipWithGraph, explainKinshipWithGraph, buildGraph, TERMS };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}
if (typeof window !== 'undefined') {
  window.TreeKinship = api;
}
