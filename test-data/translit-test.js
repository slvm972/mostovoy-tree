// test-data/translit-test.js — запуск: node test-data/translit-test.js
const T = require('../public/tree-translit.js');
let fail = 0;
const eq = (label, got, exp) => { if(got !== exp){ fail++; console.log('✗', label, '→', JSON.stringify(got), '(ожидалось', JSON.stringify(exp)+')'); } };

// 1. ru -> en
eq('ru→en Мостовой', T.autoEnglish('Мирослав Мостовой'), 'Miroslav Mostovoy');
eq('ru→en Щиглик', T.autoEnglish('Фима Щиглик'), 'Fima Shchiglik');
eq('ru→en -ий', T.autoEnglish('Борис Рогинский'), 'Boris Roginsky');
eq('ru→en Дмитрий', T.autoEnglish('Дмитрий'), 'Dmitry');
eq('ru→en Евгений', T.autoEnglish('Евгений Гинзбург'), 'Evgeny Ginzburg');
eq('ru→en Юрий короткое', T.autoEnglish('Ий'), 'Iy');
eq('ru→en дефис', T.autoEnglish('Анна-Мария Рогинская'), 'Anna-Mariya Roginskaya');
// 2. en -> ru
eq('en→ru Mikhail', T.autoRussian('Mikhail Berman'), 'Михаил Берман');
eq('en→ru dict Alexander', T.autoRussian('Alexander Goldberg'), 'Александр Голдберг');
eq('en→ru Wright=null', T.autoRussian('Jack Wright'), null);
// 3. he -> en: словарь
eq('he dict Yakov', T.autoEnglish('יעקב'), 'Yakov');
eq('he dict имя+фамилия-словарь', T.autoEnglish('אלכסנדר'), 'Alexander');
// 4. he -> en: эвристика (эталон — ваши NAMES)
const pairs = [
 ['מוסטובוי','Mostovoy'],['מוסטובאיה','Mostovaya'],['ולאדיק','Vladik'],['איגור','Igor'],
 ['ויקה','Vika'],['מירוסלב','Miroslav'],['לייצס','Leytsis'],['ברמן','Berman'],['גינזבורג','Ginzburg'],
 ['קולניצקי','Kolnitsky'],['יאנובסקי','Yanovsky'],['פייסחוביץ','Peysakhovich'],['ז\'ורחינסקי','Zhurakhinsky'],
 ['אנפולסקי','Anapolsky'],['שצ\'יגליק','Shchiglik'],['קנדיבה','Kandyba'],['דימה','Dima'],['מיטיה','Mitya']
];
console.log('\n— эвристика he→en (получено | эталон из NAMES | статус) —');
let ok=0, nullc=0, wrong=0;
for(const [he,en] of pairs){
  const got = T.autoEnglish(he);
  const st = got===null ? 'null→покажет иврит' : (got===en ? 'OK' : 'ПРИБЛИЗИТЕЛЬНО');
  if(got===null) nullc++; else if(got===en) ok++; else wrong++;
  console.log(he.padEnd(14), String(got).padEnd(16), en.padEnd(14), st);
}
console.log(`итого: точно ${ok}, null ${nullc}, приблизительно ${wrong} из ${pairs.length}`);

// 5. resolveName: таблица цепочки
const NAMES = { P1:{en:'Yakov Mostovoy', he:'יעקב מוסטובוי'}, P313:{en:'Igor Berman'} };
const nodes = {
  P1:  {name:'Яков Мостовой'},
  P313:{name:'Игорь Берман'},
  P90: {name:'משה כהן', name_en:'Moshe Cohen'},   // введено на иврите
  P91: {name:'Mikhail Berman'},                     // введено на английском
  P92: {name:'Мария Иванова', name_he:'מריה איבנובה'},
  P93: {name:'אבא בלבלב'},                           // иврит, эвристика не уверена
};
const R = (id,l) => T.resolveName(nodes[id], id, l, NAMES);
eq('P1 ru',  R('P1','ru'),  'Яков Мостовой');
eq('P1 en (NAMES)', R('P1','en'), 'Yakov Mostovoy');
eq('P1 he (NAMES)', R('P1','he'), 'יעקב מוסטובוי');
eq('P313 he → EN (нет he в NAMES)', R('P313','he'), 'Igor Berman');
eq('P90 ru → name_en', R('P90','ru'), 'Moshe Cohen');
eq('P90 he → оригинал', R('P90','he'), 'משה כהן');
eq('P91 ru → авто en→ru', R('P91','ru'), 'Михаил Берман');
eq('P91 he → английский', R('P91','he'), 'Mikhail Berman');
eq('P92 he → ручной', R('P92','he'), 'מריה איבנובה');
eq('P92 en → авто', R('P92','en'), 'Mariya Ivanova');
eq('P93 en → оригинал при неуверенности', R('P93','en'), 'אבא בלבלב');
eq('P93 ru → оригинал', R('P93','ru'), 'אבא בלבלב');
console.log('variants P91:', T.nameVariants(nodes.P91,'P91',NAMES));
console.log(fail ? `\n❌ провалов: ${fail}` : '\n✅ все проверки цепочки пройдены');
process.exit(fail?1:0);
