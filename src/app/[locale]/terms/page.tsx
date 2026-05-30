// /terms — Пользовательское соглашение (RU).
//
// Юридически значимый документ, текст согласован с ap-ba
// (legal/legal-gate-152fz-2026-05-28.md). Биллинговые разделы — заглушка
// «в бете доступ бесплатный», полноценные разделы оплаты/возвратов добавятся
// при запуске платных тарифов (Phase 2 monetization, T-CD-4).
//
// EN locale → disclaimer + ссылка на RU; машинный перевод юр-текста запрещён.

import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { Header } from "@/components/Header";
import { Link } from "@/i18n/navigation";

export const metadata: Metadata = {
  title: "Пользовательское соглашение — Patent-Scan",
  description:
    "Условия использования сервиса автоматизированного патентного поиска Patent-Scan.",
};

const UPDATED_AT = "30 мая 2026";

export default async function TermsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <>
      <Header />
      <main className="flex flex-1 justify-center px-6 py-12">
        <article className="w-full max-w-3xl space-y-6 text-slate-800">
          {locale === "en" && <EnNotice />}
          <header className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">
              Пользовательское соглашение
            </h1>
            <p className="text-sm text-slate-500">Действует с {UPDATED_AT}</p>
          </header>

          <p>
            Настоящее Соглашение регулирует отношения между Оператором сервиса
            Patent-Scan (далее — Сервис) и Пользователем при использовании
            Сервиса. Используя Сервис, Пользователь подтверждает, что
            ознакомился с условиями и принимает их.
          </p>

          <Section title="Оператор">
            <p>
              <strong>Индивидуальный предприниматель Кобзарь Всеволод Юрьевич</strong>
              <br />
              ИНН: 773273461708 · ОГРНИП: 318774600263547
              <br />
              Email:{" "}
              <a className="underline" href="mailto:support@patent-scan.com">
                support@patent-scan.com
              </a>
            </p>
          </Section>

          <Section title="1. Предмет">
            <p>
              Оператор предоставляет доступ к Сервису автоматизированного поиска
              и предварительного анализа патентной новизны на условиях «как
              есть» (as is).
            </p>
          </Section>

          <Section title="2. Ключевой дисклеймер">
            <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-amber-950">
              <p>
                Сервис предоставляет автоматизированный анализ на основе
                открытых патентных баз и AI-моделей. Результаты{" "}
                <strong>не являются юридическим заключением</strong> и{" "}
                <strong>
                  не заменяют экспертизу квалифицированного патентного
                  поверенного
                </strong>
                . Оператор не несёт ответственности за решения, принятые на
                основе отчётов Сервиса, включая подачу или отказ от подачи
                патентной заявки.
              </p>
            </div>
          </Section>

          <Section title="3. Доступ и тарифы">
            <p>
              В период беты доступ предоставляется бесплатно (free-tier) с
              ограничением по количеству запросов. Платные тарифы и порядок
              оплаты будут введены отдельно с обновлением настоящего Соглашения.
            </p>
            <p className="mt-2 text-sm italic text-slate-500">
              Разделы «Оплата» и «Возвраты» в текущей бете не применяются.
            </p>
          </Section>

          <Section title="4. Права и обязанности">
            <p>Пользователь обязуется:</p>
            <ul className="ml-5 mt-2 list-disc space-y-1">
              <li>не использовать Сервис для незаконных целей;</li>
              <li>
                не пытаться обойти ограничения и защиту (rate-limit, anti-bot);
              </li>
              <li>не вводить чужие персональные данные без правовых оснований.</li>
            </ul>
            <p className="mt-2">
              Оператор вправе ограничить или прекратить доступ при
              злоупотреблении.
            </p>
          </Section>

          <Section title="5. Интеллектуальная собственность">
            <p>
              Тексты, введённые Пользователем, остаются его собственностью.
              Оператор обрабатывает их только для оказания услуги (см.{" "}
              <Link href="/privacy" className="underline hover:text-slate-900">
                Политику конфиденциальности
              </Link>
              ).
            </p>
          </Section>

          <Section title="6. Ответственность">
            <p>
              Ответственность Оператора ограничена. За бесплатный доступ в бете
              Оператор не несёт материальной ответственности за результаты
              использования отчётов.
            </p>
          </Section>

          <Section title="7. Прекращение доступа">
            <p>
              Оператор может приостановить или прекратить доступ Пользователю
              при нарушении настоящего Соглашения. Пользователь может удалить
              свой аккаунт в любой момент.
            </p>
          </Section>

          <Section title="8. Разрешение споров">
            <p>
              Споры разрешаются по месту регистрации Оператора (ИП) в
              соответствии с законодательством Российской Федерации.
            </p>
          </Section>

          <Section title="9. Изменения">
            <p>
              Оператор вправе изменять настоящее Соглашение; актуальная версия
              публикуется на этой странице. Дата вступления в силу — дата
              публикации обновлённой версии.
            </p>
          </Section>

          <div className="border-t border-slate-200 pt-6 text-sm text-slate-600">
            См. также:{" "}
            <Link href="/privacy" className="underline hover:text-slate-900">
              Политика конфиденциальности
            </Link>
            .
          </div>
        </article>
      </main>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
      <div className="space-y-2 text-slate-700">{children}</div>
    </section>
  );
}

function EnNotice() {
  return (
    <div className="rounded-md border border-slate-300 bg-slate-50 p-4 text-sm text-slate-700">
      <p>
        These Terms of Service are currently available in Russian only. A
        professionally translated English version will be published when we
        onboard non-RU customers. For questions, contact{" "}
        <a className="underline" href="mailto:support@patent-scan.com">
          support@patent-scan.com
        </a>
        .
      </p>
    </div>
  );
}
