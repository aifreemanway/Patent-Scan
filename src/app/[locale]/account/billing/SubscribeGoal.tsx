"use client";

// Цель Метрики «[subscribe] Starter/Team» — шлём по ФАКТУ оплаты, а не по клику
// «Оплатить картой»: страница монтирует этот компонент только когда юзер вернулся
// из ЮKassa (?status=return) И подписка в БД уже активна (её проставляет вебхук).
// Редирект в кассу сам по себе оплатой не является, поэтому цель там не шлём.
//
// team_plus сознательно пропущен: в кабинете Метрики цели под него нет
// (ap-marketing 21.09 прислал идентификаторы только для starter и team).

import { useEffect } from "react";
import { reachGoal } from "@/lib/metrika";

type Props = {
  tier: "starter" | "team";
  /** Конец оплаченного периода — ключ дедупликации: одна оплата = одна цель. */
  periodEnd: string | null;
};

export function SubscribeGoal({ tier, periodEnd }: Props) {
  useEffect(() => {
    // Перезагрузка страницы с ?status=return не должна слать цель повторно.
    const key = `ps_subgoal_${tier}_${periodEnd ?? "na"}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      // Приватный режим / заблокированное хранилище — цель всё равно шлём.
    }
    reachGoal(tier === "starter" ? "subscribe_starter" : "subscribe_team");
  }, [tier, periodEnd]);

  return null;
}
