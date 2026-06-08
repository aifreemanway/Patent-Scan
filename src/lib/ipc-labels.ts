// Human labels for IPC main-groups, for the field-view class headers (ТЗ §4.1).
//
// Anti-fab: this is a SMALL curated map of accurate, well-established IPC group
// titles (paraphrased to plain Russian). It is intentionally incomplete — an
// unknown main-group returns null and the UI shows the raw code only, NEVER a
// guessed label. Extend deliberately with verified titles; do not auto-generate.
//
// i18n: labels here are Russian; the EN variant lives in messages/en.json keyed
// by code (the UI prefers the i18n string, falling back to this map's RU label).

const LABELS_RU: Record<string, string> = {
  // — electrical measurement / motor diagnostics (Samara EMM domain) —
  G01R: "Измерение электрических величин",
  G01R19: "Измерение тока и напряжения",
  G01R31: "Испытание и диагностика электрических цепей и компонентов",
  G01R23: "Измерение частоты и спектра",
  H02K: "Электрические машины (двигатели и генераторы)",
  H02P: "Управление электродвигателями",
  H02H: "Защита электрических устройств от аварийных режимов",
  G01M: "Испытание механических деталей и балансировка",
  G01M13: "Испытание зубчатых передач и подшипников",
  G01H: "Измерение механических колебаний (вибрации)",
  G06F: "Обработка цифровых данных (вычислительная техника)",
  // — pyrometallurgy / furnaces (NORD caisson domain) —
  C21C: "Обработка чугуна и производство стали",
  C22B: "Металлургия цветных металлов",
  F27B: "Промышленные печи",
  F27D: "Детали и оборудование промышленных печей",
};

// EN mirror of the curated map (ТЗ §4.1 i18n / AC#9). Same keys; an entry absent
// here falls back to the RU label, then to null — never a fabricated title.
const LABELS_EN: Record<string, string> = {
  G01R: "Measuring electric variables",
  G01R19: "Measuring current and voltage",
  G01R31: "Testing and diagnostics of electric circuits and components",
  G01R23: "Measuring frequency and spectrum",
  H02K: "Electric machines (motors and generators)",
  H02P: "Control of electric motors",
  H02H: "Protection of electrical devices against fault conditions",
  G01M: "Testing of machine parts and balancing",
  G01M13: "Testing of gears and bearings",
  G01H: "Measurement of mechanical vibrations",
  G06F: "Electric digital data processing",
  C21C: "Processing of pig iron and steelmaking",
  C22B: "Metallurgy of non-ferrous metals",
  F27B: "Industrial furnaces",
  F27D: "Details and accessories of industrial furnaces",
};

/** Plain-language label for an IPC main-group ("G01R31" → "Испытание...") or its
 *  subclass ("G01R"), or null if not in the curated map. Tries the full main-group
 *  first, then the 4-char subclass. EN falls back to the RU label when no EN entry
 *  exists. Never fabricates — an unknown code returns null and the UI shows the
 *  raw code only. */
export function ipcMainGroupLabel(
  mainGroup: string,
  locale: "ru" | "en" = "ru"
): string | null {
  const mg = mainGroup.replace(/\s+/g, "").toUpperCase();
  const subclass = mg.slice(0, 4);
  if (locale === "en") {
    return LABELS_EN[mg] ?? LABELS_EN[subclass] ?? LABELS_RU[mg] ?? LABELS_RU[subclass] ?? null;
  }
  return LABELS_RU[mg] ?? LABELS_RU[subclass] ?? null;
}
