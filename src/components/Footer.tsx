// Site-wide footer (v7 design). Rendered by the locale layout on every page.
// Wraps itself in `.lp` + imports landing.css so the v7 footer styles (scoped
// under .lp) apply even on app pages that aren't .lp-wrapped.
//
// 152-ФЗ: operator legal line (ИП / ИНН / ОГРНИП / РКН) stays in the footer AND
// has a dedicated /requisites page. All values come from lib/legal (OPERATOR) —
// single source of truth (the РКН number previously drifted across two hardcoded
// spots; never again). Home address intentionally NOT published.
//
// Links point only to routes that exist (v9 mockup footer — 4 columns: brand /
// Продукт / Для бизнеса / Документы). О нас / Партнёрам / Контакты / Безопасность
// have no pages → not linked (would 404); contact is the support email in the
// bottom bar.

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { TrackedLink } from "@/components/TrackedLink";
import { OPERATOR } from "@/lib/legal";
import "../app/[locale]/landing.css";

export function Footer() {
  const t = useTranslations("Footer");
  return (
    <div className="lp">
      <footer>
        <div className="container">
          <div className="foot-grid">
            <div className="foot-col foot-brand">
              <Link href="/" className="logo">
                <span className="logo-mark">◄</span>
                <span className="logo-text">
                  Патент<span className="dot">·</span>Скан
                </span>
              </Link>
              <p>{t("brandText")}</p>
              <p className="foot-legal">
                {t("operatorTitle")}: {OPERATOR.name} · {t("inn")}{" "}
                {OPERATOR.inn} · {t("ogrnip")} {OPERATOR.ogrnip} · {t("rkn")}:
                рег. № {OPERATOR.rknRegNumber}
              </p>
            </div>

            <div className="foot-col">
              <h5>{t("products")}</h5>
              <Link href="/search">{t("search")}</Link>
              <Link href="/login?intent=landscape">{t("landscape")}</Link>
              <Link href="/login?intent=screening">{t("screening")}</Link>
              <TrackedLink href="/pricing" goal="pricing_view">
                {t("pricing")}
              </TrackedLink>
            </div>

            <div className="foot-col">
              <h5>{t("business")}</h5>
              <TrackedLink href="/enterprise" goal="b2b_click">
                {t("enterprise")}
              </TrackedLink>
              <TrackedLink href="/enterprise#form" goal="b2b_click">
                {t("demo")}
              </TrackedLink>
              <TrackedLink href="/login" goal="login_click">
                {t("account")}
              </TrackedLink>
            </div>

            <div className="foot-col">
              <h5>{t("documents")}</h5>
              <Link href="/requisites">{t("requisites")}</Link>
              <Link href="/privacy">{t("privacy")}</Link>
              <Link href="/terms">{t("terms")}</Link>
            </div>
          </div>

          <div className="foot-bot">
            <div>© 2026 ПатентСкан</div>
            <div>
              <a href={`mailto:${OPERATOR.supportEmail}`}>
                {OPERATOR.supportEmail}
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
