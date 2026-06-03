// Examiner-grade prior-art retrieval — P2 v2 (recall redesign, on a COPY).
//
// This is a deliberate COPY of novelty-retrieval.ts (cofounder GO 2026-06-03:
// "на КОПИИ novelty-пути, докажи сдвиг union, ПОТОМ извлекай retrieval-core").
// The prod path (novelty-retrieval.ts) is untouched and keeps serving /search.
// v2 is wired only into the t1 harness until the union shift is proven on the
// exact Самара input; then we promote it and tier depth by product.
//
// ROOT CAUSE (T1 union 1/32, RU2854805 not even in pool): retrieval DEPTH and
// TARGETING, not ranking — the ranker can't lift what was never retrieved. Two
// mechanisms starved the pool:
//   (a) a verbose blob is semantically AVERAGED into one fuzzy vector, so a
//       single-facet analog never surfaces; and
//   (b) a broad subclass (G01R ≈ 65k docs) was only ever read top-30 deep.
//
// v2 adds three things over the prod path (design §3.1–§3.3):
//   3.1 FACET decomposition — split the invention into 8–12 atomic facets, one
//       semantic probe each (the single biggest union mover).
//   3.2 DEPTH pagination — walk high-value subclasses limit×N pages deep
//       (offset), surfacing in-class analogs past the top page.
//   3.3 SUBGROUP enumeration — sweep the ACTUAL classification.ipc subgroups the
//       facet/probe hits cluster in, not just the planner's guessed groups.
//
// DEPTH TIERING (cofounder Q1): "lite" = free Поиск (no facets, shallow, ~2–4
// min, keeps the "за минуты" hook); "full" = paid Deep/Ландшафт/Скрининг (facets
// + deep pagination, ~6–8 min, async). Depth-recall becomes a paid lever.

export type PatentHit = {
  id: string;
  title?: string;
  titleRu?: string;
  titleEn?: string;
  year?: string;
  country?: string;
  ipc?: string[];
  url?: string;
  abstract?: string;
};

export type RetrievalDepth = "lite" | "full";

export type NoveltyRetrievalResult = {
  hits: PatentHit[];
  total: number;
  // Diagnostics for cross-check / harness — never shown to users.
  diagnostics: {
    depth: RetrievalDepth;
    planned: boolean;
    usedLegacyFallback: boolean;
    facetCount: number;
    poolSemantic: number;
    poolFacet: number;
    poolSweep: number;
    topGroups: string[];
    planSubclasses: string[];
    sweptSubclasses: string[];
    // Subclasses walked with offset-pagination (depth) and the actual subgroups
    // enumerated from facet/probe hits — logged so a recall miss can be traced.
    paginatedSubclasses: string[];
    enumeratedSubgroups: string[];
    // 3.5 tiered-rank: size of the in-class precision seed and how many of its
    // ranked hits reached the window — lets us see whether the precision tier
    // actually claimed window slots vs being drowned by the breadth pool.
    prioritySeed: number;
    priorityRanked: number;
    ranked: number;
  };
};

// Full IPC group, e.g. "C21C5/46" (no space).
const IPC_GROUP_RE = /^[A-H]\d{2}[A-Z]\d{1,4}\/\d{1,6}$/;
const IPC_SUBCLASS_RE = /^[A-H]\d{2}[A-Z]$/;

type FetchImpl = typeof fetch;
type SweepFilter = { ipcGroups?: string[]; ipcSubclasses?: string[] };

// Max concurrent PatSearch calls. The full sweep fans out ~400 requests; firing
// them all at once makes the upstream drop connections (ECONNRESET), so we cap
// in-flight requests. Also keeps us a polite client of the Rospatent API.
const FETCH_CONCURRENCY = 10;

// Per-depth tuning. "full" pays latency for recall depth; "lite" stays fast.
const TUNING: Record<
  RetrievalDepth,
  {
    useFacets: boolean;
    maxTopGroups: number;
    maxSweepSubclasses: number;
    maxPaginatedSubclasses: number;
    maxEnumeratedSubgroups: number;
    depthPages: number; // pages walked for paginated (broad) subclasses
    sweepLimit: number; // hits per sweep page
    roundRobinCap: number;
    poolCap: number;
  }
