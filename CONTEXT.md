# Patent-Scan / Antepatent — Agent Context

**Единая точка входа для любого AI-агента или нового разработчика.** Если ты только открыл репозиторий — прочитай этот файл целиком, потом переходи к ссылкам ниже. Файл версионируется в git, читается независимо от cwd или памяти агента.

**Последнее обновление:** 2026-06-02 (полный рефреш, ap-coder — после рассинхрона, найденного ap-qa)

> **Источники истины (при конфликте — они главнее этого файла):**
> - Продукты / IA / нейминг / цены → `Antepatent/calibration-reference/CANON-products-IA-pricing-2026-06-02.md` (КАНОН, sign-off Vsevolod)
> - План Phase 1 / приоритеты → `Antepatent/phase1-todo-2026-06-02.md`
> - Фактическое состояние кода → `git log --oneline -30`

---

## 1. Что за проект

**Patent-Scan** (рабочее имя проекта — Antepatent) — AI-портал для предпринимателей и инженеров: проверка патентной чистоты идеи + разведка технологической области по открытым патентным базам, до обращения к патентному поверенному.

**Продуктовая линейка — двух-осевая (lite → full), см. §5:**
- Ось «Моя идея уникальна?»: **Поиск** (free) → **Deep** (платная надстройка).
- Ось «Что есть в области?»: **Ландшафт** (карта IP) → **Скрининг** (синтез-отчёт, ex-«литобзор»).
- Будущий трек: **Литературный/технологический обзор** (НОРД-инженерный стиль, waitlist).

**Статус:** активный запуск беты. Право-гигиена закрыта (privacy/terms live, ИП — оператор ПДн зарегистрирован в РКН). В работе: recall-фикс, биллинг ЮKassa, pricing-UI. Прод живой на `patent-scan.ru`.

**Географическое покрытие поиска — мировое, НЕ только РФ (важно для маркетинга).** Поиск реально идёт по **6 регионам**: **Россия (RU + SU)**, **СНГ (CIS)**, **США (US)**, **Европа (EP)**, **Китай (CN)**, **Япония (JP)** — это датасеты PatSearch (`PATSEARCH_DATASETS_RU = ru_since_1994, ru_till_1994, cis` + `PATSEARCH_DATASETS_EN = us, ep, jp, cn`). В отчёте блок «Где искали» показывает все 6 чипов, и US/CN-патенты реально находятся (напр. `US5629870`, `CN106841949B`). Глубина покрытия одинаковая на всех тарифах, включая бесплатный. **Заявлять «поиск по мировым патентным базам, не только Россия» — ПРАВДА, не преувеличение.** Не сужать копи до «РФ/СНГ» или «РФ/СНГ/США» — это занижает реальный охват (EP и JP тоже ищем).

**Источники данных (anti-fab — не заявлять лишнего):** все патентные данные (включая US/EP/JP/CN) приходят через ОДИН API — **Rospatent PatSearch** (мульти-региональные датасеты выше). **Espacenet OPS / EPO API и USPTO — НЕ подключены отдельно** (`EPO_KEY`/`EPO_SECRET` в env есть, но в коде не используются) — не упоминать Espacenet/USPTO как самостоятельные живые источники в копи/отчётах (US/EP-патенты мы берём из датасетов PatSearch, не из их родных API). Tavily (web) и Wikipedia/Wikidata — вспомогательные источники только в Industrial Usage и harvesting Скрининга, не в патентном поиске.

## 2. Стек и хостинг

- **Next.js 16** (App Router, Turbopack) — `web/`
- **React 19**, **next-intl** для i18n (ru + en)
- **TypeScript strict**, **Tailwind 4**, **ESLint 9**
- **Supabase** — auth (magic link) + Postgres + RLS
- **Resend** — transactional email (magic-link через Supabase Auth + письма литобзора/реактивации)
- **Upstash Redis** — persistent rate-limit
- **Cloudflare Turnstile** — анти-бот на signup
- **AI: Gemini 2.5 Flash** (поиск/анализ/синтез) + **Claude Sonnet 4.6** (Deep Analysis, стадии литобзора) — оба через **AI-шлюз Timeweb** (см. ниже)
- **Rospatent PatSearch** — патентный поиск (RU/CIS + US/EP/JP/CN датасеты). Бесплатный гос-API.
- **Tavily** — web-поиск (используется в Industrial Usage и harvesting литобзора)

