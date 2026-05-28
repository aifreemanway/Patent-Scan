// Examiner-grade two-stage prior-art retrieval for novelty search.
//
// PatSearch ranks a doc highly only for a query that paraphrases it, so a single
// description query misses analogs worded differently (the accuracy beta-blocker:
// novelty under-found international prior-art that landscape surfaced). We:
//   Stage 1 — cast a wide semantic net with aspect-diverse RU+EN queries, run
//             per-region so CN doesn't crowd US/EP/JP, and ALWAYS include the
//             de-anchored function query UNFILTERED so the functional-equivalence
//             probe contributes to recall every run.
//   Stage 2 — IPC class-sweep: re-search the groups where neighbours cluster
//             (plus the plan's declared subclasses) with the function query — the
//             group filter shrinks competition so functionally-equivalent prior-art
//             floats up.
//   Rank   — LLM relevance filter reorders the pool so the real analogs land in
//             the analyze window rather than just the top retrieval hits.
//
// Shared by the search UI (relative fetch in the browser) and server-side callers
// — cross-check and the regression harness — via an injectable base URL + fetch.

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

export type NoveltyRetrievalResult = {
  hits: PatentHit[];
  total: number;
  // Diagnostics for cross-check / harness — never shown to users.
  diagnostics: {
    planned: boolean;
    usedLegacyFallback: boolean;
    poolSemantic: number;
    poolSweep: number;
    topGroups: string[];
    ranked: number;
  };
};

// Full IPC group, e.g. "C21C5/46" (no space).
const IPC_GROUP_RE = /^[A-H]\d{2}[A-Z]\d{1,4}\/\d{1,6}$/;
const IPC_SUBCLASS_RE = /^[A-H]\d{2}[A-Z]$/;

type FetchImpl = typeof fetch;
type SweepFilter = { ipcGroups?: string[]; ipcSubclasses?: string[] };

