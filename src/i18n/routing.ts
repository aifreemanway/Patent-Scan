import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["ru", "en"],
  defaultLocale: "ru",
  localePrefix: "as-needed",
  // EN-гигиена (cofounder 10.06, HARD): RU — безусловный дефолт. НЕ авто-роутим на
  // /en по Accept-Language/гео — VPN-в-РФ массов, иначе целый сегмент видит
  // непереведённый EN (анти-trust). /en доступен только по явному префиксу.
  localeDetection: false,
});

export type Locale = (typeof routing.locales)[number];