### Хостинг — ВАЖНО (частый источник путаницы)

- **PROD = Timeweb VPS (МСК).** Приложение живёт на VPS в `/var/www/patent-scan`, запущено под pm2 (`next start` на :3000), фронтится nginx. IP `186.246.3.104`. Домен `patent-scan.ru` указывает на этот VPS напрямую (НЕ через Cloudflare-прокси — `.ru` намеренно grey/direct). **Переезд с Vercel на VPS ВЫПОЛНЕН** (в отличие от того, что писали старые версии этого файла).
- **pm2 процессы (`web/deploy/ecosystem.config.js`):**
  - `patent-scan` — Next.js HTTP-сервер (`next start -p 3000`, 1 instance, fork)
  - `patent-scan-worker` — воркер литобзора (`tsx src/worker/literature-review/index.ts`, fork mode, polling `search_requests`, до ~15 мин на отчёт). pm2 cluster для воркера НЕ использовать — глотает stdout.
  - Запущены под пользователем `deploy`, логи `/home/deploy/.pm2/logs`.
- **STAGING = Vercel preview** по каждому PR (авто-деплой из GitHub). QA проверяет на preview/staging, **не на проде**.
- **AI-шлюз Timeweb** (`api.timeweb.ai`, OpenAI-совместимый) — отдельная роль от хостинга: проксирует и Gemini, и Claude на одном ключе `TIMEWEB_AI_KEY`. Нужен, потому что Google гео-блокирует RU-VPS напрямую («User location is not supported»). Это НЕ хостинг сайта.

**Git repo:** только `web/` (родительская `Antepatent/` — не git, синхронизируется через OneDrive).
**GitHub:** https://github.com/aifreemanway/Patent-Scan
**Деплой:** ручной — `gh workflow run deploy.yml` (workflow «Deploy to VPS»): SSH → `git reset --hard origin/main` → `npm install` → `npm run build` → `pm2 reload`. Миграции БД — вручную через Supabase SQL Editor.

## 3. Юридический контекст (критично)

