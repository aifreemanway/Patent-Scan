"""Inject LiteratureReview.* namespace + apply ap-ba brand-term revert
(2026-05-30: «Литературный и технологический обзор» → «Литературный обзор»).
Run from web/: `python scripts/add-literature-review-i18n.py`. Idempotent.
Delete after PR-3 lands."""
import json
from pathlib import Path

LITREVIEW_RU = {
    "title": "Литературный обзор",
    "explainer": "Отраслевой технологический разбор по вашей теме: производители, технологии, конкуренты, источники.",
    "short": "обзор",
    "intake": {
        "h1": "Литературный обзор по вашей теме",
        "lead": "Соберём данные из научных публикаций, патентов и открытых отраслевых источников, сведём в структурированный отчёт с таблицами производителей, технологий и конкурентов.",
        "explainer": "Отраслевой технологический разбор по вашей теме: производители, технологии, конкуренты, источники. Не академический литобзор и не ГОСТ-патентное исследование.",
        "trust": "Без выдуманных данных: каждое утверждение в обзоре подкреплено ссылкой на источник.",
        "topicLabel": "Тема обзора",
        "topicPlaceholder": "Например: «Технологии переработки сурьмы (Sb₂O₃): производители, оборудование, патентная картина в РФ и КНР за 2015-2026 годы»",
        "topicHelper": "Опишите тему так, как сформулировали бы её для технолога. 50-500 символов.",
        "industryLabel": "Отрасль",
        "industryPlaceholder": "Выберите отрасль",
        "industryHelper": "Влияет на выбор отраслевых баз и патентных классификаций (МПК/CPC).",
        "regionsLabel": "Страны и регионы интереса",
        "regionsHelper": "Сужает географию поиска производителей, заводов и патентных юрисдикций. Можно отметить несколько.",
        "periodLabel": "Период публикаций",
        "periodHelper": "Учитываются публикации, патенты и материалы за выбранный период. Для большинства отраслей оптимально 10-15 лет.",
        "hypothesesLabel": "Гипотезы и ключевые вопросы — опционально",
        "hypothesesPlaceholder": "Например: «Интересуют технологии очистки отходящих газов на медеплавильных заводах; гипотеза — флэш-печи доминируют в EU и Северной Америке».",
        "hypothesesHelper": "Если у вас уже есть гипотезы или конкретные подвопросы — добавьте их сюда. Обзор будет специально проверять и подсвечивать эти моменты в выводах.",
        "submit": "Запустить обзор",
        "submitting": "Создаём запрос…",
        "submitDisclaimer": "Нажимая кнопку, вы соглашаетесь с <terms>условиями использования</terms> и <privacy>политикой обработки данных</privacy>.",
        "errors": {
            "topic_too_short": "Слишком коротко. Минимум 50 символов, чтобы поиск понял контекст.",
            "topic_too_long": "Превышен лимит. Сократите до 500 символов или вынесите детали в поле «Гипотезы».",
            "invalid_industry": "Выберите отрасль — это влияет на выбор источников.",
            "no_regions": "Отметьте хотя бы один регион.",
            "invalid_period": "Проверьте годы периода.",
            "period_too_old": "Минимум — 1990 год.",
            "period_in_future": "Год окончания не может быть в будущем.",
            "period_reversed": "Год начала должен быть раньше года окончания.",
            "period_too_wide": "Период слишком длинный (>50 лет). Сузьте до 5-30 лет.",
            "quota_exceeded": "В вашем тарифе нет доступных обзоров в этом месяце. Перейдите в Личный кабинет, чтобы увидеть варианты.",
            "unauthorized": "Войдите в аккаунт, чтобы запустить обзор.",
            "email_not_verified": "Подтвердите email — мы выслали ссылку при регистрации.",
            "insert_failed": "Не удалось создать запрос. Попробуйте ещё раз через минуту.",
            "network": "Не удалось отправить запрос. Проверьте интернет и повторите.",
            "generic": "На стороне сервиса временная ошибка. Попробуйте ещё раз через минуту."
        }
    },
    "industries": {
        "metallurgy": "Металлургия и горное дело",
        "chemistry": "Химия и материалы",
        "mechanical": "Машиностроение и оборудование",
        "energy": "Энергетика и нефтегаз",
        "biotech": "Биотех, фармацевтика, медицина",
        "electronics": "Электроника и IT",
        "agriculture": "Сельское хозяйство и пищепром",
        "other": "Другое"
    },
    "regions": {
        "RU": "Россия",
        "CIS": "СНГ",
        "CN": "Китай",
        "US": "США и Канада",
        "EU": "Евросоюз",
        "UK": "Великобритания",
        "JP_KR": "Япония и Южная Корея",
        "AU_NZ": "Австралия и Новая Зеландия",
        "LATAM": "Латинская Америка",
        "ME": "Ближний Восток",
        "AF": "Африка",
        "WORLD": "Весь мир"
    },
    "processing": {
        "h1": "Обзор обрабатывается",
        "subtitle": "Запрос #{id} принят. Ожидаемое время готовности — 1-3 рабочих дня.",
        "missingId": "Не указан ID запроса. Перейдите по ссылке из письма или из истории запросов.",
        "loading": "Загружаем статус…",
        "notFound": "Запрос не найден или не принадлежит вашему аккаунту.",
        "backToHistory": "Вернуться к истории запросов",
        "status": "Текущая стадия",
        "queued": "В очереди на обработку",
        "stages": {
            "stage1": "Уточняем поисковые запросы",
            "stage2": "Собираем публикации и патенты",
            "stage3": "Извлекаем сущности",
            "stage4": "Заполняем сравнительные таблицы",
            "stage5": "Классифицируем технологии",
            "stage6": "Формулируем выводы",
            "stage7": "Проверяем источники",
            "stage8": "Готовим раздел оговорок",
            "stage9": "Собираем отчёт"
        },
        "whatNext": "Что произойдёт дальше:",
        "whatNext1": "Мы обработаем запрос и пришлём готовый обзор на ваш email в течение 1-3 рабочих дней.",
        "whatNext2": "Обзор также появится в личном кабинете в разделе «История запросов».",
        "whatNext3": "Если потребуется доработка или повторный запрос с правками — это можно сделать одной кнопкой из истории.",
        "closeWindowHint": "Окно можно закрыть — обработка продолжится в фоне.",
        "viewHistory": "Перейти в личный кабинет",
        "startNew": "Создать ещё один обзор",
        "doneTitle": "Обзор готов",
        "doneBody": "Запрос #{id} обработан. Скачайте отчёт или откройте его в личном кабинете.",
        "downloadReport": "Скачать отчёт",
        "errorTitle": "Не удалось подготовить обзор",
        "errorBody": "При обработке произошла ошибка. Деньги/квота возвращены. Можно повторить запрос.",
        "retry": "Повторить",
        "cancelled": "Запрос отменён."
    }
}

