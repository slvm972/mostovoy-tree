# Спецификация модели данных — Семейное дерево
## Версия 1.0 · Июнь 2026 · Составлено на основе аудита (Q2)

---

## 1. Обзор

Модель описывает генеалогическое дерево одной семьи. Текущая реализация — единый JSON-объект `IDX`, встроенный в HTML-файл. Этот документ фиксирует текущую структуру и определяет целевую схему базы данных для Фазы 2 (API-управляемые данные) и Фазы 4 (мультитенантность).

Текущий объём: **188 персон, 66 семей**, 6 top-level секций.

---

## 2. Текущая структура IDX

```
IDX = {
  nodes:       { [personId]: Person }
  families:    { [familyId]: Family }
  child_of:    { [personId]: familyId }     // singular — семья где эта персона ребёнок
  parent_in:   { [personId]: [familyId] }   // multiple — семьи где эта персона родитель
  relatives:   { [personId]: Relatives }    // денормализованный кэш для рендера
  grandparents:{ [personId]: [...] }        // кэш бабушек/дедушек
}
```

---

## 3. Схема Person (персона)

### Обязательные поля
| Поле | Тип | Пример | Описание |
|---|---|---|---|
| `id` | string | `"P3"` | Уникальный ID в формате P + число |
| `name` | string | `"Мирослав Мостовой"` | Полное имя на русском |
| `sex` | `"M"` / `"F"` / `""` | `"M"` | Биологический пол |
| `gen` | integer | `3` | Поколение (0 = прародители, возрастает вниз) |
| `missing` | string[] | `["дата рождения"]` | Список отсутствующих данных |

### Опциональные поля
| Поле | Тип | Пример | Описание |
|---|---|---|---|
| `birth` | string | `"9 OCT 1970"` | Дата рождения (формат: `DD MON YYYY`, `MON YYYY`, или `YYYY`) |
| `death` | string | `"12 JAN 2023"` | Дата смерти. Пустая строка = жив(а) |
| `birth_he` | string | `"יג ניסן תשל׳א"` | Дата рождения по еврейскому календарю |
| `death_he` | string | — | Дата смерти по еврейскому календарю |
| `hebrew_name` | string | `"יעקב"` | Еврейское имя |
| `rel` | string | `"Зять"` | Степень родства к составителю (свободный текст) |
| `phone` | string | `"054-202-1714"` | Телефон(ы), разделены запятой |
| `email` | string | `"user@mail.com"` | Email(ы), разделены запятой |
| `social` | string | `"https://fb.com/..."` | Страницы в соц.сетях, разделены запятой |
| `bio` | string | — | Биография (свободный текст) |
| `photo` | string | — | URL фото |

### Форматы дат
Принимаются три формата в порядке убывания точности:
- `"9 OCT 1970"` — день-месяц-год (месяц в верхнем регистре, 3 буквы: JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC)
- `"OCT 1970"` — месяц-год
- `"1970"` — только год

### Правило "жив/мёртв"
Персона считается **живой** если `death` равно `""` или не определено.
Персона считается **умершей** если `death` содержит любой непустой текст.

---

## 4. Схема Family (семья/брак)

```json
{
  "id": "F1",
  "husband": "P1",   // ID персоны (может быть null если неизвестен)
  "wife": "P2",      // ID персоны (может быть null если неизвестна)
  "children": ["P3", "P6"]  // упорядочены по дате рождения
}
```

### Важные правила
- Семья может существовать с одним из супругов (`husband: null` или `wife: null`) — это значит второй родитель неизвестен
- Одна персона может быть `husband/wife` в нескольких семьях (повторные браки) — это поддерживается через `parent_in`
- Порядок элементов в `children[]` определяет порядок отображения (по году рождения)

### Ограничение текущей модели
Поля `husband`/`wife` предполагают разнополый брак. Для нейтральности в будущей базе данных переименовать в `parent1`/`parent2`.

---

## 5. Схема Relatives (денормализованный кэш)

```json
{
  "parents":  ["P1", "P2"],    // непосредственные родители
  "siblings": ["P6"],          // братья и сёстры (от тех же родителей)
  "spouses":  ["P254", "P247"], // порядок = порядок браков (хронологический)
  "children": ["P255", "P256", "P257", "P258"]  // все дети, от всех браков
}
```

**Это денормализованный кэш** — вычисляется из `families`, хранится для быстрого доступа при рендере. В базе данных не потребуется — будет вычисляться на лету SQL-запросами.

---

## 6. Вспомогательные секции

### child_of
`{ personId → familyId }` — семья где эта персона является ребёнком. Сингулярное значение (один человек может быть ребёнком только одной семьи).

### parent_in
`{ personId → [familyId, ...] }` — семьи где эта персона является родителем. Массив (поддерживает несколько браков).

### grandparents
`{ personId → [parentId, ...] }` — кэш прародителей для быстрого отображения в шапке дерева.

