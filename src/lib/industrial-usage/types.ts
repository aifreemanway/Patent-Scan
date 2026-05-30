// Industrial Usage Layer — output schema for one patent.
// Per Antepatent/specs/industrial-usage-spec-2026-05-30.md §2.
//
// Anti-fabrication contract: every concrete claim (product, competitor,
// assignee profile field) MUST carry a sourceRef into the §sources list.

export type IUSource = {
  ref: number;
  title: string;
  url: string;
  /** ISO date when this URL last verified reachable; null = broken/archived. */
  reachedAt: string | null;
};

export type IUAssignee = {
  /** Original assignee string from the patent record. */
  original: string;
  /** Canonical entity name (dedupe Outokumpu OY = Outokumpu Oyj = Outokumpu Group). */
  canonical: string;
  /** ISO 2-letter country code, e.g. "FI", "IT", "CN". */
  country: string;
  /** 1-2 sentences describing the company (industry, scale). Empty if no source. */
  description: string;
  /** Company website if found and verified reachable. */
  website?: string;
  sourceRefs: number[];
};

export type IUProduct = {
  /** Product name or product-line label. */
  name: string;
  /** 1-2 sentences linking the product to this patent. */
  description: string;
  sourceRefs: number[];
};

export type IUCompetitor = {
  /** Competitor company canonical name. */
  name: string;
  /** Country if available. */
  country?: string;
  /** Why this is a competitor (their analogous technology, 1 sentence). */
  technology: string;
  sourceRefs: number[];
};

export type IUReport = {
  patentId: string;
  patentTitle: string;
  assignee: IUAssignee;
  products: IUProduct[];
  competitors: IUCompetitor[];
  /** Honest caveats when data is sparse — never fabricate to fill gaps. */
  caveats: string[];
  sources: IUSource[];
};

export type IUStageHarvest = {
  /** Wikipedia / web pages about the company. */
  companyPages: Array<{ title: string; url: string; snippet?: string }>;
  /** Web pages mentioning the patent + products. */
  productPages: Array<{ title: string; url: string; snippet?: string }>;
  /** Web pages about competitors in the technology area. */
  competitorPages: Array<{ title: string; url: string; snippet?: string }>;
};