LITREVIEW_EN = {
    "title": "Literature review",
    "explainer": "Industry-tech overview of your topic: producers, technologies, competitors, sources.",
    "short": "review",
    "intake": {
        "h1": "Literature review on your topic",
        "lead": "We gather scientific publications, patents and open industry sources and synthesise a structured report with tables of producers, technologies and competitors.",
        "explainer": "Industry-tech overview of your topic: producers, technologies, competitors, sources. Not an academic literature review and not a formal patentability study.",
        "trust": "No invented data: every statement in the report is backed by a real source URL.",
        "topicLabel": "Topic",
        "topicPlaceholder": "e.g. \"Antimony oxide (Sb₂O₃) processing technologies: producers, equipment, patent landscape in RU and CN for 2015-2026\"",
        "topicHelper": "Describe the topic as you would for a technologist. 50-500 characters.",
        "industryLabel": "Industry",
        "industryPlaceholder": "Select industry",
        "industryHelper": "Drives the choice of industry databases and patent classifications (IPC/CPC).",
        "regionsLabel": "Regions of interest",
        "regionsHelper": "Narrows the geography of producers, plants and patent jurisdictions. Select multiple.",
        "periodLabel": "Publication period",
        "periodHelper": "Includes publications, patents and materials within the selected period. 10-15 years is usually optimal.",
        "hypothesesLabel": "Hypotheses and key questions — optional",
        "hypothesesPlaceholder": "e.g. \"Interested in off-gas treatment technologies in copper smelters; hypothesis — flash furnaces dominate in EU/NA\".",
        "hypothesesHelper": "If you already have hypotheses or specific sub-questions, add them — the review will specifically check and highlight them.",
        "submit": "Run review",
        "submitting": "Creating request…",
        "submitDisclaimer": "By clicking the button you agree to the <terms>terms of use</terms> and <privacy>data processing policy</privacy>.",
        "errors": {
            "topic_too_short": "Too short. Minimum 50 characters so the search has enough context.",
            "topic_too_long": "Over the limit. Trim to 500 characters or move detail to «Hypotheses».",
            "invalid_industry": "Pick an industry — it affects the source choice.",
            "no_regions": "Pick at least one region.",
            "invalid_period": "Check the period years.",
            "period_too_old": "Earliest year is 1990.",
            "period_in_future": "End year cannot be in the future.",
            "period_reversed": "Start year must be earlier than end year.",
            "period_too_wide": "Period too wide (>50 years). Narrow to 5-30 years.",
            "quota_exceeded": "No reviews left in your plan this month. Go to the account to see options.",
            "unauthorized": "Sign in to run a review.",
            "email_not_verified": "Confirm your email — we sent a link at signup.",
            "insert_failed": "Couldn't create the request. Try again in a minute.",
            "network": "Couldn't send the request. Check your internet and retry.",
            "generic": "Temporary service-side error. Try again in a minute."
        }
    },
    "industries": {
        "metallurgy": "Metallurgy & mining",
        "chemistry": "Chemistry & materials",
        "mechanical": "Machinery & equipment",
        "energy": "Energy & oil/gas",
        "biotech": "Biotech, pharma, medicine",
        "electronics": "Electronics & IT",
        "agriculture": "Agriculture & food",
        "other": "Other"
    },
    "regions": {
        "RU": "Russia",
        "CIS": "CIS",
        "CN": "China",
        "US": "US & Canada",
        "EU": "European Union",
        "UK": "United Kingdom",
        "JP_KR": "Japan & South Korea",
        "AU_NZ": "Australia & New Zealand",
        "LATAM": "Latin America",
        "ME": "Middle East",
        "AF": "Africa",
        "WORLD": "Worldwide"
    },
    "processing": {
        "h1": "Review in progress",
        "subtitle": "Request #{id} accepted. Expected ready time — 1-3 business days.",
        "missingId": "Request ID is missing. Use the link from the email or from your request history.",
        "loading": "Loading status…",
        "notFound": "Request not found or not yours.",
        "backToHistory": "Back to request history",
        "status": "Current stage",
        "queued": "Queued for processing",
        "stages": {
            "stage1": "Refining search queries",
            "stage2": "Harvesting publications and patents",
            "stage3": "Extracting entities",
            "stage4": "Filling comparative tables",
            "stage5": "Classifying technologies",
            "stage6": "Formulating conclusions",
            "stage7": "Verifying sources",
            "stage8": "Preparing caveats section",
            "stage9": "Assembling the report"
        },
        "whatNext": "What happens next:",
        "whatNext1": "We process the request and email the ready review to you within 1-3 business days.",
        "whatNext2": "The review will also appear in your account under «Request history».",
        "whatNext3": "If you need a follow-up or a rerun with edits — one click from the history.",
        "closeWindowHint": "You can close this tab — processing continues in the background.",
        "viewHistory": "Open account",
        "startNew": "Start another review",
        "doneTitle": "Review is ready",
        "doneBody": "Request #{id} processed. Download the report or open it in your account.",
        "downloadReport": "Download report",
        "errorTitle": "Couldn't prepare the review",
        "errorBody": "An error occurred during processing. Money/quota refunded. You can retry the request.",
        "retry": "Retry",
        "cancelled": "Request cancelled."
    }
}


