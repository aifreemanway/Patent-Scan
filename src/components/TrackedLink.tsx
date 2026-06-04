"use client";

import type { ComponentProps, ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { reachGoal, type MetrikaGoal } from "@/lib/metrika";

type TrackedLinkProps = ComponentProps<typeof Link> & {
  /** Цель Метрики, отправляется по клику (no-op если тег не загружен). */
  goal?: MetrikaGoal;
  children: ReactNode;
};

// Ссылка-CTA с трекингом цели Метрики. Тонкая обёртка над next-intl Link —
// локализация пути и query/hash сохраняются, добавляется только onClick→reachGoal.
export function TrackedLink({ goal, children, onClick, ...rest }: TrackedLinkProps) {
  return (
    <Link
      {...rest}
      onClick={(e) => {
        if (goal) reachGoal(goal);
        onClick?.(e);
      }}
    >
      {children}
    </Link>
  );
}