---

## 7. Целевая схема реляционной базы данных (Фаза 2/4)

```sql
-- Семьи (tenants в мультитенантной версии)
CREATE TABLE families_tree (
  id          TEXT PRIMARY KEY,   -- "mostovoy", "cohen-family", etc.
  title       TEXT,               -- "Дерево Мостовых"
  created_at  TIMESTAMP,
  owner_email TEXT
);

-- Персоны
CREATE TABLE persons (
  id          TEXT,
  family_id   TEXT REFERENCES families_tree(id),
  name        TEXT NOT NULL,
  sex         TEXT CHECK(sex IN ('M','F','')),
  gen         INTEGER,
  birth       TEXT,
  death       TEXT,
  birth_he    TEXT,
  death_he    TEXT,
  hebrew_name TEXT,
  rel_label   TEXT,              -- степень родства (отображаемый текст)
  phone       TEXT,
  email       TEXT,
  social      TEXT,
  bio         TEXT,
  photo       TEXT,
  missing     TEXT,              -- JSON array as text, или отдельная таблица
  created_at  TIMESTAMP,
  updated_at  TIMESTAMP,
  PRIMARY KEY (id, family_id)
);

-- Брачные союзы
CREATE TABLE marriages (
  id          TEXT,
  family_id   TEXT REFERENCES families_tree(id),
  parent1_id  TEXT REFERENCES persons(id, family_id),  -- вместо husband
  parent2_id  TEXT REFERENCES persons(id, family_id),  -- вместо wife
  order_index INTEGER DEFAULT 0,                        -- порядок брака (для повторных)
  PRIMARY KEY (id, family_id)
);

-- Дети
CREATE TABLE children (
  marriage_id  TEXT,
  family_id    TEXT,
  person_id    TEXT,
  birth_order  INTEGER,
  PRIMARY KEY (marriage_id, person_id, family_id)
);

-- История изменений (для admin.html и будущего аудита)
CREATE TABLE change_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  family_id   TEXT,
  person_id   TEXT,
  field       TEXT,
  old_value   TEXT,
  new_value   TEXT,
  changed_by  TEXT,
  changed_at  TIMESTAMP
);
```

---

## 8. Перечень ограничений текущей модели (для решения в Фазе 2+)

| Ограничение | Текущее состояние | Решение в Фазе 2 |
|---|---|---|
| Нет типа усыновления | нет поля | Добавить `relationship_type: 'biological'|'adopted'|'foster'` в `children` |
| `husband/wife` предполагает пол | хардкод | Переименовать в `parent1/parent2` |
| Нет дат браков | нет поля | Добавить `married_at`, `divorced_at` в `marriages` |
| Нет истории изменений | нет | Таблица `change_log` |
| Один tenant (одна семья) | да | `family_id` как ключ партиционирования |
| Нет версионности данных | нет | Поле `updated_at` + `change_log` |
| Перевод имён в NAMES dict | отдельно от IDX | В базе: отдельная таблица `person_names` с колонкой `lang` |

---

## 9. NAMES dict (переводы имён)

```json
NAMES = {
  "P1": { "en": "Yakov Mostovoy", "he": "יעקב מוסטובוי" },
  ...
}
```

В базе данных это станет:
```sql
CREATE TABLE person_names (
  person_id  TEXT,
  family_id  TEXT,
  lang       TEXT,   -- 'ru', 'en', 'he'
  name       TEXT,
  PRIMARY KEY (person_id, family_id, lang)
);
```

---

## 10. API-контракт (реализовано — статус на текущую дату)

Все endpoints реализованы в Cloudflare Worker (`src/index.js`), развёрнуты на `https://mostovoy-tree.slvm972.workers.dev`.

### Публичные (без авторизации)
```
GET  /calendar.ics                → ICS-фид дней рождения (только живые персоны)
GET  /contacts.vcf                → VCF-файл контактов (только живые персоны)
```

### Требуют пароль (заголовок `X-Password`, любая роль)
```
GET  /api/tree                    → полный IDX в JSON
```