- **Юрлицо:** ИП Кобзарь Всеволод Юрьевич (не ООО NORD Engineering — отдельная история).
- **152-ФЗ:** обрабатываем email + IP. **ИП зарегистрирован оператором ПДн в РКН, рег. № 77-26-552292** (обработка с 18.05.2026). `/privacy` ссылается на него. Лог входа + IP сам по себе НЕ ПДн; аккаунт (ФИО/email/телефон) покрыт уведомлением.
- **/privacy + /terms — опубликованы и live** (152-ФЗ ru-soft-beta, PR #65). Footer на сайте есть.
- **Биллинг:** **ЮKassa** (НЕ Stripe — Stripe недоступен для РФ-ИП). В сборке: PR-A (миграция 0010 payments/subscriptions + `lib/yookassa.ts`) + PR-B (checkout + webhook, идемпотентность). RISK-критично: 54-ФЗ чек на каждый платёж, идемпотентность вебхука = merge-блокер.

## 4. Домены

- `patent-scan.ru` — main РФ (RU-first), **prod, указывает на VPS** напрямую (не CF-прокси).
- `patent-scan.com` — планируется global (EN-first).
- `патент-скан.рф`, `patent-scan.tech`, `patent-scan.online` — брендозащита, 301-редиректы.

## 5. Продукты, IA и цены (КАНОН 2026-06-02, sign-off Vsevolod)

### Двух-осевая модель

| Ось | Lite | Full |
|---|---|---|
| «Моя идея уникальна?» | **Поиск** (free) | **Deep** — платная надстройка Поиска (тот же URL, тумблер; имя «Deep», не «Pro») |
| «Что есть в области?» | **Ландшафт** — карта IP-активности | **Скрининг** — карта + синтез + сравнение + Industrial Usage + выводы (ex-«литобзор») |

⚠ **Ландшафт остаётся ОТДЕЛЬНЫМ продуктом** (CANON §6.1 перекрыл прежнее D1-предложение «слить в Скрининг»). Ландшафт ↔ Скрининг = тиры глубины одной оси, не дубль.
Бренд «Литературный обзор» переезжает на будущий НОРД-инженерный трек (waitlist).

### IA — целевые URL (CANON) vs текущие (фактические в коде)

| CANON-цель | Текущий URL в коде | Продукт |
|---|---|---|
| `/` | `/` | Хаб, 3 тайла |
| `/patent-search` | **`/search`** + `/report` | Поиск (free) + Deep (надстройка в отчёте) |
| `/patent-landscape` | **`/landscape`** + `/landscape/report` | Ландшафт |
| `/patent-screening` | **`/literature-review`** + `/processing` | Скрининг (ex-литобзор, async pipeline) |
| `/literature-review` | — (waitlist) | Будущий НОРД-обзор |

> Рейминг роутов в CANON-схему **ещё НЕ сделан** — в коде сейчас `/search`, `/landscape`, `/literature-review`. Плюс `/account/*`, `/enterprise`, `/login`, `/privacy`, `/terms`.

### Цены (launch-baseline, sign-off Vsevolod 02.06; калибруем WTP демо-когортой Самары)

| Продукт | Цена сейчас | Премиум-трек* |
|---|---|---|
| Поиск | free / в подписке | — |
| Deep | 6 900 | 9 900 |
| Ландшафт | 9 900 | 14 900 |
| Скрининг | 12 900 пилот → 14 900 | 19 900 |

Подписка (модель C): **Free** (3 Поиск/мес) / **Starter** 5 900 / **Team** 24 900 / **Team Plus** 39 900 / **Enterprise** custom. Плюс разовые покупки продуктов (цены в таблице выше).
*премиум-трек — после legal-status (Этап 1) + формального deliverable-экспорта.

> ⚠ Цены/тиры выше = **продуктовое РЕШЕНИЕ** (CANON, sign-off), не зеркало кода. Live-квоты в `config.ts` (§6) сейчас free/starter/team/enterprise и **могут не совпадать** с CANON-тирами (нет Team Plus, нет разовых SKU) — приведение кода к CANON делает coder отдельной задачей (PR-C). Не читать CANON-сетку как «уже работающую в коде».

**Партнёрка с патентными поверенными** (продуктовое направление, НЕ Phase 1): оплата за лид, верификация поверенного по реестру ФИПС, двусторонний канал. Передача контакта клиента поверенному = ПДн → требует согласия + договора + 152-ФЗ ДО запуска (память `project_partner_referral_152fz`).

### Экономика (факт, замер 02.06)

Единственный платный сервис — **LLM через шлюз Timeweb**. Всё остальное free-tier (PatSearch гос-API, Wikipedia, Resend, Supabase, Turnstile, Upstash). Marginal LLM: Поиск ~17.5₽ (→25-32 после recall-фикса) / Ландшафт ~5.4₽ / Deep полный ~34.5₽ / Industrial Usage ~10₽. Фикс VPS ~1180₽/мес. **Маржа 99%+ → ценообразование 100% value-based** (cost-plus снят). Industrial Usage — free-путь (GLEIF + Wikidata; OpenCorporates отклонён).

### Anti-fab / честность позиционирования

Калибровка качества: Ландшафт 2–3/5 → «карта/разведка области», не строгий deliverable. Скрининг 2/5 формально · 3.5/5 как экспресс → «pre-screening ДО института/поверенного». Во всех 3 продуктах — **CAVEAT-карточка** «не заменяет официальный отчёт по ГОСТ Р 15.011-2024 и заключение поверенного» (PR #83, on-screen + HTML-export). Цены — предварительные до WTP-пилота.

## 6. Инфра-статус и env vars

### Supabase
- **URL:** `https://ycwtxilrkswlzjhvyiea.supabase.co`
- **Миграции применены: 0001–0009** (`web/supabase/migrations/`):
  - 0001 auth + quotas (`profiles`, `searches`, `usage_counters` + RLS)
  - 0002 subscription tiers · 0003 deep-analysis free credit · 0004 marketing consent
  - **0005 `search_requests`** — единое хранилище всех типов запросов (novelty/landscape/deep/literature_review) + RLS owner-scoped
  - 0006 account profile поля · 0007 literature_review quota · 0008 reactivation columns · 0009 usage_counters constraint
- **Следующая миграция: 0010** — payments/subscriptions (биллинг ЮKassa, в сборке).

### Env vars (на VPS — `web/.env.production`; локально — `web/.env.local`; шаблон — `web/.env.example`)
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `TIMEWEB_AI_KEY` — AI-шлюз (Gemini + Claude на одном ключе). ⚠ **Подлежит ротации** (был засвечен — задача у Vsevolod). Опц. `GEMINI_MODEL` — сменить модель без правки кода.
- `PATSEARCH_TOKEN` — Rospatent PatSearch
- `TAVILY_API_KEY` — web-поиск
- `RESEND_API_KEY` — transactional email
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
- `EPO_KEY` / `EPO_SECRET` — пока не используется
- **Секреты НИКОГДА не печатать** в чат/доки/Obsidian/git. ЮKassa-ключи — только в env напрямую.

### Quota (config + Postgres — менять синхронно)
`web/src/lib/config.ts` `QUOTA_LIMITS`: free {search:3, landscape:3} / starter {20,10} / team {60,30} / enterprise {∞}. Literature_review-квота — отдельно (миграция 0007). Зашито также в Postgres-функции — менять в обоих местах.

## 7. Что сделано (highlights PR в main; полный список — `git log`)

Последние ~30 PR (главное):

| PR | Что |
|---|---|
| #84 | IPC correctness: `classification.ipc` полными кодами вместо обрезанного `ipc_subclass` (search-rospatent, fallback-роут) |
| #83 | Обязательный CAVEAT ГОСТ Р 15.011-2024 во всех 3 продуктах (on-screen + HTML-export) |
| #82 | Reopen отчёта из истории по `?id=` (GET `/api/search/[id]` + хук `useReopenRow`, гидрация из `search_requests` при пустом sessionStorage) |
| #76–81 | Стабилизация LLM-шлюза: streaming против 408, retry transient 5xx/429, async submit→worker→poll для Deep (mobile NAT credit-loss) |
| #69–77 | Литобзор (Скрининг): source-augmentation Tab.1, §4 strategic, IPC-фильтр, PDF-рендер, tier-gate UX |
| #64–68 | Industrial Usage (expandable в novelty-отчёте), /enterprise + demo-request, reactivation magic-link, /privacy + /terms + Footer, header «Личный кабинет» |
| #56–58 | `search_requests` единая таблица + запись из 3 user-facing routes; личный кабинет `/account/*`; async-pipeline литобзора (intake + 9-stage worker + emails) |

**В qa-гейте (НЕ смержено):** ветка recall T1-fix (`landscape-plan` отдаёт полные `ipcGroups` + класс основной измеряемой величины; `novelty-retrieval` seed'ит class-sweep plan-группами + каждым plan-subclass безусловно). Корень Самарского 0/2: class-sweep выводил IPC-группы только из probe-хитов. Компонентно верифицировано против PatSearch (RU2854805 #1, RU2799985 #4). Мерж после qa red-line на EMM.

## 8. Что осталось (Phase 1 — `Antepatent/phase1-todo-2026-06-02.md`)

**A. ДЕМО-ПУТЬ (P0):** recall IPC-фикс + qa red-line ✅почти · CAVEAT ✅ (#83) · правовой статус патентов RU Этап-1 (бейджи 🟢⚫🟡, anti-fab MAX) · silent-capture лог пар вход→выход (без consent-UI).
**B. ЦЕНА:** sign-off получен (CANON §SIGN-OFF) → разблокирован pricing-UI.
**C. РЕПОЗИЦИОНИРОВАНИЕ (marketing):** D1-пакет, мокапы, outreach — НЕ публиковать до confirm + caveat (caveat уже live).
**E. БИЛЛИНГ (P1, RISK-крит):** PR-A (0010 + lib/yookassa) + PR-B (checkout+webhook, идемпотентность) + PR-C (pricing-UI).
**F. RECALL-архитектура (P2):** мульти-запрос фасетный + единое ядро.
**BACKLOG (заморожено, не трогать без сигнала):** IUL build (GLEIF+Wikidata), Q3 source-scoring, async-everything epic, GLP-1 HQ-fix, '+Новый поиск' chooser, foreign-assets, DMARC-эскалация.

**Ждёт Vsevolod:** ротация `TIMEWEB_AI_KEY`; точный вход Самары (recall pass «б»); ЮKassa-ключи + оферта/НДС для биллинга.

**Демо-план (актуальный, Vsevolod 02.06):** Vsevolod раздаёт лендинг сам → пользователи регистрируются и работают → трекаем по БД (silent-capture пар вход→выход + `user_id`). Формальная рассылка с именами/темами получателей **НЕ нужна** — отслеживаем поведение зарегистрировавшихся, а не адресный outreach.

## 9. Где документация

- Этот файл (`web/CONTEXT.md`) — общий контекст, читать первым.
- `web/CLAUDE.md` + `web/AGENTS.md` — локальные гайды в репо.
- Корневой `Antepatent/CLAUDE.md` — продуктовая инструкция (3 страницы, PatSearch-детали, критические запреты anti-fab).
- **Obsidian vault `Antepatent/`** (источники истины):
  - `calibration-reference/CANON-products-IA-pricing-2026-06-02.md` — КАНОН продуктов/цен
  - `phase1-todo-2026-06-02.md` — план Phase 1
  - `calibration-reference/` — Самарское ревю (2/5), recall-диагностика, замеры costs, legal-status PRD
  - `quality-control/` — баг-репорты, ТЗ source-augmentation
- `Antepatent/docs/` — PRD.md, roadmap.md, MONETIZATION.md, NEXT_SESSION.md, rospatent_api_research.md.

## 10. Ключевые архитектурные паттерны (не повторять руками)

- **LLM-вызовы — только через `lib/gemini.ts` (`callGeminiJson<T>()`) / `lib/timeweb.ts`.** Не писать свой fetch к шлюзу. Ошибки — `GeminiError` с `.code`; `geminiErrorToStatus(e)` для HTTP-статуса. Шлюз стримит ответы (защита от ~187s 408) + retry transient.
- **Константы — в `lib/config.ts`** (timeout'ы, limits, model, datasets, rate-limit quotas). Не хардкодить inline.
- **Rate-limit — `lib/rate-limit.ts` `rateLimit()`** (Upstash, fallback in-memory).
- **Quota — `lib/quota.ts` `checkAndChargeQuota(userId, op)`** (атомарный Postgres RPC `increment_usage`).
- **Auth — `lib/supabase-server.ts`** (`requireUser`/`requireAuth`); server-side записи через `createSupabaseAdmin()` (обходит RLS).
- **Все user-facing запросы пишутся в `search_requests`** (`lib/search-requests.ts`: create/markCompleted/markError) — это даёт историю в ЛК и reopen отчётов. Внутренние шаги (search-rospatent, prior-art-rank, landscape/search, landscape/plan, questions, gate) — НЕ пишут, квоту не тратят.
- **Novelty retrieval — `lib/novelty-retrieval.ts`** (двухстадийный examiner-grade): Stage1 семантические aspect+probe запросы (RU+EN, per-region) → Stage2 IPC class-sweep (группы из probe-хитов + plan-declared) → map-reduce LLM-ранжирование пула чанками. Браузер оркестрирует через относительные fetch; серверные вызовы — через инъекцию base/fetchImpl.
- **PatSearch `classification.ipc` = ТОЧНОЕ совпадение подгруппы** (`G01R31/34` ≠ `G01R19/02`; обрезанный `G01R19` → 0 хитов). Для класса целиком — `classification.ipc_subclass` (4 символа, `G01R`). Hits нормализовать через `lib/patsearch-normalize.ts` `normalizeHit()` (2 формата: classic + ST96 для JP/CN).
- **Литобзор/Скрининг — async** через `search_requests` (status pending→in_progress→completed/error) + pm2-воркер. Стадии — Sonnet через Timeweb. Письма (Resend) идемпотентны через `notify_*_sent_at`.
- **Cost-телеметрия — `lib/cost.ts`** эмитит `[cost]`-строки (видны в pm2-логах).
- **Middleware — `src/proxy.ts`** (не `middleware.ts`): next-intl routing + refreshSupabaseSession. Между `createServerClient` и `getUser` логику НЕ вставлять.

## 11. Ловушки, на которые уже наступали

- **OneDrive sync.** Проект в `c:/Users/kobzar/OneDrive - ООО NDIGITAL/VK/VK/Claude/SaaS/Antepatent/`. Осознанное решение пользователя — не флагать как риск (память `feedback_onedrive_env.md`).
- **Git repo — только `web/`.** Файлы в `Antepatent/` (docs, CLAUDE.md, .business) — не в git, через OneDrive. `web/CONTEXT.md` = single-source-of-truth для клонов.
- **Деплой ≠ Vercel.** Прод на VPS (см. §2). Не «оптимизировать под Vercel maxDuration» — потолка нет. `maxDuration` в роутах — наследие, не блокер.
- **`git reset --hard origin/main` на VPS в deploy.** Незакоммиченные изменения на сервере будут стёрты — следить, чтобы прод-правки шли только через main. (Локально один раз `reset --hard` стёр чужой uncommitted WIP — использовать `pull/merge`, не `reset`, если есть чужие правки.)
- **IPC имеет секции только A-H** (не I). Regex `/^[A-H]\d{2}[A-Z]$/` верный. Расширять до `[A-I]` — галлюцинация.
- **Anti-fab — ЖЁСТКО.** Только реальные патенты с реальным URL. На отсутствие данных — честно «не найдено»/«не определён», НИКОГДА не дефолтить в «действует» и не выдумывать номера/проценты. Юр-значимая дезинформация недопустима.
- **Gemini возвращает JSON в markdown fence** — `callGeminiJson` чистит сам, свой parser не городить.
- **`.ru` НЕ через Cloudflare-прокси** — grey/direct nginx на 186.246.3.104.
- **Тесты НЕ на проде** — qa верифицирует на staging/Vercel-preview.
- **Секреты НЕ печатать** нигде (чат/доки/Obsidian/git).

## 12. Быстрые команды

```bash
# Рабочая директория
cd "c:/Users/kobzar/OneDrive - ООО NDIGITAL/VK/VK/Claude/SaaS/Antepatent/web"

git checkout main && git pull
git checkout -b <feature-branch>

npm run build
npm run dev   # → http://localhost:3000

# Деплой на прод (ручной, после merge в main)
gh workflow run deploy.yml
gh run watch    # следить за прогоном

# pm2 на VPS (под пользователем deploy)
pm2 status
pm2 logs patent-scan
pm2 logs patent-scan-worker

# Миграции БД — вручную через Supabase SQL Editor (paste → Run)
```

---

**Если что-то поменялось после 2026-06-02 — сначала `git log --oneline -20`, CANON-док и `phase1-todo`. Если этот файл устарел — обнови перед работой (он версионируется в git и читается всеми агентами).**
