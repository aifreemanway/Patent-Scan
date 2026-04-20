# Patent-Scan — Agent Context

**Единая точка входа для любого AI-агента или нового разработчика.** Если ты только открыл репозиторий — прочитай этот файл целиком, потом переходи к ссылкам ниже. Файл версионируется в git, читается независимо от cwd или памяти агента.

**Последнее обновление:** 2026-04-20

---

## 1. Что за проект

**Patent-Scan** — AI-портал для проверки патентной чистоты изобретений. Пользователь вводит описание → система извлекает поисковые термины через Gemini → ищет аналоги в Роспатент PatSearch (и других базах: US, EP, JP, CN через те же датасеты) → делает экспертное заключение (уникальность, совпадения, рекомендации).

**Дополнительная фича:** landscape — построение панорамы технологической области (план → N поисков → синтез обзора).

**Статус:** pre-launch, MVP работает, готовится к платному запуску через ~1.5-2 дня работы.

## 2. Стек

- **Next.js 16.2.3** (App Router, Turbopack) — `web/`
- **React 19.2.4**, **next-intl 4.9.1** для i18n (ru + en)
- **TypeScript strict**, **Tailwind 4**, **ESLint 9**
- **Vercel** — хостинг + CDN + serverless functions
- **Supabase** — auth (magic link) + Postgres + RLS
- **Upstash Redis** — persistent rate-limit
- **Cloudflare Turnstile** — анти-бот на signup (Managed mode)
- **Gemini 2.5-flash** — AI (анализ, извлечение запросов, синтез)
- **Rospatent PatSearch** — патентный поиск
- **Tavily** — web-поиск для контекста (редко используется)

**Git repo:** `patent-scan/web/` (НЕ `patent-scan/` — там legacy Python код, вне git, уже архивирован логически).
**GitHub:** https://github.com/aifreemanway/Patent-Scan
**Prod:** https://patent-scan.vercel.app

## 3. Юридический контекст (критично)

- **Юрлицо:** ИП Кобзарь Всеволод Юрьевич (не ООО NORD Engineering — это отдельная история)
- **152-ФЗ:** применяется, т.к. обрабатываем email + IP пользователей. Pre-launch ToDo — политика конфиденциальности + терм + согласие + регистрация в Реестре РКН. План: `Moy-proekt/patent-scan-review/legal-prelaunch-plan.md`
- **Штрафы для ИП** в 3-15 раз ниже чем ООО. Для MVP-фазы ИП оптимально.
- **Биллинг:** Stripe **недоступен для российского ИП**. Варианты когда дойдём до платных подписок:
  - ЮKassa / Tinkoff Kassa (только ₽ от РФ-юзеров)
  - ООО в Serbia/UAE/Georgia + Stripe
  - Stripe Atlas ($500 + $100/год за US LLC под ключ)

## 4. Купленные домены

- `patent-scan.com` — планируется main global (EN-first)
- `patent-scan.ru` — main РФ (RU-first)
- `патент-скан.рф` (Punycode: `xn----7sbbs0aqdjwgc.xn--p1ai`) — брендозащита, 301 на `.ru`
- `patent-scan.tech`, `patent-scan.online` — брендозащита, 301 на `.com`

**В Vercel ещё НЕ подключены** — после закрытия B1/Legal. План в `Moy-proekt/patent-scan-review/07-infrastructure-plan.md`.

## 5. Решения по продукту

- **Free-tier квоты:** 3 search/месяц, 3 landscape/месяц, 3 analyze/месяц (questions без квоты — дёшево). Зашиты **одновременно** в Postgres функцию `increment_usage` (см. `web/supabase/migrations/0001_auth_and_quotas.sql`) и в `web/src/lib/config.ts` `QUOTA_LIMITS`. **Менять синхронно в двух местах.**
- **Pro-tier:** 500 search, 100 landscape, 500 analyze / месяц
- **Enterprise:** unlimited
- **Цифры стартовые** — настраиваются по метрикам после запуска (конверсия free→pro, доля free-riders)

## 6. Инфра-статус и env vars