### Требуют роль admin
```
POST /api/login                   → { password } → { ok, role: 'admin'|'guest' }

PATCH  /api/person/:id            → изменить поля персоны
       Body: { name?, birth?, death?, birth_he?, death_he?, hebrew_name?,
                sex?, rel?, phone?, email?, social?, bio?, photo?, missing? }
       Разрешённые поля (ALLOWED whitelist) — попытка изменить структурные
       поля (id, gen) игнорируется. Значение null удаляет поле.
       Автоматически создаёт бэкап перед изменением (хранит последние 10).

POST   /api/person                → создать новую персону
       Body: { name, sex?, birth?, death?, rel?, phone?, email?, social?, ... }
       ID генерируется автоматически (max существующего P-номера + 1).
       Инициализирует пустую запись в relatives.

DELETE /api/person/:id            → удалить персону
       Отказывает (409) если у персоны есть дети — требует сначала
       переназначить их через PATCH /api/family.
       Очищает все ссылки в relatives/families при успехе.

POST   /api/family                → создать новый брак/семью
       Body: { parent1?, parent2?, children?: [] }
       Проверяет что все указанные ID существуют.
       Автоматически обновляет relatives (spouses, parents, children,
       siblings) у всех участников.

PATCH  /api/family/:id            → изменить существующую семью
       Body: { addChild?, removeChild?, parent1?, parent2? }
       addChild — добавляет ребёнка + обновляет siblings у всех детей
       в этой семье.

DELETE /api/family/:id            → удалить семью
       Отказывает (409) если есть дети.
       Очищает spouses-связь у бывших супругов (если не связаны
       другим браком).

POST   /api/proposal              → сохранить предложение от гостя (email fallback)
GET    /api/proposals             → список предложений (для admin.html)
GET    /api/backups               → список автобэкапов
GET    /api/backup/:key           → скачать конкретный бэкап
```

### Соответствие фронтенд ↔ Worker
Фронтенд (`tree_a4a.html`) и Worker используют идентичные имена полей
(`parent1`/`parent2`, `addChild`, `X-Password` заголовок) — проверено
сквозным тестом в ходе миграции (см. раздел 12).


## 11. Архитектура загрузки данных (реализовано)

Дерево больше не хранит данные статично в HTML. При каждом открытии страницы:

```
1. Проверка sessionStorage на сохранённый пароль
   ├─ Есть пароль → GET /api/tree с X-Password
   │   ├─ Успех → IDX = данные с сервера (актуальные)
   │   └─ Ошибка/офлайн → IDX = FALLBACK_DATA (встроенный снапшот)
   └─ Нет пароля → IDX = FALLBACK_DATA (публичный просмотр без входа)

2. buildDatalist() — построение автокомплита из IDX.nodes
3. navigateTo('P3') — отрисовка дерева с фокусом на составителе
4. applyLang(currentLang) — перевод интерфейса (автоопределение по
   navigator.language: he→иврит, ru/uk→русский, остальное→английский)
```

`FALLBACK_DATA` — снапшот IDX на момент последнего деплоя, встроенный
в HTML как аварийный запасной вариант. Обновляется вручную через
`admin.html` → «Загрузить дерево» (парсит текущий `IDX`/`FALLBACK_DATA`
из HTML-файла и сохраняет в KV).

### Аутентификация на клиенте
```javascript
_sessionPassword   // пароль текущей сессии (или '')
window._userRole   // 'admin' | 'guest' | null
```
Устанавливаются в `doLogin()` после успешного `POST /api/login` +
`GET /api/tree`. Сохраняются в `sessionStorage` (переживают перезагрузку
страницы, но не новую вкладку/сессию браузера).

### Прямая запись vs email — правило разделения
Каждый обработчик формы проверяет:
```javascript
const isAdminDirect = !!(_sessionPassword && window._userRole === 'admin' && WORKER_URL);
```
При `true` — вызывает API напрямую и делает optimistic update локального
`IDX` (плюс синхронизирует `FALLBACK_DATA`). При `false` — генерирует
email-текст как раньше. Кнопка «Сформировать» в модале динамически
меняет подпись (`updateGenerateButtonLabel()`) в зависимости от роли
и типа формы, чтобы пользователь заранее видел какой путь сработает.

---

## 12. Статус миграции по типам форм

| Форма (`currentType`) | Прямая запись | API endpoint | Комментарий |
|---|---|---|---|
| `person` (новый человек) | ✅ | `POST /api/person` + `PATCH /api/family` (если указана связь) | Связь «ребёнок/жена/муж/родитель» обрабатывается `linkNewPersonToFamily()` |
| `fix` (исправить) | ✅ | `PATCH /api/person/:id` | Отправляет только реально изменённые поля (сравнение с исходником) |
| `photo` | ✅ | `PATCH /api/person/:id` (`photo`) | — |
| `bio` | ✅ | `PATCH /api/person/:id` (`bio`) | URL источника объединяется с текстом в одно поле |
| `date` (дата/место, уточнение) | ❌ намеренно | — | Свободный текст без структурированного поля — требует ручной интерпретации перед внесением |
| Семейная связь (`ff-family` в форме «Исправить») | ❌ намеренно | — | Структурные изменения существующих связей — только email для проверки человеком |
| Удаление персоны | ✅ (UI в панели) | `DELETE /api/person/:id` | Кнопка видна только admin и только если у персоны нет детей; клиент также блокирует попытку с понятным сообщением до обращения к серверу |

**Итог:** «бытовые» правки (даты, контакты, фото, добавление человека со
связью) полностью автоматизированы. Структурно неоднозначные изменения
(смена родителей у существующего человека, свободнотекстовые уточнения)
осознанно оставлены под контролем администратора через email-подтверждение.
