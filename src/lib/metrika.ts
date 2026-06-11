// Яндекс.Метрика — единая точка интеграции.
//
// Счётчик 109614566 (21 цель заведена в кабинете Метрики маркетингом). Здесь —
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
  | "blog_to_search"; // CTA статьи блога → /search (конверсия «статья→поиск», mediabuyer)

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