def revert_account_brand_term(data: dict) -> None:
    """ap-ba 2026-05-30: revert «Литературный и технологический обзор» → «Литературный обзор»."""
    if "Account" not in data:
        return
    acc = data["Account"]
    # Russian copy paths
    if "overview" in acc:
        ov = acc["overview"]
        if "quotaLitReview" in ov and ov["quotaLitReview"] == "Литературный и технологический обзор":
            ov["quotaLitReview"] = "Литературный обзор"
        if "quotaLitReview" in ov and ov["quotaLitReview"] == "Literature & technology review":
            ov["quotaLitReview"] = "Literature review"
        if "promoBody" in ov:
            ov["promoBody"] = ov["promoBody"].replace(
                "литературные и технологические обзоры",
                "литературные обзоры",
            ).replace(
                "literature & technology reviews",
                "literature reviews",
            )
    if "profile" in acc:
        pr = acc["profile"]
        if "emailReadyBody" in pr:
            pr["emailReadyBody"] = pr["emailReadyBody"].replace(
                "литературный и технологический обзор готов",
                "литературный обзор готов",
            ).replace(
                "literature & technology review is ready",
                "literature review is ready",
            )


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    for filename, block in (("ru.json", LITREVIEW_RU), ("en.json", LITREVIEW_EN)):
        path = root / "messages" / filename
        data = json.loads(path.read_text(encoding="utf-8"))
        data["LiteratureReview"] = block
        revert_account_brand_term(data)
        path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
            newline="\n",
        )
        print(f"Updated {path}")


if __name__ == "__main__":
    main()
