"use client";

import { useLocale } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";

// Ручной переключатель языка для v7-навигации (SiteNav). Гео/Accept-Language
// автодетект ОСТАЁТСЯ нетронутым — на проде приоритет cookie NEXT_LOCALE >
// Accept-Language > default ru (проверено: `/` + AL:en + NEXT_LOCALE=ru → 200,
// без cookie en-браузер уходит на /en). Этот тумблер даёт выбрать язык руками и
// «прилепить» его: next-intl Link с locale-проп ведёт на нужную локаль, а onClick
// пишет NEXT_LOCALE на год — иначе после хард-релоада гео-детект снова увёл бы
// en-браузер на /en. localePrefix=as-needed: ru без префикса, en=/en.
// usePathname (next-intl) возвращает путь БЕЗ локали-префикса → Link сам построит
// корректный URL для каждой локали.
const LOCALES = [
  { code: "ru", label: "RU" },
  { code: "en", label: "EN" },
] as const;

export function LocaleSwitcher() {
  const pathname = usePathname();
  const active = useLocale();
  return (
    <div className="lang-switch" role="group" aria-label="Язык / Language">
      {LOCALES.map(({ code, label }) => (
        <Link
          key={code}
          href={pathname}
          locale={code}
          aria-current={active === code ? "true" : undefined}
          onClick={() => {
            document.cookie = `NEXT_LOCALE=${code};path=/;max-age=31536000;samesite=lax`;
          }}
        >
          {label}
        </Link>
      ))}
    </div>
  );
}
