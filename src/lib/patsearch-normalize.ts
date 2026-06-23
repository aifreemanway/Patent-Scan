// Shared parser for PatSearch (Rospatent) hits.
// Covers two shapes the API actually returns:
//   1) classic: `h.id` + `common.classifications.ipc` (plural)
//   2) ST96-flavoured (JP/CN fresh records): no `h.id`, only
//      `common.publishing_office` + `document_number` + `kind`,
//      and classifications may live under `common.classification.ipc` (singular).
// Route handlers must use these helpers — inline copies drifted across routes
// and masked JP/CN hits. See issue #…

export type PatSearchHit = {
  id?: string;
  biblio?: {
    ru?: { title?: string; abstract?: string };
    en?: { title?: string; abstract?: string };
  };
  common?: {
    publication_date?: string;
    publishing_office?: string;
    document_number?: string;
    kind?: string;
    classifications?: { ipc?: { fullname?: string }[] };
    classification?: { ipc?: { fullname?: string }[] };
  };
};

export type NormalizedHit = {
  id: string;
  title: string;
  titleRu: string;
  titleEn: string;
  year: string;
  country: string;
  ipc: string[];
  url: string;
  abstract: string;
};

export function countryFromId(id: string): string {
  const m = /^([A-Z]{2})/.exec(id);
  return m ? m[1] : "";
}

export function buildUrl(id: string, country: string): string {
  if (!id) return "";
  if (country === "RU") {
    // Kind code picks the ФИПС register: U1/U8 = полезная модель (RUPM), all else
    // (C1/C2/A…) = изобретение (RUPAT). Wrong DB opens a DIFFERENT document with
    // the same number (QA #1: RU88863U1 → invention #88863, not the utility model).
    // The PatSearch id carries the kind: "RU88863U1_20091120".
    const m = /^RU0*(\d+)([A-Z]\d?)?/.exec(id);
    const num = m?.[1] ?? id.replace(/\D/g, "");
    const db = /^U/i.test(m?.[2] ?? "") ? "RUPM" : "RUPAT";
    return `https://new.fips.ru/registers-doc-view/fips_servlet?DB=${db}&DocNumber=${num}&TypeFile=html`;
  }
  // Foreign patents → Google Patents (human-readable), NOT the PatSearch /docs
  // endpoint (it returns raw JSON — the bug we're fixing). PatSearch ids are
  // `{CC}{number}{kind}_{date}` where the number is zero-padded to a fixed width
  // and the kind code is unreliable for US grants (PatSearch tags them `A1` where
  // Google has them as `A`). For non-US offices the kind code IS reliable.
  //
  // Strategy — strip the date and the leading-zero padding off the number, then
  // build a DIRECT doc URL (`/patent/{pn}`) so the user lands on the single
  // patent page, not a search-results page with multiple kind codes + family
  // noise. Office-specific rules:
  //   • US — drop the kind code (Google resolves the bare PN to the canonical
  //     kind, sidestepping PatSearch's unreliable grant kind). Verified:
  //     US0004572482A1 → "US4572482" → US4572482A.
  //   • EA — canonical EA numbers are 6-digit zero-padded; re-pad to 6 and keep
  //     the kind. Verified: EA0000029772B1 → "EA029772B1".
  //   • CN / JP / EP / SU / etc. — keep the kind (PatSearch's is correct).
  //     Verified: CN102077046B and CN1250747C resolve directly.
  // Fallback for ids that don't match the {CC}{digits}{kind?} shape: search.
  const m = /^([A-Z]{2})0*(\d+)([A-Z]\d?)?/.exec(id);
  if (!m) {
    return `https://patents.google.com/?q=${encodeURIComponent(id.replace(/_\d+$/, ""))}`;
  }
  const [, cc, numCore, kind] = m;
  // KZ — Kazakhstan NATIONAL patents. Google Patents does NOT index them
  // (confirmed live 404 on KZ20030B by cofounder). They reach us via the
  // PatSearch `cis` dataset, but PatSearch has no public human-readable doc
  // page (the API /docs endpoint returns raw JSON). Espacenet DOES cover KZ
  // (via the EAPO/EAEU feed), so route KZ to an Espacenet publication-number
  // SEARCH URL. A search URL always returns HTTP 200 — never a 404 — so even
  // if a specific KZ doc is absent the link lands the user on the right
  // official aggregator instead of a dead page. Anti-fab: zero 404 in
  // customer-facing links; a broken link is worse than no link.
  // Scope (per cofounder de-scope 2026-06-23): EA/CN/EP/US/JP verified working
  // on Google Patents — do NOT touch them. KZ is the only confirmed gap; other
  // CIS-national offices (UZ/TM/…) would need the same Espacenet routing IF
  // they ever appear, but KZ is the only one observed so far.
  if (cc === "KZ") {
    const pn = `${cc}${numCore}${kind ?? ""}`;
    return `https://worldwide.espacenet.com/patent/search?q=${encodeURIComponent(
      `pn=${pn}`
    )}`;
  }
  let pn: string;
  if (cc === "EA") {
    pn = `${cc}${numCore.padStart(6, "0")}${kind ?? ""}`;
  } else if (cc === "US") {
    pn = `${cc}${numCore}`;
  } else {
    pn = `${cc}${numCore}${kind ?? ""}`;
  }
  return `https://patents.google.com/patent/${encodeURIComponent(pn)}`;
}

export function resolveIdAndCountry(h: PatSearchHit): {
  id: string;
  country: string;
} {
  const pubOffice = (h.common?.publishing_office ?? "").toUpperCase();
  const docNumber = h.common?.document_number ?? "";
  const kind = h.common?.kind ?? "";
  const idFromCommon =
    pubOffice && docNumber ? `${pubOffice}${docNumber}${kind}` : "";
  const id = h.id ?? idFromCommon;
  // Prefer explicit publishing_office over regex on id — older RU hits have
  // no publishing_office, but their id starts with "RU", so countryFromId
  // is the fallback.
  const country = pubOffice || countryFromId(id);
  return { id, country };
}

export function normalizeHit(
  h: PatSearchHit,
  opts: { abstractLimit?: number } = {}
): NormalizedHit {
  const limit = opts.abstractLimit ?? 400;
  const { id, country } = resolveIdAndCountry(h);
  const pubDate = h.common?.publication_date ?? "";
  const ipcSource =
    h.common?.classifications?.ipc ?? h.common?.classification?.ipc ?? [];
  const ipc = ipcSource.map((c) => c.fullname ?? "").filter(Boolean);
  const titleRu = h.biblio?.ru?.title?.trim() ?? "";
  const titleEn = h.biblio?.en?.title?.trim() ?? "";
  const abstract = (h.biblio?.ru?.abstract ?? h.biblio?.en?.abstract ?? "")
    .trim()
    .slice(0, limit);
  return {
    id,
    title: titleRu || titleEn,
    titleRu,
    titleEn,
    year: pubDate.slice(0, 4),
    country,
    ipc,
    url: buildUrl(id, country),
    abstract,
  };
}
