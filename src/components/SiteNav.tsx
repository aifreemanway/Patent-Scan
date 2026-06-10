import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { TrackedLink } from "@/components/TrackedLink";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";

// Общая v7-навигация для публичных страниц (лендинг, тарифы, enterprise, login).
// Должна рендериться ВНУТРИ обёртки .lp (стили .nav/.logo/... скоуплены под .lp в
// landing.css). App-страницы (search/report/account) используют обычный <Header/>.
// Копия — Landing.nav; цели Метрики: pricing_view (Тарифы), login_click (ЛК).
export async function SiteNav() {
  const t = await getTranslations("Landing.nav");
  return (
    <nav className="nav">
      <div className="nav-inner">
        <Link href="/" className="logo">
          <span className="logo-mark">◄</span>
          <span className="logo-text">
            Патент<span className="dot">·</span>Скан
          </span>
        </Link>
        <div className="nav-links">
          <Link href="/">{t("home")}</Link>
          <Link href="/search">{t("search")}</Link>
          <Link href="/login?intent=landscape">{t("landscape")}</Link>
          <Link href="/login?intent=screening">{t("screening")}</Link>
          <TrackedLink href="/pricing" goal="pricing_view">
            {t("pricing")}
          </TrackedLink>
          <TrackedLink href="/login" goal="login_click" className="btn-nav">
            {t("account")}
          </TrackedLink>
          <LocaleSwitcher />
        </div>
      </div>
    </nav>
  );
}
