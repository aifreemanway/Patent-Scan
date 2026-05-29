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
    const num = /^RU(\d+)/.exec(id)?.[1] ?? id.replace(/\D/g, "");
    return `https://new.fips.ru/registers-doc-view/fips_servlet?DB=RUPAT&DocNumber=${num}&TypeFile=html`;
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
