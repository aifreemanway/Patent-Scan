// Site-wide footer. Renders operator reqs (ИНН/ОГРНИП per ЮKassa requirement),
// the РКН-operator-number disclosure required by 152-ФЗ, and links to /privacy
// + /terms (which are linked from the login consent checkbox as well).
//
// Home address is intentionally NOT published (per legal spec — ИП can register
// at home address, publishing it would expose Vsevolod personally).

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export function Footer() {
  const t = useTranslations("Footer");
  return (
    <footer className="mt-auto border-t border-slate-200 bg-slate-50">
      <div className="mx-auto max-w-5xl px-6 py-8 text-xs leading-relaxed text-slate-600">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <p className="font-medium text-slate-800">{t("operatorTitle")}</p>
            <p>{t("operatorName")}</p>
            <p>{t("inn")}: 773273461708 · {t("ogrnip")}: 318774600263547</p>
            <p>{t("rkn")}: №100282901</p>
          </div>
          <nav className="flex flex-wrap gap-x-4 gap-y-1">
            <Link href="/enterprise" className="hover:text-slate-900 hover:underline">
              {t("enterprise")}
            </Link>
            <Link href="/privacy" className="hover:text-slate-900 hover:underline">
              {t("privacy")}
            </Link>
            <Link href="/terms" className="hover:text-slate-900 hover:underline">
              {t("terms")}
            </Link>
            <a
              href="mailto:support@patent-scan.com"
              className="hover:text-slate-900 hover:underline"
            >
              support@patent-scan.com
            </a>
          </nav>
        </div>
      </div>
    </footer>
  );
}