// Max concurrent PatSearch calls. The sweep fans out ~180 requests; firing them
// all at once makes the upstream drop connections (ECONNRESET), so we cap
// in-flight requests. Also keeps us a polite client of the Rospatent API.
const FETCH_CONCURRENCY = 10;

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
  filter?: SweepFilter
): Promise<{ hits: PatentHit[]; total: number }> {
  try {
    const r = await fetchImpl(`${base}/api/landscape/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        qn,
        datasets,
        limit: 30,
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
// seen in more lists first). Round-robin interleaving buries a strong analog
// that sits at e.g. rank #4 in one IPC-filtered list behind ranks #0-3 of all
// ~70 lists (it lands ~#575, beyond the rank cutoff). Best-rank keeps that #4
// near the front so the precision of the IPC sweep actually survives the merge.
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

// Interleave several already-ranked lists, taking up to `cap` from each. Used to
// fold per-group sweep results into one pool so every relevant class contributes
// near the front, rather than one class's tail crowding out another's head.
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

// One call to the LLM relevance filter. Returns the selected ids (empty on any
// failure so the caller can fall back to retrieval order).
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

export async function retrieveNoveltyPriorArt(opts: {
  description: string;
  answers?: string[];
  base?: string; // "" = relative (browser); absolute origin for Node callers.
  fetchImpl?: FetchImpl;
  rankLimit?: number;
}): Promise<NoveltyRetrievalResult> {
  const base = opts.base ?? "";
  const fetchImpl = opts.fetchImpl ?? fetch;
  const description = opts.description.trim();
  const cleanAnswers = (opts.answers ?? []).filter((a) => a.trim().length > 0);
  const rankLimit = opts.rankLimit ?? 60;

  let hits: PatentHit[] = [];
  let total = 0;
  let planned = false;
  let usedLegacyFallback = false;
  let topGroups: string[] = [];
  let poolSemanticLen = 0;
  let poolSweepLen = 0;
  let inClassPool: PatentHit[] = [];

  const topic = [description, ...cleanAnswers].join("\n");
  const planResp = await fetchImpl(`${base}/api/landscape/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic }),
  });

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
    };
    const ruQueries = plan.queries ?? [];
    const enQueries = plan.queriesEn ?? [];
    // De-anchored probes per language: two FUNCTION phrasings (what it does) +
    // one STRUCTURE phrasing (what it is). A given analog matches only one axis
    // — US6322610 surfaces for a function probe, US4572482 (a cooled tuyere) only
    // for the structure probe — and a single function phrasing sometimes misses
    // its analog within the class, so a second paraphrase de-risks recall.
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

    // Per-region buckets: CN crowds out US/EP/JP when datasets are queried
    // together, so each English query is run against [us,ep], [jp], [cn]
    // separately; Russian queries hit RU/SU/CIS.
    const regionBuckets: { datasets: string[]; lang: "ru" | "en" }[] = [
      { datasets: ["ru_since_1994", "ru_till_1994", "cis"], lang: "ru" },
      { datasets: ["us", "ep"], lang: "en" },
      { datasets: ["jp"], lang: "en" },
      { datasets: ["cn"], lang: "en" },
    ];
    const probesFor = (lang: "ru" | "en") => (lang === "ru" ? probesRu : probesEn);

    // Stage 1 — semantic multi-query (recall breadth). Aspect queries cover the
    // invention's separate facets; the de-anchored FUNCTION + STRUCTURE probes
    // run UNFILTERED so both equivalence axes contribute every run. The probe
    // results are kept separate as the most on-target signal for deriving sweep
    // classes — they pull in the classes of both a functional analog (US6322610)
    // and a structural one (US4572482), which whole-pool frequency would bury.
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
    const allStage1 = await mapPool(
      [...aspectTasks, ...probeTasks],
      FETCH_CONCURRENCY,
      (t) => searchLandscape(base, fetchImpl, t.qn, t.datasets)
    );
    const aspectResults = allStage1.slice(0, aspectTasks.length);
    const probeResults = allStage1.slice(aspectTasks.length);
    total += [...aspectResults, ...probeResults].reduce(
      (acc, r) => acc + r.total,
      0
    );
    const probeHits = bestRankMerge(probeResults);
    const poolSemantic = bestRankMerge([...aspectResults, ...probeResults]);
    poolSemanticLen = poolSemantic.length;

    // Stage 2 — IPC class-sweep. Derive target groups from the IPC of the PROBE
    // hits, NOT whole-pool frequency: a strong but specialised analog (US6322610
    // = C21C5/46) is a frequency outlier in a pool dominated by adjacent classes,
    // so whole-pool frequency ranks its class too low to ever be swept. Among
    // probe hits its class still sits ~#9, so take the top 10. Plan-declared
    // subclasses are boosted so a relevant class is swept even when under-surfaced.
    const groupFreq = new Map<string, number>();
    for (const h of probeHits) {
      for (const g of h.ipc ?? []) {
        if (IPC_GROUP_RE.test(g)) groupFreq.set(g, (groupFreq.get(g) ?? 0) + 1);
      }
    }
    if (planSubclasses.length) {
      for (const [g, c] of groupFreq) {
        if (planSubclasses.includes(g.slice(0, 4))) groupFreq.set(g, c + 1000);
      }
    }
    topGroups = [...groupFreq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([g]) => g);

    // Sweep each group under its IPC filter with SEVERAL phrasings (function +
    // structure facets). A given analog surfaces only for the phrasing that
    // paraphrases it (US6322610 sits anywhere #3-#11 in C21C5/46 depending on
    // wording, and some phrasings miss it entirely), and the planner's wording
    // varies run to run — so one query is not enough.
    const uniq = (xs: string[]) =>
      [...new Set(xs.map((x) => x.trim()).filter((x) => x.length >= 3))];
    // Sweep with the de-anchored PROBES only (function ×2 + structure). The
    // probes are the queries built to find equivalence-by-meaning analogs, and
    // under an IPC filter even a phrasing that missed unfiltered can surface its
    // analog. Aspect queries already contribute via the unfiltered semantic pool
    // (+ two-pass judge), so keeping the sweep to probes holds the call budget
    // (~120 vs ~280) without losing their recall.
    const ruSweepQs = uniq(probesRu);
    const enSweepQs = uniq(probesEn);
    const sweepTasks: { group: string; qn: string; datasets: string[] }[] = [];
    for (const g of topGroups) {
      for (const b of regionBuckets) {
        for (const qn of b.lang === "ru" ? ruSweepQs : enSweepQs) {
          sweepTasks.push({ group: g, qn, datasets: b.datasets });
        }
      }
    }
    const sweepResults = sweepTasks.length
      ? await mapPool(sweepTasks, FETCH_CONCURRENCY, (t) =>
          searchLandscape(base, fetchImpl, t.qn, t.datasets, {
            ipcGroups: [t.group],
          })
        )
      : [];
    // Merge each group's phrasing/bucket lists by best in-list rank, then
    // round-robin ACROSS groups so every relevant class contributes near the
    // front. This keeps a strong analog in a deep-derived class (US6322610 in
    // C21C5/46, the #9-ranked class) early enough to enter the bounded rank set.
    const byGroup = new Map<string, { hits: PatentHit[] }[]>();
    sweepResults.forEach((res, i) => {
      const g = sweepTasks[i].group;
      const arr = byGroup.get(g) ?? [];
      arr.push(res);
      byGroup.set(g, arr);
    });
    const groupMerged = topGroups
      .map((g) => bestRankMerge(byGroup.get(g) ?? []))
      .filter((l) => l.length > 0);
    inClassPool = roundRobinLists(groupMerged, 20);
    poolSweepLen = inClassPool.length;

    // Broad pool = in-class analogs first (precision: covers the injection
    // facet), then the semantic pool (breadth: covers the structure facet and
    // everything else). The ranker reads a bounded prefix small enough that a
    // clear analog isn't lost to attention dilution over a huge candidate list.
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
    // Two-pass (map-reduce) LLM relevance filter. The judge reliably picks a
    // clear analog from ~140 candidates but loses it among 400+ (attention
    // dilution), and a slice cutoff would drop a semantically-divergent analog
    // that legitimately sits deep in the pool. So: read the WHOLE pool in
    // chunks (map), keep each chunk's top survivors, then rank the survivors
    // (reduce). Recall then depends only on a doc being retrieved into the pool
    // at all — independent of query phrasing or where it landed. Falls back to
    // retrieval order if the whole thing errors out.
    const POOL_CAP = 720;
    const CHUNK = 140;
    const PER_CHUNK = 25;
    const RANK_CONCURRENCY = 4;
    const pool = hits.slice(0, POOL_CAP);

    let rankedHits: PatentHit[] = [];
    if (pool.length <= CHUNK) {
      rankedHits = mapIds(
        await rankCall(base, fetchImpl, description, pool, rankLimit),
        pool
      );
    } else {
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
        // Fall back to the chunk's retrieval-order head if that chunk's rank
        // call failed, so a chunk error can't silently drop its candidates.
        const picked = ids.length ? mapIds(ids, chunks[ci]) : chunks[ci].slice(0, PER_CHUNK);
        for (const h of picked) {
          if (h.id && byId.has(h.id) && !survivorSeen.has(h.id)) {
            survivorSeen.add(h.id);
            survivors.push(h);
          }
        }
      });
      rankedHits =
        survivors.length > rankLimit
          ? mapIds(
              await rankCall(base, fetchImpl, description, survivors, rankLimit),
              survivors
            )
          : survivors;
      if (rankedHits.length === 0) rankedHits = survivors.slice(0, rankLimit);
    }

    if (rankedHits.length > 0) {
      const rankedIds = new Set(rankedHits.map((h) => h.id));
      hits = [...rankedHits, ...hits.filter((h) => !rankedIds.has(h.id))];
      ranked = rankedHits.length;
    }
  }

  return {
    hits,
    total,
    diagnostics: {
      planned,
      usedLegacyFallback,
      poolSemantic: poolSemanticLen,
      poolSweep: poolSweepLen,
      topGroups,
      ranked,
    },
  };
}