> = {
  lite: {
    useFacets: false,
    maxTopGroups: 8,
    maxSweepSubclasses: 3,
    maxPaginatedSubclasses: 0, // no pagination on the fast path
    maxEnumeratedSubgroups: 0,
    depthPages: 1,
    sweepLimit: 30,
    roundRobinCap: 20,
    poolCap: 720,
  },
  full: {
    useFacets: true,
    maxTopGroups: 16,
    maxSweepSubclasses: 6,
    maxPaginatedSubclasses: 4,
    maxEnumeratedSubgroups: 12,
    depthPages: 3, // limit 50 × 3 = depth 150 in each broad subclass
    sweepLimit: 50,
    roundRobinCap: 40,
    poolCap: 1080,
  },
};

// Run `fn` over `items` with at most `concurrency` promises in flight.
async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const idx = next++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker)
  );
  return out;
}

async function searchLandscape(
  base: string,
  fetchImpl: FetchImpl,
  qn: string,
  datasets: string[],
  filter?: SweepFilter,
  limit = 30,
  offset = 0
): Promise<{ hits: PatentHit[]; total: number }> {
  try {
    const r = await fetchImpl(`${base}/api/landscape/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        qn,
        datasets,
        limit,
        offset,
        ...(filter?.ipcGroups?.length ? { ipcGroups: filter.ipcGroups } : {}),
        ...(filter?.ipcSubclasses?.length
          ? { ipcSubclasses: filter.ipcSubclasses }
          : {}),
      }),
    });
    if (!r.ok) return { hits: [], total: 0 };
    const j = (await r.json()) as { hits?: PatentHit[]; total?: number };
    return { hits: j.hits ?? [], total: j.total ?? 0 };
  } catch {
    return { hits: [], total: 0 };
  }
}

// Merge per-task result lists by each doc's BEST rank across lists (ties → docs
// seen in more lists first). Best-rank keeps a strong analog that sits at e.g.
// rank #4 in one IPC-filtered list near the front, so the precision of the IPC
// sweep survives the merge instead of being buried under ~70 lists' heads.
function bestRankMerge(results: { hits: PatentHit[] }[]): PatentHit[] {
  const best = new Map<string, { hit: PatentHit; minIdx: number; count: number }>();
  for (const res of results) {
    (res.hits ?? []).forEach((h, idx) => {
      if (!h?.id) return;
      const cur = best.get(h.id);
      if (!cur) best.set(h.id, { hit: h, minIdx: idx, count: 1 });
      else {
        cur.minIdx = Math.min(cur.minIdx, idx);
        cur.count += 1;
      }
    });
  }
  return [...best.values()]
    .sort((a, b) => a.minIdx - b.minIdx || b.count - a.count)
    .map((e) => e.hit);
}

// Interleave several already-ranked lists, taking up to `cap` from each.
function roundRobinLists(lists: PatentHit[][], cap: number): PatentHit[] {
  const out: PatentHit[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < cap; i++) {
    for (const l of lists) {
      const h = l[i];
      if (h && h.id && !seen.has(h.id)) {
        seen.add(h.id);
        out.push(h);
      }
    }
  }
  return out;
}

function toRankCandidate(h: PatentHit) {
  return {
    id: h.id,
    title: h.title || h.titleEn || h.titleRu,
    abstract: (h.abstract ?? "").slice(0, 200),
    year: h.year,
    country: h.country,
  };
}

async function rankCall(
  base: string,
  fetchImpl: FetchImpl,
  description: string,
  candidates: PatentHit[],
  limit: number
): Promise<string[]> {
  try {
    const resp = await fetchImpl(`${base}/api/prior-art-rank`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description,
        candidates: candidates.map(toRankCandidate),
        limit,
      }),
    });
    if (!resp.ok) return [];
    const { ids } = (await resp.json()) as { ids?: string[] };
    return Array.isArray(ids) ? ids : [];
  } catch {
    return [];
  }
}

function mapIds(ids: string[], source: PatentHit[]): PatentHit[] {
  const byId = new Map(source.map((h) => [h.id, h]));
  return ids
    .map((id) => byId.get(id))
    .filter((h): h is PatentHit => Boolean(h));
}

async function legacySearch(
  base: string,
  fetchImpl: FetchImpl,
  description: string
): Promise<{ hits: PatentHit[]; total: number }> {
  const resp = await fetchImpl(`${base}/api/search-rospatent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: description, limit: 20 }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || `Search failed (${resp.status})`);
  }
  const data = (await resp.json()) as { hits?: PatentHit[]; total?: number };
  return {
    hits: data.hits ?? [],
    total: data.total ?? (data.hits?.length ?? 0),
  };
}