### Supabase
- **URL:** `https://ycwtxilrkswlzjhvyiea.supabase.co`
- **Регион:** Central EU (Frankfurt), Free tier (500MB + 50k MAU)
- **Миграция применена:** `web/supabase/migrations/0001_auth_and_quotas.sql` (таблицы `profiles`, `searches`, `usage_counters` + RLS + 2 Postgres функции + триггер)
- **Env vars в Vercel** (Production + Preview):
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY` (публичный, в клиентском бандле)
  - `SUPABASE_SERVICE_ROLE_KEY` (server-only, обходит RLS)

### Cloudflare Turnstile
- **Widget:** `Patent-Scan`, mode **Managed**
- **Hostnames:** `patent-scan.vercel.app`, `localhost`, `patent-scan.com`, `patent-scan.ru`, `xn----7sbbs0aqdjwgc.xn--p1ai`, `patent-scan.tech`, `patent-scan.online`
- **Env vars:** `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`
  - Локально в `web/.env.local` ✅
  - В Vercel env vars **ещё НЕ добавлены** — сделать при реализации B1 Этап 3.5

### Upstash Redis (rate-limit)
- Подключён через Vercel Integrations → Upstash
- Env vars `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` автоматически
- Fallback на in-memory если не настроен (для local dev)

### Прочее
- **Gemini API key** — `GEMINI_API_KEY` в Vercel env vars
- **PatSearch token** — `PATSEARCH_TOKEN`
- **Tavily** — `TAVILY_API_KEY`
- **EPO** — `EPO_KEY` + `EPO_SECRET` (пока не используется, оставлено на будущее)

Шаблон всех переменных: `web/.env.example`.

## 7. Что уже сделано (PR в main)

| PR | Commit | Summary |
|---|---|---|
| #32 | `7036339` | Security: whitelist datasets, max length validation, Gemini key → x-goog-api-key header, Upstash persistent rate-limit |
| #33 | `69d8d8b` | B4 `maxDuration` на 5 routes + B3 `lib/config.ts` (все константы, env var override) |
| #34 | `39ce201` | B2 `lib/gemini.ts` unified helper — схлопнул 6 дублирующих мест, GeminiError с кодами, token usage extraction |
| #35 | `e83f281` | B1 Этапы 0-2: Supabase scaffold (schema + RLS + client/server helpers + quota.ts). **Не wired в routes/UI** |

**Последний коммит main:** `e83f281`.

## 8. Что осталось до платного запуска

### B1 Этапы 3 + 3.5 + 4 (~1.5-2 дня)
1. **Этап 3** — magic-link login UI + middleware guard + logout
2. **Этап 3.5 — Анти-абуз:** Turnstile + disposable-email blocklist + per-IP signup throttle + verified-email check в `requireVerifiedUser`
3. **Этап 4** — миграция `sessionStorage` → `searches` table + `requireVerifiedUser` + `checkAndChargeQuota` во всех API routes (402 при превышении квоты)

**План:** `Moy-proekt/patent-scan-review/B1-supabase-auth-plan.md`

### Legal pre-launch (~3-4ч + 3-5 дней ожидания РКН)
- Страницы `/privacy` + `/terms` (Ru + En)
- Чекбокс согласия на login
- Регистрация ИП Кобзарь В.Ю. как оператора ПДн на https://pd.rkn.gov.ru

**План:** `Moy-proekt/patent-scan-review/legal-prelaunch-plan.md`

### После
- Домены в Vercel
- Stripe/ЮKassa (отдельная большая задача)
- Important-фиксы из review (I1-I10)

## 9. Где лежит детальная документация

**Главное (читать в таком порядке):**
1. Этот файл (`web/CONTEXT.md`) — общий контекст
2. `web/CLAUDE.md` — локальный гайд в web-репо (смотри секцию «Следующая сессия»)
3. `docs/NEXT_SESSION.md` — контекст и задача первого шага для следующей сессии (в `patent-scan/docs/`, вне git)
4. `Moy-proekt/patent-scan-review/00-SUMMARY.md` — агрегированный результат pre-launch ревью

**Детальные планы сессий** (в `Moy-proekt/patent-scan-review/`):
- `B1-supabase-auth-plan.md` — детальный план Supabase + anti-abuse (актуален)
- `legal-prelaunch-plan.md` — план юридической гигиены
- `07-infrastructure-plan.md` — домены, hosting, Cloudflare

**6 разделов pre-launch ревью** (в `Moy-proekt/patent-scan-review/`):
- `01-security.md`, `02-architecture.md`, `03-bugs.md`, `04-performance.md`, `05-code-quality.md`, `06-dependencies.md`

**История сессий** (в `patent-scan/.sessions/`, вне git):
- `2026-04-20-pre-launch-review-and-blockers.md` — последний полный отчёт сессии
- Старые: `2026-04-17-*`, `2026-04-19-*`

## 10. Ключевые архитектурные паттерны (не повторять)

- **Вызов Gemini — только через `lib/gemini.ts` `callGeminiJson<T>()`.** Не писать заново fetch к Gemini API. Ошибки — через класс `GeminiError` с полем `.code` (`network` / `upstream_http` / `empty_response` / `invalid_json`). Используй `geminiErrorToStatus(e)` для выбора HTTP status (504 на timeout, 502 на остальное).
- **Константы — в `lib/config.ts`.** Timeout'ы, limits, model URL, dataset списки, rate-limit quotas — всё там. Не хардкодить inline в routes/libs.
- **Rate-limit — через `lib/rate-limit.ts` `rateLimit()`.** Async function, возвращает `NextResponse | null`. Uses Upstash когда env есть, fallback на in-memory.
- **Quota — через `lib/quota.ts` `checkAndChargeQuota(userId, op)`.** Вызывает Postgres RPC `increment_usage` атомарно. Один вызов = один check + charge.
- **Auth — через `lib/supabase-server.ts`** `requireUser()` / `requireVerifiedUser()`. В API routes — использовать `requireVerifiedUser` (требует `email_confirmed_at`).
- **Middleware — `src/proxy.ts`** (не `middleware.ts`). Сейчас только `next-intl` routing. В B1 Этап 3 добавить `refreshSupabaseSession` из `lib/supabase-middleware.ts`. **Supabase-мидлварь требует НЕ вставлять логику между `createServerClient` и `getUser`.**
- **PatSearch hits — нормализовать через `lib/patsearch-normalize.ts`** `normalizeHit()`. Обрабатывает 2 формата ответа PatSearch (classic + ST96 для JP/CN).
- **Датасеты и RU/EN split** — из `PATSEARCH_DATASETS_{RU,EN,ALL,ALLOWED}` констант. `DATASETS_ALLOWED` — это Set для whitelist-фильтрации user input.

## 11. Ловушки, на которые уже наступали

- **OneDrive sync.** Проект живёт в `c:/Users/kobzar/OneDrive - ООО NDIGITAL/VK/VK/Claude/patent-scan/`. Это **осознанное решение** пользователя — не флагать как security-риск, не предлагать "вынести из OneDrive". Документ решения: память `feedback_onedrive_env.md`.
- **IPC имеет только секции A-H** (не I). Regex `/^[A-H]\d{2}[A-Z]$/` корректен. Один из ревью-агентов ошибочно предложил расширить до `[A-I]` — это галлюцинация, не применять.
- **`sessionStorage` blob между страницами** — deprecate'ится в B1 Этап 4 в пользу БД. Не добавлять новое в `sessionStorage` — сразу в БД через `searches.state`.
- **Vercel kills requests at 60s (Pro) / 10s (Hobby) если нет `maxDuration`.** Все тяжёлые routes должны иметь `export const maxDuration = N;`. Уже сделано на 5 routes (analyze=90, search-rospatent=90, остальные=60).
- **Gemini иногда возвращает JSON в markdown fence** `` ```json...``` ``. `callGeminiJson` очищает автоматически, не городить свой parser.
- **patent-scan/CLAUDE.md указывает на docs/NEXT_SESSION.md** (не на root). Конвенция проекта — NEXT_SESSION в docs/.
- **Git repo — только в `web/`.** Файлы в `patent-scan/` (включая `.sessions/`, `docs/NEXT_SESSION.md`, `CLAUDE.md`) — **не в git**, хранятся через OneDrive sync. Для bulletproof версионирования — считай что они могут быть потеряны, и используй этот `web/CONTEXT.md` как single-source-of-truth для переустановок/клонов.

## 12. Быстрые команды

```bash
# Рабочая директория (важно!)
cd "c:/Users/kobzar/OneDrive - ООО NDIGITAL/VK/VK/Claude/patent-scan/web"

# Актуализировать main
git checkout main && git pull

# Новая ветка для следующей задачи
git checkout -b auth-and-quotas

# Локальный билд + dev
npm run build
npm run dev  # → http://localhost:3000

# Smoke-test prod
curl -s -o response.json -w "HTTP %{http_code} in %{time_total}s\n" \
  "https://patent-scan.vercel.app/api/search-rospatent" \
  -H "Content-Type: application/json" \
  --data-binary @"../../Moy-proekt/long_query.json" \
  --max-time 90

# Статус деплоев
gh api repos/aifreemanway/Patent-Scan/deployments?environment=Production --jq '.[0]|{sha,created_at}'

# Supabase REST проверка живости БД
curl -s "https://ycwtxilrkswlzjhvyiea.supabase.co/rest/v1/profiles?select=id" \
  -H "apikey: $(grep ANON_KEY .env.local | cut -d= -f2)" \
  -H "Authorization: Bearer $(grep ANON_KEY .env.local | cut -d= -f2)"
```

---

**Если есть сомнения или что-то поменялось после 2026-04-20 — сначала смотри `git log --oneline -10` и `patent-scan/.sessions/` для последних обновлений. Если файл устарел — обнови перед работой.**
