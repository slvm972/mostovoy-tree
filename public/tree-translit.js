// tree-translit.js — автотранслитерация имён персон.
// Схема: английский — язык-мост.
//   RU-страница, имя введено на иврите  -> английский вариант
//   HE-страница, нет ручного name_he     -> английский вариант
//   EN-страница                          -> авто ru->en / he->en
//   RU-страница, имя введено латиницей   -> авто en->ru (если надёжно)
// Ручные name_ru / name_en / name_he и записи NAMES[id] ВСЕГДА главнее автоматики.
// Если автоматика не уверена (иврит без словарной записи и с сомнительным
// результатом) — возвращается null, и вызывающий код показывает исходное имя.
// Файл содержит только const/function (+ защищённый module.exports для node-тестов).

// ── Определение алфавита ──────────────────────────────────
function detectScript(s){
  if(!s) return 'empty';
  if(/[\u0590-\u05FF]/.test(s)) return 'hebrew';
  if(/[\u0400-\u04FF]/.test(s)) return 'cyrillic';
  if(/[a-zA-Z]/.test(s)) return 'latin';
  return 'other';
}

// ── ru -> en ──────────────────────────────────────────────
const TRANSLIT_LAT = {
  'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'yo','ж':'zh',
  'з':'z','и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o',
  'п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts',
  'ч':'ch','ш':'sh','щ':'shch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya',
  'А':'A','Б':'B','В':'V','Г':'G','Д':'D','Е':'E','Ё':'Yo','Ж':'Zh',
  'З':'Z','И':'I','Й':'Y','К':'K','Л':'L','М':'M','Н':'N','О':'O',
  'П':'P','Р':'R','С':'S','Т':'T','У':'U','Ф':'F','Х':'Kh','Ц':'Ts',
  'Ч':'Ch','Ш':'Sh','Щ':'Shch','Ъ':'','Ы':'Y','Ь':'','Э':'E','Ю':'Yu','Я':'Ya'
};
function cyrillicToEnglish(name){
  if(!name) return name;
  return name.split('').map(c => TRANSLIT_LAT[c] !== undefined ? TRANSLIT_LAT[c] : c).join('');
}

// ── en -> ru ──────────────────────────────────────────────
// Сначала словарь частых английских написаний (там, где механика
// не работает: x, j, c, w, h, q), затем механическая таблица.
// Если хоть одна буква не раскладывается — null (не гадаем).
const EN_NAME_TO_RU = {
  'alexander':'Александр','alexey':'Алексей','alex':'Алекс','andrew':'Андрей','anna':'Анна',
  'david':'Давид','daniel':'Даниил','dmitry':'Дмитрий','eugene':'Евгений','elena':'Елена',
  'helen':'Елена','igor':'Игорь','irina':'Ирина','jacob':'Яков','john':'Джон','joseph':'Иосиф',
  'julia':'Юлия','yulia':'Юлия','leonid':'Леонид','lev':'Лев','maria':'Мария','mark':'Марк',
  'max':'Макс','maxim':'Максим','michael':'Михаил','mikhail':'Михаил','natalia':'Наталья',
  'nikolay':'Николай','olga':'Ольга','paul':'Павел','pavel':'Павел','peter':'Пётр','sergey':'Сергей',
  'sofia':'София','sophia':'София','svetlana':'Светлана','tatyana':'Татьяна','victoria':'Виктория',
  'vladimir':'Владимир','vladislav':'Владислав','boris':'Борис','mila':'Мила','roman':'Роман',
  'ilya':'Илья','oleg':'Олег','semyon':'Семён','simon':'Семён','jonathan':'Джонатан','michelle':'Мишель',
  'emily':'Эмили','brandon':'Брэндон','stanley':'Стэнли','sean':'Шон','jack':'Джек','james':'Джеймс',
  'robert':'Роберт','william':'Уильям','mary':'Мэри','sarah':'Сара','rachel':'Рэйчел','rebecca':'Ребекка'
};
const LAT_TO_CYR_TABLE = [
  ['shch','щ'],['kh','х'],['ts','ц'],['ch','ч'],['sh','ш'],
  ['yo','ё'],['zh','ж'],['yu','ю'],['ya','я'],
  ['a','а'],['b','б'],['v','в'],['g','г'],['d','д'],['e','е'],
  ['z','з'],['i','и'],['y','й'],['k','к'],['l','л'],['m','м'],
  ['n','н'],['o','о'],['p','п'],['r','р'],['s','с'],['t','т'],
  ['u','у'],['f','ф']
].sort((a,b) => b[0].length - a[0].length);