type Facet = { ru: string; en: string };

// Call the facet-decompose route (full depth only). Returns [] on any failure
// so retrieval degrades gracefully to the aspect+probe path.
async function decomposeFacetsRemote(
  base: string,
  fetchImpl: FetchImpl,
  invention: string
): Promise<Facet[]> {
  try {
    const r = await fetchImpl(`${base}/api/facet-decompose`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invention }),
    });
    if (!r.ok) return [];
    const j = (await r.json()) as { facets?: Facet[] };
    return Array.isArray(j.facets) ? j.facets : [];
  } catch {
    return [];
  }
}

export async function retrieveNoveltyPriorArt(opts: {
  description: string;
  answers?: string[];
  base?: string; // "" = relative (browser); absolute origin for Node callers.
  fetchImpl?: FetchImpl;
  rankLimit?: number;
  depth?: RetrievalDepth; // "lite" = fast free Поиск; "full" = paid deep tier.
}): Promise<NoveltyRetrievalResult> {
  const base = opts.base ?? "";
  const fetchImpl = opts.fetchImpl ?? fetch;
  const description = opts.description.trim();
  const cleanAnswers = (opts.answers ?? []).filter((a) => a.trim().length > 0);
  const rankLimit = opts.rankLimit ?? 60;
  const depth: RetrievalDepth = opts.depth ?? "full";
  const tune = TUNING[depth];

  let hits: PatentHit[] = [];
  let total = 0;
  let planned = false;
  let usedLegacyFallback = false;
  let topGroups: string[] = [];
  let planSubclassesDiag: string[] = [];
  let sweptSubclassesDiag: string[] = [];
  let paginatedSubclassesDiag: string[] = [];
  let enumeratedSubgroupsDiag: string[] = [];
  let facetCount = 0;
  let poolSemanticLen = 0;
  let poolFacetLen = 0;
  let poolSweepLen = 0;
  let inClassPool: PatentHit[] = [];
  let prioritySeed: PatentHit[] = [];
  let prioritySeedLen = 0;
  let priorityRankedLen = 0;

  const topic = [description, ...cleanAnswers].join("\n");

  // Per-region buckets: CN crowds out US/EP/JP when datasets are queried
  // together, so each English query runs against [us,ep], [jp], [cn] separately;
  // Russian queries hit RU/SU/CIS.
  const regionBuckets: { datasets: string[]; lang: "ru" | "en" }[] = [
    { datasets: ["ru_since_1994", "ru_till_1994", "cis"], lang: "ru" },
    { datasets: ["us", "ep"], lang: "en" },
    { datasets: ["jp"], lang: "en" },
    { datasets: ["cn"], lang: "en" },
  ];

  // Stage 0 (full only) + plan run concurrently — independent LLM calls.
  const [planResp, facets] = await Promise.all([
    fetchImpl(`${base}/api/landscape/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic }),
    }),
    tune.useFacets
      ? decomposeFacetsRemote(base, fetchImpl, topic)
      : Promise.resolve([] as Facet[]),
  ]);
  facetCount = facets.length;

  if (planResp.ok) {
    planned = true;
    const plan = (await planResp.json()) as {
      queries?: string[];
      queriesEn?: string[];
      functionQuery?: string;
      functionQueryEn?: string;
      functionQuery2?: string;
      functionQuery2En?: string;
      structureQuery?: string;
      structureQueryEn?: string;
      ipcSubclasses?: string[];
      ipcGroups?: string[];
    };
    const ruQueries = plan.queries ?? [];
    const enQueries = plan.queriesEn ?? [];
    const probesRu = [plan.functionQuery, plan.functionQuery2, plan.structureQuery]
      .map((q) => (q ?? "").trim())
      .filter((q) => q.length >= 3);
    const probesEn = [
      plan.functionQueryEn,
      plan.functionQuery2En,
      plan.structureQueryEn,
    ]
      .map((q) => (q ?? "").trim())
      .filter((q) => q.length >= 3);
    const planSubclasses = (plan.ipcSubclasses ?? [])
      .map((c) => (typeof c === "string" ? c.trim() : ""))
      .filter((c) => IPC_SUBCLASS_RE.test(c));
    const planGroups = (plan.ipcGroups ?? [])
      .map((g) => (typeof g === "string" ? g.replace(/\s+/g, "") : ""))
      .filter((g) => IPC_GROUP_RE.test(g));

    const probesFor = (lang: "ru" | "en") => (lang === "ru" ? probesRu : probesEn);

    // ── Stage 1 — semantic multi-query (recall breadth) ──────────────
    // Aspect queries (plan), de-anchored probes (function ×2 + structure), and —
    // FULL depth only — atomic FACET queries. Probes + facets are kept separate
    // as the most on-target signal for deriving sweep classes: they pull in the
    // classes of analogs that whole-pool frequency would bury.
    const aspectTasks: { qn: string; datasets: string[] }[] = [];
    const probeTasks: { qn: string; datasets: string[] }[] = [];
    for (const b of regionBuckets) {
      for (const qn of b.lang === "ru" ? ruQueries : enQueries) {
        aspectTasks.push({ qn, datasets: b.datasets });
      }
      for (const qn of probesFor(b.lang)) {
        probeTasks.push({ qn, datasets: b.datasets });
      }
    }
    // Facets: RU phrase → RU bucket; EN phrase → [us,ep] + [cn] (skip the JP
    // bucket on facets — facets are a breadth net and JP is the sparsest office
    // for our RU-centric etalons; the probes still cover JP). Bounds facet cost
    // to ~3 calls/facet.
    const facetTasks: { qn: string; datasets: string[] }[] = [];
    for (const f of facets) {
      if (f.ru) facetTasks.push({ qn: f.ru, datasets: ["ru_since_1994", "ru_till_1994", "cis"] });
      if (f.en) {
        facetTasks.push({ qn: f.en, datasets: ["us", "ep"] });
        facetTasks.push({ qn: f.en, datasets: ["cn"] });
      }
    }

    const allStage1 = await mapPool(
      [...aspectTasks, ...probeTasks, ...facetTasks],
      FETCH_CONCURRENCY,
      (t) => searchLandscape(base, fetchImpl, t.qn, t.datasets)
    );
    const aspectResults = allStage1.slice(0, aspectTasks.length);
    const probeResults = allStage1.slice(
      aspectTasks.length,
      aspectTasks.length + probeTasks.length
    );
    const facetResults = allStage1.slice(aspectTasks.length + probeTasks.length);
    total += allStage1.reduce((acc, r) => acc + r.total, 0);

    // Signal hits = probes + facets (the on-target queries). Used both for
    // deriving sweep classes and for enumerating actual subgroups (3.3).
    const signalHits = bestRankMerge([...probeResults, ...facetResults]);
    const facetHits = bestRankMerge(facetResults);
    const poolSemantic = bestRankMerge([
      ...aspectResults,
      ...probeResults,
      ...facetResults,
    ]);
    poolSemanticLen = poolSemantic.length;
    poolFacetLen = facetHits.length;

    // ── Stage 2 — IPC class-sweep ────────────────────────────────────
    // Derive target groups from the IPC of the SIGNAL hits (probes+facets), NOT
    // whole-pool frequency: a strong but specialised analog is a frequency
    // outlier in a pool dominated by adjacent classes. Plan-declared subclasses
    // are boosted so a relevant class is swept even when under-surfaced.
    const groupFreq = new Map<string, number>();
    for (const h of signalHits) {
      for (const g of h.ipc ?? []) {
        if (IPC_GROUP_RE.test(g)) groupFreq.set(g, (groupFreq.get(g) ?? 0) + 1);
      }
    }
    if (planSubclasses.length) {
      for (const [g, c] of groupFreq) {
        if (planSubclasses.includes(g.slice(0, 4))) groupFreq.set(g, c + 1000);
      }
    }
    // 3.3 — ACTUAL subgroups the signal hits cluster in, ranked by frequency.
    // The planner guesses subgroups (G01R19/00) but analogs sit in siblings
    // (G01R19/02); enumerating real codes from hits targets depth where analogs
    // actually are. Take the most frequent that are NOT plan groups.
    const enumeratedSubgroups = [...groupFreq.entries()]
      .filter(([g]) => !planGroups.includes(g))
      .sort((a, b) => b[1] - a[1])
      .slice(0, tune.maxEnumeratedSubgroups)
      .map(([g]) => g);
    enumeratedSubgroupsDiag = enumeratedSubgroups;

    const probeTopGroups = [...groupFreq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([g]) => g);

    // SEED with plan-declared full IPC groups first (highest-confidence target
    // classes), then enumerated actual subgroups (3.3), then probe-derived
    // groups. A direct classification.ipc sweep surfaces in-class analogs
    // regardless of phrasing — even when no probe hit carried the group.
    const seenGroups = new Set<string>();
    topGroups = [];
    for (const g of [...planGroups, ...enumeratedSubgroups, ...probeTopGroups]) {
      if (g && !seenGroups.has(g)) {
        seenGroups.add(g);
        topGroups.push(g);
      }
    }
    topGroups = topGroups.slice(0, tune.maxTopGroups);

    // Recall NET: sweep the 4-char SUBCLASS of every plan/probe group, not only
    // the planner's explicit ipcSubclasses. PatSearch classification.ipc is
    // exact-subgroup match, so sweeping the SUBCLASS (classification.ipc_subclass)
    // catches EVERY sibling subgroup the exact-group sweep would miss.
    const groupDerivedSubclasses = topGroups
      .map((g) => g.slice(0, 4))
      .filter((s) => IPC_SUBCLASS_RE.test(s));
    const sweepSubclasses = [
      ...new Set([...planSubclasses, ...groupDerivedSubclasses]),
    ].slice(0, tune.maxSweepSubclasses);
    planSubclassesDiag = planSubclasses;
    sweptSubclassesDiag = sweepSubclasses;

    // 3.2 — high-value subclasses to walk DEEP (offset-pagination). The planner's
    // explicit subclasses are its deliberate broad nets (G01R for current,
    // H02H/H02P for protection) — those 65k-doc classes are where the top-30 is
    // far too shallow. Paginate only these (per-subclass depth budget), not every
    // sweep unit, to keep the call budget bounded.
    const paginatedSubclasses =
      tune.maxPaginatedSubclasses > 0
        ? [...new Set([...planSubclasses, ...groupDerivedSubclasses])].slice(
            0,
            tune.maxPaginatedSubclasses
          )
        : [];
    paginatedSubclassesDiag = paginatedSubclasses;
    const paginatedSet = new Set(paginatedSubclasses);

    const uniq = (xs: string[]) =>
      [...new Set(xs.map((x) => x.trim()).filter((x) => x.length >= 3))];
    const ruSweepQs = uniq(probesRu);
    const enSweepQs = uniq(probesEn);

    // Sweep units: exact GROUP (+ enumerated subgroups) at single-page precision,
    // plus SUBCLASS recall nets. Paginated subclasses additionally walk depth.
    const sweepUnits: {
      key: string;
      filter: SweepFilter;
      pages: number;
    }[] = [
      ...topGroups.map((g) => ({
        key: `g:${g}`,
        filter: { ipcGroups: [g] },
        pages: 1, // exact group = precise, top page is enough
      })),
      ...sweepSubclasses.map((s) => ({
        key: `s:${s}`,
        filter: { ipcSubclasses: [s] },
        pages: paginatedSet.has(s) ? tune.depthPages : 1,
      })),
    ];

    const sweepTasks: {
      key: string;
      filter: SweepFilter;
      qn: string;
      datasets: string[];
      offset: number;
    }[] = [];
    for (const u of sweepUnits) {
      for (let page = 0; page < u.pages; page++) {
        const offset = page * tune.sweepLimit;
        for (const b of regionBuckets) {
          for (const qn of b.lang === "ru" ? ruSweepQs : enSweepQs) {
            sweepTasks.push({
              key: u.key,
              filter: u.filter,
              qn,
              datasets: b.datasets,
              offset,
            });
          }
        }
      }
    }
    const sweepResults = sweepTasks.length
      ? await mapPool(sweepTasks, FETCH_CONCURRENCY, (t) =>
          searchLandscape(
            base,
            fetchImpl,
            t.qn,
            t.datasets,
            t.filter,
            tune.sweepLimit,
            t.offset
          )
        )
      : [];
    // Merge each unit's phrasing/bucket/page lists by best in-list rank, then
    // round-robin ACROSS units so every relevant class contributes near the
    // front (a strong analog in a deep page stays early enough to reach the
    // bounded rank set).
    const byKey = new Map<string, { hits: PatentHit[] }[]>();
    sweepResults.forEach((res, i) => {
      const k = sweepTasks[i].key;
      const arr = byKey.get(k) ?? [];
      arr.push(res);
      byKey.set(k, arr);
    });
    const groupMerged = sweepUnits
      .map((u) => bestRankMerge(byKey.get(u.key) ?? []))
      .filter((l) => l.length > 0);
    inClassPool = roundRobinLists(groupMerged, tune.roundRobinCap);
    poolSweepLen = inClassPool.length;

    // 3.5 PRIORITY SEED — reserve window slots for in-class precision. The broad
    // pool (~2000 docs at full depth) drowns the LLM ranker: an in-class analog
    // that PatSearch ranks #1 WITHIN its IPC-class sweep lands at pool ~#299
    // after the breadth merge and never survives a 140-wide ranking chunk (clean
    // run: RU2854805 in pool but #299, window MISS). So take the TOP few of EACH
    // sweep unit's merged list — the strongest in-class analogs, where real
    // prior-art clusters — into one small focused set ranked on its OWN, then
    // give it first claim on the window (see the combine step in the rank block).
    const PRIORITY_PER_UNIT = 6;
    const seedSeen = new Set<string>();
    for (const list of groupMerged) {
      for (const h of list.slice(0, PRIORITY_PER_UNIT)) {
        if (h.id && !seedSeen.has(h.id)) {
          seedSeen.add(h.id);
          prioritySeed.push(h);
        }
      }
    }
    prioritySeed = prioritySeed.slice(0, 140); // one rank chunk, no map-reduce
    prioritySeedLen = prioritySeed.length;

    // Broad pool = in-class analogs first (precision), then the semantic pool
    // (breadth). The ranker reads a bounded prefix small enough that a clear
    // analog isn't lost to attention dilution over a huge candidate list.
    const seen = new Set<string>();
    for (const h of [...inClassPool, ...poolSemantic]) {
      if (h.id && !seen.has(h.id)) {
        seen.add(h.id);
        hits.push(h);
      }
    }
  }

  // Fallback to the single-query search if planning yielded nothing.
  if (hits.length === 0) {
    const legacy = await legacySearch(base, fetchImpl, description);
    hits = legacy.hits;
    total = legacy.total;
    usedLegacyFallback = true;
  }

  let ranked = 0;
  if (hits.length > 0) {
    const POOL_CAP = tune.poolCap;
    const CHUNK = 140;
    const PER_CHUNK = 25;
    const RANK_CONCURRENCY = 4;
    const pool = hits.slice(0, POOL_CAP);

    // ── Tier A (precision): focused rank of the in-class priority seed ──
    // Ranked on its own (one chunk, ~≤140) so the strongest in-class analogs
    // aren't diluted by the ~2000-doc breadth pool. Run concurrently with the
    // broad-tier chunks below.
    const priorityPromise: Promise<PatentHit[]> =
      prioritySeed.length > 0
        ? rankCall(base, fetchImpl, description, prioritySeed, rankLimit).then(
            (ids) => mapIds(ids, prioritySeed)
          )
        : Promise.resolve([]);

    // ── Tier B (breadth): two-pass map-reduce over the whole pool ──
    // The judge reliably picks a clear analog from ~140 candidates but loses it
    // among 400+ (attention dilution). Read the WHOLE pool in chunks (map), keep
    // each chunk's top survivors, then rank the survivors (reduce).
    async function rankBroad(): Promise<PatentHit[]> {
      if (pool.length <= CHUNK) {
        return mapIds(
          await rankCall(base, fetchImpl, description, pool, rankLimit),
          pool
        );
      }
      const chunks: PatentHit[][] = [];
      for (let i = 0; i < pool.length; i += CHUNK) {
        chunks.push(pool.slice(i, i + CHUNK));
      }
      const chunkIdLists = await mapPool(chunks, RANK_CONCURRENCY, (c) =>
        rankCall(base, fetchImpl, description, c, PER_CHUNK)
      );
      const survivorSeen = new Set<string>();
      const survivors: PatentHit[] = [];
      const byId = new Map(pool.map((h) => [h.id, h]));
      chunkIdLists.forEach((ids, ci) => {
        const picked = ids.length
          ? mapIds(ids, chunks[ci])
          : chunks[ci].slice(0, PER_CHUNK);
        for (const h of picked) {
          if (h.id && byId.has(h.id) && !survivorSeen.has(h.id)) {
            survivorSeen.add(h.id);
            survivors.push(h);
          }
        }
      });
      let broad =
        survivors.length > rankLimit
          ? mapIds(
              await rankCall(base, fetchImpl, description, survivors, rankLimit),
              survivors
            )
          : survivors;
      if (broad.length === 0) broad = survivors.slice(0, rankLimit);
      return broad;
    }

    const [priorityRanked, rankedHits] = await Promise.all([
      priorityPromise,
      rankBroad(),
    ]);
    priorityRankedLen = priorityRanked.length;

    // ── Combine (tiered): reserve the front half of the window for the precision
    // tier, fill the rest from breadth, then any leftover precision. Dedup + cap.
    // When prioritySeed is empty (lite depth / no sweep) this degrades to the
    // pure broad ranking — identical to the prior behaviour.
    const PRIORITY_RESERVE = Math.floor(rankLimit / 2);
    const windowHits: PatentHit[] = [];
    const wSeen = new Set<string>();
    const pushUnique = (h: PatentHit | undefined) => {
      if (h?.id && !wSeen.has(h.id) && windowHits.length < rankLimit) {
        wSeen.add(h.id);
        windowHits.push(h);
      }
    };
    for (const h of priorityRanked.slice(0, PRIORITY_RESERVE)) pushUnique(h);
    for (const h of rankedHits) pushUnique(h);
    for (const h of priorityRanked) pushUnique(h);

    if (windowHits.length > 0) {
      const rankedIds = new Set(windowHits.map((h) => h.id));
      hits = [...windowHits, ...hits.filter((h) => !rankedIds.has(h.id))];
      ranked = windowHits.length;
    }
  }

  return {
    hits,
    total,
    diagnostics: {
      depth,
      planned,
      usedLegacyFallback,
      facetCount,
      poolSemantic: poolSemanticLen,
      poolFacet: poolFacetLen,
      poolSweep: poolSweepLen,
      topGroups,
      planSubclasses: planSubclassesDiag,
      sweptSubclasses: sweptSubclassesDiag,
      paginatedSubclasses: paginatedSubclassesDiag,
      enumeratedSubgroups: enumeratedSubgroupsDiag,
      prioritySeed: prioritySeedLen,
      priorityRanked: priorityRankedLen,
      ranked,
    },
  };
}
