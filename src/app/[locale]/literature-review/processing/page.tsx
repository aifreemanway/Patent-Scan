import { setRequestLocale, getTranslations } from "next-intl/server";
import { Header } from "@/components/Header";
import { ProcessingClient } from "./ProcessingClient";

export default async function ProcessingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ id?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("LiteratureReview.processing");
  const { id } = await searchParams;

  return (
    <>
      <Header />
      <main className="flex-1 px-6 py-12">
        <div className="mx-auto max-w-2xl">
          <header className="mb-8">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              {t("h1")}
            </h1>
            {id && (
              <p className="mt-2 text-sm text-slate-600">
                {t("subtitle", { id: id.slice(0, 8) })}
              </p>
            )}
          </header>
          {id ? <ProcessingClient id={id} /> : <NoId />}
        </div>
      </main>
    </>
  );
}

async function NoId() {
  const t = await getTranslations("LiteratureReview.processing");
  return (
    <p className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
      {t("missingId")}
    </p>
  );
}
