// /privacy — Политика конфиденциальности (RU).
//
// Юридически значимый документ, текст согласован с ap-ba
// (legal/legal-gate-152fz-2026-05-28.md). Реквизиты подтверждены Vsevolod:
// ИНН 773273461708 / ОГРНИП 318774600263547 / РКН рег. № 77-26-552292
// (см. единый источник src/lib/legal.ts — OPERATOR).
//
// Машинный перевод юр-текста на EN запрещён — для locale=en показываем
// disclaimer + ссылку на RU-версию. Полная EN-версия — после native legal
// translator при заходе US-клиентов.
//
// Дата обновления — захардкожена; обновлять руками вместе с изменениями текста.

import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { Header } from "@/components/Header";
import { Link } from "@/i18n/navigation";

export const metadata: Metadata = {
  title: "Политика конфиденциальности — Patent-Scan",
  description:
    "Какие персональные данные обрабатывает Patent-Scan, на каких основаниях и каким третьим лицам передаются.",
};

const UPDATED_AT = "4 июня 2026";

export default async function PrivacyPage({
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
              Политика конфиденциальности
            </h1>
            <p className="text-sm text-slate-500">Действует с {UPDATED_AT}</p>
          </header>

          <p>
            Настоящая Политика описывает, какие персональные данные обрабатывает
            сервис Patent-Scan (далее — Сервис) и на каких условиях. Используя
            Сервис, вы соглашаетесь с условиями Политики.
          </p>

          <Section title="1. Оператор">
            <p>
              <strong>Индивидуальный предприниматель Кобзарь Всеволод Юрьевич</strong>
              <br />
              ИНН: 773273461708
              <br />
              ОГРНИП: 318774600263547
              <br />
              Регистрация в Реестре операторов ПДн Роскомнадзора: рег. № 77-26-552292
              <br />
              Email для обращений по ПДн:{" "}
              <a className="underline" href="mailto:support@patent-scan.com">
                support@patent-scan.com
              </a>
            </p>
          </Section>

          <Section title="2. Какие персональные данные мы обрабатываем">
            <ul className="ml-5 list-disc space-y-1">
              <li>
                <strong>Email</strong> — при регистрации (вход по magic-link).
              </li>
              <li>
                <strong>IP-адрес</strong> — при каждом обращении к Сервису
                (защита от злоупотреблений, безопасность).
              </li>
              <li>
                <strong>Cookies / данные сессии</strong> — для поддержания
                авторизованного сеанса.
              </li>
              <li>
                <strong>Тексты описаний изобретений и ответы на уточняющие
                вопросы</strong> — то, что вы вводите для поиска. Не вводите в
                эти поля данные, которые не хотите передавать для обработки.
              </li>
            </ul>
          </Section>

          <Section title="3. Цели обработки">
            <ul className="ml-5 list-disc space-y-1">
              <li>Идентификация и аутентификация пользователя (вход по magic-link).</li>
              <li>Предоставление услуги патентного поиска и анализа новизны.</li>
              <li>
                Защита Сервиса от автоматизированных злоупотреблений (Turnstile,
                ограничение частоты запросов).
              </li>
              <li>Обеспечение безопасности и диагностика ошибок.</li>
              <li>
                Информационные рассылки — только при наличии отдельного
                добровольного согласия (§6 настоящей Политики). Согласие можно
                отозвать в любой момент.
              </li>
            </ul>
            <p className="mt-2 text-sm italic text-slate-500">
              Биллинг и учёт подписок в текущей бете не ведётся — раздел
              добавится при запуске платных тарифов.
            </p>
          </Section>

          <Section title="4. Правовое основание">
            <ul className="ml-5 list-disc space-y-1">
              <li>
                Согласие субъекта ПДн (ст. 6 ч. 1 п. 1 Федерального закона
                №152-ФЗ).
              </li>
              <li>
                Исполнение договора (Пользовательское соглашение — ст. 6 ч. 1
                п. 5).
              </li>
            </ul>
          </Section>

          <Section title="5. Передача третьим лицам и трансграничная передача">
            <p>
              Сервер и персональные данные пользователей Сервиса (email,
              идентификаторы аккаунта, IP-адрес) размещаются и обрабатываются на
              территории Российской Федерации. Трансграничная передача
              персональных данных не осуществляется.
            </p>
            <p>
              Для AI-анализа во внешние сервисы передаются только обезличенные
              технические описания изобретений и сформированные на их основе
              поисковые запросы — без персональных данных пользователя.
            </p>
            <p>
              Обработчики, привлекаемые для оказания услуги, действуют по
              поручению Оператора и в объёме, необходимом для предоставления
              Сервиса.
            </p>
          </Section>

          <Section title="6. Информационные рассылки (маркетинговое согласие)">
            <p>
              Оператор вправе направлять информационные сообщения (новости,
              советы, кейсы) только пользователям, давшим отдельное добровольное
              согласие. Согласие фиксируется при регистрации и может быть отозвано
              в любой момент:
            </p>
            <ul className="ml-5 mt-2 list-disc space-y-1">
              <li>по ссылке отписки в каждом письме;</li>
              <li>
                по запросу на{" "}
                <a className="underline" href="mailto:support@patent-scan.com">
                  support@patent-scan.com
                </a>
                .
              </li>
            </ul>
            <p className="mt-2">
              Отзыв согласия на рассылку не влечёт удаления аккаунта и не
              ограничивает доступ к Сервису.
            </p>
            <p className="mt-2 text-sm text-slate-600">
              <strong>Основание обработки для рассылок:</strong> ст. 9 + ст. 6
              ч. 1 п. 1 Федерального закона №152-ФЗ; ст. 18 Федерального закона
              №38-ФЗ «О рекламе».
            </p>
          </Section>

          <Section title="7. Транзакционные письма (без отдельного согласия)">
            <p>
              Письма, связанные с оказанием услуги, направляются независимо от
              маркетингового согласия:
            </p>
            <ul className="ml-5 mt-2 list-disc space-y-1">
              <li>Magic-link для входа / регистрации.</li>
              <li>
                Напоминание о незавершённой регистрации (до 2 писем в течение
                72 часов) — продолжение начатого пользователем действия;
                правовое основание — ст. 6 ч. 1 п. 5 (исполнение договора).
              </li>
              <li>Уведомления об изменении условий Сервиса.</li>
            </ul>
          </Section>

          <Section title="8. Сроки хранения">
            <p>
              До удаления аккаунта пользователем; копии в резервных хранилищах —
              до 30 дней после удаления.
            </p>
          </Section>

          <Section title="9. Права субъекта персональных данных">
            <p>Вы вправе:</p>
            <ul className="ml-5 mt-2 list-disc space-y-1">
              <li>получить сведения об обработке и копию своих данных;</li>
              <li>потребовать исправления неверных данных;</li>
              <li>удалить аккаунт и связанные данные;</li>
              <li>отозвать согласие (влечёт удаление аккаунта);</li>
              <li>обжаловать действия оператора в Роскомнадзоре.</li>
            </ul>
            <p className="mt-2">
              Для реализации прав — письмо на{" "}
              <a className="underline" href="mailto:support@patent-scan.com">
                support@patent-scan.com
              </a>
              .
            </p>
          </Section>

          <Section title="10. Cookies">
            <p>
              Сервис использует технически необходимые cookies (для поддержания
              авторизованного сеанса) и аналитические cookies сервиса
              веб-аналитики — для измерения посещаемости и улучшения Сервиса.
              Данные веб-аналитики обрабатываются на территории Российской
              Федерации. Рекламных cookies Сервис не использует.
            </p>
            <p className="mt-2">
              Продолжая пользоваться Сервисом, вы соглашаетесь на использование
              cookies. Отключить cookies можно в настройках вашего браузера.
            </p>
          </Section>

          <Section title="11. Дата обновления">
            <p>{UPDATED_AT}</p>
          </Section>

          <div className="border-t border-slate-200 pt-6 text-sm text-slate-600">
            См. также:{" "}
            <Link href="/terms" className="underline hover:text-slate-900">
              Пользовательское соглашение
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
        This Privacy Policy is currently available in Russian only. A
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