function latinWordToCyrillic(word){
  const dict = EN_NAME_TO_RU[word.toLowerCase()];
  if(dict) return dict;
  let result = '', i = 0;
  const lower = word.toLowerCase();
  while(i < word.length){
    const ch = word[i];
    if(!/[a-zA-Z]/.test(ch)){ result += ch; i++; continue; }
    let matched = false;
    for(const [lat, cyr] of LAT_TO_CYR_TABLE){
      if(lower.slice(i, i+lat.length) === lat){
        const isUpper = ch === ch.toUpperCase() && ch !== ch.toLowerCase();
        result += isUpper ? (cyr[0].toUpperCase() + cyr.slice(1)) : cyr;
        i += lat.length; matched = true; break;
      }
    }
    if(!matched) return null;
  }
  return result;
}
function latinToCyrillic(name){
  if(!name) return null;
  const out = [];
  for(const w of name.split(/(\s+)/)){
    if(/^\s+$/.test(w) || !w){ out.push(w); continue; }
    // слова вида "(jr.)", "Ben-Zion": обрабатываем кусками по дефису
    const parts = w.split(/(-)/).map(p => p === '-' ? p : latinWordToCyrillic(p));
    if(parts.some(p => p === null)) return null;
    out.push(parts.join(''));
  }
  return out.join('');
}

// ── he -> en ──────────────────────────────────────────────
// Уровень 1: словарь частых имён (слово целиком, без огласовок).
const HE_NAME_TO_EN = {
  'יעקב':'Yakov','משה':'Moshe','אברהם':'Avraham','יצחק':'Yitzhak','יוסף':'Yosef','דוד':'David',
  'שלמה':'Shlomo','יהודה':'Yehuda','בנימין':'Binyamin','אליהו':'Eliyahu','חיים':'Chaim','מאיר':'Meir',
  'שמואל':'Shmuel','אהרון':'Aharon','נתן':'Natan','דניאל':'Daniel','אליעזר':'Eliezer','מנחם':'Menachem',
  'נתניאל':'Nataniel','שמחה':'Simcha','לוי':'Levi','רבקה':'Rivka','שרה':'Sara','רחל':'Rachel',
  'לאה':'Leah','מרים':'Miriam','חנה':'Hana','אסתר':'Esther','רות':'Ruth','דבורה':'Devora',
  'שולמית':'Shulamit','נעמי':'Naomi','יעל':'Yael','תמר':'Tamar','מיכל':'Michal','דינה':'Dina',
  'נועה':'Noa','אורי':'Uri','עמית':'Amit','יונתן':'Yonatan','אלי':'Eli','עדי':'Adi','גל':'Gal',
  'רון':'Ron','רן':'Ran','ליאור':'Lior','תומר':'Tomer','איתי':'Itay','אורית':'Orit','רונית':'Ronit',
  'אלכסנדר':'Alexander','אלכסיי':'Alexey','מיכאיל':'Mikhail','מיכאל':'Mikhael','סרגיי':'Sergey',
  'דמיטרי':'Dmitry','ולדימיר':'Vladimir','ולאדימיר':'Vladimir','ולאדיסלב':'Vladislav','בוריס':'Boris',
  'לאוניד':'Leonid','יבגני':'Evgeny','יבגניה':'Evgenia','אנה':'Anna','אלנה':'Elena','מריה':'Maria',
  'אולגה':'Olga','נטליה':'Natalia','סבטלנה':'Svetlana','טטיאנה':'Tatyana','איגור':'Igor',
  'אנטולי':'Anatoly','גריגורי':'Grigory','ויקטוריה':'Victoria','יוליה':'Yulia','אירינה':'Irina',
  'אירה':'Ira','לודמילה':'Lyudmila','מירוסלב':'Miroslav','סלבה':'Slava','לב':'Lev','פבל':'Pavel',
  'ניקולאי':'Nikolay','ארקדי':'Arkady','מקסים':'Maxim','דניס':'Denis','אנדריי':'Andrey','רומן':'Roman',
  'אילנה':'Ilana','סוניה':'Sonya','מאשה':'Masha','מישה':'Misha','סשה':'Sasha','זינה':'Zina',
  'ליזה':'Liza','לנה':'Lena','לניה':'Lenya','ולאדיק':'Vladik','אלה':'Alla',
  'סטניסלב':'Stanislav','סמיון':'Semyon','קלרה':'Klara','רוזה':'Roza','רוזליה':'Rozalia',
  'ליובה':'Lyuba','ליודה':'Lyuda','סופיה':'Sofia','מאיה':'Maya','פולינה':'Polina','קריסטינה':'Kristina',
  'מרגריטה':'Margarita','אמיליה':'Emiliya','אלאונורה':'Eleonora','יוסטין':'Yustin','אליזבת':'Elizabeth',
  "ג'ורג'":'George'
};
const HE_LETTER = {
  'ג':'g','ד':'d','ז':'z','ט':'t','ס':'s','ל':'l','מ':'m','ם':'m','נ':'n','ן':'n',
  'פ':'p','ף':'f','צ':'ts','ץ':'ts','ק':'k','ר':'r','ש':'sh','ת':'t','ח':'kh','כ':'k','ך':'kh'
};
const HE_GERESH = { 'ז':'zh','צ':'ch','ץ':'ch','ג':'j','ח':'kh','ת':'th','ש':'sh' };

