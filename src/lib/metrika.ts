// Яндекс.Метрика — единая точка интеграции.
//
// Счётчик 109614566 (в кабинете 29 целей, из них 25 типа action — сверка
// ap-marketing 21.09; здесь перечислены те, что шлём из кода). Здесь —
// только клиентские хелперы; сам тег монтируется через <YandexMetrika /> в
// layout (next/script, afterInteractive). reachGoal безопасен на сервере (no-op),
// поэтому модуль можно импортировать в любой client-компонент без 'use client'.

export const METRIKA_COUNTER_ID = 109614566;

// Цели лендинга/тарифов/логина — должны совпадать со списком в кабинете Метрики.
// Имена соответствуют макету v7 (event-listener wiring оригинала переехал в
// onClick соответствующих CTA + scroll-эффект в YandexMetrika).
export type MetrikaGoal =
  | "search_start" // hero primary CTA → /search
  | "b2b_click" // hero B2B-карточка «Запросить демо»
  | "sub_starter_click" // тариф Starter «Подключить»
  | "sub_team_click" // тариф Team «Подключить»
  | "tile_search_cta" // плитка Поиск «Попробовать бесплатно»
  | "tile_landscape_click" // плитка Ландшафт «Заказать»
  | "tile_screening_click" // плитка Скрининг «Заказать»
  | "pricing_view" // переход на /pricing (nav/teaser/footer)
  | "login_click" // переход на /login (nav + Free-карточка)
  | "pilot_cta" // pre-footer pilot-band «Проверить идею»
  | "faq_opened" // раскрытие любого FAQ-пункта
  | "scroll_50" // 50% глубины страницы
  | "scroll_90" // 90% глубины страницы
  | "pricing_enterprise_click" // /pricing Enterprise «Связаться» CTA
  | "pricing_free_click" // /pricing Free «Зарегистрироваться»
  | "pricing_oneoff_click" // /pricing разовый отчёт CTA
  | "blog_to_search" // CTA статьи блога → /search (конверсия «статья→поиск», mediabuyer)
  // ── Воронка: lead / purchase / subscribe ────────────────────────────────────
  // Идентификаторы выгружены ap-marketing из кабинета Метрики 21.09 (поле
  // conditions.url). Четыре автоцели (заполнил/отправил контактные данные,
  // отправка формы, клик по email) Метрика ловит сама — reachGoal НЕ вызываем.
  | "search_complete" // [lead] поиск завершён: /api/analyze вернул отчёт (ГЛАВНАЯ)
  | "lead_email" // [lead] email захвачен: ссылка/код отправлены на почту
  | "enterprise_demo" // [lead] заявка Enterprise отправлена
  // purchase-цели разовых отчётов: точки срабатывания ПОКА НЕТ — разовые
  // продаются заявкой (счёт), отдельного one-off checkout в продукте нет.
  // Клик по «Заказать» уже покрыт целью pricing_oneoff_click; вешать на него
  // purchase исказило бы воронку. Проводим при появлении one-off оплаты.
  | "order_deep" // [purchase] Deep
  | "order_landscape" // [purchase] Ландшафт
  | "order_screening" // [purchase] Скрининг
  // subscribe-цели шлём по факту успешной оплаты (возврат из ЮKassa), не по
  // клику — пока дремлют за BILLING_LIVE.
  | "subscribe_starter" // [subscribe] Starter
  | "subscribe_team"; // [subscribe] Team

declare global {
  interface Window {
    ym?: (
      counterId: number,
      action: string,
      ...params: unknown[]
    ) => void;
  }
}

/** Отправить достижение цели. No-op на сервере и до загрузки тега. */
export function reachGoal(goal: MetrikaGoal, params?: Record<string, unknown>): void {
  if (typeof window === "undefined" || typeof window.ym !== "function") return;
  window.ym(METRIKA_COUNTER_ID, "reachGoal", goal, params);
}
