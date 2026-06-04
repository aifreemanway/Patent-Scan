// /requisites — юридические реквизиты оператора (152-ФЗ / ЮKassa). Значения из
// единого источника lib/legal (OPERATOR), копия-лейблы из i18n. Дизайн v7
// (.lp + SiteNav + landing.css). Footer (с этой же ссылкой) рендерит layout.

import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { SiteNav } from "@/components/SiteNav";
import { OPERATOR } from "@/lib/legal";
import "../landing.css";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Requisites" });
  return { title: `${t("title")} — ПатентСкан`, description: t("intro") };
}

export default async function RequisitesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Requisites");

  return (
    <div className="lp">
      <SiteNav />
      <main>
        <section>
          <div className="container">
            <div className="section-head">
              <span className="section-eyebrow">{t("eyebrow")}</span>
              <h1 className="section-h2">{t("title")}</h1>
              <p className="section-sub">{t("intro")}</p>
            </div>

            <div className="requisites-card">
              <dl className="requisites-list">
                <div>
                  <dt>{t("operatorLabel")}</dt>
                  <dd>{OPERATOR.name}</dd>
                </div>
                <div>
                  <dt>ИНН</dt>
                  <dd>{OPERATOR.inn}</dd>
                </div>
                <div>
                  <dt>ОГРНИП</dt>
                  <dd>{OPERATOR.ogrnip}</dd>
                </div>
                <div>
                  <dt>{t("rknLabel")}</dt>
                  <dd>{t("rknValue", { num: OPERATOR.rknRegNumber })}</dd>
                </div>
                <div>
                  <dt>{t("contactLabel")}</dt>
                  <dd>
                    <a href={`mailto:${OPERATOR.supportEmail}`}>
                      {OPERATOR.supportEmail}
                    </a>
                  </dd>
                </div>
              </dl>
              <p className="requisites-note">{t("note")}</p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