function heNormalize(w){
  return w.replace(/[\u0591-\u05C7]/g, '')       // огласовки и тонические знаки
          .replace(/[\u05F3\u2019\u2018`]/g, "'") // геreш и похожие апострофы -> '
          .replace(/[\u05F4"]/g, '');             // гершаим/кавычки (акронимы) убираем
}

// Уровень 2: механическая эвристика. Возвращает строку или null.
function heWordHeuristic(raw){
  let w = heNormalize(raw);
  if(!w || /[^\u05D0-\u05EA']/.test(w)) return null;
  // Русские отчества/фамилии на -вич: ...ביץ -> ...vich (отдельный суффикс,
  // иначе ץ даёт 'ts' и получается «-vits»)
  let suffix = '';
  if(/ביץ$/.test(w) && w.length > 3){ w = w.slice(0, -3); suffix = 'vich'; }
  const V = 'aeiouy';
  const last = w.replace(/'/g,'').length - 1;
  let out = '', li = -1, skippedInitialAleph = false;
  for(let i = 0; i < w.length; i++){
    const ch = w[i];
    if(ch === "'") continue;
    li++;
    const prevL = li > 0 ? w.replace(/'/g,'')[li-1] : '';
    const nextCh = w[i+1];
    const nextL  = w.replace(/'/g,'')[li+1] || '';
    const endsWord = li === last;
    const lastOut = out.slice(-1);
    // буква с гершем (ז' ч' ג' ...)
    if(nextCh === "'" && HE_GERESH[ch]){ out += HE_GERESH[ch]; continue; }
    switch(ch){
      case 'א':
        if(li === 0 && nextL === 'י'){ skippedInitialAleph = true; break; }
        out += 'a'; break;
      case 'ע': out += 'a'; break;
      case 'ב':
        if(endsWord) out += 'v';
        else out += (li > 0 && V.includes(lastOut)) ? 'v' : 'b';
        break;
      case 'ו':
        if(nextL === 'ו'){ out += 'v'; i++; li++; break; }       // וו -> v
        if(li === 0) out += 'v';
        else if(prevL === 'א' || prevL === 'י') out += 'v';
        else out += 'o';
        break;
      case 'י':
        if(li === 0) out += 'y';
        else if(skippedInitialAleph && li === 1) out += 'i';
        else if(prevL === 'א') out += 'y';
        else if(endsWord) out += (prevL === 'ו') ? 'y' : 'i';
        else out += 'i';
        break;
      case 'ה':
        out += endsWord ? 'a' : 'h'; break;
      default:
        if(HE_LETTER[ch] !== undefined) out += HE_LETTER[ch]; else return null;
    }
  }
  out = out.replace(/ski$/, 'sky').replace(/skii$/, 'sky') + suffix;
  // ── проверка уверенности ──
  const tmp = out.replace(/(sh|kh|zh|ts|ch|th)/g, 'X');
  if(!/[aeiouy]/.test(tmp)) return null;                      // нет гласных
  if(/[bcdfghjklmnpqrstvwxzX]{3,}/.test(tmp)) return null;      // 3+ согласных подряд
  if(/[bcdfghjklmnpqrstvwxzX]{2}$/.test(tmp)) return null;      // кластер в конце слова
  if(tmp.length < 2) return null;
  return out.charAt(0).toUpperCase() + out.slice(1);
}

function hebrewWordToEnglish(word){
  const key = heNormalize(word);
  if(HE_NAME_TO_EN[key]) return HE_NAME_TO_EN[key];
  return heWordHeuristic(word);
}

// Имя целиком: слова через пробел/дефис. Если хоть одно слово не удалось —
// null целиком (не смешиваем алфавиты в одном имени).
function hebrewToEnglish(name){
  if(!name) return null;
  const out = [];
  for(const tok of name.split(/(\s+)/)){
    if(!tok) continue;
    if(/^\s+$/.test(tok)){ out.push(tok); continue; }
    const parts = tok.split(/(-)/).map(p => {
      if(p === '-') return p;
      if(/^[()\[\]]*$/.test(p)) return p;
      const m = p.match(/^([(\[]*)(.*?)([)\]]*)$/);
      const r = hebrewWordToEnglish(m[2]);
      return r === null ? null : (m[1] + r + m[3]);
    });
    if(parts.some(p => p === null)) return null;
    out.push(parts.join(''));
  }
  return out.join('');
}

// ── Авто-варианты для одной персоны ───────────────────────
// Английский вариант из n.name (null — если автоматика не уверена)
function autoEnglish(name){
  switch(detectScript(name)){
    case 'cyrillic': return cyrillicToEnglish(name);
    case 'hebrew':   return hebrewToEnglish(name);
    case 'latin':    return name;
    default:         return null;
  }
}
// Русский вариант: только для имени, введённого латиницей
function autoRussian(name){
  return detectScript(name) === 'latin' ? latinToCyrillic(name) : null;
}

// ════════════════════════════════════════════════════════
//  resolveName — единая точка выбора имени для показа.
//  Приоритет: ручное поле -> NAMES[id] -> авто -> оригинал n.name.
//  names — словарь NAMES (может быть пустым объектом).
// ════════════════════════════════════════════════════════
function resolveName(n, id, lang, names){
  if(!n) return id;
  const d = (names && names[id]) || {};
  const manual = n['name_' + lang] || d[lang];
  if(manual) return manual;
  const script = detectScript(n.name);

  if(lang === 'ru'){
    if(script === 'cyrillic' || script === 'other' || script === 'empty') return n.name;
    if(script === 'latin') return autoRussian(n.name) || n.name;
    // иврит -> английский вариант (мост); если и его нет — оригинал
    return resolveName(n, id, 'en', names) || n.name;
  }
  if(lang === 'en'){
    if(script === 'latin') return n.name;
    return autoEnglish(n.name) || n.name;
  }
  // he
  if(script === 'hebrew') return n.name;
  return resolveName(n, id, 'en', names) || n.name;
}

// Все варианты имени для поиска (без дублей, в нижнем регистре не приводим)
function nameVariants(n, id, names){
  const set = new Set();
  if(!n) return [];
  if(n.name) set.add(n.name);
  for(const l of ['ru','en','he']){
    const v = resolveName(n, id, l, names);
    if(v) set.add(v);
  }
  return [...set];
}

if(typeof module !== 'undefined' && module.exports){
  module.exports = { detectScript, cyrillicToEnglish, latinToCyrillic, hebrewToEnglish,
                     autoEnglish, autoRussian, resolveName, nameVariants };
}
